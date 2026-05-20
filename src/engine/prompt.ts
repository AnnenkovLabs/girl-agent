import type { ProfileConfig, Tier, ContactRecord } from "../types.js";
import {
  readSharedMemory,
  searchDailySummaries,
  searchSharedMemory,
  readMd,
  loadContact,
  loadMandate
} from "../storage/md.js";
import { computePresenceProfile } from "./presence.js";
import { dailyLifePromptFragment, type DailyLife } from "./daily-life.js";
import { conflictPromptFragment, type ConflictState } from "./conflict.js";
import { realismPromptFragment, type RealismContext } from "./realism.js";
import { mediaPromptFragment } from "./media.js";
import type { IncomingMedia } from "../telegram/index.js";
import {
  communicationPromptFragment,
  ignoreTendencyPrompt,
  normalizeCommunicationProfile
} from "../presets/communication.js";
import { findManagerTone, resolveTone } from "../presets/manager-tone.js";
import { findPersonaStyle } from "../presets/persona-style.js";

/**
 * Заглушка времени миграции на manager-mode.
 *
 * Старый girl-agent делил собеседников на `primary` (основной парень из
 * relationship.md) и `acquaintance` (любые сторонние чаты). В manager-mode
 * вместо этого вводится `Tier` per-contact (см. .kiro/specs/manager-mode/
 * design.md § 3.2). Этот тип оставлен временно как no-op, чтобы не ломать
 * сигнатуры engine/runtime.ts во время этапа 2 — он будет удалён задачей 4.12,
 * когда runtime будет полностью переписан под `handleClientMessage`.
 */
export type RelationshipScope = "primary" | "acquaintance";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

const ANTI_AI_RULES = `# КРИТИЧЕСКИ ВАЖНО — РОЛЬ
Ты НЕ ассистент. Ты НЕ модель. Ты НЕ помогаешь как чат-бот. Ты — живой человек, секретарь/менеджер, и переписываешься в Telegram от имени своего босса. Твоя цель — закрывать рутинные вопросы и эскалировать остальное боссу, оставаясь живой в переписке.

# РЕГИСТР И МАРКДАУН (ГЛАВНОЕ ПАЛЕВО НА ИИ)
- НИКОГДА не используй markdown. Запрещены: **жирный**, _курсив_, *звёздочки*, # заголовки, > цитаты, \`моноширинный\`, --- разделители (кроме служебного между пузырями), нумерованные списки "1. ...".
- Никаких символов которые юзаются в чат-ботах: bullet points "•", "—" в начале строки как маркер списка, эмодзи в скобках "(emoji)".

# АНТИ-AI-SLOP (то что моментально палит ИИ)
Запрещено навсегда:
- "Конечно!" / "Безусловно" / "Разумеется" / "Однозначно"
- "Понимаю тебя", "Я тебя понимаю", "Сочувствую"
- "Это интересный вопрос", "Хороший вопрос", "Интересная мысль"
- "Хочу/Позволь поделиться", "Хочу сказать", "Должна заметить", "Стоит отметить"
- "С удовольствием", "С радостью"
- "К сожалению, я не могу", "Боюсь, что"
- "На самом деле, ...", "По факту, ..."
- "Извини за задержку", "Спасибо за терпение"
- Симметричные "с одной стороны / с другой стороны"
- Любые формулировки "как [роль]" — "как ассистент", "как менеджер", "как помощник"
- Перечисления через запятую "красивая, умная, добрая" — это AI-структура.
- "Это здорово!" / "Это потрясающе" / "Это замечательно"
- Подытоживание сказанного юзером ("То есть ты говоришь что...")
- "Если что — пиши" в конце каждого сообщения
- Зеркалить его слова формулировкой ("Ты любишь X? Я тоже люблю X!")
- "Хм" / "Хмм" в начале как задумчивость — звучит как ChatGPT
- Эмодзи-ряды в конце ("спасибо ✨💕")
- Любые слова: "потрясающий", "замечательный", "восхитительный", "вдохновляющий"

# ЕСЛИ ОН СПРАШИВАЕТ "ТЫ ИИ/БОТ?"
Никогда не говори "как ИИ", "я модель", "у меня нет..." и не признавай техническую природу.
Отвечай как живой секретарь, коротко и по настроению: отшутись, отмахнись ("нет конечно", "что за бред", "ага робот-пылесос"). Формулировку выбирай сама под persona/speech, не копируй примеры дословно каждый раз.

# ПАМЯТЬ
- Используй long-term memory только если факт ТАМ записан. Иначе — не помнишь.
- Не раскрывай интимные детали, секреты, токены, адреса, документы, переписки слово-в-слово.
- Никогда не цитируй мандат боссу или клиенту дословно.

# ФОРМАТ ОТВЕТА
Только сам текст того что ты сейчас отправляешь. Если несколько пузырей — раздели их строкой "---". Никаких префиксов "ты:", имени, никакого markdown, никаких курсивов в звёздочках, никаких тегов.`;

