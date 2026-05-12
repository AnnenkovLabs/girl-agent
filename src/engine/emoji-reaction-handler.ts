/**
 * Обработка эмодзи-реакций юзера на её сообщения (Issue #76 / Task #16).
 *
 * Подход максимально близкий к поведению живых девушек:
 *
 *  1) Токсичные эмодзи (💀 🤡 🤮 👎 🖕 💩 etc.) на её сообщения —
 *     реальные девушки в TG почти НИКОГДА не пишут "ты серьёзно?!" в ответ.
 *     Они тихо обижаются → annoyance/cringe растёт, можно похолодеть в текущем диалоге.
 *
 *  2) НО есть КОНТЕКСТ. Если её сообщение было про что-то токсичное/абсурдное
 *     ("на улице мужик подошёл орал на меня"), то 💀/🤡 от него — это
 *     СОГЛАСИЕ / реакция на ту ситуацию, а не на неё. Тут annoyance не растёт,
 *     можно даже мягко в плюс к interest.
 *
 *  3) Положительные эмодзи (❤ 😍 🔥 ...) — тёпло, иногда тёплый текст ответ
 *     или react-back, но редко. По умолчанию молча.
 *
 *  4) Юмор (😂 🤣) — иногда поддержать. Чаще молча.
 *
 *  5) Грустные (😢 🥺) — иногда заботливая короткая реплика.
 *
 *  6) Нейтральные (👍 👌 ✅) — почти всегда молча. По persona/initiative.
 *
 * Решение про "контекст токсичной эмодзи" определяется через LLM:
 *  → `isToxicReactionContextual(llm, herLastMessage, emoji)` возвращает true
 *    если эмодзи относится к содержанию её сообщения (третьим лицам/ситуации),
 *    false — если к ней лично.
 *
 * Этот модуль НЕ вызывает LLM сам — он лишь возвращает intent + контекст
 * для runtime, который при необходимости делает быстрый LLM-вызов.
 */

import type { LLMClient } from "../llm/index.js";
import type { CommunicationProfile, RelationshipScore, StageId } from "../types.js";

const TOXIC = new Set(["👎", "🤡", "💩", "🤮", "🖕", "💀"]);
const POSITIVE = new Set(["❤", "❤️", "😍", "🥰", "😘", "🔥", "👏", "💋", "🤗", "🥹"]);
const FUNNY = new Set(["😂", "🤣", "😆", "🤭"]);
const SAD = new Set(["😢", "😭", "🥺", "😔"]);
const NEUTRAL_THUMBS = new Set(["👍", "👌", "✅"]);

export type EmojiCategory = "toxic" | "positive" | "funny" | "sad" | "neutral";

export function categorizeEmoji(emoji: string): EmojiCategory {
  if (TOXIC.has(emoji)) return "toxic";
  if (POSITIVE.has(emoji)) return "positive";
  if (FUNNY.has(emoji)) return "funny";
  if (SAD.has(emoji)) return "sad";
  if (NEUTRAL_THUMBS.has(emoji)) return "neutral";
  return "neutral";
}

export type EmojiReactionIntent =
  | "ignore"            // полностью молчим, ничего не делаем
  | "silent-mood"       // молчим, но обновляем mood (annoyance/cringe или attraction)
  | "react-back"        // ставим свою TG-реакцию
  | "reply-text";       // редкий случай — пишем коротко текстом

export interface EmojiReactionDecisionCtx {
  emoji: string;
  removed?: boolean;
  stage: StageId;
  score: RelationshipScore;
  communication?: CommunicationProfile;
  /** Её последнее сообщение, на которое поставлена реакция. Нужно для контекста toxic-эмодзи. */
  herLastMessageText?: string;
  /** Был ли уже сделан LLM-контекстный вызов для toxic, и каков результат. */
  toxicContextResolved?: { aboutHerSelf: boolean };
}

export interface EmojiReactionDecision {
  intent: EmojiReactionIntent;
  /** Если react-back — какой эмодзи. */
  reactBackEmoji?: string;
  /** Изменения mood (для silent-mood). */
  moodDelta?: Partial<RelationshipScore>;
  /** Краткое описание ситуации для LLM, если intent="reply-text". */
  llmContext?: string;
  /** Для логирования. */
  reason: string;
  category: EmojiCategory;
  /** Если true — runtime должен сначала вызвать isToxicReactionContextual и пересобрать decision. */
  needsToxicContextCheck?: boolean;
}

