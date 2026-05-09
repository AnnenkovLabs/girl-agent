import type { ProfileConfig, Weekday } from "../types.js";
import type { LLMClient } from "../llm/index.js";
import { readAgenda, writeAgenda, readMd, writeMd, readRelationship, type AgendaItem } from "../storage/md.js";
import { findStage } from "../presets/stages.js";
import { communicationDecisionState, normalizeCommunicationProfile } from "../presets/communication.js";
import type { DailyLife } from "./daily-life.js";
import type { ConflictState } from "./conflict.js";

/**
 * Agenda engine — она ведёт mental note "у него завтра соревнования",
 * сама решает когда написать чтобы спросить, переносит если он шлёт нафиг.
 *
 * Состоит из:
 *   1. extractAgendaUpdates — после каждого user-сообщения LLM решает создавать/менять agenda items
 *   2. tickAgenda — каждые ~60с runtime проверяет какие пинговать сейчас
 *   3. handleResponseToProactive — когда юзер отвечает на её proactive ping, LLM решает «принято / отстань / поговорим»
 */

const SYS_EXTRACT = `Ты — модуль ассистента-девушки. Твоя задача: после каждого сообщения парня посмотреть, не упомянул ли он что-то про своё будущее (планы, события, дела, дедлайны, работу, соревнования, экзамены, поездки), на что ОНА бы переживала / хотела узнать / отметила про себя — как живой человек, не календарь. Также понять, есть ли у НЕЁ повод проактивно написать ему позже (без явного триггера от него).

ВАЖНО:
- Только реалистичное поведение. Не каждое его сообщение порождает agenda. Большинство — мимо.
- На стадии "tg-given-cold" / "tg-given-warming" она почти ничего не запоминает и не пингует — сильно интересного для холодной девушки нет.
- На "convinced" / "first-date-done" уже может проявить интерес.
- На "dating-early"+ начинает реально переживать, спрашивает как прошло, поддерживает.
- Если он сказал "у меня завтра соревнования" — она поставит mental note чтобы написать через ~1ч после начала ("ну как там").
- Если сказал что-то нейтральное — не создавай agenda.

Действия:
- "create" — новая запись в agenda
- "update" — изменить существующую (по id)
- "cancel" — отменить (например он передумал)
- "noop" — ничего не делать (default!)`;

const TEMPLATE_EXTRACT = (state: string, history: string, incoming: string, currentAgenda: AgendaItem[], nowISO: string, tz: string) => `${state}

Сейчас (${tz}): ${nowISO}

Текущая её agenda по нему (что она помнит / собирается):
${currentAgenda.length ? JSON.stringify(currentAgenda.map(a => ({ id: a.id, about: a.about, pingAt: a.pingAt, state: a.state })), null, 2) : "(пусто)"}

Последние сообщения:
${history}

НОВОЕ сообщение от него:
"""${incoming}"""

Верни СТРОГО JSON массив действий (чаще всего пустой):
[
  {
    "action": "create" | "update" | "cancel" | "noop",
    "id"?: "string (для update/cancel)",
    "about"?: "коротко что за событие у него",
    "userEventTime"?: "ISO когда у НЕГО событие (если назвал время) или null",
    "pingAt"?: "ISO когда ОНА планирует написать",
    "reason"?: "почему она хочет написать (по-человечески, не сухо)",
    "importance"?: 1|2|3
  }
]

Правила:
- Если "noop" — верни []
- Не плоди дубликатов — если уже есть похожий item, лучше "update" чем "create"
- pingAt — реалистично, не "ровно через час". Девушки не строго по будильнику. Прибавь 30-90 минут вариативности.
- Если он явно просил "не пиши пока буду на работе/учёбе" — поставь pingAt после этого окна.
- НЕ оборачивай в markdown. Только JSON.`;

interface ExtractAction {
  action: "create" | "update" | "cancel" | "noop";
  id?: string;
  about?: string;
  userEventTime?: string | null;
  pingAt?: string;
  reason?: string;
  importance?: 1 | 2 | 3;
}

interface AutonomousItem {
  about?: string;
  reason?: string;
  pingAt?: string;
  importance?: 1 | 2 | 3;
}

