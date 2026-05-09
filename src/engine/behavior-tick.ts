import type { LLMClient } from "../llm/index.js";
import type { BehaviorTickResult, CommunicationProfile, ProfileConfig } from "../types.js";
import { findStage } from "../presets/stages.js";
import { communicationDecisionState, ignoreTendencyPrompt, normalizeCommunicationProfile, normalizeIgnoreTendency } from "../presets/communication.js";
import { readRelationship } from "../storage/md.js";
import type { PresenceState } from "./presence.js";
import type { ConflictState } from "./conflict.js";

const SYS = `Ты — внутренний "decision layer" для симуляции живой девушки. По текущему состоянию реши, как она отреагирует на новое сообщение от парня. Никаких разговоров — только JSON.`;

interface BehaviorContext {
  presence?: PresenceState;
  conflict?: ConflictState;
  conflictColdActive?: boolean;
  blockHint?: string; // что она сейчас делает по daily-life
  activeDialog?: boolean;
}

function reactionMenu(stage: string, score: { attraction: number; interest: number; annoyance: number; cringe: number }): string {
  const isWarm = score.attraction > 30 || ["dating-early", "dating-stable", "long-term"].includes(stage);
  const isCold = score.annoyance > 40 || stage === "tg-given-cold";

  if (isWarm) {
    return `Доступные реакции (СТАДИЯ ТЁПЛАЯ — она расположена к нему):
- ❤ / 🥰 / 🥹 — на милое/трогательное
- 😂 / 🤭 — на смешное
- 🔥 — на крутое
- 👀 — на интригующее
- 🥺 — когда хочется внимания
- 😅 — когда лажа но милая
ЗАПРЕЩЕНО ставить: 🤡, 💀, 🤮, 🖕, 😐, 🙄 — влюблённая/расположенная девушка не пошлёт такое любимому. На неудачную шутку она просто мило не искренне посмеётся в тексте ("ахах ну такое") или поставит ❤/😂.`;
  }
  if (isCold) {
    return `Доступные реакции (СТАДИЯ ХОЛОДНАЯ/конфликт — она дистанцируется):
- 👍 / 👌 — отстранённое подтверждение
- 😐 / 🙄 — раздражение
- 🤡 — на кринж от него
- 💀 — на полный треш от него
- 🤔 — недоумение
ЗАПРЕЩЕНО ставить: ❤, 🥰, 🥹, 🥺, 🔥 — это сигналы тепла, она его сейчас не даёт.`;
  }
  // нейтральная середина
  return `Доступные реакции (нейтральная стадия):
- 👍 / 👌 — ок, принято
- 😂 / 🤭 — на смешное
- 🤔 — задумалась
- 🔥 — если реально круто
- 🤡 — только на явный кринж и без злобы
- 😐 — устала
Не ставь ❤/🥰 пока стадия не warming или выше — это палево, рано ещё.`;
}

