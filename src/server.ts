import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { findPreset } from "./presets/llm.js";
import { legacyStage } from "./engine/legacy-stage.js";
import { COMMUNICATION_PRESETS } from "./presets/communication.js";
import { defaultTzForNationality, parseTzFlag } from "./data/timezones.js";
import { pickRandomNames } from "./data/names.js";
import { DATA_ROOT, slugify, writeConfig, readConfig, listProfiles, normalizeOwnerId, deleteProfile } from "./storage/md.js";
import { Runtime } from "./engine/runtime.js";
import { makeLLM } from "./llm/index.js";
import { generatePersonaPack } from "./engine/persona-gen.js";
import { runHeadlessJsonEvents } from "./headless.js";
import { checkForPendingMigrations, runMigrations, formatUpdateWarnings } from "./migrations/index.js";
import type { ProfileConfig, ClientMode, Nationality, LLMProto, PrivacyMode } from "./types.js";
import type { LegacyStageId as StageId } from "./engine/legacy-stage.js";
import { applyLLMUpdate, describeLLM } from "./config/llm-update.js";
import { parseTelegramProxyInput } from "./telegram/proxy-parse.js";
import { describeMissingProfile } from "./cli-args.js";

/**
 * Server / automation entrypoint.
 *
 * The interactive setup happens in the WebUI (default `npx manager-agent`).
 * This module is for non-TTY automation only:
 *   --config <file>        load profile from json, run/save it
 *   --print-config         print json template
 *   --print-systemd        print systemd unit
 *   --print-docker         print Dockerfile / compose / docker run
 *   --list                 list existing profiles
 *   --profile=<slug>       run a specific profile
 *   --headless             NDJSON events to stdout (12-factor logs)
 *
 * Plus env-vars for fully automated provisioning (CI, k8s secrets, docker -e):
 *   MANAGER_AGENT_MODE / _TOKEN / _API_PRESET / _API_KEY / ...
 */

interface ServerArgs {
  config?: string;
  printConfig?: boolean;
  printSystemd?: boolean;
  printDocker?: boolean;
  headless?: boolean;
  jsonEvents?: boolean;
  noStart?: boolean;
  profile?: string;
  setModel?: boolean;
  deleteProfile?: boolean;
  yes?: boolean;
  list?: boolean;
  help?: boolean;
}

const SERVER_HELP = `
manager-agent server — automation / ops mode (no TTY required)

usage:
  manager-agent server --print-config > bot.json
  # отредактируй bot.json
  manager-agent server --config bot.json --headless

  manager-agent server --list
  manager-agent server --profile=<slug> --headless
  manager-agent server --profile=<slug> --set-model --api-preset=<id> --model=<model> [--api-key=<key>]
  manager-agent server --profile=<slug> --delete-profile --yes

  manager-agent server --print-systemd > /etc/systemd/system/manager-agent.service
  manager-agent server --print-docker

env-vars (для CI / docker secrets / k8s):
  MANAGER_AGENT_DATA           путь к профилям (default: ./data)
  MANAGER_AGENT_MODE           bot|userbot
  MANAGER_AGENT_TOKEN          telegram bot token
  MANAGER_AGENT_API_PRESET     openai|anthropic|claudehub|...
  MANAGER_AGENT_API_KEY        ключ от провайдера
  MANAGER_AGENT_MODEL, _NAME, _AGE, _NATIONALITY, _TZ, _STAGE (id или номер 1-8), _COMM_PRESET, _IGNORE_TENDENCY, _OWNER_ID

для интерактивной первичной настройки запускай без флагов —
откроется WebUI на http://localhost:3100 (в docker используй -p 3100:3100).
`;

function parseServerArgs(argv: Record<string, unknown>): ServerArgs {
  return {
    config: typeof argv.config === "string" ? argv.config : undefined,
    printConfig: !!argv["print-config"],
    printSystemd: !!argv["print-systemd"],
    printDocker: !!argv["print-docker"],
    headless: !!argv.headless,
    jsonEvents: !!argv["json-events"],
    noStart: !!argv["no-start"] || argv.start === false,
    profile: typeof argv.profile === "string" ? argv.profile : undefined,
    setModel: !!argv["set-model"],
    deleteProfile: !!argv["delete-profile"],
    yes: !!argv.yes,
    list: !!argv.list,
    help: !!argv.help
  };
}

