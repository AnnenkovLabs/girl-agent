/**
 * Mandate engine для manager-mode (Task 4.3 manager-mode tasks.md).
 *
 * Загружает `data/<slug>/mandate.md`, держит in-memory кеш с hot-reload через
 * `subscribeMandate` (Requirement 3.1, 3.2). `decideAction(ctx)` принимает
 * одно решение из закрытого множества `{answer-self, escalate, decline,
 * ignore}` через структурированный JSON-ответ LLM, с локальным кешем 60 секунд
 * на одинаковый input (Requirement 3.4). Если `mandate.md` пустой — работает
 * fallback из Requirement 3.10 (короткие приветствия → answer-self, всё
 * остальное → escalate).
 *
 * Ошибки чтения файла не валят профиль: сохраняем последнюю успешную версию в
 * памяти и логируем (Requirement 3.3).
 */

import type { LLMClient, ChatMessage } from "../llm/index.js";
import type { EscalationDecision } from "../types.js";
import { loadMandate as fsLoadMandate, subscribeMandate, type MandateSubscription } from "../storage/md.js";

const DECISION_VALUES: ReadonlyArray<EscalationDecision> = [
  "answer-self",
  "escalate",
  "decline",
  "ignore"
];

const CACHE_TTL_MS = 60_000;
const LLM_TIMEOUT_MS = 10_000;
const FALLBACK_GREETING_MAX_LEN = 50;

const GREETING_REGEX = /^(привет|здравствуйте|здравствуй|здарова|добрый\s+(день|вечер|утро)|hi|hello|hey)([\s,!?.]|$)/iu;

export interface MandateDecisionContext {
  slug: string;
  /** Свежее входящее сообщение клиента. */
  incoming: string;
  /** Текущий tier контакта; влияет на гайдлайн в промпте. */
  tier: string;
  /** Текущий tone профиля (для подсказки в промпте). */
  tone?: string;
  /** Текущая boolean "вне рабочих часов" — в промпт. */
  outOfHours?: boolean;
  /** Дополнительный override mandate-текста (для тестов). */
  mandateOverride?: string;
}

export interface MandateDecisionResult {
  decision: EscalationDecision;
  reason: string;
  confidence: number;
  /** Был ли использован fallback (без LLM). */
  usedFallback: boolean;
}

interface CacheEntry {
  key: string;
  result: MandateDecisionResult;
  expiresAt: number;
}

/**
 * Per-profile holder для mandate-текста и кеша решений. Один на slug — caller
 * должен использовать `getMandateRuntime(slug)` или явно конструировать.
 */
export class MandateRuntime {
  private mandateText = "";
  private subscription: MandateSubscription | null = null;
  private cache: CacheEntry[] = [];

  constructor(private readonly slug: string, private readonly llm?: LLMClient) {}

  async start(): Promise<void> {
    try {
      this.mandateText = await fsLoadMandate(this.slug);
    } catch (e) {
      // оставляем старое значение (возможно ""), не валим профиль (R3.3)
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`не удалось прочитать mandate.md: ${msg}`);
    }
    if (!this.subscription) {
      this.subscription = subscribeMandate(this.slug, (text) => {
        this.mandateText = text;
        this.cache = []; // инвалидация кеша на изменении мандата
      });
    }
  }

  stop(): void {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }
  }

  /** Текущий мандат. Может быть "". */
  getMandateText(): string {
    return this.mandateText;
  }

  /** Принудительно обновить из памяти (для тестов / админки). */
  setMandateText(text: string): void {
    this.mandateText = text;
    this.cache = [];
  }

  async decideAction(ctx: MandateDecisionContext): Promise<MandateDecisionResult> {
    const mandate = ctx.mandateOverride ?? this.mandateText;

    if (!mandate.trim()) {
      return defaultFallback(ctx.incoming);
    }

    const cacheKey = makeCacheKey(mandate, ctx);
    const cached = this.takeFromCache(cacheKey);
    if (cached) return cached;

    if (!this.llm) {
      const fb = defaultFallback(ctx.incoming);
      return { ...fb, reason: `${fb.reason} (LLM недоступен)` };
    }

    try {
      const result = await llmDecide(this.llm, mandate, ctx);
      this.putInCache(cacheKey, result);
      return result;
    } catch (e) {
      const fb = defaultFallback(ctx.incoming);
      const msg = e instanceof Error ? e.message : String(e);
      return { ...fb, reason: `${fb.reason} (LLM error: ${msg})` };
    }
  }

  private takeFromCache(key: string): MandateDecisionResult | null {
    const now = Date.now();
    this.cache = this.cache.filter(c => c.expiresAt > now);
    const hit = this.cache.find(c => c.key === key);
    return hit ? hit.result : null;
  }

  private putInCache(key: string, result: MandateDecisionResult): void {
    this.cache.push({ key, result, expiresAt: Date.now() + CACHE_TTL_MS });
    if (this.cache.length > 64) this.cache.splice(0, this.cache.length - 64);
  }

  private log(msg: string): void {
    process.stderr.write(`[mandate ${this.slug}] ${msg}\n`);
  }
}