const TEMPLATE = (state: string, history: string, incoming: string, ctx: BehaviorContext, reactionsHint: string) => `Состояние:
${state}
${ctx.presence ? `\nПрисутствие: ${ctx.presence.online ? "онлайн" : "офлайн"}${ctx.presence.asleep ? ", СПИТ" : ""}${ctx.presence.nightAwake ? ", НОЧНОЕ ПРОБУЖДЕНИЕ (заспанная, коротко)" : ""} (локально ${ctx.presence.localHour}:00). ${ctx.presence.hint}` : ""}
${ctx.blockHint ? `\nЧто сейчас делает: ${ctx.blockHint}` : ""}
${ctx.activeDialog ? `\nАКТИВНЫЙ ДИАЛОГ: она уже недавно ответила, а он написал в течение нескольких минут. Продолжай переписку, не уходи в случайный игнор без веской причины.` : ""}
${ctx.conflict && ctx.conflict.level > 0 ? `\nКонфликт: level ${ctx.conflict.level}, ${ctx.conflictColdActive ? "АКТИВНЫЙ cold-период (молчит/игнорит)" : "после-конфликтный осадок"}, причина: ${ctx.conflict.reason ?? "—"}` : ""}

Последние сообщения (последнее — от него):
${history}

НОВОЕ сообщение от него:
"""${incoming}"""

${reactionsHint}

Реши и верни СТРОГО JSON:
{
  "intent": "reply" | "ignore" | "short" | "left-on-read" | "leave-chat" | "reaction-only",
  "shouldReply": boolean,
  "shouldRead": boolean (даже если не отвечает, прочитать и поставить галочки? left-on-read=false, ignore=true если она зашла и прочитала),
  "delaySec": число (0..3600 секунд. Если она офлайн/занята/конфликт — большие задержки нормальны. Если активный диалог — маленькие.),
  "bubbles": число (1..6),
  "typing": boolean,
  "reaction": "" или ОДИН эмодзи из доступного списка выше. Не из запрещённого!,
  "ignoreReason": строка или "",
  "moodDelta": { "interest": число, "trust": число, "attraction": число, "annoyance": число, "cringe": число }
}

Правила:
- Если cold-period конфликта АКТИВЕН — почти всегда ignore или сухой short ответ. Ни ❤, ни ")".
- Если она СПИТ — ignore или left-on-read (shouldRead=false). Если энергично написал ночью — может разозлить (annoyance +).
- Если она занята по presence — не отвечай сразу; если сообщение в целом заслуживает ответа, ставь shouldReply=true и большой delaySec, runtime дотянет его до времени когда она освободится и проверит Telegram.
- Если она офлайн (не спит) — допустимо высокое delaySec (300-2400с) И normal reply, либо ignore с shouldRead=true (она зашла, прочитала, но ответит позже).
- Если communication.notifications=priority — она чаще видит именно его уведомления; без сна/конфликта не превращай каждое офлайн-состояние в игнор.
- Если communication.messageStyle=bursty — bubbles 2..5 нормальны даже на обычный ответ. Если one-liners — bubbles чаще 1.
- Если communication.lifeSharing=high — уместно чаще выбрать normal reply, где она может поделиться своим моментом из жизни.
- В русскоязычном Telegram одиночная ")" в конце ЕГО сообщения обычно означает улыбку/лёгкую теплоту, а не холод и не "неинтересно". Не повышай annoyance/cringe только из-за ")".
- Если стадия "tg-given-cold" и сообщение скучное/невнятное — высокая вероятность ignore или left-on-read.
- Если в сообщении кринж/токсик/нарушение boundaries — annoyance растёт, может быть ignore или leave-chat.
- Если милое/уместное на тёплой стадии — interest и attraction +.
- Длинная простыня от него — bubbles её ответа НЕ становится больше; скорее наоборот.
- moodDelta: маленькие числа -10..+10.
- Реакции — реальные девушки 2026 чаще ставят TG-реакцию чем эмодзи в текст. Если сообщение цепануло, а отвечать не хочется — "intent":"reaction-only", "shouldReply":false, "reaction":"...". По умолчанию reaction="".
- ВАЖНО: реакция должна соответствовать её отношению. Влюблённая НЕ ставит 🤡 на мем — она поставит 😂/❤ или мило посмеётся текстом. Холодная НЕ ставит ❤.
- НЕ оборачивай в markdown. Только JSON.`;

