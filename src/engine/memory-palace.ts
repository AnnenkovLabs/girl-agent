import type { LLMClient } from "../llm/index.js";
import type { ProfileConfig } from "../types.js";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  appendMd,
  listDailySummaries,
  listSessionDays,
  profileDir,
  readDailySummary,
  readMd,
  readSessionLog,
  sessionDate,
  writeMd
} from "../storage/md.js";

export type MemoryHall =
  | "hall_facts"
  | "hall_events"
  | "hall_discoveries"
  | "hall_preferences"
  | "hall_advice"
  | "hall_promises"
  | "hall_open_loops"
  | "hall_feelings"
  | "hall_uncertain";

export interface MemoryDrawer {
  id: string;
  ts: string;
  wing: string;
  room: string;
  hall: MemoryHall;
  source: string;
  quote: string;
  keywords: string[];
  salience: number;
}

export interface MemoryPalaceContext {
  facts: string;
  episodes: string;
  relationshipTimeline: string;
  attachment: string;
  time: string;
  weeklyLife: string;
  socialGraph: string;
  habits: string;
  openLoops: string;
  palace: string;
}

type ParsedMemoryDrawer = Omit<MemoryDrawer, "id" | "ts" | "wing" | "source">;

const DEFAULT_FACTS = `# facts
- имя основного собеседника неизвестно
- важные факты о нём записывать только если он сам сказал явно
- спорные факты держать как uncertain, не утверждать уверенно`;

const DEFAULT_ATTACHMENT = `# attachment
attachment: anxious-avoidant
jealousy: 0.58
needForAttention: 0.66
trustRecoverySpeed: 0.34
conflictStyle: withdraws_then_snaps
flirtStyle: teasing_then_soft
apologyStyle: awkward_short`;

const DEFAULT_WEEKLY = `# week-plan
будни: учёба/работа, дорога, вечером телефон/сериал/подруга/дом
выходные: поздно просыпается, бытовые дела, иногда встречается с подругой
не каждый день доступна; иногда занята, устала или просто не хочет отвечать`;

const DEFAULT_SOCIAL = `# contacts
- мама: бытовые конфликты, контроль, иногда забота
- лера: подруга, язвит, зовёт гулять
- настя: подруга поспокойнее, может слушать голосовые
- одногруппники/коллеги: фон, не романтика`;

const DEFAULT_HABITS = `# habits
- утром отвечает суше
- вечером теплее, если день не выбесил
- когда устала, читает и откладывает ответ
- редко объясняет почему пропала
- может вспомнить мелкую деталь через день, если она эмоционально зацепила`;

const HALLS: readonly MemoryHall[] = [
  "hall_facts",
  "hall_events",
  "hall_discoveries",
  "hall_preferences",
  "hall_advice",
  "hall_promises",
  "hall_open_loops",
  "hall_feelings",
  "hall_uncertain"
];

const STOP_WORDS = new Set([
  "это", "как", "что", "или", "если", "она", "они", "его", "ему", "тебя", "тебе", "меня", "мне",
  "для", "про", "над", "под", "при", "без", "еще", "ещё", "уже", "там", "тут", "тоже", "после",
  "сейчас", "щас", "когда", "почему", "потому", "очень", "просто", "вообще", "короче", "типа"
]);

function wordsFrom(text: string): string[] {
  return [...text.toLowerCase().matchAll(/[a-zа-яё0-9]{3,}/gi)]
    .map(match => match[0])
    .filter(token => !STOP_WORDS.has(token));
}

