import { Router, HttpError } from "../http.js";
import {
  readConfig,
  writeConfig,
  readMd,
  writeMd,
  readRelationship,
  writeRelationship,
  listProfiles,
  appendMd
} from "../../storage/md.js";
import { makeLLM } from "../../llm/index.js";
import { findStage, STAGE_PRESETS } from "../../engine/legacy-stage.js";
import { findCommunicationPreset, COMMUNICATION_PRESETS } from "../../presets/communication.js";
import { LLM_PRESETS } from "../../presets/llm.js";
import { generatePersonaPack } from "../../engine/persona-gen.js";
import { maybeAdvanceRelationshipTimeline } from "../../engine/realism.js";
import type { ProfileConfig } from "../../types.js";
import type { LegacyStageId as StageId } from "../../engine/legacy-stage.js";
import { bus } from "../runtime-bus.js";
import { renderRelevantKnowledge } from "../assistant-knowledge.js";

interface AssistantTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AssistantToolCall {
  tool: string;
  args: Record<string, unknown>;
}


const ASSISTANT_SYSTEM = `Ты — встроенный ИИ-помощник по настройке girl-agent (рантайм для Telegram-девушки с человечным поведением). Тебя зовут "помощник", не "ассистент".

Твоя задача:
- Объяснять настройки на простом русском, без жаргона.
- Менять конфиг профиля и файлы памяти через инструменты (см. ниже).
- Помогать с первичной настройкой и диагностикой подключения.
- Объяснять ошибки из логов и предлагать починку.
- Давать ответы, опираясь на выбранные статьи из базы знаний проекта, а не на догадки.

Правила ответа:
- Отвечай коротко (2-5 предложений), на русском.
- Если хочешь применить изменение — добавь в КОНЕЦ ответа JSON-блок строго формата:
  <tool>{"tool": "set_field", "args": {"field": "ignoreTendency", "value": 30}}</tool>
- Можно несколько <tool>-блоков в одном ответе. НЕ применяй сразу — пользователь подтверждает.
- Не выдумывай поля. Используй только перечисленные ниже.

Доступные инструменты:
- set_field { field: string, value: any } — изменить простое поле в config.
  Допустимые поля: name, age, nationality, tz, mode ("bot"|"userbot"), ignoreTendency (0-100),
  sleepFrom (0-23), sleepTo (0-23), nightWakeChance (0-1), privacy ("owner-only"|"allow-strangers"),
  ownerId (число), vibe ("short"|"warm"), personaNotes,
  llm.presetId, llm.model, llm.apiKey, llm.baseURL,
  telegram.botToken, telegram.apiId, telegram.apiHash, telegram.phone, telegram.useWSS,
  communication.notifications ("muted"|"normal"|"priority"),
  communication.messageStyle ("one-liners"|"balanced"|"bursty"|"longform"),
  communication.initiative ("low"|"medium"|"high"),
  communication.lifeSharing ("low"|"medium"|"high").
- set_stage { stage: string } — установить стадию отношений (id из списка).
- set_communication_preset { id: string } — применить пресет общения и записать communication.md.
- write_memory { file: string, content: string } — переписать файл памяти.
  Допустимые файлы: persona.md, speech.md, boundaries.md, communication.md, long-term.md, memory/long-term.md, memory/facts.md, memory/uncertain.md, time/promises.md, time/open-loops.md.
- append_memory { file: string, content: string } — добавить строку в файл памяти.
- generate_persona { name?: string, age?: number, nationality?: string, notes?: string } — LLM-генерация persona.md/speech.md/communication.md (это занимает ~30s).
- runtime_action { action: "start"|"stop"|"pause"|"resume"|"restart" } — управление рантаймом.
- send_command { command: string, args?: string[] } — отправить runtime-команду (status, why, wake, debug, reset).
- list_presets { kind: "llm"|"stage"|"communication" } — показать список пресетов (только для тебя, не показывает в UI).
- read_logs { limit?: number, type?: "in"|"out"|"info"|"warn"|"error" } — прочесть последние строки runtime-лога.
- read_memory { file: string } — прочесть файл памяти.

Вопросы к пользователю:
Ты можешь задать пользователю вопрос с вариантами ответа (кнопками). Добавь в ответ блок:
<question text="Текст вопроса?">
  <option label="Вариант 1">Описание варианта</option>
  <option label="Вариант 2">Описание варианта</option>
</question>
- Кнопок от 1 до 10.
- Можно до 25 последовательных вопросов (диалог).
- label — текст на кнопке (короткий), описание — пояснение (1 строка, опционально).
- Пользователь может нажать кнопку или написать свой вариант в текстовом поле.
- Используй вопросы когда нужен выбор: стиль общения, стадия, конкретный пресет и т.д.

Важные подсказки:
- ignoreTendency: 0 — всегда отвечает; 100 — почти всегда игнорит. По умолчанию 35.
- Если пользователь жалуется что "не отвечает" → проверь runtime state и read_logs.
- Если LLM ошибки → проверь llm.apiKey, llm.baseURL, llm.model.
- Если сменили telegram.mode — обязательно нужен restart.`;

