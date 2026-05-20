/**
 * digests.ts — дайджест боссу (Task 4.10 manager-mode, Requirement 9).
 *
 * `composeDailyDigest(slug)` собирает короткий русский текст без markdown и
 * эмодзи, который шлётся боссу один раз в указанный период. Подсчитывает:
 *  - открытые тикеты (`state ∈ {open, waiting-boss, answered}`),
 *  - тикеты в ожидании босса (`state === "waiting-boss"`),
 *  - новые контакты за период (по `createdAt`, дефолт — последние 24 часа).
 *
 * `scheduleDigest` считает следующий момент срабатывания по периоду и
 * времени `HH:MM` с учётом `cfg.tz`. Период ограничен 1..168 часами
 * (Requirement 9.2). Дефолты — 24 часа в 09:00 локального времени профиля.
 *
 * Failed-пункты (см. `Agenda_Outbound_Boss`) никогда не повторяются —
 * runtime отвечает за это, превращая ошибку отправки в `state="failed"`
 * (Requirement 9.6).
 */

import { listContacts, loadTickets } from "../storage/md.js";

/** Открытыми считаются все тикеты, пока не `closed`. */
const OPEN_STATES = new Set(["open", "waiting-boss", "answered"]);

export interface DailyDigest {
  /** Готовый текст для отправки боссу. */
  text: string;
  /** Подсчёты — для тестов и логов. */
  counts: {
    openTickets: number;
    waitingBoss: number;
    newContacts: number;
  };
}

/** Параметры компоновки дайджеста. */
export interface ComposeDailyDigestOptions {
  /** Текущее время. По умолчанию `new Date()`. */
  now?: Date;
  /**
   * Период в миллисекундах для подсчёта новых контактов. По умолчанию
   * 24 часа. Должен совпадать с `digestPeriodHours` из конфига профиля.
   */
  periodMs?: number;
  /**
   * Префикс ссылки на Inbox-страницу. По умолчанию `/inbox/`. Полный путь
   * собирается как `${linkPrefix}${slug}`.
   */
  linkPrefix?: string;
}

const DEFAULT_PERIOD_MS = 24 * 60 * 60 * 1000;
const MAX_DIGEST_LEN = 500;

/**
 * Собирает дайджест боссу для профиля `slug`. Не дёргает Telegram — runtime
 * сам решает, когда и куда отправлять.
 */
export async function composeDailyDigest(
  slug: string,
  opts: ComposeDailyDigestOptions = {}
): Promise<DailyDigest> {
  const now = opts.now ?? new Date();
  const periodMs = opts.periodMs ?? DEFAULT_PERIOD_MS;
  const linkPrefix = opts.linkPrefix ?? "/inbox/";

  const tickets = await loadTickets(slug);
  const openTickets = tickets.tickets.filter(t => OPEN_STATES.has(t.state)).length;
  const waitingBoss = tickets.tickets.filter(t => t.state === "waiting-boss").length;

  const contacts = await listContacts(slug);
  const cutoff = now.getTime() - periodMs;
  const newContacts = contacts.filter(c => {
    const ts = Date.parse(c.createdAt);
    return Number.isFinite(ts) && ts >= cutoff;
  }).length;

  const link = `Inbox: ${linkPrefix}${slug}`;
  let text: string;
  if (openTickets === 0 && waitingBoss === 0 && newContacts === 0) {
    text = ["Дайджест дня.", "Все тихо: открытых тикетов нет, ожидающих ответа нет, новых контактов нет.", link].join("\n");
  } else {
    text = [
      "Дайджест дня.",
      `Открытых тикетов: ${openTickets}.`,
      `Ожидают ответа: ${waitingBoss}.`,
      `Новых контактов за период: ${newContacts}.`,
      link
    ].join("\n");
  }

  // Защита от непредвиденно длинного slug — обрезаем по жёсткому потолку
  // и строго без markdown/эмодзи (см. Req 5.2 как близкий по духу инвариант).
  const safe = text.length > MAX_DIGEST_LEN ? text.slice(0, MAX_DIGEST_LEN) : text;

  return {
    text: safe,
    counts: { openTickets, waitingBoss, newContacts }
  };
}

// ============================================================================
// scheduleDigest — таймер периодического дайджеста.
// ============================================================================

const MIN_PERIOD_HOURS = 1;
const MAX_PERIOD_HOURS = 168; // 7 дней, Req 9.2.
const DEFAULT_PERIOD_HOURS = 24;
const DEFAULT_DIGEST_TIME = "09:00";

export interface ScheduleDigestOptions {
  /** Период в часах. Допустимо 1..168. Дефолт 24. */
  periodHours?: number;
  /** Время дайджеста в формате `HH:MM` по `tz` профиля. Дефолт `09:00`. */
  digestTime?: string;
  /** IANA timezone профиля. Например `Europe/Moscow`. */
  tz: string;
  /** Текущее время для расчёта первого тика (для тестов). */
  now?: Date;
}

