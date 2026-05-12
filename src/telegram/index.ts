import type { ProfileConfig } from "../types.js";

export interface IncomingMessage {
  text: string;
  fromId: number;
  chatId: number | string;
  messageId: number;
  isPrivate: boolean;
  fromName?: string;
  media?: IncomingMedia;
  /**
   * Если сообщение — это реакция-эмодзи юзера на её сообщение (Issue #76).
   * `text` в этом случае пустой, вместо этого заполнен emojiReaction.
   */
  emojiReaction?: {
    /** Эмодзи реакции (один символ или emoji-sequence). */
    emoji: string;
    /** ID сообщения, на которое поставили реакцию (её сообщение). */
    targetMessageId: number;
    /** При снятии реакции — true. */
    removed?: boolean;
  };
  /**
   * Если сообщение — это уведомление об удалении сообщения юзером (Task #15).
   * `text` пустой; в deletion.text — исходный текст из истории.
   */
  deletion?: {
    /** ID удалённого сообщения. */
    messageId: number;
    /** Исходный текст (если был в истории). */
    text: string;
    /** Как давно было исходное сообщение (в секундах на момент удаления). */
    ageSec: number;
  };
}

export type IncomingMediaKind = "photo" | "video" | "voice" | "video_note" | "sticker" | "document";

export interface IncomingMedia {
  kind: IncomingMediaKind;
  caption?: string;
  mimeType?: string;
  base64?: string;
  fileId?: string;
  emoji?: string;
}

export interface TgAdapter {
  start(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void>;
  sendText(chatId: number | string, text: string): Promise<number | undefined>;
  setTyping(chatId: number | string, on: boolean): Promise<void>;
  /** Реакция на сообщение. Эмодзи 1 символ. Тихий no-op если не поддерживается. */
  setReaction(chatId: number | string, messageId: number, emoji: string): Promise<void>;
  /** Отредактировать ранее отправленное сообщение (Task #1). Тихий no-op если не поддерживается. */
  editText?(chatId: number | string, messageId: number, newText: string): Promise<void>;
  /**
   * Issue #81 — пинг статуса «онлайн» в Telegram без отправки сообщения.
   * Для юзербота вызывает account.UpdateStatus, для bot-режима тихий no-op
   * (у ботов нет last seen).
   */
  updateOnlineStatus?(online: boolean): Promise<void>;
  blockContact?(chatId: number | string): Promise<void>;
  unblockContact?(chatId: number | string): Promise<void>;
  readHistory?(chatId: number | string): Promise<void>;
  reportSpam?(chatId: number | string): Promise<void>;
  sendSticker?(chatId: number | string, fileId: string): Promise<void>;
  deleteMessages?(chatId: number | string, messageIds: number[], revoke?: boolean): Promise<void>;
  /** Возвращает информацию о самом боте/юзерботе: username и отображаемое имя в ТГ. */
  getSelf?(): { username?: string; displayName?: string };
  stop(): Promise<void>;
}

export async function makeTgAdapter(cfg: ProfileConfig): Promise<TgAdapter> {
  if (cfg.mode === "bot") {
    const mod = await import("./bot.js");
    return mod.makeBotAdapter(cfg);
  }
  const mod = await import("./userbot.js");
  return mod.makeUserbotAdapter(cfg);
}
