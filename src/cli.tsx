import React from "react";
import { render } from "ink";
import mri from "mri";
import { Wizard } from "./wizard/index.js";
import { Dashboard } from "./dashboard/index.js";
import { Runtime } from "./engine/runtime.js";
import { DATA_ROOT, readConfig, listProfiles, slugify, writeConfig } from "./storage/md.js";
import { findPreset } from "./presets/llm.js";
import { generatePersonaPack } from "./engine/persona-gen.js";
import { makeLLM } from "./llm/index.js";
import { parseTzFlag, defaultTzForNationality } from "./data/timezones.js";
import { pickRandomNames } from "./data/names.js";
import { runHeadlessJsonEvents } from "./headless.js";
import { runServer } from "./server.js";
import { communicationProfileLabel, deriveLegacyVibe, findCommunicationPreset, normalizeCommunicationProfile } from "./presets/communication.js";
import type { ProfileConfig, ClientMode, StageId, LLMProto, Nationality, CommunicationProfile, PrivacyMode } from "./types.js";

const HELP = `
girl-agent — AI girl for Telegram

usage:
  npx girl-agent                       # запустить TUI визард (или автозагрузка если 1 профиль)
  npx girl-agent --new                 # принудительно открыть визард для нового профиля
  npx girl-agent --profile=<slug>      # запустить готовый профиль
  npx girl-agent --reset --profile=<slug>
  npx girl-agent <flags>               # пропустить визард с аргументами

server (для систем без TTY: docker / systemd / cron / CI):
  npx girl-agent server --print-config > bot.json
  npx girl-agent server --config bot.json --headless
  npx girl-agent server --print-systemd | --print-docker | --list

установка одной командой (без node на машине):
  curl -fsSL https://raw.githubusercontent.com/TheSashaDev/girl-agent/main/scripts/install.sh | sh

required flags для headless setup (--name --age --stage --api-preset --mode; --api-key нужен только для провайдеров с авторизацией):
  --profile=<slug>            slug профиля
  --mode=bot|userbot
  --token=<bot_token>         для bot
  --api-id=<n> --api-hash=<h> --phone=<+7…>     для userbot
  --api-preset=<id>           openai|anthropic|openrouter|groq|deepseek|...
  --base-url=<url>            для custom
  --proto=openai|anthropic    для custom
  --model=<model>
  --api-key=<key>             не нужен для локальных LM Studio/Ollama
  --name=<имя>                конкретное имя; если пропустить — случайное из пула по nationality (турнир выбора имён доступен ТОЛЬКО в TUI визарде)
  --age=<n>
  --persona-notes=<text>      доп. пожелания к persona/speech/communication перед генерацией
  --communication-preset=<id> normal|cute|alt|clingy|chatty
  --notifications=<mode>      muted|normal|priority
  --message-style=<style>     one-liners|balanced|bursty|longform
  --initiative=<level>        low|medium|high
  --life-sharing=<level>      low|medium|high
  --privacy=<mode>            owner-only|allow-strangers (по умолчанию owner-only)
  --nationality=RU|UA         (по умолчанию RU)
  --tz=<value>                IANA "Europe/Moscow" / "GMT+3" / "+3" / "Киев" — поиск
  --stage=<id>                met-irl-got-tg|tg-given-cold|tg-given-warming|convinced|first-date-done|dating-early|dating-stable|long-term
  --mcp=exa:KEY               можно несколько раз
  --new                       принудительно открыть визард для нового профиля
  --list                      показать профили
  --help

команды в работающем дашборде: :status :reset :stage <id> :pause :resume :cringe :persona :log :quit
`;