export interface DigestSchedule {
  /** ms до первого срабатывания. */
  firstDelayMs: number;
  /** ISO-время первого срабатывания (для логов и тестов). */
  firstFireAt: string;
  /** Период в миллисекундах между последующими срабатываниями. */
  intervalMs: number;
  /** Финальный использованный период в часах. */
  periodHours: number;
  /** Финальное использованное время `HH:MM`. */
  digestTime: string;
}

export interface ScheduleDigestHandle {
  /** Информация о ближайшем тике. */
  schedule: DigestSchedule;
  /** Останавливает таймеры. Идемпотентно. */
  stop(): void;
}

/**
 * Рассчитывает расписание дайджеста: ближайший момент `digestTime` по `tz`,
 * далее интервал `periodHours` часов. Бросает `RangeError` при выходе за
 * допустимый диапазон периода.
 */
export function planDigestSchedule(opts: ScheduleDigestOptions): DigestSchedule {
  const periodHours = opts.periodHours ?? DEFAULT_PERIOD_HOURS;
  if (!Number.isFinite(periodHours) || periodHours < MIN_PERIOD_HOURS || periodHours > MAX_PERIOD_HOURS) {
    throw new RangeError(
      `digestPeriodHours must be in [${MIN_PERIOD_HOURS}..${MAX_PERIOD_HOURS}], got ${periodHours}`
    );
  }
  const digestTime = opts.digestTime ?? DEFAULT_DIGEST_TIME;
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(digestTime)) {
    throw new RangeError(`digestTime must be HH:MM, got ${digestTime}`);
  }
  const now = opts.now ?? new Date();
  const intervalMs = Math.round(periodHours * 60 * 60 * 1000);

  const firstFireAt = nextLocalOccurrence(now, digestTime, opts.tz);
  let firstDelayMs = firstFireAt.getTime() - now.getTime();
  if (firstDelayMs <= 0) firstDelayMs = intervalMs;

  return {
    firstDelayMs,
    firstFireAt: firstFireAt.toISOString(),
    intervalMs,
    periodHours,
    digestTime
  };
}

/**
 * Рантайм-handle для дайджеста. Параметр `runtime` — минимальный контракт:
 * `onTick()` будет вызван в каждый момент срабатывания, а `proactiveBoss`
 * проверяется заново внутри runtime'а перед фактической отправкой
 * (см. Requirement 9.5). Метод нужен в основном для удобной отписки.
 */
export interface DigestRuntime {
  setTimeout: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearTimeout: (t: NodeJS.Timeout) => void;
  setInterval: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (t: NodeJS.Timeout) => void;
}

/**
 * Регистрирует периодический дайджест. Не отправляет ничего сам — на каждый
 * тик дёргается `onTick()`. Caller внутри `onTick` проверяет `proactiveBoss`
 * и отправляет результат `composeDailyDigest()` через `tg.sendText`.
 */
export function scheduleDigest(
  opts: ScheduleDigestOptions & { onTick: () => void; runtime?: DigestRuntime }
): ScheduleDigestHandle {
  const schedule = planDigestSchedule(opts);
  const r = opts.runtime ?? {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (t) => clearInterval(t)
  };

  let intervalHandle: NodeJS.Timeout | undefined;
  let stopped = false;

  const firstHandle = r.setTimeout(() => {
    if (stopped) return;
    try { opts.onTick(); } catch { /* swallow — caller logs */ }
    intervalHandle = r.setInterval(() => {
      if (stopped) return;
      try { opts.onTick(); } catch { /* swallow */ }
    }, schedule.intervalMs);
    intervalHandle.unref?.();
  }, schedule.firstDelayMs);
  firstHandle.unref?.();

  return {
    schedule,
    stop() {
      if (stopped) return;
      stopped = true;
      try { r.clearTimeout(firstHandle); } catch { /* ignore */ }
      if (intervalHandle) {
        try { r.clearInterval(intervalHandle); } catch { /* ignore */ }
      }
    }
  };
}

/**
 * Вычисляет ближайший момент `HH:MM` по локальному `tz`, не раньше `now`.
 * Если `HH:MM` в `tz`-локали уже прошло сегодня — возвращает завтрашнее
 * срабатывание. Реализация через `Intl.DateTimeFormat` без сторонних
 * библиотек: считаем оффсет `tz` относительно `now`, превращаем в UTC.
 */
