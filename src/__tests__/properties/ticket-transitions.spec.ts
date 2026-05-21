/**
 * Property 8 — допустимые переходы тикета (Task 4.13 manager-mode tasks.md).
 *
 * **Validates: Property 8, Requirements 19.13, 19.14, 18.3**
 *
 * Зеркало property-теста из `src/__tests__/engine/escalation.spec.ts`,
 * вынесенное в общий каталог `properties/` для целостной property-suite.
 * `transitionTicket` принимает только переходы из явного списка
 * (`open → waiting-boss`, `open → closed`, `waiting-boss → answered`,
 * `waiting-boss → closed`, `answered → closed`). Любой запрещённый переход
 * бросает `disallowed ticket transition: …` и не меняет `ticket.state`;
 * признак разрешённости совпадает с `isAllowedTransition`. 1000 итераций
 * fast-check.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type { TicketState } from "../../types.js";
import {
  createTicket,
  isAllowedTransition,
  transitionTicket
} from "../../engine/escalation.js";

const TICKET_STATES = ["open", "waiting-boss", "answered", "closed"] as const;
const arbState = fc.constantFrom<TicketState>(...TICKET_STATES);
const arbTransition = fc.tuple(arbState, arbState);

describe("Property 8 (ticket transitions)", () => {
  it("любая длина последовательности применима только если каждый шаг разрешён (1000 итераций)", () => {
    fc.assert(
      fc.property(
        fc.array(arbTransition, { minLength: 1, maxLength: 10 }),
        (steps) => {
          let t = createTicket({
            contact: { chatId: "c1" },
            message: "x",
            ticketId: "#T-7",
            now: "2024-01-01T00:00:00.000Z"
          });
          for (const [, to] of steps) {
            if (isAllowedTransition(t.state, to)) {
              t = transitionTicket(t, to, "step", "system");
            } else {
              const stateBefore = t.state;
              try {
                t = transitionTicket(t, to, "bad", "system");
                // Запрещённый переход не должен пройти без исключения.
                return false;
              } catch (err) {
                expect(t.state).toBe(stateBefore);
                expect(String(err)).toMatch(/disallowed ticket transition/);
              }
            }
          }
          return true;
        }
      ),
      { numRuns: 1000 }
    );
  });
});
