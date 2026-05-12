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
  mcp: { id: string; secrets: Record<string, string> }[];
  ownerId?: number;
  privacy?: "owner-only" | "allow-strangers";
  createdAt: string;
  sleepFrom: number; sleepTo: number; nightWakeChance: number;
  ignoreTendency?: number;
  vibe?: "short" | "warm";
  communication?: { notifications: string; messageStyle: string; initiative: string; lifeSharing: string };
  personaNotes?: string;
  busySchedule?: { dayOfWeek: number; startHour: number; endHour: number; reason?: string }[];
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
  type: "fix" | "mod" | "persona" | "mcp" | "theme" | "locale";
  id: string; name: string; description: string; version: string;
  author?: string; tags?: string[];
  configOverrides?: Record<string, unknown>;
  files?: { path: string; content: string }[];
  mcp?: { presetId?: string; secrets?: { key: string; label: string }[] };
  theme?: { vars?: Record<string, string>; css?: string };
  locale?: { lang: string; strings: Record<string, string> };
  settings?: AddonSetting[];
  installed?: boolean;
}

export interface InstalledAddon {
  manifest: AddonManifest;
  enabled: boolean;
  installedAt: string;
  source: "registry" | "url" | "local";
  settingsValues?: Record<string, string | number | boolean>;
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
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const api = {
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
  async listMCPPresets() { return req<{ presets: { id: string; name: string; description: string; ready: boolean; secrets: { key: string; label: string }[] }[] }>("GET", "/api/presets/mcp"); },
  async listTimezones(q = "") { return req<{ zones: { iana: string; gmtWinter: string; city: string; country: string; aliases: string[]; group?: "UA" | "CIS" | "RU" }[] }>("GET", `/api/presets/timezones?q=${encodeURIComponent(q)}`); },
  async pickNames(nationality: "RU" | "UA", count = 12) { return req<{ names: string[] }>("GET", `/api/presets/names?nationality=${nationality}&count=${count}`); },

  async getVersion() { return req<{ current: string; latest: string | null }>("GET", "/api/system/version"); },
  async getDiagnostics() { return req<{ platform: string; arch: string; node: string; hostname: string; uptime: number; dataRoot: string; ipv4: string[]; memTotalMB: number }>("GET", "/api/system/diagnostics"); },

  async listAddons() { return req<{ available: AddonManifest[]; installed: InstalledAddon[]; builtin: string[] }>("GET", "/api/addons"); },
  async installAddon(id: string, manifest?: AddonManifest, profileSlug?: string) {
    return req<{ ok: true; installed: InstalledAddon; applied?: string[] }>("POST", `/api/addons/${encodeURIComponent(id)}/install`, { manifest, profileSlug });
  },
  async installAddonFromUrl(url: string, profileSlug?: string) {
    return req<{ ok: true; installed: InstalledAddon }>("POST", "/api/addons/install-url", { url, profileSlug });
  },
  async previewAddon(manifest: AddonManifest, profileSlug?: string) {
    return req<{ ok: true; conflicts: string[] }>("POST", "/api/addons/preview", { manifest, profileSlug });
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
    return req<{ sessionString: string; apiId: number; apiHash: string }>(
      "POST", "/api/tg/userbot/verify-password", payload
    );
  }
};

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