export async function behaviorTick(
  llm: LLMClient,
  cfg: ProfileConfig,
  recentHistory: { role: "user" | "assistant"; content: string }[],
  incoming: string,
  ctx: BehaviorContext = {}
): Promise<BehaviorTickResult> {
  const stage = findStage(cfg.stage);
  const rel = await readRelationship(cfg.slug);
  const communication = normalizeCommunicationProfile(cfg);
  const ignoreTendency = normalizeIgnoreTendency(cfg.ignoreTendency);
  const state = `stage=${cfg.stage} (${stage.label})\nscore=${JSON.stringify(rel.score)}\nbase_ignore=${stage.defaults.ignoreChance}\nbase_delay=${stage.defaults.replyDelaySec.join("..")}s\n${communicationDecisionState(communication)}\n${ignoreTendencyPrompt(ignoreTendency)}`;
  const reactionsHint = reactionMenu(cfg.stage, rel.score);

  const history = recentHistory.slice(-8)
    .map(m => `${m.role === "user" ? "он" : "она"}: ${m.content}`).join("\n");

  if (ctx.activeDialog && !ctx.conflictColdActive) {
    const bubbles = sampleBubbles(communication, true);
    return {
      shouldReply: true,
      shouldRead: true,
      delaySec: clamp(activeDialogDelay(communication), 2, 180),
      bubbles,
      typing: true,
      ignoreReason: undefined,
      moodDelta: { interest: 1 },
      intent: bubbles > 1 || communication.messageStyle !== "one-liners" ? "reply" : "short"
    };
  }

  // базовая защита: если cold-период активный — обходим LLM, сразу ignore с шансом 80%
  if (ctx.conflictColdActive && Math.random() < 0.8) {
    return {
      shouldReply: false,
      shouldRead: false,
      delaySec: 0,
      bubbles: 1,
      typing: false,
      ignoreReason: "conflict-cold",
      moodDelta: {},
      intent: "ignore"
    };
  }

  // warm vibe — снижает шанс случайного игнора
  const ignoreMul = ignoreMultiplier(communication, ignoreTendency);

  // если СПИТ — игнор почти всегда
  const sleepIgnoreMul = communication.notifications === "priority" ? 0.8 : communication.notifications === "muted" ? 1 : 0.9;
  if (ctx.presence?.asleep && !ctx.presence.nightAwake && Math.random() < 0.85 * sleepIgnoreMul) {
    return {
      shouldReply: false,
      shouldRead: false,
      delaySec: 0,
      bubbles: 1,
      typing: false,
      ignoreReason: "asleep",
      moodDelta: {},
      intent: "left-on-read"
    };
  }

  // НОЧНОЕ ПРОБУЖДЕНИЕ: медленно, коротко, может снова заснуть
  if (ctx.presence?.nightAwake) {
    // 15% шанс просто игнорировать — снова уснула (снижено с 40%)
    if (Math.random() < 0.15) {
      return {
        shouldReply: false,
        shouldRead: false,
        delaySec: 0,
        bubbles: 1,
        typing: false,
        ignoreReason: "night-fell-asleep",
        moodDelta: { annoyance: 5 },
        intent: "ignore"
      };
    }
    // Иначе ответ — но короткий и медленный
    const parsed = await llm.chat(
      [{ role: "system", content: SYS }, { role: "user", content: TEMPLATE(state, history, incoming, ctx, reactionsHint) }],
      { temperature: 0.7, maxTokens: 3500, json: true }
    );
    const result = JSON.parse(parsed);
    return {
      shouldReply: true,
      shouldRead: true,
      delaySec: clamp(result.delaySec ?? 20, 10, 120),
      bubbles: 1,
      typing: result.typing ?? true,
      ignoreReason: undefined,
      moodDelta: result.moodDelta || { annoyance: 3 },
      intent: "short",
      reaction: undefined
    };
  }

  try {
    const raw = await llm.chat(
      [{ role: "system", content: SYS }, { role: "user", content: TEMPLATE(state, history, incoming, ctx, reactionsHint) }],
      { temperature: 0.7, maxTokens: 3500, json: true }
    );
    const parsed = JSON.parse(raw);

    // Sanitize реакцию по правилам warm/cold
    let reaction: string | undefined = typeof parsed.reaction === "string" && parsed.reaction.length > 0 && parsed.reaction.length <= 4
      ? parsed.reaction : undefined;
    if (reaction) {
      reaction = sanitizeReaction(reaction, cfg.stage, rel.score);
    }

    let intent = parsed.intent || "reply";
    let shouldReply = !!parsed.shouldReply && intent !== "ignore" && intent !== "left-on-read" && intent !== "reaction-only";
    let delaySec = parsed.delaySec ?? 30;
    let bubbles = parsed.bubbles ?? sampleBubbles(communication, false);

    if (!shouldReply && canRecoverReply(cfg.stage, rel.score, ctx) && Math.random() < recoverReplyChance(communication, rel.score, ignoreTendency)) {
      shouldReply = true;
      intent = communication.messageStyle === "one-liners" ? "short" : "reply";
      delaySec = recoverDelay(communication, ctx);
      bubbles = sampleBubbles(communication, false);
    }

    delaySec = adjustDelay(delaySec, communication, ctx);
    bubbles = normalizeBubbles(bubbles, communication, intent, ctx.activeDialog);

    return {
      shouldReply,
      shouldRead: parsed.shouldRead ?? true,
      delaySec,
      bubbles,
      typing: parsed.typing ?? true,
      ignoreReason: parsed.ignoreReason || undefined,
      moodDelta: parsed.moodDelta || {},
      intent,
      reaction
    };
  } catch {
    const ignore = Math.random() < stage.defaults.ignoreChance * ignoreMul;
    const [lo, hi] = stage.defaults.replyDelaySec;
    return {
      shouldReply: !ignore,
      shouldRead: true,
      delaySec: adjustDelay(lo + Math.random() * (hi - lo), communication, ctx),
      bubbles: sampleBubbles(communication, false),
      typing: true,
      moodDelta: {},
      intent: ignore ? "ignore" : "reply"
    };
  }
}

