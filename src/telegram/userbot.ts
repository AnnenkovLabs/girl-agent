import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { ProfileConfig } from "../types.js";
import type { IncomingMedia, TgAdapter } from "./index.js";
import { NewMessage } from "telegram/events/index.js";
import { escapeMarkdownV2 } from "./markdown.js";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms))
  ]);
}

function debug(message: string): void {
  if (process.env.GIRL_AGENT_DEBUG === "1") process.stderr.write(`${message}\n`);
}

export function makeUserbotAdapter(cfg: ProfileConfig): TgAdapter {
  const apiId = cfg.telegram.apiId;
  const apiHash = cfg.telegram.apiHash;
  const session = cfg.telegram.sessionString ?? "";
  if (!apiId || !apiHash) throw new Error("API_ID/API_HASH missing for userbot");
  debug("[userbot] creating TelegramClient…");
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
    requestRetries: 5,
    retryDelay: 3000,
    autoReconnect: true,
    floodSleepThreshold: 120
  });
  client.onError = async () => { /* swallow _updateLoop ping TIMEOUT noise */ };
  let me: Api.User | null = null;
  const peerCache = new Map<string | number, Api.TypeInputPeer>();

  async function resolvePeer(chatId: number | string): Promise<Api.TypeInputPeer> {
    const cached = peerCache.get(chatId);
    if (cached) return cached;
    const peer = await client.getInputEntity(chatId as any);
    peerCache.set(chatId, peer);
    return peer;
  }

  async function connectWithRetry(maxAttempts = 3): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        debug(`[userbot] connecting (attempt ${i + 1}/${maxAttempts})…`);
        await withTimeout(client.connect(), 30000, "connect");
        debug("[userbot] connected!");
        return;
      } catch (e) {
        debug(`[userbot] connect attempt ${i + 1} failed: ${(e as Error).message}`);
        if (i === maxAttempts - 1) throw e;
        await new Promise(r => setTimeout(r, 3000 * (i + 1)));
      }
    }
  }

  return {
    async start(onMessage) {
      await connectWithRetry();
      debug("[userbot] getting self info…");
      for (let i = 0; i < 3; i++) {
        try {
          me = await withTimeout(client.getMe() as Promise<Api.User>, 15000, "getMe");
          debug(`[userbot] logged in as ${me.firstName ?? me.username ?? "?"}`);
          break;
        } catch (e) {
          debug(`[userbot] getMe attempt ${i + 1} failed: ${(e as Error).message}`);
          if (i === 2) throw e;
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
      }
      debug("[userbot] registering message handler…");
      client.addEventHandler(async (event: any) => {
        try {
          const m = event.message;
          if (!m) return;
          if (m.out) return;
          const media = await detectUserbotMedia(client, m);
          const text = m.message ?? "";
          if (!text && !media) return;
          const peer = m.peerId;
          const isPrivate = peer?.className === "PeerUser";
          const isMentioned = Boolean(m.mentioned);
          const fromName = m.sender?.firstName || m.sender?.username || m.sender?.title;
          const fromId = Number(m.senderId?.value ?? m.fromId?.userId?.value ?? 0);
          const chatId = isPrivate ? fromId : Number(peer?.channelId?.value ?? peer?.chatId?.value ?? fromId);
          const inputChat = await m.getInputChat?.();
          if (inputChat) {
            peerCache.set(chatId, inputChat);
          }
          await onMessage({
            text,
            fromId,
            chatId,
            messageId: Number(m.id),
            isPrivate,
            isMentioned,
            fromName,
            media
          });
        } catch {
          /* ignore per-message errors so the update loop survives */
        }
      }, new NewMessage({}));
    },
    async sendText(chatId, text) {
      const peer = await resolvePeer(chatId);
      const msg = await client.sendMessage(peer, { message: text });
      return Number((msg as any).id);
    },
    async sendSticker(chatId, fileId) {
      const peer = await resolvePeer(chatId);
      await client.sendFile(peer, { file: fileId });
    },
    async setTyping(chatId, on) {
      if (!on) return;
      try {
        const peer = await resolvePeer(chatId);
        await client.invoke(new Api.messages.SetTyping({
          peer,
          action: new Api.SendMessageTypingAction()
        }));
      } catch { /* */ }
    },
    async setReaction(chatId, messageId, emoji) {
      try {
        const peer = await resolvePeer(chatId);
        await client.invoke(new Api.messages.SendReaction({
          peer,
          msgId: messageId,
          reaction: [new Api.ReactionEmoji({ emoticon: emoji })]
        }));
      } catch { /* may fail if peer disabled reactions */ }
    },
    async blockContact(chatId) {
      const peer = await resolvePeer(chatId);
      await client.invoke(new Api.contacts.Block({ id: peer }));
    },
    async unblockContact(chatId) {
      const peer = await resolvePeer(chatId);
      await client.invoke(new Api.contacts.Unblock({ id: peer }));
    },
    async readHistory(chatId) {
      const entity = await resolvePeer(chatId);
      // Используем очень большой maxId чтобы прочитать все сообщения (как в markAsRead)
      const maxId = 999999999;
      // Проверяем тип entity для каналов
      if (entity.className === "InputPeerChannel" || entity.className === "InputPeerChannelFromMessage") {
        await client.invoke(new Api.channels.ReadHistory({ channel: entity, maxId }));
      } else {
        await client.invoke(new Api.messages.ReadHistory({ peer: entity, maxId }));
      }
    },
    async deleteDialogHistory(chatId, revoke = false) {
      const peer = await resolvePeer(chatId);
      await client.invoke(new Api.messages.DeleteHistory({ peer, maxId: 0, revoke }));
    },
    async reportSpam(chatId) {
      const peer = await resolvePeer(chatId);
      await client.invoke(new Api.messages.ReportSpam({ peer }));
    },
    async editLastMessage(chatId, messageId, text) {
      const peer = await resolvePeer(chatId);
      try {
        await client.editMessage(peer, { message: messageId, text: escapeMarkdownV2(text), parseMode: 'MarkdownV2' });
      } catch {
        await client.editMessage(peer, { message: messageId, text });
      }
    },
    async deleteMessages(chatId, messageIds, revoke = false) {
      const peer = await resolvePeer(chatId);
      await client.deleteMessages(peer, messageIds, { revoke });
    },
    async stop() {
      await client.disconnect();
    }
  };
}

