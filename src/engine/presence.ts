// Симуляция онлайн-поведения. Каждая девушка имеет свой паттерн заходов в тг.
// Используется для реалистичных задержек ответа и для решения "она не онлайн прям сейчас".

import type { BusySlot, CommunicationProfile, ProfileConfig, Weekday } from "../types.js";
import type { LegacyStageId as StageId } from "./legacy-stage.js";
import type { ConflictState } from "./conflict.js";
import { normalizeCommunicationProfile } from "../presets/communication.js";

export type PresencePattern =
  | "phone-attached"   // телефон в руке почти всегда. отвечает быстро. бывает сон/работа
  | "burst-checker"    // заходит каждые 15-30 мин на 2-5 мин и снова уходит
  | "rare-checker"     // раз в 1-2 часа, иногда забывает
  | "evening-only"     // днём занята (работа/универ), активна с 18:00
  | "phone-attached-night"; // сова, активна 22:00-04:00, днём вяло

export interface PresenceProfile {
  pattern: PresencePattern;
  /** Часы сна в её локальном tz (от и до, может пересекать полночь). Берутся из профиля. */
  sleepFrom: number; // 0..23
  sleepTo: number;   // 0..23
  /** Средний интервал между заходами (мин) */
  checkEveryMin: number;
  /** Сколько минут она "онлайн" за один заход */
  onlineWindowMin: number;
  /** Базовая вероятность ответить если она оффлайн (через пинг-уведомление) */
  offlineReplyChance: number; // 0..1
  /** Вероятность проснуться ночью на входящее */
  nightWakeChance: number;
}

/** Детерминированный профиль присутствия из имени-сида и персоны. Часы сна берутся из профиля. */
export function computePresenceProfile(cfg: ProfileConfig): PresenceProfile {
  const seed = [...cfg.name].reduce((a, c) => a + c.charCodeAt(0), 0) + cfg.age;
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const communication = normalizeCommunicationProfile(cfg);

  const patterns: PresencePattern[] = [
    "phone-attached", "burst-checker", "rare-checker", "evening-only", "phone-attached-night"
  ];
  let pattern = patterns[Math.floor(r(1) * patterns.length)] ?? "burst-checker";
  if (communication.notifications === "priority") {
    pattern = communication.messageStyle === "bursty" || pattern === "rare-checker" || pattern === "evening-only" ? "phone-attached" : pattern;
  } else if (communication.notifications === "muted") {
    pattern = pattern === "phone-attached" ? "burst-checker" : pattern === "phone-attached-night" ? "evening-only" : pattern;
  }

  const sleepFrom = cfg.sleepFrom ?? 23;
  const sleepTo = cfg.sleepTo ?? 8;
  const baseNightWakeChance = cfg.nightWakeChance ?? 0.05;
  const nightWakeChance = communication.notifications === "priority"
    ? Math.min(0.35, baseNightWakeChance + 0.05)
    : communication.notifications === "muted"
      ? Math.max(0, baseNightWakeChance * 0.4)
      : baseNightWakeChance;

  let checkEveryMin =
    pattern === "phone-attached" ? 3 + Math.floor(r(4) * 5) :
    pattern === "burst-checker" ? 15 + Math.floor(r(4) * 20) :
    pattern === "rare-checker" ? 60 + Math.floor(r(4) * 60) :
    pattern === "evening-only" ? 45 + Math.floor(r(4) * 30) :
    10 + Math.floor(r(4) * 15);

  let onlineWindowMin =
    pattern === "phone-attached" ? 30 + Math.floor(r(5) * 60) :
    pattern === "burst-checker" ? 2 + Math.floor(r(5) * 4) :
    pattern === "rare-checker" ? 5 + Math.floor(r(5) * 10) :
    pattern === "evening-only" ? 60 + Math.floor(r(5) * 90) :
    20 + Math.floor(r(5) * 40);

  let offlineReplyChance =
    pattern === "phone-attached" ? 0.85 :
    pattern === "burst-checker" ? 0.5 :
    pattern === "rare-checker" ? 0.25 :
    pattern === "evening-only" ? 0.3 :
    0.55;

  if (communication.notifications === "priority") {
    checkEveryMin = Math.max(2, Math.round(checkEveryMin * 0.35));
    onlineWindowMin = Math.round(onlineWindowMin * 1.35);
    offlineReplyChance = Math.max(offlineReplyChance, communication.initiative === "high" ? 0.95 : 0.85);
  } else if (communication.notifications === "muted") {
    checkEveryMin = Math.round(checkEveryMin * 1.5);
    onlineWindowMin = Math.max(1, Math.round(onlineWindowMin * 0.65));
    offlineReplyChance = Math.min(offlineReplyChance, 0.25);
  }

  if (["convinced", "first-date-done", "dating-early", "dating-stable", "long-term"].includes(cfg.stage)) {
    offlineReplyChance = Math.min(0.98, offlineReplyChance + 0.12);
    checkEveryMin = Math.max(2, Math.round(checkEveryMin * 0.8));
  } else if (cfg.stage === "met-irl-got-tg") {
    offlineReplyChance = Math.min(0.9, offlineReplyChance + 0.08);
  }

  return { pattern, sleepFrom, sleepTo, checkEveryMin, onlineWindowMin, offlineReplyChance, nightWakeChance };
}

