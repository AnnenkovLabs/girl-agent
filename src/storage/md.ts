import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileConfig, RelationshipScore } from "../types.js";
import { normalizeCommunicationProfile } from "../presets/communication.js";

/**
 * Корневая директория профилей.
 *
 * Можно переопределить через `GIRL_AGENT_DATA` (используется десктоп-обвязкой,
 * чтобы хранить данные в `%APPDATA%/girl-agent/data` или `~/.local/share/...`).
 * По-умолчанию — `./data` относительно cwd, как раньше.
 */
export const DATA_ROOT = process.env.GIRL_AGENT_DATA
  ? path.resolve(process.env.GIRL_AGENT_DATA)
  : path.resolve(process.cwd(), "data");

export function profileDir(slug: string): string {
  return path.join(DATA_ROOT, slug);
}

export async function ensureProfile(slug: string): Promise<void> {
  const dir = profileDir(slug);
  await fs.mkdir(path.join(dir, "memory", "episodes"), { recursive: true });
  await fs.mkdir(path.join(dir, "log"), { recursive: true });
}

export async function readMd(slug: string, name: string): Promise<string> {
  const p = path.join(profileDir(slug), name);
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return "";
  }
}

export async function writeMd(slug: string, name: string, content: string): Promise<void> {
  const p = path.join(profileDir(slug), name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8");
}

export async function appendMd(slug: string, name: string, content: string): Promise<void> {
  const p = path.join(profileDir(slug), name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, content, "utf8");
}

export async function readConfig(slug: string): Promise<ProfileConfig | null> {
  try {
    const raw = await fs.readFile(path.join(profileDir(slug), "config.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProfileConfig>;
    const communication = normalizeCommunicationProfile(parsed);
    return {
      sleepFrom: 23,
      sleepTo: 8,
      nightWakeChance: 0.05,
      privacy: "owner-only",
      busySchedule: [],
      ...parsed,
      communication
    } as ProfileConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(cfg: ProfileConfig): Promise<void> {
  await ensureProfile(cfg.slug);
  await fs.writeFile(
    path.join(profileDir(cfg.slug), "config.json"),
    JSON.stringify(cfg, null, 2),
    "utf8"
  );
}

export async function listProfiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const valid = await Promise.all(dirs.map(async (name) => {
      try {
        await fs.access(path.join(profileDir(name), "config.json"));
        return name;
      } catch {
        return null;
      }
    }));
    return valid.filter((name): name is string => !!name);
  } catch {
    return [];
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `profile-${Date.now().toString(36)}`;
}

export interface RelationshipState {
  stage: string;
  score: RelationshipScore;
  notes: string;
}

export interface StoredConversationTurn {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

const SCORE_RE = /<!--score:(.+?)-->/;

export async function readRelationship(slug: string): Promise<RelationshipState> {
  const raw = await readMd(slug, "relationship.md");
  const m = raw.match(SCORE_RE);
  let score: RelationshipScore = { interest: 0, trust: 0, attraction: 0, annoyance: 0, cringe: 0 };
  if (m) {
    try { score = JSON.parse(m[1]); } catch { /* ignore */ }
  }
  const stageMatch = raw.match(/^stage:\s*(.+)$/m);
  return {
    stage: stageMatch?.[1]?.trim() ?? "tg-given-cold",
    score,
    notes: raw
  };
}

export async function writeRelationship(slug: string, state: RelationshipState): Promise<void> {
  let body = state.notes;
  if (SCORE_RE.test(body)) {
    body = body.replace(SCORE_RE, `<!--score:${JSON.stringify(state.score)}-->`);
  } else {
    body = `stage: ${state.stage}\n<!--score:${JSON.stringify(state.score)}-->\n\n${body || ""}`;
  }
  if (!/^stage:\s*/m.test(body)) body = `stage: ${state.stage}\n` + body;
  else body = body.replace(/^stage:\s*.+$/m, `stage: ${state.stage}`);
  await writeMd(slug, "relationship.md", body);
}

/** Старая версия — оставлена для совместимости. Использует UTC. Предпочитай appendSessionLog. */
export async function appendDayLog(slug: string, line: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await appendMd(slug, `log/${today}.md`, line + "\n");
}

/**
 * Возвращает строку YYYY-MM-DD для "сессионного дня".
 * Сессионный день — это её локальная дата, но если время от 00:00 до 04:59 — относится к ПРЕДЫДУЩЕМУ дню.
 * Это нужно чтобы переписка в 23:59 → 00:30 не разрывалась на два файла.
 */
export function sessionDate(tz: string, now = new Date()): string {
  let y: number, mo: number, d: number, h: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hour12: false });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
    y = parseInt(get("year"), 10);
    mo = parseInt(get("month"), 10);
    d = parseInt(get("day"), 10);
    h = parseInt(get("hour"), 10);
  } catch {
    y = now.getUTCFullYear(); mo = now.getUTCMonth() + 1; d = now.getUTCDate(); h = now.getUTCHours();
  }
  if (h < 5) {
    // на день назад
    const prev = new Date(Date.UTC(y, mo - 1, d));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Аппенд в session-aware дневник. Используй вместо appendDayLog. */
export async function appendSessionLog(slug: string, tz: string, line: string): Promise<void> {
  const day = sessionDate(tz);
  await appendMd(slug, `log/${day}.md`, line + "\n");
}

/** Список всех session-дней в порядке возрастания */
export async function listSessionDays(slug: string): Promise<string[]> {
  try {
    const dir = path.join(profileDir(slug), "log");
    const files = await fs.readdir(dir);
    return files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => f.replace(/\.md$/, ""))
      .sort();
  } catch { return []; }
}

/** Daily summary (генерится по итогам сессии) */
export async function readDailySummary(slug: string, day: string): Promise<string> {
  return readMd(slug, `memory/daily/${day}.md`);
}

export async function writeDailySummary(slug: string, day: string, content: string): Promise<void> {
  await writeMd(slug, `memory/daily/${day}.md`, content);
}

export async function listDailySummaries(slug: string): Promise<string[]> {
  try {
    const dir = path.join(profileDir(slug), "memory", "daily");
    const files = await fs.readdir(dir);
    return files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => f.replace(/\.md$/, ""))
      .sort();
  } catch { return []; }
}

/** Простой поиск по всем daily summaries (substring + word match). Возвращает топ-N релевантных дней. */
export async function searchDailySummaries(slug: string, query: string, limit = 5): Promise<{ day: string; excerpt: string; score: number }[]> {
  const days = await listDailySummaries(slug);
  if (!days.length) return [];
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
  if (!tokens.length) return [];
  const out: { day: string; excerpt: string; score: number }[] = [];
  for (const day of days) {
    const txt = (await readDailySummary(slug, day)).toLowerCase();
    if (!txt) continue;
    let score = 0;
    for (const t of tokens) {
      const matches = txt.split(t).length - 1;
      score += matches;
    }
    if (score > 0) {
      // короткий excerpt: первая строка содержащая токен
      const lineMatch = txt.split("\n").find(l => tokens.some(t => l.includes(t))) ?? txt.slice(0, 200);
      out.push({ day, excerpt: lineMatch.slice(0, 240), score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Прочитать весь сырой лог одного session-дня */
export async function readSessionLog(slug: string, day: string): Promise<string> {
  return readMd(slug, `log/${day}.md`);
}

export function parseSessionLogTurns(raw: string, fromId?: number, limit = 30): StoredConversationTurn[] {
  const turns: StoredConversationTurn[] = [];
  let currentChatMatches = fromId == null;
  for (const line of raw.split(/\r?\n/)) {
    const user = line.match(/^\[(.+?)\]\s+он\((\d+)\):\s*(.*)$/);
    if (user) {
      currentChatMatches = fromId == null || Number(user[2]) === fromId;
      if (currentChatMatches) {
        turns.push({ role: "user", content: user[3] ?? "", ts: Date.parse(user[1] ?? "") || undefined });
      }
      continue;
    }
    const assistant = line.match(/^\s*->\s+(?:\[proactive\]\s+)?она:\s*(.*)$/);
    if (assistant && currentChatMatches) {
      turns.push({ role: "assistant", content: assistant[1] ?? "" });
    }
  }
  return turns.slice(-limit);
}

export async function readRecentSessionTurns(slug: string, tz: string, fromId?: number, limit = 30): Promise<StoredConversationTurn[]> {
  const day = sessionDate(tz);
  const raw = await readSessionLog(slug, day);
  return parseSessionLogTurns(raw, fromId, limit);
}

// ===== Agenda (proactive scheduler) =====

export interface AgendaItem {
  id: string;                  // unique id
  about: string;               // короткое описание события юзера ("соревнования по плаванию")
  userEventTime?: string;      // ISO when user's event happens (если известно)
  pingAt: string;              // ISO when she should ping
  reason: string;              // почему пишет ("узнать как прошло", "пожелать удачи")
  importance: 1 | 2 | 3;       // 1=обычное любопытство, 3=сильно переживает
  state: "pending" | "fired" | "cancelled" | "rescheduled";
  attempts: number;            // сколько раз уже пинговала (для перепланировки)
  chatId: string | number;     // чат куда писать
  createdAt: string;
  history?: string[];          // лог событий по item ("user said отстань at ...")
}

export async function readAgenda(slug: string): Promise<AgendaItem[]> {
  try {
    const raw = await fs.readFile(path.join(profileDir(slug), "agenda.json"), "utf8");
    return JSON.parse(raw) as AgendaItem[];
  } catch {
    return [];
  }
}

export async function writeAgenda(slug: string, items: AgendaItem[]): Promise<void> {
  await ensureProfile(slug);
  await fs.writeFile(path.join(profileDir(slug), "agenda.json"), JSON.stringify(items, null, 2), "utf8");
}
