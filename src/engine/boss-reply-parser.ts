/**
 * Boss_Reply_Parser (Task 4.4 manager-mode tasks.md, Requirement 6).
 *
 * Принимает сообщение от босса и список открытых/ожидающих тикетов и решает,
 * какому тикету (если такому есть) этот ответ относится. Поддерживает три
 * способа идентификации:
 *  1. `reply_to` (в Telegram это reply на сообщение менеджера). Caller передаёт
 *     карту `bossMessageMap: Map<replyToMessageId, ticketId>`, заполненную из
 *     `Ticket.bossMessageId`.
 *  2. Префикс `#T-<n>` в начале текста (case-sensitive по `#T-`, Requirement 6.4).
 *  3. Префикс `@username` (case-insensitive, Requirement 6.5).
 *
 * Возвращает дискриминированное объединение `BossReplyParseResult`-подобное
 * (расширено `not-boss` для не-владельцев — Requirement 6.1/6.2).
 */

import type { TicketState } from "../types.js";

export type BossReplyParseResult =
  | { kind: "not-boss" }
  | { kind: "matched"; ticketId: string; clientReplyText: string }
  | { kind: "conflict"; candidateIds: string[] }
  | { kind: "ambiguous-username"; candidateIds: string[]; username: string }
  | { kind: "no-username-meta"; ticketId: string }
  | { kind: "ticket-not-found"; ticketId: string }
  | { kind: "empty-reply"; ticketId: string }
  | { kind: "no-identification" };

export interface OpenTicketSummary {
  id: string;
  clientUsername?: string;
  state: TicketState;
}

export interface BossReplyInput {
  fromId: number;
  text: string;
  /** Telegram message id, на который босс ответил через reply_to (если есть). */
  replyToMessageId?: number;
}

export interface BossReplyParseOptions {
  ownerId: number;
  /**
   * `replyToMessageId` → `ticketId`. Заполняется caller-ом из `Ticket.bossMessageId`.
   */
  bossMessageMap?: Map<number, string>;
}

const TICKET_PREFIX_REGEX = /^(#T-(\d+))\s+([\s\S]*)$/;
const TICKET_PREFIX_ONLY_REGEX = /^#T-(\d+)\s*$/;
const USERNAME_PREFIX_REGEX = /^@([A-Za-z0-9_]{3,32})\s+([\s\S]*)$/i;

export function parseBossReply(
  input: BossReplyInput,
  openTickets: OpenTicketSummary[],
  opts: BossReplyParseOptions
): BossReplyParseResult {
  if (input.fromId !== opts.ownerId) {
    return { kind: "not-boss" };
  }

  const text = (input.text ?? "").trim();

  // 1. reply_to → ticketId
  const replyTicketId = input.replyToMessageId !== undefined
    ? opts.bossMessageMap?.get(input.replyToMessageId)
    : undefined;

  // 2. префикс #T-N
  let ticketPrefixMatch: { ticketId: string; rest: string } | null = null;
  let onlyTicketPrefix = false;
  const tm = TICKET_PREFIX_REGEX.exec(input.text ?? "");
  if (tm) {
    ticketPrefixMatch = { ticketId: tm[1] ?? "", rest: (tm[3] ?? "").trim() };
  } else {
    const onlyMatch = TICKET_PREFIX_ONLY_REGEX.exec(text);
    if (onlyMatch) {
      ticketPrefixMatch = { ticketId: `#T-${onlyMatch[1]}`, rest: "" };
      onlyTicketPrefix = true;
    }
  }

  // 3. префикс @username
  let usernameMatch: { username: string; rest: string } | null = null;
  if (!ticketPrefixMatch) {
    const um = USERNAME_PREFIX_REGEX.exec(input.text ?? "");
    if (um) {
      usernameMatch = { username: (um[1] ?? "").toLowerCase(), rest: (um[2] ?? "").trim() };
    }
  }

  const idsFromIdentifiers: string[] = [];
  if (replyTicketId) idsFromIdentifiers.push(replyTicketId);
  if (ticketPrefixMatch) idsFromIdentifiers.push(ticketPrefixMatch.ticketId);

  // R6.6: конфликт reply_to vs #T-N
  if (idsFromIdentifiers.length >= 2) {
    const unique = Array.from(new Set(idsFromIdentifiers));
    if (unique.length > 1) {
      return { kind: "conflict", candidateIds: unique };
    }
  }

  // Только reply_to
  if (replyTicketId && !ticketPrefixMatch && !usernameMatch) {
    return acceptTicket(replyTicketId, text, openTickets);
  }

  // Только #T-N префикс
  if (ticketPrefixMatch) {
    if (onlyTicketPrefix) {
      // empty-reply detect — но сначала убедиться что тикет существует.
      const exists = openTickets.find(t => t.id === ticketPrefixMatch.ticketId && t.state !== "closed");
      if (!exists) return { kind: "ticket-not-found", ticketId: ticketPrefixMatch.ticketId };
      return { kind: "empty-reply", ticketId: ticketPrefixMatch.ticketId };
    }
    return acceptTicket(ticketPrefixMatch.ticketId, ticketPrefixMatch.rest, openTickets);
  }

  // Только @username
  if (usernameMatch) {
    const matchTickets = openTickets.filter(
      t => t.state !== "closed" && t.clientUsername?.toLowerCase() === usernameMatch.username
    );
    if (matchTickets.length === 0) {
      // R6.8 — username присутствует, но среди тикетов нет ни одного с этим username.
      // Возвращаем no-identification (caller подскажет про reply_to/#T-N).
      return { kind: "no-identification" };
    }
    if (matchTickets.length > 1) {
      return {
        kind: "ambiguous-username",
        candidateIds: matchTickets.map(t => t.id),
        username: usernameMatch.username
      };
    }
    const ticket = matchTickets[0]!;
    if (usernameMatch.rest.length === 0) {
      return { kind: "empty-reply", ticketId: ticket.id };
    }
    return { kind: "matched", ticketId: ticket.id, clientReplyText: usernameMatch.rest };
  }

  // Только reply_to (без других префиксов уже обработали выше)
  if (replyTicketId) {
    return acceptTicket(replyTicketId, text, openTickets);
  }

  return { kind: "no-identification" };
}

function acceptTicket(
  ticketId: string,
  body: string,
  openTickets: OpenTicketSummary[]
): BossReplyParseResult {
  const ticket = openTickets.find(t => t.id === ticketId);
  if (!ticket || ticket.state === "closed") {
    return { kind: "ticket-not-found", ticketId };
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { kind: "empty-reply", ticketId };
  }
  return { kind: "matched", ticketId, clientReplyText: trimmed };
}
