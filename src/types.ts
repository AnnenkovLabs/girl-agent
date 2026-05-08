export type ClientMode = "bot" | "userbot";

export type LLMProto = "openai" | "anthropic";

export type PrivacyMode = "owner-only" | "allow-strangers";

export type Nationality = "RU" | "UA";

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

export type StageId =
  | "met-irl-got-tg"
  | "tg-given-cold"
  | "tg-given-warming"
  | "convinced"
  | "first-date-done"
  | "dating-early"
  | "dating-stable"
  | "long-term"
  | "dumped";

export interface StagePreset {
  id: StageId;
  num: number;
  label: string;
  description: string;
  /** behavioural defaults baked into prompt */
  defaults: {
    interest: number;     // -100..100
    trust: number;
    attraction: number;
    annoyance: number;
    cringeTolerance: number; // higher = more tolerant
    ignoreChance: number;    // 0..1 base probability per incoming message
    replyDelaySec: [number, number]; // min,max
  };
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
  stage: StageId;
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
  };
  mcp: { id: string; secrets: Record<string, string> }[];
  ownerId?: number; // tg user id of the human (set on first message in practice / fallback)
  privacy?: PrivacyMode;
  createdAt: string;
  /** Часы сна (0-23). sleepFrom — когда ложится, sleepTo — когда просыпается. Может пересекать полночь. */
  sleepFrom: number;
  sleepTo: number;
  /** Вероятность 0..1 что она проснётся ночью на входящее сообщение (без :wake) */
  nightWakeChance: number;
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
}
