import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { ProfileConfig } from "../types.js";
import type { IncomingMedia, TgAdapter } from "./index.js";
import { NewMessage } from "telegram/events/index.js";
import { Raw } from "telegram/events/Raw.js";
import type { ProxyInterface } from "telegram/network/connection/TCPMTProxy.js";

const OWNER_PROXY_API_ID = Number(process.env.MANAGER_AGENT_OWNER_PROXY_API_ID ?? process.env.MANAGER_AGENT_TG_API_ID ?? 0);
const OWNER_PROXY_API_HASH = process.env.MANAGER_AGENT_OWNER_PROXY_API_HASH ?? process.env.MANAGER_AGENT_TG_API_HASH ?? "";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms))
  ]);
}

function debug(message: string): void {
  if (process.env.MANAGER_AGENT_DEBUG === "1") process.stderr.write(`${message}\n`);
}

function clientProxy(cfg: ProfileConfig): ProxyInterface | undefined {
  const proxy = cfg.telegram.proxy;
  if (!proxy) return undefined;
  if (proxy.MTProxy && proxy.secret) {
    return {
      ip: proxy.ip,
      port: proxy.port,
      MTProxy: true,
      secret: proxy.secret,
      timeout: proxy.timeout ?? 10
    };
  }
  if (!proxy.socksType) throw new Error("Invalid Telegram proxy: socksType missing");
  return {
    ip: proxy.ip,
    port: proxy.port,
    socksType: proxy.socksType,
    username: proxy.username,
    password: proxy.password,
    timeout: proxy.timeout ?? 10
  };
}

