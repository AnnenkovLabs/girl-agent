/**
 * Обработка удалённых сообщений юзера (Task #15).
 *
 * Развилки (как ТЗ просит):
 *   1) "saw-and-read"     — она УЖЕ прочла исходное сообщение и оно влияет на её ответ
 *                            → реакция типа "ээ, ты куда удалил" / "поздно, я уже прочла"
 *   2) "saw-not-read"     — сообщение успело прийти, но она ещё не прочла (LLM в раздумьях)
 *                            → "ЭЭЭЭ КУДА УДАЛИЛ" (с лёгкой паникой, шутки)
 *   3) "missed"           — она вообще не заметила (давно спала / был долгий перерыв)
 *                            → молчим, как будто ничего не было
 *
 * Реакция персонажа на этот контекст определяется LLM через persona/speech;
 * этот модуль только классифицирует событие и пакует контекст.
 */

import type { ConversationTurn } from "./prompt.js";
import type { DeletionAwareness, DeletedMessageContext, ProfileConfig } from "../types.js";

export interface ClassifyOpts {
  deletedText: string;
  ageSec: number;
  lastReadByHerTs?: number;
  /** Когда было замечено сообщение в её handleIncoming (timestamp в ms). */
  receivedAtMs?: number;
  /** Текущий thinking/pending state — есть ли запланированный ответ. */
  hasPendingReply?: boolean;
  /** Активный диалог сейчас (последние 5 минут). */
  activeDialog?: boolean;
}

/**
 * Решает, какую осведомлённость о сообщении считать.
 *
 * Логика:
 *  - Если она УЖЕ ответила на это (last her reply ts > received) → "saw-and-read"
 *  - Если pending-таймер запущен и сообщение успело войти в её историю → "saw-not-read"
 *  - Если активного диалога нет и сообщение старое (>30 мин) → "missed"
 *  - По умолчанию (активный диалог, но ответа ещё не было) → "saw-not-read"
 */
export function classifyDeletionAwareness(opts: ClassifyOpts): DeletionAwareness {
  // Если сообщение старее 30 минут и не было активного диалога — "missed".
  if (opts.ageSec > 30 * 60 && !opts.activeDialog && !opts.hasPendingReply) return "missed";
  // Она уже отметила его прочитанным после получения → saw-and-read.
  if (opts.lastReadByHerTs && opts.receivedAtMs && opts.lastReadByHerTs > opts.receivedAtMs) {
    return "saw-and-read";
  }
  // Активный диалог + ещё не ответила → saw-not-read (она в типинге).
  if (opts.activeDialog || opts.hasPendingReply) return "saw-not-read";
  // Default: пакет дошёл, но не было сильного интереса — saw-not-read (мягко).
  return "saw-not-read";
}

/**
 * Решает, отвечать ли на удаление вообще (для intent="missed" — нет).
 */
export function shouldRespondToDeletion(ctx: DeletedMessageContext): boolean {
  if (ctx.awareness === "missed") return false;
  // Если удалённый текст пуст (сервис не сохранил) — её невозможно процитировать.
  // Но реагировать всё равно стоит — она же видела что что-то было.
  return true;
}

/**
 * Возвращает короткий промпт-фрагмент, который LLM получит как контекст,
 * чтобы среагировать естественно по своей persona/speech.
 */
export function buildDeletionPromptContext(cfg: ProfileConfig, ctx: DeletedMessageContext): string {
  const lines: string[] = [];
  lines.push("# СИТУАЦИЯ");
  lines.push("Он удалил сообщение в чате с тобой. Реагируй ЖИВО, как обычная девушка в тг, учитывая persona/speech/communication.");
  lines.push("");
  if (ctx.awareness === "saw-and-read") {
    lines.push(`Ты УЖЕ прочла его сообщение. Текст был: "${ctx.deletedText.slice(0, 200)}".`);
    lines.push("Реакция в духе: 'эээ ты куда удалил', 'поздно, я уже прочла', 'и че это было', — но СВОИМИ словами.");
    lines.push("Можно и проигнорить если контекст того просит / стадия холодная.");
  } else if (ctx.awareness === "saw-not-read") {
    lines.push("Ты ВИДЕЛА что пришло сообщение, но не успела его прочитать — он удалил быстро.");
    lines.push("Реакция в духе: 'ЭЭЭЭ КУДА УДАЛИЛ', 'ну блин', 'покажи что писал', — но СВОИМИ словами.");
    lines.push("На warm-стадиях интрига заводит, на cold/dumped — игнор / сухо.");
  } else {
    lines.push("Ты НЕ заметила. Не отвечай вообще.");
  }
  lines.push("");
  lines.push("Сформируй 1-2 коротких пузыря через ---, БЕЗ мета-комментариев про систему, БЕЗ объяснений про удаление как механизм.");
  return lines.join("\n");
}

/**
 * Проверяет, появлялся ли удалённый текст уже в её исторических turn'ах.
 */
export function isInHistory(hist: ConversationTurn[], deletedText: string): boolean {
  if (!deletedText) return false;
  const needle = deletedText.trim().toLowerCase();
  return hist.some(t => t.role === "user" && t.content.trim().toLowerCase().includes(needle));
}
