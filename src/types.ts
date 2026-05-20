export type ClientMode = "bot" | "userbot";

export type LLMProto = "openai" | "anthropic";

export type PrivacyMode = "owner-only" | "allow-strangers";

export type Nationality = "RU" | "UA";

export interface TelegramProxyConfig {
  ip: string;
  port: number;
  socksType?: 4 | 5;
  MTProxy?: true;
  secret?: string;
  username?: string;
  password?: string;
  timeout?: number;
}

export interface LLMPreset {
  id: string;
  name: string;
  proto: LLMProto;
  baseURL?: string;
  defaultModel: string;
  defaultApiKey?: string;
  apiKeyRequired?: boolean;
  models?: string[];
  custom?: boolean;
  hint?: string;
  recommended?: boolean;
  /** Preset supports OAuth login as alternative to API key */
  oauth?: boolean;
  /** Provider временно недоступен — отображаем в списке как readonly. */
  disabled?: boolean;
  /** Причина дизейбла (показывается в UI). */
  disabledReason?: string;
}

export interface MCPPreset {
  id: string;
  name: string;
  description: string;
  ready: boolean; // false = coming soon slot
  /** prompts user for these key/value secrets */
  secrets?: { key: string; label: string }[];
  /** how to spawn the MCP server (stdio) */
  spawn?: (secrets: Record<string, string>) => { command: string; args: string[]; env?: Record<string, string> };
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface BusySlot {
  label: string;
  days?: Weekday[];
  from: string;
  to: string;
  checkAfterMin?: [number, number];
}

export type NotificationMode = "muted" | "normal" | "priority";

export type MessageStyle = "one-liners" | "balanced" | "bursty" | "longform";

export type InitiativeLevel = "low" | "medium" | "high";

export type LifeSharingLevel = "low" | "medium" | "high";

export interface CommunicationProfile {
  notifications: NotificationMode;
  messageStyle: MessageStyle;
  initiative: InitiativeLevel;
  lifeSharing: LifeSharingLevel;
}

// ============================================================================
// Manager-mode types (см. .kiro/specs/manager-mode/design.md § 3.1).
// ============================================================================

/** Контактный уровень — заменяет StageId оригинала girl-agent. */
export type Tier =
  | "cold-stranger"
  | "introduced"
  | "regular"
  | "trusted-partner"
  | "vip"
  | "blocked";

/** Деловой тон общения. `mixed-by-tier` выбирает «вы»/«ты» по `Tier` контакта. */
export type Tone = "formal-вы" | "friendly-ты" | "mixed-by-tier";

/** Гендерный образ ассистента. */
export type PersonaStyle =
  | "gender-neutral-assistant"
  | "female-secretary"
  | "male-secretary";

/** Режим доступа к чату. */
export type GateLevel = "open" | "gated" | "whitelist";

/** Политика поведения вне рабочих часов. */
export type AfterHoursPolicy = "silent" | "auto-reply" | "vip-only";

/** Запись whitelist при `gateLevel=whitelist`. */
export type WhitelistEntry =
  | { kind: "id"; chatId: number }
  | { kind: "username"; username: string };

/** Пять менеджерских счётчиков, заменяют RelationshipScore оригинала. */
export interface ContactScore {
  /** -100..100 */
  relevance: number;
  /** -100..100 */
  trust: number;
  /** 0..100 */
  urgency: number;
  /** 0..100 */
  annoyance: number;
  /** 0..100 */
  spamScore: number;
}

/** ContactRecord — `data/<slug>/contacts/<chat_id>.json`. */
export interface ContactRecord {
  chatId: string;
  username?: string;
  tier: Tier;
  notes?: string;
  score: ContactScore;
  manualOverride: boolean;
  updatedAt: string;
  createdAt: string;
  lastMessageAt?: string;
  /** Время последнего одноразового auto-reply за текущее off-window. */
  lastAutoReplyAt?: string;
  meta?: {
    firstName?: string;
    promoMarker?: string;
  };
}

/** Состояние тикета. */
export type TicketState = "open" | "waiting-boss" | "answered" | "closed";

export interface TicketTransition {
  ts: string;
  from: TicketState | "<initial>";
  to: TicketState;
  reason: string;
  by: "system" | "boss" | "owner-webui";
}

export interface Ticket {
  /** Формат "#T-<n>", n ∈ 1..2_147_483_647. */
  id: string;
  chatId: string;
  clientUsername?: string;
  /** ≤500 символов, отправляется боссу. */
  summary: string;
  state: TicketState;
  createdAt: string;
  closedAt?: string;
  bossReplyRaw?: string;
  bossReplyAt?: string;
  clientReply?: string;
  clientReplyAt?: string;
  /** Флаг одноразового таймаут-уведомления клиенту. */
  timeoutNotified?: boolean;
  history: TicketTransition[];
  bossMessageId?: number;
  bossChatId?: number;
  llmDraftForBoss?: string;
  meta?: {
    confidentialityBlocks?: number;
  };
}

/** Корневая структура `tickets.json`. */
export interface TicketsFile {
  version: 1;
  /** Монотонно растущий счётчик для генерации `#T-<n>`. */
  nextId: number;
  tickets: Ticket[];
}

/** Результат разбора `Boss_Reply` по 3 идентификаторам. */
export type BossReplyParseResult =
  | { kind: "matched"; ticketId: string; clientReplyText: string }
  | { kind: "conflict"; candidateIds: string[] }
  | { kind: "ambiguous-username"; candidateIds: string[]; username: string }
  | { kind: "no-username-meta"; ticketId: string }
  | { kind: "ticket-not-found"; ticketId: string }
  | { kind: "empty-reply"; ticketId: string }
  | { kind: "no-identification" };

/** Решение слоя `mandate.decideAction`. */
export type EscalationDecision = "answer-self" | "escalate" | "decline" | "ignore";

export interface ProfileConfig {
  slug: string;
  name: string;
  age: number;
  nationality: Nationality;
  /** IANA timezone, e.g. "Europe/Moscow" or "Europe/Kyiv" */
  tz: string;
  mode: ClientMode;
  llm: {
    presetId: string;
    proto: LLMProto;
    baseURL?: string;
    apiKey: string;
    model: string;
    /** OAuth refresh token (for providers that support OAuth login) */
    oauthRefreshToken?: string;
    /** Unix ms when the current access token expires */
    oauthExpiresAt?: number;
  };
  telegram: {
    botToken?: string;
    apiId?: number;
    apiHash?: string;
    sessionString?: string;
    phone?: string;
    /** Использовать WebSocket через порт 443 вместо TCP на порту 80. Обходит блокировки РФ. По умолчанию true (auto). */
    useWSS?: boolean;
    /** SOCKS proxy for MTProto userbot mode. Можно задать через MANAGER_AGENT_TG_PROXY=socks5://user:pass@host:port. */
    proxy?: TelegramProxyConfig;
  };
  /** @deprecated MCP настройки скрыты из UI; внешние расширения ставятся через addons. */
  mcp?: { id: string; secrets: Record<string, string> }[];
  ownerId?: number; // tg user id of the human (set on first message in practice / fallback)
  privacy?: PrivacyMode;
  /**
   * @deprecated Legacy от girl-agent (StageId). Заменяется per-contact полем
   * `tier` в задаче 3.1 manager-mode. Сейчас оставлен полем-строкой
   * (с дефолтом "manager-default" для новых профилей), чтобы код этапа 2 не
   * падал на ссылках `cfg.stage`. Удаляется в задаче 4.12.
   */
  stage: string;
  createdAt: string;
  /** Часы сна (0-23). sleepFrom — когда ложится, sleepTo — когда просыпается. Может пересекать полночь. */
  sleepFrom: number;
  sleepTo: number;
  /** Вероятность 0..1 что она проснётся ночью на входящее сообщение (без :wake) */
  nightWakeChance: number;
  /** Склонность к игнору 0..100. Не прямой рандом: используется как вес в behavior-layer. */
  ignoreTendency?: number;
  /** Стиль общения: "short" — реалистично-краткие ответы, чаще игнор; "warm" — развёрнутые, тёплые, придумывает истории, реже игнорит */
  vibe?: "short" | "warm";
  communication?: CommunicationProfile;
  personaNotes?: string;
  busySchedule?: BusySlot[];

