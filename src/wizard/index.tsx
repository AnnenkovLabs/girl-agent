import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import { LLM_PRESETS, findPreset } from "../presets/llm.js";
import { MCP_PRESETS } from "../presets/mcp.js";
import { STAGE_PRESETS } from "../presets/stages.js";
import { COMMUNICATION_PRESETS, communicationProfileLabel, deriveLegacyVibe, findCommunicationPreset, normalizeCommunicationProfile } from "../presets/communication.js";
import type { ProfileConfig, ClientMode, LLMProto, StageId, Nationality, BusySlot, CommunicationProfile, PrivacyMode } from "../types.js";
import { slugify, writeConfig } from "../storage/md.js";
import { makeLLM } from "../llm/index.js";
import { generatePersonaPack } from "../engine/persona-gen.js";
import { userbotLogin } from "../telegram/userbot.js";
import { remoteSendCode, remoteVerifyCode, remoteVerifyPassword, isNeeds2FA } from "../telegram/remote-auth.js";
import { pickRandomNames } from "../data/names.js";
import { findTzByQuery, defaultTzForNationality } from "../data/timezones.js";

export interface WizardResult { config: ProfileConfig; }

type Step =
  | "splash" | "mode" | "tg-bot-token" | "tg-userbot-source" | "tg-userbot-api" | "tg-userbot-phone" | "tg-userbot-code" | "tg-userbot-pass"
  | "api-preset" | "api-base" | "api-model" | "api-model-custom" | "api-key"
  | "nationality" | "name-mode" | "name" | "name-tournament" | "name-tournament-knockout"
  | "age" | "sleep" | "sleep-custom-from" | "sleep-custom-to" | "sleep-custom-chance" | "vibe"
  | "comm-notifications" | "comm-style" | "comm-initiative" | "comm-life"
  | "privacy" | "groups" | "tz" | "persona-notes" | "generating" | "generation-error" | "stage" | "mcp-pick" | "mcp-secret" | "saving" | "done";

const TOURNAMENT_ROUNDS = 20;

const Header: React.FC<{ sub?: string }> = ({ sub }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Gradient name="pastel"><BigText text="girl-agent" font="tiny" /></Gradient>
    <Text dimColor>{sub ?? "AI girl for telegram · .md memory · MCP-ready"}</Text>
  </Box>
);

const Bar: React.FC<{ step: number; total: number }> = ({ step, total }) => {
  const blocks = Array.from({ length: total }, (_, i) =>
    i < step ? "█" : i === step ? "▓" : "░"
  ).join("");
  return <Text color="magenta">[{blocks}] шаг {step + 1}/{total}</Text>;
};

function personaNotesForGeneration(notes: string, communication: CommunicationProfile): string {
  return [
    notes.trim(),
    `Тон общения: ${communicationProfileLabel(communication)}. Учти это при speech.md и communication.md.`
  ].filter(Boolean).join("\n\n");
}