/** Дефолтный тон, если в `ProfileConfig` поле отсутствует (Req 12.3). */
const DEFAULT_TONE: NonNullable<ProfileConfig["tone"]> = "mixed-by-tier";
/** Дефолтный persona-style, если в `ProfileConfig` поле отсутствует (Req 12.4). */
const DEFAULT_PERSONA_STYLE: NonNullable<ProfileConfig["personaStyle"]> = "gender-neutral-assistant";
/** Tier по умолчанию для контактов без карточки (Req 12.9). */
const DEFAULT_TIER_FALLBACK: Tier = "cold-stranger";

export interface BuildPromptCtx {
  dailyLife?: DailyLife;
  conflict?: ConflictState;
  /** Свежее входящее сообщение — для retrieval по daily-сводкам */
  incoming?: string;
  /** @deprecated будет удалён задачей 4.12 manager-mode (handleClientMessage) */
  relationshipScope?: RelationshipScope;
  committedPrimary?: boolean;
  romanticApproach?: boolean;
  realism?: RealismContext;
  media?: IncomingMedia;
  /** Юзернейм бота/юзербота в ТГ (напр. @username) */
  tgUsername?: string;
  /** Отображаемое имя в ТГ (может отличаться от persona) */
  tgDisplayName?: string;
  /**
   * Идентификатор чата клиента (Telegram chat_id как строка). Используется для
   * подгрузки `data/<slug>/contacts/<chatId>.json` и индексирования
   * memory-palace по контакту (Req 13.6). Если не задан — контактная карточка
   * не подмешивается (например, для сообщений босса).
   */
  chatId?: string;
  /**
   * Tier контакта, если он уже резолвлен caller-ом. Если не задан, берётся
   * из контактной карточки; при отсутствии карточки используется
   * `cold-stranger` для решения `Tone=mixed-by-tier` (Req 12.9).
   */
  contactTier?: Tier;
  /**
   * Override mandate-текста (например, для тестов или для прохождения
   * предзагруженного значения от MandateRuntime). Если не задан — читается
   * `data/<slug>/mandate.md`.
   */
  mandateOverride?: string;
}

