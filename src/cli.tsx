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
      "notifications", "message-style", "initiative", "life-sharing", "privacy"
    ],
    boolean: ["help", "list", "reset", "new"],
    alias: { h: "help" }
  });

  if (argv.help) { process.stdout.write(HELP); return; }

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
    await runRuntime(cfg);
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
    await runRuntime(cfg);
    return;
  }

  // Если есть существующие профили и нет флагов — показать выбор или автозагрузить
  if (!argv.new && !argv.profile && !haveEnoughForFlags) {
    const profiles = await listProfiles();
    if (profiles.length === 1) {
      const cfg = await readConfig(profiles[0]);
      if (cfg) {
        process.stdout.write(`загружаю профиль: ${cfg.name}\n`);
        await runRuntime(cfg);
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
        await runRuntime(cfg);
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

async function runRuntime(cfg: ProfileConfig) {
  const rt = new Runtime(cfg);
  await rt.start();
  const inst = render(<Dashboard runtime={rt} />, { exitOnCtrlC: true });
  process.on("SIGINT", async () => { await rt.stop(); inst.unmount(); process.exit(0); });
  await inst.waitUntilExit();
  await rt.stop();
}

main().catch((e) => {
  process.stderr.write("fatal: " + (e?.stack ?? e) + "\n");
  process.exit(1);
});
