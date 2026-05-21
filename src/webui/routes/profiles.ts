import { Router, HttpError } from "../http.js";
import {
  DATA_ROOT, listProfiles, readConfig, writeConfig, deleteProfile, ensureProfile,
  readMd, writeMd, slugify, normalizeOwnerId, profileDir, readRelationship, sessionDate,
  readSessionLog, listSessionDays, listDailySummaries, readDailySummary,
  saveMandate, saveTickets
} from "../../storage/md.js";
import type {
  ProfileConfig, Tone, PersonaStyle, GateLevel, AfterHoursPolicy, WhitelistEntry, TicketsFile
} from "../../types.js";
import { parseTelegramProxyInput } from "../../telegram/proxy-parse.js";
import { bus } from "../runtime-bus.js";
import { legacyStage } from "../../engine/legacy-stage.js";
import { ensurePersonaPack, generatePersonaPack } from "../../engine/persona-gen.js";
import { makeLLM } from "../../llm/index.js";
import { applyLLMUpdate, describeLLM } from "../../config/llm-update.js";
import { findPreset } from "../../presets/llm.js";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const MEMORY_FILES = [
  "persona.md",
  "speech.md",
  "boundaries.md",
  "communication.md",
  "long-term.md",
  "memory/long-term.md",
  "memory/facts.md",
  "memory/uncertain.md",
  "relationship/timeline.md",
  "time/open-loops.md",
  "time/promises.md"
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
  if (/^memory\/palace\/[\w\-]{1,80}\/[\w\-]{1,80}\/[\w\-]{1,80}\/[\w\-]{1,120}\.md$/.test(p)) return true;
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
    if (incoming.telegram) {
      merged.telegram = {
        ...cur.telegram,
        ...incoming.telegram,
        proxy: parseTelegramProxyInput(incoming.telegram.proxy as unknown as string | undefined)
      };
    }
    await writeConfig(merged);
    return { config: merged };
  });

  r.post("/api/profiles", async ({ body }) => {
    // Тело визарда расширяется управленческим полем `mandate` (хранится
    // отдельно в `mandate.md`, не в `ProfileConfig`), поэтому типизируем
    // вход как ProfileConfig + этот доп. ключ.
    const data = body as (Partial<ProfileConfig> & { mandate?: unknown }) | undefined;
    if (!data || typeof data !== "object") throw new HttpError(400, "invalid body");

    const errors: Record<string, string> = {};

    // === name ===
    if (!data.name || typeof data.name !== "string" || data.name.length < 1 || data.name.length > 64) {
      errors.name = "name required (1..64 chars)";
    }

    // === slug ===
    const rawSlug = (typeof data.slug === "string" && data.slug.length > 0)
      ? data.slug
      : (typeof data.name === "string" ? slugify(data.name) : "");
    if (!rawSlug || rawSlug.length < 3 || rawSlug.length > 32 || !/^[a-z0-9-]+$/.test(rawSlug)) {
      errors.slug = "slug must be 3..32 chars, [a-z0-9-]";
    } else {
      const existing = await readConfig(rawSlug);
      if (existing) errors.slug = `profile already exists: ${rawSlug}`;
    }

    // === ownerId (Req 1.4: required, 1..9999999999999) ===
    const ownerId = normalizeOwnerId(data.ownerId);
    if (ownerId === undefined || ownerId < 1 || ownerId > 9_999_999_999_999) {
      errors.ownerId = "ownerId required (integer 1..9999999999999)";
    }

    // === enums with defaults (Req 1.3) ===
    const VALID_TONES: Tone[] = ["formal-вы", "friendly-ты", "mixed-by-tier"];
    const VALID_PERSONAS: PersonaStyle[] = ["gender-neutral-assistant", "female-secretary", "male-secretary"];
    const VALID_GATES: GateLevel[] = ["open", "gated", "whitelist"];
    const VALID_AHP: AfterHoursPolicy[] = ["silent", "auto-reply", "vip-only"];

    const tone: Tone = data.tone ?? "mixed-by-tier";
    if (!VALID_TONES.includes(tone)) errors.tone = `tone must be one of ${VALID_TONES.join("|")}`;

    const personaStyle: PersonaStyle = data.personaStyle ?? "gender-neutral-assistant";
    if (!VALID_PERSONAS.includes(personaStyle)) errors.personaStyle = `personaStyle must be one of ${VALID_PERSONAS.join("|")}`;

    const gateLevel: GateLevel = data.gateLevel ?? "gated";
    if (!VALID_GATES.includes(gateLevel)) errors.gateLevel = `gateLevel must be one of ${VALID_GATES.join("|")}`;

    const afterHoursPolicy: AfterHoursPolicy = data.afterHoursPolicy ?? "vip-only";
    if (!VALID_AHP.includes(afterHoursPolicy)) errors.afterHoursPolicy = `afterHoursPolicy must be one of ${VALID_AHP.join("|")}`;

    // === booleans ===
    if (data.proactiveClients !== undefined && typeof data.proactiveClients !== "boolean") {
      errors.proactiveClients = "proactiveClients must be boolean";
    }
    if (data.proactiveBoss !== undefined && typeof data.proactiveBoss !== "boolean") {
      errors.proactiveBoss = "proactiveBoss must be boolean";
    }

    // === mandate (string ≤4000) ===
    let mandate: string = "";
    if (data.mandate !== undefined && data.mandate !== null) {
      if (typeof data.mandate !== "string") {
        errors.mandate = "mandate must be string";
      } else if (data.mandate.length > 4000) {
        errors.mandate = "mandate must be ≤4000 chars";
      } else {
        mandate = data.mandate;
      }
    }

    // === whitelist (Req 1.9) ===
    let whitelist: WhitelistEntry[] | undefined;
    if (data.whitelist !== undefined) {
      if (!Array.isArray(data.whitelist)) {
        errors.whitelist = "whitelist must be array";
      } else {
        const entries: WhitelistEntry[] = [];
        let bad = false;
        for (let i = 0; i < data.whitelist.length; i++) {
          const e = data.whitelist[i] as Partial<WhitelistEntry> | undefined;
          if (!e || typeof e !== "object") { bad = true; break; }
          if (e.kind === "id") {
            const id = typeof e.chatId === "number" ? e.chatId : Number(e.chatId);
            if (!Number.isSafeInteger(id) || id < 1 || id > 9_999_999_999_999) { bad = true; break; }
            entries.push({ kind: "id", chatId: id });
          } else if (e.kind === "username") {
            const u = typeof e.username === "string" ? e.username : "";
            if (u.length < 3 || u.length > 32 || !/^[a-zA-Z0-9_]+$/.test(u)) { bad = true; break; }
            entries.push({ kind: "username", username: u.toLowerCase() });
          } else {
            bad = true; break;
          }
        }
        if (bad) {
          errors.whitelist = "whitelist contains invalid entry (kind: 'id'|'username')";
        } else {
          whitelist = entries;
        }
      }
    }
    if (gateLevel === "whitelist" && !errors.whitelist) {
      if (!whitelist || whitelist.length === 0) {
        errors.whitelist = "whitelist required (non-empty) when gateLevel=whitelist";
      }
    }

    // === escalationTimeoutMin (Req 5.6: 5..1440) ===
    let escalationTimeoutMin = 240;
    if (data.escalationTimeoutMin !== undefined) {
      const v = Number(data.escalationTimeoutMin);
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < 5 || v > 1440) {
        errors.escalationTimeoutMin = "escalationTimeoutMin must be integer 5..1440";
      } else {
        escalationTimeoutMin = v;
      }
    }

    // === digestPeriodHours (Req 9.2: 1..168) ===
    let digestPeriodHours = 24;
    if (data.digestPeriodHours !== undefined) {
      const v = Number(data.digestPeriodHours);
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1 || v > 168) {
        errors.digestPeriodHours = "digestPeriodHours must be integer 1..168";
      } else {
        digestPeriodHours = v;
      }
    }

    // === digestTime HH:MM ===
    let digestTime = "09:00";
    if (data.digestTime !== undefined) {
      if (typeof data.digestTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.digestTime)) {
        errors.digestTime = "digestTime must be HH:MM (24h)";
      } else {
        digestTime = data.digestTime;
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new HttpError(400, "validation failed", { errors });
    }

    // === Атомарное создание профиля с rollback при ошибке любого шага. ===
    const slug = rawSlug;
    const dir = profileDir(slug);
    const incomingTg = data.telegram ?? {};
    const cfg: ProfileConfig = {
      slug,
      name: data.name as string,
      age: data.age ?? 22,
      nationality: data.nationality ?? "RU",
      tz: data.tz ?? "Europe/Moscow",
      mode: data.mode ?? "bot",
      stage: data.stage ?? "manager-default",
      llm: data.llm ?? { presetId: "claudehub", proto: "anthropic", apiKey: "", model: "claude-sonnet-4.6" },
      telegram: {
        ...incomingTg,
        proxy: parseTelegramProxyInput(incomingTg.proxy as unknown as string | undefined)
      },
      privacy: data.privacy ?? "owner-only",
      ownerId: ownerId as number,
      createdAt: new Date().toISOString(),
      sleepFrom: data.sleepFrom ?? 23,
      sleepTo: data.sleepTo ?? 8,
      nightWakeChance: data.nightWakeChance ?? 0.05,
      ignoreTendency: data.ignoreTendency ?? 35,
      personaNotes: data.personaNotes,
      busySchedule: data.busySchedule ?? [],
      // manager-mode fields
      tone,
      personaStyle,
      gateLevel,
      afterHoursPolicy,
      proactiveClients: data.proactiveClients ?? false,
      proactiveBoss: data.proactiveBoss ?? false,
      whitelist,
      escalationTimeoutMin,
      digestPeriodHours,
      digestTime,
      profileType: "manager"
    };

    // Перед стартом записи зафиксируем — существовала ли директория профиля.
    // Если нет, при rollback мы её удаляем целиком; если была (что не должно
    // происходить, т.к. readConfig вернул null, но всё же страхуемся) —
    // оставляем как есть.
    const dirExistedBefore = existsSync(dir);
    try {
      // Запись config.json (создаст dir через ensureProfile).
      await writeConfig(cfg);
      // mandate.md (Req 1.7 — пишем всегда, в т.ч. пустой).
      await saveMandate(slug, mandate);
      // tickets.json — пустая коллекция.
      const emptyTickets: TicketsFile = { version: 1, nextId: 1, tickets: [] };
      await saveTickets(slug, emptyTickets);
      // contacts/ — пустая директория.
      await fs.mkdir(path.join(dir, "contacts"), { recursive: true });
    } catch (e) {
      // Rollback: удаляем частично созданные файлы и каталог data/<slug>/.
      if (!dirExistedBefore) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
      }
      const msg = (e as Error)?.message ?? String(e);
      throw new HttpError(500, `profile creation failed: ${msg}`, { slug });
    }

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
    const stage = legacyStage(rel.stage);
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
    try {
      const palaceDir = path.join(dir, "memory", "palace");
      const wings = await fs.readdir(palaceDir, { withFileTypes: true });
      for (const wing of wings) {
        if (!wing.isDirectory() || !/^[\w\-]{1,80}$/.test(wing.name)) continue;
        const halls = await fs.readdir(path.join(palaceDir, wing.name), { withFileTypes: true });
        for (const hall of halls) {
          if (!hall.isDirectory() || !/^[\w\-]{1,80}$/.test(hall.name)) continue;
          const rooms = await fs.readdir(path.join(palaceDir, wing.name, hall.name), { withFileTypes: true });
          for (const room of rooms) {
            if (!room.isDirectory() || !/^[\w\-]{1,80}$/.test(room.name)) continue;
            const drawers = await fs.readdir(path.join(palaceDir, wing.name, hall.name, room.name));
            for (const drawer of drawers) {
              if (/^[\w\-]{1,120}\.md$/.test(drawer)) entries.push({ rel: `memory/palace/${wing.name}/${hall.name}/${room.name}/${drawer}` });
            }
          }
        }
      }
    } catch { /* no palace dir */ }
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
    let generated;
    try {
      const llm = makeLLM(cfg.llm);
      generated = await generatePersonaPack(
        llm,
        cfg.slug,
        data.name ?? cfg.name,
        data.age ?? cfg.age,
        data.nationality ?? cfg.nationality,
        data.notes ?? cfg.personaNotes
      );
    } catch {
      generated = await ensurePersonaPack(cfg.slug, data.name ?? cfg.name, data.age ?? cfg.age);
    }
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