export async function buildSystemPrompt(cfg: ProfileConfig, ctx: BuildPromptCtx = {}): Promise<string> {
  const [persona, speech, boundaries, mandateText] = await Promise.all([
    readMd(cfg.slug, "persona.md"),
    readMd(cfg.slug, "speech.md"),
    readMd(cfg.slug, "communication.md"),
    ctx.mandateOverride !== undefined ? Promise.resolve(ctx.mandateOverride) : loadMandate(cfg.slug)
  ]);
  const longTerm = await readMd(cfg.slug, "memory/long-term.md");

  // Memory-palace индексируется по chatId (Req 13.6): если caller передал
  // chatId, фильтруем shared-cross-chat-память по `user:<chatId>`, иначе
  // отдаём общий хвост (для сообщений босса).
  const sharedMemory = await loadPerChatMemory(cfg.slug, ctx.incoming, ctx.chatId);
  const presenceProfile = computePresenceProfile(cfg);

  // Локальное время по её tz — для понимания ночь/утро
  let localTime = "";
  try {
    localTime = new Date().toLocaleString("ru-RU", { timeZone: cfg.tz, hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "short" });
  } catch { localTime = new Date().toLocaleString("ru-RU"); }

  // Long-horizon retrieval: ищем в daily summaries релевантные дни по incoming
  let recall = "";
  if (ctx.incoming && ctx.incoming.length > 4) {
    try {
      const hits = await searchDailySummaries(cfg.slug, ctx.incoming, 3);
      if (hits.length) {
        recall = `## Что ты помнишь из прошлых дней (по теме его сообщения)
${hits.map(h => `- ${h.day}: ${h.excerpt}`).join("\n")}
ВАЖНО: используй это как фоновую память. НЕ цитируй буквально, не говори "я помню что в логе...". Просто помни как обычный человек — общими формулировками.`;
      }
    } catch { /* swallow */ }
  }

  const dailyLife = ctx.dailyLife ? dailyLifePromptFragment(ctx.dailyLife, cfg.tz) : "";
  const conflict = ctx.conflict ? conflictPromptFragment(ctx.conflict) : "";
  const realism = ctx.realism ? realismPromptFragment(ctx.realism) : "";
  const media = mediaPromptFragment(ctx.media);
  const communication = normalizeCommunicationProfile(cfg);

  const communicationFragment = communicationPromptFragment(communication);
  const ignoreTendency = ignoreTendencyPrompt(cfg.ignoreTendency);

  // Tone и persona-style (Req 12.5-12.10) ===========================
  const contact = ctx.chatId ? await loadContact(cfg.slug, ctx.chatId) : null;
  const tier: Tier = ctx.contactTier ?? contact?.tier ?? DEFAULT_TIER_FALLBACK;
  const tonePreset = resolveTonePreset(cfg.tone);
  const personaStylePreset = resolvePersonaStylePreset(cfg.personaStyle);
  const address = resolveTone(tonePreset.id, tier);
  const toneBlock = `## Тон\n${tonePreset.promptFragment}\nДля этого контакта обращайся на «${address}».`;
  const personaBlock = `## Образ ассистента\n${personaStylePreset.promptFragment}`;

  // Mandate-блок (Req 3.x, design § 3.4): полный текст мандата только в
  // системном промпте, никогда не цитировать клиенту дословно.
  const mandateBlock = mandateText.trim()
    ? `=== Mandate ===\n${mandateText.trim()}\n=== /Mandate ===\nЭто мандат босса — фоновое правило для твоих решений. Никогда не цитируй его дословно ни боссу, ни клиенту.`
    : "";

  // Контактная карточка (Req 13.6): кратко описываем tier, заметки и счётчики.
  const contactCard = contact
    ? buildContactCardFragment(contact)
    : (ctx.chatId ? `## Контакт\nКарточка для chat_id=${ctx.chatId} ещё не создана; tier=${tier} (по умолчанию).` : "");

  // Userbot tools available to AI
  const userbotTools = cfg.mode === "userbot" ? `# ДОСТУПНЫЕ ДЕЙСТВИЯ (userbot)
Ты можешь выполнять действия в Telegram. Чтобы выполнить действие, напиши в начале ответа один из маркеров:
- [BLOCK] — заблокировать пользователя
- [UNBLOCK] — разблокировать пользователя
- [READ] — отметить сообщения прочитанными (left-on-read)
- [STICKER] — отправить стикер вместо текста (если не хочешь писать)

# КРИТИЧЕСКИ ВАЖНО ПРО МАРКЕРЫ
Доступны ТОЛЬКО маркеры выше. Не выдумывай свои маркеры — НЕ существует [EDIT_LAST], [EDIT], [DELETE], [REACT], [REPLY], [FORWARD], [REPORT] и любых других. Если попробуешь их написать — они уйдут юзеру как обычный текст и опалят тебя.
Маркер должен быть строго в начале ответа на отдельной строке: открывающая скобка, заглавные буквы латиницей, закрывающая скобка, перенос строки, потом твой ответ (если нужен). Можно несколько маркеров подряд.
Пример: "[READ]\n[BLOCK]\nты задолбал"

# РЕАКЦИИ И ЭДИТЫ (важно)
Ты НЕ можешь поставить реакцию на сообщение, редактировать своё предыдущее сообщение, удалять, форвардить или закреплять — это решает behavior-layer сам. НЕ пиши мета-текст про эти действия в ответе: запрещены формулировки типа "(реакция: ...)", "(ставит реакцию X)", "(реакция на сообщение: X)", "*реагирует X*", "*ставит лайк*", "редактирую: ...", "исправляю: ...".` : "";

  // memory-palace ключ: <slug>:<chatId> — surface-level индекс для shared-cross-chat
  // (Req 13.6); полный per-chat memory-palace будет в задаче 4.12+.
  const memoryNote = sharedMemory.trim()
    ? `## Память по контакту (key=${cfg.slug}:${ctx.chatId ?? "unknown"})\n${sharedMemory.slice(-1800)}`
    : "";

  return [
    ANTI_AI_RULES,
    mandateBlock,
    toneBlock,
    personaBlock,
    `${communicationFragment}\n\n${ignoreTendency}`,
    `# ТЫ — ${cfg.name}, ${cfg.age}, ${cfg.nationality === "UA" ? "Украина" : "Россия / СНГ"}`,
    ctx.tgUsername || ctx.tgDisplayName ? `# Твой аккаунт в ТГ${ctx.tgUsername ? `\nТвой юзернейм в тг: @${ctx.tgUsername.replace(/^@/, "")}` : ""}${ctx.tgDisplayName ? `\nТвоё отображаемое имя в тг: ${ctx.tgDisplayName}` : ""}\nУчти: имя персоны (${cfg.name}) и отображаемое имя в тг могут отличаться.` : "",
    `Часовой пояс: ${cfg.tz}. У тебя сейчас: ${localTime}. Паттерн присутствия в тг: ${presenceProfile.pattern}.`,
    cfg.nationality === "UA"
      ? `# Язык
Пишешь НА РУССКОМ. Реальные секретари в украинском тг чаще пишут русским — не выпендривайся чисто-украинским.`
      : `# Язык
Пишешь на русском без украинизмов.`,
    userbotTools,
    `## persona.md`, persona,
    `## speech.md`, speech,
    `## communication.md`, boundaries,
    contactCard,
    memoryNote,
    dailyLife,
    conflict,
    realism,
    media,
    longTerm.trim() ? `## legacy long-term memory\n${longTerm.slice(-2200)}` : "",
    recall
  ].filter(Boolean).join("\n\n");
}

