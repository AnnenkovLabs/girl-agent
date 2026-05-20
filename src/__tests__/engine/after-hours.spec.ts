/**
 * Тесты after-hours роутера (Task 4.9 manager-mode, Requirement 8).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateAfterHours,
  computeOffWindowStart,
  snapshotAfterHours,
  DEFAULT_AFTER_HOURS_AUTO_REPLY,
  type AfterHoursDecision
} from "../../engine/after-hours.js";
import type { ContactRecord, ProfileConfig, Tier } from "../../types.js";

function baseConfig(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    slug: "x",
    name: "x",
    age: 22,
    nationality: "RU",
    tz: "UTC",
    mode: "bot",
    llm: { presetId: "x", proto: "anthropic", apiKey: "k", model: "m" },
    telegram: {},
    stage: "manager-default",
    createdAt: new Date(2024, 0, 1).toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0,
    ...overrides
  };
}

function contactWith(tier: Tier, overrides: Partial<ContactRecord> = {}): ContactRecord {
  const now = new Date(Date.UTC(2024, 0, 1, 0, 0)).toISOString();
  return {
    chatId: "100",
    tier,
    score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 },
    manualOverride: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("evaluateAfterHours — рабочие часы", () => {
  it("возвращает normal независимо от политики, если isOutOfHours=false", () => {
    const now = new Date(Date.UTC(2024, 0, 1, 12, 0));
    for (const policy of ["silent", "auto-reply", "vip-only"] as const) {
      const decision = evaluateAfterHours({
        policy,
        contact: contactWith("regular"),
        isOutOfHours: false,
        now,
        lastOutWindowStart: null
      });
      expect(decision).toEqual<AfterHoursDecision>({ action: "normal" });
    }
  });
});

describe("evaluateAfterHours — silent", () => {
  it("всегда возвращает silent вне рабочих часов", () => {
    const decision = evaluateAfterHours({
      policy: "silent",
      contact: contactWith("regular"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0))
    });
    expect(decision).toEqual<AfterHoursDecision>({ action: "silent" });
  });

  it("игнорирует уже сохранённый lastAutoReplyAt", () => {
    const decision = evaluateAfterHours({
      policy: "silent",
      contact: contactWith("regular", {
        lastAutoReplyAt: new Date(Date.UTC(2024, 0, 1, 1, 0)).toISOString()
      }),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0))
    });
    expect(decision.action).toBe("silent");
  });
});

describe("evaluateAfterHours — auto-reply", () => {
  it("возвращает auto-reply с дефолтным текстом, если ещё не отвечали", () => {
    const decision = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0))
    });
    expect(decision.action).toBe("auto-reply");
    if (decision.action === "auto-reply") {
      expect(decision.text).toBe(DEFAULT_AFTER_HOURS_AUTO_REPLY);
      expect(decision.text.length).toBeGreaterThanOrEqual(20);
      expect(decision.text.length).toBeLessThanOrEqual(200);
    }
  });

  it("возвращает auto-reply-skip, если в этом же окне уже был auto-reply", () => {
    const lastWindow = new Date(Date.UTC(2024, 0, 1, 0, 0));
    const lastReply = new Date(Date.UTC(2024, 0, 1, 1, 0));
    const decision = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular", { lastAutoReplyAt: lastReply.toISOString() }),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: lastWindow
    });
    expect(decision).toEqual<AfterHoursDecision>({
      action: "auto-reply-skip",
      reason: "already-replied-in-window"
    });
  });

  it("снова отправляет auto-reply, если предыдущий был в прошлом off-окне", () => {
    // Предыдущий auto-reply был вчера ночью, новое off-окно начинается сегодня ночью.
    const prevReply = new Date(Date.UTC(2024, 0, 1, 1, 0)).toISOString();
    const newWindowStart = new Date(Date.UTC(2024, 0, 2, 0, 0));
    const decision = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular", { lastAutoReplyAt: prevReply }),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 2, 2, 0)),
      lastOutWindowStart: newWindowStart
    });
    expect(decision.action).toBe("auto-reply");
  });

  it("использует кастомный autoReplyText, если он валиден", () => {
    const decision = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0)),
      autoReplyText: "Извините, сейчас не на связи, отвечу утром."
    });
    expect(decision.action).toBe("auto-reply");
    if (decision.action === "auto-reply") {
      expect(decision.text).toBe("Извините, сейчас не на связи, отвечу утром.");
    }
  });

  it("отбраковывает невалидный autoReplyText (короткий/markdown/эмодзи) и берёт дефолт", () => {
    const tooShort = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0)),
      autoReplyText: "коротко"
    });
    expect(tooShort.action).toBe("auto-reply");
    if (tooShort.action === "auto-reply") {
      expect(tooShort.text).toBe(DEFAULT_AFTER_HOURS_AUTO_REPLY);
    }

    const md = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0)),
      autoReplyText: "**Внерабочее** время, отвечу позже как смогу."
    });
    expect(md.action).toBe("auto-reply");
    if (md.action === "auto-reply") {
      expect(md.text).toBe(DEFAULT_AFTER_HOURS_AUTO_REPLY);
    }

    const emoji = evaluateAfterHours({
      policy: "auto-reply",
      contact: contactWith("regular"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0)),
      autoReplyText: "Сейчас вне рабочих часов 🌙, отвечу позже как смогу."
    });
    expect(emoji.action).toBe("auto-reply");
    if (emoji.action === "auto-reply") {
      expect(emoji.text).toBe(DEFAULT_AFTER_HOURS_AUTO_REPLY);
    }
  });
});

describe("evaluateAfterHours — vip-only", () => {
  const now = new Date(Date.UTC(2024, 0, 1, 2, 0));
  const lastOutWindowStart = new Date(Date.UTC(2024, 0, 1, 0, 0));

  it("vip → normal", () => {
    const d = evaluateAfterHours({
      policy: "vip-only",
      contact: contactWith("vip"),
      isOutOfHours: true,
      now,
      lastOutWindowStart
    });
    expect(d).toEqual<AfterHoursDecision>({ action: "normal" });
  });

  it("trusted-partner → normal", () => {
    const d = evaluateAfterHours({
      policy: "vip-only",
      contact: contactWith("trusted-partner"),
      isOutOfHours: true,
      now,
      lastOutWindowStart
    });
    expect(d).toEqual<AfterHoursDecision>({ action: "normal" });
  });

  it.each<Tier>(["regular", "introduced", "cold-stranger"])(
    "%s → auto-reply",
    (tier) => {
      const d = evaluateAfterHours({
        policy: "vip-only",
        contact: contactWith(tier),
        isOutOfHours: true,
        now,
        lastOutWindowStart
      });
      expect(d.action).toBe("auto-reply");
    }
  );

  it("если контакта нет (Req 8.8) — auto-reply", () => {
    const d = evaluateAfterHours({
      policy: "vip-only",
      contact: undefined,
      isOutOfHours: true,
      now,
      lastOutWindowStart
    });
    expect(d.action).toBe("auto-reply");
  });

  it("vip-only + регулярный контакт + уже отвечали → auto-reply-skip", () => {
    const d = evaluateAfterHours({
      policy: "vip-only",
      contact: contactWith("regular", {
        lastAutoReplyAt: new Date(Date.UTC(2024, 0, 1, 1, 0)).toISOString()
      }),
      isOutOfHours: true,
      now,
      lastOutWindowStart
    });
    expect(d).toEqual<AfterHoursDecision>({
      action: "auto-reply-skip",
      reason: "already-replied-in-window"
    });
  });
});

describe("evaluateAfterHours — нормализация политики", () => {
  it("undefined → vip-only", () => {
    const d = evaluateAfterHours({
      policy: undefined,
      contact: contactWith("vip"),
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: new Date(Date.UTC(2024, 0, 1, 0, 0))
    });
    expect(d.action).toBe("normal");
  });
});

describe("computeOffWindowStart", () => {
  it("возвращает null в рабочих часах", () => {
    const cfg = baseConfig({ sleepFrom: 23, sleepTo: 8, tz: "UTC" });
    // 12:00 UTC — день, рабочее время.
    expect(computeOffWindowStart(cfg, new Date(Date.UTC(2024, 0, 1, 12, 0)))).toBeNull();
  });

  it("возвращает момент перехода work→off для sleep-окна (UTC, 23→8)", () => {
    const cfg = baseConfig({ sleepFrom: 23, sleepTo: 8, tz: "UTC" });
    // 02:00 UTC: ночь, off-окно начиналось в 23:00 UTC прошлого дня.
    const start = computeOffWindowStart(cfg, new Date(Date.UTC(2024, 0, 2, 2, 0)));
    expect(start).not.toBeNull();
    // Граница может оказаться внутри последней «рабочей» минуты (22:59) или
    // первой минуты off-окна (23:00) — допускаем плюс-минус минуту.
    if (start) {
      const expected = Date.UTC(2024, 0, 1, 23, 0);
      expect(Math.abs(start.getTime() - expected)).toBeLessThanOrEqual(60 * 1000);
    }
  });

  it("учитывает Europe/Moscow (UTC+3) при sleep 0→7", () => {
    // sleepFrom=0, sleepTo=7 в Moscow. UTC 22:00 = MSK 01:00 → off-окно.
    const cfg = baseConfig({ sleepFrom: 0, sleepTo: 7, tz: "Europe/Moscow" });
    const now = new Date(Date.UTC(2024, 0, 1, 22, 0));
    const start = computeOffWindowStart(cfg, now);
    expect(start).not.toBeNull();
    // Off начался в MSK 00:00 = UTC 21:00.
    if (start) {
      const expected = Date.UTC(2024, 0, 1, 21, 0);
      expect(Math.abs(start.getTime() - expected)).toBeLessThanOrEqual(60 * 1000);
    }
  });

  it("учитывает busy-слот как off-окно", () => {
    // 2024-01-01 — понедельник.
    const cfg = baseConfig({
      sleepFrom: 0,
      sleepTo: 0, // sleep отключён (sleepFrom===sleepTo)
      tz: "UTC",
      busySchedule: [{ label: "stand-up", from: "10:00", to: "11:30", days: ["mon"] }]
    });
    const now = new Date(Date.UTC(2024, 0, 1, 11, 0));
    const start = computeOffWindowStart(cfg, now);
    expect(start).not.toBeNull();
    if (start) {
      const expected = Date.UTC(2024, 0, 1, 10, 0);
      expect(Math.abs(start.getTime() - expected)).toBeLessThanOrEqual(60 * 1000);
    }
  });

  it("обрабатывает sleep-окно через полночь (sleepFrom=22, sleepTo=6)", () => {
    const cfg = baseConfig({ sleepFrom: 22, sleepTo: 6, tz: "UTC" });
    const now = new Date(Date.UTC(2024, 0, 2, 0, 30));
    const start = computeOffWindowStart(cfg, now);
    expect(start).not.toBeNull();
    if (start) {
      const expected = Date.UTC(2024, 0, 1, 22, 0);
      expect(Math.abs(start.getTime() - expected)).toBeLessThanOrEqual(60 * 1000);
    }
  });
});

describe("snapshotAfterHours", () => {
  it("возвращает {true, Date} в off-окне", () => {
    const cfg = baseConfig({ sleepFrom: 23, sleepTo: 8, tz: "UTC" });
    const snap = snapshotAfterHours(cfg, new Date(Date.UTC(2024, 0, 2, 2, 0)));
    expect(snap.isOutOfHours).toBe(true);
    expect(snap.lastOutWindowStart).not.toBeNull();
  });

  it("возвращает {false, null} в рабочее время", () => {
    const cfg = baseConfig({ sleepFrom: 23, sleepTo: 8, tz: "UTC" });
    const snap = snapshotAfterHours(cfg, new Date(Date.UTC(2024, 0, 1, 12, 0)));
    expect(snap.isOutOfHours).toBe(false);
    expect(snap.lastOutWindowStart).toBeNull();
  });
});

describe("сценарий: один auto-reply на off-окно, переход в новое окно", () => {
  it("первый вход → auto-reply, второй в том же окне → skip, в следующем окне → снова auto-reply", () => {
    // Симулируем три захода: 02:00, 04:00 (то же ночное окно) и 02:00 следующих суток
    // (новое окно после рабочего дня).
    const policy = "auto-reply" as const;
    const lastWindow = new Date(Date.UTC(2024, 0, 1, 0, 0));
    const second = new Date(Date.UTC(2024, 0, 1, 4, 0));
    const nextWindow = new Date(Date.UTC(2024, 0, 2, 0, 0));
    const third = new Date(Date.UTC(2024, 0, 2, 2, 0));

    const firstContact = contactWith("regular");
    const first = evaluateAfterHours({
      policy,
      contact: firstContact,
      isOutOfHours: true,
      now: new Date(Date.UTC(2024, 0, 1, 2, 0)),
      lastOutWindowStart: lastWindow
    });
    expect(first.action).toBe("auto-reply");

    // Эмулируем persist `lastAutoReplyAt` после первого ответа.
    const afterFirst = contactWith("regular", {
      lastAutoReplyAt: new Date(Date.UTC(2024, 0, 1, 2, 0)).toISOString()
    });
    const secondDec = evaluateAfterHours({
      policy,
      contact: afterFirst,
      isOutOfHours: true,
      now: second,
      lastOutWindowStart: lastWindow
    });
    expect(secondDec.action).toBe("auto-reply-skip");

    // Новое off-окно (`lastOutWindowStart` сдвинулось).
    const thirdDec = evaluateAfterHours({
      policy,
      contact: afterFirst,
      isOutOfHours: true,
      now: third,
      lastOutWindowStart: nextWindow
    });
    expect(thirdDec.action).toBe("auto-reply");
  });
});
