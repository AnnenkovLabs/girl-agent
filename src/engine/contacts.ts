/**
 * engine/contacts.ts — CRUD контактов и автопереходы тиров для manager-mode
 * (Task 4.7 .kiro/specs/manager-mode/tasks.md, design § 8.4).
 *
 * - `upsertOnIncoming(slug, m)` — создаёт/обновляет `ContactRecord` (Req 2.3).
 * - `decideTierTransition(contact, recent)` — чистая функция, adjacency-only
 *   переходы раз в 5 сообщений; авто-режим не покидает и не входит в
 *   `blocked` (Req 2.4-2.7, Property 4).
 * - `applyTierTransition(contact, next)` / `isBlocked(contact)` — хелперы.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { ContactRecord, ContactScore, Tier } from "../types.js";
import { loadContact, profileDir, saveContact } from "../storage/md.js";
import { nextTierDown, nextTierUp } from "../presets/contact-tiers.js";

/** Минимальная форма входящего сообщения, которую engine ждёт от runtime. */
export interface IncomingMessage {
  /** Telegram chatId — число для bot/userbot или уже строка. */
  chatId: number | string;
  /** username без `@`, опционально. */
  fromUsername?: string;
  /** Текст сообщения (engine использует для будущих score-эвристик). */
  text: string;
  /** Unix-ms; по умолчанию `Date.now()`. */
  ts?: number;
}

/** Сводка интеракций контакта за последнее окно — вход для эвристики. */
export interface InteractionSummary {
  /** Количество вежливых сигналов клиента. */
  polite?: number;
  /** Случаи уважения границ. */
  boundary?: number;
  /** Случаи нарушения границ или агрессии. */
  broken?: number;
  /** Сколько обещаний дал клиент. */
  promised?: number;
  /** Сколько обещаний выполнил. */
  delivered?: number;
}

export type TierTransitionReason =
  | "no-change"
  | "manual-override"
  | "blocked"
  | "cooldown"
  | "upgrade"
  | "downgrade"
  | "no-rule";

export interface TierTransitionDecision {
  next: Tier;
  reason: TierTransitionReason;
}

/** Окно (в сообщениях) между запусками `decideTierTransition` — Req 2.4. */
export const TRANSITION_GATE_MESSAGES = 5;

/** Чистый дефолтный нулевой `ContactScore`. */
export function emptyContactScore(): ContactScore {
  return { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 };
}

/** True если контакт заблокирован — caller должен трактовать как ignored. */
export function isBlocked(contact: ContactRecord): boolean {
  return contact.tier === "blocked";
}

function chatIdToString(chatId: number | string): string {
  return String(chatId);
}

/**
 * Зеркалит формирование пути файла контакта в `storage/md.ts:contactFile`.
 * Нужно engine-у для отдельной проверки «файл существует, но не парсится» —
 * чтобы отличить «нет контакта» от «повреждённый JSON».
 */
function safeContactFile(slug: string, chatId: string): string {
  const safe = chatId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(profileDir(slug), "contacts", `${safe}.json`);
}

function defaultContact(chatId: string, now: string): ContactRecord {
  return {
    chatId,
    tier: "cold-stranger",
    score: emptyContactScore(),
    manualOverride: false,
    notes: "",
    messagesSinceTransition: 0,
    createdAt: now,
    updatedAt: now
  };
}