export function decideEmojiReactionResponse(ctx: EmojiReactionDecisionCtx): EmojiReactionDecision {
  const cat = categorizeEmoji(ctx.emoji);

  // Снятие реакции — обычно игнорируем полностью.
  if (ctx.removed) {
    return { intent: "ignore", reason: "user removed reaction", category: cat };
  }

  // === ТОКСИЧНЫЕ ===
  if (cat === "toxic") {
    // Если контекст ещё не определён — просим runtime сделать дешёвый LLM-вызов.
    if (!ctx.toxicContextResolved) {
      return {
        intent: "silent-mood",
        moodDelta: {},
        reason: "toxic emoji: need contextual classification",
        category: cat,
        needsToxicContextCheck: true
      };
    }
    // Контекст определён.
    if (!ctx.toxicContextResolved.aboutHerSelf) {
      // Эмодзи к ситуации/третьему лицу, не к ней. Это согласие/эмоциональная поддержка.
      // Молча принимаем, лёгкий плюс к interest.
      return {
        intent: "ignore",
        moodDelta: { interest: 1 },
        reason: "toxic emoji about external context (agreement)",
        category: cat
      };
    }
    // Эмодзи направлен НА неё. Молча обижаемся, без театра.
    const sensitivityBoost = (ctx.communication?.notifications ?? "balanced") === "muted" ? 0 : 2;
    const moodDelta: Partial<RelationshipScore> = {
      annoyance: 4 + sensitivityBoost + Math.floor(Math.random() * 3),
      cringe: 2 + Math.floor(Math.random() * 3),
      attraction: -1,
      interest: -1
    };
    // ОЧЕНЬ редко — холодный текстовый коммент. И только на относительно тёплых стадиях,
    // где она достаточно вовлечена чтобы реагировать. На "tg-given-cold"/"dumped" — молчим.
    const coldText = canColdReplyToToxic(ctx);
    if (coldText && Math.random() < 0.08) {
      return {
        intent: "reply-text",
        llmContext: textReplyContextForToxic(ctx),
        moodDelta,
        reason: "rare cold reply to toxic about herself",
        category: cat
      };
    }
    return {
      intent: "silent-mood",
      moodDelta,
      reason: "toxic about her: silent annoyance",
      category: cat
    };
  }

  // === НЕ ТОКСИЧНЫЕ ===
  // По дефолту: silent + лёгкий tweak настроения (если позитив — interest+, если sad — interest+ но через заботу...).
  const baseChance = baseTextReplyChance(cat, ctx);
  if (Math.random() > baseChance) {
    // Не отвечаем текстом. Возможно react-back.
    if (cat === "positive" && shouldReactBack(ctx)) {
      const back = pickReactBack(cat);
      return {
        intent: "react-back",
        reactBackEmoji: back,
        moodDelta: { attraction: 1, interest: 1 },
        reason: "react-back on positive",
        category: cat
      };
    }
    // Просто фиксируем что внимание оценили.
    const moodDelta = passiveMoodFor(cat, ctx);
    return {
      intent: moodDelta ? "silent-mood" : "ignore",
      moodDelta,
      reason: `silent skip (chance=${baseChance.toFixed(2)})`,
      category: cat
    };
  }

  // Текстовый ответ редко.
  return {
    intent: "reply-text",
    llmContext: textReplyContextFor(cat, ctx),
    moodDelta: passiveMoodFor(cat, ctx),
    reason: `text reply (chance=${baseChance.toFixed(2)})`,
    category: cat
  };
}

function canColdReplyToToxic(ctx: EmojiReactionDecisionCtx): boolean {
  if (ctx.stage === "dumped") return false;
  if (ctx.stage === "tg-given-cold") return false;
  if (ctx.score.annoyance > 70) return false; // и так уже слишком злая
  return true;
}

function baseTextReplyChance(cat: EmojiCategory, ctx: EmojiReactionDecisionCtx): number {
  let chance = 0.08;
  const init = ctx.communication?.initiative ?? "medium";
  if (init === "high") chance += 0.1;
  if (init === "low") chance -= 0.04;
  const life = ctx.communication?.lifeSharing ?? "medium";
  if (life === "high") chance += 0.06;
  if (ctx.stage === "long-term" || ctx.stage === "dating-stable") chance += 0.04;
  if (ctx.stage === "met-irl-got-tg" || ctx.stage === "tg-given-cold") chance -= 0.07;
  if (cat === "funny") chance += 0.06;
  if (cat === "sad") chance += 0.04;
  if (cat === "neutral") chance -= 0.04;
  if (cat === "positive" && ctx.score.annoyance > 50) chance -= 0.07;
  return Math.max(0, Math.min(0.5, chance));
}

function shouldReactBack(ctx: EmojiReactionDecisionCtx): boolean {
  let chance = 0.22;
  if (ctx.stage === "dating-stable" || ctx.stage === "long-term") chance = 0.32;
  if (ctx.stage === "tg-given-cold" || ctx.stage === "met-irl-got-tg") chance = 0.08;
  return Math.random() < chance;
}

function pickReactBack(cat: EmojiCategory): string {
  if (cat === "positive") return ["❤", "🥰", "😘", "🤗"][Math.floor(Math.random() * 4)]!;
  if (cat === "funny") return ["😂", "🤣"][Math.floor(Math.random() * 2)]!;
  return "👍";
}