async function main() {
  const argv = mri(process.argv.slice(2), {
    string: [
      "profile", "mode", "token", "api-id", "api-hash", "phone", "api-preset", "base-url", "proto", "model", "api-key",
      "name", "stage", "mcp", "nationality", "tz", "vibe", "persona-notes", "communication-preset",
      "notifications", "message-style", "initiative", "life-sharing", "privacy", "config"
    ],
    boolean: [
      "help", "list", "reset", "new", "json-events", "headless", "server",
      "print-config", "print-systemd", "print-docker", "no-start"
    ],
    alias: { h: "help" }
  });

  // Server subcommand: `npx girl-agent server [...]` or `--server` flag.
  // Bypasses ink TUI entirely — uses readline + stdout logs. Maximally compatible
  // with ssh w/o -t, docker w/o -it, systemd, cron, CI.
  const positional = (argv._ as string[]) ?? [];
  const isServer = positional[0] === "server" || !!argv.server || !!argv["print-config"] || !!argv["print-systemd"] || !!argv["print-docker"];
  if (isServer) {
    await runServer(argv as Record<string, unknown>);
    return;
  }

  if (argv.help) { process.stdout.write(HELP); return; }

  // --- Sanity: TTY/raw-mode detection so terminals that can't render the
  // wizard fail loudly instead of exiting silently after npm warnings.
  // We only require a TTY when we know we'll need to draw the ink wizard or
  // the live dashboard. Headless / --json-events / --list don't need it.
  const isHeadless = !!(argv["json-events"] || argv.headless || argv.list || argv.help);
  if (!isHeadless) {
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean };
    const stdinOk = !!stdin.isTTY;
    const stdoutOk = !!stdout.isTTY;
    if (!stdinOk || !stdoutOk) {
      process.stderr.write(
        "\n[girl-agent] этот терминал не поддерживает интерактивный ink-визард (нет TTY).\n" +
        `  stdin.isTTY = ${stdinOk}, stdout.isTTY = ${stdoutOk}\n\n` +
        "что делать (для серверов / docker / ssh без -t / cron / CI):\n\n" +
        "  1. поставь себе girl-agent одной командой (без node на машине):\n" +
        "       curl -fsSL https://raw.githubusercontent.com/TheSashaDev/girl-agent/main/scripts/install.sh | sh\n" +
        "     дальше:    girl-agent          # ink-визард в обычном tty\n\n" +
        "  2. готовый конфиг + headless (для systemd / cron / CI):\n" +
        "       girl-agent server --print-config > bot.json\n" +
        "       # отредактируй bot.json\n" +
        "       girl-agent server --config bot.json --headless\n\n" +
        "  3. docker (всё внутри контейнера, ноль зависимостей на хосте):\n" +
        "       docker run -it --rm -v girl-agent-data:/data \\\n" +
        "         ghcr.io/thesashadev/girl-agent:latest\n\n" +
        "  4. systemd:  girl-agent server --print-systemd\n" +
        "     docker:   girl-agent server --print-docker\n\n" +
        "  5. на windows быстрее всего — графический инсталлер girl-agent-installer.exe.\n"
      );
      process.exit(2);
    }
  }

  const jsonEvents = !!(argv["json-events"] || argv.headless);

  if (argv.age != null) {
    const a = Number(argv.age);
    if (!Number.isFinite(a) || a < 13 || a > 99) {
      process.stderr.write("age must be a number between 13 and 99\n");
      process.exit(1);
    }
  }

  if (argv.list) {
    const list = await listProfiles();
    process.stdout.write(list.length ? list.join("\n") + "\n" : "(нет профилей)\n");
    return;
  }

  // Direct start by profile
  if (argv.profile && !argv.mode && !argv.name) {
    const cfg = await readConfig(argv.profile);
    if (!cfg) {
      const profiles = await listProfiles();
      process.stderr.write(`profile not found: ${argv.profile}\n`);
      process.stderr.write(`data dir: ${DATA_ROOT}\n`);
      process.stderr.write(profiles.length ? `available profiles:\n${profiles.join("\n")}\n` : "available profiles: none\n");
      process.exit(1);
    }
    if (argv.reset) {
      cfg.stage = "tg-given-cold";
      await writeConfig(cfg);
    }
    await runRuntime(cfg, { jsonEvents });
    return;
  }

  // Headless flag-driven setup (skip wizard if essentials present)
  // name optional — генерим случайное по nationality если не задано
  const presetForFlags = argv["api-preset"] ? findPreset(String(argv["api-preset"])) : undefined;
  const apiKeyRequiredForFlags = presetForFlags?.apiKeyRequired !== false;
  const haveEnoughForFlags = argv.mode && argv["api-preset"] && (!apiKeyRequiredForFlags || argv["api-key"]) && argv.age && argv.stage;
  if (haveEnoughForFlags) {
    const cfg = await buildConfigFromFlags(argv);
    await writeConfig(cfg);
    process.stdout.write(`профиль: ${cfg.name}, ${cfg.age}, ${cfg.nationality}, ${cfg.tz}\nгенерируем persona.md / speech.md / communication.md...\n`);
    const llm = makeLLM(cfg.llm);
    const generated = await generatePersonaPack(llm, cfg.slug, cfg.name, cfg.age, cfg.nationality, personaNotesForGeneration(cfg));
    cfg.busySchedule = generated.busySchedule;
    await writeConfig(cfg);
    await runRuntime(cfg, { jsonEvents });
    return;
  }

  // Если есть существующие профили и нет флагов — показать выбор или автозагрузить
  if (!argv.new && !argv.profile && !haveEnoughForFlags) {
    const profiles = await listProfiles();
    if (profiles.length === 1) {
      const cfg = await readConfig(profiles[0]);
      if (cfg) {
        process.stdout.write(`загружаю профиль: ${cfg.name}\n`);
        await runRuntime(cfg, { jsonEvents });
        return;
      }
    } else if (profiles.length > 1) {
      process.stdout.write(`найдено профилей: ${profiles.length}\nиспользуйте --profile=<slug> для выбора:\n${profiles.join("\n")}\n`);
      process.exit(0);
      return;
    }
  }

  // Wizard
  await new Promise<void>((resolve) => {
    const inst = render(
      <Wizard onDone={async (cfg) => {
        inst.unmount();
        await runRuntime(cfg, { jsonEvents });
        resolve();
      }} />,
      { exitOnCtrlC: true }
    );
    inst.waitUntilExit().then(resolve);
  });
}

