/**
 * Юнит-тесты пресета persona-style (Task 3.3 manager-mode).
 */
import { describe, it, expect } from "vitest";
import type { PersonaStyle } from "../../types.js";
import {
  PERSONA_STYLE_PRESETS,
  findPersonaStyle
} from "../../presets/persona-style.js";

const ALL_STYLES: PersonaStyle[] = [
  "gender-neutral-assistant",
  "female-secretary",
  "male-secretary"
];

describe("persona-style preset", () => {
  it("содержит ровно 3 пресета в задокументированном порядке", () => {
    expect(PERSONA_STYLE_PRESETS.map(p => p.id)).toEqual(ALL_STYLES);
  });

  it("findPersonaStyle возвращает корректный пресет для каждого PersonaStyle", () => {
    for (const id of ALL_STYLES) {
      expect(findPersonaStyle(id).id).toBe(id);
    }
  });

  it("findPersonaStyle бросает на неизвестном id", () => {
    expect(() => findPersonaStyle("unknown" as PersonaStyle)).toThrow();
  });

  it("каждый пресет содержит непустой promptFragment", () => {
    for (const p of PERSONA_STYLE_PRESETS) {
      expect(p.promptFragment.length).toBeGreaterThan(20);
    }
  });
});
