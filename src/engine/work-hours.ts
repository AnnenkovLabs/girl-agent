/**
 * Work-hours helper для manager-mode (Task 4.2 manager-mode tasks.md).
 *
 * Вычисляет, находится ли текущий момент времени в нерабочих часах профиля
 * (Requirement 8.3). «Нерабочие часы» = объединение интервалов из
 * `cfg.busySchedule` (переинтерпретированы как work meetings) с интервалом
 * `[sleepFrom, sleepTo)` в часовом поясе `cfg.tz`.
 *
 * Используется в `engine/after-hours.ts` (задача 4.9) и Boss_Reply flow.
 */

import type { ProfileConfig, BusySlot, Weekday } from "../types.js";

const WEEKDAY_BY_INDEX: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Возвращает `true` если `now` (по умолчанию — текущее время) попадает в
 * нерабочее окно профиля. Учитывает `cfg.tz`. Для невалидных значений
 * `sleepFrom`/`sleepTo` (NaN или вне 0..23) поведение sleep-окна
 * нейтрализуется (false).
 */
export function isOutOfHours(cfg: ProfileConfig, now: Date = new Date()): boolean {
  // Sleep window — простая проверка по локальному часу.
  if (isInSleepWindow(cfg, now)) return true;

  // Busy schedule — проверка с учётом дня недели.
  for (const slot of cfg.busySchedule ?? []) {
    if (isInBusySlot(slot, cfg.tz, now)) return true;
  }
  return false;
}

/** Чисто sleep-часть (без busy). Полезно для тестов и для отдельных решений. */
export function isInSleepWindow(cfg: ProfileConfig, now: Date = new Date()): boolean {
  const sleepFrom = Math.floor(cfg.sleepFrom);
  const sleepTo = Math.floor(cfg.sleepTo);
  if (
    !Number.isFinite(sleepFrom) ||
    !Number.isFinite(sleepTo) ||
    sleepFrom < 0 ||
    sleepFrom > 23 ||
    sleepTo < 0 ||
    sleepTo > 23 ||
    sleepFrom === sleepTo
  ) {
    return false;
  }

  const localHour = hourInTz(now, cfg.tz);
  if (sleepFrom < sleepTo) {
    // Окно не пересекает полночь, например 1 → 7.
    return localHour >= sleepFrom && localHour < sleepTo;
  }
  // Окно через полночь, например 23 → 8.
  return localHour >= sleepFrom || localHour < sleepTo;
}

/** Проверка одного `BusySlot` с учётом `days[]` и интервала `from..to`. */
export function isInBusySlot(slot: BusySlot, tz: string, now: Date = new Date()): boolean {
  const [fromH, fromM] = parseHHMM(slot.from);
  const [toH, toM] = parseHHMM(slot.to);
  if (fromH === null || toH === null) return false;
  const localHour = hourInTz(now, tz);
  const localMin = minuteInTz(now, tz);
  const localWday = weekdayInTz(now, tz);

  if (slot.days && slot.days.length > 0 && !slot.days.includes(localWday)) return false;

  const cur = localHour * 60 + localMin;
  const start = fromH * 60 + (fromM ?? 0);
  const end = toH * 60 + (toM ?? 0);

  if (start === end) return false;
  if (start < end) {
    return cur >= start && cur < end;
  }
  // Окно через полночь.
  return cur >= start || cur < end;
}

function parseHHMM(s: string): [number, number] | [null, null] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return [null, null];
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return [null, null];
  }
  return [h, min];
}

function hourInTz(now: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", hour12: false });
    return Number(fmt.format(now));
  } catch {
    return now.getHours();
  }
}

function minuteInTz(now: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, minute: "2-digit" });
    return Number(fmt.format(now));
  } catch {
    return now.getMinutes();
  }
}

function weekdayInTz(now: Date, tz: string): Weekday {
  try {
    // Intl выдаёт длинное имя; короче считать через число.
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const short = fmt.format(now).toLowerCase().slice(0, 3); // "sun", "mon", ...
    if (isWeekday(short)) return short;
  } catch {
    /* fall through */
  }
  return WEEKDAY_BY_INDEX[now.getDay()] ?? "mon";
}

function isWeekday(s: string): s is Weekday {
  return WEEKDAY_BY_INDEX.includes(s as Weekday);
}
