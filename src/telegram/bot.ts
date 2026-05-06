import { Bot } from "grammy";
import type { ProfileConfig } from "../types.js";
import type { IncomingMedia, IncomingMessage, TgAdapter } from "./index.js";
import { escapeMarkdownV2 } from "./markdown.js";

export function makeBotAdapter(cfg: ProfileConfig): TgAdapter {
  const token = cfg.telegram.botToken;
  if (!token) throw new Error("BOT_TOKEN missing");
  const bot = new Bot(token);

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
          isMentioned: ctx.message.reply_to_message?.from?.id === bot.botInfo.id ||
                       (bot.botInfo.username && text?.includes("@" + bot.botInfo.username)) || false,
          fromName: ctx.from?.first_name,
          media
        };
        await onMessage(msg);
      });
      bot.start({ drop_pending_updates: true }).catch(() => {});
    },
    async sendText(chatId, text) {
      try {
        const msg = await bot.api.sendMessage(chatId as number, escapeMarkdownV2(text), { parse_mode: "MarkdownV2" });
        return msg.message_id;
      } catch {
        const msg = await bot.api.sendMessage(chatId as number, text);
        return msg.message_id;
      }
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
    async sendSticker(chatId, fileId) {
      await bot.api.sendSticker(chatId as number, fileId);
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
