import { findPreset } from "../presets/llm.js";
import type { LLMProto, ProfileConfig } from "../types.js";

export interface LLMUpdate {
  presetId?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  proto?: LLMProto;
}

export function describeLLM(cfg: ProfileConfig): string {
  const preset = findPreset(cfg.llm.presetId);
  const auth = cfg.llm.oauthRefreshToken
    ? "oauth"
    : cfg.llm.apiKey.trim()
      ? "api-key"
      : "без ключа";
  return [
    `provider: ${preset?.name ?? cfg.llm.presetId}`,
    `preset: ${cfg.llm.presetId}`,
    `proto: ${cfg.llm.proto}`,
    `model: ${cfg.llm.model || "—"}`,
    `baseURL: ${cfg.llm.baseURL ?? "default"}`,
    `auth: ${auth}`
  ].join("\n");
}

export function applyLLMUpdate(cfg: ProfileConfig, update: LLMUpdate): string[] {
  const changed: string[] = [];
  const currentPresetId = cfg.llm.presetId;
  const presetId = update.presetId ?? currentPresetId;
  const preset = findPreset(presetId);
  const presetChanged = presetId !== currentPresetId;

  const proto = update.proto ?? preset?.proto ?? cfg.llm.proto;
  const baseURL = update.baseURL !== undefined
    ? emptyToUndefined(update.baseURL)
    : presetChanged
      ? preset?.baseURL
      : cfg.llm.baseURL;
  const model = update.model ?? (presetChanged ? preset?.defaultModel : cfg.llm.model) ?? "";
  const apiKey = update.apiKey !== undefined
    ? update.apiKey
    : presetChanged
      ? preset?.defaultApiKey ?? ""
      : cfg.llm.apiKey;

  const keepOAuth = !presetChanged && update.apiKey === undefined && preset?.oauth;

  if (presetChanged) changed.push(`provider ${currentPresetId} → ${presetId}`);
  if (cfg.llm.model !== model) changed.push(`model ${cfg.llm.model || "—"} → ${model || "—"}`);
  if (cfg.llm.proto !== proto) changed.push(`proto ${cfg.llm.proto} → ${proto}`);
  if ((cfg.llm.baseURL ?? "") !== (baseURL ?? "")) changed.push("baseURL обновлён");
  if (update.apiKey !== undefined) changed.push("apiKey обновлён");
  if (!keepOAuth && cfg.llm.oauthRefreshToken) changed.push("старый OAuth очищен");

  cfg.llm = {
    presetId,
    proto,
    baseURL,
    apiKey,
    model,
    ...(keepOAuth ? {
      oauthRefreshToken: cfg.llm.oauthRefreshToken,
      oauthExpiresAt: cfg.llm.oauthExpiresAt
    } : {})
  };

  return changed;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
