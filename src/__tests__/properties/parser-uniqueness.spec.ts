/**
 * Property 3 — однозначность парсера ответа босса (Task 4.13 manager-mode).
 *
 * **Validates: Property 3, Requirements 19.5, 19.6, 6.6**
 *
 * Для любого `Boss_Reply`, в котором одновременно встречаются `reply_to` и
 * префикс `#T-<n>`, парсер либо возвращает один и тот же `ticketId`, либо
 * `conflict` с обоими кандидатами. Кроме того, для одиночного префикса
 * `#T-<n>` результат всегда либо `matched` с тем же id, либо
 * `ticket-not-found`. 1000 итераций fast-check.
 */
import { describe, it } from "vitest";
import fc from "fast-check";

import {
  parseBossReply,
  type BossReplyInput,
  type OpenTicketSummary
} from "../../engine/boss-reply-parser.js";

const OWNER_ID = 100;

const arbUsername = fc
  .string({ minLength: 3, maxLength: 12 })
  .filter((s) => /^[A-Za-z0-9_]+$/.test(s));

const arbTicketSummary = fc
  .record({
    n: fc.integer({ min: 1, max: 999 }),
    clientUsername: fc.option(arbUsername, { nil: undefined })
  })
  .map<OpenTicketSummary>((r) => ({
    id: `#T-${r.n}`,
    clientUsername: r.clientUsername,
    state: "waiting-boss"
  }));

/**
 * Генератор тикетов с уникальными id. Уникальность нужна, чтобы не путать
 * парсер двумя разными тикетами с одинаковым `#T-N`.
 */
const arbTickets = fc
  .array(arbTicketSummary, { minLength: 1, maxLength: 6 })
  .map((arr) => {
    const seen = new Set<string>();
    const out: OpenTicketSummary[] = [];
    for (const t of arr) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  })
  .filter((arr) => arr.length > 0);

const arbBody = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

describe("Property 3 (parser uniqueness)", () => {
  it("конфликт reply_to vs #T-N: либо один ticketId, либо kind=conflict (1000 итераций)", () => {
    fc.assert(
      fc.property(
        arbTickets,
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 1, max: 999 }),
        arbBody,
        (tickets, replyN, prefixN, body) => {
          // reply_to карта указывает на #T-replyN, в тексте префикс #T-prefixN.
          const replyTicketId = `#T-${replyN}`;
          const prefixTicketId = `#T-${prefixN}`;
          const input: BossReplyInput = {
            fromId: OWNER_ID,
            text: `${prefixTicketId} ${body}`,
            replyToMessageId: 555
          };
          const result = parseBossReply(input, tickets, {
            ownerId: OWNER_ID,
            bossMessageMap: new Map([[555, replyTicketId]])
          });

          if (replyTicketId === prefixTicketId) {
            // Источники указывают на один ticketId — должно быть `matched`,
            // `empty-reply` или `ticket-not-found` (если такого тикета нет).
            return (
              result.kind === "matched" ||
              result.kind === "empty-reply" ||
              result.kind === "ticket-not-found"
            );
          }
          // Источники указывают на разные ticketId — обязательный `conflict`
          // с обоими кандидатами в списке.
          if (result.kind !== "conflict") return false;
          const set = new Set(result.candidateIds);
          return set.has(replyTicketId) && set.has(prefixTicketId);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("matched по #T-N всегда возвращает уникальный ticketId, равный префиксу (1000 итераций)", () => {
    fc.assert(
      fc.property(
        arbTickets,
        fc.integer({ min: 1, max: 999 }),
        arbBody,
        (tickets, n, body) => {
          const ticketId = `#T-${n}`;
          const result = parseBossReply(
            { fromId: OWNER_ID, text: `${ticketId} ${body}` },
            tickets,
            { ownerId: OWNER_ID }
          );
          if (result.kind === "matched") {
            return result.ticketId === ticketId;
          }
          // Возможны только `matched` (если тикет есть и body непустое),
          // `ticket-not-found` (если тикета нет) или `empty-reply` (если
          // body после trim пустое — здесь не должно случаться, так как
          // arbBody фильтрует пустые).
          return result.kind === "ticket-not-found";
        }
      ),
      { numRuns: 1000 }
    );
  });
});