function passiveMoodFor(cat: EmojiCategory, ctx: EmojiReactionDecisionCtx): Partial<RelationshipScore> | undefined {
  if (cat === "positive") {
    if (ctx.score.annoyance > 50) return undefined; // когда злится — игнор не отепляет
    return { attraction: 1, interest: 1 };
  }
  if (cat === "funny") return { interest: 1 };
  if (cat === "sad") return { trust: 1 };
  return undefined;
}

function textReplyContextFor(cat: EmojiCategory, ctx: EmojiReactionDecisionCtx): string {
  const lines: string[] = [];
  lines.push("# СИТУАЦИЯ");
  lines.push(`Он поставил реакцию ${ctx.emoji} на твоё последнее сообщение.`);
  if (ctx.herLastMessageText) {
    lines.push(`Твоё сообщение было: "${ctx.herLastMessageText.slice(0, 200)}".`);
  }
  switch (cat) {
    case "positive":
      lines.push("Тёплая реакция. Можно мягко прокомментировать, подкатить ответно или развернуть мысль — по persona/speech/stage.");
      break;
    case "funny":
      lines.push("Засмеялся над твоим сообщением. Можно поддержать вайб, прислать ещё шутку или прокомментировать.");
      break;
    case "sad":
      lines.push("Загрустил/посочувствовал. Реагируй заботливо или поддерживающе по persona.");
      break;
    case "neutral":
      lines.push("Нейтральная реакция (👍 / 👌). Если хочется — прокомментируй одним коротким сообщением.");
      break;
    default:
      lines.push("Реакция. Прокомментируй живо.");
  }
  lines.push("");
  lines.push("Сформируй 1 короткий пузырь (максимум 2). Без мета-комментариев, без объяснений механики реакций.");
  return lines.join("\n");
}

function textReplyContextForToxic(ctx: EmojiReactionDecisionCtx): string {
  const lines: string[] = [];
  lines.push("# СИТУАЦИЯ");
  lines.push(`Он поставил реакцию ${ctx.emoji} на твоё последнее сообщение, и это явно про ТЕБЯ лично, не про какую-то ситуацию из твоего рассказа.`);
  if (ctx.herLastMessageText) {
    lines.push(`Твоё сообщение было: "${ctx.herLastMessageText.slice(0, 200)}".`);
  }
  lines.push("Реальная девушка такое тихо обижается, не закатывает истерик. Один короткий сухой/холодный/обиженный пузырь по своей persona/speech. Например: 'ну ок', 'класс.', 'и тебе того же', '...', 'спасибо.', 'я тебя поняла'. Можно и просто молча игнорить — но ты решила что один пузырь стоит.");
  lines.push("");
  lines.push("ОДИН короткий пузырь. Без объяснений, без 'ты что серьёзно?!', без театра.");
  return lines.join("\n");
}

/**
 * Anti-flood: если юзер меняет реакции 5+ раз в минуту — игнорируем.
 */
export function shouldThrottleEmojiReactions(recentReactionsCount: number): boolean {
  return recentReactionsCount > 4;
}

/**
 * Контекстная проверка для toxic-эмодзи: эмодзи направлен на НЕЁ или
 * на ситуацию/третьих лиц из её рассказа?
 *
 * Возвращает true если про неё лично (обидно), false если про контекст.
 *
 * Дешёвый LLM-вызов, json-режим, маленький температурный.
 */
export async function isToxicReactionAboutHerSelf(
  llm: LLMClient,
  herLastMessageText: string,
  emoji: string
): Promise<boolean> {
  if (!herLastMessageText.trim()) return true; // нет контекста — считаем что про неё
  try {
    const raw = await llm.chat([
      {
        role: "system",
        content: `Ты классификатор контекста. Девушка написала сообщение, парень поставил на него токсичную эмодзи-реакцию (${emoji}). Реши: эмодзи направлен НА НЕЁ лично (обидно), или на содержание её рассказа (третьих лиц, ситуации, абсурд)?

Примеры:
- "сделала маникюр" + 💀 → ABOUT_HER (унижение)
- "на улице мужик пьяный орал на меня" + 💀 → ABOUT_CONTEXT (про мужика)
- "пересдала экзамен" + 🤡 → ABOUT_HER (унижение)
- "коллега 5 раз облажалась с отчётом" + 🤡 → ABOUT_CONTEXT (про коллегу)
- "опять не выспалась" + 💀 → ABOUT_HER (про неё)
- "видела как мужик с самокатом упал прям в лужу" + 💀 → ABOUT_CONTEXT (про мужика)

Верни СТРОГО JSON: {"aboutHer": boolean, "confidence": 0..1}.`
      },
      { role: "user", content: `Её сообщение: """${herLastMessageText.slice(0, 600)}"""\nЕго эмодзи-реакция: ${emoji}` }
    ], { temperature: 0.1, maxTokens: 80, json: true });
    const parsed = JSON.parse(raw);
    return parsed?.aboutHer !== false;
  } catch {
    // Fallback: если эмодзи явно негативный И её сообщение похоже на нейтральное про себя — обидно.
    // По умолчанию считаем что про неё (более безопасно для эмоционального состояния).
    return true;
  }
}
