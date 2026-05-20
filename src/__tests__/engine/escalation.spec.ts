/**
 * Тесты escalation core (Task 4.5 manager-mode).
 *
 * Property 8 (Requirement 19.13): для любого тикета любая последовательность
 * допустимых переходов завершается в `closed` или висит в waiting-boss/answered;
 * запрещённые переходы всегда отклоняются.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type { LLMClient, ChatMessage, LLMOptions } from "../../llm/index.js";
import {
  createTicket,
  transitionTicket,
  isAllowedTransition,
  summarizeForBoss,
  composeClientReplyFromBoss,
  ticketStateCounts,
  ESCALATION_INTERNALS
} from "../../engine/escalation.js";
import type { TicketState, TicketsFile } from "../../types.js";

class FakeLLM implements LLMClient {
  public calls = 0;
  constructor(private response: string | Error) {}
  async chat(_m: ChatMessage[], _o?: LLMOptions): Promise<string> {
    this.calls++;
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

class TimeoutLLM implements LLMClient {
  async chat(): Promise<string> {
    return new Promise((resolve) => setTimeout(() => resolve("late"), 50_000));
  }
}

describe("createTicket", () => {
  it("создаёт тикет в open с initial transition", () => {
    const t = createTicket({
      contact: { chatId: "c1", username: "alice" },
      message: "вопрос",
      ticketId: "#T-1",
      now: "2024-01-01T00:00:00.000Z"
    });
    expect(t.id).toBe("#T-1");
    expect(t.state).toBe("open");
    expect(t.history).toHaveLength(1);
    expect(t.history[0]?.from).toBe("<initial>");
    expect(t.history[0]?.to).toBe("open");
    expect(t.summary).toBe("");
  });

  it("обрезает initialSummary до 500 символов", () => {
    const t = createTicket({
      contact: { chatId: "c1" },
      message: "x",
      ticketId: "#T-2",
      initialSummary: "a".repeat(600)
    });
    expect(t.summary.length).toBe(500);
  });
});

describe("transitionTicket", () => {
  const base = createTicket({
    contact: { chatId: "c1", username: "alice" },
    message: "x",
    ticketId: "#T-1",
    now: "2024-01-01T00:00:00.000Z"
  });

  it("разрешённые переходы добавляют запись в history", () => {
    const a = transitionTicket(base, "waiting-boss", "hold-sent", "system", "2024-01-01T00:01:00.000Z");
    expect(a.state).toBe("waiting-boss");
    expect(a.history).toHaveLength(2);
    const b = transitionTicket(a, "answered", "boss-reply", "boss", "2024-01-01T00:02:00.000Z");
    expect(b.state).toBe("answered");
    expect(b.history).toHaveLength(3);
    const c = transitionTicket(b, "closed", "client-confirm-timeout", "system", "2024-01-01T00:12:00.000Z");
    expect(c.state).toBe("closed");
    expect(c.closedAt).toBe("2024-01-01T00:12:00.000Z");
  });

  it("запрещённые переходы бросают (Requirement 18.4)", () => {
    expect(() => transitionTicket(base, "answered", "wrong")).toThrow(/disallowed/);
  });

  it("isAllowedTransition отображает список", () => {
    expect(isAllowedTransition("<initial>", "open")).toBe(true);
    expect(isAllowedTransition("open", "waiting-boss")).toBe(true);
    expect(isAllowedTransition("waiting-boss", "answered")).toBe(true);
    expect(isAllowedTransition("answered", "open")).toBe(false);
    expect(isAllowedTransition("closed", "open")).toBe(false);
  });
});

describe("summarizeForBoss", () => {
  const contact = { chatId: "c1", username: "alice" };

  it("возвращает фолбэк при отсутствии LLM", async () => {
    const r = await summarizeForBoss({ message: "x", contact });
    expect(r).toBe(ESCALATION_INTERNALS.FALLBACK_SUMMARY);
  });

  it("возвращает обрезанный ответ LLM (≤500)", async () => {
    const llm = new FakeLLM("a".repeat(700));
    const r = await summarizeForBoss({ message: "x", contact, llm });
    expect(r.length).toBe(ESCALATION_INTERNALS.SUMMARY_MAX_LEN);
  });

  it("возвращает фолбэк при ошибке LLM", async () => {
    const llm = new FakeLLM(new Error("network"));
    const r = await summarizeForBoss({ message: "x", contact, llm });
    expect(r).toBe(ESCALATION_INTERNALS.FALLBACK_SUMMARY);
  });

  it("возвращает фолбэк при таймауте", async () => {
    const llm = new TimeoutLLM();
    const r = await summarizeForBoss({ message: "x", contact, llm, timeoutMs: 50 });
    expect(r).toBe(ESCALATION_INTERNALS.FALLBACK_SUMMARY);
  });
});

describe("composeClientReplyFromBoss", () => {
  const baseTicket = createTicket({
    contact: { chatId: "c1", username: "alice" },
    message: "вопрос",
    ticketId: "#T-1",
    now: "2024-01-01T00:00:00.000Z",
    initialSummary: "клиент спрашивает про скидку"
  });

  it("без LLM отдаёт сырой текст босса", async () => {
    const r = await composeClientReplyFromBoss({ ticket: baseTicket, bossReplyText: "ок, 5%" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.text).toBe("ок, 5%");
  });

  it("блокирует ответ с overlap >80 символов с summary", async () => {
    const longSummary = "клиент Иванов запросил скидку на enterprise тариф потому что у него закончился бюджет на этот квартал и он не может продолжать без скидки прямо сейчас";
    const t = { ...baseTicket, summary: longSummary };
    const r = await composeClientReplyFromBoss({ ticket: t, bossReplyText: longSummary });
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") expect(r.violationKind).toBe("summary-overlap");
  });

  it("блокирует ответ при cross-leak (другой тикет)", async () => {
    const otherTicketSummary = "клиент Петров обсуждает новый контракт на 2 миллиона";
    const r = await composeClientReplyFromBoss({
      ticket: baseTicket,
      bossReplyText: "просто ответ\n" + otherTicketSummary,
      crossSources: [{ label: "#T-99", text: otherTicketSummary }]
    });
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") expect(r.violationKind).toBe("cross-ticket-leak");
  });

  it("LLM перефразировка применяется если результат не пустой", async () => {
    const llm = new FakeLLM("безопасный человеческий ответ клиенту");
    const r = await composeClientReplyFromBoss({ ticket: baseTicket, bossReplyText: "техническое сообщение", llm });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.text).toBe("безопасный человеческий ответ клиенту");
  });
});

describe("Property 8 (ticket transitions)", () => {
  const arbState = fc.constantFrom<TicketState>("open", "waiting-boss", "answered", "closed");
  const arbTransition = fc.tuple(arbState, arbState);

  it("любая длина последовательности применима только если каждый шаг разрешён", () => {
    fc.assert(
      fc.property(fc.array(arbTransition, { minLength: 1, maxLength: 10 }), (steps) => {
        let t = createTicket({
          contact: { chatId: "c1" },
          message: "x",
          ticketId: "#T-7",
          now: "2024-01-01T00:00:00.000Z"
        });
        for (const [_from, to] of steps) {
          if (isAllowedTransition(t.state, to)) {
            t = transitionTicket(t, to, "step", "system");
          } else {
            // запрещённый переход не должен менять state
            const stateBefore = t.state;
            try {
              t = transitionTicket(t, to, "bad", "system");
              return false;
            } catch {
              expect(t.state).toBe(stateBefore);
            }
          }
        }
        return true;
      }),
      { numRuns: 1000 }
    );
  });
});

describe("ticketStateCounts", () => {
  it("считает по state", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 5,
      tickets: [
        { ...createTicket({ contact: { chatId: "a" }, message: "x", ticketId: "#T-1" }), state: "open" },
        { ...createTicket({ contact: { chatId: "b" }, message: "x", ticketId: "#T-2" }), state: "waiting-boss" },
        { ...createTicket({ contact: { chatId: "c" }, message: "x", ticketId: "#T-3" }), state: "answered" },
        { ...createTicket({ contact: { chatId: "d" }, message: "x", ticketId: "#T-4" }), state: "closed" }
      ]
    };
    expect(ticketStateCounts(file)).toEqual({ open: 1, "waiting-boss": 1, answered: 1, closed: 1 });
  });
});
