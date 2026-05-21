/**
 * engine/after-hours.ts — ветвление по `cfg.afterHoursPolicy` для входящих
 * сообщений клиентов вне рабочих часов (Task 4.9 manager-mode tasks.md,
 * Requirement 8).
 *
 * Модуль чистый: не читает диск, не пишет логи, не дёргает LLM. Caller
 * (`runtime.ts:handleIncoming`) вызывает `evaluateAfterHours` после того, как
 * gate (`engine/gate.ts`) разрешил обработку и до выбора `mandate`-действия.
 * Функция возвращает одно из:
 *  - `normal` — обработка по обычным правилам (или мы в рабочих часах);
 *  - `silent` — caller не отвечает и не открывает тикет (Req 8.4);
 *  - `auto-reply` — caller отправляет короткое сообщение и помечает
 *    `contact.lastAutoReplyAt = now` (Req 8.5);
 *  - `auto-reply-skip` — auto-reply уже был отправлен в текущем непрерывном
 *    off-окне (Req 8.6).
 *
 * Босс (сообщения от `cfg.ownerId`) не доходят сюда: caller обходит модуль
 * для босса (Req 8.9).
 */

import type {
  AfterHoursPolicy,
  BusySlot,
  ContactRecord,
  ProfileConfig,
  Tier
} from "../types.js";
import { isOutOfHours } from "./work-hours.js";

/** Закрытое множество исходов после-часового решения. */
export type AfterHoursDecision =
  | { action: "normal" }
  | { action: "silent" }
  | { action: "auto-reply"; text: string }
  | { action: "auto-reply-skip"; reason: "already-replied-in-window" };

/** Дефолтный текст auto-reply (Req 8.5: длина 20-200, без эмодзи и markdown). */
export const DEFAULT_AFTER_HOURS_AUTO_REPLY =
  "Спасибо за сообщение. Сейчас вне рабочих часов, отвечу как только вернусь.";

/** Тиры, которые при `vip-only` обрабатываются как обычно (Req 8.7). */
const VIP_TIERS: ReadonlyArray<Tier> = ["trusted-partner", "vip"];

export interface EvaluateAfterHoursInput {
  /** Текущее значение `cfg.afterHoursPolicy`. `undefined` → дефолт `vip-only` (Req 8.2). */
  policy: AfterHoursPolicy | undefined;
  /** Карточка контакта. Может быть `undefined`, если её ещё не успели создать
   *  или файл повреждён (Req 8.8 — обращаемся как с обычным клиентом). */
  contact?: Pick<ContactRecord, "tier" | "lastAutoReplyAt"> | undefined;
  /** Уже посчитано caller-ом через `isOutOfHours(cfg, now)`. */
  isOutOfHours: boolean;
  /** Текущий момент времени; нужен для сравнения с `lastAutoReplyAt`. */
  now: Date;
  /** Начало текущего непрерывного off-окна. Если `null`, окно неизвестно
   *  (например, мы в рабочих часах) — auto-reply разрешаем без проверки. */
  lastOutWindowStart: Date | null;
  /** Опциональный override текста auto-reply. */
  autoReplyText?: string;
}

/**
 * Чистая функция-роутер. Все три значения политики покрываются явно;
 * неизвестное значение нормализуется в `vip-only` (Req 8.2).
 */
export function evaluateAfterHours(input: EvaluateAfterHoursInput): AfterHoursDecision {
  // В рабочих часах после-часовой роутер не применяется (Req 8.4-8.7
  // действуют только «while текущее время вне рабочих часов»).
  if (!input.isOutOfHours) {
    return { action: "normal" };
  }

  const policy = normalizePolicy(input.policy);

  if (policy === "silent") {
    return { action: "silent" };
  }

  if (policy === "auto-reply") {
    return autoReplyDecision(input);
  }

  // policy === "vip-only"
  const tier = input.contact?.tier;
  if (tier && VIP_TIERS.includes(tier)) {
    return { action: "normal" };
  }
  // Тир отсутствует или контакт не VIP → auto-reply поведение (Req 8.7-8.8).
  return autoReplyDecision(input);
}