export async function runServer(rawArgv: Record<string, unknown>): Promise<void> {
  const args = parseServerArgs(rawArgv);

  if (args.help) {
    process.stdout.write(SERVER_HELP);
    return;
  }

  if (args.printConfig) { process.stdout.write(buildConfigTemplate()); return; }
  if (args.printSystemd) { process.stdout.write(buildSystemdUnit()); return; }
  if (args.printDocker) { process.stdout.write(buildDockerArtifacts()); return; }

  if (args.list) {
    const list = await listProfiles();
    process.stdout.write(list.length ? list.join("\n") + "\n" : "(нет профилей)\n");
    process.stdout.write(`data: ${DATA_ROOT}\n`);
    return;
  }

  if (args.deleteProfile) {
    if (!args.profile) {
      process.stderr.write("--delete-profile требует --profile=<slug>\n");
      process.exit(1);
    }
    if (!args.yes) {
      process.stderr.write(`профиль НЕ удалён: добавь --yes для подтверждения.\nбудет удалено: ${path.join(DATA_ROOT, args.profile)}\n`);
      process.exit(1);
    }
    await deleteProfile(args.profile);
    process.stdout.write(`профиль удалён: ${args.profile}\ndata: ${DATA_ROOT}\n`);
    return;
  }

  if (args.setModel) {
    if (!args.profile) {
      process.stderr.write("--set-model требует --profile=<slug>\n");
      process.exit(1);
    }
    const cfg = await readConfig(args.profile);
    if (!cfg) {
      process.stderr.write(`profile not found: ${args.profile}\ndata dir: ${DATA_ROOT}\n`);
      process.exit(1);
    }
    const changed = applyLLMUpdate(cfg, {
      presetId: typeof rawArgv["api-preset"] === "string" ? rawArgv["api-preset"] : undefined,
      model: typeof rawArgv.model === "string" ? rawArgv.model : undefined,
      apiKey: typeof rawArgv["api-key"] === "string" ? rawArgv["api-key"] : undefined,
      baseURL: typeof rawArgv["base-url"] === "string" ? rawArgv["base-url"] : undefined,
      proto: rawArgv.proto === "anthropic" ? "anthropic" : rawArgv.proto === "openai" ? "openai" : undefined
    });
    await writeConfig(cfg);
    process.stdout.write((changed.length ? changed.map(x => `- ${x}`).join("\n") : "ничего не изменилось") + "\n\n" + describeLLM(cfg) + "\n");
    return;
  }

  if (args.profile) {
    const cfg = await readConfig(args.profile);
    if (!cfg) {
      const existing = await listProfiles();
      process.stderr.write(describeMissingProfile(args.profile, existing) + "\n");
      process.stderr.write(`data dir: ${DATA_ROOT}\n`);
      process.exit(1);
    }
    await startRuntime(cfg, args);
    return;
  }

  if (args.config) {
    const cfg = await loadConfigFile(args.config);
    await persistAndMaybeStart(cfg, args);
    return;
  }

  const cfgFromEnv = configFromEnv();
  if (cfgFromEnv) {
    process.stderr.write("[server] провижу профиль из env vars\n");
    await persistAndMaybeStart(cfgFromEnv, args);
    return;
  }

  process.stderr.write(SERVER_HELP);
  process.stderr.write("\n[server] для интерактивной настройки запусти без флагов в TTY-терминале.\n");
  process.exit(1);
}

