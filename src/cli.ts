import mri from "mri";
import { exec as childExec } from "node:child_process";
import os from "node:os";
import { startWebUIServer } from "./webui/server.js";
import { runHeadlessJsonEvents } from "./headless.js";
import { runServer } from "./server.js";
import { runMigrations, checkForPendingMigrations, formatUpdateWarnings } from "./migrations/index.js";
import { Runtime } from "./engine/runtime.js";
import { DATA_ROOT, readConfig, listProfiles, deleteProfile, writeConfig, normalizeOwnerId } from "./storage/md.js";
import { applyLLMUpdate, describeLLM } from "./config/llm-update.js";
import type { ProfileConfig } from "./types.js";
import { makeLLM } from "./llm/index.js";
import { generatePersonaPack } from "./engine/persona-gen.js";
import { findPreset } from "./presets/llm.js";
import { legacyStage } from "./engine/legacy-stage.js";
import { defaultTzForNationality, parseTzFlag } from "./data/timezones.js";
import { pickRandomNames } from "./data/names.js";
import { communicationProfileLabel, deriveLegacyVibe, findCommunicationPreset, normalizeCommunicationProfile } from "./presets/communication.js";

const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
if (nodeMajor < 18) {
  process.stderr.write(`[manager-agent] Node.js ${process.version} не поддерживается. Нужен Node.js 18.18+; в Termux: pkg install nodejs\n`);
  process.exit(1);
}
if (nodeMajor < 20) {
  process.stderr.write(`[manager-agent] предупреждение: Node.js ${process.version}; рекомендуется 20/22, но продолжаю запуск.\n`);
}

const HELP = `
manager-agent — AI-менеджер в Telegram (WebUI). Форк @thesashadev/girl-agent.

usage:
  npx manager-agent                       # запустить WebUI и открыть http://localhost:3100
  npx manager-agent --port=8080           # кастомный порт
  npx manager-agent --host=0.0.0.0        # слушать на всех интерфейсах
  MANAGER_AGENT_PUBLIC_URL=https://example.com npx manager-agent  # URL для reverse proxy/docker
  npx manager-agent --no-browser          # не открывать браузер автоматически
  npx manager-agent --profile=<slug>      # запустить WebUI и сразу запустить указанный профиль

server (для систем без TTY: docker / systemd / cron / CI):
  npx manager-agent server --print-config > bot.json
  npx manager-agent server --config bot.json --headless
  npx manager-agent server --print-systemd | --print-docker | --list

headless (для desktop-rs обвязки):
  npx manager-agent --profile=<slug> --json-events
  npx manager-agent --profile=<slug> --headless

установка одной командой (без node на машине):
  curl -fsSL https://raw.githubusercontent.com/shxpe0x/girl-agent-manager/master/scripts/install.sh | sh

быстрые команды:
  --list                       показать профили и data dir
  --set-model --profile=<slug> --api-preset=<id> --model=<m> [--api-key=<k>]
  --delete-profile --profile=<slug> --yes
  update [--verbose]           применить data-миграции
  addon pack <folder> [output] собрать папку аддона в .gaa файл
  addon init <folder>          создать шаблон аддона
  --help
`;