export function Wizard({ initial, onDone }: {
  initial?: Partial<ProfileConfig>;
  onDone: (cfg: ProfileConfig) => void;
}) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>(initial ? "mode" : "splash");
  const [error, setError] = useState<string | null>(null);

  // form state
  const [mode, setMode] = useState<ClientMode>(initial?.mode ?? "bot");
  const [botToken, setBotToken] = useState(initial?.telegram?.botToken ?? "");
  const [apiId, setApiId] = useState<string>(initial?.telegram?.apiId ? String(initial.telegram.apiId) : "");
  const [apiHash, setApiHash] = useState(initial?.telegram?.apiHash ?? "");
  const [phone, setPhone] = useState(initial?.telegram?.phone ?? "");
  const [code, setCode] = useState("");
  const [pass2fa, setPass2fa] = useState("");
  const [sessionString, setSessionString] = useState(initial?.telegram?.sessionString ?? "");
  const [useOwnerCreds, setUseOwnerCreds] = useState(false);
  const [loginToken, setLoginToken] = useState("");

  const [llmPresetId, setLlmPresetId] = useState<string>(initial?.llm?.presetId ?? "openai");
  const [llmProto, setLlmProto] = useState<LLMProto>(initial?.llm?.proto ?? "openai");
  const [llmBaseURL, setLlmBaseURL] = useState(initial?.llm?.baseURL ?? "");
  const [llmModel, setLlmModel] = useState(initial?.llm?.model ?? "");
  const [llmKey, setLlmKey] = useState(initial?.llm?.apiKey ?? "");

  const [nationality, setNationality] = useState<Nationality>(initial?.nationality ?? "RU");
  const [name, setName] = useState(initial?.name ?? "");
  const [ageStr, setAgeStr] = useState(initial?.age ? String(initial.age) : "");
  const [tz, setTz] = useState<string>(initial?.tz ?? "");
  const [tzQuery, setTzQuery] = useState<string>("");
  const [personaNotes, setPersonaNotes] = useState(initial?.personaNotes ?? "");

  // tournament state
  const [tournamentRound, setTournamentRound] = useState(0);
  const [tournamentPair, setTournamentPair] = useState<[string, string]>(["", ""]);
  const [tournamentQualifiers, setTournamentQualifiers] = useState<string[]>([]);
  const [tournamentPool, setTournamentPool] = useState<string[]>([]);
  const [tournamentSeen, setTournamentSeen] = useState<Set<string>>(new Set());

  // sleep state
  const [, setSleepPreset] = useState("");
  const [sleepFromStr, setSleepFromStr] = useState("23");
  const [sleepToStr, setSleepToStr] = useState("8");
  const [nightWakeStr, setNightWakeStr] = useState("5");
  const [communicationProfile, setCommunicationProfile] = useState<CommunicationProfile>(normalizeCommunicationProfile(initial));
  const [privacy, setPrivacy] = useState<PrivacyMode>(initial?.privacy ?? "owner-only");
  const [allowGroups, setAllowGroups] = useState<boolean>(initial?.allowGroups ?? false);

  const [stage, setStage] = useState<StageId>(initial?.stage ?? "tg-given-cold");

  const [pickedMcp, setPickedMcp] = useState<string[]>(initial?.mcp?.map(m => m.id) ?? []);
  const [mcpQueue, setMcpQueue] = useState<string[]>([]);
  const [mcpSecrets, setMcpSecrets] = useState<Record<string, Record<string, string>>>(
    Object.fromEntries((initial?.mcp ?? []).map(m => [m.id, m.secrets]))
  );
  const [mcpSecretIdx, setMcpSecretIdx] = useState(0);
  const [mcpSecretVal, setMcpSecretVal] = useState("");

  const [genStatus, setGenStatus] = useState("придумываем её…");
  const [genPercent, setGenPercent] = useState(0);
  const [busySchedule, setBusySchedule] = useState<BusySlot[]>(initial?.busySchedule ?? []);

  // focus control for multi-input screens
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // reset focus when step changes
  React.useEffect(() => {
    setFocusedInput(null);
    if (step === "tg-userbot-api") {
      setFocusedInput("apiId");
    }
  }, [step]);

  // userbot login resolvers
  const [codeResolver, setCodeResolver] = useState<((v: string) => void) | null>(null);
  const [passResolver, setPassResolver] = useState<((v: string) => void) | null>(null);

  useInput((input, key) => {
    if (step === "splash" && (key.return || input)) {
      setStep("mode");
    }
    if (key.escape) exit();
    // Tab navigation for multi-input screens
    if (key.tab) {
      if (step === "tg-userbot-api") {
        setFocusedInput(focusedInput === "apiId" ? "apiHash" : "apiId");
      }
    }
    // Down arrow to move focus down
    if (key.downArrow && step === "tg-userbot-api") {
      setFocusedInput("apiHash");
    }
    // Up arrow to move focus up
    if (key.upArrow && step === "tg-userbot-api") {
      setFocusedInput("apiId");
    }
  });

  async function startGeneration() {
    setStep("generating");
    setGenPercent(0);
    try {
      setError(null);
      setGenStatus("подключаемся к LLM…");
      const slug = slugify(name);
      const llm = makeLLM({ presetId: llmPresetId, proto: llmProto, baseURL: llmBaseURL, apiKey: llmKey, model: llmModel });

      const generated = await generatePersonaPack(
        llm,
        slug,
        name.trim(),
        Number(ageStr),
        nationality,
        personaNotesForGeneration(personaNotes, communicationProfile),
        (percent, status) => {
          setGenPercent(percent);
          setGenStatus(status);
        }
      );
      setGenPercent(100);
      setGenStatus("готово!");
      setBusySchedule(generated.busySchedule);
      await writeConfig(makeConfig({ busySchedule: generated.busySchedule, mcp: [] }));
      setTimeout(() => setStep("stage"), 800);
    } catch (e) {
      setError("LLM ошибка: " + (e as Error).message);
      setGenStatus("ошибка генерации");
      setStep("generation-error");
    }
  }

  // ============== STEP RENDERERS ==============

  if (step === "splash") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Box marginTop={1}><Text>живой ИИ-агент в твоём телеграме. девушка-подросток, .md память, реальные эмоции, кринж и игнор.</Text></Box>
        <Box marginTop={1}><Text dimColor>Enter — начать. Esc — выйти.</Text></Box>
      </Box>
    );
  }

  if (step === "mode") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="кем подключаемся к Telegram?" />
        <Bar step={0} total={9} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Bot — обычный @BotFather бот (проще)", value: "bot" },
              { label: "Userbot — твой реальный аккаунт (gramjs)", value: "userbot" }
            ]}
            onSelect={(it) => {
              const m = it.value as ClientMode;
              setMode(m);
              setStep(m === "bot" ? "tg-bot-token" : "tg-userbot-source");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "tg-bot-token") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="вставь BOT_TOKEN от @BotFather" />
        <Bar step={1} total={9} />
        <Box marginTop={1}><Text color="cyan">{">  "}</Text>
          <TextInput value={botToken} onChange={setBotToken} mask="•" onSubmit={() => {
            if (!botToken.includes(":")) { setError("токен невалидный"); return; }
            setError(null); setStep("api-preset");
          }} />
        </Box>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === "tg-userbot-source") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="у тебя есть свои API credentials?" />
        <Bar step={1} total={9} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Да, у меня есть api_id и api_hash (my.telegram.org)", value: "own" },
              { label: "Нет — использовать от владельца бота", value: "owner" },
            ]}
            onSelect={(it) => {
              if (it.value === "own") {
                setUseOwnerCreds(false);
                setStep("tg-userbot-api");
              } else {
                setUseOwnerCreds(true);
                setStep("tg-userbot-phone");
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>если не можешь создать приложение на my.telegram.org — выбери второй вариант</Text>
        </Box>
      </Box>
    );
  }

  if (step === "tg-userbot-api") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="userbot · my.telegram.org → API_ID и API_HASH" />
        <Bar step={1} total={9} />
        {focusedInput === "apiId" ? (
          <Box marginTop={1}><Text>API_ID: </Text>
            <TextInput value={apiId} onChange={setApiId} onSubmit={() => setFocusedInput("apiHash")} />
          </Box>
        ) : (
          <Box marginTop={1}><Text>API_ID: </Text><Text color={focusedInput === "apiHash" ? "dimColor" : "white"}>{apiId || "(пусто)"}</Text></Box>
        )}
        {focusedInput === "apiHash" ? (
          <Box><Text>API_HASH: </Text>
            <TextInput value={apiHash} onChange={setApiHash} mask="•" onSubmit={() => apiId && setStep("tg-userbot-phone")} />
          </Box>
        ) : (
          <Box><Text>API_HASH: </Text><Text color={focusedInput === "apiId" ? "dimColor" : "white"}>{apiHash ? "••••••••" : "(пусто)"}</Text></Box>
        )}
        <Box marginTop={1}><Text dimColor>Tab / стрелки чтобы переключиться между полями</Text></Box>
      </Box>
    );
  }

  if (step === "tg-userbot-phone") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="телефон в международном формате (+7…)" />
        <Bar step={1} total={9} />
        <Box marginTop={1}><Text>Phone: </Text>
          <TextInput value={phone} onChange={setPhone} onSubmit={async () => {
            setError(null);
            if (useOwnerCreds) {
              setGenStatus("отправляем код через прокси…");
              setStep("tg-userbot-code");
              try {
                const result = await remoteSendCode(phone);
                setLoginToken(result.loginToken);
              } catch (e) {
                setError((e as Error).message);
                setStep("tg-userbot-phone");
              }
            } else {
              setStep("tg-userbot-code");
              setGenStatus("отправляем код…");
              try {
                const sess = await userbotLogin({
                  apiId: Number(apiId),
                  apiHash,
                  phone,
                  promptCode: () => new Promise<string>((res) => setCodeResolver(() => res)),
                  promptPassword: () => new Promise<string>((res) => setPassResolver(() => res))
                });
                setSessionString(sess);
                setStep("api-preset");
              } catch (e) {
                setError((e as Error).message);
                setStep("tg-userbot-phone");
              }
            }
          }} />
        </Box>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === "tg-userbot-code") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="код из Telegram" />
        <Bar step={1} total={9} />
        <Box marginTop={1}><Text>Code: </Text>
          <TextInput value={code} onChange={setCode} onSubmit={async () => {
            if (useOwnerCreds) {
              if (!loginToken) { setError("ещё отправляем код, подожди…"); return; }
              setError(null);
              try {
                const result = await remoteVerifyCode(loginToken, code);
                if (isNeeds2FA(result)) {
                  setStep("tg-userbot-pass");
                } else {
                  setApiId(String(result.apiId));
                  setApiHash(result.apiHash);
                  setSessionString(result.sessionString);
                  setStep("api-preset");
                }
              } catch (e) {
                setError((e as Error).message);
                setStep("tg-userbot-phone");
              }
            } else {
              codeResolver?.(code);
              setStep("tg-userbot-pass");
            }
          }} />
        </Box>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === "tg-userbot-pass") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="2FA пароль (если есть, иначе Enter)" />
        <Bar step={1} total={9} />
        <Box marginTop={1}><Text>2FA: </Text>
          <TextInput value={pass2fa} onChange={setPass2fa} mask="•" onSubmit={async () => {
            if (useOwnerCreds) {
              setError(null);
              try {
                const result = await remoteVerifyPassword(loginToken, pass2fa);
                setApiId(String(result.apiId));
                setApiHash(result.apiHash);
                setSessionString(result.sessionString);
                setStep("api-preset");
              } catch (e) {
                setError((e as Error).message);
                setStep("tg-userbot-phone");
              }
            } else {
              passResolver?.(pass2fa);
            }
          }} />
        </Box>
        {error && <Text color="red">{error}</Text>}
        <Text dimColor>входим в аккаунт…</Text>
      </Box>
    );
  }

  if (step === "api-preset") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="выбери API провайдера" />
        <Bar step={2} total={9} />
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            limit={10}
            items={LLM_PRESETS.map(p => ({ label: `${p.name}${p.hint ? `  · ${p.hint}` : ""}`, value: p.id }))}
            onSelect={(it) => {
              const preset = findPreset(it.value as string)!;
              setLlmPresetId(preset.id);
              setLlmProto(preset.proto);
              setLlmBaseURL(preset.baseURL ?? "");
              setLlmModel(preset.defaultModel);
              if (preset.custom) setStep("api-base");
              else setStep("api-model");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "api-base") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="base URL для custom API" />
        <Bar step={2} total={9} />
        <Box marginTop={1}><Text>Base URL: </Text>
          <TextInput value={llmBaseURL} onChange={setLlmBaseURL} onSubmit={() => setStep("api-model")} />
        </Box>
      </Box>
    );
  }

  if (step === "api-model") {
    const preset = findPreset(llmPresetId);
    const items = (preset?.models ?? []).map(m => ({ label: m, value: m }));
    items.push({ label: "✎ ввести вручную", value: "__custom__" });
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub={`модель (${preset?.name})`} />
        <Bar step={2} total={9} />
        <Box marginTop={1}>
          {items.length > 1 ? (
            <SelectInput items={items} onSelect={(it) => {
              if (it.value === "__custom__") {
                setLlmModel("");
                setStep("api-model-custom");
              } else {
                setLlmModel(it.value as string);
                setStep("api-key");
              }
            }} />
          ) : (
            <TextInput value={llmModel} onChange={setLlmModel} onSubmit={() => setStep("api-key")} />
          )}
        </Box>
      </Box>
    );
  }

  if (step === ("api-model-custom" as Step)) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="название модели" />
        <Bar step={2} total={9} />
        <Box marginTop={1}><Text>Model: </Text>
          <TextInput value={llmModel} onChange={setLlmModel} onSubmit={() => setStep("api-key")} />
        </Box>
      </Box>
    );
  }

  if (step === "api-key") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="API ключ" />
        <Bar step={2} total={11} />
        <Box marginTop={1}><Text>Key: </Text>
          <TextInput value={llmKey} onChange={setLlmKey} mask="•" onSubmit={() => llmKey && setStep("nationality")} />
        </Box>
      </Box>
    );
  }

  if (step === "nationality") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="национальность (язык, имя, культура)" />
        <Bar step={3} total={11} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "🇷🇺 Россия / СНГ — русский", value: "RU" },
              { label: "🇺🇦 Украина — русский + лёгкий суржик (10%)", value: "UA" }
            ]}
            onSelect={(it) => {
              setNationality(it.value as Nationality);
              if (!tz) setTz(defaultTzForNationality(it.value as Nationality));
              setStep("name-mode");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "name-mode") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="имя — выберешь сам или прогон по парам?" />
        <Bar step={4} total={11} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "✎ Введу сам", value: "type" },
              { label: `🎲 Турнир ${TOURNAMENT_ROUNDS} раундов — будут показывать пары имён, выбираешь интуитивно`, value: "tournament" }
            ]}
            onSelect={(it) => {
              if (it.value === "type") {
                setStep("name");
              } else {
                // start tournament
                const [a, b] = pickRandomNames(nationality, 2);
                setTournamentPair([a!, b!]);
                setTournamentRound(0);
                setTournamentQualifiers([]);
                setTournamentPool([]);
                setTournamentSeen(new Set([a!, b!]));
                setStep("name-tournament");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "name") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="как её зовут?" />
        <Bar step={4} total={12} />
        <Box marginTop={1}><Text>имя: </Text>
          <TextInput value={name} onChange={setName} onSubmit={() => name.trim() && setStep("age")} />
        </Box>
      </Box>
    );
  }

  if (step === "name-tournament") {
    const advance = (winner: string) => {
      const qualifiers = [...tournamentQualifiers, winner];
      const nextRound = tournamentRound + 1;
      if (nextRound >= TOURNAMENT_ROUNDS) {
        setTournamentQualifiers(qualifiers);
        if (qualifiers.length === 0) {
          setStep("name");
        } else if (qualifiers.length === 1) {
          setName(qualifiers[0]!);
          setStep("age");
        } else {
          setTournamentPool([...qualifiers]);
          setTournamentRound(0);
          setTournamentPair(["", ""]);
          setStep("name-tournament-knockout");
        }
        return;
      }
      const seen = new Set([...tournamentSeen, winner]);
      let candidates = pickRandomNames(nationality, 2, seen);
      if (candidates.length < 2) {
        const fresh = pickRandomNames(nationality, 2);
        candidates = fresh;
      }
      setTournamentPair([candidates[0]!, candidates[1]!]);
      candidates.forEach(c => seen.add(c));
      setTournamentSeen(seen);
      setTournamentQualifiers(qualifiers);
      setTournamentRound(nextRound);
    };
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub={`квалификация ${tournamentRound + 1}/${TOURNAMENT_ROUNDS} · какое имя нравится больше?`} />
        <Bar step={4} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: tournamentPair[0], value: tournamentPair[0] },
              { label: tournamentPair[1], value: tournamentPair[1] },
              { label: "↻ обе мимо — следующая пара", value: "__skip__" }
            ]}
            onSelect={(it) => {
              if (it.value === "__skip__") {
                const seen = new Set([...tournamentSeen]);
                const candidates = pickRandomNames(nationality, 2, seen);
                if (candidates.length >= 2) {
                  setTournamentPair([candidates[0]!, candidates[1]!]);
                  candidates.forEach(c => seen.add(c));
                  setTournamentSeen(seen);
                }
                return;
              }
              advance(it.value as string);
            }}
          />
        </Box>
        <Box marginTop={1}><Text dimColor>прошли в турнир: {tournamentQualifiers.join(", ") || "—"}</Text></Box>
      </Box>
    );
  }

  if (step === "name-tournament-knockout") {
    if (tournamentPool.length <= 1) {
      const w = tournamentPool[0] || tournamentQualifiers[0];
      if (w) { setName(w); setStep("age"); }
      else { setStep("name"); }
      return null;
    }
    if (!tournamentPair[0]) {
      const shuffled = [...tournamentPool].sort(() => Math.random() - 0.5);
      setTournamentPair([shuffled[0]!, shuffled[1]!]);
      return null;
    }
    const advanceKnockout = (winner: string) => {
      const loser = tournamentPair[0] === winner ? tournamentPair[1] : tournamentPair[0];
      const nextPool = tournamentPool.filter(n => n !== loser);
      setTournamentPool(nextPool);
      setTournamentRound(r => r + 1);
      if (nextPool.length > 1) {
        const shuffled = [...nextPool].sort(() => Math.random() - 0.5);
        setTournamentPair([shuffled[0]!, shuffled[1]!]);
      }
    };
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub={`⚔ турнир выживших · раунд ${tournamentRound + 1} · осталось ${tournamentPool.length}`} />
        <Bar step={4} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: tournamentPair[0], value: tournamentPair[0] },
              { label: tournamentPair[1], value: tournamentPair[1] },
            ]}
            onSelect={(it) => advanceKnockout(it.value as string)}
          />
        </Box>
      </Box>
    );
  }

  if (step === "age") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub={`сколько лет ${name}?`} />
        <Bar step={5} total={12} />
        <Box marginTop={1}><Text>возраст: </Text>
          <TextInput value={ageStr} onChange={(v) => setAgeStr(v.replace(/[^0-9]/g, ""))} onSubmit={() => {
            const a = Number(ageStr);
            if (!a || a < 13 || a > 99) { setError("введи число 13-99"); return; }
            setError(null);
            setStep("sleep");
          }} />
        </Box>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === "sleep") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub={`режим сна ${name || "девушки"}`} />
        <Bar step={6} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "😴 Норма — засыпает ~23, просыпается ~8, шанс ночного пробуждения 5%", value: "normal" },
              { label: "🦉 Сова — 2→10, шанс 15%", value: "owl" },
              { label: "🐦 Жаворонок — 22→6, шанс 3%", value: "lark" },
              { label: "💤 Хаотичный — разное время, шанс 10%", value: "chaotic" },
              { label: "✎ Свой режим", value: "custom" }
            ]}
            onSelect={(it) => {
              const v = it.value;
              setSleepPreset(v);
              if (v === "normal") { setSleepFromStr("23"); setSleepToStr("8"); setNightWakeStr("5"); setStep("vibe"); }
              else if (v === "owl") { setSleepFromStr("2"); setSleepToStr("10"); setNightWakeStr("15"); setStep("vibe"); }
              else if (v === "lark") { setSleepFromStr("22"); setSleepToStr("6"); setNightWakeStr("3"); setStep("vibe"); }
              else if (v === "chaotic") {
                const seed = [...(name || "x")].reduce((a, c) => a + c.charCodeAt(0), 0);
                const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
                const sf = Math.floor(22 + r(1) * 6);
                const st = Math.floor(6 + r(2) * 6);
                setSleepFromStr(String(sf > 23 ? sf - 24 : sf));
                setSleepToStr(String(st));
                setNightWakeStr("10");
                setStep("vibe");
              } else {
                setStep("sleep-custom-from");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "sleep-custom-from") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="во сколько засыпает? (0-23)" />
        <Bar step={6} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={Array.from({ length: 24 }, (_, i) => ({ label: `${String(i).padStart(2, "0")}:00`, value: String(i) }))}
            onSelect={(it) => { setSleepFromStr(it.value); setStep("sleep-custom-to"); }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "sleep-custom-to") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="во сколько просыпается? (0-23)" />
        <Bar step={6} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={Array.from({ length: 24 }, (_, i) => ({ label: `${String(i).padStart(2, "0")}:00`, value: String(i) }))}
            onSelect={(it) => { setSleepToStr(it.value); setStep("sleep-custom-chance"); }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "sleep-custom-chance") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="шанс ночного пробуждения на сообщение" />
        <Bar step={6} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "0% — спит как мертвая", value: "0" },
              { label: "3%", value: "3" },
              { label: "5%", value: "5" },
              { label: "10%", value: "10" },
              { label: "15% — часто просыпается", value: "15" },
              { label: "25% — тревожный сон", value: "25" },
              { label: "50% — практически не спит ночью", value: "50" },
            ]}
            onSelect={(it) => { setNightWakeStr(it.value); setStep("vibe"); }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "vibe") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="тонкая настройка общения" />
        <Bar step={7} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              ...COMMUNICATION_PRESETS.map(p => ({ label: `${p.label} — ${p.description}`, value: p.id })),
              { label: "✎ Настроить вручную", value: "__custom__" }
            ]}
            onSelect={(it) => {
              if (it.value === "__custom__") {
                setStep("comm-notifications");
                return;
              }
              const preset = findCommunicationPreset(String(it.value));
              if (preset) setCommunicationProfile(preset.profile);
              setStep("privacy");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "comm-notifications") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="уведомления от тебя" />
        <Bar step={7} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "� muted — может видеть позже", value: "muted" },
              { label: "🔔 normal — обычные уведомления", value: "normal" },
              { label: "💖 priority — твои сообщения важные, чаще быстро отвечает", value: "priority" }
            ]}
            onSelect={(it) => {
              setCommunicationProfile(p => ({ ...p, notifications: it.value as CommunicationProfile["notifications"] }));
              setStep("comm-style");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "comm-style") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="стиль переписки" />
        <Bar step={7} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "one-liners — коротко, 1 слово/фраза", value: "one-liners" },
              { label: "balanced — 1-3 пузыря, разный ритм", value: "balanced" },
              { label: "bursty — пишет серией сообщений подряд", value: "bursty" },
              { label: "longform — иногда длиннее рассказывает", value: "longform" }
            ]}
            onSelect={(it) => {
              setCommunicationProfile(p => ({ ...p, messageStyle: it.value as CommunicationProfile["messageStyle"] }));
              setStep("comm-initiative");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "comm-initiative") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="инициатива" />
        <Bar step={7} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "low — первой пишет редко", value: "low" },
              { label: "medium — иногда пишет сама", value: "medium" },
              { label: "high — часто сама начинает темы", value: "high" }
            ]}
            onSelect={(it) => {
              setCommunicationProfile(p => ({ ...p, initiative: it.value as CommunicationProfile["initiative"] }));
              setStep("comm-life");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "comm-life") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="делиться моментами жизни" />
        <Bar step={7} total={12} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "low — почти не рассказывает о себе", value: "low" },
              { label: "medium — иногда бытовые моменты", value: "medium" },
              { label: "high — часто пишет что у неё происходит", value: "high" }
            ]}
            onSelect={(it) => {
              setCommunicationProfile(p => ({ ...p, lifeSharing: it.value as CommunicationProfile["lifeSharing"] }));
              setStep("privacy");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "privacy") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="приватность Telegram" />
        <Bar step={8} total={14} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Только я — отвечать только primary owner, остальных молча игнорировать", value: "owner-only" },
              { label: "Разрешить сторонние личные чаты — коротко общаться с незнакомыми в ЛС без памяти", value: "allow-strangers" }
            ]}
            onSelect={(it) => {
              setPrivacy(it.value as PrivacyMode);
              setStep("groups");
            }}
          />
        </Box>
        <Text dimColor>Primary owner закрепляется по первому личному сообщению.</Text>
      </Box>
    );
  }


  if (step === "groups") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="групповые чаты" />
        <Bar step={8} total={13} />
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Только ЛС — игнорировать любые группы", value: "false" },
              { label: "Разрешить группы — отвечать в группах (с учетом вероятностей и mentions)", value: "true" }
            ]}
            onSelect={(it) => {
              setAllowGroups(it.value === "true");
              setStep("tz");
            }}
          />
        </Box>
      </Box>
    );
  }
