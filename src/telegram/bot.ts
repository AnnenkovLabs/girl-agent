import { Bot } from "grammy";
import type { ProfileConfig } from "../types.js";
import type { IncomingMedia, IncomingMessage, TgAdapter } from "./index.js";

export function makeBotAdapter(cfg: ProfileConfig): TgAdapter {
  const token = cfg.telegram.botToken;
  if (!token) throw new Error("BOT_TOKEN missing");
  const bot = new Bot(token);
  let selfId = 0;
  let selfUsername = "";

  return {
    async start(onMessage) {
      const me = await bot.api.getMe();
      selfId = me.id;
      selfUsername = (me.username ?? "").toLowerCase();
      bot.on("message", async (ctx) => {
        const media = detectBotMedia(ctx.message as any);
        const text = ctx.message.text ?? ctx.message.caption ?? "";
        if (!text && !media) return;
        const rawEntities = ((ctx.message as any).entities ?? (ctx.message as any).caption_entities ?? []) as Array<any>;
        const mentioned = textMentionsUsername(text, selfUsername) || rawEntities.some((entity) => {
          if (entity?.type === "text_mention") return entity.user?.id === selfId;
          if (entity?.type !== "mention") return false;
          const mentionText = text.slice(entity.offset ?? 0, (entity.offset ?? 0) + (entity.length ?? 0)).toLowerCase();
          return mentionText === `@${selfUsername}`;
        });
        const replyToSelf = ((ctx.message as any).reply_to_message?.from?.id ?? 0) === selfId;
        const msg: IncomingMessage = {
          text,
          fromId: ctx.from?.id ?? 0,
          chatId: ctx.chat.id,
          threadId: (ctx.message as any).message_thread_id,
          messageId: ctx.message.message_id,
          isPrivate: ctx.chat.type === "private",
          chatType: (ctx.chat.type as IncomingMessage["chatType"]) ?? "unknown",
          fromName: ctx.from?.first_name,
          mentioned,
          replyToSelf,
          chatTitle: "title" in ctx.chat ? (ctx.chat as any).title : undefined,
          media
        };
        await onMessage(msg);
      });
      bot.start({ drop_pending_updates: true }).catch(() => {});
    },
    async sendText(chatId, text, threadId) {
      const msg = await bot.api.sendMessage(chatId as number, text, threadId ? { message_thread_id: threadId } : undefined);
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
    async sendSticker(chatId, fileId) {
      await bot.api.sendSticker(chatId as number, fileId);
    },
    async stop() {
      await bot.stop();
    }
  };
}

function textMentionsUsername(text: string, username: string): boolean {
  if (!text || !username) return false;
  return text.toLowerCase().includes(`@${username}`);
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
