/**
 * Round-trip и базовые тесты для tickets storage (Task 3.5 manager-mode).
 *
 * Property 5 (Requirement 19.9) — round-trip Ticket в JSON: 100 итераций
 * fast-check. Расширенный 1000-итерационный property — в Task 4.13.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Ticket, TicketState, TicketsFile } from "../../types.js";

let tmpRoot: string;
let mod: typeof import("../../storage/md.js");
const SLUG = "test-tickets-profile";

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-tickets-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  mod = await import("../../storage/md.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const STATES: TicketState[] = ["open", "waiting-boss", "answered", "closed"];

const arbTicket = fc.record({
  id: fc.integer({ min: 1, max: 1000 }).map(n => `#T-${n}`),
  chatId: fc.string({ minLength: 1, maxLength: 16 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s)),
  clientUsername: fc.option(fc.string({ minLength: 0, maxLength: 32 }), { nil: undefined }),
  summary: fc.string({ minLength: 0, maxLength: 500 }),
  state: fc.constantFrom<TicketState>(...STATES),
  createdAt: fc.constant(new Date(2024, 0, 1).toISOString()),
  closedAt: fc.option(fc.constant(new Date(2024, 0, 2).toISOString()), { nil: undefined }),
  history: fc.constant([{
    ts: new Date(2024, 0, 1).toISOString(),
    from: "<initial>" as const,
    to: "open" as const,
    reason: "decision-escalate",
    by: "system" as const
  }])
}).map((t) => ({
  ...t,
  history: [{ ts: t.createdAt, from: "<initial>" as const, to: "open" as const, reason: "init", by: "system" as const }]
} as Ticket));

describe("Property 5 (tickets round-trip)", () => {
  it("loadTickets возвращает пустой initial state на новом профиле", async () => {
    const file = await mod.loadTickets(SLUG);
    expect(file).toEqual({ version: 1, nextId: 1, tickets: [] });
  });

  it("saveTickets + loadTickets — round-trip идентичен", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbTicket, { maxLength: 5 }), async (tickets) => {
        const file: TicketsFile = { version: 1, nextId: 100, tickets };
        await mod.saveTickets(SLUG, file);
        const loaded = await mod.loadTickets(SLUG);
        expect(loaded).toEqual(file);
      }),
      { numRuns: 100 }
    );
  });

  it("nextTicketId инкрементирует счётчик и возвращает старое значение", () => {
    const file: TicketsFile = { version: 1, nextId: 42, tickets: [] };
    expect(mod.nextTicketId(file)).toBe(42);
    expect(file.nextId).toBe(43);
    expect(mod.nextTicketId(file)).toBe(43);
    expect(file.nextId).toBe(44);
  });

  it("saveTickets бросает на невалидной структуре", async () => {
    const bad = { version: 2, nextId: 1, tickets: [] } as unknown as TicketsFile;
    await expect(mod.saveTickets(SLUG, bad)).rejects.toThrow();
  });

  it("loadTickets возвращает пустой state если файл повреждён", async () => {
    const file = path.join(tmpRoot, SLUG, "tickets.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not-json", "utf8");
    const f = await mod.loadTickets(SLUG);
    expect(f).toEqual({ version: 1, nextId: 1, tickets: [] });
  });
});
