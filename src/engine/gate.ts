/**
 * engine/gate.ts — ветвление по `cfg.gateLevel` для входящих сообщений
 * клиентов (Task 4.8 .kiro/specs/manager-mode/tasks.md, Requirement 17).
 *
 * Чистые функции без I/O. Caller (runtime) подаёт текущие значения
 * `gateLevel`, `whitelist`, контакт и счётчик ответов агента за последние
 * 24 часа. Хот-релоад значений `gateLevel`/`whitelist` обеспечивается тем,
 * что эти поля читаются «вживую» из `Runtime.cfg` на каждом сообщении.
 *
 * Поведение по уровням ворот:
 *  - `open` — пропускаем всех.
 *  - `gated` — для `tier=cold-stranger` без `manualOverride` ограничиваем
 *    количество ответов до 3 в окне 24 часа (Req 17.4-17.5). При превышении
 *    лимита — `force-escalate`. Остальные тиры обрабатываются как обычно.
 *  - `whitelist` — пропускаем только записи из `cfg.whitelist`. Соответствие
 *    по `chatId` (строковое равенство) или по `@username` (регистронезависимо,
 *    с опциональным ведущим `@`). Иначе — `block` без ответа и без тикета
 *    (Req 17.6).
 */

import type { ContactRecord, GateLevel, WhitelistEntry } from "../types.js";

/** Закрытое множество исходов ворот. */
export type GateDecision =
  | { action: "allow" }
  | { action: "force-escalate"; reason: "gated-quota-exceeded" }
  | { action: "block"; reason: "not-whitelisted" };

/** Лимит ответов cold-stranger в окне `GATED_WINDOW_MS` для `gated` (Req 17.4). */
export const GATED_COLD_STRANGER_LIMIT = 3;

/** Окно подсчёта ответов для `gated` (24 часа, Req 17.4). */
export const GATED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Минимальная форма контакта, нужная gate-логике. */
export interface GateContact {
  chatId: string;
  username?: string;
  tier: ContactRecord["tier"];
  /** Если `true`, контакт прошёл ручное подтверждение и квота `gated` не применяется. */
  manualOverride?: boolean;
}

export interface EvaluateGateInput {
  /** Текущее значение `cfg.gateLevel`. `undefined` трактуется как дефолт `gated` (Req 17.2). */
  gateLevel: GateLevel | undefined;
  /** Текущее значение `cfg.whitelist`. Используется только при `gateLevel=whitelist`. */
  whitelist?: WhitelistEntry[];
  /** Карточка контакта на момент решения. */
  contact: GateContact;
  /** Сколько ответов агент уже отправил этому контакту за последние 24 часа. */
  recentReplyCount24h: number;
}

function normalizeUsername(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.replace(/^@+/, "").trim().toLowerCase();
  return trimmed || undefined;
}

/**
 * Проверяет, разрешает ли запись whitelist пропустить данный контакт.
 *
 * - `kind: "id"` — строковое равенство `chatId` (числовой `123` совпадает со
 *   строковым `"123"`).
 * - `kind: "username"` — регистронезависимое совпадение нормализованного
 *   `@username` (ведущие `@` обрезаются с обеих сторон, регистр игнорируется,
 *   Req 17.6).
 */
export function matchesWhitelist(entry: WhitelistEntry, contact: GateContact): boolean {
  if (entry.kind === "id") {
    return String(entry.chatId) === String(contact.chatId);
  }
  if (entry.kind === "username") {
    const want = normalizeUsername(entry.username);
    const have = normalizeUsername(contact.username);
    if (!want || !have) return false;
    return want === have;
  }
  return false;
}

/**
 * Принимает решение об обработке входящего сообщения по `gateLevel`.
 * Чистая функция: не читает диск, не пишет логи, не вызывает LLM.
 *
 * Возвращает один из:
 *  - `allow` — обычная обработка (mandate/behavior-tick).
 *  - `force-escalate` — caller обязан открыть тикет и не отвечать клиенту
 *    самостоятельно (Req 17.5).
 *  - `block` — caller обязан проигнорировать сообщение без ответа и без
 *    тикета (Req 17.6).
 */
export function evaluateGate(input: EvaluateGateInput): GateDecision {
  const level: GateLevel = input.gateLevel ?? "gated";

  if (level === "open") {
    return { action: "allow" };
  }

  if (level === "gated") {
    const isColdAuto =
      input.contact.tier === "cold-stranger" && !input.contact.manualOverride;
    if (!isColdAuto) return { action: "allow" };
    if (input.recentReplyCount24h >= GATED_COLD_STRANGER_LIMIT) {
      return { action: "force-escalate", reason: "gated-quota-exceeded" };
    }
    return { action: "allow" };
  }

  // whitelist
  const list = input.whitelist ?? [];
  for (const entry of list) {
    if (matchesWhitelist(entry, input.contact)) {
      return { action: "allow" };
    }
  }
  return { action: "block", reason: "not-whitelisted" };
}