function nextLocalOccurrence(now: Date, hhmm: string, tz: string): Date {
  const [hh, mm] = hhmm.split(":").map(n => Number(n));
  // Получаем в локальном `tz` дату/время текущего момента.
  const partsNow = formatLocalParts(now, tz);
  // Целевой день — сегодня в `tz`.
  const targetIsoLocal = `${partsNow.year}-${pad(partsNow.month)}-${pad(partsNow.day)}T${pad(hh)}:${pad(mm)}:00`;
  let target = fromLocalIso(targetIsoLocal, tz);
  if (target.getTime() <= now.getTime()) {
    // прибавляем сутки и пересчитываем оффсет
    const tomorrow = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    const partsTomorrow = formatLocalParts(tomorrow, tz);
    const isoTomorrow = `${partsTomorrow.year}-${pad(partsTomorrow.month)}-${pad(partsTomorrow.day)}T${pad(hh)}:${pad(mm)}:00`;
    target = fromLocalIso(isoTomorrow, tz);
  }
  return target;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function formatLocalParts(date: Date, tz: string): LocalParts {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour") % 24,
      minute: get("minute")
    };
  } catch {
    // невалидный tz → откатываемся на UTC
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes()
    };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Парсит локальный ISO-без-зоны (`YYYY-MM-DDTHH:mm:ss`) как момент в `tz`.
 * Считает оффсет `tz` итеративно: сначала трактует строку как UTC, затем
 * корректирует на разницу часовых поясов. Достаточно для дайджестов с
 * минутной точностью.
 */
function fromLocalIso(iso: string, tz: string): Date {
  // Шаг 1: считаем как UTC.
  const guess = new Date(`${iso}Z`);
  if (!Number.isFinite(guess.getTime())) return guess;
  // Шаг 2: смотрим, как этот момент выглядит в `tz`, и находим разницу
  // между «как видим в tz» и «как написано в iso».
  const seen = formatLocalParts(guess, tz);
  const expected = parseIso(iso);
  if (!expected) return guess;
  const diffMin =
    (expected.hour - seen.hour) * 60 +
    (expected.minute - seen.minute) +
    (expected.day - seen.day) * 24 * 60 +
    (expected.month - seen.month) * 24 * 60 * 31 +
    (expected.year - seen.year) * 24 * 60 * 365;
  return new Date(guess.getTime() + diffMin * 60 * 1000);
}

function parseIso(iso: string): LocalParts | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5])
  };
}

// ============================================================================
// schedulePromiseFollowUp — обещания клиенту (Req 9.1).
// ============================================================================

import { readAgenda, writeAgenda, type AgendaItem } from "../storage/md.js";

const DEFAULT_FOLLOWUP_DELAY_MS = 24 * 60 * 60 * 1000;

export interface PromiseFollowUpInput {
  /** Текст обещания (что именно пообещали). */
  promise: string;
  /** ID клиентского чата, в который пойдёт follow-up. */
  contactChatId: string | number;
  /** Расчётный срок выполнения обещания (мс). По умолчанию `now + 24h`. */
  dueAtMs?: number;
  /** Текущее время (для тестов). */
  now?: Date;
}

export interface PromiseFollowUpResult {
  /** ID созданного или существующего пункта повестки. */
  itemId: string;
  /** `true`, если пункт был создан в этом вызове. */
  created: boolean;
}

/**
 * Идемпотентно планирует `Agenda_Outbound_Client` follow-up по обещанию.
 * Если для того же `contactChatId` уже есть pending-пункт с тем же
 * `about` (substring `promise`), возвращает его без создания дубля.
 */
export async function schedulePromiseFollowUp(
  slug: string,
  input: PromiseFollowUpInput
): Promise<PromiseFollowUpResult> {
  const now = input.now ?? new Date();
  const dueAt = input.dueAtMs ?? now.getTime() + DEFAULT_FOLLOWUP_DELAY_MS;
  const about = input.promise.trim().slice(0, 200);
  if (!about) {
    throw new Error("schedulePromiseFollowUp: empty promise");
  }
  const agenda = await readAgenda(slug);
  const existing = agenda.find(it =>
    it.state === "pending" &&
    String(it.chatId) === String(input.contactChatId) &&
    it.direction === "client" &&
    it.about === about
  );
  if (existing) {
    return { itemId: existing.id, created: false };
  }
  const item: AgendaItem = {
    id: `promise_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    about,
    pingAt: new Date(dueAt).toISOString(),
    reason: "follow-up по обещанию клиенту",
    importance: 2,
    state: "pending",
    attempts: 0,
    chatId: input.contactChatId,
    createdAt: now.toISOString(),
    history: [`promise-followup created at ${now.toISOString()}`],
    direction: "client"
  };
  agenda.push(item);
  await writeAgenda(slug, agenda);
  return { itemId: item.id, created: true };
}

/**
 * Помечает пункт повестки как `failed` без повторов. Используется runtime'ом,
 * когда отправка через TG-адаптер вернула ошибку (Req 9.6). Идемпотентно:
 * повторный вызов не меняет состояние.
 */
export async function markAgendaItemFailed(slug: string, itemId: string, reason: string): Promise<void> {
  const agenda = await readAgenda(slug);
  const item = agenda.find(it => it.id === itemId);
  if (!item) return;
  if (item.state === "failed") return;
  item.state = "failed";
  item.history = [...(item.history ?? []), `failed at ${new Date().toISOString()}: ${reason}`];
  await writeAgenda(slug, agenda);
}
