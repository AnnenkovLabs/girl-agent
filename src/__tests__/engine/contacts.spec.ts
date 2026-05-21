/**
 * Тесты engine/contacts.ts (Task 4.7 manager-mode tasks.md).
 *
 * Покрытие:
 * - upsertOnIncoming: дефолты для нового контакта (Req 2.3), инкремент
 *   `messagesSinceTransition` и `lastMessageAt`, обработка повреждённого
 *   JSON (Req 19.7-19.8) — warn-лог + создаётся свежая запись.
 * - decideTierTransition: gate из 5 сообщений (Req 2.4),
 *   `manualOverride=true` блокирует автопереход (Req 2.7), tier=blocked не
 *   меняется (Req 2.6).
 * - isBlocked: caller-семантика «ignored / blocked» (Req 2.5).
 * - **Property 4 (blocked-monotonicity)** — fast-check на 1000 итераций:
 *   из любого blocked-состояния и любой последовательности интеракций
 *   `decideTierTransition` всегда возвращает `next === "blocked"`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ContactRecord, Tier } from "../../types.js";

const VALID_TIERS: Tier[] = [
  "cold-stranger",
  "introduced",
  "regular",
  "trusted-partner",
  "vip",
  "blocked"
];

const SLUG = "test-contacts-engine";
let tmpRoot: string;
let mod: typeof import("../../engine/contacts.js");
let storage: typeof import("../../storage/md.js");

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-contacts-eng-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  storage = await import("../../storage/md.js");
  mod = await import("../../engine/contacts.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  // Чистим папку контактов между тестами, чтобы не было перекрёстных
  // влияний (но оставляем сам tmpRoot живым).
  const dir = path.join(tmpRoot, SLUG, "contacts");
  await fs.rm(dir, { recursive: true, force: true });
});

function makeContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    chatId: "12345",
    tier: "regular",
    score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 },
    manualOverride: false,
    notes: "",
    messagesSinceTransition: 0,
    createdAt: new Date(2024, 0, 1).toISOString(),
    updatedAt: new Date(2024, 0, 1).toISOString(),
    ...overrides
  };
}

describe("upsertOnIncoming", () => {
  it("создаёт новый контакт с дефолтами (Req 2.3)", async () => {
    const c = await mod.upsertOnIncoming(SLUG, {
      chatId: 42,
      fromUsername: "alice",
      text: "привет"
    });
    expect(c.chatId).toBe("42");
    expect(c.tier).toBe("cold-stranger");
    expect(c.manualOverride).toBe(false);
    expect(c.score).toEqual({
      relevance: 0,
      trust: 0,
      urgency: 0,
      annoyance: 0,
      spamScore: 0
    });
    expect(c.username).toBe("alice");
    expect(c.messagesSinceTransition).toBe(1);
    expect(c.lastMessageAt).toBeDefined();
    // Запись должна оказаться на диске.
    const loaded = await storage.loadContact(SLUG, "42");
    expect(loaded).not.toBeNull();
    expect(loaded?.tier).toBe("cold-stranger");
  });

  it("инкрементирует messagesSinceTransition и обновляет lastMessageAt", async () => {
    const first = await mod.upsertOnIncoming(SLUG, {
      chatId: 99,
      text: "1",
      ts: Date.UTC(2024, 0, 1, 10, 0, 0)
    });
    const second = await mod.upsertOnIncoming(SLUG, {
      chatId: 99,
      text: "2",
      ts: Date.UTC(2024, 0, 1, 10, 5, 0)
    });
    expect(first.messagesSinceTransition).toBe(1);
    expect(second.messagesSinceTransition).toBe(2);
    expect(Date.parse(second.lastMessageAt!)).toBeGreaterThan(
      Date.parse(first.lastMessageAt!)
    );
  });

  it("обновляет username из непустого fromUsername, не затирая null-ом", async () => {
    await mod.upsertOnIncoming(SLUG, { chatId: 7, fromUsername: "first", text: "a" });
    const c2 = await mod.upsertOnIncoming(SLUG, { chatId: 7, text: "b" });
    expect(c2.username).toBe("first");
    const c3 = await mod.upsertOnIncoming(SLUG, {
      chatId: 7,
      fromUsername: "second",
      text: "c"
    });
    expect(c3.username).toBe("second");
  });

  it("повреждённый JSON отбрасывается с warn-логом и заменяется свежей записью", async () => {
    const file = path.join(tmpRoot, SLUG, "contacts", "13.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not-valid-json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = await mod.upsertOnIncoming(SLUG, { chatId: 13, text: "hello" });
      expect(c.tier).toBe("cold-stranger");
      expect(c.manualOverride).toBe(false);
      expect(c.messagesSinceTransition).toBe(1);
      expect(warn).toHaveBeenCalled();
      const reloaded = await storage.loadContact(SLUG, "13");
      expect(reloaded).not.toBeNull();
      expect(reloaded?.tier).toBe("cold-stranger");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("isBlocked", () => {
  it("true для tier=blocked, иначе false (Req 2.5)", () => {
    expect(mod.isBlocked(makeContact({ tier: "blocked" }))).toBe(true);
    for (const t of VALID_TIERS.filter(x => x !== "blocked")) {
      expect(mod.isBlocked(makeContact({ tier: t }))).toBe(false);
    }
  });
});

describe("decideTierTransition", () => {
  it("manualOverride блокирует автопереход (Req 2.7)", () => {
    const c = makeContact({
      tier: "regular",
      manualOverride: true,
      messagesSinceTransition: 100
    });
    const r = mod.decideTierTransition(c, { polite: 100, broken: 0 });
    expect(r.next).toBe("regular");
    expect(r.reason).toBe("manual-override");
  });

  it("gate в 5 сообщений: < 5 → no-change (Req 2.4)", () => {
    const c = makeContact({ tier: "regular", messagesSinceTransition: 4 });
    const r = mod.decideTierTransition(c, { polite: 100 });
    expect(r.next).toBe("regular");
    expect(r.reason).toBe("cooldown");
  });

  it("повышение на 1 соседний тир при достаточно polite (adjacency)", () => {
    const c = makeContact({ tier: "regular", messagesSinceTransition: 5 });
    const r = mod.decideTierTransition(c, { polite: 5, broken: 0 });
    expect(r.next).toBe("trusted-partner");
    expect(r.reason).toBe("upgrade");
  });

  it("понижение на 1 соседний тир при ≥2 broken", () => {
    const c = makeContact({ tier: "trusted-partner", messagesSinceTransition: 5 });
    const r = mod.decideTierTransition(c, { broken: 3 });
    expect(r.next).toBe("regular");
    expect(r.reason).toBe("downgrade");
  });

  it("повышение с vip → vip (нет более высокого тира)", () => {
    const c = makeContact({ tier: "vip", messagesSinceTransition: 10 });
    const r = mod.decideTierTransition(c, { polite: 10, broken: 0 });
    expect(r.next).toBe("vip");
    expect(r.reason).toBe("no-rule");
  });

  it("auto-режим никогда не переводит контакт в blocked", () => {
    const c = makeContact({ tier: "cold-stranger", messagesSinceTransition: 10 });
    const r = mod.decideTierTransition(c, {
      broken: 100,
      boundary: 100
    });
    expect(r.next).not.toBe("blocked");
  });
});

describe("applyTierTransition", () => {
  it("сбрасывает messagesSinceTransition при смене тира", () => {
    const c = makeContact({
      tier: "regular",
      messagesSinceTransition: 7
    });
    const updated = mod.applyTierTransition(c, "trusted-partner");
    expect(updated.tier).toBe("trusted-partner");
    expect(updated.messagesSinceTransition).toBe(0);
  });

  it("при тождественном тире возвращает исходный объект", () => {
    const c = makeContact({
      tier: "regular",
      messagesSinceTransition: 7
    });
    const same = mod.applyTierTransition(c, "regular");
    expect(same).toBe(c);
  });
});

/**
 * Property 4 (blocked-monotonicity, Validates: Requirements 19.7, 19.8, 2.6).
 *
 * Для контакта с `tier="blocked"` `decideTierTransition` всегда возвращает
 * `next === "blocked"` независимо от значений `recentInteractions`,
 * `messagesSinceTransition`, `manualOverride` и прочих счётчиков. Авторежим
 * не выводит контакт из blocked без явного действия владельца.
 *
 * 1000 итераций fast-check; counter-example печатается автоматически.
 */
