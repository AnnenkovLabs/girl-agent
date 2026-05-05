import type { ProfileConfig } from "../types.js";

export interface IncomingMessage {
  text: string;
  fromId: number;
  chatId: number | string;
  threadId?: number;
  messageId: number;
  isPrivate: boolean;
  chatType?: "private" | "group" | "supergroup" | "channel" | "unknown";
  fromName?: string;
  mentioned?: boolean;
  replyToSelf?: boolean;
  chatTitle?: string;
  media?: IncomingMedia;
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
  sendText(chatId: number | string, text: string, threadId?: number): Promise<number | undefined>;
  setTyping(chatId: number | string, on: boolean): Promise<void>;
  /** Реакция на сообщение. Эмодзи 1 символ. Тихий no-op если не поддерживается. */
  setReaction(chatId: number | string, messageId: number, emoji: string): Promise<void>;
  blockContact?(chatId: number | string): Promise<void>;
  unblockContact?(chatId: number | string): Promise<void>;
  readHistory?(chatId: number | string): Promise<void>;
  deleteDialogHistory?(chatId: number | string, revoke?: boolean): Promise<void>;
  reportSpam?(chatId: number | string): Promise<void>;
  sendSticker?(chatId: number | string, fileId: string): Promise<void>;
  editLastMessage?(chatId: number | string, messageId: number, text: string): Promise<void>;
  deleteMessages?(chatId: number | string, messageIds: number[], revoke?: boolean): Promise<void>;
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
