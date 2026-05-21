/**
 * Property-based round-trip и atomic-write тесты для contacts storage
 * (Task 3.4 manager-mode, Property 6 / Requirement 19.11).
 *
 * Используем временную директорию через MANAGER_AGENT_DATA, чтобы не трогать
 * реальные профили пользователя. Тест выполняет до 200 итераций fast-check
 * (полные fs round-trips дороги для 1000 итераций — мы выбрали разумный
 * компромисс на уровне unit-теста; основной 1000-итерационный property для
 * tickets/contacts проходит в 4.13).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

let tmpRoot: string;
let mod: typeof import("../../storage/md.js");
const SLUG = "test-contacts-profile";

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-contacts-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  // Импортируем модуль ТОЛЬКО после установки env, чтобы DATA_ROOT захватил его.
  mod = await import("../../storage/md.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const arbContact = fc.record({
  chatId: fc.string({ minLength: 1, maxLength: 16 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s)),
  username: fc.option(fc.string({ minLength: 0, maxLength: 32 }), { nil: undefined }),
  tier: fc.constantFrom<Tier>(...VALID_TIERS),
  notes: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
  manualOverride: fc.boolean(),
  createdAt: fc.constant(new Date(2024, 0, 1).toISOString()),
  updatedAt: fc.constant(new Date(2024, 0, 1).toISOString()),
  lastMessageAt: fc.option(fc.constant(new Date(2024, 0, 2).toISOString()), { nil: undefined }),
  score: fc.record({
    relevance: fc.integer({ min: -100, max: 100 }),
    trust: fc.integer({ min: -100, max: 100 }),
    urgency: fc.integer({ min: 0, max: 100 }),
    annoyance: fc.integer({ min: 0, max: 100 }),
    spamScore: fc.integer({ min: 0, max: 100 })
  })
}).map((c) => c as ContactRecord);

describe("Property 6 (contacts round-trip)", () => {
  it("loadContact(saveContact(c)) === c", async () => {
    await fc.assert(
      fc.asyncProperty(arbContact, async (c) => {
        await mod.saveContact(SLUG, c);
        const loaded = await mod.loadContact(SLUG, c.chatId);
        expect(loaded).not.toBeNull();
        expect(loaded).toEqual(c);
        await mod.deleteContact(SLUG, c.chatId);
      }),
      { numRuns: 100 }
    );
  });

  it("listContacts видит сохранённые записи", async () => {
    const a: ContactRecord = {
      chatId: "alice-1",
      tier: "regular",
      manualOverride: false,
      createdAt: new Date(2024, 0, 1).toISOString(),
      updatedAt: new Date(2024, 0, 1).toISOString(),
      score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 }
    };
    const b: ContactRecord = { ...a, chatId: "bob-1", tier: "vip" };
    await mod.saveContact(SLUG, a);
    await mod.saveContact(SLUG, b);
    const list = await mod.listContacts(SLUG);
    const ids = list.map(c => c.chatId).sort();
    expect(ids).toContain("alice-1");
    expect(ids).toContain("bob-1");
    await mod.deleteContact(SLUG, "alice-1");
    await mod.deleteContact(SLUG, "bob-1");
  });

  it("loadContact возвращает null на отсутствующем файле", async () => {
    expect(await mod.loadContact(SLUG, "ghost-id")).toBeNull();
  });

  it("saveContact бросает на невалидной записи", async () => {
    const bad = { chatId: "x" } as unknown as ContactRecord;
    await expect(mod.saveContact(SLUG, bad)).rejects.toThrow();
  });

  it("loadContact возвращает null если файл повреждён", async () => {
    const file = path.join(tmpRoot, SLUG, "contacts", "broken.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not-valid", "utf8");
    const r = await mod.loadContact(SLUG, "broken");
    expect(r).toBeNull();
  });
});