export function makeUserbotAdapter(cfg: ProfileConfig): TgAdapter {
  const apiId = cfg.telegram.apiId;
  const apiHash = cfg.telegram.apiHash;
  const session = cfg.telegram.sessionString ?? "";
  const effectiveApiId = apiId || OWNER_PROXY_API_ID;
  const effectiveApiHash = apiHash || OWNER_PROXY_API_HASH;
  if (!effectiveApiId || !effectiveApiHash) throw new Error("API_ID/API_HASH missing for userbot: выбери «прокси автора» в WebUI или укажи свои api_id/api_hash");

  const useWSS = cfg.telegram.useWSS !== false;
  const proxy = clientProxy(cfg);
  debug(`[userbot] creating TelegramClient (useWSS=${useWSS}${proxy ? ", proxy=on" : ""})…`);

  const client = new TelegramClient(new StringSession(session), effectiveApiId, effectiveApiHash, {
    connectionRetries: 5,
    requestRetries: 5,
    retryDelay: 3000,
    autoReconnect: true,
    floodSleepThreshold: 120,
    useWSS,
    proxy
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

  async function readHistoryPeer(peer: Api.TypeInputPeer): Promise<void> {
    const maxId = 999999999;
    if (peer.className === "InputPeerChannel" || peer.className === "InputPeerChannelFromMessage") {
      await client.invoke(new Api.channels.ReadHistory({ channel: peer, maxId }));
    } else {
      await client.invoke(new Api.messages.ReadHistory({ peer, maxId }));
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
      // Кэш последних входящих сообщений по (chatId, messageId) — нужен для Task #15:
      // когда юзер удаляет сообщение, в raw update приходят только id, текст нужно
      // восстановить из хранимых буфера.
      const incomingCache = new Map<string, { text: string; ts: number; chatId: number | string; isPrivate: boolean; fromId: number; fromName?: string }>();
      const cacheKey = (chatId: number | string, messageId: number): string => `${chatId}:${messageId}`;
      const trimIncomingCache = (): void => {
        if (incomingCache.size <= 256) return;
        const sorted = [...incomingCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < sorted.length - 256; i++) incomingCache.delete(sorted[i]![0]);
      };
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
          const fromId = Number(m.senderId?.value ?? m.fromId?.userId?.value ?? 0);
          const chatId = isPrivate ? fromId : Number(peer?.channelId?.value ?? peer?.chatId?.value ?? fromId);
          const inputChat = await m.getInputChat?.();
          if (inputChat) {
            peerCache.set(chatId, inputChat);
          }
          if (isPrivate && inputChat && fromId > 0) {
            peerCache.set(fromId, inputChat);
          }
          // Кэшируем для Task #15 (deletion handler).
          incomingCache.set(cacheKey(chatId, Number(m.id)), {
            text,
            ts: Date.now(),
            chatId,
            isPrivate,
            fromId,
            fromName: undefined
          });
          trimIncomingCache();
          await onMessage({
            text,
            fromId,
            chatId,
            messageId: Number(m.id),
            isPrivate,
            media
          });
        } catch {
          /* ignore per-message errors so the update loop survives */
        }
      }, new NewMessage({}));

      // === Task #15: Raw обработчик UpdateDeleteMessages / UpdateDeleteChannelMessages ===
      client.addEventHandler(async (update: any) => {
        try {
          const cls = update?.className ?? update?.constructor?.name ?? "";
          if (cls !== "UpdateDeleteMessages" && cls !== "UpdateDeleteChannelMessages") return;
          const messageIds: number[] = (update.messages ?? []).map((x: any) => Number(x));
          // Channel вариант несёт channelId, иначе — это PM, нужно пройтись по кэшу.
          if (cls === "UpdateDeleteChannelMessages") {
            const chId = -Number(update.channelId?.value ?? update.channelId);
            for (const mid of messageIds) {
              const c = incomingCache.get(cacheKey(chId, mid));
              if (!c) continue;
              await onMessage({
                text: "",
                fromId: c.fromId,
                chatId: chId,
                messageId: mid,
                isPrivate: false,
                deletion: {
                  messageId: mid,
                  text: c.text,
                  ageSec: Math.max(0, Math.floor((Date.now() - c.ts) / 1000))
                }
              }).catch(() => {});
              incomingCache.delete(cacheKey(chId, mid));
            }
            return;
          }
          // PM-вариант: неизвестно от какого юзера — ищем по id в кэше по всем пирам.
          for (const mid of messageIds) {
            for (const [k, v] of incomingCache.entries()) {
              if (!k.endsWith(`:${mid}`)) continue;
              if (!v.isPrivate) continue;
              await onMessage({
                text: "",
                fromId: v.fromId,
                chatId: v.chatId,
                messageId: mid,
                isPrivate: true,
                deletion: {
                  messageId: mid,
                  text: v.text,
                  ageSec: Math.max(0, Math.floor((Date.now() - v.ts) / 1000))
                }
              }).catch(() => {});
              incomingCache.delete(k);
              break;
            }
          }
        } catch { /* keep update loop alive */ }
      }, new Raw({}));

      // === Task #16: эмодзи-реакции юзера на её сообщения. UpdateMessageReactions приходит всем участникам. ===
      client.addEventHandler(async (update: any) => {
        try {
          const cls = update?.className ?? update?.constructor?.name ?? "";
          if (cls !== "UpdateMessageReactions") return;
          const peer = update.peer;
          const isPrivate = peer?.className === "PeerUser";
          const chatId = isPrivate
            ? Number(peer.userId?.value ?? peer.userId)
            : Number(peer?.channelId?.value ?? peer?.chatId?.value ?? 0);
          if (!chatId) return;
          const messageId = Number(update.msgId);
          const reactions = (update.reactions?.recentReactions ?? []) as any[];
          // Берём последнюю реакцию от партнёра (не от самой девушки).
          const lastFromOther = reactions
            .filter((r: any) => Number(r.peerId?.userId?.value ?? r.peerId?.userId ?? 0) !== Number((me?.id as any)?.value ?? me?.id ?? 0))
            .pop();
          if (!lastFromOther) return;
          const emoji = lastFromOther.reaction?.emoticon as string | undefined;
          if (!emoji) return;
          const fromId = Number(lastFromOther.peerId?.userId?.value ?? lastFromOther.peerId?.userId ?? 0);
          await onMessage({
            text: "",
            fromId,
            chatId,
            messageId,
            isPrivate,
            emojiReaction: {
              emoji,
              targetMessageId: messageId,
              removed: false
            }
          }).catch(() => {});
        } catch { /* keep update loop alive */ }
      }, new Raw({}));
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
    async editText(chatId, messageId, newText) {
      try {
        const peer = await resolvePeer(chatId);
        await client.invoke(new Api.messages.EditMessage({
          peer,
          id: messageId,
          message: newText
        }));
      } catch { /* too old / deleted / no perms */ }
    },
    async updateOnlineStatus(online) {
      // Issue #81 — выставляем статус «в сети» / «не в сети».
      // Telegram держит online ~60с от последнего UpdateStatus({offline:false}),
      // поэтому heartbeat должен периодически освежать состояние.
      try {
        await client.invoke(new Api.account.UpdateStatus({ offline: !online }));
      } catch { /* swallow — может быть отключение, флуд-лимит и т.п. */ }
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
      await readHistoryPeer(entity);
    },
    async reportSpam(chatId) {
      const peer = await resolvePeer(chatId);
      await client.invoke(new Api.messages.ReportSpam({ peer }));
    },
    async deleteMessages(chatId, messageIds, revoke = false) {
      const peer = await resolvePeer(chatId);
      await client.deleteMessages(peer, messageIds, { revoke });
    },
    getSelf() {
      if (!me) return {};
      const parts: string[] = [];
      if (me.firstName) parts.push(me.firstName);
      if (me.lastName) parts.push(me.lastName);
      return {
        username: me.username ?? undefined,
        displayName: parts.join(" ") || undefined
      };
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
    connectionRetries: 5,
    useWSS: true
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
      const out: IncomingMedia = { kind: "sticker", caption, mimeType, emoji: stickerAttr?.alt };
      if (mimeType?.startsWith("image/")) {
        try {
          const downloaded = await client.downloadMedia(message, {});
          if (Buffer.isBuffer(downloaded)) out.base64 = downloaded.toString("base64");
        } catch { /* ignore media download failures */ }
      }
      return out;
    }
    if (isVideo) return { kind: "video", caption, mimeType };
    return { kind: "document", caption, mimeType };
  }
  return undefined;
}