async function persistAndMaybeStart(cfg: ProfileConfig, args: ServerArgs): Promise<void> {
  await writeConfig(cfg);
  process.stderr.write(`[server] профиль сохранён: ${path.join(DATA_ROOT, cfg.slug)}\n`);

  if (cfg.llm.apiKey || findPreset(cfg.llm.presetId)?.apiKeyRequired === false) {
    try {
      process.stderr.write("[server] генерируем persona/speech/communication...\n");
      const llm = makeLLM(cfg.llm);
      const generated = await generatePersonaPack(llm, cfg.slug, cfg.name, cfg.age, cfg.nationality, cfg.personaNotes ?? "");
      cfg.busySchedule = generated.busySchedule;
      await writeConfig(cfg);
      process.stderr.write("[server] персона готова.\n");
    } catch (e) {
      process.stderr.write(`[server] ошибка генерации персоны: ${(e as Error)?.message ?? e}\n`);
      process.stderr.write("[server] профиль сохранён, но без persona.md. Можно перегенерировать позже.\n");
    }
  } else {
    process.stderr.write("[server] api-ключ не задан — пропускаем генерацию персоны.\n");
  }

  if (args.noStart) {
    process.stderr.write(`[server] --no-start: запуск пропущен.\n`);
    return;
  }

  await startRuntime(cfg, args);
}