  // ===== Manager-mode (см. .kiro/specs/manager-mode/design.md § 3.1) =====
  /** Деловой тон. Дефолт `mixed-by-tier`. */
  tone?: Tone;
  /** Persona-стиль. Дефолт `gender-neutral-assistant`. */
  personaStyle?: PersonaStyle;
  /** Режим доступа к чату. Дефолт `gated`. */
  gateLevel?: GateLevel;
  /** Политика после рабочих часов. Дефолт `vip-only`. */
  afterHoursPolicy?: AfterHoursPolicy;
  /** Включить follow-up клиентам по обещаниям. Дефолт `false`. */
  proactiveClients?: boolean;
  /** Включить дайджесты боссу. Дефолт `false`. */
  proactiveBoss?: boolean;
  /** Список разрешённых чатов при `gateLevel=whitelist`. */
  whitelist?: WhitelistEntry[];
  /** Минуты до таймаут-уведомления клиенту по тикету (5..1440). Дефолт 240. */
  escalationTimeoutMin?: number;
  /** Период дайджеста боссу в часах (1..168). Дефолт 24. */
  digestPeriodHours?: number;
  /** Время дайджеста боссу в формате HH:MM. Дефолт 09:00. */
  digestTime?: string;
  /** Discriminator на будущее. Сейчас всегда `manager`. */
  profileType?: "manager";
}

export interface RelationshipScore {
  interest: number;
  trust: number;
  attraction: number;
  annoyance: number;
  cringe: number;
}

export interface BehaviorTickResult {
  shouldReply: boolean;
  shouldRead?: boolean;     // даже если не отвечает, прочитать и поставить галочки?
  delaySec: number;
  bubbles: number;          // how many message-pieces to split the reply into
  typing: boolean;
  ignoreReason?: string;
  moodDelta?: Partial<RelationshipScore>;
  intent: "reply" | "ignore" | "short" | "left-on-read" | "leave-chat" | "reaction-only";
  /** Опциональная TG-реакция на его сообщение. Девушки 2026 чаще реагируют чем шлют эмодзи в тексте. Один символ. */
  reaction?: string;
  /**
   * ID сообщения в Telegram, на которое ставим реакцию.
   * Девушки в TG иногда реагируют на более раннее сообщение, которое их зацепило.
   */
  reactionTargetMessageId?: number;
  /**
   * Если выставлено — после отправки сообщения девушка решила его отредактировать.
   * (редко и в основном при опечатках / выпавшем т 9 / изменении решения)
   */
  selfEdit?: {
    /** Номер сообщения из буля отправленных (0 = последнее, 1 = предпоследнее...). */
    targetOffset: number;
    newText: string;
    reason?: string;
  };
}

export type DeletionAwareness = "saw-and-read" | "saw-not-read" | "missed";

export interface DeletedMessageContext {
  deletedText: string;
  awareness: DeletionAwareness;
  /** Как давно (в секундах) было удалено. */
  ageSec: number;
}
