/**
 * Умная автоматическая смена стадий отношений.
 *
 * Цель: повысить стадию когда score сигналит о тёплом, длительном контакте,
 * и понизить (или отшить) когда score уходит в минус и в логах долго нет
 * признаков восстановления.
 *
 * Решение НЕ рандомное:
 *  - есть пороги по score (interest/trust/attraction/annoyance)
 *  - есть требование "минимум N сообщений с момента входа в стадию"
 *    (чтобы не прыгало между стадиями за один тик)
 *  - есть бан-листы: например, никогда не повышаем со стадии "dumped"
 *    автоматически
 *  - есть приоритет понижения: если очень плохо — сначала понизить, иначе
 *    проверяем повышение
 *
 * Возвращает следующую stage или null, если не нужно менять.
 */

import type { RelationshipScore, StageId } from "../types.js";

export interface StageTransitionContext {
  currentStage: StageId;
  score: RelationshipScore;
  /** Сколько сообщений ОТ НЕЁ за время этой стадии. */
  herMessagesInStage: number;
  /** Сколько сообщений ОТ НЕГО за время этой стадии. */
  hisMessagesInStage: number;
  /** Сколько раз она проигнорила его за стадию (чтобы не повышать «через игнор»). */
  ignoresInStage: number;
  /** Опционально — есть ли активный конфликт. */
  hasActiveConflict?: boolean;
}

export interface StageTransitionResult {
  next: StageId;
  reason: string;
  direction: "up" | "down";
}

const STAGE_ORDER: StageId[] = [
  "met-irl-got-tg",
  "tg-given-cold",
  "tg-given-warming",
  "convinced",
  "first-date-done",
  "dating-early",
  "dating-stable",
  "long-term"
];

function stageIndex(id: StageId): number {
  return STAGE_ORDER.indexOf(id);
}

/**
 * Решает, нужно ли передвинуть стадию.
 *
 * Возвращает null если стадия должна остаться той же.
 */
export function decideStageTransition(ctx: StageTransitionContext): StageTransitionResult | null {
  // "dumped" — терминальная стадия, автоматически из неё не выходим
  // (только через :reset или специальную логику в runtime).
  if (ctx.currentStage === "dumped") return null;

  const { score } = ctx;
  const idx = stageIndex(ctx.currentStage);
  if (idx < 0) return null;

  // === Сначала проверяем ПОНИЖЕНИЕ (downgrade) ===
  // Уход в "dumped" — runtime обрабатывает отдельно (там auto-dumped по
  // экстремальному annoyance). Тут — мягкое понижение.
  const wantsDowngrade = wantsDowngradeFor(ctx);
  if (wantsDowngrade && idx > 0) {
    const next = STAGE_ORDER[idx - 1]!;
    return {
      next,
      reason: wantsDowngrade,
      direction: "down"
    };
  }

  // === Затем UPGRADE ===
  // Не повышаем во время активного конфликта.
  if (ctx.hasActiveConflict) return null;

  const wantsUpgrade = wantsUpgradeFor(ctx);
  if (wantsUpgrade && idx < STAGE_ORDER.length - 1) {
    const next = STAGE_ORDER[idx + 1]!;
    return {
      next,
      reason: wantsUpgrade,
      direction: "up"
    };
  }

  return null;
}

function wantsDowngradeFor(ctx: StageTransitionContext): string | null {
  const { score, currentStage, herMessagesInStage, ignoresInStage } = ctx;

  // Условие: annoyance высокий, interest/trust сильно просели — и за стадию
  // прошло достаточно времени чтобы такое утвердилось (>= 8 её сообщений).
  if (
    score.annoyance >= 60 &&
    score.interest <= -10 &&
    score.trust <= 10 &&
    herMessagesInStage >= 8
  ) {
    return `annoyance ${score.annoyance}, interest ${score.interest}, trust ${score.trust} — отношения регрессируют`;
  }

  // Если она ВСЁ ВРЕМЯ игнорит на тёплой стадии — это тоже признак деградации.
  if (
    ["convinced", "first-date-done", "dating-early", "dating-stable", "long-term"].includes(currentStage) &&
    ignoresInStage >= 12 &&
    ignoresInStage >= ctx.hisMessagesInStage * 0.7 &&
    score.interest < 20
  ) {
    return `${ignoresInStage} игноров за стадию из ${ctx.hisMessagesInStage} его сообщений — теряет интерес`;
  }

  return null;
}

function wantsUpgradeFor(ctx: StageTransitionContext): string | null {
  const { score, currentStage, herMessagesInStage } = ctx;
  // Минимум сообщений от неё, прежде чем повысить стадию: 6.
  // Это даёт LLM время поработать на стадии, а не «прыгать» при 1 хорошем
  // сообщении.
  const MIN_HER = 6;
  if (herMessagesInStage < MIN_HER) return null;

  // Для разных стадий — разные пороги (требования становятся выше с уровнем).
  switch (currentStage) {
    case "met-irl-got-tg": {
      // Только что встретились → начала отвечать тепло.
      if (score.interest >= 30 && score.attraction >= 20 && score.annoyance < 20) {
        return `interest ${score.interest}, attraction ${score.attraction} — оттаяла`;
      }
      // Если игнорит и интерес не растёт — должен спуститься в "tg-given-cold"
      // (но это понижение, его обработает downgrade).
      return null;
    }
    case "tg-given-cold": {
      if (score.interest >= 25 && score.trust >= 10 && score.annoyance < 25) {
        return `interest ${score.interest}, trust ${score.trust} — стала отвечать осторожно`;
      }
      return null;
    }
    case "tg-given-warming": {
      if (score.interest >= 40 && score.trust >= 25 && score.attraction >= 30 && score.annoyance < 20) {
        return `interest ${score.interest}, trust ${score.trust}, attraction ${score.attraction} — стабильно общается`;
      }
      return null;
    }
    case "convinced": {
      // Здесь нужно как минимум 10 её сообщений, чтобы решить что было
      // свидание / договорённость о нём.
      if (herMessagesInStage >= 10 && score.attraction >= 50 && score.trust >= 35 && score.interest >= 50) {
        return `attraction ${score.attraction}, trust ${score.trust} — пошли на первое свидание`;
      }
      return null;
    }
    case "first-date-done": {
      if (herMessagesInStage >= 12 && score.attraction >= 65 && score.trust >= 50 && score.interest >= 60) {
        return `attraction ${score.attraction}, trust ${score.trust} — отношения завязались`;
      }
      return null;
    }
    case "dating-early": {
      if (herMessagesInStage >= 25 && score.trust >= 70 && score.attraction >= 65 && score.annoyance < 15) {
        return `trust ${score.trust}, attraction ${score.attraction}, ${herMessagesInStage} сообщений — стабильная пара`;
      }
      return null;
    }
    case "dating-stable": {
      if (herMessagesInStage >= 60 && score.trust >= 80 && score.interest >= 55) {
        return `trust ${score.trust}, ${herMessagesInStage} сообщений — давно вместе`;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Хелпер: подсчёт сообщений в стадии можно делать через trackers, но базово —
 * по relationship.md / log. Эту функцию рантайм может вызывать раз в N тиков.
 */
export function shouldRunStageTransitionCheck(messagesSinceLastCheck: number): boolean {
  // Проверка не на каждое сообщение — раз в 5.
  return messagesSinceLastCheck > 0 && messagesSinceLastCheck % 5 === 0;
}
