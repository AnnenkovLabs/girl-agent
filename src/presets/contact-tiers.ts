/**
 * Manager-mode contact tiers (см. .kiro/specs/manager-mode/design.md § 3.1
 * и requirement 2.1).
 *
 * Шесть уровней доверия контакта, упорядочены по возрастанию доверия (кроме
 * `blocked`, который стоит отдельно):
 *
 *   cold-stranger → introduced → regular → trusted-partner → vip
 *
 * `blocked` — отдельный терминальный уровень, в который и из которого
 * автопереходы запрещены (Requirement 2.5, 2.6). См. `nextTierUp`/`nextTierDown`.
 */

import type { Tier } from "../types.js";

export interface TierPreset {
  id: Tier;
  label: string;
  description: string;
  /** Базовая вероятность игнорировать сообщение (0..1). */
  ignoreChance: number;
  /** Диапазон задержки ответа в секундах [min, max]. */
  replyDelaySec: [number, number];
}

/** Линейный порядок «активных» тиров для adjacency-проверок. */
export const TIER_ORDER: Tier[] = [
  "cold-stranger",
  "introduced",
  "regular",
  "trusted-partner",
  "vip"
];

export const TIER_PRESETS: TierPreset[] = [
  {
    id: "cold-stranger",
    label: "Холодный незнакомец",
    description: "Незнакомый контакт без истории — отвечать осторожно, чаще игнор/эскалация.",
    ignoreChance: 0.55,
    replyDelaySec: [60, 600]
  },
  {
    id: "introduced",
    label: "Представился",
    description: "Контакт назвал имя/компанию или прислан по реферралу.",
    ignoreChance: 0.30,
    replyDelaySec: [30, 240]
  },
  {
    id: "regular",
    label: "Постоянный",
    description: "Регулярно общается по делу — отвечает быстрее, эскалирует только нестандартное.",
    ignoreChance: 0.15,
    replyDelaySec: [10, 120]
  },
  {
    id: "trusted-partner",
    label: "Доверенный партнёр",
    description: "Долгосрочный контрагент — отвечать оперативно, минимум эскалаций.",
    ignoreChance: 0.05,
    replyDelaySec: [5, 60]
  },
  {
    id: "vip",
    label: "VIP",
    description: "Приоритет наравне с боссом — отвечать максимально быстро, не отказывать без явного основания.",
    ignoreChance: 0.0,
    replyDelaySec: [3, 30]
  },
  {
    id: "blocked",
    label: "Заблокирован",
    description: "Игнорировать любые сообщения до явной разблокировки владельцем.",
    ignoreChance: 1.0,
    replyDelaySec: [0, 0]
  }
];

const PRESET_BY_ID = new Map<Tier, TierPreset>(TIER_PRESETS.map(p => [p.id, p]));

/** Возвращает пресет по id; никогда не возвращает undefined для валидного `Tier`. */
export function findTier(id: Tier): TierPreset {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) {
    throw new Error(`unknown tier: ${id}`);
  }
  return preset;
}

/** Индекс тира в порядке доверия. `blocked` → -1 (вне линии). */
export function tierIndex(id: Tier): number {
  if (id === "blocked") return -1;
  return TIER_ORDER.indexOf(id);
}

/**
 * Соседний тир выше по доверию. Возвращает `null` если уже на максимуме
 * либо для `blocked` (Requirement 2.6).
 */
export function nextTierUp(id: Tier): Tier | null {
  if (id === "blocked") return null;
  const idx = TIER_ORDER.indexOf(id);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1] ?? null;
}

/**
 * Соседний тир ниже по доверию. Возвращает `null` если уже на минимуме
 * либо для `blocked` (Requirement 2.6).
 */
export function nextTierDown(id: Tier): Tier | null {
  if (id === "blocked") return null;
  const idx = TIER_ORDER.indexOf(id);
  if (idx <= 0) return null;
  return TIER_ORDER[idx - 1] ?? null;
}