if (step === "tz") {
    const matches = findTzByQuery(tzQuery, 8);
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="её часовой пояс (где живёт)" />
        <Bar step={9} total={14} />
        <Box marginTop={1}><Text>поиск (город/страна/GMT): </Text>
          <TextInput value={tzQuery} onChange={setTzQuery} onSubmit={() => {
            if (matches[0]) {
              setTz(matches[0].iana);
              setStep("persona-notes");
            }
          }} />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {matches.map(t => (
            <Text key={t.iana} color={t.iana === tz ? "green" : "white"}>
              {t.iana === tz ? "❯ " : "  "}{t.gmtWinter} · {t.city} ({t.country}) · {t.iana}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}><Text dimColor>Enter — выбрать первый результат, или продолжай печатать. Текущий: {tz || "—"}</Text></Box>
      </Box>
    );
  }

  if (step === "persona-notes") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="доп. пожелания к персоне (необязательно)" />
        <Bar step={10} total={14} />
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Пример: дерзкая, учится на дизайнера, не любит аниме, сухая манера речи, живёт с мамой, ревнивая.</Text>
          <Box marginTop={1}><Text>notes: </Text>
            <TextInput value={personaNotes} onChange={setPersonaNotes} onSubmit={() => startGeneration()} />
          </Box>
          <Text dimColor>Enter на пустой строке — без пожеланий.</Text>
        </Box>
      </Box>
    );
  }

  if (step === "generating") {
    const barWidth = 30;
    const filled = Math.floor((genPercent / 100) * barWidth);
    const empty = barWidth - filled;
    const progressBar = "█".repeat(filled) + "░".repeat(empty);
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="LLM пишет её persona.md / speech.md / communication.md" />
        <Box marginTop={1}><Text color="magenta"><Spinner type="dots" /></Text><Text> {genStatus}</Text></Box>
        <Box marginTop={1}>
          <Text color="cyan">{progressBar}</Text>
          <Text> {genPercent}%</Text>
        </Box>
      </Box>
    );
  }

  if (step === "generation-error") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="генерация не завершилась" />
        <Box marginTop={1} flexDirection="column">
          <Text color="red">{error}</Text>
          <Text dimColor>Настройки не сброшены: можно исправить API/base URL/model/key и запустить генерацию снова.</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Повторить генерацию с теми же настройками", value: "retry" },
              { label: "Изменить API ключ", value: "api-key" },
              { label: "Изменить модель", value: "api-model-custom" },
              { label: "Изменить base URL", value: "api-base" }
            ]}
            onSelect={(it) => {
              if (it.value === "retry") void startGeneration();
              else setStep(it.value as Step);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "stage") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="на какой стадии вы сейчас?" />
        <Bar step={11} total={14} />
        <Box marginTop={1}>
          <SelectInput
            limit={10}
            items={STAGE_PRESETS.filter(s => s.id !== "dumped").map(s => ({ label: `${s.label}  ·  ${s.description}`, value: s.id }))}
            onSelect={async (it) => {
              const nextStage = it.value as StageId;
              setStage(nextStage);
              await writeConfig(makeConfig({ stage: nextStage }));
              setStep("mcp-pick");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === "mcp-pick") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="MCP инструменты (space — toggle, enter — далее)" />
        <Bar step={12} total={14} />
        <McpToggle
          selected={pickedMcp}
          onChange={setPickedMcp}
          onSubmit={() => {
            const need = pickedMcp.filter(id => MCP_PRESETS.find(m => m.id === id)?.secrets?.length);
            setMcpQueue(need);
            setMcpSecretIdx(0);
            if (need.length) setStep("mcp-secret");
            else { setStep("saving"); save(); }
          }}
        />
      </Box>
    );
  }

  if (step === "mcp-secret") {
    const id = mcpQueue[0];
    const preset = MCP_PRESETS.find(m => m.id === id);
    const secret = preset?.secrets?.[mcpSecretIdx];
    if (!preset || !secret) {
      // advance
      setTimeout(() => {
        const rest = mcpQueue.slice(1);
        setMcpQueue(rest);
        setMcpSecretIdx(0);
        if (rest.length === 0) { setStep("saving"); save(); }
      }, 0);
      return null;
    }
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub={`${preset.name} · ${secret.label}`} />
        <Bar step={6} total={9} />
        <Box marginTop={1}><Text>{secret.key}: </Text>
          <TextInput value={mcpSecretVal} onChange={setMcpSecretVal} mask="•" onSubmit={() => {
            const cur = mcpSecrets[id] ?? {};
            cur[secret.key] = mcpSecretVal;
            setMcpSecrets({ ...mcpSecrets, [id]: cur });
            setMcpSecretVal("");
            const next = mcpSecretIdx + 1;
            if (next < (preset.secrets?.length ?? 0)) setMcpSecretIdx(next);
            else {
              const rest = mcpQueue.slice(1);
              setMcpQueue(rest);
              setMcpSecretIdx(0);
              if (rest.length === 0) { setStep("saving"); save(); }
            }
          }} />
        </Box>
      </Box>
    );
  }

  if (step === "saving") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="сохраняем профиль…" />
        <Box marginTop={1}><Text color="magenta"><Spinner type="dots" /></Text><Text> готово почти</Text></Box>
      </Box>
    );
  }

  if (step === "done") {
    return (
      <Box flexDirection="column" padding={1}>
        <Header sub="готово" />
        <Text color="green">профиль сохранён. запускаем агента…</Text>
      </Box>
    );
  }

  return null;

  function makeConfig(overrides: Partial<Pick<ProfileConfig, "stage" | "busySchedule" | "mcp">> = {}): ProfileConfig {
    const slug = slugify(name);
    return {
      slug,
      name: name.trim(),
      age: Number(ageStr),
      nationality,
      tz: tz || defaultTzForNationality(nationality),
      mode,
      stage: overrides.stage ?? stage,
      llm: { presetId: llmPresetId, proto: llmProto, baseURL: llmBaseURL, apiKey: llmKey, model: llmModel },
      telegram: mode === "bot"
        ? { botToken }
        : { apiId: Number(apiId), apiHash, phone, sessionString },
      mcp: overrides.mcp ?? pickedMcp.map(id => ({ id, secrets: mcpSecrets[id] ?? {} })),
      privacy,
      allowGroups,
      createdAt: new Date().toISOString(),
      sleepFrom: Number(sleepFromStr),
      sleepTo: Number(sleepToStr),
      nightWakeChance: Number(nightWakeStr) / 100,
      vibe: deriveLegacyVibe(communicationProfile),
      communication: communicationProfile,
      personaNotes: personaNotes.trim() || undefined,
      busySchedule: overrides.busySchedule ?? busySchedule
    };
  }

  async function save() {
    const cfg = makeConfig();
    await writeConfig(cfg);
    setStep("done");
    setTimeout(() => onDone(cfg), 600);
  }
}

const McpToggle: React.FC<{
  selected: string[];
  onChange: (ids: string[]) => void;
  onSubmit: () => void;
}> = ({ selected, onChange, onSubmit }) => {
  const [cursor, setCursor] = useState(0);
  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(MCP_PRESETS.length - 1, c + 1));
    if (input === " ") {
      const m = MCP_PRESETS[cursor]!;
      if (!m.ready) return;
      const next = selected.includes(m.id) ? selected.filter(x => x !== m.id) : [...selected, m.id];
      onChange(next);
    }
    if (key.return) onSubmit();
  });
  return (
    <Box flexDirection="column" marginTop={1}>
      {MCP_PRESETS.map((m, i) => {
        const checked = selected.includes(m.id);
        const active = i === cursor;
        const color = !m.ready ? "gray" : active ? "magentaBright" : checked ? "green" : "white";
        return (
          <Text key={m.id} color={color}>
            {active ? "❯ " : "  "}[{checked ? "x" : " "}] {m.name} {m.ready ? "" : "· soon"}  ·  {m.description}
          </Text>
        );
      })}
      <Box marginTop={1}><Text dimColor>↑↓ — навигация · space — выбрать · enter — далее</Text></Box>
    </Box>
  );
};