function normalizedQuote(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function today(tz: string): string {
  return sessionDate(tz);
}

function nowStamp(): string {
  return new Date().toISOString();
}

function wingFor(cfg: ProfileConfig): string {
  return `primary-${cfg.ownerId ?? "unknown"}`;
}

function normalizeRoom(value: string): string {
  const source = value.trim().toLowerCase() || "general";
  const slug = source
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "general";
}

function normalizeHall(value: string): MemoryHall {
  return (HALLS as readonly string[]).includes(value) ? value as MemoryHall : "hall_facts";
}

function normalizeKeywords(value: unknown, quote: string, room: string): string[] {
  const raw = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  const fallback = [...quote.toLowerCase().matchAll(/[a-zа-яё0-9]{3,}/gi)]
    .map(match => match[0])
    .filter(word => !STOP_WORDS.has(word))
    .slice(0, 10);
  return [...new Set([...raw, room, ...fallback]
    .map(x => x.trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 16);
}

function scoreClamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function safeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stableId(source: string, quote: string): string {
  return createHash("sha1").update(`${source}\n${quote}`).digest("hex").slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseDrawer(raw: string): MemoryDrawer | null {
  const metaMatch = raw.match(/^<!--drawer:(.+?)-->\n/);
  if (!metaMatch) return null;
  try {
    const meta = JSON.parse(metaMatch[1] ?? "") as Partial<MemoryDrawer>;
    const quote = raw.slice(metaMatch[0].length);
    if (!meta.id || !meta.ts || !meta.wing || !meta.room || !meta.hall || !meta.source || !quote.trim()) return null;
    return {
      id: meta.id,
      ts: meta.ts,
      wing: meta.wing,
      room: meta.room,
      hall: normalizeHall(meta.hall),
      source: meta.source,
      quote: quote.trim(),
      keywords: normalizeKeywords(meta.keywords, quote, meta.room),
      salience: scoreClamp(meta.salience)
    };
  } catch {
    return null;
  }
}

function renderDrawer(drawer: MemoryDrawer): string {
  const meta = {
    id: drawer.id,
    ts: drawer.ts,
    wing: drawer.wing,
    room: drawer.room,
    hall: drawer.hall,
    source: drawer.source,
    keywords: drawer.keywords,
    salience: drawer.salience
  };
  return `<!--drawer:${JSON.stringify(meta)}-->\n${drawer.quote.trim()}\n`;
}

function drawerPath(drawer: MemoryDrawer): string {
  return `memory/palace/${drawer.wing}/${drawer.hall}/${drawer.room}/${drawer.id}.md`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
}

function parsedDrawers(value: unknown): ParsedMemoryDrawer[] {
  if (!Array.isArray(value)) return [];
  const out: ParsedMemoryDrawer[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) continue;
    const quote = typeof rec.quote === "string" ? rec.quote.trim() : "";
    if (!quote) continue;
    const room = normalizeRoom(typeof rec.room === "string" ? rec.room : "");
    out.push({
      room,
      hall: normalizeHall(typeof rec.hall === "string" ? rec.hall : ""),
      quote,
      keywords: normalizeKeywords(rec.keywords, quote, room),
      salience: scoreClamp(rec.salience)
    });
  }
  return out;
}

async function ensureDefaults(cfg: ProfileConfig): Promise<void> {
  const defaults: [string, string][] = [
    ["memory/facts.md", DEFAULT_FACTS],
    ["relationship/timeline.md", `# relationship timeline\n- ${nowStamp()}: профиль создан, стадия ${cfg.stage}`],
    ["life/week-plan.md", DEFAULT_WEEKLY],
    ["life/contacts.md", DEFAULT_SOCIAL],
    ["life/habits.md", DEFAULT_HABITS],
    ["personality/attachment.md", DEFAULT_ATTACHMENT],
    ["time/open-loops.md", "# open loops\n"],
    ["time/promises.md", "# promises\n"],
    ["memory/uncertain.md", "# uncertain\n"]
  ];
  await Promise.all(defaults.map(async ([path, content]) => {
    const current = await readMd(cfg.slug, path);
    if (!current.trim()) await writeMd(cfg.slug, path, content + "\n");
  }));
}

function scoreDrawer(drawer: MemoryDrawer, tokens: string[], query: string): number {
  if (!tokens.length) return drawer.salience;
  const haystack = [
    drawer.quote,
    drawer.room,
    drawer.hall,
    drawer.keywords.join(" ")
  ].join("\n").toLowerCase();
  let score = drawer.salience;
  for (const token of tokens) {
    if (haystack.includes(token)) score += drawer.keywords.includes(token) ? 4 : 2;
  }
  if (drawer.quote.toLowerCase().includes(query)) score += 4;
  return score;
}

async function listPalaceDrawers(cfg: ProfileConfig): Promise<MemoryDrawer[]> {
  const root = `memory/palace/${wingFor(cfg)}`;
  const halls = await listChildDirs(cfg.slug, root);
  const drawers: MemoryDrawer[] = [];
  for (const hall of halls) {
    const rooms = await listChildDirs(cfg.slug, `${root}/${hall}`);
    for (const room of rooms) {
      const files = await listChildFiles(cfg.slug, `${root}/${hall}/${room}`);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const drawer = parseDrawer(await readMd(cfg.slug, `${root}/${hall}/${room}/${file}`));
        if (drawer) drawers.push(drawer);
      }
    }
  }
  return drawers;
}

async function listChildDirs(slug: string, rel: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(profileDir(slug), rel), { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch {
    return [];
  }
}

async function listChildFiles(slug: string, rel: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(profileDir(slug), rel), { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  } catch {
    return [];
  }
}

function renderPalaceRecall(drawers: MemoryDrawer[]): string {
  if (!drawers.length) return "";
  const grouped = new Map<string, MemoryDrawer[]>();
  for (const drawer of drawers) {
    const key = `${drawer.hall}/${drawer.room}`;
    grouped.set(key, [...(grouped.get(key) ?? []), drawer]);
  }
  const lines = ["## Memory Palace: точные ящики по теме"];
  for (const [key, group] of grouped) {
    lines.push(`### ${key}`);
    for (const drawer of group.slice(0, 4)) {
      lines.push(`- [${drawer.ts.slice(0, 10)}] ${drawer.quote}`);
    }
  }
  lines.push("Используй эти ящики как точную память. Не цитируй служебные hall/room/source, не говори что это файл или память.");
  return lines.join("\n");
}

export async function searchPalaceDrawers(cfg: ProfileConfig, query: string, limit = 8): Promise<MemoryDrawer[]> {
  const normalized = query.toLowerCase();
  const tokens = wordsFrom(normalized);
  const scored = (await listPalaceDrawers(cfg))
    .map(drawer => ({ drawer, score: scoreDrawer(drawer, tokens, normalized) }))
    .filter(item => item.score > item.drawer.salience || item.drawer.salience >= 8)
    .sort((a, b) => b.score - a.score || b.drawer.ts.localeCompare(a.drawer.ts));
  return scored.slice(0, limit).map(item => item.drawer);
}

export async function loadMemoryPalaceContext(cfg: ProfileConfig, incoming?: string): Promise<MemoryPalaceContext> {
  await ensureDefaults(cfg);
  const [facts, episodesRaw, timeline, attachment, openLoops, promises, weeklyLife, socialGraph, habits, palaceHits] = await Promise.all([
    readMd(cfg.slug, "memory/facts.md"),
    readMd(cfg.slug, `memory/episodes/${today(cfg.tz)}.md`),
    readMd(cfg.slug, "relationship/timeline.md"),
    readMd(cfg.slug, "personality/attachment.md"),
    readMd(cfg.slug, "time/open-loops.md"),
    readMd(cfg.slug, "time/promises.md"),
    readMd(cfg.slug, "life/week-plan.md"),
    readMd(cfg.slug, "life/contacts.md"),
    readMd(cfg.slug, "life/habits.md"),
    incoming && incoming.trim().length > 3 ? searchPalaceDrawers(cfg, incoming, 10) : Promise.resolve([])
  ]);
  const query = incoming?.toLowerCase() ?? "";
  const factLines = facts.split("\n").filter(l => l.trim());
  const tokens = wordsFrom(query);
  const relevantFacts = tokens.length
    ? factLines.filter(l => tokens.some(t => l.toLowerCase().includes(t))).slice(-18).join("\n") || facts.slice(-1800)
    : facts.slice(-1800);
  return {
    facts: relevantFacts,
    episodes: episodesRaw.slice(-2200),
    relationshipTimeline: timeline.slice(-2200),
    attachment: attachment.slice(-1200),
    time: [openLoops.slice(-1400), promises.slice(-1400)].filter(Boolean).join("\n\n"),
    weeklyLife: weeklyLife.slice(-1200),
    socialGraph: socialGraph.slice(-1200),
    habits: habits.slice(-1200),
    openLoops: openLoops.slice(-1400),
    palace: renderPalaceRecall(palaceHits)
  };
}

export function memoryPalacePromptFragment(ctx: MemoryPalaceContext): string {
  return [
    "# Реалистичная непрерывность",
    "Используй эти данные как фон, а не как отчёт. Не говори, что у тебя есть память, файлы, факты или система.",
    "Если точного факта нет — не выдумывай уверенно; отвечай уклончиво или уточняй по-человечески.",
    ctx.palace,
    "## Факты о нём", ctx.facts,
    "## Эпизоды текущего дня", ctx.episodes || "пока нет ярких эпизодов",
    "## История отношений", ctx.relationshipTimeline,
    "## Привязанность и характер", ctx.attachment,
    "## Время, обещания, открытые петли", ctx.time || "нет открытых петель",
    "## Недельная жизнь", ctx.weeklyLife,
    "## Социальный круг", ctx.socialGraph,
    "## Привычки", ctx.habits
  ].filter(Boolean).join("\n\n");
}

async function appendDrawer(cfg: ProfileConfig, source: string, parsed: ParsedMemoryDrawer): Promise<void> {
  const stamp = nowStamp();
  const quoteKey = normalizedQuote(parsed.quote);
  const duplicate = (await listPalaceDrawers(cfg)).find(existing =>
    normalizedQuote(existing.quote) === quoteKey ||
    (existing.room === parsed.room && existing.hall === parsed.hall && normalizedQuote(existing.quote).includes(quoteKey)) ||
    (existing.room === parsed.room && existing.hall === parsed.hall && quoteKey.includes(normalizedQuote(existing.quote)))
  );
  if (duplicate && duplicate.salience >= parsed.salience) return;
  const drawer: MemoryDrawer = {
    id: stableId(source, parsed.quote),
    ts: stamp,
    wing: wingFor(cfg),
    room: parsed.room,
    hall: parsed.hall,
    source,
    quote: parsed.quote,
    keywords: parsed.keywords,
    salience: parsed.salience
  };
  const existing = await readMd(cfg.slug, drawerPath(drawer));
  if (existing.trim()) return;
  await writeMd(cfg.slug, drawerPath(drawer), renderDrawer(drawer));
  await appendCompatibilityMemory(cfg, drawer);
}

async function appendCompatibilityMemory(cfg: ProfileConfig, drawer: MemoryDrawer): Promise<void> {
  const stamp = drawer.ts;
  const line = `- ${stamp}: ${drawer.quote}\n`;
  if (drawer.hall === "hall_facts" || drawer.hall === "hall_preferences" || drawer.hall === "hall_discoveries") {
    await appendMd(cfg.slug, "memory/facts.md", line);
    await appendMd(cfg.slug, "memory/long-term.md", `\n## ${stamp.slice(0, 16)}\n- ${drawer.quote}`);
  } else if (drawer.hall === "hall_events" || drawer.hall === "hall_feelings") {
    await appendMd(cfg.slug, `memory/episodes/${today(cfg.tz)}.md`, line);
  } else if (drawer.hall === "hall_promises") {
    await appendMd(cfg.slug, "time/promises.md", line);
  } else if (drawer.hall === "hall_open_loops") {
    await appendMd(cfg.slug, "time/open-loops.md", line);
  } else if (drawer.hall === "hall_uncertain") {
    await appendMd(cfg.slug, "memory/uncertain.md", line);
  }
  if (drawer.hall === "hall_events" && drawer.salience >= 8) {
    await appendMd(cfg.slug, "relationship/timeline.md", line);
  }
}

export async function recordInteractionMemory(llm: LLMClient, cfg: ProfileConfig, incoming: string, reply?: string): Promise<void> {
  if (!incoming.trim()) return;
  await ensureDefaults(cfg);
  const raw = await llm.chat([
    {
      role: "system",
      content: `Ты извлекаешь память для Telegram-персоны. Принцип MemPalace: сохранять оригинальные формулировки дословно, не пересказывать и не сжимать. Нужны только явные факты, предпочтения, обещания, открытые петли, эмоциональные эпизоды и сомнительные факты. Если важна целая фраза — сохрани её целиком без обрезки ни одного слова. Не выдумывай.`
    },
    {
      role: "user",
      content: `Профиль: ${cfg.name}, стадия ${cfg.stage}.
Он написал:
"""
${incoming}
"""

Она ответила:
"""
${reply ?? ""}
"""

Верни STRICT JSON:
{
  "drawers": [
    {
      "room": "короткая тема на русском или latin-slug",
      "hall": "hall_facts | hall_events | hall_discoveries | hall_preferences | hall_advice | hall_promises | hall_open_loops | hall_feelings | hall_uncertain",
      "quote": "дословная фраза/фрагмент из переписки, без пересказа и без обрезки важных слов",
      "keywords": ["слова для поиска"],
      "salience": 1-10
    }
  ]
}`
    }
  ], { temperature: 0.1, maxTokens: 3500, json: true });
  const parsed = parseJsonObject(raw);
  const drawers = parsedDrawers(parsed?.drawers).slice(0, 12);
  for (const drawer of drawers) {
    await appendDrawer(cfg, "interaction", drawer);
  }
}

export async function mineDailyLogToPalace(llm: LLMClient, cfg: ProfileConfig, day: string): Promise<number> {
  await ensureDefaults(cfg);
  const log = await readSessionLog(cfg.slug, day);
  if (!log.trim()) return 0;
  const chunks = splitTextByChars(log, 12000);
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    const raw = await llm.chat([
      {
        role: "system",
        content: `Ты майнишь дневной лог переписки в Memory Palace. Сохраняй максимум фактов и формулировок дословно. Не суммаризируй вместо quote: quote должен быть оригинальным фрагментом лога. Можно много drawers, но каждый — отдельный атом памяти.`
      },
      {
        role: "user",
        content: `День: ${day}. Профиль: ${cfg.name}, стадия ${cfg.stage}.
Часть ${i + 1}/${chunks.length}. Лог:
"""
${chunks[i] ?? ""}
"""

Верни STRICT JSON:
{
  "drawers": [
    {
      "room": "тема",
      "hall": "hall_facts | hall_events | hall_discoveries | hall_preferences | hall_advice | hall_promises | hall_open_loops | hall_feelings | hall_uncertain",
      "quote": "дословный фрагмент лога без обрезки важных слов",
      "keywords": ["поиск"],
      "salience": 1-10
    }
  ]
}`
      }
    ], { temperature: 0.1, maxTokens: 8000, json: true });
    const parsed = parseJsonObject(raw);
    const drawers = parsedDrawers(parsed?.drawers).slice(0, 80);
    for (const drawer of drawers) {
      await appendDrawer(cfg, `log/${day}`, drawer);
    }
    total += drawers.length;
  }
  if (total) {
    await writeMd(cfg.slug, `memory/palace/.mined/${day}.txt`, nowStamp() + "\n");
  }
  return total;
}

function splitTextByChars(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    if (current.length + line.length + 1 > maxChars && current) {
      chunks.push(current);
      current = "";
    }
    current += current ? `\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function mineUnminedDailyLogs(llm: LLMClient, cfg: ProfileConfig, maxDays = 3): Promise<number> {
  const todayDay = today(cfg.tz);
  const days = (await listSessionDays(cfg.slug)).filter(day => day !== todayDay).reverse();
  let mined = 0;
  let checked = 0;
  for (const day of days) {
    if (checked >= maxDays) break;
    const mark = await readMd(cfg.slug, `memory/palace/.mined/${day}.txt`);
    if (mark.trim()) continue;
    checked++;
    mined += await mineDailyLogToPalace(llm, cfg, day);
  }
  return mined;
}

export async function migrateExistingMemoryToPalace(cfg: ProfileConfig): Promise<number> {
  await ensureDefaults(cfg);
  const existing = await listPalaceDrawers(cfg);
  if (existing.length) return 0;
  let made = 0;
  const wing = wingFor(cfg);
  const migrateLines = async (source: string, content: string, hall: MemoryHall, room: string) => {
    const lines = content.split("\n").map(line => line.trim()).filter(line => line.startsWith("- "));
    for (const line of lines) {
      const quote = line.replace(/^-\s*/, "").trim();
      if (!quote) continue;
      const drawer: MemoryDrawer = {
        id: safeId(),
        ts: nowStamp(),
        wing,
        room: normalizeRoom(room),
        hall,
        source,
        quote,
        keywords: normalizeKeywords([], quote, room),
        salience: hall === "hall_uncertain" ? 4 : 6
      };
      await writeMd(cfg.slug, drawerPath(drawer), renderDrawer(drawer));
      made++;
    }
  };
  await migrateLines("memory/facts.md", await readMd(cfg.slug, "memory/facts.md"), "hall_facts", "facts");
  await migrateLines("memory/uncertain.md", await readMd(cfg.slug, "memory/uncertain.md"), "hall_uncertain", "uncertain");
  await migrateLines("time/promises.md", await readMd(cfg.slug, "time/promises.md"), "hall_promises", "promises");
  await migrateLines("time/open-loops.md", await readMd(cfg.slug, "time/open-loops.md"), "hall_open_loops", "open-loops");
  const dailyDays = await listDailySummaries(cfg.slug);
  for (const day of dailyDays.slice(-30)) {
    const summary = await readDailySummary(cfg.slug, day);
    if (summary.trim()) {
      const drawer: MemoryDrawer = {
        id: safeId(),
        ts: nowStamp(),
        wing,
        room: normalizeRoom(day),
        hall: "hall_events",
        source: `memory/daily/${day}.md`,
        quote: summary.trim(),
        keywords: normalizeKeywords([day], summary, day),
        salience: 5
      };
      await writeMd(cfg.slug, drawerPath(drawer), renderDrawer(drawer));
      made++;
    }
  }
  return made;
}