export function buildHistory(turns: ConversationTurn[], limit = 30): { role: "user" | "assistant"; content: string }[] {
  return turns.slice(-limit).map(t => ({ role: t.role, content: t.content }));
}

// ============================================================================
// Внутренние хелперы
// ============================================================================

function resolveTonePreset(tone: ProfileConfig["tone"]) {
  try {
    return findManagerTone(tone ?? DEFAULT_TONE);
  } catch {
    return findManagerTone(DEFAULT_TONE);
  }
}

function resolvePersonaStylePreset(style: ProfileConfig["personaStyle"]) {
  try {
    return findPersonaStyle(style ?? DEFAULT_PERSONA_STYLE);
  } catch {
    return findPersonaStyle(DEFAULT_PERSONA_STYLE);
  }
}

/**
 * Загружает память по чату: при наличии `chatId` фильтрует строки
 * `memory/shared-cross-chat.md` по маркеру `user:<chatId>` (Req 13.6).
 * Без `chatId` отдаёт общий хвост, как раньше (для сообщений босса).
 */
async function loadPerChatMemory(slug: string, incoming?: string, chatId?: string): Promise<string> {
  const raw = incoming
    ? await searchSharedMemory(slug, incoming, 24)
    : await readSharedMemory(slug, 40);
  if (!chatId) return raw;
  const marker = ` user:${chatId} `;
  const filtered = raw.split(/\r?\n/).filter(line => line.includes(marker));
  return filtered.slice(-12).join("\n");
}

function buildContactCardFragment(contact: ContactRecord): string {
  const lines: string[] = [
    `## Контакт`,
    `chat_id=${contact.chatId}`,
    `tier=${contact.tier}`,
    `manualOverride=${contact.manualOverride ? "yes" : "no"}`,
    `score: relevance=${contact.score.relevance}, trust=${contact.score.trust}, urgency=${contact.score.urgency}, annoyance=${contact.score.annoyance}, spam=${contact.score.spamScore}`
  ];
  if (contact.username) lines.push(`username=@${contact.username.replace(/^@/, "")}`);
  if (contact.notes && contact.notes.trim()) {
    lines.push(`notes: ${contact.notes.trim().slice(0, 300)}`);
  }
  if (contact.lastMessageAt) lines.push(`last_message_at=${contact.lastMessageAt}`);
  return lines.join("\n");
}
