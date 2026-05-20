/**
 * Escalation core (Task 4.5 manager-mode tasks.md, Requirements 4 + 18).
 *
 * Реализует жизненный цикл тикета: создание (open → waiting-boss),
 * допустимые переходы (Requirement 18.3), формирование резюме боссу через
 * LLM с фолбэком (Requirement 4.5), формирование ответа клиенту из
 * Boss_Reply через `confidentiality-guard` (Requirement 7.2-7.3).
 *
 * Этот модуль не делает Telegram-вызовов и не пишет на диск сам — всё чисто
 * вычислительное и принимает зависимости через параметры. Persistence + tg
 * sends оборачивает runtime в Task 4.12.
 */

import type {
  Ticket,
  TicketsFile,
  TicketState,
  TicketTransition,
  ContactRecord
} from "../types.js";
import type { LLMClient, ChatMessage } from "../llm/index.js";
import { findConfidentialityViolation } from "./confidentiality-guard.js";

const ALLOWED_TRANSITIONS: ReadonlyArray<{ from: TicketState | "<initial>"; to: TicketState }> = [
  { from: "<initial>", to: "open" },
  { from: "open", to: "waiting-boss" },
  { from: "open", to: "closed" },
  { from: "waiting-boss", to: "answered" },
  { from: "waiting-boss", to: "closed" },
  { from: "answered", to: "closed" }
];

const SUMMARY_LLM_TIMEOUT_MS = 30_000;
const SUMMARY_MAX_LEN = 500;
const FALLBACK_SUMMARY = "не удалось сгенерировать резюме, см. лог тикета";

export interface CreateTicketArgs {
  contact: Pick<ContactRecord, "chatId" | "username">;
  message: string;
  /** ID нового тикета (#T-N), вычисляется через `nextTicketId`. */
  ticketId: string;
  /** Текущая ISO-дата (для тестируемой детерминированности). */
  now?: string;
  /** Мгновенный summary, если уже сгенерирован (например миграцией). */
  initialSummary?: string;
}

/**
 * Создаёт тикет в state `open` с initial-transition. Не пишет на диск.
 */
export function createTicket(args: CreateTicketArgs): Ticket {
  const ts = args.now ?? new Date().toISOString();
  const initial: TicketTransition = {
    ts,
    from: "<initial>",
    to: "open",
    reason: "decision-escalate",
    by: "system"
  };
  return {
    id: args.ticketId,
    chatId: args.contact.chatId,
    clientUsername: args.contact.username,
    summary: (args.initialSummary ?? "").slice(0, SUMMARY_MAX_LEN),
    state: "open",
    createdAt: ts,
    history: [initial]
  };
}

/**
 * Применяет переход в `to` с записью в `history`. Возвращает новый объект
 * тикета (не мутирует исходный). Бросает на запрещённом переходе
 * (Requirement 18.4).
 */
export function transitionTicket(
  ticket: Ticket,
  to: TicketState,
  reason: string,
  by: TicketTransition["by"] = "system",
  now?: string
): Ticket {
  const allowed = ALLOWED_TRANSITIONS.some(t => t.from === ticket.state && t.to === to);
  if (!allowed) {
    throw new Error(`disallowed ticket transition: ${ticket.state} -> ${to}`);
  }
  const ts = now ?? new Date().toISOString();
  const transition: TicketTransition = { ts, from: ticket.state, to, reason, by };
  const next: Ticket = {
    ...ticket,
    state: to,
    history: [...ticket.history, transition]
  };
  if (to === "closed") next.closedAt = ts;
  return next;
}

/**
 * Возвращает true если переход разрешён без выброса исключения. Полезно для
 * диалогов и WebUI-валидации.
 */
export function isAllowedTransition(from: TicketState | "<initial>", to: TicketState): boolean {
  return ALLOWED_TRANSITIONS.some(t => t.from === from && t.to === to);
}

export interface SummarizeArgs {
  message: string;
  contact: Pick<ContactRecord, "chatId" | "username">;
  mandate?: string;
  llm?: LLMClient;
  /** Таймаут LLM. Дефолт 30 000 (Requirement 4.5). */
  timeoutMs?: number;
}

/**
 * Резюмирует входящее сообщение для босса (≤500 символов). При ошибке/таймауте
 * возвращает фиксированный фолбэк (Requirement 4.5). Не бросает.
 */