function sanitizeReaction(emoji: string, stage: string, score: { attraction: number; annoyance: number }): string | undefined {
  const isWarm = score.attraction > 30 || ["dating-early", "dating-stable", "long-term"].includes(stage);
  const isCold = score.annoyance > 40 || stage === "tg-given-cold";
  const FORBIDDEN_WHEN_WARM = new Set(["🤡", "💀", "🤮", "🖕", "😐", "🙄"]);
  const FORBIDDEN_WHEN_COLD = new Set(["❤", "❤️", "🥰", "🥹", "🥺", "🔥"]);
  if (isWarm && FORBIDDEN_WHEN_WARM.has(emoji)) {
    // подменяем на адекватную тёплую
    return ["😂", "❤", "🥹"][Math.floor(Math.random() * 3)];
  }
  if (isCold && FORBIDDEN_WHEN_COLD.has(emoji)) {
    return ["👍", "😐", "🤔"][Math.floor(Math.random() * 3)];
  }
  return emoji;
}

function ignoreMultiplier(profile: CommunicationProfile, ignoreTendency: number): number {
  let mul = profile.notifications === "priority" ? 0.3 : profile.notifications === "muted" ? 1.15 : 0.75;
  if (profile.initiative === "high") mul *= 0.75;
  if (profile.lifeSharing === "high") mul *= 0.85;
  if (profile.messageStyle === "one-liners" && profile.initiative === "low") mul *= 1.15;
  mul *= 0.35 + normalizeIgnoreTendency(ignoreTendency) / 35;
  return mul;
}

function activeDialogDelay(profile: CommunicationProfile): number {
  const base = profile.notifications === "priority" ? 3 : profile.notifications === "muted" ? 18 : 8;
  const spread = profile.messageStyle === "one-liners" ? 55 : profile.messageStyle === "bursty" ? 25 : 40;
  return base + Math.random() * spread;
}

