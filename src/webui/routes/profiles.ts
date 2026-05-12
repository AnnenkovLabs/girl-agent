import { Router, HttpError } from "../http.js";
import {
  DATA_ROOT, listProfiles, readConfig, writeConfig, deleteProfile, ensureProfile,
  readMd, writeMd, slugify, normalizeOwnerId, profileDir, readRelationship, sessionDate,
  readSessionLog, listSessionDays, listDailySummaries, readDailySummary
} from "../../storage/md.js";
import type { ProfileConfig } from "../../types.js";
import { bus } from "../runtime-bus.js";
import { findStage } from "../../presets/stages.js";
import { generatePersonaPack } from "../../engine/persona-gen.js";
import { makeLLM } from "../../llm/index.js";
import { applyLLMUpdate, describeLLM } from "../../config/llm-update.js";
import { findPreset } from "../../presets/llm.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const MEMORY_FILES = [
  "persona.md",
  "speech.md",
  "boundaries.md",
  "communication.md",
  "long-term.md",
  "memory/long-term.md"
] as const;

function isAllowedMemoryPath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  if (p.includes("..")) return false;
  if (path.isAbsolute(p)) return false;
  if (p.startsWith("config.json")) return false;
  if (p.startsWith("agenda.json")) return false;
  // Allow well-known memory and per-day files
  if ((MEMORY_FILES as readonly string[]).includes(p)) return true;
  if (/^memory\/daily\/\d{4}-\d{2}-\d{2}\.md$/.test(p)) return true;
  if (/^memory\/episodes\/[\w\-]{1,80}\.md$/.test(p)) return true;
  if (/^log\/\d{4}-\d{2}-\d{2}\.md$/.test(p)) return true;
  return false;
}