function normalizePolicy(raw: AfterHoursPolicy | undefined): AfterHoursPolicy {
  if (raw === "silent" || raw === "auto-reply" || raw === "vip-only") return raw;
  return "vip-only";
}

function autoReplyDecision(input: EvaluateAfterHoursInput): AfterHoursDecision {
  if (alreadyAutoRepliedInCurrentWindow(input)) {
    return { action: "auto-reply-skip", reason: "already-replied-in-window" };
  }
  const text = sanitizeAutoReplyText(input.autoReplyText) ?? DEFAULT_AFTER_HOURS_AUTO_REPLY;
  return { action: "auto-reply", text };
}

function alreadyAutoRepliedInCurrentWindow(input: EvaluateAfterHoursInput): boolean {
  const last = input.contact?.lastAutoReplyAt;
  if (!last) return false;
  const lastTs = Date.parse(last);
  if (!Number.isFinite(lastTs)) return false;
  // Если caller не смог посчитать начало off-окна, считаем что предыдущая
  // отметка относится к этому же окну — берём «не позже now» как нижнюю
  // границу (консервативно: лучше пропустить второй auto-reply, чем
  // продублировать его, Req 8.6).
  if (!input.lastOutWindowStart) {
    return lastTs <= input.now.getTime();
  }
  return lastTs >= input.lastOutWindowStart.getTime();
}

/**
 * Гарантирует длину 20–200 и отсутствие markdown/эмодзи (грубая проверка по
 * базовым латинским/кириллическим символам и пунктуации). Если текст не
 * проходит — возвращаем `undefined` и caller подставит дефолт.
 */
function sanitizeAutoReplyText(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (text.length < 20 || text.length > 200) return undefined;
  // Простой запрет markdown-символов и эмодзи (Req 8.5: «без эмодзи и md»).
  if (/[*_`#>~\[\]\\]/.test(text)) return undefined;
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) return undefined;
  return text;
}

/** Шаг сканирования назад при поиске начала off-окна — 1 минута. */
const SCAN_STEP_MS = 60 * 1000;
/** Максимальный «откат» при поиске границы окна — 25 часов. */
const SCAN_LIMIT_MS = 25 * 60 * 60 * 1000;

/**
 * Возвращает момент, с которого началось текущее непрерывное off-окно.
 * Если `now` приходится на рабочие часы — возвращает `null`.
 *
 * Алгоритм: шагаем назад по минутам до тех пор, пока `isOutOfHours` остаётся
 * `true`; первая граница, после которой `isOutOfHours` становится `false`,
 * считается началом окна. Лимит 25 часов покрывает дневные busy-слоты,
 * sleep-окно через полночь и переходы через DST.
 */
export function computeOffWindowStart(cfg: ProfileConfig, now: Date = new Date()): Date | null {
  if (!isOutOfHours(cfg, now)) return null;

  let cursor = now.getTime();
  const earliest = cursor - SCAN_LIMIT_MS;
  // Двигаемся назад поминутно, ища последний момент, когда было «вне off».
  let lastOff = cursor;
  while (cursor > earliest) {
    const prev = cursor - SCAN_STEP_MS;
    if (!isOutOfHours(cfg, new Date(prev))) {
      // На границе [prev → lastOff] произошёл переход work → off.
      return new Date(lastOff);
    }
    cursor = prev;
    lastOff = prev;
  }
  // Если за 25 часов «рабочих» минут не нашли — считаем границей `earliest`.
  return new Date(earliest);
}

/**
 * Утилита для caller-а: набор `{ isOutOfHours, lastOutWindowStart }` для
 * текущего момента, чтобы не считать дважды.
 */
export function snapshotAfterHours(cfg: ProfileConfig, now: Date = new Date()): {
  isOutOfHours: boolean;
  lastOutWindowStart: Date | null;
} {
  const out = isOutOfHours(cfg, now);
  return {
    isOutOfHours: out,
    lastOutWindowStart: out ? computeOffWindowStart(cfg, now) : null
  };
}

// Тип-алиас для tests/линковки — busy-slot-ы используются `computeOffWindowStart`
// неявно (через `isOutOfHours`).
export type _BusySlotForTypes = BusySlot;