function sampleBubbles(profile: CommunicationProfile, activeDialog: boolean): number {
  const r = Math.random();
  if (profile.messageStyle === "one-liners") return activeDialog && r > 0.82 ? 2 : 1;
  if (profile.messageStyle === "bursty") {
    if (activeDialog) return 2 + Math.floor(Math.random() * 4);
    return r < 0.18 ? 1 : 2 + Math.floor(Math.random() * 3);
  }
  if (profile.messageStyle === "longform") {
    if (activeDialog) return r < 0.2 ? 1 : 2 + Math.floor(Math.random() * 2);
    return r < 0.45 ? 1 : 2;
  }
  if (activeDialog) return r < 0.3 ? 1 : r < 0.82 ? 2 : 3;
  return r < 0.55 ? 1 : r < 0.9 ? 2 : 3;
}

function canRecoverReply(stage: string, score: { interest: number; attraction: number; annoyance: number }, ctx: BehaviorContext): boolean {
  if (stage === "dumped") return false;
  if (ctx.conflictColdActive) return false;
  if (ctx.presence?.asleep && !ctx.presence.nightAwake) return false;
  if (score.annoyance > 65) return false;
  if (stage === "tg-given-cold" && score.interest < 20 && score.attraction < 20) return false;
  return true;
}

function recoverReplyChance(profile: CommunicationProfile, score: { interest: number; attraction: number; annoyance: number }, ignoreTendency: number): number {
  let chance = profile.notifications === "priority" ? 0.72 : profile.notifications === "muted" ? 0.16 : 0.38;
  if (profile.initiative === "high") chance += 0.16;
  if (profile.initiative === "low") chance -= 0.1;
  if (profile.lifeSharing === "high") chance += 0.08;
  chance -= (normalizeIgnoreTendency(ignoreTendency) - 35) / 100;
  if (score.interest > 40) chance += 0.12;
  if (score.attraction > 50) chance += 0.1;
  if (score.annoyance > 30) chance -= 0.2;
  return clamp(chance, 0.03, 0.95);
}

function recoverDelay(profile: CommunicationProfile, ctx: BehaviorContext): number {
  if (ctx.activeDialog) return activeDialogDelay(profile);
  if (ctx.presence?.online) return profile.notifications === "priority" ? 5 + Math.random() * 55 : 15 + Math.random() * 120;
  if (ctx.presence?.notificationSeen) return profile.notifications === "priority" ? 30 + Math.random() * 210 : 120 + Math.random() * 600;
  return profile.notifications === "priority" ? 180 + Math.random() * 600 : 300 + Math.random() * 1500;
}

function adjustDelay(delaySec: number, profile: CommunicationProfile, ctx: BehaviorContext): number {
  let delay = Number(delaySec) || 30;
  if (profile.notifications === "priority") delay *= 0.45;
  else if (profile.notifications === "normal") delay *= 0.8;
  else delay *= 1.15;
  if (profile.initiative === "high") delay *= 0.85;
  if (ctx.activeDialog) delay = Math.min(delay, activeDialogDelay(profile) + 20);
  if (ctx.presence?.online) delay = Math.min(delay, profile.notifications === "priority" ? 120 : 240);
  if (ctx.presence?.notificationSeen) delay = Math.min(delay, profile.notifications === "priority" ? 300 : 900);
  return clamp(delay, 0, 3600);
}

function normalizeBubbles(value: number, profile: CommunicationProfile, intent: string, activeDialog?: boolean): number {
  if (intent === "short" || intent === "ignore" || intent === "left-on-read" || intent === "reaction-only") return 1;
  const sampled = Number.isFinite(Number(value)) ? Number(value) : sampleBubbles(profile, !!activeDialog);
  if (profile.messageStyle === "one-liners") return clamp(sampled, 1, activeDialog ? 2 : 1);
  if (profile.messageStyle === "bursty") return clamp(sampled, 1, 6);
  if (profile.messageStyle === "longform") return clamp(sampled, 1, 4);
  return clamp(sampled, 1, 3);
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, Number(n) || 0));
}