export async function summarizeForBoss(args: SummarizeArgs): Promise<string> {
  if (!args.llm) {
    return FALLBACK_SUMMARY;
  }
  const sys = [
    "Ты помощник менеджера. Готовишь краткие сводки для босса.",
    "До 500 символов. От третьего лица. Не цитируй клиента дословно — перефразируй.",
    "Если есть конкретная цифра/срок/имя — сохрани. Без эмодзи и markdown."
  ].join(" ");
  const usr = [
    `## Контакт`,
    `chatId=${args.contact.chatId}, username=${args.contact.username ?? "—"}`,
    "",
    `## Входящее`,
    args.message.slice(0, 2000),
    args.mandate ? "\n## Mandate (для контекста, не цитируй)\n" + args.mandate.slice(0, 1500) : ""
  ].join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: usr }
  ];
  try {
    const raw = await Promise.race([
      args.llm.chat(messages, { temperature: 0.3, maxTokens: 250 }),
      timeout(args.timeoutMs ?? SUMMARY_LLM_TIMEOUT_MS)
    ]);
    const text = (typeof raw === "string" ? raw : "").trim();
    return text.length > 0 ? text.slice(0, SUMMARY_MAX_LEN) : FALLBACK_SUMMARY;
  } catch {
    return FALLBACK_SUMMARY;
  }
}

export interface ComposeClientReplyArgs {
  ticket: Ticket;
  bossReplyText: string;
  mandate?: string;
  /** Сводки других тикетов и mandate-фрагменты, пересечение с которыми ловим cross-leak. */
  crossSources?: Array<{ label: string; text: string }>;
  /** LLM для перефразировки. Если нет — отдаём bossReplyText как есть. */
  llm?: LLMClient;
  /** Тон/persona для подсказки — опционально. */
  tone?: string;
  /** Таймаут LLM. */
  timeoutMs?: number;
}

export type ComposeClientReplyResult =
  | { kind: "ok"; text: string }
  | { kind: "blocked"; reason: string; violationKind: string };

/**
 * Формирует финальный ответ клиенту на основе Boss_Reply, прогоняя через
 * `confidentiality-guard` (Requirement 7.2-7.3, Property 8). Если guard
 * срабатывает — возвращает blocked, чтобы caller мог re-escalate.
 */
export async function composeClientReplyFromBoss(
  args: ComposeClientReplyArgs
): Promise<ComposeClientReplyResult> {
  let text = args.bossReplyText.trim();

  if (args.llm && text.length > 0) {
    const sys = [
      "Перефразируй ответ менеджера для клиента в Telegram.",
      "Не раскрывай внутренний контекст, не цитируй мандат и резюме боссу,",
      "не упоминай других контактов и тикеты. Сохрани суть и факты.",
      args.tone ? `Тон: ${args.tone}.` : ""
    ].filter(Boolean).join(" ");
    const usr = [
      `## Внутренний ответ владельца:`,
      args.bossReplyText.slice(0, 2000)
    ].join("\n");
    try {
      const raw = await Promise.race([
        args.llm.chat([
          { role: "system", content: sys },
          { role: "user", content: usr }
        ], { temperature: 0.4, maxTokens: 400 }),
        timeout(args.timeoutMs ?? SUMMARY_LLM_TIMEOUT_MS)
      ]);
      const candidate = (typeof raw === "string" ? raw : "").trim();
      if (candidate.length > 0) text = candidate;
    } catch {
      // оставляем сырой bossReplyText — caller всё равно прогонит через guard
    }
  }

  const violation = findConfidentialityViolation(text, {
    summary: args.ticket.summary,
    mandate: args.mandate,
    crossSources: args.crossSources
  });
  if (violation) {
    return {
      kind: "blocked",
      reason: `${violation.kind}: ${violation.matchLength} chars from ${violation.sourceLabel}`,
      violationKind: violation.kind
    };
  }
  return { kind: "ok", text };
}

/**
 * Снимок тикетов для тестов и WebUI: число тикетов в каждом state.
 */
export function ticketStateCounts(file: TicketsFile): Record<TicketState, number> {
  const counts: Record<TicketState, number> = {
    open: 0,
    "waiting-boss": 0,
    answered: 0,
    closed: 0
  };
  for (const t of file.tickets) counts[t.state]++;
  return counts;
}

function timeout(ms: number): Promise<string> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`escalation LLM timeout ${ms}ms`)), ms);
  });
}

export const ESCALATION_INTERNALS = {
  ALLOWED_TRANSITIONS,
  FALLBACK_SUMMARY,
  SUMMARY_MAX_LEN
};