export interface PresenceState {
  /** Прямо сейчас она "онлайн в тг" с точки зрения симуляции */
  online: boolean;
  /** Спит ли */
  asleep: boolean;
  /** Проснулась ли ночью (forced или по шансу) — влияет на стиль ответа */
  nightAwake: boolean;
  /** Через сколько секунд она в следующий раз зайдёт в тг (если оффлайн) */
  nextCheckSec: number;
  /** Локальный час по её tz */
  localHour: number;
  /** Текстовое описание для prompt */
  hint: string;
  busy?: { label: string; until: string; checkAfterMin: number };
  notificationSeen: boolean;
}

function isHourInRange(h: number, from: number, to: number): boolean {
  if (from === to) return false;
  if (from < to) return h >= from && h < to;
  return h >= from || h < to;
}

function minutesUntil(hour: number, minute: number, targetHour: number, targetMinute: number): number {
  const now = hour * 60 + minute;
  const target = targetHour * 60 + targetMinute;
  return target > now ? target - now : target + 1440 - now;
}

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function localParts(tz: string): { hour: number; minute: number; weekday: Weekday } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = fmt.formatToParts(new Date());
    const rawHour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
    const weekdayRaw = (parts.find(p => p.type === "weekday")?.value ?? "Mon").toLowerCase().slice(0, 3);
    const map: Record<string, Weekday> = { mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" };
    return { hour: rawHour % 24, minute, weekday: map[weekdayRaw] ?? "mon" };
  } catch {
    const d = new Date();
    return { hour: d.getHours(), minute: d.getMinutes(), weekday: WEEKDAYS[(d.getDay() + 6) % 7] ?? "mon" };
  }
}

