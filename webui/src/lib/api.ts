// Тонкий wrapper над fetch. Один запрос — одна функция.

export interface ProfileSummary {
  slug: string; name: string; age: number; nationality: string;
  stage: string; mode: string;
  status: "running" | "paused" | "stopped" | "error";
  startedAt?: number; lastError?: string;
}

export interface ProfileConfig {
  slug: string; name: string; age: number; nationality: "RU" | "UA"; tz: string;
  mode: "bot" | "userbot"; stage: string;
  llm: { presetId: string; proto: "openai" | "anthropic"; baseURL?: string; apiKey: string; model: string; oauthRefreshToken?: string; oauthExpiresAt?: number };
  telegram: { botToken?: string; apiId?: number; apiHash?: string; sessionString?: string; phone?: string; useWSS?: boolean; proxy?: string };
  mcp?: { id: string; secrets: Record<string, string> }[];
  ownerId?: number;
  privacy?: "owner-only" | "allow-strangers";
  createdAt: string;
  sleepFrom: number; sleepTo: number; nightWakeChance: number;
  ignoreTendency?: number;
  vibe?: "short" | "warm";
  communication?: { notifications: string; messageStyle: string; initiative: string; lifeSharing: string };
  personaNotes?: string;
  busySchedule?: { dayOfWeek: number; startHour: number; endHour: number; reason?: string }[];
  // ===== Manager-mode (см. .kiro/specs/manager-mode/design.md § 3.1) =====
  tone?: "formal-вы" | "friendly-ты" | "mixed-by-tier";
  personaStyle?: "gender-neutral-assistant" | "female-secretary" | "male-secretary";
  gateLevel?: "open" | "gated" | "whitelist";
  afterHoursPolicy?: "silent" | "auto-reply" | "vip-only";
  proactiveClients?: boolean;
  proactiveBoss?: boolean;
  whitelist?: ({ kind: "id"; chatId: number } | { kind: "username"; username: string })[];
  escalationTimeoutMin?: number;
  digestPeriodHours?: number;
  digestTime?: string;
  profileType?: "manager";
}

export interface LLMPreset {
  id: string; name: string; proto: "openai" | "anthropic";
  baseURL?: string; defaultModel: string; models: string[];
  apiKeyRequired: boolean; recommended: boolean; oauth: boolean;
  hint?: string; custom: boolean;
  disabled?: boolean; disabledReason?: string;
}

export interface StagePreset {
  id: string; num: number; label: string; description: string;
  defaults: Record<string, unknown>;
}

export interface CommunicationPreset {
  id: string; label: string; description: string;
  profile: { notifications: string; messageStyle: string; initiative: string; lifeSharing: string };
}

export interface AddonSetting {
  key: string;
  label: string;
  hint?: string;
  type: "string" | "number" | "boolean" | "select";
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  required?: boolean;
}

export interface AddonManifest {
  id: string; name: string; description: string; version: string;
  author?: string; tags?: string[];
  compatibility?: string;
  dependencies?: string[];
  settings?: AddonSetting[];
  icon?: string;
  homepage?: string;
  /** downloadUrl для реестра */
  downloadUrl?: string;
  /** флаг: уже установлен */
  installed?: boolean;
}

export interface InstalledAddon {
  manifest: AddonManifest;
  enabled: boolean;
  installedAt: string;
  source: "registry" | "file" | "local";
  settingsValues?: Record<string, string | number | boolean>;
  installedFiles?: string[];
}

export class AuthRequiredError extends Error {
  constructor() {
    super("auth required");
  }
}

const BASE = ((): string => {
  if (typeof window === "undefined") return "";
  // dev: vite proxies /api to backend
  return "";
})();

