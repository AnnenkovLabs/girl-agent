/**
 * Юнит-тесты пресета contact-tiers (Task 3.2 manager-mode).
 *
 * Проверяют:
 *  - 6 пресетов в фиксированном порядке.
 *  - findTier для каждого id.
 *  - adjacency: nextTierUp/Down переходят только на соседний тир.
 *  - blocked-инвариант: nextTierUp/Down(blocked) === null (Requirement 2.6).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Tier } from "../../types.js";
import {
  TIER_PRESETS,
  TIER_ORDER,
  findTier,
  nextTierUp,
  nextTierDown,
  tierIndex
} from "../../presets/contact-tiers.js";

const ALL_TIERS: Tier[] = [
  "cold-stranger",
  "introduced",
  "regular",
  "trusted-partner",
  "vip",
  "blocked"
];

describe("contact-tiers preset", () => {
  it("содержит ровно 6 пресетов в задокументированном порядке", () => {
    expect(TIER_PRESETS.map(p => p.id)).toEqual(ALL_TIERS);
  });

  it("findTier возвращает корректный пресет для каждого Tier", () => {
    for (const id of ALL_TIERS) {
      expect(findTier(id).id).toBe(id);
    }
  });

  it("findTier бросает на неизвестном id", () => {
    expect(() => findTier("unknown" as Tier)).toThrow();
  });

  it("TIER_ORDER не содержит blocked и идёт в порядке возрастания доверия", () => {
    expect(TIER_ORDER).toEqual(["cold-stranger", "introduced", "regular", "trusted-partner", "vip"]);
    expect(TIER_ORDER).not.toContain("blocked");
  });

  it("tierIndex возвращает -1 для blocked и валидный индекс для остальных", () => {
    expect(tierIndex("blocked")).toBe(-1);
    expect(tierIndex("cold-stranger")).toBe(0);
    expect(tierIndex("vip")).toBe(TIER_ORDER.length - 1);
  });

  it("nextTierUp/nextTierDown — только на соседний тир (adjacency)", () => {
    fc.assert(
      fc.property(fc.constantFrom<Tier>(...TIER_ORDER), (t) => {
        const up = nextTierUp(t);
        if (up !== null) {
          expect(tierIndex(up) - tierIndex(t)).toBe(1);
        }
        const down = nextTierDown(t);
        if (down !== null) {
          expect(tierIndex(t) - tierIndex(down)).toBe(1);
        }
        return true;
      }),
      { numRuns: 50 }
    );
  });

  it("blocked terminal: nextTierUp(blocked) === null && nextTierDown(blocked) === null", () => {
    expect(nextTierUp("blocked")).toBeNull();
    expect(nextTierDown("blocked")).toBeNull();
  });

  it("nextTierUp(vip) === null (граница максимума)", () => {
    expect(nextTierUp("vip")).toBeNull();
  });

  it("nextTierDown(cold-stranger) === null (граница минимума)", () => {
    expect(nextTierDown("cold-stranger")).toBeNull();
  });

  it("ignoreChance валидно для всех пресетов: 0..1", () => {
    for (const p of TIER_PRESETS) {
      expect(p.ignoreChance).toBeGreaterThanOrEqual(0);
      expect(p.ignoreChance).toBeLessThanOrEqual(1);
    }
  });

  it("replyDelaySec валидно для всех пресетов: min ≤ max и оба ≥ 0", () => {
    for (const p of TIER_PRESETS) {
      const [min, max] = p.replyDelaySec;
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeGreaterThanOrEqual(min);
    }
  });
});