async function buildConfigFromFlags(argv: any): Promise<ProfileConfig> {
  const presetId = String(argv["api-preset"]);
  const preset = findPreset(presetId);
  const proto: LLMProto = preset?.proto ?? (argv.proto === "anthropic" ? "anthropic" : "openai");
  const baseURL = preset?.baseURL ?? argv["base-url"];
  const model = argv.model ?? preset?.defaultModel ?? "";
  const nationality: Nationality = (String(argv.nationality ?? "RU").toUpperCase() === "UA") ? "UA" : "RU";
  // имя — если не задано, рандомим из пула
  const name = argv.name ? String(argv.name) : pickRandomNames(nationality, 1)[0]!;
  const slug = String(argv.profile ?? slugify(name));
  const mode = (argv.mode as ClientMode) ?? "bot";
  const tz = (argv.tz ? parseTzFlag(String(argv.tz)) : undefined) ?? defaultTzForNationality(nationality);
  const mcpFlags = ([] as string[]).concat(argv.mcp ?? []);
  const communication = communicationFromFlags(argv);
  const privacy = oneOf(argv.privacy, ["owner-only", "allow-strangers"], "owner-only" as PrivacyMode);
  const mcps: { id: string; secrets: Record<string, string> }[] = mcpFlags.map((entry: string) => {
    const [id, key] = entry.split(":");
    const secrets: Record<string, string> = id === "exa"
      ? { EXA_API_KEY: key ?? "" }
      : { value: key ?? "" };
    return { id: id ?? "", secrets };
  });

  return {
    slug,
    name,
    age: Number(argv.age),
    nationality,
    tz,
    mode,
    stage: argv.stage as StageId,
    llm: { presetId, proto, baseURL, apiKey: String(argv["api-key"] ?? preset?.defaultApiKey ?? ""), model },
    telegram: mode === "bot"
      ? { botToken: String(argv.token ?? "") }
      : {
          apiId: Number(argv["api-id"] ?? 0),
          apiHash: String(argv["api-hash"] ?? ""),
          phone: String(argv.phone ?? "")
        },
    mcp: mcps,
    privacy,
    createdAt: new Date().toISOString(),
    sleepFrom: 23,
    sleepTo: 8,
    nightWakeChance: 0.05,
    vibe: deriveLegacyVibe(communication),
    communication,
    personaNotes: argv["persona-notes"] ? String(argv["persona-notes"]) : undefined,
    busySchedule: []
  };
}

function communicationFromFlags(argv: any): CommunicationProfile {
  const preset = findCommunicationPreset(argv["communication-preset"] ? String(argv["communication-preset"]) : undefined);
  const base = preset?.profile ?? normalizeCommunicationProfile({ vibe: argv.vibe === "warm" ? "warm" : argv.vibe === "short" ? "short" : undefined });
  return {
    notifications: oneOf(argv.notifications, ["muted", "normal", "priority"], base.notifications),
    messageStyle: oneOf(argv["message-style"], ["one-liners", "balanced", "bursty", "longform"], base.messageStyle),
    initiative: oneOf(argv.initiative, ["low", "medium", "high"], base.initiative),
    lifeSharing: oneOf(argv["life-sharing"], ["low", "medium", "high"], base.lifeSharing)
  };
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && allowed.includes(raw as T) ? raw as T : fallback;
}

function personaNotesForGeneration(cfg: ProfileConfig): string {
  const parts = [
    cfg.personaNotes?.trim(),
    `Тон общения: ${communicationProfileLabel(normalizeCommunicationProfile(cfg))}. Учти это при speech.md и communication.md.`
  ].filter(Boolean);
  return parts.join("\n\n");
}

async function runRuntime(cfg: ProfileConfig, opts: { jsonEvents?: boolean } = {}) {
  const rt = new Runtime(cfg);
  await rt.start();
  if (opts.jsonEvents) {
    // Headless / JSON-events mode — used by Rust desktop wrapper.
    await runHeadlessJsonEvents(rt);
    return;
  }
  const inst = render(<Dashboard runtime={rt} />, { exitOnCtrlC: true });
  process.on("SIGINT", async () => { await rt.stop(); inst.unmount(); process.exit(0); });
  await inst.waitUntilExit();
  await rt.stop();
}

process.on("unhandledRejection", (reason) => {
  const r = reason as { stack?: string } | string | undefined;
  const text = (typeof r === "object" && r && r.stack) ? r.stack : String(reason);
  process.stderr.write("[girl-agent] unhandled rejection: " + text + "\n");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  process.stderr.write("[girl-agent] uncaught: " + (err?.stack ?? err) + "\n");
  process.exit(1);
});

main().catch((e) => {
  process.stderr.write("[girl-agent] fatal: " + (e?.stack ?? e) + "\n");
  process.exit(1);
});
