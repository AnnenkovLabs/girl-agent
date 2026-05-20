/**
 * Property 1 — тикеты не теряются (Task 4.13 manager-mode tasks.md).
 *
 * **Validates: Property 1, Requirements 19.1, 19.2**
 *
 * Для любой последовательности операций `(create, transition, save, load)`:
 * (1) save+load round-trip сохраняет состав и `nextId`; id-ы уникальны и
 * меньше `nextId`; (2) `created = openCount + closedCount`, тикеты в
 * `closed` имеют `closedAt`; (3) каждый закрытый тикет был закрыт через
 * допустимый переход. 1000 итераций fast-check.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Ticket, TicketState, TicketsFile } from "../../types.js";
import {
  createTicket,
  isAllowedTransition,
  transitionTicket
} from "../../engine/escalation.js";

const SLUG = "test-property-tickets-not-lost";
let tmpRoot: string;
let storage: typeof import("../../storage/md.js");

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-prop1-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  storage = await import("../../storage/md.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const TICKET_STATES = ["open", "waiting-boss", "answered", "closed"] as const;

/** Команда «создать тикет с очередным id». */
type CreateOp = { kind: "create"; chatId: string };

/** Команда «применить переход к тикету по индексу». */
type TransitionOp = { kind: "transition"; ticketIndex: number; to: TicketState };

type Op = CreateOp | TransitionOp;

const arbCreate: fc.Arbitrary<CreateOp> = fc.record({
  kind: fc.constant<"create">("create"),
  chatId: fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => /^[A-Za-z0-9_-]+$/.test(s))
});

const arbTransition: fc.Arbitrary<TransitionOp> = fc.record({
  kind: fc.constant<"transition">("transition"),
  ticketIndex: fc.integer({ min: 0, max: 19 }),
  to: fc.constantFrom<TicketState>(...TICKET_STATES)
});

const arbOp: fc.Arbitrary<Op> = fc.oneof(arbCreate, arbTransition);

interface SimResult {
  file: TicketsFile;
  created: number;
  closedTransitions: number;
  appliedTransitions: number;
  rejectedTransitions: number;
}

/**
 * Чистый симулятор: применяет последовательность к свежему `TicketsFile`,
 * генерирует id через `nextTicketId`, использует `transitionTicket` для
 * допустимых переходов, игнорирует запрещённые. Возвращает финальный файл и
 * счётчики для верификации.
 */
function simulate(ops: Op[]): SimResult {
  const file: TicketsFile = { version: 1, nextId: 1, tickets: [] };
  let created = 0;
  let closedTransitions = 0;
  let applied = 0;
  let rejected = 0;
  let stepCounter = 0;

  for (const op of ops) {
    stepCounter += 1;
    const ts = `2024-01-01T${String(Math.floor(stepCounter / 60)).padStart(2, "0")}:${String(stepCounter % 60).padStart(2, "0")}:00.000Z`;
    if (op.kind === "create") {
      const id = storage.nextTicketId(file);
      const t = createTicket({
        contact: { chatId: op.chatId },
        message: "x",
        ticketId: `#T-${id}`,
        now: ts
      });
      file.tickets.push(t);
      created += 1;
      continue;
    }
    if (file.tickets.length === 0) continue;
    const idx = op.ticketIndex % file.tickets.length;
    const ticket: Ticket = file.tickets[idx]!;
    if (!isAllowedTransition(ticket.state, op.to)) {
      rejected += 1;
      continue;
    }
    const next = transitionTicket(ticket, op.to, "step", "system", ts);
    file.tickets[idx] = next;
    applied += 1;
    if (op.to === "closed") closedTransitions += 1;
  }

  return { file, created, closedTransitions, appliedTransitions: applied, rejectedTransitions: rejected };
}

describe("Property 1 (tickets-not-lost)", () => {
  it("save/load round-trip + учёт открытых/закрытых тикетов (1000 итераций)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbOp, { minLength: 1, maxLength: 20 }),
        async (ops) => {
          const sim = simulate(ops);
          // 1) Идентификаторы уникальны и `nextId` строго больше любого
          // выданного ранее.
          const ids = sim.file.tickets.map((t) => t.id);
          if (new Set(ids).size !== ids.length) return false;
          for (const t of ids) {
            const num = Number(t.replace(/^#T-/, ""));
            if (!Number.isFinite(num) || num >= sim.file.nextId) return false;
          }

          // 2) Round-trip через `tickets.json`.
          await storage.saveTickets(SLUG, sim.file);
          const loaded = await storage.loadTickets(SLUG);
          if (loaded.tickets.length !== sim.file.tickets.length) return false;
          if (loaded.nextId !== sim.file.nextId) return false;
          for (let i = 0; i < loaded.tickets.length; i++) {
            if (loaded.tickets[i]!.id !== sim.file.tickets[i]!.id) return false;
            if (loaded.tickets[i]!.state !== sim.file.tickets[i]!.state) return false;
          }

          // 3) Закрытые тикеты имеют `closedAt`.
          for (const t of loaded.tickets) {
            if (t.state === "closed" && !t.closedAt) return false;
          }

          // 4) Никто не «потерян»: created = открытых + закрытых.
          const openCount = loaded.tickets.filter((t) => t.state !== "closed").length;
          const closedCount = loaded.tickets.filter((t) => t.state === "closed").length;
          if (openCount + closedCount !== sim.created) return false;
          if (closedCount !== sim.closedTransitions) return false;

          return true;
        }
      ),
      { numRuns: 1000 }
    );
  });
});
