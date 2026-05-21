/**
 * Юнит-тесты пресета manager-tone (Task 3.3 manager-mode).
 */
import { describe, it, expect } from "vitest";
import type { Tier, Tone } from "../../types.js";
import {
  MANAGER_TONE_PRESETS,
  findManagerTone,
  resolveTone
} from "../../presets/manager-tone.js";

const ALL_TONES: Tone[] = ["formal-вы", "friendly-ты", "mixed-by-tier"];

describe("manager-tone preset", () => {
  it("содержит ровно 3 пресета", () => {
    expect(MANAGER_TONE_PRESETS.map(p => p.id)).toEqual(ALL_TONES);
  });

  it("findManagerTone возвращает корректный пресет для каждого Tone", () => {
    for (const id of ALL_TONES) {
      expect(findManagerTone(id).id).toBe(id);
    }
  });

  it("findManagerTone бросает на неизвестном id", () => {
    expect(() => findManagerTone("unknown" as Tone)).toThrow();
  });

  it("formal-вы всегда возвращает «вы» независимо от тира", () => {
    const tiers: Tier[] = ["cold-stranger", "introduced", "regular", "trusted-partner", "vip", "blocked"];
    for (const t of tiers) {
      expect(resolveTone("formal-вы", t)).toBe("вы");
    }
  });

  it("friendly-ты всегда возвращает «ты» независимо от тира", () => {
    const tiers: Tier[] = ["cold-stranger", "introduced", "regular", "trusted-partner", "vip", "blocked"];
    for (const t of tiers) {
      expect(resolveTone("friendly-ты", t)).toBe("ты");
    }
  });

  it("mixed-by-tier: cold-stranger/introduced/blocked → «вы»", () => {
    expect(resolveTone("mixed-by-tier", "cold-stranger")).toBe("вы");
    expect(resolveTone("mixed-by-tier", "introduced")).toBe("вы");
    expect(resolveTone("mixed-by-tier", "blocked")).toBe("вы");
  });

  it("mixed-by-tier: regular/trusted-partner/vip → «ты»", () => {
    expect(resolveTone("mixed-by-tier", "regular")).toBe("ты");
    expect(resolveTone("mixed-by-tier", "trusted-partner")).toBe("ты");
    expect(resolveTone("mixed-by-tier", "vip")).toBe("ты");
  });

  it("отсутствующий tone fallback-ит на «вы» (защитная семантика)", () => {
    expect(resolveTone(undefined, "regular")).toBe("вы");
  });
});
