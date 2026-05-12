import { Bot } from "grammy";
import type { ProfileConfig } from "../types.js";
import type { IncomingMedia, IncomingMessage, TgAdapter } from "./index.js";
import { hasSpoilers, toHtmlWithSpoilers } from "./markdown.js";

export function makeBotAdapter(cfg: ProfileConfig): TgAdapter {
  const token = cfg.telegram.botToken;
  if (!token) throw new Error("BOT_TOKEN missing");
  const bot = new Bot(token);
  let selfInfo: { username?: string; displayName?: string } = {};

  return {
    async start(onMessage) {
      bot.on("message", async (ctx) => {
        const media = detectBotMedia(ctx.message as any);
        const text = ctx.message.text ?? ctx.message.caption ?? "";
        if (!text && !media) return;
        const msg: IncomingMessage = {
          text,
          fromId: ctx.from?.id ?? 0,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          isPrivate: ctx.chat.type === "private",
          fromName: ctx.from?.first_name,
          media
        };
        await onMessage(msg);
      });
      // Эмодзи-реакции юзера на её сообщения (Issue #76 / Task #16).
      bot.on("message_reaction", async (ctx) => {
        const upd = ctx.update.message_reaction as any;
        if (!upd) return;
        const newEmoji = (upd.new_reaction ?? []).find((r: any) => r.type === "emoji")?.emoji;
        const oldEmoji = (upd.old_reaction ?? []).find((r: any) => r.type === "emoji")?.emoji;
        const removed = !newEmoji && !!oldEmoji;
        const emoji = newEmoji ?? oldEmoji;
        if (!emoji) return;
        const msg: IncomingMessage = {
          text: "",
          fromId: upd.user?.id ?? 0,
          chatId: upd.chat.id,
          messageId: upd.message_id,
          isPrivate: upd.chat.type === "private",
          fromName: upd.user?.first_name,
          emojiReaction: {
            emoji,
            targetMessageId: upd.message_id,
            removed
          }
        };
        await onMessage(msg).catch(() => {});
      });
      // allowed_updates: включаем message_reaction и все базовые подписки.
      bot.start({
        drop_pending_updates: true,
        allowed_updates: ["message", "edited_message", "callback_query", "message_reaction"]
      }).catch(() => {});
      try {
        const me = await bot.api.getMe();
        selfInfo = {
          username: me.username ?? undefined,
          displayName: [me.first_name, me.last_name].filter(Boolean).join(" ") || undefined
        };
      } catch { /* ignore */ }
    },
    async sendText(chatId, text) {
      if (hasSpoilers(text)) {
        try {
          const msg = await bot.api.sendMessage(chatId as number, toHtmlWithSpoilers(text), { parse_mode: "HTML" });
          return msg.message_id;
        } catch { /* fall through to plain text */ }
      }
      const msg = await bot.api.sendMessage(chatId as number, text);
      return msg.message_id;
    },
    async setTyping(chatId, on) {
      if (on) {
        try { await bot.api.sendChatAction(chatId as number, "typing"); } catch { /* */ }
      }
    },
    async setReaction(chatId, messageId, emoji) {
      try {
        await bot.api.setMessageReaction(chatId as number, messageId, [
          { type: "emoji", emoji: emoji as any }
        ]);
      } catch { /* not all bots can react */ }
    },
    async editText(chatId, messageId, newText) {
      try {
        if (hasSpoilers(newText)) {
          await bot.api.editMessageText(chatId as number, messageId, toHtmlWithSpoilers(newText), { parse_mode: "HTML" });
        } else {
          await bot.api.editMessageText(chatId as number, messageId, newText);
        }
      } catch { /* msg too old, deleted, no perms etc */ }
    },
    async sendSticker(chatId, fileId) {
      await bot.api.sendSticker(chatId as number, fileId);
    },
    getSelf() {
      return selfInfo;
    },
    async stop() {
      await bot.stop();
    }
  };
}

function detectBotMedia(message: any): IncomingMedia | undefined {
  if (message.photo?.length) {
    const p = message.photo[message.photo.length - 1];
    return { kind: "photo", caption: message.caption, fileId: p.file_id };
  }
  if (message.voice) return { kind: "voice", caption: message.caption, fileId: message.voice.file_id, mimeType: message.voice.mime_type };
  if (message.video_note) return { kind: "video_note", fileId: message.video_note.file_id };
  if (message.video) return { kind: "video", caption: message.caption, fileId: message.video.file_id, mimeType: message.video.mime_type };
  if (message.sticker) return { kind: "sticker", fileId: message.sticker.file_id, emoji: message.sticker.emoji };
  if (message.document) return { kind: "document", caption: message.caption, fileId: message.document.file_id, mimeType: message.document.mime_type };
  return undefined;
}