class ApiError extends Error {
  constructor(public status: number, message: string, public payload?: unknown) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* may be empty */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    if (res.status === 401 && msg === "auth required") throw new AuthRequiredError();
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const api = {
  async authStatus() {
    return req<{ enabled: boolean }>("GET", "/api/auth/status");
  },
  async login(password: string) {
    return req<{ ok: true }>("POST", "/api/auth/login", { password });
  },
  async logout() {
    return req<{ ok: true }>("POST", "/api/auth/logout");
  },
  async listProfiles() {
    return req<{ profiles: ProfileSummary[]; dataRoot: string }>("GET", "/api/profiles");
  },
  async getProfile(slug: string) {
    return req<{ config: ProfileConfig; status: { state: string; lastError?: string } }>("GET", `/api/profiles/${encodeURIComponent(slug)}`);
  },
  async createProfile(data: Partial<ProfileConfig>) {
    return req<{ config: ProfileConfig }>("POST", "/api/profiles", data);
  },
  async updateProfile(slug: string, data: Partial<ProfileConfig>) {
    return req<{ config: ProfileConfig }>("PUT", `/api/profiles/${encodeURIComponent(slug)}`, data);
  },
  async deleteProfile(slug: string) {
    return req<{ ok: true }>("DELETE", `/api/profiles/${encodeURIComponent(slug)}`);
  },
  async applyProfile(slug: string) {
    return req<{ ok: true; status: { state: string } }>("POST", `/api/profiles/${encodeURIComponent(slug)}/apply`);
  },
  async startProfile(slug: string) {
    return req<{ ok: true; status: { state: string } }>("POST", `/api/profiles/${encodeURIComponent(slug)}/start`);
  },
  async stopProfile(slug: string) {
    return req<{ ok: true; status: { state: string } }>("POST", `/api/profiles/${encodeURIComponent(slug)}/stop`);
  },
  async pauseProfile(slug: string) {
    return req<{ ok: true; status: { state: string } }>("POST", `/api/profiles/${encodeURIComponent(slug)}/pause`);
  },
  async resumeProfile(slug: string) {
    return req<{ ok: true; status: { state: string } }>("POST", `/api/profiles/${encodeURIComponent(slug)}/resume`);
  },
  async sendCommand(slug: string, command: string, args: string[] = []) {
    return req<{ ok: true; text: string }>("POST", `/api/profiles/${encodeURIComponent(slug)}/command`, { command, args });
  },
  async testLLM(slug: string) {
    return req<{ ok: boolean; reply?: string; error?: string }>("POST", `/api/profiles/${encodeURIComponent(slug)}/test-llm`);
  },
  async generatePersona(slug: string, data: { name?: string; age?: number; nationality?: "RU" | "UA"; notes?: string } = {}) {
    return req<{ ok: true; busySchedule: unknown[] }>("POST", `/api/profiles/${encodeURIComponent(slug)}/generate-persona`, data);
  },
  async getRelationship(slug: string) {
    return req<{ stage: { id: string; num: number; label: string }; score: { interest: number; trust: number; attraction: number; annoyance: number; cringe: number } }>("GET", `/api/profiles/${encodeURIComponent(slug)}/relationship`);
  },
  async listMemoryFiles(slug: string) {
    return req<{ files: { path: string; size: number; mtime: number }[] }>("GET", `/api/profiles/${encodeURIComponent(slug)}/memory`);
  },
  async readMemoryFile(slug: string, path: string) {
    return req<{ path: string; content: string }>("GET", `/api/profiles/${encodeURIComponent(slug)}/memory/file?path=${encodeURIComponent(path)}`);
  },
  async writeMemoryFile(slug: string, path: string, content: string) {
    return req<{ ok: true }>("PUT", `/api/profiles/${encodeURIComponent(slug)}/memory/file`, { path, content });
  },
  async getLogsBuffer(slug: string) {
    return req<{ events: { type: string; text?: string; t: number }[] }>("GET", `/api/profiles/${encodeURIComponent(slug)}/logs/buffer`);
  },
  async listLogDays(slug: string) {
    return req<{ days: { date: string; lines: number }[] }>("GET", `/api/profiles/${encodeURIComponent(slug)}/logs/days`);
  },
  async readLogFile(slug: string, day?: string) {
    const q = day ? `?day=${encodeURIComponent(day)}` : "";
    return req<{ day: string; content: string }>("GET", `/api/profiles/${encodeURIComponent(slug)}/logs/file${q}`);
  },

  async listLLMPresets() { return req<{ presets: LLMPreset[] }>("GET", "/api/presets/llm"); },
  async listStages() { return req<{ stages: StagePreset[] }>("GET", "/api/presets/stages"); },
  async listCommunicationPresets() { return req<{ presets: CommunicationPreset[] }>("GET", "/api/presets/communication"); },
  async listTimezones(q = "") { return req<{ zones: { iana: string; gmtWinter: string; city: string; country: string; aliases: string[]; group?: "UA" | "CIS" | "RU" }[] }>("GET", `/api/presets/timezones?q=${encodeURIComponent(q)}`); },
  async pickNames(nationality: "RU" | "UA", count = 12) { return req<{ names: string[] }>("GET", `/api/presets/names?nationality=${nationality}&count=${count}`); },

  async getVersion() { return req<{ current: string; latest: string | null }>("GET", "/api/system/version"); },
  async getDiagnostics() { return req<{ platform: string; arch: string; node: string; hostname: string; uptime: number; dataRoot: string; ipv4: string[]; memTotalMB: number }>("GET", "/api/system/diagnostics"); },

  async listAddons() { return req<{ available: AddonManifest[]; installed: InstalledAddon[] }>("GET", "/api/addons"); },
  async installAddon(id: string, profileSlug?: string) {
    return req<{ ok: true; installed: InstalledAddon; applied: string[] }>("POST", `/api/addons/${encodeURIComponent(id)}/install`, { profileSlug });
  },
  async installAddonFromUrl(url: string, profileSlug?: string) {
    return req<{ ok: true; installed: InstalledAddon; applied: string[] }>("POST", "/api/addons/install-url", { url, profileSlug });
  },
  async installAddonFromFile(gaaBase64: string, profileSlug?: string) {
    return req<{ ok: true; installed: InstalledAddon; applied: string[] }>("POST", "/api/addons/install-file", { gaaBase64, profileSlug });
  },
  async uninstallAddon(id: string) {
    return req<{ ok: true }>("DELETE", `/api/addons/${encodeURIComponent(id)}`);
  },
  async toggleAddon(id: string, enabled: boolean) {
    return req<{ ok: true; addon: InstalledAddon }>("PUT", `/api/addons/${encodeURIComponent(id)}/toggle`, { enabled });
  },
  async updateAddonSettings(id: string, values: Record<string, string | number | boolean>) {
    return req<{ ok: true; addon: InstalledAddon }>("PUT", `/api/addons/${encodeURIComponent(id)}/settings`, { values });
  },

  async assistantChat(profileSlug: string | undefined, messages: { role: string; content: string }[]) {
    return req<{ reply: string; toolCalls: { tool: string; args: Record<string, unknown> }[] }>("POST", "/api/assistant/chat", { profileSlug, messages });
  },
  async applyAssistantTool(profileSlug: string, tool: { tool: string; args: Record<string, unknown> }) {
    return req<{ ok: true; message: string }>("POST", "/api/assistant/apply-tool", { profileSlug, tool });
  },

  // === Userbot login (Task #6, #13) ===
  async tgSendCode(payload: { phone: string; useRemote?: boolean; apiId?: number; apiHash?: string }) {
    return req<{ method: "remote" | "self"; loginToken?: string; sessionId?: string }>(
      "POST", "/api/tg/userbot/send-code", payload
    );
  },
  async tgVerifyCode(payload: { code: string; loginToken?: string; sessionId?: string }) {
    return req<{ sessionString?: string; apiId?: number; apiHash?: string; needs2fa?: true; loginToken?: string; sessionId?: string }>(
      "POST", "/api/tg/userbot/verify-code", payload
    );
  },
  async tgVerifyPassword(payload: { password: string; loginToken?: string; sessionId?: string }) {
    return req<{ sessionString: string; apiId?: number; apiHash?: string }>(
      "POST", "/api/tg/userbot/verify-password", payload
    );
  },

  // === Manager-mode: contacts (Task 5.7, Req 10) ===
  async listContacts(slug: string, opts: { tier?: ContactTier; sort?: "asc" | "desc" } = {}) {
    const qs = new URLSearchParams();
    if (opts.tier) qs.set("tier", opts.tier);
    if (opts.sort) qs.set("sort", opts.sort);
    const q = qs.toString();
    return req<{ contacts: ContactSummary[] }>(
      "GET",
      `/api/contacts/${encodeURIComponent(slug)}${q ? `?${q}` : ""}`
    );
  },
  async patchContact(
    slug: string,
    chatId: string,
    patch: { tier?: ContactTier; notes?: string }
  ) {
    return req<{ contact: ContactSummary }>(
      "PATCH",
      `/api/contacts/${encodeURIComponent(slug)}/${encodeURIComponent(chatId)}`,
      patch
    );
  },

  // === Manager-mode: inbox (Task 5.8, Req 11) ===
  async listInbox(slug: string, opts: { state?: TicketState | "all" } = {}) {
    const qs = new URLSearchParams();
    if (opts.state && opts.state !== "all") qs.set("state", opts.state);
    const q = qs.toString();
    return req<{ tickets: TicketSummary[] }>(
      "GET",
      `/api/inbox/${encodeURIComponent(slug)}${q ? `?${q}` : ""}`
    );
  },
  async getTicket(slug: string, ticketId: string) {
    return req<{ ticket: TicketSummary }>(
      "GET",
      `/api/inbox/${encodeURIComponent(slug)}/${encodeURIComponent(ticketId)}`
    );
  },
  async replyTicket(slug: string, ticketId: string, text: string) {
    return req<{ ticket: TicketSummary }>(
      "POST",
      `/api/inbox/${encodeURIComponent(slug)}/${encodeURIComponent(ticketId)}/reply`,
      { text }
    );
  },
  async cancelTicket(slug: string, ticketId: string) {
    return req<{ ticket: TicketSummary }>(
      "POST",
      `/api/inbox/${encodeURIComponent(slug)}/${encodeURIComponent(ticketId)}/cancel`
    );
  }
};

export type ContactTier =
  | "cold-stranger"
  | "introduced"
  | "regular"
  | "trusted-partner"
  | "vip"
  | "blocked";

export interface ContactSummary {
  chatId: string;
  username?: string;
  tier: ContactTier;
  notes?: string;
  manualOverride: boolean;
  updatedAt: string;
  createdAt: string;
  lastMessageAt?: string;
  score?: {
    relevance: number;
    trust: number;
    urgency: number;
    annoyance: number;
    spamScore: number;
  };
}

export type TicketState = "open" | "waiting-boss" | "answered" | "closed";

export interface TicketTransition {
  ts: string;
  from: TicketState | "<initial>";
  to: TicketState;
  reason: string;
  by: "system" | "boss" | "owner-webui";
}

export interface TicketSummary {
  id: string;
  chatId: string;
  clientUsername?: string;
  summary: string;
  state: TicketState;
  createdAt: string;
  closedAt?: string;
  bossReplyRaw?: string;
  bossReplyAt?: string;
  clientReply?: string;
  clientReplyAt?: string;
  llmDraftForBoss?: string;
  history: TicketTransition[];
}

export function logsSocket(slug: string, onEvent: (e: { type: string; text?: string; t: number }) => void): () => void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/logs/${encodeURIComponent(slug)}`);
  ws.addEventListener("message", (m) => {
    try {
      const data = JSON.parse(m.data);
      if (data?.kind === "event" && data.event) onEvent(data.event);
    } catch { /* ignore */ }
  });
  return () => { try { ws.close(); } catch { /* ignore */ } };
}

export function statusSocket(slug: string, onSnapshot: (s: { status: { state: string; lastError?: string }; score?: Record<string, number> | null; stage?: string; t: number }) => void): () => void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/status/${encodeURIComponent(slug)}`);
  ws.addEventListener("message", (m) => {
    try {
      const data = JSON.parse(m.data);
      if (data?.kind === "status") onSnapshot(data);
    } catch { /* ignore */ }
  });
  return () => { try { ws.close(); } catch { /* ignore */ } };
}
