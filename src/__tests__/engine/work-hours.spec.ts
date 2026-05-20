/**
 * Тесты work-hours (Task 4.2 manager-mode).
 */
import { describe, it, expect } from "vitest";
import { isOutOfHours, isInSleepWindow, isInBusySlot } from "../../engine/work-hours.js";
import type { ProfileConfig, BusySlot } from "../../types.js";

function baseConfig(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    slug: "x",
    name: "x",
    age: 22,
    nationality: "RU",
    tz: "UTC",
    mode: "bot",
    llm: { presetId: "x", proto: "anthropic", apiKey: "k", model: "m" },
    telegram: {},
    stage: "manager-default",
    createdAt: new Date(2024, 0, 1).toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0,
    ...overrides
  };
}

describe("isInSleepWindow", () => {
  it("работает для окна без пересечения полуночи (1 → 7)", () => {
    const cfg = baseConfig({ sleepFrom: 1, sleepTo: 7 });
    // 03:00 UTC
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 1, 3, 0)))).toBe(true);
    // 09:00 UTC
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 1, 9, 0)))).toBe(false);
  });

  it("работает для окна через полночь (23 → 8)", () => {
    const cfg = baseConfig({ sleepFrom: 23, sleepTo: 8 });
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 1, 23, 30)))).toBe(true);
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 2, 4, 0)))).toBe(true);
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 2, 8, 0)))).toBe(false);
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 2, 12, 0)))).toBe(false);
  });

  it("учитывает часовой пояс (Asia/Tokyo +9)", () => {
    // sleepFrom=23, sleepTo=8 в Asia/Tokyo. UTC 14:00 = JST 23:00.
    const cfg = baseConfig({ sleepFrom: 23, sleepTo: 8, tz: "Asia/Tokyo" });
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 1, 14, 0)))).toBe(true);
    // UTC 03:00 = JST 12:00
    expect(isInSleepWindow(cfg, new Date(Date.UTC(2024, 0, 1, 3, 0)))).toBe(false);
  });

  it("возвращает false для невалидных sleepFrom/sleepTo", () => {
    const a = baseConfig({ sleepFrom: NaN, sleepTo: 8 });
    expect(isInSleepWindow(a, new Date(Date.UTC(2024, 0, 1, 3, 0)))).toBe(false);
    const b = baseConfig({ sleepFrom: 5, sleepTo: 5 });
    expect(isInSleepWindow(b, new Date(Date.UTC(2024, 0, 1, 5, 0)))).toBe(false);
  });
});

describe("isInBusySlot", () => {
  const slot: BusySlot = { label: "stand-up", from: "10:00", to: "11:30", days: ["mon", "tue"] };

  it("ловит время внутри слота", () => {
    // 2024-01-01 — понедельник.
    expect(isInBusySlot(slot, "UTC", new Date(Date.UTC(2024, 0, 1, 10, 30)))).toBe(true);
  });

  it("исключает время вне слота", () => {
    expect(isInBusySlot(slot, "UTC", new Date(Date.UTC(2024, 0, 1, 11, 30)))).toBe(false);
    expect(isInBusySlot(slot, "UTC", new Date(Date.UTC(2024, 0, 1, 12, 0)))).toBe(false);
  });

  it("исключает вне списка дней", () => {
    // 2024-01-06 — суббота.
    expect(isInBusySlot(slot, "UTC", new Date(Date.UTC(2024, 0, 6, 10, 30)))).toBe(false);
  });

  it("обрабатывает слот через полночь", () => {
    const overnight: BusySlot = { label: "ночная смена", from: "22:00", to: "06:00" };
    expect(isInBusySlot(overnight, "UTC", new Date(Date.UTC(2024, 0, 1, 23, 30)))).toBe(true);
    expect(isInBusySlot(overnight, "UTC", new Date(Date.UTC(2024, 0, 2, 5, 30)))).toBe(true);
    expect(isInBusySlot(overnight, "UTC", new Date(Date.UTC(2024, 0, 2, 6, 30)))).toBe(false);
  });
});

describe("isOutOfHours", () => {
  it("объединяет sleep и busy", () => {
    const cfg = baseConfig({
      sleepFrom: 23,
      sleepTo: 7,
      busySchedule: [{ label: "meet", from: "10:00", to: "11:00" }]
    });
    // 02:00 UTC — в sleep
    expect(isOutOfHours(cfg, new Date(Date.UTC(2024, 0, 1, 2, 0)))).toBe(true);
    // 10:30 UTC — в busy
    expect(isOutOfHours(cfg, new Date(Date.UTC(2024, 0, 1, 10, 30)))).toBe(true);
    // 13:00 UTC — рабочий час, не в busy
    expect(isOutOfHours(cfg, new Date(Date.UTC(2024, 0, 1, 13, 0)))).toBe(false);
  });

  it("пустой busySchedule не ломает результат", () => {
    const cfg = baseConfig({ sleepFrom: 1, sleepTo: 6 });
    expect(isOutOfHours(cfg, new Date(Date.UTC(2024, 0, 1, 12, 0)))).toBe(false);
  });
});
