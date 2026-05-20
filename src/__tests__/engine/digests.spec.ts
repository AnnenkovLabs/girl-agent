/**
 * Тесты `engine/digests.ts` и расширения `engine/agenda.ts` (Task 4.10
 * manager-mode, Requirement 9.1-9.7).
 *
 * Покрывают:
 *  - подсчёт открытых тикетов / `waiting-boss` / новых контактов;
 *  - присутствие ссылки `Inbox: /inbox/<slug>` (Req 9.3);
 *  - empty-state ветку «всё тихо» (Req 9.3 как минимум — содержит счётчики);
 *  - валидацию `scheduleDigest` на период 1..168 (Req 9.2);
 *  - дефолты 24h / `09:00`;
 *  - гейтинг `direction='client'` по `proactiveClients` (Req 9.4);
 *  - гейтинг дайджеста по `proactiveBoss` (Req 9.5);
 *  - failed-пункт не повторяется (Req 9.6, mock-адаптер);
 *  - `schedulePromiseFollowUp` без явного `dueAtMs` ставит `now+24h ±1s`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRoot: string;
let mod: typeof import("../../engine/digests.js");
let storage: typeof import("../../storage/md.js");
let agendaMod: typeof import("../../engine/agenda.js");

const SLUG = "digests-spec";

function isoMinusHours(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-digests-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  mod = await import("../../engine/digests.js");
  storage = await import("../../storage/md.js");
  agendaMod = await import("../../engine/agenda.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  // Каждый тест работает на чистом профиле: чистим директорию.
  const slugDir = path.join(tmpRoot, SLUG);
  await fs.rm(slugDir, { recursive: true, force: true });
  await fs.mkdir(slugDir, { recursive: true });
  await fs.mkdir(path.join(slugDir, "contacts"), { recursive: true });
});

// ============================================================================
// composeDailyDigest
// ============================================================================

describe("composeDailyDigest (Req 9.3)", () => {
  it("считает открытые тикеты, waiting-boss и новые контакты за 24 часа", async () => {
    await storage.saveTickets(SLUG, {
      version: 1,
      nextId: 4,
      tickets: [
        {
          id: "#T-1",
          chatId: "c1",
          summary: "open",
          state: "open",
          createdAt: isoMinusHours(2),
          history: [{ ts: isoMinusHours(2), from: "<initial>", to: "open", reason: "decision-escalate", by: "system" }]
        },
        {
          id: "#T-2",
          chatId: "c2",
          summary: "wait",
          state: "waiting-boss",
          createdAt: isoMinusHours(3),
          history: [{ ts: isoMinusHours(3), from: "<initial>", to: "waiting-boss", reason: "hold-sent", by: "system" }]
        },
        {
          id: "#T-3",
          chatId: "c3",
          summary: "closed",
          state: "closed",
          createdAt: isoMinusHours(40),
          closedAt: isoMinusHours(20),
          history: [{ ts: isoMinusHours(40), from: "<initial>", to: "closed", reason: "boss-timeout", by: "system" }]
        }
      ]
    });
    const fresh = isoMinusHours(2);
    const old = isoMinusHours(48);
    await storage.saveContact(SLUG, {
      chatId: "c1",
      tier: "regular",
      manualOverride: false,
      score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 },
      createdAt: fresh,
      updatedAt: fresh
    });
    await storage.saveContact(SLUG, {
      chatId: "c2",
      tier: "introduced",
      manualOverride: false,
      score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 },
      createdAt: old,
      updatedAt: old
    });

    const d = await mod.composeDailyDigest(SLUG);
    expect(d.counts.openTickets).toBe(2); // open + waiting-boss
    expect(d.counts.waitingBoss).toBe(1);
    expect(d.counts.newContacts).toBe(1);
    expect(d.text).toContain(`Inbox: /inbox/${SLUG}`);
    expect(d.text).toContain("Открытых тикетов: 2");
    expect(d.text).toContain("Ожидают ответа: 1");
    expect(d.text.length).toBeLessThanOrEqual(500);
  });

  it("empty-state: при отсутствии тикетов и новых контактов отдаёт тихую сводку", async () => {
    await storage.saveTickets(SLUG, { version: 1, nextId: 1, tickets: [] });
    const d = await mod.composeDailyDigest(SLUG);
    expect(d.counts).toEqual({ openTickets: 0, waitingBoss: 0, newContacts: 0 });
    expect(d.text).toContain("Все тихо");
    expect(d.text).toContain(`Inbox: /inbox/${SLUG}`);
  });

  it("без markdown и эмодзи в тексте", async () => {
    const d = await mod.composeDailyDigest(SLUG);
    expect(d.text).not.toMatch(/[*_`#~]/);
    // эмодзи — отсутствие любых high-bmp символов:
    // лоу-fi проверка: только ASCII + кириллица + двоеточие/двоеточие/слеш/цифры/перенос
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(d.text)).toBe(false);
  });
});

// ============================================================================
// scheduleDigest / planDigestSchedule
// ============================================================================

describe("scheduleDigest (Req 9.2)", () => {
  it("отвергает period < 1", () => {
    expect(() => mod.planDigestSchedule({ tz: "UTC", periodHours: 0 })).toThrow(/[\d]/);
  });

  it("отвергает period > 168", () => {
    expect(() => mod.planDigestSchedule({ tz: "UTC", periodHours: 169 })).toThrow(/[\d]/);
  });

  it("принимает период 1 час", () => {
    const s = mod.planDigestSchedule({ tz: "UTC", periodHours: 1 });
    expect(s.periodHours).toBe(1);
    expect(s.intervalMs).toBe(60 * 60 * 1000);
  });

  it("принимает период 168 часов", () => {
    const s = mod.planDigestSchedule({ tz: "UTC", periodHours: 168 });
    expect(s.periodHours).toBe(168);
  });

  it("по умолчанию 24h / 09:00", () => {
    const s = mod.planDigestSchedule({ tz: "UTC" });
    expect(s.periodHours).toBe(24);
    expect(s.digestTime).toBe("09:00");
    expect(s.intervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it("отвергает невалидный digestTime", () => {
    expect(() => mod.planDigestSchedule({ tz: "UTC", digestTime: "25:00" })).toThrow();
    expect(() => mod.planDigestSchedule({ tz: "UTC", digestTime: "9:99" })).toThrow();
  });

  it("вычисляет ближайший момент HH:MM в локальном tz, не раньше now", () => {
    const now = new Date("2024-06-01T05:30:00.000Z");
    const s = mod.planDigestSchedule({ tz: "UTC", digestTime: "09:00", now });
    // 09:00 UTC сегодня — 2024-06-01T09:00:00.000Z, через 3.5 часа
    expect(s.firstFireAt).toBe("2024-06-01T09:00:00.000Z");
    expect(s.firstDelayMs).toBe(3.5 * 60 * 60 * 1000);
  });

  it("если HH:MM уже прошло сегодня — переносит на завтра", () => {
    const now = new Date("2024-06-01T10:00:00.000Z");
    const s = mod.planDigestSchedule({ tz: "UTC", digestTime: "09:00", now });
    expect(s.firstFireAt).toBe("2024-06-02T09:00:00.000Z");
  });
});

// ============================================================================
// agenda direction gating
// ============================================================================

describe("agenda direction-gating (Req 9.4-9.5)", () => {
  it("agendaItemDirection: дефолт client при отсутствии поля", () => {
    const item: import("../../storage/md.js").AgendaItem = {
      id: "x",
      about: "y",
      pingAt: new Date().toISOString(),
      reason: "r",
      importance: 1,
      state: "pending",
      attempts: 0,
      chatId: 1,
      createdAt: new Date().toISOString()
    };
    expect(agendaMod.agendaItemDirection(item)).toBe("client");
  });

  it("agendaItemDirection: вернёт boss при direction=boss", () => {
    const item: import("../../storage/md.js").AgendaItem = {
      id: "x",
      about: "y",
      pingAt: new Date().toISOString(),
      reason: "r",
      importance: 1,
      state: "pending",
      attempts: 0,
      chatId: 1,
      createdAt: new Date().toISOString(),
      direction: "boss"
    };
    expect(agendaMod.agendaItemDirection(item)).toBe("boss");
  });

  it("gateAgendaByFlags: client пункты разрешены только при proactiveClients=true", () => {
    const items: import("../../storage/md.js").AgendaItem[] = [
      {
        id: "a",
        about: "y",
        pingAt: new Date().toISOString(),
        reason: "r",
        importance: 1,
        state: "pending",
        attempts: 0,
        chatId: 1,
        createdAt: new Date().toISOString(),
        direction: "client"
      },
      {
        id: "b",
        about: "y",
        pingAt: new Date().toISOString(),
        reason: "r",
        importance: 1,
        state: "pending",
        attempts: 0,
        chatId: 1,
        createdAt: new Date().toISOString(),
        direction: "boss"
      }
    ];
    expect(agendaMod.gateAgendaByFlags(items, { proactiveClients: false, proactiveBoss: false })).toHaveLength(0);
    expect(agendaMod.gateAgendaByFlags(items, { proactiveClients: true, proactiveBoss: false }).map(i => i.id)).toEqual(["a"]);
    expect(agendaMod.gateAgendaByFlags(items, { proactiveClients: false, proactiveBoss: true }).map(i => i.id)).toEqual(["b"]);
    expect(agendaMod.gateAgendaByFlags(items, { proactiveClients: true, proactiveBoss: true })).toHaveLength(2);
  });
});

// ============================================================================
// schedulePromiseFollowUp
// ============================================================================

describe("schedulePromiseFollowUp (Req 9.1)", () => {
  it("без dueAtMs планирует now+24h ±1s", async () => {
    const now = new Date();
    const r = await mod.schedulePromiseFollowUp(SLUG, {
      promise: "пришлю КП завтра",
      contactChatId: "client-1",
      now
    });
    expect(r.created).toBe(true);
    const agenda = await storage.readAgenda(SLUG);
    const item = agenda.find(it => it.id === r.itemId)!;
    const expected = now.getTime() + 24 * 60 * 60 * 1000;
    const actual = new Date(item.pingAt).getTime();
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1000);
    expect(item.direction).toBe("client");
    expect(item.state).toBe("pending");
  });

  it("при заданном dueAtMs использует его без поправок", async () => {
    const due = Date.now() + 6 * 60 * 60 * 1000;
    const r = await mod.schedulePromiseFollowUp(SLUG, {
      promise: "позвоню в 18",
      contactChatId: "client-2",
      dueAtMs: due
    });
    const agenda = await storage.readAgenda(SLUG);
    const item = agenda.find(it => it.id === r.itemId)!;
    expect(new Date(item.pingAt).getTime()).toBe(due);
  });

  it("идемпотентно: повторный вызов с тем же promise+chatId не создаёт дубль", async () => {
    const args = { promise: "напишу позже", contactChatId: "client-3" };
    const r1 = await mod.schedulePromiseFollowUp(SLUG, args);
    const r2 = await mod.schedulePromiseFollowUp(SLUG, args);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.itemId).toBe(r1.itemId);
    const agenda = await storage.readAgenda(SLUG);
    expect(agenda.filter(it => it.about === "напишу позже" && String(it.chatId) === "client-3")).toHaveLength(1);
  });

  it("отвергает пустое обещание", async () => {
    await expect(mod.schedulePromiseFollowUp(SLUG, { promise: "   ", contactChatId: "c" })).rejects.toThrow();
  });
});

// ============================================================================
// markAgendaItemFailed (Req 9.6)
// ============================================================================

describe("markAgendaItemFailed (Req 9.6)", () => {
  it("переводит пункт в state=failed и не повторяется при повторном вызове", async () => {
    const r = await mod.schedulePromiseFollowUp(SLUG, {
      promise: "follow-up на failed",
      contactChatId: "client-4"
    });
    await mod.markAgendaItemFailed(SLUG, r.itemId, "tg adapter error");
    const a1 = (await storage.readAgenda(SLUG)).find(it => it.id === r.itemId)!;
    expect(a1.state).toBe("failed");
    expect(a1.history?.some(h => h.includes("failed"))).toBe(true);

    // Повторный вызов идемпотентен — history не растёт.
    const beforeLen = a1.history?.length ?? 0;
    await mod.markAgendaItemFailed(SLUG, r.itemId, "second time");
    const a2 = (await storage.readAgenda(SLUG)).find(it => it.id === r.itemId)!;
    expect(a2.state).toBe("failed");
    expect(a2.history?.length ?? 0).toBe(beforeLen);
  });

  it("dueAgendaItems не возвращает failed пункты (no-retry)", async () => {
    const r = await mod.schedulePromiseFollowUp(SLUG, {
      promise: "no-retry",
      contactChatId: "c5",
      dueAtMs: Date.now() - 60_000
    });
    await mod.markAgendaItemFailed(SLUG, r.itemId, "boom");
    const due = await agendaMod.dueAgendaItems(SLUG);
    expect(due.find(it => it.id === r.itemId)).toBeUndefined();
  });
});