async function startRuntime(cfg: ProfileConfig, args: ServerArgs): Promise<void> {
  if (await checkForPendingMigrations()) {
    process.stderr.write("[updater] обнаружены pending-миграции, запуск...\n");
    const result = await runMigrations({
      verbose: true,
      llmFactory: (c) => { try { return makeLLM(c.llm); } catch { return undefined; } }
    });
    if (result.warnings.length) {
      process.stderr.write(formatUpdateWarnings(result.warnings) + "\n");
    }
  }

  const rt = new Runtime(cfg);
  await rt.start();

  const wantsHeadless = !!(args.headless || args.jsonEvents);
  if (wantsHeadless) {
    await runHeadlessJsonEvents(rt);
    return;
  }

  // Plain text-log mode for non-NDJSON server runs.
  process.stderr.write(`[server] бот запущен: ${cfg.name} (${cfg.slug})\n`);
  rt.on("event", (e) => {
    const ts = new Date().toISOString();
    const t = (e as { type?: string }).type ?? "event";
    process.stdout.write(`${ts} ${t} ${JSON.stringify(e)}\n`);
  });

  const stop = async () => {
    process.stderr.write("[server] остановка...\n");
    await rt.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// ---------------- env / file config ----------------

function configFromEnv(): ProfileConfig | null {
  const e = process.env;
  if (!e.MANAGER_AGENT_MODE && !e.MANAGER_AGENT_TOKEN && !e.MANAGER_AGENT_API_KEY) return null;
  const mode = (e.MANAGER_AGENT_MODE === "userbot" ? "userbot" : "bot") as ClientMode;
  const presetId = e.MANAGER_AGENT_API_PRESET ?? "claudehub";
  const preset = findPreset(presetId);
  if (!preset) {
    process.stderr.write(`[server] unknown api preset in env: ${presetId}\n`);
    process.exit(1);
  }
  const nationality = (e.MANAGER_AGENT_NATIONALITY === "UA" ? "UA" : "RU") as Nationality;
  const name = e.MANAGER_AGENT_NAME || pickRandomNames(nationality, 1)[0]!;
  const age = Number(e.MANAGER_AGENT_AGE ?? 18);
  const tz = e.MANAGER_AGENT_TZ ? (parseTzFlag(e.MANAGER_AGENT_TZ) ?? defaultTzForNationality(nationality)) : defaultTzForNationality(nationality);
  const stage = e.MANAGER_AGENT_STAGE ? legacyStage(e.MANAGER_AGENT_STAGE).id : "tg-given-cold";
  const commPreset = COMMUNICATION_PRESETS.find((c) => c.id === (e.MANAGER_AGENT_COMM_PRESET ?? "normal")) ?? COMMUNICATION_PRESETS[0]!;

  return {
    slug: slugify(name),
    name, age, nationality, tz, mode, stage,
    llm: {
      presetId,
      proto: preset.proto as LLMProto,
      baseURL: preset.baseURL,
      apiKey: e.MANAGER_AGENT_API_KEY ?? preset.defaultApiKey ?? "",
      model: e.MANAGER_AGENT_MODEL ?? preset.defaultModel
    },
    telegram: mode === "bot"
      ? { botToken: e.MANAGER_AGENT_TOKEN ?? "" }
      : {
          apiId: Number(e.MANAGER_AGENT_TG_API_ID ?? 0),
          apiHash: e.MANAGER_AGENT_TG_API_HASH ?? "",
          phone: e.MANAGER_AGENT_TG_PHONE ?? "",
          proxy: parseTelegramProxy(e.MANAGER_AGENT_TG_PROXY)
        },
    ownerId: normalizeOwnerId(e.MANAGER_AGENT_OWNER_ID),
    privacy: "owner-only" as PrivacyMode,
    createdAt: new Date().toISOString(),
    sleepFrom: Number(e.MANAGER_AGENT_SLEEP_FROM ?? 23),
    sleepTo: Number(e.MANAGER_AGENT_SLEEP_TO ?? 8),
    nightWakeChance: Number(e.MANAGER_AGENT_NIGHT_WAKE ?? 0.05),
    ignoreTendency: Number(e.MANAGER_AGENT_IGNORE_TENDENCY ?? 35),
    communication: commPreset.profile,
    vibe: commPreset.profile.messageStyle === "one-liners" ? "short" : "warm",
    busySchedule: []
  };
}

/**
 * Результат попытки загрузить файл конфигурации `--config=<path>`.
 * Не вызывает `process.exit`, чтобы быть пригодным для юнит-тестов
 * (Task 5.9 manager-mode).
 */
export type ConfigFileLoadResult =
  | { ok: true; config: ProfileConfig; absPath: string }
  | { ok: false; absPath: string; reason: string };

/**
 * Безопасный вариант `loadConfigFile`: вместо `process.exit` возвращает
 * discriminated union с причиной отказа. Используется тестами CLI
 * (`src/__tests__/cli.spec.ts`).
 */
export async function tryLoadConfigFile(file: string): Promise<ConfigFileLoadResult> {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch (e) {
    return { ok: false, absPath: abs, reason: (e as Error)?.message ?? String(e) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, absPath: abs, reason: `невалидный JSON: ${(e as Error)?.message ?? String(e)}` };
  }
  try {
    const config = validateConfigStrict(parsed);
    return { ok: true, config, absPath: abs };
  } catch (e) {
    return { ok: false, absPath: abs, reason: (e as Error)?.message ?? String(e) };
  }
}

async function loadConfigFile(file: string): Promise<ProfileConfig> {
  const res = await tryLoadConfigFile(file);
  if (!res.ok) {
    process.stderr.write(`[server] не могу прочитать --config=${res.absPath}: ${res.reason}\n`);
    process.exit(1);
  }
  return res.config;
}

function validateConfig(raw: unknown): ProfileConfig {
  try {
    return validateConfigStrict(raw);
  } catch (e) {
    process.stderr.write(`[server] ${(e as Error)?.message ?? e}\n`);
    process.stderr.write(`[server] см. шаблон: manager-agent server --print-config\n`);
    process.exit(1);
  }
}

/**
 * Валидация конфига профиля без побочных эффектов.
 * Бросает `Error` со списком недостающих полей вместо `process.exit`.
 * Используется `tryLoadConfigFile` для тестов CLI.
 */
function validateConfigStrict(raw: unknown): ProfileConfig {
  const c = raw as Partial<ProfileConfig> & { llm?: Partial<ProfileConfig["llm"]>; telegram?: Partial<ProfileConfig["telegram"]> };
  const errs: string[] = [];
  if (!c.name) errs.push("name");
  if (!c.age || c.age < 14 || c.age > 99) errs.push("age (14..99)");
  if (!c.nationality || (c.nationality !== "RU" && c.nationality !== "UA")) errs.push("nationality (RU|UA)");
  if (!c.tz) errs.push("tz");
  if (!c.mode || (c.mode !== "bot" && c.mode !== "userbot")) errs.push("mode (bot|userbot)");
  if (!c.stage) errs.push("stage");
  if (!c.llm?.presetId) errs.push("llm.presetId");
  if (!c.llm?.model) errs.push("llm.model");
  if (errs.length) {
    throw new Error(`конфиг невалиден, недостающие поля: ${errs.join(", ")}`);
  }
  const filled: ProfileConfig = {
    slug: c.slug || slugify(c.name!),
    name: c.name!,
    age: c.age!,
    nationality: c.nationality!,
    tz: c.tz!,
    mode: c.mode!,
    stage: c.stage!,
    llm: {
      presetId: c.llm!.presetId!,
      proto: (c.llm!.proto ?? findPreset(c.llm!.presetId!)?.proto ?? "openai") as LLMProto,
      baseURL: c.llm!.baseURL ?? findPreset(c.llm!.presetId!)?.baseURL,
      apiKey: c.llm!.apiKey ?? "",
      model: c.llm!.model!
    },
    telegram: c.telegram ?? {},
    ownerId: normalizeOwnerId(c.ownerId ?? process.env.MANAGER_AGENT_OWNER_ID),
    privacy: c.privacy ?? "owner-only",
    createdAt: c.createdAt ?? new Date().toISOString(),
    sleepFrom: c.sleepFrom ?? 23,
    sleepTo: c.sleepTo ?? 8,
    nightWakeChance: c.nightWakeChance ?? 0.05,
    ignoreTendency: c.ignoreTendency ?? 35,
    communication: c.communication ?? COMMUNICATION_PRESETS[0]!.profile,
    vibe: c.vibe,
    personaNotes: c.personaNotes,
    busySchedule: c.busySchedule ?? []
  };
  return filled;
}

function parseTelegramProxy(raw: string | undefined): ProfileConfig["telegram"]["proxy"] | undefined {
  return parseTelegramProxyInput(raw);
}

// ---------------- ops scaffolds ----------------

export function buildConfigTemplate(): string {
  const sample: ProfileConfig & { __envVars?: Record<string, string> } = {
    slug: "anya",
    name: "Аня",
    age: 22,
    nationality: "RU",
    tz: "Europe/Moscow",
    mode: "bot",
    stage: "tg-given-cold",
    llm: {
      presetId: "claudehub",
      proto: "anthropic",
      baseURL: "https://api.claudehub.fun",
      apiKey: "REPLACE_ME",
      model: "claude-sonnet-4.6"
    },
    telegram: { botToken: "REPLACE_ME" },
    ownerId: undefined,
    privacy: "owner-only",
    createdAt: new Date().toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0.05,
    ignoreTendency: 35,
    communication: COMMUNICATION_PRESETS[0]!.profile,
    vibe: "warm",
    busySchedule: [],
    // __envVars — документация переменных окружения (не сохраняется в config.json
    // профиля; validateConfig игнорирует неизвестные поля).
    __envVars: {
      MANAGER_AGENT_DATA: "путь к каталогу профилей (default: ./data)",
      MANAGER_AGENT_HOST: "host для WebUI (default: 127.0.0.1; в docker — 0.0.0.0)",
      MANAGER_AGENT_PORT: "порт WebUI (default: 3100)",
      MANAGER_AGENT_PUBLIC_URL: "публичный URL за reverse proxy (опционально)",
      MANAGER_AGENT_NO_BROWSER: "1 — не открывать браузер при старте WebUI",
      MANAGER_AGENT_OWNER_ID: "Telegram chat-id владельца (boss); подставляется в ProfileConfig.ownerId",
      MANAGER_AGENT_MODE: "bot | userbot",
      MANAGER_AGENT_TOKEN: "Telegram bot token (для mode=bot)",
      MANAGER_AGENT_TG_API_ID: "Telegram api_id (для mode=userbot)",
      MANAGER_AGENT_TG_API_HASH: "Telegram api_hash (для mode=userbot)",
      MANAGER_AGENT_TG_PHONE: "Телефон для userbot",
      MANAGER_AGENT_TG_PROXY: "SOCKS proxy для userbot (socks5://user:pass@host:port)",
      MANAGER_AGENT_API_PRESET: "id LLM-пресета (claudehub | openai | anthropic | ...)",
      MANAGER_AGENT_API_KEY: "ключ LLM-провайдера",
      MANAGER_AGENT_MODEL: "имя LLM-модели (опционально, иначе default из пресета)",
      MANAGER_AGENT_NAME: "имя ассистента",
      MANAGER_AGENT_AGE: "возраст ассистента (14..99)",
      MANAGER_AGENT_NATIONALITY: "RU | UA",
      MANAGER_AGENT_TZ: "часовой пояс (например, Europe/Moscow)",
      MANAGER_AGENT_STAGE: "id стадии или 1..8",
      MANAGER_AGENT_COMM_PRESET: "id коммуникационного пресета (опционально)",
      MANAGER_AGENT_IGNORE_TENDENCY: "склонность игнорировать (0..100, default 35)",
      MANAGER_AGENT_SLEEP_FROM: "час начала сна 0..23 (default 23)",
      MANAGER_AGENT_SLEEP_TO: "час окончания сна 0..23 (default 8)",
      MANAGER_AGENT_NIGHT_WAKE: "вероятность ответа ночью 0..1 (default 0.05)",
      MANAGER_AGENT_WEBUI_PASSWORD: "пароль для WebUI (опционально)",
      MANAGER_AGENT_DOCKER: "1 — пометить, что запущено в docker (включает 0.0.0.0)",
      MANAGER_AGENT_DEBUG: "1 — verbose-логи userbot connect/getMe/handlers",
      MANAGER_AGENT_ADDON_REGISTRY: "URL marketplace-индекса аддонов"
    }
  };
  return JSON.stringify(sample, null, 2) + "\n";
}

function buildSystemdUnit(): string {
  const home = os.homedir();
  return `# /etc/systemd/system/manager-agent.service
# install: sudo cp this.service /etc/systemd/system/manager-agent.service
#          sudo systemctl daemon-reload
#          sudo systemctl enable --now manager-agent

[Unit]
Description=manager-agent (Telegram AI manager)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%i
WorkingDirectory=${home}
ExecStart=${home}/.local/bin/manager-agent server --config ${home}/.config/manager-agent/bot.json --headless
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
# uncomment for env-driven setup:
# Environment=MANAGER_AGENT_MODE=bot
# Environment=MANAGER_AGENT_TOKEN=...
# Environment=MANAGER_AGENT_API_PRESET=claudehub
# Environment=MANAGER_AGENT_API_KEY=...

[Install]
WantedBy=multi-user.target
`;
}

function buildDockerArtifacts(): string {
  return `# === одной командой ===
docker run -it --rm \\
  -v manager-agent-data:/data \\
  -e MANAGER_AGENT_DATA=/data \\
  ghcr.io/shxpe0x/manager-agent:latest

# === headless с готовым конфигом ===
docker run -d --name manager-agent --restart=unless-stopped \\
  -v manager-agent-data:/data \\
  -v "$PWD/bot.json:/config/bot.json:ro" \\
  -e MANAGER_AGENT_DATA=/data \\
  ghcr.io/shxpe0x/manager-agent:latest \\
  server --config /config/bot.json --headless

# === только env vars (без файла) ===
docker run -d --name manager-agent --restart=unless-stopped \\
  -v manager-agent-data:/data \\
  -e MANAGER_AGENT_DATA=/data \\
  -e MANAGER_AGENT_MODE=bot \\
  -e MANAGER_AGENT_TOKEN=... \\
  -e MANAGER_AGENT_API_PRESET=claudehub \\
  -e MANAGER_AGENT_API_KEY=... \\
  -e MANAGER_AGENT_NAME='Аня' \\
  -e MANAGER_AGENT_AGE=22 \\
  ghcr.io/shxpe0x/manager-agent:latest \\
  server --headless

# === docker-compose.yml ===
# version: "3.9"
# services:
#   manager-agent:
#     image: ghcr.io/shxpe0x/manager-agent:latest
#     # interactive WebUI: command: [] and ports: ["3100:3100"]
#     command: ["server", "--config", "/config/bot.json", "--headless"]
#     environment:
#       MANAGER_AGENT_DATA: /data
#       MANAGER_AGENT_HOST: 0.0.0.0
#     volumes:
#       - manager-agent-data:/data
#       - ./bot.json:/config/bot.json:ro
#     restart: unless-stopped
# volumes:
#   manager-agent-data:
`;
}
