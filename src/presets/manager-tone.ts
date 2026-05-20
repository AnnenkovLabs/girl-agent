/**
 * Manager-mode communication tones (см. Requirement 12 и design.md § 3.3).
 *
 * Три значения `Tone`:
 *  - `formal-вы` — деловое «вы» во всех ответах.
 *  - `friendly-ты` — мягкое «ты» во всех ответах.
 *  - `mixed-by-tier` — «вы» для холодных тиров, «ты» для тёплых; решает
 *    `resolveTone(profile, contactTier)`.
 *
 * Для каждого тона хранится промпт-фрагмент на русском, который встраивается
 * в system-prompt LLM в задаче 4.11.
 */

import type { Tone, Tier } from "../types.js";

export interface ManagerTonePreset {
  id: Tone;
  label: string;
  description: string;
  /** Готовый промпт-фрагмент для system prompt (без обрамляющего "## Тон"). */
  promptFragment: string;
}

export const MANAGER_TONE_PRESETS: ManagerTonePreset[] = [
  {
    id: "formal-вы",
    label: "Деловой «вы»",
    description: "Полностью формальный тон, обращение «вы» с маленькой буквы во всех сообщениях.",
    promptFragment: [
      "Тон: деловой «вы». Обращайся к собеседнику на «вы» (с маленькой буквы),",
      "формы глаголов согласовываются («вы говорили», «подскажите»). Не переходи на «ты»,",
      "даже если собеседник пишет первым неформально. Без сленга, без эмодзи в тексте."
    ].join(" ")
  },
  {
    id: "friendly-ты",
    label: "Дружеский «ты»",
    description: "Тёплое «ты» во всех сообщениях, при этом без панибратства.",
    promptFragment: [
      "Тон: дружеский «ты». Обращайся к собеседнику на «ты», но без панибратства",
      "и подчёркнуто-личных вопросов. Можно мягкие маркеры расположенности",
      "(«ок», «ага», «понял»), но без сленга и эмодзи в тексте."
    ].join(" ")
  },
  {
    id: "mixed-by-tier",
    label: "Смешанный по тиру",
    description: "Холодные тиры — «вы», тёплые — «ты». Конкретный выбор делает resolveTone(profile, tier).",
    promptFragment: [
      "Тон: смешанный, выбирается по уровню доверия контакта.",
      "Для cold-stranger / introduced / blocked используй «вы» (без перехода).",
      "Для regular / trusted-partner / vip — «ты» без панибратства.",
      "Если в одном диалоге уровень меняется, тон меняется со следующего ответа."
    ].join(" ")
  }
];

const PRESET_BY_ID = new Map<Tone, ManagerTonePreset>(
  MANAGER_TONE_PRESETS.map(p => [p.id, p])
);

/** Возвращает пресет по id. Бросает на неизвестных значениях. */
export function findManagerTone(id: Tone): ManagerTonePreset {
  const p = PRESET_BY_ID.get(id);
  if (!p) throw new Error(`unknown manager tone: ${id}`);
  return p;
}

/**
 * Резолвит конкретное обращение для данного тона профиля и тира контакта.
 *
 * Для `formal-вы` всегда возвращает `вы`, для `friendly-ты` — `ты`. Для
 * `mixed-by-tier` использует таблицу: `cold-stranger`/`introduced`/`blocked`
 * → `вы`, остальные → `ты`. Если `profileTone` некорректен — fallback на `вы`.
 */
export function resolveTone(profileTone: Tone | undefined, contactTier: Tier): "вы" | "ты" {
  if (profileTone === "formal-вы") return "вы";
  if (profileTone === "friendly-ты") return "ты";
  if (profileTone === "mixed-by-tier") {
    if (contactTier === "cold-stranger" || contactTier === "introduced" || contactTier === "blocked") {
      return "вы";
    }
    return "ты";
  }
  return "вы";
}
