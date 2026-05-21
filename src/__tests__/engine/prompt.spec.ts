/**
 * Тесты сборки system prompt в manager-mode (Task 4.11).
 *
 * Покрывают:
 *  - выбор tone-фрагмента под `formal-вы`, `friendly-ты`, `mixed-by-tier`;
 *  - инжект persona-style фрагмента (Req 12.10);
 *  - блок mandate под делимитером `=== Mandate ===`;
 *  - сохранение анти-AI-инструкций оригинала (Req 13.1);
 *  - отсутствие романтических артефактов (`relationship.md`, `stage`, `dumped`);
 *  - смягчённую плотность опечаток (Req 13.5).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ContactRecord, ProfileConfig, Tier, Tone, PersonaStyle } from "../../types.js";

let tmpRoot: string;
const SLUG = "test-prompt-manager";
let promptMod: typeof import("../../engine/prompt.js");
let mdMod: typeof import("../../storage/md.js");
let typosMod: typeof import("../../engine/typos.js");

function makeCfg(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    slug: SLUG,
    name: "Алина",
    age: 27,
    nationality: "RU",
    tz: "Europe/Moscow",
    mode: "bot",
    llm: { presetId: "p", proto: "openai", apiKey: "k", model: "m" },
    telegram: {},
    stage: "manager-default",
    createdAt: new Date().toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0,
    profileType: "manager",
    ...overrides
  } as ProfileConfig;
}

function makeContact(chatId: string, tier: Tier, overrides: Partial<ContactRecord> = {}): ContactRecord {
  const now = new Date().toISOString();
  return {
    chatId,
    tier,
    manualOverride: false,
    createdAt: now,
    updatedAt: now,
    score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 },
    ...overrides
  };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-prompt-spec-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  await fs.mkdir(path.join(tmpRoot, SLUG), { recursive: true });
  promptMod = await import("../../engine/prompt.js");
  mdMod = await import("../../storage/md.js");
  typosMod = await import("../../engine/typos.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  // Чистим артефакты предыдущего теста: mandate, контакты, persona/speech.
  await fs.rm(path.join(tmpRoot, SLUG), { recursive: true, force: true });
  await fs.mkdir(path.join(tmpRoot, SLUG), { recursive: true });
});

describe("buildSystemPrompt — tone (Req 12.5-12.9)", () => {
  it("formal-вы → встроен фрагмент про обращение «вы»", async () => {
    const cfg = makeCfg({ tone: "formal-вы" });
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "100" });
    expect(sys).toMatch(/Тон: деловой «вы»/);
    expect(sys).toMatch(/обращайся на «вы»/);
  });

  it("friendly-ты → встроен фрагмент про обращение «ты»", async () => {
    const cfg = makeCfg({ tone: "friendly-ты" });
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "200" });
    expect(sys).toMatch(/Тон: дружеский «ты»/);
    expect(sys).toMatch(/обращайся на «ты»/);
  });

  it("mixed-by-tier + cold-stranger → формальный фрагмент и «вы» в инструкции", async () => {
    const cfg = makeCfg({ tone: "mixed-by-tier" });
    const sys = await promptMod.buildSystemPrompt(cfg, {
      chatId: "300",
      contactTier: "cold-stranger"
    });
    expect(sys).toMatch(/Тон: смешанный/);
    // Резолвится «вы» для cold-stranger
    expect(sys).toMatch(/Для этого контакта обращайся на «вы»/);
  });

  it("mixed-by-tier + regular → «ты» в инструкции", async () => {
    const cfg = makeCfg({ tone: "mixed-by-tier" });
    const sys = await promptMod.buildSystemPrompt(cfg, {
      chatId: "400",
      contactTier: "regular"
    });
    expect(sys).toMatch(/Тон: смешанный/);
    expect(sys).toMatch(/Для этого контакта обращайся на «ты»/);
  });

  it("отсутствует контакт → tier=cold-stranger, в mixed-by-tier применяется «вы» (Req 12.9)", async () => {
    const cfg = makeCfg({ tone: "mixed-by-tier" });
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "500" });
    expect(sys).toMatch(/Для этого контакта обращайся на «вы»/);
    // Заглушка про отсутствие карточки.
    expect(sys).toMatch(/Карточка для chat_id=500 ещё не создана/);
  });

  it("дефолтный tone (поле не задано) → mixed-by-tier (Req 12.3)", async () => {
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "600", contactTier: "regular" });
    expect(sys).toMatch(/Тон: смешанный/);
  });
});

describe("buildSystemPrompt — persona-style (Req 12.10)", () => {
  it("female-secretary → встроен соответствующий фрагмент", async () => {
    const cfg = makeCfg({ personaStyle: "female-secretary" });
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "700" });
    expect(sys).toMatch(/Образ: женщина-секретарь/);
    expect(sys).toMatch(/Глаголы в женском роде/);
  });

  it("male-secretary → мужской фрагмент", async () => {
    const cfg = makeCfg({ personaStyle: "male-secretary" });
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "701" });
    expect(sys).toMatch(/Образ: мужчина-секретарь/);
  });

  it("дефолтный persona-style → gender-neutral-assistant (Req 12.4)", async () => {
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "702" });
    expect(sys).toMatch(/нейтральный ассистент/);
  });

  it("неизвестное значение persona-style → fallback gender-neutral-assistant", async () => {
    const cfg = makeCfg({ personaStyle: "weird-style" as PersonaStyle });
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "703" });
    expect(sys).toMatch(/нейтральный ассистент/);
  });
});

describe("buildSystemPrompt — mandate", () => {
  it("текст mandate.md встроен под делимитером === Mandate ===", async () => {
    await mdMod.saveMandate(SLUG, "# Mandate\nОтвечаю сама на короткие приветствия.");
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "800" });
    expect(sys).toContain("=== Mandate ===");
    expect(sys).toContain("=== /Mandate ===");
    expect(sys).toContain("Отвечаю сама на короткие приветствия.");
    expect(sys).toMatch(/Никогда не цитируй его дословно/);
  });

  it("пустой mandate → блок не вставляется", async () => {
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "801" });
    expect(sys).not.toContain("=== Mandate ===");
  });

  it("mandateOverride перекрывает чтение из файла", async () => {
    await mdMod.saveMandate(SLUG, "ИЗ ФАЙЛА");
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, {
      chatId: "802",
      mandateOverride: "ИЗ ОВЕРРАЙДА"
    });
    expect(sys).toContain("ИЗ ОВЕРРАЙДА");
    expect(sys).not.toContain("ИЗ ФАЙЛА");
  });
});

describe("buildSystemPrompt — анти-AI правила (Req 13.1)", () => {
  it("содержит критическое правило про роль и markdown", async () => {
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "900" });
    expect(sys).toContain("# КРИТИЧЕСКИ ВАЖНО — РОЛЬ");
    expect(sys).toContain("НИКОГДА не используй markdown");
    expect(sys).toContain("# АНТИ-AI-SLOP");
    expect(sys).toContain("Конечно!");
  });

  it("не содержит ссылок на relationship.md и романтические термины", async () => {
    const cfg = makeCfg();
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "901" });
    expect(sys).not.toContain("relationship.md");
    expect(sys.toLowerCase()).not.toContain("dumped");
    expect(sys).not.toMatch(/boundary breach/i);
    // legacy stage-блок старого girl-agent должен быть удалён
    expect(sys).not.toMatch(/## relationship \(legacy/);
  });
});

describe("buildSystemPrompt — контактная карточка и memory-palace per chatId (Req 13.6)", () => {
  it("при наличии контактной карточки в prompt попадают tier и notes", async () => {
    const cfg = makeCfg();
    const contact = makeContact("1234", "vip", {
      username: "anna",
      notes: "VIP-клиент, проект на 5 млн"
    });
    await mdMod.saveContact(SLUG, contact);
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "1234" });
    expect(sys).toMatch(/## Контакт/);
    expect(sys).toMatch(/chat_id=1234/);
    expect(sys).toMatch(/tier=vip/);
    expect(sys).toMatch(/проект на 5 млн/);
  });

  it("memory-palace ключ включает chatId", async () => {
    const cfg = makeCfg();
    // Создадим shared-memory с маркерами user:111 и user:222 (формат
    // appendSharedMemory). Память по ключу chatId=111 должна включать
    // только релевантные строки.
    await mdMod.appendSharedMemory(SLUG, cfg.tz, 111, "клиент 111 спросил про скидку");
    await mdMod.appendSharedMemory(SLUG, cfg.tz, 222, "клиент 222 ругался на сроки");
    const sys = await promptMod.buildSystemPrompt(cfg, { chatId: "111" });
    expect(sys).toMatch(/key=test-prompt-manager:111/);
    expect(sys).toMatch(/клиент 111 спросил про скидку/);
    expect(sys).not.toMatch(/клиент 222 ругался/);
  });
});

describe("typos: смягчённый пресет (Req 13.5)", () => {
  it("MANAGER_TYPO_DENSITY строго меньше ORIGINAL_TYPO_DENSITY", () => {
    expect(typosMod.MANAGER_TYPO_DENSITY).toBeLessThan(typosMod.ORIGINAL_TYPO_DENSITY);
  });

  it("дефолтная плотность injectTypos строго меньше плотности оригинального пресета (Req 13.5)", () => {
    const sample = "это длинный тестовый текст про работу секретаря, "
      + "который мы прогоняем через injectTypos много раз чтобы оценить плотность опечаток. "
      + "плотность должна быть невысокой потому что менеджер не может писать клиентам с большим количеством ошибок. "
      + "берём ещё пару предложений для статистики и устойчивости числа против разброса random.";
    // Сравниваем дефолтный (manager) пресет против явного оригинального
    // density=ORIGINAL_TYPO_DENSITY на одинаковом семпле и одинаковом числе
    // прогонов. Дисперсия большая, поэтому сравниваем средние.
    const N = 200;
    let managerDiff = 0;
    let originalDiff = 0;
    for (let i = 0; i < N; i++) {
      managerDiff += countDiff(sample, typosMod.injectTypos(sample));
      originalDiff += countDiff(sample, typosMod.injectTypos(sample, { intensity: typosMod.ORIGINAL_TYPO_DENSITY }));
    }
    expect(managerDiff).toBeLessThan(originalDiff);
    // Дополнительная sanity: новая плотность ≤ половина старой ± шум.
    expect(managerDiff).toBeLessThan(originalDiff * 0.8);
  });

  it("pickTypoIntensity возвращает 0 примерно в 70% случаев и невысокий base иначе", () => {
    // Прогон 200 раз, считаем сколько 0 и какой средний non-zero base.
    let zeros = 0;
    let nonZeroSum = 0;
    let nonZeroCount = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const v = typosMod.pickTypoIntensity({ messageStyle: "balanced" });
      if (v === 0) zeros++;
      else { nonZeroSum += v; nonZeroCount++; }
    }
    // Доля нулей — приблизительно 0.7 (тест устойчивый: разрешим 0.5..0.85).
    expect(zeros / N).toBeGreaterThan(0.5);
    expect(zeros / N).toBeLessThan(0.85);
    if (nonZeroCount > 0) {
      const avg = nonZeroSum / nonZeroCount;
      // base в balanced — 0.02. Должно быть существенно меньше 0.06 (оригинал).
      expect(avg).toBeLessThan(typosMod.ORIGINAL_TYPO_DENSITY);
    }
  });
});

function countDiff(a: string, b: string): number {
  // Простейшая Levenshtein-приближённая метрика: считаем сколько позиций
  // отличаются после выравнивания по длине; для оценки плотности этого хватит.
  if (a === b) return 0;
  const minLen = Math.min(a.length, b.length);
  let diff = Math.abs(a.length - b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff;
}

// Helper-проверка, что дженерик Tone тип не сломан в тесте (для type-check).
const _toneCheck: Tone = "mixed-by-tier";
void _toneCheck;