function parseTime(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function previousWeekday(day: Weekday): Weekday {
  const idx = WEEKDAYS.indexOf(day);
  return WEEKDAYS[(idx + 6) % 7] ?? "mon";
}

function dayAllowed(slot: BusySlot, day: Weekday): boolean {
  return !slot.days?.length || slot.days.includes(day);
}

function activeBusySlot(slots: BusySlot[] | undefined, day: Weekday, minuteOfDay: number): { slot: BusySlot; remainingMin: number; until: string } | null {
  for (const slot of slots ?? []) {
    const from = parseTime(slot.from);
    const to = parseTime(slot.to);
    if (from == null || to == null || from === to) continue;
    if (from < to) {
      if (dayAllowed(slot, day) && minuteOfDay >= from && minuteOfDay < to) {
        return { slot, remainingMin: to - minuteOfDay, until: slot.to };
      }
      continue;
    }
    if (dayAllowed(slot, day) && minuteOfDay >= from) {
      return { slot, remainingMin: 1440 - minuteOfDay + to, until: slot.to };
    }
    if (dayAllowed(slot, previousWeekday(day)) && minuteOfDay < to) {
      return { slot, remainingMin: to - minuteOfDay, until: slot.to };
    }
  }
  return null;
}

function randomCheckAfter(slot: BusySlot): number {
  const [lo, hi] = slot.checkAfterMin ?? [5, 15];
  const min = Math.max(1, Math.min(lo, hi));
  const max = Math.max(min, Math.max(lo, hi));
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Решает, нужно ли предупредить собеседника об уходе при переходе в busy-слот
 * посреди активного диалога. Возвращает hint-строку или null если молча уходит.
 */
function busyTransitionHint(
  stage: StageId,
  comm: CommunicationProfile,
  remainingMin: number,
  checkAfterMin: number,
  recentExchangeCount: number
): string | null {
  // --- базовая вероятность по стадии отношений ---
  const stageChance: Record<StageId, number> = {
    "met-irl-got-tg": 0.05,
    "tg-given-cold": 0.08,
    "tg-given-warming": 0.18,
    "convinced": 0.40,
    "first-date-done": 0.55,
    "dating-early": 0.70,
    "dating-stable": 0.80,
    "long-term": 0.75,
    "dumped": 0.0
  };
  let chance = stageChance[stage] ?? 0.3;

  // --- модификатор от стиля общения ---
  if (comm.initiative === "high") chance += 0.15;
  else if (comm.initiative === "low") chance -= 0.15;

  if (comm.notifications === "priority") chance += 0.10;
  else if (comm.notifications === "muted") chance -= 0.10;

  if (comm.lifeSharing === "high") chance += 0.05;

  // --- модификатор от продолжительности занятости ---
  if (remainingMin <= 10) chance -= 0.20;
  else if (remainingMin <= 20) chance -= 0.05;
  else if (remainingMin >= 90) chance += 0.15;
  else if (remainingMin >= 45) chance += 0.08;

  // --- модификатор от серьёзности занятости ---
  if (checkAfterMin >= 30) chance += 0.15;
  else if (checkAfterMin >= 15) chance += 0.05;
  else if (checkAfterMin <= 8) chance -= 0.10;

  // --- модификатор от интенсивности диалога ---
  if (recentExchangeCount >= 6) chance += 0.10;
  else if (recentExchangeCount >= 4) chance += 0.05;

  chance = Math.max(0, Math.min(1, chance));
  if (Math.random() >= chance) return null;

  // --- стиль предупреждения зависит от стадии и персоны ---
  const isClose = ["dating-early", "dating-stable", "long-term"].includes(stage);
  const isWarm = comm.initiative === "high" || comm.lifeSharing === "high";
  const isCold = comm.initiative === "low" && comm.messageStyle === "one-liners";

  if (isCold) {
    return `ПЕРЕХОД В ЗАНЯТОСТЬ: у вас был активный диалог, но начинается ${remainingMin > 30 ? "долгое" : "короткое"} дело. Предупреди КРАТКО и сухо, в своём стиле — одно-два слова ("ушла", "потом", "занята"). Не объясняй подробно.`;
  }
  if (isClose && isWarm) {
    return `ПЕРЕХОД В ЗАНЯТОСТЬ: у вас был активный диалог, но начинается занятие. Предупреди его тепло и естественно, в стиле вашей близости (например: "малыш мне надо бежать на ${remainingMin > 45 ? "пару часов" : "немного"}, потом напишу" или "я по делам, скучай"). Стиль зависит от persona.`;
  }
  if (isClose) {
    return `ПЕРЕХОД В ЗАНЯТОСТЬ: у вас был активный диалог, но начинается занятие. Предупреди естественно (например: "мне надо отойти, позже напишу" или "я занята буду ${remainingMin > 45 ? "пару часов" : "немного"}, потом отвечу").`;
  }
  return `ПЕРЕХОД В ЗАНЯТОСТЬ: у вас был активный диалог, но начинается дело. Можешь коротко предупредить об уходе (например: "я побежала, потом отвечу" или "мне пора, позже"). Стиль зависит от уровня ваших отношений и persona.`;
}

export function computePresenceState(
  cfg: ProfileConfig,
  profile: PresenceProfile,
  lastUserMsgTs: number,
  lastHerReplyTs: number,
  recentExchangeCount: number,
  forcedWake = false,
  conflict: ConflictState | null = null
): PresenceState {
  const local = localParts(cfg.tz);
  const communication = normalizeCommunicationProfile(cfg);
  const localHour = local.hour;
  const localMinute = local.minute;
  const minuteOfDay = localHour * 60 + localMinute;

  const asleep = isHourInRange(localHour, profile.sleepFrom, profile.sleepTo);
  const busySlot = asleep ? null : activeBusySlot(cfg.busySchedule, local.weekday, minuteOfDay);

  // Проверка cold-периода конфликта
  const conflictCold = conflict && conflict.coldUntil ? new Date(conflict.coldUntil).getTime() > Date.now() : false;

  // Ночное пробуждение: forced или случайное по шансу (forced работает всегда, случайный только если asleep)
  const nightAwake = forcedWake || (asleep && Math.random() < profile.nightWakeChance);

  // Активный диалог: за последние 30 мин было >=3 обмена и последняя её реплика свежая
  const now = Date.now();
  const inActiveDialog = recentExchangeCount >= 3
    && lastHerReplyTs > 0
    && now - lastHerReplyTs < 15 * 60 * 1000
    && now - lastUserMsgTs < 5 * 60 * 1000;

  let online: boolean;
  let nextCheckSec = 0;
  let busy: PresenceState["busy"] | undefined;
  let notificationSeen = false;

  // Если cold-период конфликта активен — она не онлайн
  if (conflictCold && !forcedWake) {
    online = false;
    const remainingMs = new Date(conflict!.coldUntil!).getTime() - now;
    nextCheckSec = Math.max(60, Math.floor(remainingMs / 1000));
  } else if (asleep && !nightAwake) {
    online = false;
    // следующий чек = до утра + случайные 0-30 мин
    let hoursToWake = profile.sleepTo - localHour;
    if (hoursToWake < 0) hoursToWake += 24;
    // если проснулась прямо сейчас (sleepTo == localHour), чек через ~30 мин
    if (hoursToWake === 0) hoursToWake = 0.5;
    nextCheckSec = Math.floor(hoursToWake * 3600) + Math.floor(Math.random() * 1800);
  } else if (busySlot && !forcedWake) {
    const busyMul = communication.notifications === "priority" ? 0.45 : communication.notifications === "muted" ? 1.25 : 1;
    const activeDialogMul = inActiveDialog ? 0.35 : 1;
    const [rawMinCheck, rawMaxCheck] = busySlot.slot.checkAfterMin ?? [5, 15];
    const minCheck = Math.max(1, Math.round(rawMinCheck * busyMul * activeDialogMul));
    const maxCheck = Math.max(minCheck, Math.round(rawMaxCheck * busyMul * activeDialogMul));
    if (maxCheck <= 5) {
      // Скучное занятие — мини-заходы в Telegram каждые 1-5 минут на 30-90 секунд
      const cycleMin = Math.max(1, Math.round((minCheck + maxCheck) / 2));
      const minuteOfCycle = minuteOfDay % Math.max(1, cycleMin);
      const onlineMin = Math.max(1, Math.min(2, Math.floor(cycleMin / 2)));
      online = minuteOfCycle < onlineMin;
      if (!online) {
        nextCheckSec = (cycleMin - minuteOfCycle) * 60;
      }
      busy = { label: busySlot.slot.label, until: busySlot.until, checkAfterMin: cycleMin };
    } else {
      online = false;
      const checkAfterMin = minCheck + Math.floor(Math.random() * (maxCheck - minCheck + 1));
      const activeDialogCapMin = communication.notifications === "priority" ? 12 : 20;
      const waitMin = inActiveDialog ? Math.min(busySlot.remainingMin + checkAfterMin, activeDialogCapMin) : busySlot.remainingMin + checkAfterMin;
      nextCheckSec = waitMin * 60;
      busy = { label: busySlot.slot.label, until: busySlot.until, checkAfterMin };
    }
  } else if (forcedWake) {
    online = true;
    nextCheckSec = 0;
  } else if (inActiveDialog) {
    online = true;
    nextCheckSec = 0;
  } else {
    // Time-of-day gates for pattern-specific behavior
    const isEvening = localHour >= 18 || localHour < profile.sleepFrom;
    const isNightOwl = localHour >= 22 || localHour < 8;
    if (profile.pattern === "evening-only" && !isEvening) {
      online = false;
      const minutesToEvening = Math.max(1, minutesUntil(localHour, localMinute, 18, 0));
      const capMin = communication.notifications === "priority" ? 20 : communication.initiative === "high" ? 35 : minutesToEvening;
      nextCheckSec = Math.min(minutesToEvening, capMin) * 60 + Math.floor(Math.random() * 600);
    } else if (profile.pattern === "phone-attached-night" && !isNightOwl) {
      online = false;
      const minutesToNight = Math.max(1, minutesUntil(localHour, localMinute, 22, 0));
      const capMin = communication.notifications === "priority" ? 15 : communication.initiative === "high" ? 30 : 75;
      nextCheckSec = Math.min(minutesToNight, capMin) * 60 + Math.floor(Math.random() * 600);
    } else {
      // Использую псевдо-случайный окно: вероятность что СЕЙЧАС в окне = onlineWindow / (onlineWindow + checkEvery)
      const onlineProb = profile.onlineWindowMin / (profile.onlineWindowMin + profile.checkEveryMin);
      online = Math.random() < onlineProb;
      if (!online) {
        notificationSeen = Math.random() < profile.offlineReplyChance;
        nextCheckSec = notificationSeen
          ? 60 + Math.floor(Math.random() * 4 * 60)
          : Math.max(30, Math.floor(Math.random() * profile.checkEveryMin * 60));
      }
    }
  }

  // Хинт для prompt
  let hint: string;
  if (forcedWake) {
    hint = `FORCED WAKE — ты получила уведомление/разбудили. Отвечай, даже если обычно спишь или занята. Не упоминай что тебя "разбудили", просто отвечай как обычно.`;
  } else if (conflictCold && !forcedWake && conflict) {
    const hoursLeft = Math.ceil((new Date(conflict.coldUntil!).getTime() - now) / 3600_000);
    hint = `КОНФЛИКТ (level ${conflict.level}). Ты в режиме молчания. Осталось ~${hoursLeft}ч игнора. Отвечай очень редко, сухо: ".", "и?", "ну?", "что". Никаких смайликов, скобок ")" нет вообще. Можно вообще игнорить. Простить можешь только если ОН реально извинится по существу.`;
  } else if (asleep && !nightAwake) {
    hint = `СПИШЬ (по местному ${localHour}:00). Если отвечаешь — то заспанно, односложно, либо вообще игнорь до утра.`;
  } else if (nightAwake) {
    hint = `НОЧНОЕ ПРОБУЖДЕНИЕ (по местному ${localHour}:00). Ты проснулась посреди ночи — возможно от уведомления, возможно сама. ГОЛОВА НЕ ВАРИТ. Пишешь очень коротко, с опечатками, без заглавных, дезориентирована. Можешь снова заснуть посреди фразы — тогда обрываешь. Не ведёшь длинные разговоры. Если не хочешь — просто "спи" или "потом".`;
  } else if (busy) {
    if ((busy.checkAfterMin ?? 15) <= 5) {
      hint = `На ${busy.label} (до ${busy.until}), но скучно — периодически заходишь в Telegram между делом. Можешь быстро ответить, но можешь и пропустить момент.`;
    } else {
      hint = `Сейчас занята: ${busy.label} до ${busy.until}. Не можешь нормально отвечать. После этого зайдёшь проверить Telegram через ${busy.checkAfterMin} мин; сообщение будет прочитано и ответ будет только тогда.`;
      if (inActiveDialog && busySlot) {
        const notifyHint = busyTransitionHint(cfg.stage, communication, busySlot.remainingMin, busy.checkAfterMin ?? 15, recentExchangeCount);
        if (notifyHint) hint += "\n\n" + notifyHint;
      }
    }
  } else if (online) {
    if (inActiveDialog) {
      hint = `АКТИВНЫЙ ДИАЛОГ. Отвечаешь относительно быстро. Если резко "ушла" — ОБЯЗАТЕЛЬНО оправдание (мама зашла / в туалет / еду / котик прыгнул на колени). Внезапно "вышла из сети" без причин — это палево, не делай так.`;
    } else {
      hint = `Сейчас в сети, но не залипала — просто заглянула в тг. Можешь зайти в диалог сразу или через 1-2 мин.`;
    }
  } else {
    hint = notificationSeen
      ? `Сейчас НЕ в сети, но уведомление увидела. Зайдёшь в Telegram через ~${Math.round(nextCheckSec / 60)} мин и тогда ответишь, если захочешь.`
      : `Сейчас НЕ в сети (паттерн: ${profile.pattern}). Уведомление не заметила; прочитаешь это через ~${Math.round(nextCheckSec / 60)} мин когда сама заглянешь в тг. Это нормально, реальные люди не сидят в тг 24/7.`;
  }
  if (!conflictCold && !asleep && communication.notifications === "priority") {
    hint += ` Уведомления от него у тебя важные, поэтому в активной переписке не пропадай рандомно.`;
  }

  return { online, asleep, nightAwake, nextCheckSec, localHour, hint, busy, notificationSeen };
}
