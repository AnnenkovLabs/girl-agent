/**
 * Тесты `tickEscalationTimeouts` (Task 4.6 manager-mode, Requirement 5).
 */
import { describe, it, expect } from "vitest";
import { createTicket, transitionTicket, tickEscalationTimeouts } from "../../engine/escalation.js";
import type { TicketsFile } from "../../types.js";

function makeWaitingBoss(id: string, createdAt: string, opts: Partial<{ timeoutNotified: boolean }> = {}) {
  let t = createTicket({
    contact: { chatId: `c${id}` },
    message: "x",
    ticketId: id,
    now: createdAt
  });
  t = transitionTicket(t, "waiting-boss", "hold-sent", "system", createdAt);
  if (opts.timeoutNotified) t.timeoutNotified = true;
  return t;
}

function makeAnswered(id: string, createdAt: string, bossReplyAt: string) {
  let t = createTicket({
    contact: { chatId: `c${id}` },
    message: "x",
    ticketId: id,
    now: createdAt
  });
  t = transitionTicket(t, "waiting-boss", "hold-sent", "system", createdAt);
  t = transitionTicket(t, "answered", "boss-reply", "boss", bossReplyAt);
  t.bossReplyAt = bossReplyAt;
  return t;
}

describe("tickEscalationTimeouts", () => {
  it("шлёт notify-timeout если прошло >= escalationTimeoutMin минут", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 2,
      tickets: [makeWaitingBoss("#T-1", "2024-01-01T00:00:00.000Z")]
    };
    // 5 часов прошло
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-01T05:00:00.000Z"),
      escalationTimeoutMin: 240
    });
    expect(r.actions[0]?.kind).toBe("notify-timeout");
    expect(r.flagNotified).toContain("#T-1");
  });

  it("не шлёт повторно если уже timeoutNotified=true", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 2,
      tickets: [makeWaitingBoss("#T-1", "2024-01-01T00:00:00.000Z", { timeoutNotified: true })]
    };
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-01T05:00:00.000Z"),
      escalationTimeoutMin: 240
    });
    const notifies = r.actions.filter(a => a.kind === "notify-timeout");
    expect(notifies).toHaveLength(0);
  });

  it("шлёт close-boss-timeout после 24 часов", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 2,
      tickets: [makeWaitingBoss("#T-1", "2024-01-01T00:00:00.000Z", { timeoutNotified: true })]
    };
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-02T01:00:00.000Z"),
      escalationTimeoutMin: 240
    });
    expect(r.actions.some(a => a.kind === "close-boss-timeout")).toBe(true);
  });

  it("шлёт close-client-confirm после 600 секунд от bossReplyAt", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 2,
      tickets: [makeAnswered("#T-1", "2024-01-01T00:00:00.000Z", "2024-01-01T01:00:00.000Z")]
    };
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-01T01:11:00.000Z"),
      escalationTimeoutMin: 240
    });
    expect(r.actions[0]?.kind).toBe("close-client-confirm");
  });

  it("текст уведомления валидируется на длину 20..200, иначе fallback", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 2,
      tickets: [makeWaitingBoss("#T-1", "2024-01-01T00:00:00.000Z")]
    };
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-01T05:00:00.000Z"),
      escalationTimeoutMin: 240,
      notifyText: "ох"
    });
    const a = r.actions[0];
    expect(a?.kind).toBe("notify-timeout");
    if (a?.kind === "notify-timeout") {
      expect(a.text.length).toBeGreaterThanOrEqual(20);
      expect(a.text.length).toBeLessThanOrEqual(200);
    }
  });

  it("clamp escalationTimeoutMin в [5,1440]", () => {
    const file: TicketsFile = {
      version: 1,
      nextId: 2,
      tickets: [makeWaitingBoss("#T-1", "2024-01-01T00:00:00.000Z")]
    };
    // Задаём 0 — должно clamp'нуться до 5 минут.
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-01T00:06:00.000Z"),
      escalationTimeoutMin: 0
    });
    expect(r.actions[0]?.kind).toBe("notify-timeout");
  });

  it("ничего не шлёт если все тикеты closed/open", () => {
    let t1 = createTicket({ contact: { chatId: "c1" }, message: "x", ticketId: "#T-1", now: "2024-01-01T00:00:00.000Z" });
    t1 = transitionTicket(t1, "waiting-boss", "x", "system", "2024-01-01T00:00:00.000Z");
    t1 = transitionTicket(t1, "closed", "x", "system", "2024-01-01T00:01:00.000Z");
    const t2 = createTicket({ contact: { chatId: "c2" }, message: "x", ticketId: "#T-2", now: "2024-01-01T00:00:00.000Z" });
    const file: TicketsFile = { version: 1, nextId: 3, tickets: [t1, t2] };
    const r = tickEscalationTimeouts(file, {
      now: new Date("2024-01-02T00:00:00.000Z"),
      escalationTimeoutMin: 240
    });
    expect(r.actions).toHaveLength(0);
  });
});