export function registerAssistantRoutes(r: Router): void {
  r.post("/api/assistant/chat", async (ctx) => {
    const body = ctx.body as { profileSlug?: string; messages?: AssistantTurn[] } | undefined;
    if (!body || !Array.isArray(body.messages)) throw new HttpError(400, "messages required");

    let cfg: ProfileConfig | null = null;
    if (body.profileSlug) {
      cfg = await readConfig(body.profileSlug);
    }
    if (!cfg) {
      const slugs = await listProfiles();
      if (slugs.length) cfg = await readConfig(slugs[0]);
    }

    if (!cfg) {
      const last = body.messages[body.messages.length - 1];
      const reply = `Привет! У вас ещё нет ни одного профиля. Откройте Setup Flow или вкладку Конфигурация → Новый профиль. Я подключусь, когда появится первый профиль.\n\nВаш вопрос: ${typeof last?.content === "string" ? last.content : ""}`;
      return { reply, toolCalls: [] };
    }

    const stage = findStage(cfg.stage);
    const status = bus.status(cfg.slug);
    const userQuestion = body.messages.slice().reverse().find(m => m.role === "user")?.content ?? "";
    const relevantKnowledge = renderRelevantKnowledge(userQuestion);
    let scoreLine = "";
    let memoryContext = "";
    let recentLogs = "";
    try {
      const rel = await readRelationship(cfg.slug);
      scoreLine = ` score=${JSON.stringify(rel.score)}`;
    } catch { /* ignore */ }
    try {
      const [persona, speech, communication, boundaries, longTerm, facts, uncertain, timeline, openLoops, promises] = await Promise.all([
        readMd(cfg.slug, "persona.md"),
        readMd(cfg.slug, "speech.md"),
        readMd(cfg.slug, "communication.md"),
        readMd(cfg.slug, "boundaries.md"),
        readMd(cfg.slug, "memory/long-term.md"),
        readMd(cfg.slug, "memory/facts.md"),
        readMd(cfg.slug, "memory/uncertain.md"),
        readMd(cfg.slug, "relationship/timeline.md"),
        readMd(cfg.slug, "time/open-loops.md"),
        readMd(cfg.slug, "time/promises.md")
      ]);
      memoryContext = renderAssistantMemoryContext({
        persona,
        speech,
        communication,
        boundaries,
        longTerm,
        facts,
        uncertain,
        timeline,
        openLoops,
        promises
      });
    } catch { /* ignore */ }
    try {
      const buf = bus.recentLogs(cfg.slug, 25);
      recentLogs = buf.map(e => `[${e.type}] ${e.text ?? ""}`).join("\n");
    } catch { /* ignore */ }

    const runtimeContext = [
      `Текущий профиль: ${cfg.name}, ${cfg.age}, ${cfg.nationality}, tz=${cfg.tz}`,
      `slug=${cfg.slug}, runtime=${status.state}${status.lastError ? `, lastError=${status.lastError}` : ""}`,
      `стадия "${stage.label}" (${cfg.stage}), ${stage.description}`,
      `stage defaults: ignoreChance=${stage.defaults.ignoreChance}, replyDelaySec=${stage.defaults.replyDelaySec[0]}-${stage.defaults.replyDelaySec[1]}`,
      `privacy=${cfg.privacy ?? "owner-only"}, ownerId=${cfg.ownerId ?? "—"}, ignoreTendency=${cfg.ignoreTendency ?? 35}`,
      `sleep=${cfg.sleepFrom}:00-${cfg.sleepTo}:00, nightWakeChance=${cfg.nightWakeChance}`,
      `communication=${cfg.communication ? JSON.stringify(cfg.communication) : "default"}, vibe=${cfg.vibe ?? "—"}`,
      `llm=${cfg.llm.presetId}/${cfg.llm.model} (${cfg.llm.proto}), telegram=${cfg.mode ?? "bot"}, useWSS=${cfg.telegram.useWSS ?? true}`,
      `busySchedule=${cfg.busySchedule?.length ? JSON.stringify(cfg.busySchedule).slice(0, 1000) : "[]"}`,
      scoreLine.trim()
    ].filter(Boolean).join("\n");

    const ctxPrompt = [
      relevantKnowledge,
      `Контекст активного профиля:\n${runtimeContext}`,
      memoryContext,
      recentLogs ? `Последние события runtime'а:\n${recentLogs.slice(-2500)}` : ""
    ].filter(Boolean).join("\n\n");

    const llm = makeLLM(cfg.llm);
    const messages = [
      { role: "system" as const, content: ASSISTANT_SYSTEM },
      { role: "system" as const, content: ctxPrompt },
      ...body.messages.map(m => ({ role: m.role, content: m.content }))
    ];

    let reply = "";
    try {
      reply = await llm.chat(messages, { temperature: 0.4, maxTokens: 1000 });
    } catch (e) {
      throw new HttpError(502, `LLM error: ${(e as Error)?.message ?? String(e)}`);
    }

    const toolCalls = parseToolCalls(reply);
    const cleanReply = reply.replace(/<tool>[\s\S]*?<\/tool>/g, "").trim();
    // <question> блоки оставляем — фронт сам парсит для кнопок
    return { reply: cleanReply, toolCalls };
  });

  r.post("/api/assistant/apply-tool", async ({ body }) => {
    const data = body as { profileSlug?: string; tool?: AssistantToolCall } | undefined;
    if (!data?.tool || !data.profileSlug) throw new HttpError(400, "profileSlug+tool required");
    const cfg = await readConfig(data.profileSlug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const result = await applyTool(cfg, data.tool);
    if (result.changed) await writeConfig(cfg);
    return { ok: true, message: result.message };
  });
}

function parseToolCalls(text: string): AssistantToolCall[] {
  const matches = [...text.matchAll(/<tool>([\s\S]*?)<\/tool>/g)];
  const calls: AssistantToolCall[] = [];
  for (const m of matches) {
    const raw = m[1]?.trim() ?? "";
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as AssistantToolCall;
      if (parsed && typeof parsed.tool === "string") calls.push(parsed);
    } catch { /* ignore malformed */ }
  }
  return calls;
}