async function main(): Promise<void> {
  const argv = mri(process.argv.slice(2), {
    string: [
      "profile", "host", "port", "config", "api-preset", "model", "api-key", "base-url", "proto",
      "name", "stage", "nationality", "tz", "vibe", "persona-notes", "communication-preset",
      "notifications", "message-style", "initiative", "life-sharing", "ignore-tendency", "owner-id", "privacy",
      "mode", "token", "api-id", "api-hash", "phone", "age"
    ],
    boolean: [
      "help", "list", "reset", "new", "json-events", "headless", "server", "set-model", "delete-profile", "yes",
      "print-config", "print-systemd", "print-docker", "no-start", "verbose", "no-browser"
    ],
    alias: { h: "help" }
  });

  const positional = (argv._ as string[]) ?? [];
  const subcommand = positional[0];

  // Server subcommand: `npx manager-agent server [...]`
  const isServer = subcommand === "server" || !!argv.server || !!argv["print-config"] || !!argv["print-systemd"] || !!argv["print-docker"];
  if (isServer) {
    await runServer(argv as Record<string, unknown>);
    return;
  }

  if (subcommand === "update") {
    await runUpdate(!!argv.verbose);
    return;
  }

  if (subcommand === "addon") {
    await runAddonCommand(positional.slice(1));
    return;
  }

  if (argv.help) { process.stdout.write(HELP); return; }

  // Quick CLI utilities (без поднятия WebUI)
  if (argv.list) {
    const list = await listProfiles();
    process.stdout.write(list.length ? list.join("\n") + "\n" : "(нет профилей)\n");
    process.stdout.write(`data: ${DATA_ROOT}\n`);
    return;
  }

  if (argv["delete-profile"]) {
    const slug = typeof argv.profile === "string" ? argv.profile : undefined;
    if (!slug) { process.stderr.write("--delete-profile требует --profile=<slug>\n"); process.exit(1); }
    if (!argv.yes) {
      process.stderr.write(`профиль НЕ удалён: добавь --yes для подтверждения.\nбудет удалено: ${DATA_ROOT}/${slug}\n`);
      process.exit(1);
    }
    await deleteProfile(slug);
    process.stdout.write(`профиль удалён: ${slug}\n`);
    return;
  }

  if (argv["set-model"]) {
    const slug = typeof argv.profile === "string" ? argv.profile : undefined;
    if (!slug) { process.stderr.write("--set-model требует --profile=<slug>\n"); process.exit(1); }
    const cfg = await readConfig(slug);
    if (!cfg) { process.stderr.write(`profile not found: ${slug}\n`); process.exit(1); }
    const changed = applyLLMUpdate(cfg, {
      presetId: typeof argv["api-preset"] === "string" ? argv["api-preset"] : undefined,
      model: typeof argv.model === "string" ? argv.model : undefined,
      apiKey: typeof argv["api-key"] === "string" ? argv["api-key"] : undefined,
      baseURL: typeof argv["base-url"] === "string" ? argv["base-url"] : undefined,
      proto: argv.proto === "anthropic" ? "anthropic" : argv.proto === "openai" ? "openai" : undefined
    });
    await writeConfig(cfg);
    process.stdout.write((changed.length ? changed.map(x => `- ${x}`).join("\n") : "ничего не изменилось") + "\n\n" + describeLLM(cfg) + "\n");
    return;
  }

  // Headless / json-events: не поднимаем WebUI, запускаем runtime в pipe-режиме (для desktop-rs)
  const jsonEvents = !!(argv["json-events"] || argv.headless);
  if (jsonEvents) {
    const slug = typeof argv.profile === "string" ? argv.profile : undefined;
    if (!slug) { process.stderr.write("headless mode требует --profile=<slug>\n"); process.exit(1); }
    const cfg = await readConfig(slug);
    if (!cfg) { process.stderr.write(`profile not found: ${slug}\n`); process.exit(1); }
    if (await checkForPendingMigrations()) {
      const result = await runMigrations({
        verbose: true,
        llmFactory: (c) => { try { return makeLLM(c.llm); } catch { return undefined; } }
      });
      if (result.warnings.length) process.stderr.write(formatUpdateWarnings(result.warnings) + "\n");
    }
    const rt = new Runtime(cfg);
    await rt.start();
    await runHeadlessJsonEvents(rt);
    return;
  }

  // Headless flag-driven setup (skip wizard entirely if essentials present, then run WebUI)
  const presetForFlags = argv["api-preset"] ? findPreset(String(argv["api-preset"])) : undefined;
  const apiKeyRequiredForFlags = presetForFlags?.apiKeyRequired !== false;
  const haveEnoughForFlags = argv.mode && argv["api-preset"] && (!apiKeyRequiredForFlags || argv["api-key"]) && argv.age && argv.stage;
  if (haveEnoughForFlags) {
    const cfg = await buildConfigFromFlags(argv as Record<string, unknown>);
    await writeConfig(cfg);
    process.stdout.write(`профиль: ${cfg.name}, ${cfg.age}, ${cfg.nationality}, ${cfg.tz}\nгенерируем persona.md / speech.md / communication.md...\n`);
    const llm = makeLLM(cfg.llm);
    const generated = await generatePersonaPack(llm, cfg.slug, cfg.name, cfg.age, cfg.nationality, personaNotesForGeneration(cfg));
    cfg.busySchedule = generated.busySchedule;
    await writeConfig(cfg);
  }

  // ===== WebUI entrypoint =====
  const port = Number(argv.port ?? process.env.MANAGER_AGENT_PORT ?? 3100);
  const host = String(argv.host ?? process.env.MANAGER_AGENT_HOST ?? "127.0.0.1");

  const instance = await startWebUIServer({
    port,
    host,
    autoStart: !argv.profile,
    noBrowser: !!argv["no-browser"]
  });

  process.stdout.write(`\n  🌐 manager-agent WebUI запущен\n`);
  process.stdout.write(`     1) ${instance.urls.loopback}\n`);
  process.stdout.write(`     2) ${instance.urls.localhost}\n`);
  process.stdout.write(`     3) ${instance.urls.public}\n`);
  process.stdout.write(`\n  REST API:        ${instance.urls.loopback}/api/system/health\n`);
  process.stdout.write(`  WebSocket logs:  ws://127.0.0.1:${port}/ws/logs/<slug>\n`);
  process.stdout.write(`  Ctrl+C для остановки\n\n`);

  // Авто-старт указанного профиля
  if (typeof argv.profile === "string") {
    try {
      const cfg = await readConfig(argv.profile);
      if (cfg) {
        const { bus } = await import("./webui/runtime-bus.js");
        await bus.startWithConfig(cfg);
        process.stdout.write(`  ▶ профиль ${cfg.name} (${cfg.slug}) запущен\n`);
      }
    } catch (e) {
      process.stderr.write(`не удалось автостарт профиль: ${(e as Error)?.message}\n`);
    }
  }

  if (!argv["no-browser"]) {
    await tryOpenBrowser(instance.url);
  }

  // Hold process; stop on SIGINT/SIGTERM
  const shutdown = async () => {
    process.stdout.write("\n[manager-agent] остановка...\n");
    try { await instance.stop(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Hold the event loop indefinitely
  await new Promise<void>(() => { /* never resolves */ });
}

async function runUpdate(verbose: boolean): Promise<void> {
  const profiles = await listProfiles();
  if (!profiles.length) { process.stdout.write("нет профилей — нечего обновлять.\n"); return; }
  process.stdout.write(`найдено профилей: ${profiles.length}\nзапуск миграций...\n`);
  const result = await runMigrations({ verbose });
  if (!result.migrationsApplied.length) {
    process.stdout.write("все данные актуальны, миграции не нужны.\n");
    return;
  }
  process.stdout.write(`\nготово: миграций ${result.migrationsApplied.length}, профилей ${result.profilesUpdated}\n`);
  if (result.errors.length) {
    process.stdout.write(`ошибок: ${result.errors.length}\n`);
    for (const e of result.errors) process.stdout.write(`  ${e.profile} @ ${e.migration}: ${e.error}\n`);
  }
}

async function buildConfigFromFlags(argv: Record<string, unknown>): Promise<ProfileConfig> {
  const presetId = String(argv["api-preset"]);
  const preset = findPreset(presetId);
  const proto = preset?.proto ?? (argv.proto === "anthropic" ? "anthropic" : "openai");
  const baseURL = preset?.baseURL ?? (typeof argv["base-url"] === "string" ? (argv["base-url"] as string) : undefined);
  const model = (typeof argv.model === "string" ? (argv.model as string) : undefined) ?? preset?.defaultModel ?? "";
  const nationality = (String(argv.nationality ?? "RU").toUpperCase() === "UA") ? "UA" : "RU";
  const name = argv.name ? String(argv.name) : pickRandomNames(nationality, 1)[0]!;
  const slug = String(argv.profile ?? slugifyLocal(name));
  const mode = (argv.mode === "userbot" ? "userbot" : "bot");
  const tz = (argv.tz ? parseTzFlag(String(argv.tz)) : undefined) ?? defaultTzForNationality(nationality);
  const communication = (() => {
    const preset = findCommunicationPreset(typeof argv["communication-preset"] === "string" ? argv["communication-preset"] as string : undefined);
    return preset?.profile ?? normalizeCommunicationProfile({});
  })();
  const privacy = argv.privacy === "allow-strangers" ? "allow-strangers" : "owner-only";
  return {
    slug,
    name,
    age: Number(argv.age),
    nationality: nationality as "RU" | "UA",
    tz,
    mode,
    stage: legacyStage(argv.stage as string).id,
    llm: { presetId, proto, baseURL, apiKey: String(argv["api-key"] ?? preset?.defaultApiKey ?? ""), model },
    telegram: mode === "bot"
      ? { botToken: String(argv.token ?? "") }
      : {
          apiId: Number(argv["api-id"] ?? 0),
          apiHash: String(argv["api-hash"] ?? ""),
          phone: String(argv.phone ?? "")
        },
    privacy,
    ownerId: normalizeOwnerId(argv["owner-id"] ?? process.env.MANAGER_AGENT_OWNER_ID),
    createdAt: new Date().toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0.05,
    ignoreTendency: Number(argv["ignore-tendency"] ?? 35),
    vibe: deriveLegacyVibe(communication),
    communication,
    personaNotes: argv["persona-notes"] ? String(argv["persona-notes"]) : undefined,
    busySchedule: []
  };
}

function slugifyLocal(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `profile-${Date.now().toString(36)}`;
}

async function runAddonCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "pack") {
    const folder = args[1];
    if (!folder) {
      process.stderr.write("Использование: npx manager-agent addon pack <folder> [output.gaa]\n");
      process.exit(1);
    }
    const { packGaa } = await import("./webui/addons.js");
    const output = args[2] ?? undefined;
    const result = await packGaa(folder, output);
    process.stdout.write(`Создан: ${result}\n`);
    return;
  }

  if (sub === "init") {
    const folder = args[1];
    if (!folder) {
      process.stderr.write("Использование: npx manager-agent addon init <folder>\n");
      process.exit(1);
    }
    const { promises: initFs } = await import("node:fs");
    const initPath = await import("node:path");
    const dir = initPath.default.resolve(folder);
    await initFs.mkdir(initPath.default.join(dir, "files"), { recursive: true });
    const name = initPath.default.basename(dir);
    const manifest = {
      id: name,
      name,
      description: "Описание аддона",
      version: "1.0.0",
      author: "",
      tags: [],
      settings: []
    };
    await initFs.writeFile(initPath.default.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await initFs.writeFile(initPath.default.join(dir, "README.md"), `# ${name}\n\nОписание аддона.\n`, "utf8");
    await initFs.writeFile(
      initPath.default.join(dir, "config.patch.json"),
      JSON.stringify({ "_comment": "Поля для мёрджа в config.json профиля" }, null, 2),
      "utf8"
    );
    process.stdout.write(`Шаблон аддона создан: ${dir}\n`);
    process.stdout.write(`  manifest.json  — метаданные\n`);
    process.stdout.write(`  files/         — файлы для копирования в профиль\n`);
    process.stdout.write(`  config.patch.json — config overrides\n`);
    process.stdout.write(`  README.md      — документация\n\n`);
    process.stdout.write(`Упаковать: npx manager-agent addon pack ${folder}\n`);
    return;
  }

  process.stderr.write("Команды:\n  addon pack <folder> [output.gaa]  — собрать .gaa\n  addon init <folder>              — создать шаблон\n");
  process.exit(1);
}

function personaNotesForGeneration(cfg: ProfileConfig): string {
  const parts = [
    cfg.personaNotes?.trim(),
    `Тон общения: ${communicationProfileLabel(normalizeCommunicationProfile(cfg))}. Учти это при speech.md и communication.md.`
  ].filter(Boolean);
  return parts.join("\n\n");
}

async function tryOpenBrowser(url: string): Promise<void> {
  if (process.env.MANAGER_AGENT_NO_BROWSER || process.env.NO_BROWSER) return;
  const platform = os.platform();
  let cmd = "";
  if (platform === "darwin") cmd = `open "${url}"`;
  else if (platform === "win32") cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}" >/dev/null 2>&1 || true`;
  childExec(cmd, () => { /* ignore — браузер опционален */ });
}

process.on("unhandledRejection", (reason) => {
  const r = reason as { stack?: string } | string | undefined;
  const text = (typeof r === "object" && r && r.stack) ? r.stack : String(reason);
  process.stderr.write("[manager-agent] unhandled rejection: " + text + "\n");
});

process.on("uncaughtException", (err) => {
  process.stderr.write("[manager-agent] uncaught: " + (err?.stack ?? err) + "\n");
});

main().catch((e) => {
  process.stderr.write("[manager-agent] fatal: " + (e?.stack ?? e) + "\n");
  process.exit(1);
});
