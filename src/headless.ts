import readline from "node:readline";
import type { Runtime, RuntimeEvent } from "./engine/runtime.js";
import { findStage } from "./presets/stages.js";
import { readRelationship, readMd, readSessionLog, sessionDate } from "./storage/md.js";
import type { ProfileConfig } from "./types.js";

/**
 * Headless / JSON-events mode used by the desktop wrapper (Rust app).
 *
 * - Никакого Ink/TUI не рендерим.
 * - Каждое событие Runtime пишем в stdout как NDJSON.
 * - Каждую строку из stdin трактуем как команду (`:status`, `:pause` и т.д.)
 *   и отвечаем `{ "type": "response", "text": "..." }` на тот же stdout.
 * - На SIGINT/SIGTERM корректно гасим runtime и завершаемся.
 *
 * Этот контракт стабилен — внешние процессы (например, girl-agent-desktop.exe)
 * на него полагаются. Расширять можно, ломать — только синхронно с обвязкой.
 */
export async function runHeadlessJsonEvents(rt: Runtime): Promise<void> {
  const out = (obj: unknown) => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  };

  out({ type: "ready", profile: profileSummary(rt.cfg) });

  rt.on("event", (e: RuntimeEvent) => {
    out({ ...e, t: Date.now() });
  });

  // Push initial relationship snapshot — у CLI-дашборда такая же логика на mount.
  try {
    const r = await readRelationship(rt.cfg.slug);
    out({ type: "score", score: r.score, t: Date.now() });
  } catch {
    /* первый запуск — отношений ещё нет */
  }

  let paused = false;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) return;
    if (!line.startsWith(":")) {
      out({ type: "response", ok: false, text: "команды начинаются с :" });
      return;
    }
    const [head, ...rest] = line.slice(1).split(" ");
    try {
      let text = "";
      switch (head) {
        case "status": text = await rt.cmdStatus(); break;
        case "reset": text = await rt.cmdReset(); break;
        case "stage": text = await rt.cmdSetStage(rest.join(" ")); break;
        case "wake": text = await rt.cmdWake(rest[0]); break;
        case "debug": text = await rt.cmdDebug(rest[0]); break;
        case "why": text = await rt.cmdWhy(rest[0]); break;
        case "amnesia": text = await rt.cmdAmnesia(rest[0], rest[1]); break;
        case "block": text = await rt.cmdBlock(rest[0]); break;
        case "unblock": text = await rt.cmdUnblock(rest[0]); break;
        case "read": text = await rt.cmdRead(rest[0]); break;
        case "clear-chat": text = await rt.cmdClearChat(rest.find(x => !x.startsWith("--")), rest.includes("--revoke")); break;
        case "report-spam": text = await rt.cmdReportSpam(rest[0]); break;
        case "delete-last": text = await rt.cmdDeleteLast(rest.find(x => !x.startsWith("--")), !rest.includes("--local")); break;
        case "edit-last": text = await rt.cmdEditLast(rest.join(" ")); break;
        case "sticker": text = await rt.cmdSticker(rest[0]); break;
        case "pause": rt.pause(); paused = true; text = "⏸ pause"; break;
        case "resume": rt.resume(); paused = false; text = "▶ resume"; break;
        case "cringe": {
          const r = await readRelationship(rt.cfg.slug);
          text = `cringe=${r.score.cringe}; см. memory/long-term.md и log/`;
          break;
        }
        case "relationship": {
          const r = await readRelationship(rt.cfg.slug);
          text = `stage=${r.stage} score=${JSON.stringify(r.score)}`;
          break;
        }
        case "persona": {
          const p = await readMd(rt.cfg.slug, "persona.md");
          text = p.slice(0, 4000);
          break;
        }
        case "log": {
          const day = /^\d{4}-\d{2}-\d{2}$/.test(rest[0] ?? "") ? rest[0]! : sessionDate(rt.cfg.tz);
          const limit = Number(rest.find(x => /^\d+$/.test(x)) ?? 3000);
          const p = await readSessionLog(rt.cfg.slug, day);
          text = p.trim() ? p.slice(-Math.max(500, Math.min(limit, 20000))) : `(log/${day}.md пуст)`;
          break;
        }
        case "snapshot": {
          // Удобный для wrapper'а агрегированный snapshot — состояние, оценки, стадия.
          const r = await readRelationship(rt.cfg.slug);
          out({
            type: "snapshot",
            t: Date.now(),
            paused,
            profile: profileSummary(rt.cfg),
            stage: { id: r.stage, label: findStage(r.stage as ProfileConfig["stage"]).label },
            score: r.score
          });
          return;
        }
        case "help":
          text = ":status :why :amnesia :reset :stage :wake :debug :pause :resume :cringe :relationship :persona :log :block :unblock :read :clear-chat :report-spam :delete-last :edit-last :sticker :snapshot :quit";
          break;
        case "quit":
        case "exit":
          await rt.stop();
          out({ type: "response", ok: true, text: "bye" });
          process.exit(0);
        default:
          out({ type: "response", ok: false, text: `неизвестная команда: ${head}` });
          return;
      }
      out({ type: "response", ok: true, text });
    } catch (e) {
      out({ type: "response", ok: false, text: "err: " + (e as Error).message });
    }
  });

  const shutdown = async () => {
    try { await rt.stop(); } catch { /* ignore */ }
    out({ type: "stopped", t: Date.now() });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Hold the event loop.
  await new Promise<void>(() => { /* never resolves */ });
}

function profileSummary(cfg: ProfileConfig) {
  const stage = findStage(cfg.stage);
  return {
    slug: cfg.slug,
    name: cfg.name,
    age: cfg.age,
    mode: cfg.mode,
    nationality: cfg.nationality,
    tz: cfg.tz,
    stage: { id: cfg.stage, label: stage.label }
  };
}
