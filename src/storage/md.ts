import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, accessSync, constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ProfileConfig, RelationshipScore } from "../types.js";
import { normalizeCommunicationProfile, normalizeIgnoreTendency } from "../presets/communication.js";

/**
 * Корневая директория профилей.
 *
 * Можно переопределить через `MANAGER_AGENT_DATA` (используется десктоп-обвязкой,
 * чтобы хранить данные в `%APPDATA%/manager-agent/data` или `~/.local/share/...`).
 * По-умолчанию:
 * - в исходниках проекта — `./data`;
 * - при запуске через npx/глобальный бинарь из произвольной папки — XDG data dir.
 */
export const DATA_ROOT = process.env.MANAGER_AGENT_DATA
  ? path.resolve(process.env.MANAGER_AGENT_DATA)
  : defaultDataRoot();

function canWriteDir(dir: string): boolean {
  try {
    existsSync(dir) || mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultDataRoot(): string {
  const cwd = process.cwd();
  const projectData = path.resolve(cwd, "data");
  if (looksLikeProjectRoot(cwd) && canWriteDir(path.dirname(projectData))) return projectData;
  // На Windows храним в %APPDATA%\\manager-agent\\data — это ожидаемое
  // место для конфига npm-приложений, при отсутствии XDG.
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA
      ? path.resolve(process.env.APPDATA)
      : path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "manager-agent", "data");
  }
  // macOS: ~/Library/Application Support/manager-agent/data (если не задан XDG)
  if (process.platform === "darwin" && !process.env.XDG_DATA_HOME) {
    return path.join(os.homedir(), "Library", "Application Support", "manager-agent", "data");
  }
  const xdg = process.env.XDG_DATA_HOME
    ? path.resolve(process.env.XDG_DATA_HOME)
    : path.join(os.homedir(), ".local", "share");
  return path.join(xdg, "manager-agent", "data");
}

function looksLikeProjectRoot(dir: string): boolean {
  return existsSync(path.join(dir, "package.json")) &&
    (existsSync(path.join(dir, "src")) || existsSync(path.join(dir, "dist")));
}

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
    const ownerId = normalizeOwnerId(parsed.ownerId);
    const ignoreTendency = normalizeIgnoreTendency(parsed.ignoreTendency);
    return {
      sleepFrom: 23,
      sleepTo: 8,
      nightWakeChance: 0.05,
      privacy: "owner-only",
      busySchedule: [],
      ...parsed,
      ownerId,
      ignoreTendency,
      communication
    } as ProfileConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(cfg: ProfileConfig): Promise<void> {
  await ensureProfile(cfg.slug);
  const ownerId = normalizeOwnerId(cfg.ownerId ?? process.env.MANAGER_AGENT_OWNER_ID);
  const normalized = ownerId === undefined
    ? { ...cfg, ownerId: undefined, ignoreTendency: normalizeIgnoreTendency(cfg.ignoreTendency) }
    : { ...cfg, ownerId, ignoreTendency: normalizeIgnoreTendency(cfg.ignoreTendency) };
  await fs.writeFile(
    path.join(profileDir(cfg.slug), "config.json"),
    JSON.stringify(normalized, null, 2),
    "utf8"
  );
}

export async function deleteProfile(slug: string): Promise<void> {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug === "." || slug === "..") {
    throw new Error(`некорректный slug профиля: ${slug}`);
  }
  await fs.rm(profileDir(slug), { recursive: true, force: true });
}

export function normalizeOwnerId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
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
  fromId?: number;
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

/**
 * Депрекейтед: раньше эта функция использовала UTC, из-за чего время в логах отличалось
 * от daily-life/agenda/memory (Issue #78). Теперь она просто прокси на appendSessionLog
 * с дефолтной tz Europe/Moscow (совместимость для старых call-sites без tz).
 */
export async function appendDayLog(slug: string, line: string, tz = "Europe/Moscow"): Promise<void> {
  await appendSessionLog(slug, tz, line);
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
export async function appendSessionLog(slug: string, tz: string, line: string, fromId?: number): Promise<void> {
  const day = sessionDate(tz);
  const suffix = fromId ? ` <!--from:${fromId}-->` : "";
  await appendMd(slug, `log/${day}.md`, line + suffix + "\n");
}

export async function appendSharedMemory(slug: string, tz: string, fromId: number, text: string): Promise<void> {
  const day = sessionDate(tz);
  const safe = text.replace(/\s+/g, " ").trim();
  if (!safe) return;
  const line = `- ${new Date().toISOString()} user:${fromId} day:${day}: ${safe}`;
  const raw = await readMd(slug, "memory/shared-cross-chat.md");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.slice(-20).some(existing => existing.endsWith(`: ${safe}`))) return;
  await writeMd(slug, "memory/shared-cross-chat.md", [...lines.slice(-500), line].join("\n") + "\n");
}