export function registerProfileRoutes(r: Router): void {
  r.get("/api/profiles", async () => {
    const slugs = await listProfiles();
    const profiles = await Promise.all(slugs.map(async (slug) => {
      const cfg = await readConfig(slug);
      const status = bus.status(slug);
      if (!cfg) return null;
      return {
        slug: cfg.slug,
        name: cfg.name,
        age: cfg.age,
        nationality: cfg.nationality,
        stage: cfg.stage,
        mode: cfg.mode,
        status: status.state,
        startedAt: status.startedAt,
        lastError: status.lastError
      };
    }));
    return { profiles: profiles.filter(Boolean), dataRoot: DATA_ROOT };
  });

  r.get("/api/profiles/:slug", async ({ params }) => {
    const cfg = await readConfig(params.slug ?? "");
    if (!cfg) throw new HttpError(404, "profile not found");
    const status = bus.status(cfg.slug);
    return { config: cfg, status };
  });

  r.put("/api/profiles/:slug", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const cur = await readConfig(slug);
    if (!cur) throw new HttpError(404, "profile not found");
    const incoming = body as Partial<ProfileConfig>;
    if (!incoming || typeof incoming !== "object") throw new HttpError(400, "invalid body");
    const merged: ProfileConfig = { ...cur, ...incoming, slug: cur.slug };
    if (incoming.ownerId !== undefined) merged.ownerId = normalizeOwnerId(incoming.ownerId);
    await writeConfig(merged);
    return { config: merged };
  });

  r.post("/api/profiles", async ({ body }) => {
    const data = body as Partial<ProfileConfig> | undefined;
    if (!data || !data.name || typeof data.name !== "string") throw new HttpError(400, "name required");
    const slug = data.slug || slugify(data.name);
    const existing = await readConfig(slug);
    if (existing) throw new HttpError(409, `profile already exists: ${slug}`);
    const cfg: ProfileConfig = {
      slug,
      name: data.name,
      age: data.age ?? 22,
      nationality: data.nationality ?? "RU",
      tz: data.tz ?? "Europe/Moscow",
      mode: data.mode ?? "bot",
      stage: data.stage ?? "tg-given-cold",
      llm: data.llm ?? { presetId: "claudehub", proto: "anthropic", apiKey: "", model: "claude-sonnet-4.6" },
      telegram: data.telegram ?? {},
      mcp: data.mcp ?? [],
      privacy: data.privacy ?? "owner-only",
      ownerId: normalizeOwnerId(data.ownerId),
      createdAt: new Date().toISOString(),
      sleepFrom: data.sleepFrom ?? 23,
      sleepTo: data.sleepTo ?? 8,
      nightWakeChance: data.nightWakeChance ?? 0.05,
      ignoreTendency: data.ignoreTendency ?? 35,
      vibe: data.vibe,
      communication: data.communication,
      personaNotes: data.personaNotes,
      busySchedule: data.busySchedule ?? []
    };
    await writeConfig(cfg);
    return { config: cfg };
  });

  r.delete("/api/profiles/:slug", async ({ params }) => {
    const slug = params.slug ?? "";
    if (bus.get(slug)) await bus.stop(slug);
    await deleteProfile(slug);
    return { ok: true };
  });

  r.post("/api/profiles/:slug/apply", async ({ params }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const status = await bus.restart(slug);
    return { ok: true, status };
  });

  r.post("/api/profiles/:slug/start", async ({ params }) => {
    const status = await bus.start(params.slug ?? "");
    return { ok: true, status };
  });

  r.post("/api/profiles/:slug/stop", async ({ params }) => {
    await bus.stop(params.slug ?? "");
    return { ok: true, status: bus.status(params.slug ?? "") };
  });

  r.post("/api/profiles/:slug/pause", async ({ params }) => {
    const ok = bus.pause(params.slug ?? "");
    if (!ok) throw new HttpError(404, "profile not running");
    return { ok: true, status: bus.status(params.slug ?? "") };
  });

  r.post("/api/profiles/:slug/resume", async ({ params }) => {
    const ok = bus.resume(params.slug ?? "");
    if (!ok) throw new HttpError(404, "profile not running");
    return { ok: true, status: bus.status(params.slug ?? "") };
  });

  r.post("/api/profiles/:slug/command", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const rt = bus.get(slug);
    if (!rt) throw new HttpError(409, "runtime not running");
    const { command, args } = (body as { command?: string; args?: string[] }) ?? {};
    if (!command) throw new HttpError(400, "command required");
    const a = args ?? [];
    let text = "";
    switch (command) {
      case "status": text = await rt.cmdStatus(); break;
      case "model": text = await rt.cmdModel(a); break;
      case "reset": text = await rt.cmdReset(); break;
      case "stage": text = await rt.cmdSetStage(a.join(" ")); break;
      case "wake": text = await rt.cmdWake(a[0]); break;
      case "debug": text = await rt.cmdDebug(a[0]); break;
      case "why": text = await rt.cmdWhy(a[0]); break;
      case "amnesia": text = await rt.cmdAmnesia(a[0] ?? "", a[1]); break;
      case "sticker": text = await rt.cmdSticker(a[0]); break;
      case "pause": rt.pause(); text = "pause"; break;
      case "resume": rt.resume(); text = "resume"; break;
      default: throw new HttpError(400, `unknown command: ${command}`);
    }
    return { ok: true, text };
  });

  r.get("/api/profiles/:slug/relationship", async ({ params }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const rel = await readRelationship(slug);
    const stage = findStage(rel.stage);
    return { stage: { id: stage.id, num: stage.num, label: stage.label }, score: rel.score };
  });

  // Memory files
  r.get("/api/profiles/:slug/memory", async ({ params }) => {
    const slug = params.slug ?? "";
    await ensureProfile(slug);
    const dir = profileDir(slug);
    const items: { path: string; size: number; mtime: number }[] = [];
    const entries: { rel: string }[] = [];
    for (const f of MEMORY_FILES) entries.push({ rel: f });
    try {
      const dailyDir = path.join(dir, "memory", "daily");
      const list = await fs.readdir(dailyDir);
      for (const f of list) if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) entries.push({ rel: `memory/daily/${f}` });
    } catch { /* no daily dir */ }
    try {
      const epDir = path.join(dir, "memory", "episodes");
      const list = await fs.readdir(epDir);
      for (const f of list) if (/^[\w\-]{1,80}\.md$/.test(f)) entries.push({ rel: `memory/episodes/${f}` });
    } catch { /* no episodes dir */ }
    for (const e of entries) {
      try {
        const stat = await fs.stat(path.join(dir, e.rel));
        items.push({ path: e.rel, size: stat.size, mtime: stat.mtimeMs });
      } catch { /* file may not exist yet */ }
    }
    return { files: items };
  });

  r.get("/api/profiles/:slug/memory/file", async ({ params, searchParams }) => {
    const slug = params.slug ?? "";
    const file = searchParams.get("path") ?? "";
    if (!isAllowedMemoryPath(file)) throw new HttpError(400, "path not allowed");
    const content = await readMd(slug, file);
    return { path: file, content };
  });

  r.put("/api/profiles/:slug/memory/file", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const data = body as { path?: string; content?: string };
    if (!data?.path || typeof data.content !== "string") throw new HttpError(400, "path/content required");
    if (!isAllowedMemoryPath(data.path)) throw new HttpError(400, "path not allowed");
    if (data.path === "relationship.md") throw new HttpError(403, "relationship.md is readonly via UI");
    await writeMd(slug, data.path, data.content);
    return { ok: true };
  });

  // Logs
  r.get("/api/profiles/:slug/logs/days", async ({ params }) => {
    return { days: await listSessionDays(params.slug ?? "") };
  });

  r.get("/api/profiles/:slug/logs/buffer", async ({ params }) => {
    return { events: bus.recentLogs(params.slug ?? "") };
  });

  r.get("/api/profiles/:slug/logs/file", async ({ params, searchParams }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("day") ?? "")
      ? searchParams.get("day")!
      : sessionDate(cfg.tz);
    const content = await readSessionLog(slug, day);
    return { day, content };
  });

  r.get("/api/profiles/:slug/memory/daily-list", async ({ params }) => {
    return { days: await listDailySummaries(params.slug ?? "") };
  });

  r.get("/api/profiles/:slug/memory/daily", async ({ params, searchParams }) => {
    const day = searchParams.get("day") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "invalid day");
    return { day, content: await readDailySummary(params.slug ?? "", day) };
  });

  // LLM update / persona generation / connection tests
  r.post("/api/profiles/:slug/llm-update", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const data = body as { presetId?: string; model?: string; apiKey?: string; baseURL?: string; proto?: "openai" | "anthropic" };
    const changed = applyLLMUpdate(cfg, data ?? {});
    await writeConfig(cfg);
    return { changed, description: describeLLM(cfg) };
  });

  r.post("/api/profiles/:slug/test-llm", async ({ params }) => {
    const cfg = await readConfig(params.slug ?? "");
    if (!cfg) throw new HttpError(404, "profile not found");
    try {
      const llm = makeLLM(cfg.llm);
      const reply = await llm.chat([
        { role: "system", content: "Ответь одним коротким словом 'ok'." },
        { role: "user", content: "ping" }
      ], { temperature: 0, maxTokens: 16 });
      return { ok: true, reply: reply.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? String(e) };
    }
  });

  r.post("/api/profiles/:slug/generate-persona", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const data = (body as { name?: string; age?: number; nationality?: "RU" | "UA"; notes?: string }) ?? {};
    const llm = makeLLM(cfg.llm);
    const generated = await generatePersonaPack(
      llm,
      cfg.slug,
      data.name ?? cfg.name,
      data.age ?? cfg.age,
      data.nationality ?? cfg.nationality,
      data.notes ?? cfg.personaNotes
    );
    cfg.busySchedule = generated.busySchedule;
    await writeConfig(cfg);
    return { ok: true, busySchedule: generated.busySchedule };
  });

  // Diagnostics: which preset id? get the list
  r.get("/api/presets/llm-detect", async ({ searchParams }) => {
    const id = searchParams.get("id") ?? "";
    const preset = findPreset(id);
    return { preset: preset ?? null };
  });
}
