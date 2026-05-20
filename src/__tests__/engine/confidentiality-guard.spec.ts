/**
 * Тесты confidentiality-guard (Task 4.1 manager-mode).
 *
 * Property 2 (Requirement 19.3, 19.4): для любого `clientText` без префикса
 * длиннее 80 символов из `summary`/`mandate` — guard не срабатывает.
 * Контр-пример: если в client'е есть фрагмент длиной 81 символ — срабатывает.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  findConfidentialityViolation,
  assertNoLeak
} from "../../engine/confidentiality-guard.js";

const HEX_ALPHA = "0123456789abcdef";

describe("confidentiality-guard", () => {
  it("не срабатывает на пустом клиентском тексте", () => {
    expect(findConfidentialityViolation("", { summary: "x".repeat(200) })).toBeNull();
  });

  it("не срабатывает если нет совпадений", () => {
    const r = findConfidentialityViolation(
      "клиент задал безобидный вопрос про цены",
      { summary: "совершенно другой текст резюме боссу про конфиденциальное" }
    );
    expect(r).toBeNull();
  });

  it("срабатывает на overlap > 80 символов c summary", () => {
    const longShared = "a".repeat(81);
    const r = findConfidentialityViolation(longShared, { summary: longShared });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("summary-overlap");
    expect(r!.matchLength).toBeGreaterThan(80);
  });

  it("не срабатывает на overlap ровно 80 символов (граница)", () => {
    const shared = "b".repeat(80);
    const r = findConfidentialityViolation(shared, { summary: shared + "x".repeat(40) });
    // 80 символов клиентского текста — короче чем требуемый минимум (>80).
    // Алгоритм требует длину минимум 81, значит границей он не сработает.
    expect(r).toBeNull();
  });

  it("срабатывает на mandate overlap независимо от summary", () => {
    const mandate = "решаю сама стандартные приветствия и вопросы про цены до пятидесяти тысяч руб - это полный текст внутреннего мандата.";
    // leakage содержит весь mandate целиком + хвост.
    const leakage = mandate + "abcdefghijklmnopqrst";
    const r = findConfidentialityViolation(leakage, { mandate });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("mandate-overlap");
  });

  it("cross-source с порогом 20 ловит короткие утечки", () => {
    const otherTicketSummary = "клиент Иванов запросил скидку 20% на enterprise";
    // 47 символов — длина больше 20.
    const leak = "...текст с фрагментом " + otherTicketSummary;
    const r = findConfidentialityViolation(leak, {
      crossSources: [{ label: "#T-99", text: otherTicketSummary }]
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("cross-ticket-leak");
    expect(r!.sourceLabel).toBe("#T-99");
  });

  it("cross-source не ловит фрагменты ≤20 символов", () => {
    const otherTicketSummary = "Иванов";
    const r = findConfidentialityViolation(
      "Здравствуйте, я Иванов!",
      { crossSources: [{ label: "#T-99", text: otherTicketSummary }] }
    );
    expect(r).toBeNull();
  });

  it("assertNoLeak бросает с violation в свойстве error", () => {
    const long = "z".repeat(100);
    try {
      assertNoLeak(long, { summary: long });
      throw new Error("должно было кинуть");
    } catch (e) {
      const err = e as Error & { violation?: { kind: string } };
      expect(err.violation?.kind).toBe("summary-overlap");
    }
  });

  it("Property 2: случайный клиентский текст не пересекается со случайным независимым summary", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200, unit: fc.constantFrom(...HEX_ALPHA) }),
        fc.string({ minLength: 100, maxLength: 400, unit: fc.constantFrom(...HEX_ALPHA.toUpperCase()) }),
        (client, summary) => {
          // Поскольку юниты непересекающиеся (lower vs upper hex) — guard
          // не должен срабатывать ни на одной случайной паре.
          const r = findConfidentialityViolation(client, { summary });
          return r === null;
        }
      ),
      { numRuns: 1000 }
    );
  });
});