describe("Property 4 (blocked-monotonicity)", () => {
  const arbInteractions = fc.record({
    polite: fc.integer({ min: 0, max: 1000 }),
    boundary: fc.integer({ min: 0, max: 1000 }),
    broken: fc.integer({ min: 0, max: 1000 }),
    promised: fc.integer({ min: 0, max: 1000 }),
    delivered: fc.integer({ min: 0, max: 1000 })
  });

  const arbBlockedContact = fc.record({
    chatId: fc.string({ minLength: 1, maxLength: 12 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s)),
    tier: fc.constant<Tier>("blocked"),
    manualOverride: fc.boolean(),
    messagesSinceTransition: fc.integer({ min: 0, max: 10000 }),
    score: fc.record({
      relevance: fc.integer({ min: -100, max: 100 }),
      trust: fc.integer({ min: -100, max: 100 }),
      urgency: fc.integer({ min: 0, max: 100 }),
      annoyance: fc.integer({ min: 0, max: 100 }),
      spamScore: fc.integer({ min: 0, max: 100 })
    }),
    createdAt: fc.constant(new Date(2024, 0, 1).toISOString()),
    updatedAt: fc.constant(new Date(2024, 0, 1).toISOString())
  }).map(c => c as ContactRecord);

  it("blocked → blocked для любой последовательности интеракций (1000 итераций)", () => {
    fc.assert(
      fc.property(
        arbBlockedContact,
        fc.array(arbInteractions, { minLength: 1, maxLength: 30 }),
        (contact, sequence) => {
          let current: ContactRecord = contact;
          for (const interactions of sequence) {
            const r = mod.decideTierTransition(current, interactions);
            if (r.next !== "blocked") return false;
            // Имитируем «применение» решения к контакту: тир остаётся blocked,
            // счётчик растёт. Это моделирует продолжение чата.
            current = {
              ...current,
              messagesSinceTransition: (current.messagesSinceTransition ?? 0) + 5,
              tier: r.next
            };
          }
          return current.tier === "blocked";
        }
      ),
      { numRuns: 1000 }
    );
  });
});
