/**
 * Тесты mandate engine (Task 4.3 manager-mode).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { LLMClient, ChatMessage, LLMOptions } from "../../llm/index.js";

let tmpRoot: string;
const SLUG = "test-mandate-engine";
let mod: typeof import("../../engine/mandate.js");

class FakeLLM implements LLMClient {
  public calls = 0;
  constructor(private response: string) {}
  async chat(_messages: ChatMessage[], _opts?: LLMOptions): Promise<string> {
    this.calls++;
    return this.response;
  }
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-mandate-eng-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  // Создаём папку профиля до импорта engine — fs.watch требует её существования.
  await fs.mkdir(path.join(tmpRoot, SLUG), { recursive: true });
  mod = await import("../../engine/mandate.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("defaultFallback (пустой mandate, Requirement 3.10)", () => {
  it("приветствие ≤50 символов → answer-self", () => {
    const r = mod.defaultFallback("Привет!");
    expect(r.decision).toBe("answer-self");
    expect(r.usedFallback).toBe(true);
  });

  it("приветствие > 50 символов → escalate", () => {
    const long = "Привет, у меня большой и сложный вопрос про вашу компанию и продукты, можно?";
    const r = mod.defaultFallback(long);
    expect(r.decision).toBe("escalate");
  });

  it("не приветствие → escalate", () => {
    const r = mod.defaultFallback("сколько стоит ваш продукт?");
    expect(r.decision).toBe("escalate");
  });

  it("пустое сообщение → ignore", () => {
    expect(mod.defaultFallback("").decision).toBe("ignore");
    expect(mod.defaultFallback("   ").decision).toBe("ignore");
  });
});

describe("parseLLMDecision", () => {
  it("парсит валидный JSON", () => {
    const r = mod.parseLLMDecision('{"decision":"escalate","reason":"тест","confidence":0.85}');
    expect(r.decision).toBe("escalate");
    expect(r.reason).toBe("тест");
    expect(r.confidence).toBe(0.85);
    expect(r.usedFallback).toBe(false);
  });

  it("находит JSON среди текста", () => {
    const r = mod.parseLLMDecision('блаблабла {"decision":"answer-self","reason":"ok","confidence":1} конец');
    expect(r.decision).toBe("answer-self");
  });

  it("неизвестный decision → escalate", () => {
    const r = mod.parseLLMDecision('{"decision":"halt","reason":"x","confidence":0.5}');
    expect(r.decision).toBe("escalate");
  });

  it("невалидный JSON → escalate с reason", () => {
    const r = mod.parseLLMDecision("это не json");
    expect(r.decision).toBe("escalate");
    expect(r.reason).toContain("JSON");
  });

  it("clamp confidence в [0,1]", () => {
    expect(mod.parseLLMDecision('{"decision":"ignore","confidence":2}').confidence).toBe(1);
    expect(mod.parseLLMDecision('{"decision":"ignore","confidence":-1}').confidence).toBe(0);
    expect(mod.parseLLMDecision('{"decision":"ignore","confidence":"x"}').confidence).toBe(0);
  });
});

describe("MandateRuntime", () => {
  it("decideAction использует fallback при пустом мандате", async () => {
    const llm = new FakeLLM('{"decision":"escalate"}');
    const rt = new mod.MandateRuntime(SLUG, llm);
    await rt.start();
    rt.setMandateText("");
    const r = await rt.decideAction({ slug: SLUG, incoming: "Привет", tier: "regular" });
    expect(r.decision).toBe("answer-self");
    expect(r.usedFallback).toBe(true);
    expect(llm.calls).toBe(0);
    rt.stop();
  });

  it("decideAction вызывает LLM и парсит ответ при наличии мандата", async () => {
    const llm = new FakeLLM('{"decision":"answer-self","reason":"в мандате","confidence":0.95}');
    const rt = new mod.MandateRuntime(SLUG, llm);
    await rt.start();
    rt.setMandateText("# Mandate\nОтвечать на вопросы о ценах сама");
    const r = await rt.decideAction({ slug: SLUG, incoming: "сколько стоит?", tier: "regular" });
    expect(r.decision).toBe("answer-self");
    expect(r.confidence).toBe(0.95);
    expect(r.usedFallback).toBe(false);
    expect(llm.calls).toBe(1);
    rt.stop();
  });

  it("decideAction кеширует на 60 секунд при одинаковом input", async () => {
    const llm = new FakeLLM('{"decision":"escalate","confidence":0.9}');
    const rt = new mod.MandateRuntime(SLUG, llm);
    await rt.start();
    rt.setMandateText("# Mandate\nЭскалирую новые проекты");
    const ctx = { slug: SLUG, incoming: "новый проект на 5 млн", tier: "regular" };
    await rt.decideAction(ctx);
    await rt.decideAction(ctx);
    await rt.decideAction(ctx);
    expect(llm.calls).toBe(1);
    rt.stop();
  });

  it("setMandateText инвалидирует кеш", async () => {
    const llm = new FakeLLM('{"decision":"escalate","confidence":0.9}');
    const rt = new mod.MandateRuntime(SLUG, llm);
    await rt.start();
    rt.setMandateText("# v1\nправило раз");
    const ctx = { slug: SLUG, incoming: "запрос", tier: "regular" };
    await rt.decideAction(ctx);
    rt.setMandateText("# v2\nдругое правило");
    await rt.decideAction(ctx);
    expect(llm.calls).toBe(2);
    rt.stop();
  });

  it("LLM ошибка → fallback с пометкой", async () => {
    class BadLLM implements LLMClient {
      async chat(): Promise<string> {
        throw new Error("network down");
      }
    }
    const rt = new mod.MandateRuntime(SLUG, new BadLLM());
    await rt.start();
    rt.setMandateText("# Mandate\nправила");
    const r = await rt.decideAction({ slug: SLUG, incoming: "вопрос про скидку", tier: "regular" });
    expect(r.usedFallback).toBe(true);
    expect(r.reason).toContain("LLM error");
    rt.stop();
  });
});
