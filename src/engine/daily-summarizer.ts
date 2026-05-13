// Генерирует daily summary из session-лога когда сессия закрылась
// (gap >= 4ч после последнего сообщения, либо при смене session-дня).

import type { LLMClient } from "../llm/index.js";
import type { ProfileConfig } from "../types.js";
import {
  readSessionLog, writeDailySummary, readDailySummary,
  listSessionDays, sessionDate
} from "../storage/md.js";
import { mineDailyLogToPalace } from "./memory-palace.js";

const SYS = `Ты — внутренний дневник девушки. По сырому логу её переписки за день напиши КРАТКУЮ сводку для долгосрочной памяти. От первого лица, в её манере (lowercase, без markdown). Что было, что обсуждали, как она в итоге восприняла его, какие появились новые факты о нём, бесило ли что-то.`;

export interface DailySummary {
  day: string;
  topics: string[];          // о чём говорили
  newFactsAboutHim: string[]; // факты которые узнала о нём за день
  feeling: string;           // её итоговое ощущение от дня в общении с ним
  conflict?: string;         // если был конфликт — короткий референс
  highlight?: string;        // самый запомнившийся момент дня
}

/**
 * Генерирует summary для дня. Если уже есть — перезаписывает (для случая если день ещё не закончен).
 */
export async function buildDailySummary(
  llm: LLMClient,
  cfg: ProfileConfig,
  day: string
): Promise<DailySummary | null> {
  const log = await readSessionLog(cfg.slug, day);
  if (!log || log.length < 50) return null;

  try {
    await mineDailyLogToPalace(llm, cfg, day).catch(() => 0);
    const raw = await llm.chat([
      { role: "system", content: SYS },
      {
        role: "user",
        content: `Имя: ${cfg.name}, ${cfg.age}. Стадия: ${cfg.stage}. День: ${day}.

Лог переписки за день:
"""
${log.slice(-8000)}
"""

Верни STRICT JSON:
{
  "topics": ["о чём говорили (3-6 пунктов, кратко)"],
  "newFactsAboutHim": ["новые факты о нём из этого дня (или [])"],
  "feeling": "1-2 предложения как ОНА в итоге чувствует себя по поводу него после этого дня",
  "conflict": "если был серьёзный конфликт — суть в одном предложении, иначе пусто",
  "highlight": "самый запомнившийся момент (или пусто)"
}`
      }
    ], { temperature: 0.7, maxTokens: 3500, json: true });

    const parsed = JSON.parse(raw);
    const summary: DailySummary = {
      day,
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      newFactsAboutHim: Array.isArray(parsed.newFactsAboutHim) ? parsed.newFactsAboutHim : [],
      feeling: typeof parsed.feeling === "string" ? parsed.feeling : "",
      conflict: parsed.conflict || undefined,
      highlight: parsed.highlight || undefined
    };

    const md = renderSummary(summary);
    await writeDailySummary(cfg.slug, day, md);
    return summary;
  } catch {
    return null;
  }
}

function renderSummary(s: DailySummary): string {
  const lines = [`# ${s.day}`, ``, `## ощущение`, s.feeling || "—"];
  if (s.topics.length) {
    lines.push("", "## о чём говорили");
    s.topics.forEach(t => lines.push(`- ${t}`));
  }
  if (s.newFactsAboutHim.length) {
    lines.push("", "## новое о нём");
    s.newFactsAboutHim.forEach(t => lines.push(`- ${t}`));
  }
  if (s.highlight) lines.push("", "## момент дня", s.highlight);
  if (s.conflict) lines.push("", "## конфликт", s.conflict);
  return lines.join("\n");
}

/**
 * Закрывает старые сессии: для каждого session-дня кроме сегодняшнего, если summary ещё нет — генерирует.
 * Вызывается периодически из runtime.
 */
export async function closeStaleSessions(llm: LLMClient, cfg: ProfileConfig): Promise<number> {
  const today = sessionDate(cfg.tz);
  const days = await listSessionDays(cfg.slug);
  let made = 0;
  for (const day of days) {
    if (day === today) continue;
    const existing = await readDailySummary(cfg.slug, day);
    if (existing) continue;
    const r = await buildDailySummary(llm, cfg, day);
    if (r) made++;
  }
  return made;
}

export async function closeCurrentSession(llm: LLMClient, cfg: ProfileConfig): Promise<boolean> {
  const today = sessionDate(cfg.tz);
  const r = await buildDailySummary(llm, cfg, today);
  return !!r;
}
