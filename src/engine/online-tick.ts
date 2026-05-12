// Issue #81 — периодическое появление в онлайне без сообщений для реализма.
// Реальная девушка регулярно «зависает» в тг, не общаясь — это нормально.
// Модуль решает когда юзербот должен пинговать account.UpdateStatus({offline:false}).

import type { ProfileConfig } from "../types.js";
import { computePresenceState, type PresenceProfile } from "./presence.js";

export interface OnlineHeartbeatDecision {
  /** Должна ли она сейчас выглядеть в сети. */
  online: boolean;
  /** Через сколько секунд проверить снова. */
  nextTickSec: number;
  /** Короткое описание решения для лога. */
  reason: string;
}

export interface OnlineHeartbeatInput {
  /** Сейчас в активном диалоге (она и так онлайн через отправку — heartbeat не нужен). */
  inActiveDialog: boolean;
  /** Последняя её реплика отправлена недавно (<2 мин) — гарант сетевой активности. */
  recentSendMs: number;
}

/**
 * Решает, должна ли она прямо сейчас «висеть» онлайн в Telegram.
 *
 * Логика:
 * - если активный диалог → отправка сама делает её online, heartbeat не нужен;
 * - если только что отправила сообщение (<90с) — Telegram уже считает онлайн, пропускаем;
 * - спит / в серьёзной busy-слот → офлайн;
 * - presence.online == true → одно из «случайных захождений» паттерна → пингуем;
 * - иначе ждём до next-check, чтобы потом снова попробовать.
 */
export function decideOnlineHeartbeat(
  cfg: ProfileConfig,
  profile: PresenceProfile,
  input: OnlineHeartbeatInput
): OnlineHeartbeatDecision {
  if (input.inActiveDialog) {
    return { online: false, nextTickSec: 90, reason: "active-dialog (natural online via send)" };
  }
  if (Date.now() - input.recentSendMs < 90_000) {
    return { online: false, nextTickSec: 90, reason: "recent-send (natural online)" };
  }

  // computePresenceState использует Math.random для onlineProb,
  // поэтому каждый вызов «бросает кубик» паттерна — то что нужно для heartbeat.
  const state = computePresenceState(
    cfg, profile,
    /*lastUserMsgTs=*/0,
    /*lastHerReplyTs=*/0,
    /*recentExchangeCount=*/0,
    /*forcedWake=*/false,
    /*conflict=*/null
  );

  if (state.asleep && !state.nightAwake) {
    // спит — заглядываем редко, спустя длительный таймаут
    const sec = Math.max(20 * 60, Math.min(state.nextCheckSec, 90 * 60));
    return { online: false, nextTickSec: sec, reason: "asleep" };
  }

  if (state.busy && (state.busy.checkAfterMin ?? 0) > 5) {
    // серьёзная занятость — не появляется в сети
    return { online: false, nextTickSec: Math.max(5 * 60, Math.min(state.nextCheckSec, 30 * 60)), reason: `busy: ${state.busy.label}` };
  }

  if (state.online) {
    // «висит» в тг минимум 45-150с прежде чем снова решать
    const sec = 45 + Math.floor(Math.random() * 105);
    return { online: true, nextTickSec: sec, reason: `presence-online (${profile.pattern})` };
  }

  // Не в сети — следующий tick через расчётное presence.nextCheckSec, но кэп 10 мин
  // чтобы регулярно «крутить кубик» и иногда заглядывать вне ожидаемого окна.
  const sec = Math.max(60, Math.min(state.nextCheckSec || 600, 10 * 60));
  return { online: false, nextTickSec: sec, reason: `offline (${profile.pattern})` };
}
