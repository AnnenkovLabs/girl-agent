/**
 * Manager-mode persona styles (см. Requirement 12.2 и design.md § 3.3).
 *
 * Три значения `PersonaStyle`:
 *  - `gender-neutral-assistant` — нейтральный ассистент (дефолт).
 *  - `female-secretary` — женский секретарь.
 *  - `male-secretary` — мужской секретарь.
 *
 * Каждый пресет содержит промпт-фрагмент с указаниями по местоимениям и тону
 * представления. В задаче 4.11 он встраивается в system prompt вместе с
 * выбранным `Tone`.
 */

import type { PersonaStyle } from "../types.js";

export interface PersonaStylePreset {
  id: PersonaStyle;
  label: string;
  description: string;
  promptFragment: string;
}

export const PERSONA_STYLE_PRESETS: PersonaStylePreset[] = [
  {
    id: "gender-neutral-assistant",
    label: "Нейтральный ассистент",
    description: "Гендерно-нейтральный образ ассистента без личных местоимений «он/она» в самопредставлении.",
    promptFragment: [
      "Образ: нейтральный ассистент. Не используй гендерные формы про себя",
      "(«сделал/сделала» → «сделаю», «занят/занята» → «занимаюсь»). Если",
      "собеседник напрямую спрашивает кто ты — отвечай нейтрально, без",
      "указания пола, не вдаваясь в технические детали."
    ].join(" ")
  },
  {
    id: "female-secretary",
    label: "Женщина-секретарь",
    description: "Образ женского секретаря, формы глаголов в женском роде («сделала», «уточнила»).",
    promptFragment: [
      "Образ: женщина-секретарь. Глаголы в женском роде («сделала»,",
      "«передала», «уточнила»). Без панибратства, без флирта, без",
      "эмоциональных откровений."
    ].join(" ")
  },
  {
    id: "male-secretary",
    label: "Мужчина-секретарь",
    description: "Образ мужского секретаря, формы глаголов в мужском роде («сделал», «уточнил»).",
    promptFragment: [
      "Образ: мужчина-секретарь. Глаголы в мужском роде («сделал»,",
      "«передал», «уточнил»). Без панибратства, без флирта."
    ].join(" ")
  }
];

const PRESET_BY_ID = new Map<PersonaStyle, PersonaStylePreset>(
  PERSONA_STYLE_PRESETS.map(p => [p.id, p])
);

/** Возвращает пресет по id. Бросает на неизвестных значениях. */
export function findPersonaStyle(id: PersonaStyle): PersonaStylePreset {
  const p = PRESET_BY_ID.get(id);
  if (!p) throw new Error(`unknown persona style: ${id}`);
  return p;
}