const ALLOWED_FIELDS = new Set([
  "name", "age", "nationality", "tz", "mode", "ignoreTendency",
  "sleepFrom", "sleepTo", "privacy", "ownerId", "vibe", "personaNotes", "nightWakeChance",
  "llm.presetId", "llm.model", "llm.apiKey", "llm.baseURL",
  "telegram.botToken", "telegram.apiId", "telegram.apiHash", "telegram.phone", "telegram.useWSS",
  "communication.notifications", "communication.messageStyle",
  "communication.initiative", "communication.lifeSharing"
]);

const ALLOWED_MEMORY = new Set([
  "persona.md",
  "speech.md",
  "boundaries.md",
  "communication.md",
  "long-term.md",
  "memory/long-term.md",
  "memory/facts.md",
  "memory/uncertain.md",
  "time/promises.md",
  "time/open-loops.md",
  "relationship/timeline.md"
]);

async function applyTool(cfg: ProfileConfig, call: AssistantToolCall): Promise<{ changed: boolean; message: string }> {
  switch (call.tool) {
    case "set_field": {
      const field = String(call.args?.field ?? "");
      if (!field) return { changed: false, message: "field required" };
      if (!ALLOWED_FIELDS.has(field)) return { changed: false, message: `field not allowed: ${field}` };
      const value = call.args?.value;
      setNested(cfg as unknown as Record<string, unknown>, field, value);
      return { changed: true, message: `${field} = ${JSON.stringify(value)}` };
    }

    case "set_stage": {
      const stage = String(call.args?.stage ?? "") as StageId;
      const found = STAGE_PRESETS.find(s => s.id === stage);
      if (!found) return { changed: false, message: `unknown stage: ${stage}. Доступные: ${STAGE_PRESETS.map(s => s.id).join(", ")}` };
      const prevStage = cfg.stage;
      cfg.stage = stage;
      try {
        const rel = await readRelationship(cfg.slug);
        await writeRelationship(cfg.slug, { ...rel, stage });
      } catch { /* ignore */ }
      await maybeAdvanceRelationshipTimeline(cfg, prevStage, stage);
      return { changed: true, message: `stage = ${stage} (${found.label})` };
    }

    case "set_communication_preset": {
      const id = String(call.args?.id ?? "");
      const preset = findCommunicationPreset(id);
      if (!preset) return { changed: false, message: `unknown communication preset: ${id}` };
      cfg.communication = { ...preset.profile };
      const md = `# Стиль общения
Пресет: ${preset.label} (${preset.id})
${preset.description}

- notifications: ${preset.profile.notifications}
- messageStyle: ${preset.profile.messageStyle}
- initiative: ${preset.profile.initiative}
- lifeSharing: ${preset.profile.lifeSharing}
`;
      try { await writeMd(cfg.slug, "communication.md", md); } catch { /* ignore */ }
      return { changed: true, message: `communication = ${preset.id} (${preset.label})` };
    }

    case "write_memory": {
      const file = String(call.args?.file ?? "");
      const content = String(call.args?.content ?? "");
      if (!ALLOWED_MEMORY.has(file)) return { changed: false, message: `file not allowed: ${file}` };
      await writeMd(cfg.slug, file, content);
      return { changed: false, message: `wrote ${file} (${content.length}b)` };
    }

    case "append_memory": {
      const file = String(call.args?.file ?? "");
      const content = String(call.args?.content ?? "");
      if (!ALLOWED_MEMORY.has(file)) return { changed: false, message: `file not allowed: ${file}` };
      await appendMd(cfg.slug, file, "\n" + content);
      return { changed: false, message: `appended to ${file}` };
    }

    case "generate_persona": {
      try {
        const llm = makeLLM(cfg.llm);
        const out = await generatePersonaPack(
          llm,
          cfg.slug,
          typeof call.args?.name === "string" ? call.args.name as string : cfg.name,
          typeof call.args?.age === "number" ? call.args.age as number : cfg.age,
          (cfg.nationality ?? "RU") as "RU" | "UA",
          typeof call.args?.notes === "string" ? call.args.notes as string : (cfg.personaNotes ?? "")
        );
        return { changed: false, message: `сгенерировано: ${Object.keys(out).join(", ")}` };
      } catch (e) {
        return { changed: false, message: `persona-gen error: ${(e as Error).message}` };
      }
    }

    case "runtime_action": {
      const action = String(call.args?.action ?? "");
      switch (action) {
        case "start": await bus.start(cfg.slug); return { changed: false, message: "runtime started" };
        case "stop": await bus.stop(cfg.slug); return { changed: false, message: "runtime stopped" };
        case "pause": bus.pause(cfg.slug); return { changed: false, message: "runtime paused" };
        case "resume": bus.resume(cfg.slug); return { changed: false, message: "runtime resumed" };
        case "restart": await bus.restart(cfg.slug); return { changed: false, message: "runtime restarted" };
        default: return { changed: false, message: `unknown action: ${action}` };
      }
    }

    case "send_command": {
      const cmd = String(call.args?.command ?? "");
      const args = Array.isArray(call.args?.args) ? (call.args.args as string[]) : [];
      if (!cmd) return { changed: false, message: "command required" };
      const rt = bus.get(cfg.slug);
      if (!rt) return { changed: false, message: "runtime не запущен" };
      try {
        let text = "";
        switch (cmd) {
          case "status": text = await rt.cmdStatus(); break;
          case "why": text = await rt.cmdWhy(args[0]); break;
          case "wake": text = await rt.cmdWake(args[0]); break;
          case "debug": text = await rt.cmdDebug(args[0]); break;
          case "reset": text = await rt.cmdReset(); break;
          case "stage": text = await rt.cmdSetStage(args.join(" ")); break;
          case "sticker": text = await rt.cmdSticker(args[0]); break;
          default: return { changed: false, message: `unknown command: ${cmd}` };
        }
        return { changed: false, message: text || `:${cmd} ok` };
      } catch (e) {
        return { changed: false, message: `:${cmd} error: ${(e as Error).message}` };
      }
    }

    case "read_logs": {
      const limit = typeof call.args?.limit === "number" ? Math.max(1, Math.min(200, call.args.limit as number)) : 50;
      const type = call.args?.type ? String(call.args.type) : null;
      const buf = bus.recentLogs(cfg.slug, 200);
      const filtered = type ? buf.filter(e => e.type === type) : buf;
      const text = filtered.slice(-limit).map(e => `[${e.type}] ${e.text ?? ""}`).join("\n");
      return { changed: false, message: text || "(нет событий)" };
    }

    case "read_memory": {
      const file = String(call.args?.file ?? "");
      if (!ALLOWED_MEMORY.has(file)) return { changed: false, message: `file not allowed: ${file}` };
      try {
        const content = await readMd(cfg.slug, file);
        return { changed: false, message: content || "(пусто)" };
      } catch {
        return { changed: false, message: "(файл не существует)" };
      }
    }

    case "list_presets": {
      const kind = String(call.args?.kind ?? "");
      if (kind === "llm") return { changed: false, message: LLM_PRESETS.map(p => `${p.id} (${p.name}) — ${p.proto}`).join("\n") };
      if (kind === "communication") return { changed: false, message: COMMUNICATION_PRESETS.map(p => `${p.id} — ${p.label}`).join("\n") };
      if (kind === "stage") return { changed: false, message: STAGE_PRESETS.map(s => `${s.id} (${s.num}. ${s.label})`).join("\n") };
      return { changed: false, message: "unknown preset kind. use: llm | stage | communication" };
    }

    default:
      return { changed: false, message: `unknown tool: ${call.tool}` };
  }
}

function renderAssistantMemoryContext(parts: Record<string, string>): string {
  const sections = [
    ["persona.md", parts.persona],
    ["speech.md", parts.speech],
    ["communication.md", parts.communication],
    ["boundaries.md", parts.boundaries],
    ["memory/facts.md", parts.facts],
    ["memory/uncertain.md", parts.uncertain],
    ["memory/long-term.md", parts.longTerm],
    ["relationship/timeline.md", parts.timeline],
    ["time/open-loops.md", parts.openLoops],
    ["time/promises.md", parts.promises]
  ]
    .map(([name, text]) => renderContextSection(name, text))
    .filter(Boolean);
  return sections.length ? `Память и файлы профиля:\n${sections.join("\n\n")}` : "";
}

function renderContextSection(name: string, text: string): string {
  const clean = text.trim();
  if (!clean) return "";
  return `## ${name}\n${tail(clean, 1400)}`;
}

function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(-limit);
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