export async function readSharedMemory(slug: string, limit = 40): Promise<string> {
  const raw = await readMd(slug, "memory/shared-cross-chat.md");
  return raw.split(/\r?\n/).filter(Boolean).slice(-limit).join("\n");
}

export async function searchSharedMemory(slug: string, query: string, limit = 8): Promise<string> {
  const raw = await readMd(slug, "memory/shared-cross-chat.md");
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const hits = tokens.length
    ? lines.filter(line => tokens.some(t => line.toLowerCase().includes(t)))
    : [];
  return (hits.length ? hits : lines).slice(-limit).join("\n");
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
        turns.push({ role: "user", content: user[3] ?? "", ts: Date.parse(user[1] ?? "") || undefined, fromId: Number(user[2]) });
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
  const days = [...new Set([...(await listSessionDays(slug)), day])]
    .filter(d => d <= day)
    .sort()
    .slice(-4);
  const raw = (await Promise.all(days.map(d => readSessionLog(slug, d)))).join("\n");
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


// ============================================================================
// Manager-mode: contacts storage (Task 3.4 .kiro/specs/manager-mode/tasks.md).
//
// Каждый контакт хранится в `data/<slug>/contacts/<chatId>.json` как
// `ContactRecord`. Запись атомарна (write-temp + rename), чтение лояльно к
// отсутствию файла, листинг возвращает уже распарсенные записи. Round-trip
// тест в `src/__tests__/storage/contacts.spec.ts` (Property 6).
// ============================================================================

import type { ContactRecord, Tier } from "../types.js";

const VALID_TIERS: ReadonlyArray<Tier> = [
  "cold-stranger",
  "introduced",
  "regular",
  "trusted-partner",
  "vip",
  "blocked"
];

function contactsDir(slug: string): string {
  return path.join(profileDir(slug), "contacts");
}

function contactFile(slug: string, chatId: string): string {
  // chatId уже строка; на всякий случай нормализуем подозрительные символы.
  const safe = chatId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(contactsDir(slug), `${safe}.json`);
}

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function isValidContact(raw: unknown): raw is ContactRecord {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<ContactRecord>;
  if (typeof r.chatId !== "string" || r.chatId.length === 0) return false;
  if (!r.tier || !VALID_TIERS.includes(r.tier)) return false;
  if (typeof r.manualOverride !== "boolean") return false;
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string") return false;
  if (!r.score || typeof r.score !== "object") return false;
  const s = r.score as Partial<ContactRecord["score"]>;
  for (const k of ["relevance", "trust", "urgency", "annoyance", "spamScore"] as const) {
    if (typeof s[k] !== "number" || !Number.isFinite(s[k])) return false;
  }
  return true;
}

/**
 * Загружает контакт по `chatId`. Возвращает `null` если файл не существует
 * или содержит невалидную структуру.
 */
export async function loadContact(slug: string, chatId: string): Promise<ContactRecord | null> {
  try {
    const raw = await fs.readFile(contactFile(slug, chatId), "utf8");
    const parsed = JSON.parse(raw);
    if (!isValidContact(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Сохраняет контакт атомарно (write-temp + rename). */
export async function saveContact(slug: string, contact: ContactRecord): Promise<void> {
  if (!isValidContact(contact)) {
    throw new Error(`invalid contact: ${JSON.stringify(contact).slice(0, 200)}`);
  }
  await atomicWriteJson(contactFile(slug, contact.chatId), contact);
}

/** Список контактов профиля (только валидные). */
export async function listContacts(slug: string): Promise<ContactRecord[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(contactsDir(slug));
  } catch {
    return [];
  }
  const out: ContactRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const chatId = name.slice(0, -".json".length);
    const c = await loadContact(slug, chatId);
    if (c) out.push(c);
  }
  return out;
}

/** Удаляет файл контакта. No-op если файла нет. */
export async function deleteContact(slug: string, chatId: string): Promise<void> {
  try {
    await fs.unlink(contactFile(slug, chatId));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