const RUNTIMES = new Map<string, MandateRuntime>();

/** Возвращает singleton runtime per slug. Caller должен вызвать `start()` сам. */
export function getMandateRuntime(slug: string, llm?: LLMClient): MandateRuntime {
  let rt = RUNTIMES.get(slug);
  if (!rt) {
    rt = new MandateRuntime(slug, llm);
    RUNTIMES.set(slug, rt);
  }
  return rt;
}

/** Хелпер для тестов и migrations: одиночное чтение без подписки. */
export async function loadMandate(slug: string): Promise<string> {
  return fsLoadMandate(slug);
}

/**
 * Default fallback для пустого мандата (Requirement 3.10).
 * Короткие приветствия → answer-self, остальное → escalate.
 */
export function defaultFallback(incoming: string): MandateDecisionResult {
  const trimmed = (incoming ?? "").trim();
  if (trimmed.length === 0) {
    return { decision: "ignore", reason: "пустое сообщение", confidence: 1, usedFallback: true };
  }
  if (trimmed.length <= FALLBACK_GREETING_MAX_LEN && GREETING_REGEX.test(trimmed)) {
    return { decision: "answer-self", reason: "короткое приветствие", confidence: 0.9, usedFallback: true };
  }
  return { decision: "escalate", reason: "пустой mandate, по умолчанию эскалируем", confidence: 0.7, usedFallback: true };
}

function makeCacheKey(mandate: string, ctx: MandateDecisionContext): string {
  // Дешёвый detereministic ключ. Не криптографический.
  return [
    djb2(mandate).toString(36),
    djb2(ctx.incoming).toString(36),
    ctx.tier ?? "",
    ctx.tone ?? "",
    ctx.outOfHours ? "1" : "0"
  ].join("|");
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

async function llmDecide(
  llm: LLMClient,
  mandate: string,
  ctx: MandateDecisionContext
): Promise<MandateDecisionResult> {
  const sys = [
    "Ты — внутренний классификатор для AI-менеджера в Telegram. На основе текста",
    "мандата владельца и входящего сообщения от клиента выбери одно из четырёх",
    "решений и верни ровно один JSON без пояснений: { \"decision\": ..., \"reason\":",
    "\"...\", \"confidence\": 0..1 }. decision строго одно из:",
    "answer-self | escalate | decline | ignore."
  ].join(" ");

  const user = [
    `## Мандат:`,
    mandate.slice(0, 4000),
    "",
    `## Контакт:`,
    `tier=${ctx.tier}, tone=${ctx.tone ?? "default"}, out_of_hours=${ctx.outOfHours ? "yes" : "no"}`,
    "",
    `## Входящее:`,
    ctx.incoming.slice(0, 1500)
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: user }
  ];
  const raw = await Promise.race([
    llm.chat(messages, { temperature: 0.1, maxTokens: 200 }),
    timeout(LLM_TIMEOUT_MS)
  ]);

  return parseLLMDecision(typeof raw === "string" ? raw : "");
}

function timeout(ms: number): Promise<string> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`mandate LLM timeout ${ms}ms`)), ms);
  });
}

export function parseLLMDecision(raw: string): MandateDecisionResult {
  const text = raw.trim();
  // Берём первый JSON-объект.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { decision: "escalate", reason: "LLM не вернул JSON", confidence: 0, usedFallback: false };
  }
  try {
    const obj = JSON.parse(match[0]) as { decision?: string; reason?: string; confidence?: number };
    const decision = DECISION_VALUES.includes(obj.decision as EscalationDecision)
      ? (obj.decision as EscalationDecision)
      : "escalate";
    return {
      decision,
      reason: typeof obj.reason === "string" ? obj.reason.slice(0, 500) : "",
      confidence: clampConfidence(obj.confidence),
      usedFallback: false
    };
  } catch {
    return { decision: "escalate", reason: "LLM вернул невалидный JSON", confidence: 0, usedFallback: false };
  }
}

function clampConfidence(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
