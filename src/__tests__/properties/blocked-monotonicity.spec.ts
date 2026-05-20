/**
 * Property 4 — монотонность blocked-тира (Task 4.13 manager-mode tasks.md).
 *
 * **Validates: Property 4, Requirements 19.7, 19.8, 2.6**
 *
 * Зеркало property-теста из `src/__tests__/engine/contacts.spec.ts`,
 * вынесенное в общий каталог `properties/` для целостной property-suite.
 * Для контакта с `tier="blocked"` функция `decideTierTransition` всегда
 * возвращает `next === "blocked"` независимо от `recentInteractions`,
 * `messagesSinceTransition`, `manualOverride`, `score`. 1000 итераций
 * fast-check.
 */
import { describe, it } from "vitest";
import fc from "fast-check";

import type { ContactRecord, Tier } from "../../types.js";
import { decideTierTransition } from "../../engine/contacts.js";

const arbInteractions = fc.record({
  polite: fc.integer({ min: 0, max: 1000 }),
  boundary: fc.integer({ min: 0, max: 1000 }),
  broken: fc.integer({ min: 0, max: 1000 }),
  promised: fc.integer({ min: 0, max: 1000 }),
  delivered: fc.integer({ min: 0, max: 1000 })
});

const arbBlockedContact = fc.record({
  chatId: fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((s) => /^[A-Za-z0-9_-]+$/.test(s)),
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
}).map((c) => c as ContactRecord);

describe("Property 4 (blocked-monotonicity)", () => {
  it("blocked → blocked для любой последовательности интеракций (1000 итераций)", () => {
    fc.assert(
      fc.property(
        arbBlockedContact,
        fc.array(arbInteractions, { minLength: 1, maxLength: 30 }),
        (contact, sequence) => {
          let current: ContactRecord = contact;
          for (const interactions of sequence) {
            const r = decideTierTransition(current, interactions);
            if (r.next !== "blocked") return false;
            // Имитируем «применение» решения: тир остаётся blocked, счётчик
            // продолжает расти. Это моделирует продолжение чата с
            // заблокированным контактом.
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