type SanitizedAutonomousItem = Required<Pick<AutonomousItem, "about" | "pingAt">> & Pick<AutonomousItem, "reason" | "importance">;

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function localDateKey(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function localParts(tz: string, when: Date): { hour: number; minute: number; weekday: Weekday } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = fmt.formatToParts(when);
    const hour = Number(parts.find(p => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find(p => p.type === "minute")?.value ?? "0");
    const raw = (parts.find(p => p.type === "weekday")?.value ?? "Mon").toLowerCase().slice(0, 3);
    const map: Record<string, Weekday> = { mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" };
    return { hour, minute, weekday: map[raw] ?? "mon" };
  } catch {
    return { hour: when.getHours(), minute: when.getMinutes(), weekday: WEEKDAYS[(when.getDay() + 6) % 7] ?? "mon" };
  }
}

function maxAutonomousItems(stage: string, initiative: "low" | "medium" | "high"): number {
  let base =
    stage === "tg-given-cold" ? (initiative === "high" ? 1 : 0) :
    stage === "met-irl-got-tg" ? 1 :
    stage === "tg-given-warming" ? 1 :
    stage === "convinced" || stage === "first-date-done" ? 2 :
    stage === "dating-early" ? 3 :
    4;
  if (initiative === "low") base = Math.max(0, base - 1);
  if (initiative === "high") base += 1;
  return base;
}

function isDuringSleep(cfg: ProfileConfig, when: Date): boolean {
  const { hour } = localParts(cfg.tz, when);
  const from = cfg.sleepFrom ?? 23;
  const to = cfg.sleepTo ?? 8;
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

function isDuringUnavailableBlock(dailyLife: DailyLife, cfg: ProfileConfig, when: Date): boolean {
  const { hour } = localParts(cfg.tz, when);
  const block = dailyLife.blocks?.find(b => hour >= b.fromHour && hour < b.toHour);
  return block?.phoneAvailable === false;
}

function normalizePingAt(raw: string | undefined, now: number, horizon: number): string | null {
  const t = raw ? new Date(raw).getTime() : NaN;
  if (!Number.isFinite(t) || t <= now + 5 * 60 * 1000 || t > horizon) return null;
  return new Date(t).toISOString();
}

function sanitizeAutonomousItems(
  items: AutonomousItem[],
  now: number,
  horizon: number,
  existingAbout: string[],
  limit: number,
  cfg?: ProfileConfig,
  dailyLife?: DailyLife
): SanitizedAutonomousItem[] {
  const out: SanitizedAutonomousItem[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (!item.about || item.about.trim().length < 3) continue;
    const about = item.about.trim().slice(0, 120);
    if (existingAbout.some(x => x.includes(about.toLowerCase()) || about.toLowerCase().includes(x))) continue;
    if (out.some(x => Math.abs(new Date(x.pingAt).getTime() - new Date(item.pingAt ?? "").getTime()) < 45 * 60 * 1000)) continue;
    const pingAt = normalizePingAt(item.pingAt, now, horizon);
    if (!pingAt) continue;
    const date = new Date(pingAt);
    if (cfg && isDuringSleep(cfg, date)) continue;
    if (cfg && dailyLife && isDuringUnavailableBlock(dailyLife, cfg, date)) continue;
    out.push({
      about,
      pingAt,
      reason: item.reason?.trim().slice(0, 160) || undefined,
      importance: item.importance && item.importance >= 1 && item.importance <= 3 ? item.importance : 1
    });
  }
  return out;
}

const SYS_AUTONOMOUS = `Ты — внутренний планировщик проактивности девушки. Она живёт свою жизнь и иногда сама пишет парню первой, не потому что он написал, а потому что вспомнила, соскучилась, раздражена, хочет поделиться мелочью, проверить где он, пожаловаться, подразнить, показать что ей не всё равно.

Задача — создать реалистичные будущие поводы написать ему сегодня/завтра. Это НЕ календарь и НЕ ассистент. Это живая девушка.

КРИТИЧНО: НЕ ПРИДУМЫВАЙ события и темы которых не было в переписке. Если ты ссылаешься на то что он рассказывал про X — проверь что X реально есть в переписке или long-term memory. Нельзя писать про тему которую вы НИКОГДА не обсуждали. Лучше пиши про свою жизнь (сегодняшний день, события из daily-life) чем ссылайся на несуществующий разговор.

Верни СТРОГО JSON:
{
  "items": [
    {
      "about": "коротко тема её будущего сообщения",
      "reason": "почему она сама напишет, по-человечески",
      "pingAt": "ISO-время когда написать",
      "importance": 1
    }
  ]
}`;

const TEMPLATE_AUTONOMOUS = (
  state: string,
  dailyLife: DailyLife,
  history: string,
  currentAgenda: AgendaItem[],
  nowISO: string,
  tz: string,
  maxItems: number
) => `${state}

Сейчас (${tz}): ${nowISO}

Её сегодняшний день:
${JSON.stringify({
  dateLocal: dailyLife.dateLocal,
  vibe: dailyLife.vibe,
  weather: dailyLife.weather,
  blocks: dailyLife.blocks,
  events: dailyLife.events,
  wants: dailyLife.wants
}, null, 2)}

Последние сообщения:
${history || "(переписки ещё мало)"}

Уже запланировано:
${currentAgenda.length ? JSON.stringify(currentAgenda.filter(a => a.state === "pending").map(a => ({ about: a.about, pingAt: a.pingAt, reason: a.reason })), null, 2) : "(пусто)"}

Создай 0-${maxItems} проактивных сообщений на ближайшие 18 часов.

Правила:
- Это именно ЕЁ инициативы: "блин у нас щас...", "ты где пропал", "я щас такое увидела", "мне снилась фигня", "мама бесит", "скинуть бы тебе но ладно", "я устала".
- Не создавай скучное "как дела" без причины.
- Не будь слишком липкой на холодных стадиях.
- КРИТИЧНО: НЕ ВЫДУМЫВАЙ темы которых не было в переписке или long-term memory. Не ссылайся на события/разговоры которых НЕ было. Если в истории нет упоминания темы — не пиши про неё. Лучше создай item про свою жизнь/день/настроение.
- На dating-early+ можно скучать, ревновать, проверять, писать бытовое.
- pingAt должен быть в будущем, не во время сна и не во время blocks с phoneAvailable=false.
- Разноси сообщения минимум на 45 минут.
- НЕ создавай дубликаты текущей agenda.
- Если сегодня по контексту неуместно писать первой — items=[].
- НЕ оборачивай в markdown. Только JSON.`;

export async function extractAgendaUpdates(
  llm: LLMClient,
  cfg: ProfileConfig,
  history: { role: "user" | "assistant"; content: string }[],
  incoming: string,
  chatId: string | number
): Promise<{ created: number; updated: number; cancelled: number }> {
  const stage = findStage(cfg.stage);
  const communication = normalizeCommunicationProfile(cfg);
  // Агенда не для холодных стадий — экономим LLM-вызовы.
  if ((cfg.stage === "tg-given-cold" && communication.initiative !== "high") || (cfg.stage === "met-irl-got-tg" && communication.initiative === "low")) {
    return { created: 0, updated: 0, cancelled: 0 };
  }

  const persona = (await readMd(cfg.slug, "persona.md")).slice(0, 800);
  const stateBlock = `# Стадия: ${stage.label} (${stage.description})\n# ${communicationDecisionState(communication)}\n# persona фрагмент:\n${persona}`;
  const histStr = history.slice(-8).map(m => `${m.role === "user" ? "он" : "она"}: ${m.content}`).join("\n");
  const agenda = await readAgenda(cfg.slug);
  const now = new Date().toISOString();

  let actions: ExtractAction[] = [];
  try {
    const raw = await llm.chat(
      [{ role: "system", content: SYS_EXTRACT }, { role: "user", content: TEMPLATE_EXTRACT(stateBlock, histStr, incoming, agenda, now, cfg.tz) }],
      { temperature: 0.4, maxTokens: 3500, json: true }
    );
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) actions = parsed as ExtractAction[];
    else if (Array.isArray(parsed.actions)) actions = parsed.actions;
  } catch {
    return { created: 0, updated: 0, cancelled: 0 };
  }

  let created = 0, updated = 0, cancelled = 0;
  for (const a of actions) {
    if (a.action === "noop" || !a.action) continue;
    if (a.action === "create" && a.about && a.pingAt) {
      const item: AgendaItem = {
        id: `ag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        about: a.about,
        userEventTime: a.userEventTime || undefined,
        pingAt: a.pingAt,
        reason: a.reason ?? "хочет узнать как прошло",
        importance: (a.importance ?? 1) as 1 | 2 | 3,
        state: "pending",
        attempts: 0,
        chatId,
        createdAt: new Date().toISOString(),
        history: [`created from his message at ${new Date().toISOString()}`]
      };
      agenda.push(item);
      created++;
    } else if (a.action === "update" && a.id) {
      const idx = agenda.findIndex(x => x.id === a.id);
      if (idx >= 0) {
        if (a.about) agenda[idx]!.about = a.about;
        if (a.pingAt) agenda[idx]!.pingAt = a.pingAt;
        if (a.reason) agenda[idx]!.reason = a.reason;
        if (a.userEventTime) agenda[idx]!.userEventTime = a.userEventTime;
        if (a.importance) agenda[idx]!.importance = a.importance;
        agenda[idx]!.history = [...(agenda[idx]!.history ?? []), `updated at ${new Date().toISOString()}: ${a.reason ?? ""}`];
        updated++;
      }
    } else if (a.action === "cancel" && a.id) {
      const idx = agenda.findIndex(x => x.id === a.id);
      if (idx >= 0) {
        agenda[idx]!.state = "cancelled";
        agenda[idx]!.history = [...(agenda[idx]!.history ?? []), `cancelled at ${new Date().toISOString()}: ${a.reason ?? ""}`];
        cancelled++;
      }
    }
  }
  if (created || updated || cancelled) {
    await writeAgenda(cfg.slug, agenda);
  }
  return { created, updated, cancelled };
}

export async function ensureAutonomousAgenda(
  llm: LLMClient,
  cfg: ProfileConfig,
  dailyLife: DailyLife | undefined,
  chatId: string | number,
  history: { role: "user" | "assistant"; content: string }[],
  conflict: ConflictState | null = null
): Promise<{ created: number }> {
  if (!dailyLife || cfg.stage === "dumped") return { created: 0 };
  if (conflict && conflict.level >= 2) return { created: 0 };
  const dateKey = dailyLife.dateLocal || localDateKey(cfg.tz);
  const statePath = "memory/proactive-state.md";
  const state = await readMd(cfg.slug, statePath);
  if (state.includes(`autonomous:${dateKey}`)) return { created: 0 };

  const agenda = await readAgenda(cfg.slug);
  const communication = normalizeCommunicationProfile(cfg);
  const maxItems = maxAutonomousItems(cfg.stage, communication.initiative);
  if (maxItems <= 0) {
    await writeMd(cfg.slug, statePath, `${state.trim()}\nautonomous:${dateKey} created=0`.trim() + "\n");
    return { created: 0 };
  }

  const now = Date.now();
  const horizon = now + 18 * 60 * 60 * 1000;
  const pendingSoon = agenda.filter(a =>
    a.state === "pending" &&
    a.chatId === chatId &&
    new Date(a.pingAt).getTime() > now &&
    new Date(a.pingAt).getTime() <= horizon
  );
  if (pendingSoon.length >= maxItems) {
    await writeMd(cfg.slug, statePath, `${state.trim()}\nautonomous:${dateKey} created=0`.trim() + "\n");
    return { created: 0 };
  }

  const stage = findStage(cfg.stage);
  const rel = await readRelationship(cfg.slug);
  const persona = (await readMd(cfg.slug, "persona.md")).slice(0, 900);
  const speech = (await readMd(cfg.slug, "speech.md")).slice(0, 600);
  const longTerm = (await readMd(cfg.slug, "memory/long-term.md")).slice(0, 1200);
  const histStr = history.slice(-16).map(m => `${m.role === "user" ? "он" : "она"}: ${m.content}`).join("\n");
  const stateBlock = [
    `# Стадия: ${stage.label} (${cfg.stage})`,
    `# Описание стадии: ${stage.description}`,
    `# Score: ${JSON.stringify(rel.score)}`,
    `# ${communicationDecisionState(communication)}`,
    `# persona:\n${persona}`,
    `# speech:\n${speech}`,
    longTerm ? `# long-term memory (что реально известно о нём):\n${longTerm}` : "# long-term memory: (пусто — пока ничего не знаешь о нём, НЕ придумывай факты)"
  ].filter(Boolean).join("\n\n");

  let items: AutonomousItem[] = [];
  try {
    const raw = await llm.chat(
      [{ role: "system", content: SYS_AUTONOMOUS }, { role: "user", content: TEMPLATE_AUTONOMOUS(stateBlock, dailyLife, histStr, agenda, new Date().toISOString(), cfg.tz, maxItems - pendingSoon.length) }],
      { temperature: 0.8, maxTokens: 3500, json: true }
    );
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    await writeMd(cfg.slug, statePath, `${state.trim()}\nautonomous:${dateKey} created=0 fallback`.trim() + "\n");
    return { created: 0 };
  }

  const existingAbout = agenda.map(a => a.about.toLowerCase());
  const selected = sanitizeAutonomousItems(items, now, horizon, existingAbout, maxItems - pendingSoon.length, cfg, dailyLife);
  for (const item of selected) {
    agenda.push({
      id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      about: item.about!,
      pingAt: item.pingAt!,
      reason: item.reason ?? "самой захотелось написать",
      importance: item.importance ?? 1,
      state: "pending",
      attempts: 0,
      chatId,
      createdAt: new Date().toISOString(),
      history: [`autonomous:${dateKey}`]
    });
  }
  if (selected.length) await writeAgenda(cfg.slug, agenda);
  await writeMd(cfg.slug, statePath, `${state.trim()}\nautonomous:${dateKey} created=${selected.length}`.trim() + "\n");
  return { created: selected.length };
}

export async function reconcileAgendaAfterConflict(
  slug: string,
  conflict: ConflictState,
  prevLevel: number
): Promise<{ cancelled: number; rescheduled: number }> {
  if (conflict.level === 0 || conflict.level <= prevLevel) return { cancelled: 0, rescheduled: 0 };

  const agenda = await readAgenda(slug);
  const pending = agenda.filter(a => a.state === "pending");
  if (!pending.length) return { cancelled: 0, rescheduled: 0 };

  let cancelled = 0;
  let rescheduled = 0;
  const now = Date.now();

  for (const item of pending) {
    const idx = agenda.findIndex(x => x.id === item.id);
    if (idx < 0) continue;

    if (conflict.level >= 3 || item.importance === 1) {
      agenda[idx]!.state = "cancelled";
      agenda[idx]!.history = [...(agenda[idx]!.history ?? []), `cancelled due to conflict level ${conflict.level} at ${new Date().toISOString()}`];
      cancelled++;
    } else if (conflict.level >= 2 && item.importance === 2) {
      const delayHours = 12 + Math.random() * 24;
      const newPing = new Date(now + delayHours * 3600_000).toISOString();
      agenda[idx]!.pingAt = newPing;
      agenda[idx]!.history = [...(agenda[idx]!.history ?? []), `rescheduled due to conflict level ${conflict.level} at ${new Date().toISOString()}`];
      rescheduled++;
    }
  }

  if (cancelled || rescheduled) {
    await writeAgenda(slug, agenda);
  }
  return { cancelled, rescheduled };
}

/** Возвращает items, у которых pingAt <= now и state="pending". */
export async function dueAgendaItems(slug: string): Promise<AgendaItem[]> {
  const agenda = await readAgenda(slug);
  const now = Date.now();
  return agenda.filter(a => a.state === "pending" && new Date(a.pingAt).getTime() <= now);
}

export async function markAgendaFired(slug: string, id: string): Promise<void> {
  const agenda = await readAgenda(slug);
  const idx = agenda.findIndex(x => x.id === id);
  if (idx >= 0) {
    agenda[idx]!.state = "fired";
    agenda[idx]!.attempts += 1;
    agenda[idx]!.history = [...(agenda[idx]!.history ?? []), `fired at ${new Date().toISOString()}`];
    await writeAgenda(slug, agenda);
  }
}

export async function rescheduleAgenda(slug: string, id: string, newPingAt: string, note: string): Promise<void> {
  const agenda = await readAgenda(slug);
  const idx = agenda.findIndex(x => x.id === id);
  if (idx >= 0) {
    agenda[idx]!.pingAt = newPingAt;
    agenda[idx]!.state = "pending";
    agenda[idx]!.history = [...(agenda[idx]!.history ?? []), `rescheduled to ${newPingAt}: ${note}`];
    await writeAgenda(slug, agenda);
  }
}

const SYS_RESCHED = `Ты — внутренний планировщик девушки. Она недавно проактивно написала юзеру (item ниже), а он ответил. Реши, надо ли ей переписать снова и когда. Это поведение живого человека: если он сказал "занят, отстань" — она обидится или поймёт и перенесёт. Если "ок поговорим вечером" — поставит вечером. Если получила нормальный ответ на свой вопрос — она удовлетворена, agenda можно cancel.

Верни СТРОГО JSON:
{
  "decision": "satisfied" | "reschedule" | "give-up",
  "newPingAt"?: "ISO если reschedule",
  "note": "коротко почему так решила"
}`;

export async function decideAfterProactiveResponse(
  llm: LLMClient,
  cfg: ProfileConfig,
  item: AgendaItem,
  userResponse: string
): Promise<{ decision: "satisfied" | "reschedule" | "give-up"; newPingAt?: string; note: string }> {
  const now = new Date().toISOString();
  const prompt = `Стадия: ${cfg.stage}
Сейчас (${cfg.tz}): ${now}
Item:
${JSON.stringify(item, null, 2)}

Юзер ответил на её ping:
"""${userResponse}"""

Reшение?`;
  try {
    const raw = await llm.chat(
      [{ role: "system", content: SYS_RESCHED }, { role: "user", content: prompt }],
      { temperature: 0.5, maxTokens: 3500, json: true }
    );
    const parsed = JSON.parse(raw);
    return {
      decision: parsed.decision ?? "satisfied",
      newPingAt: parsed.newPingAt,
      note: parsed.note ?? ""
    };
  } catch {
    // дефолт — больше не пинговать чтобы не быть навязчивой
    return { decision: "satisfied", note: "fallback" };
  }
}
