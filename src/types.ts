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