/** Helper for wizard: log in interactively and return session string. */
export async function userbotLogin(opts: {
  apiId: number;
  apiHash: string;
  phone: string;
  promptCode: () => Promise<string>;
  promptPassword: () => Promise<string>;
}): Promise<string> {
  const client = new TelegramClient(new StringSession(""), opts.apiId, opts.apiHash, {
    connectionRetries: 5
  });
  await client.start({
    phoneNumber: async () => opts.phone,
    phoneCode: opts.promptCode,
    password: opts.promptPassword,
    onError: (e) => { throw e; }
  });
  const sess = (client.session as StringSession).save();
  await client.disconnect();
  return sess;
}

async function detectUserbotMedia(client: TelegramClient, message: any): Promise<IncomingMedia | undefined> {
  const media = message.media;
  if (!media) return undefined;
  const cn = media.className ?? media.constructor?.name ?? "";
  const caption = message.message || undefined;
  if (cn.includes("MessageMediaPhoto") || message.photo) {
    const out: IncomingMedia = { kind: "photo", caption, mimeType: "image/jpeg" };
    try {
      const downloaded = await client.downloadMedia(message, {});
      if (Buffer.isBuffer(downloaded)) out.base64 = downloaded.toString("base64");
    } catch { /* ignore media download failures */ }
    return out;
  }
  if (cn.includes("MessageMediaDocument") || message.document) {
    const doc = message.document;
    const mimeType = doc?.mimeType as string | undefined;
    const attrs = doc?.attributes ?? [];
    const isVoice = attrs.some((a: any) => a.className === "DocumentAttributeAudio" && a.voice);
    const isVideoNote = attrs.some((a: any) => a.className === "DocumentAttributeVideo" && a.roundMessage);
    const isSticker = attrs.some((a: any) => a.className === "DocumentAttributeSticker");
    const isVideo = typeof mimeType === "string" && mimeType.startsWith("video/");
    if (isVoice) return { kind: "voice", caption, mimeType };
    if (isVideoNote) return { kind: "video_note", caption, mimeType };
    if (isSticker) {
      const stickerAttr = attrs.find((a: any) => a.className === "DocumentAttributeSticker");
      return { kind: "sticker", caption, mimeType, emoji: stickerAttr?.alt };
    }
    if (isVideo) return { kind: "video", caption, mimeType };
    return { kind: "document", caption, mimeType };
  }
  return undefined;
}
