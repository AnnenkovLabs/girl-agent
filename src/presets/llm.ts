import type { LLMPreset } from "../types.js";

export const LLM_PRESETS: LLMPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    proto: "openai",
    defaultModel: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.5-thinking", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-thinking", "gpt-5.3-chat-latest", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"]
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    proto: "openai",
    baseURL: "http://localhost:1234/v1",
    defaultModel: "",
    custom: true,
    hint: "локально, OpenAI-compatible endpoint"
  },
  {
    id: "ollama",
    name: "Ollama",
    proto: "openai",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    custom: true,
    hint: "локально через /v1"
  },
  {
    id: "anthropic",
    name: "Anthropic",
    proto: "anthropic",
    defaultModel: "claude-sonnet-4-6",
    models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-sonnet-4-5", "claude-opus-4-1"]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    proto: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5.3-chat-latest",
    models: [
      "openai/gpt-5.3-chat-latest",
      "openai/gpt-5.5",
      "openai/gpt-5.5-thinking",
      "openai/gpt-5.5-pro",
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-opus-4.7",
      "google/gemini-3.1-pro",
      "deepseek/deepseek-v4-pro",
      "x-ai/grok-4.3"
    ]
  },
  {
    id: "groq",
    name: "Groq",
    proto: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama-4-scout-17b-16e-instruct", "qwen-3-32b", "mixtral-8x7b-32768"]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    proto: "openai",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    hint: "deepseek-chat/reasoner deprecated 2026-07-24, use V4 models"
  },
  {
    id: "mistral",
    name: "Mistral",
    proto: "openai",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-2512",
    models: ["mistral-large-2512", "mistral-small-2603", "ministral-8b-2512", "ministral-14b-2512", "mistral-large-latest", "mistral-small-latest"]
  },
  {
    id: "google",
    name: "Google Gemini",
    proto: "openai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.1-pro",
    models: ["gemini-3.1-pro", "gemini-3-flash", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash"],
    hint: "Gemini via OpenAI-compatible endpoint"
  },
  {
    id: "xai",
    name: "xAI Grok",
    proto: "openai",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    models: ["grok-4.3", "grok-4.20-reasoning", "grok-4.20-non-reasoning", "grok-4", "grok-3", "grok-3-mini"]
  },
  {
    id: "together",
    name: "Together AI",
    proto: "openai",
    baseURL: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "meta-llama/Llama-4-scout-17b-instruct",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V3"
    ]
  },
  {
    id: "fireworks",
    name: "Fireworks",
    proto: "openai",
    baseURL: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/llama-4-scout-17b-16e-instruct",
      "accounts/fireworks/models/qwen2p5-72b-instruct",
      "accounts/fireworks/models/deepseek-v3"
    ]
  },
  {
    id: "perplexity",
    name: "Perplexity",
    proto: "openai",
    baseURL: "https://api.perplexity.ai",
    defaultModel: "sonar-pro",
    models: ["sonar-pro", "sonar", "sonar-reasoning"]
  },
  {
    id: "cerebras",
    name: "Cerebras",
    proto: "openai",
    baseURL: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    models: ["llama-3.3-70b", "llama-4-scout-17b-16e-instruct", "qwen-3-32b"]
  },
  {
    id: "claudehub",
    name: "ClaudeHub",
    proto: "anthropic",
    baseURL: "https://api.claudehub.fun",
    defaultModel: "claude-sonnet-4.6",
    models: ["claude-opus-4.7", "claude-opus-4.6", "claude-opus-4.5", "claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5", "gpt-5.5", "gpt-5.4"],
    hint: "ClaudeHub proxy for Anthropic & OpenAI (РФ, СБП, крипта)"
  },
  {
    id: "custom-openai",
    name: "Custom (OpenAI-compatible)",
    proto: "openai",
    defaultModel: "",
    custom: true,
    hint: "Provide base URL + model name"
  },
  {
    id: "custom-anthropic",
    name: "Custom (Anthropic-compatible)",
    proto: "anthropic",
    defaultModel: "",
    custom: true,
    hint: "Provide base URL + model name"
  }
];

export function findPreset(id: string): LLMPreset | undefined {
  return LLM_PRESETS.find(p => p.id === id);
}