function sanitizeUsername(raw?: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.replace(/^@+/, "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 64);
}

async function loadOrCreate(
  slug: string,
  chatId: string,
  now: string
): Promise<ContactRecord> {
  const existing = await loadContact(slug, chatId);
  if (existing) return existing;

  // `loadContact` возвращает null и для отсутствующего файла, и для битого
  // JSON / невалидной структуры. Чтобы залогировать только повреждение,
  // проверяем физическое наличие файла.
  const filePath = safeContactFile(slug, chatId);
  try {
    await fs.access(filePath);
    // Файл есть, но не прошёл валидацию — повреждён.
    console.warn(
      `[contacts] corrupted contact JSON, replacing with defaults: slug=${slug} chatId=${chatId}`
    );
  } catch {
    // ENOENT — обычный first-touch, без warn.
  }
  return defaultContact(chatId, now);
}

/**
 * Создаёт или обновляет `ContactRecord` по входящему сообщению. Новый контакт
 * получает дефолты (Req 2.3); существующий — инкремент
 * `messagesSinceTransition`, обновлённый `username` (если задан), новые
 * `lastMessageAt`/`updatedAt`. Запись персистится атомарно через
 * `saveContact`. Повреждённый файл → warn-лог + чистая запись (Req 19.7-19.8).
 */
export async function upsertOnIncoming(
  slug: string,
  m: IncomingMessage
): Promise<ContactRecord> {
  const chatId = chatIdToString(m.chatId);
  const tsMs = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : Date.now();
  const now = new Date(tsMs).toISOString();

  const base = await loadOrCreate(slug, chatId, now);
  const newUsername = sanitizeUsername(m.fromUsername);

  const updated: ContactRecord = {
    ...base,
    chatId, // нормализуем, на случай если файл лежал под альтернативной формой ключа
    username: newUsername ?? base.username,
    lastMessageAt: now,
    updatedAt: now,
    messagesSinceTransition: (base.messagesSinceTransition ?? 0) + 1
  };

  await saveContact(slug, updated);
  return updated;
}

/**
 * Чистая функция: предлагает следующий тир по агрегированным интеракциям.
 * См. design § 8.4 и Req 2.4-2.7.
 *
 * - `tier=blocked` → всегда остаётся `blocked` (Property 4, Req 2.6).
 * - `manualOverride=true` → `no-change` с reason `manual-override` (Req 2.7).
 * - `messagesSinceTransition < 5` → `no-change` с reason `cooldown` (Req 2.4).
 * - ≥2 broken/boundary → `nextTierDown` (downgrade).
 * - ≥3 polite и 0 broken → `nextTierUp` (upgrade).
 *
 * `nextTierUp`/`nextTierDown` сами защищают от перескока в/из `blocked`.
 */
export function decideTierTransition(
  contact: ContactRecord,
  recentInteractions: InteractionSummary
): TierTransitionDecision {
  if (contact.tier === "blocked") {
    return { next: "blocked", reason: "blocked" };
  }
  if (contact.manualOverride) {
    return { next: contact.tier, reason: "manual-override" };
  }
  const messages = contact.messagesSinceTransition ?? 0;
  if (messages < TRANSITION_GATE_MESSAGES) {
    return { next: contact.tier, reason: "cooldown" };
  }

  const polite = Math.max(0, recentInteractions.polite ?? 0);
  const boundary = Math.max(0, recentInteractions.boundary ?? 0);
  const broken = Math.max(0, recentInteractions.broken ?? 0);

  // Понижение: явные нарушения или ≥2 нарушения границ.
  if (broken >= 2 || boundary >= 2) {
    const down = nextTierDown(contact.tier);
    if (down) return { next: down, reason: "downgrade" };
    return { next: contact.tier, reason: "no-rule" };
  }

  // Повышение: достаточно вежливых сигналов и ноль нарушений.
  if (polite >= 3 && broken === 0) {
    const up = nextTierUp(contact.tier);
    if (up) return { next: up, reason: "upgrade" };
    return { next: contact.tier, reason: "no-rule" };
  }

  return { next: contact.tier, reason: "no-change" };
}

/**
 * Чистый билдер: применяет `next` тир и обнуляет `messagesSinceTransition`.
 * Не пишет на диск. Если `next === contact.tier` — возвращает исходный объект.
 */
export function applyTierTransition(contact: ContactRecord, next: Tier): ContactRecord {
  if (next === contact.tier) return contact;
  return {
    ...contact,
    tier: next,
    messagesSinceTransition: 0,
    updatedAt: new Date().toISOString()
  };
}
