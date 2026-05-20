/**
 * Integration-тест dispatcher'а `Runtime.handleIncoming` для manager-mode
 * (Task 4.12b .kiro/specs/manager-mode/tasks.md, Requirements 4 + 13).
 *
 * Сценарий из спека: новый клиент → escalate → boss-reply → ответ клиенту →
 * подтверждение тикета. Тест разделён на две фазы:
 *  - Фаза 1 (escalate): тикет открывается напрямую через `openEscalationTicket`
 *    (private helper, вызывается из handleClientMessage flow по
 *    `gate.force-escalate` или `mandate.escalate`). Это эмулирует
 *    «новый клиент пришёл → runtime открыл тикет», изолируя escalation от
 *    сложного legacy presence/behavior-tick конвейера. Тест проверяет, что
 *    тикет персистится, состояние `waiting-boss`, босс получает уведомление
 *    с `#T-N`.
 *  - Фаза 2 (confirm): босс отправляет reply через `handleIncoming` →
 *    dispatcher маршрутизирует в `handleBossMessage` по
 *    `fromId === cfg.ownerId` → клиент получает composed reply, тикет
 *    переходит `waiting-boss → answered`.
 *
 * Mock-адаптер инжектируется напрямую в `runtime.tg`. Telegram I/O
 * полностью замокирован.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProfileConfig } from "../../types.js";
import type { IncomingMessage, TgAdapter } from "../../telegram/index.js";

const SLUG = "rt-integration-spec";
const OWNER_ID = 200300400;
const CLIENT_CHAT_ID = 666000222;

let tmpRoot: string;
let runtimeMod: typeof import("../../engine/runtime.js");
let storageMod: typeof import("../../storage/md.js");

class MockTg implements Partial<TgAdapter> {
  public sent: Array<{ chatId: number | string; text: string }> = [];
  async sendText(chatId: number | string, text: string): Promise<number | undefined> {
    this.sent.push({ chatId, text });
    return 1000 + this.sent.length;
  }
  async setTyping(): Promise<void> {}
  async setReaction(): Promise<void> {}
  async stop(): Promise<void> {}
}

function makeCfg(): ProfileConfig {
  return {
    slug: SLUG,
    name: "TestManager",
    age: 30,
    nationality: "RU",
    tz: "UTC",
    mode: "bot",
    llm: { presetId: "p", proto: "openai", apiKey: "k", model: "m" },
    telegram: {},
    ownerId: OWNER_ID,
    stage: "manager-default",
    createdAt: new Date().toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0,
    profileType: "manager"
  } as ProfileConfig;
}

function makeClientMessage(text: string): IncomingMessage {
  return {
    text,
    fromId: CLIENT_CHAT_ID,
    chatId: CLIENT_CHAT_ID,
    messageId: 1,
    isPrivate: true
  } as IncomingMessage;
}

function makeBossReply(text: string): IncomingMessage {
  return {
    text,
    fromId: OWNER_ID,
    chatId: OWNER_ID,
    messageId: 2,
    isPrivate: true
  } as IncomingMessage;
}

async function buildRuntime(): Promise<{
  rt: import("../../engine/runtime.js").Runtime;
  tg: MockTg;
}> {
  const rt = new runtimeMod.Runtime(makeCfg());
  const tg = new MockTg();
  (rt as unknown as { tg: TgAdapter }).tg = tg as unknown as TgAdapter;
  return { rt, tg };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-rt-integration-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  await fs.mkdir(path.join(tmpRoot, SLUG), { recursive: true });
  storageMod = await import("../../storage/md.js");
  runtimeMod = await import("../../engine/runtime.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(path.join(tmpRoot, SLUG), { recursive: true, force: true });
  await fs.mkdir(path.join(tmpRoot, SLUG), { recursive: true });
});

describe("handleIncoming: dispatcher routing (Task 4.12b)", () => {
  it("сообщение от босса (fromId === ownerId) уходит в handleBossMessage", async () => {
    const { rt, tg } = await buildRuntime();

    await (rt as unknown as {
      handleIncoming: (m: IncomingMessage) => Promise<void>;
    }).handleIncoming(makeBossReply("#T-999 что-то"));

    // Босс получил guidance (ticket-not-found или no-identification),
    // потому что тикета `#T-999` нет в файле.
    const toBoss = tg.sent.find(s => s.chatId === OWNER_ID);
    expect(toBoss).toBeDefined();
  });
});

describe("escalation flow: новый клиент → ticket → boss-reply → answered", () => {
  it("полный путь через openEscalationTicket + handleIncoming(boss)", async () => {
    const { rt, tg } = await buildRuntime();

    // Фаза 1: эмулируем decision=escalate / gate=force-escalate путём
    // прямого вызова private helper'а `openEscalationTicket`. Это тот же
    // helper, который используется внутри `handleIncoming` для clients
    // (Req 17.5, Req 4.2-4.3, design § 5.4).
    await (rt as unknown as {
      openEscalationTicket: (
        m: IncomingMessage,
        contact: { chatId: string; username?: string; tier: "cold-stranger" } | null,
        reason: string
      ) => Promise<void>;
    }).openEscalationTicket(
      makeClientMessage("здравствуйте, нужна помощь по тарифу"),
      {
        chatId: String(CLIENT_CHAT_ID),
        username: "vitya",
        tier: "cold-stranger"
      },
      "test-escalate"
    );

    // Тикет создан в state `waiting-boss`.
    const file = await storageMod.loadTickets(SLUG);
    expect(file.tickets.length).toBe(1);
    const ticket = file.tickets[0];
    expect(ticket.state).toBe("waiting-boss");
    expect(ticket.chatId).toBe(String(CLIENT_CHAT_ID));

    // Босс получил уведомление с `#T-<id>`.
    const toBoss = tg.sent.find(s => s.chatId === OWNER_ID);
    expect(toBoss).toBeDefined();
    expect(toBoss!.text).toContain(ticket.id);

    // Фаза 2: босс отвечает через `handleIncoming` → dispatcher
    // маршрутизирует в `handleBossMessage` (Req 4.6, Task 4.12a wiring).
    tg.sent.length = 0;
    await (rt as unknown as {
      handleIncoming: (m: IncomingMessage) => Promise<void>;
    }).handleIncoming(makeBossReply(`${ticket.id} да, дадим 5% скидку`));

    // Клиент получил composed reply (текст без `#T-...` префикса).
    const toClient = tg.sent.find(s => s.chatId === String(CLIENT_CHAT_ID));
    expect(toClient).toBeDefined();
    expect(toClient!.text).toContain("5%");
    // Композ-функция отрезает `#T-N` префикс, оставляя только полезный текст.
    expect(toClient!.text).not.toContain(ticket.id);

    // Тикет перешёл в `answered`.
    const fileAfter = await storageMod.loadTickets(SLUG);
    const t = fileAfter.tickets.find(x => x.id === ticket.id)!;
    expect(t.state).toBe("answered");
    expect(t.bossReplyRaw).toBe(`${ticket.id} да, дадим 5% скидку`);
    expect(t.clientReply).toBe(toClient!.text);
  });
});
