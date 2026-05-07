import OpenAI from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ImageBlockParam,
  MessageCreateParamsNonStreaming,
  MessageParam,
  TextBlockParam
} from "@anthropic-ai/sdk/resources/messages";
import type { ProfileConfig } from "../types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

export type ChatContent = string | ChatContentPart[];

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface LLMClient {
  chat(messages: ChatMessage[], opts?: LLMOptions): Promise<string>;
}

const LLM_TIMEOUT_MS = 120_000;
const LLM_MAX_RETRIES = 1;

class OpenAILike implements LLMClient {
  private client: OpenAI;
  constructor(private cfg: ProfileConfig["llm"]) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: normalizeBaseURL(cfg.baseURL),
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES
    });
  }
  async chat(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: this.cfg.model,
      messages: openAIMessages(messages),
      temperature: opts.temperature ?? 0.85,
      response_format: opts.json ? { type: "json_object" } : undefined
    };
    if (usesMaxCompletionTokens(this.cfg.model)) {
      params.max_completion_tokens = opts.maxTokens ?? 600;
    } else {
      params.max_tokens = opts.maxTokens ?? 600;
    }

    const res = await this.createWithCompatibilityFallback(params);
    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  private async createWithCompatibilityFallback(params: ChatCompletionCreateParamsNonStreaming) {
    try {
      return await this.client.chat.completions.create(params);
    } catch (error) {
      const fallback = completionTokenFallback(params, error);
      if (!fallback) throw enrichOpenAIError(error, this.cfg.baseURL);
      try {
        return await this.client.chat.completions.create(fallback);
      } catch (fallbackError) {
        throw enrichOpenAIError(fallbackError, this.cfg.baseURL);
      }
    }
  }
}

class AnthropicLike implements LLMClient {
  private client: Anthropic;
  constructor(private cfg: ProfileConfig["llm"]) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: normalizeBaseURL(cfg.baseURL),
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES
    });
  }
  async chat(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
    const system = messages.filter(m => m.role === "system").map(m => contentToText(m.content)).join("\n\n");
    const rest = messages
      .filter(m => m.role !== "system")
      .filter(m => contentToText(m.content).trim().length > 0)
      .map((m): { role: "user" | "assistant"; content: ChatContent } => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
      }));

    // Anthropic требует чередование ролей и старт с user — мерджим подряд одинаковые
    const merged: { role: "user" | "assistant"; content: ChatContent }[] = [];
    for (const m of rest) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) {
        last.content = mergeContent(last.content, m.content);
      } else {
        merged.push({ ...m });
      }
    }
    // Должно начинаться с user
    if (merged.length === 0 || merged[0]!.role !== "user") {
      merged.unshift({ role: "user", content: "(продолжай)" });
    }
    // Должно заканчиваться на user
    if (merged[merged.length - 1]!.role !== "user") {
      merged.push({ role: "user", content: "(продолжай)" });
    }

    const params: MessageCreateParamsNonStreaming = {
      model: this.cfg.model,
      system: system || undefined,
      max_tokens: opts.maxTokens ?? 600,
      temperature: opts.temperature ?? 0.85,
      messages: merged.map((m): MessageParam => ({ role: m.role, content: anthropicContent(m.content) }))
    };
    const res = await this.client.messages.create(params).catch(error => {
      throw enrichAnthropicError(error, this.cfg.baseURL);
    });
    const block = res.content.find(c => c.type === "text");
    return block && "text" in block ? block.text.trim() : "";
  }
}

function contentToText(content: ChatContent): string {
  if (typeof content === "string") return content;
  return content.map(p => p.type === "text" ? p.text : `[image:${p.mimeType}]`).join("\n");
}

function mergeContent(a: ChatContent, b: ChatContent): ChatContent {
  if (typeof a === "string" && typeof b === "string") return a + "\n" + b;
  const aa: ChatContentPart[] = typeof a === "string" ? [{ type: "text", text: a }] : a;
  const bb: ChatContentPart[] = typeof b === "string" ? [{ type: "text", text: b }] : b;
  return [...aa, ...bb];
}

function openAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === "system") return { role: "system", content: openAITextContent(m.content) };
    if (m.role === "assistant") return { role: "assistant", content: openAITextContent(m.content) };
    return { role: "user", content: openAIContent(m.content) };
  });
}

function openAITextContent(content: ChatContent): string {
  return typeof content === "string" ? content : contentToText(content);
}

function openAIContent(content: ChatContent): string | ChatCompletionContentPart[] {
  if (typeof content === "string") return content;
  return content.map((p): ChatCompletionContentPart => p.type === "text"
    ? { type: "text", text: p.text }
    : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } });
}

function anthropicContent(content: ChatContent): MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((p): TextBlockParam | ImageBlockParam => p.type === "text"
    ? { type: "text", text: p.text }
    : {
      type: "image",
      source: {
        type: "base64",
        media_type: anthropicImageMime(p.mimeType),
        data: p.data
      }
    });
}

function anthropicImageMime(mimeType: string): ImageBlockParam.Source["media_type"] {
  return mimeType === "image/png" || mimeType === "image/gif" || mimeType === "image/webp" ? mimeType : "image/jpeg";
}

function normalizeBaseURL(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

function usesMaxCompletionTokens(model: string): boolean {
  return /^(?:o\d|o\d-|o\d\b|gpt-5|gpt-5\.|gpt-[5-9])|\/(?:o\d|gpt-5|gpt-[5-9])/.test(model.trim().toLowerCase());
}

function completionTokenFallback(
  params: ChatCompletionCreateParamsNonStreaming,
  error: unknown
): ChatCompletionCreateParamsNonStreaming | null {
  const message = errorMessage(error).toLowerCase();
  if (params.max_tokens != null && message.includes("max_tokens") && message.includes("max_completion_tokens")) {
    const { max_tokens, ...rest } = params;
    return { ...rest, max_completion_tokens: max_tokens };
  }
  if (params.max_completion_tokens != null && message.includes("max_completion_tokens") && message.includes("max_tokens")) {
    const { max_completion_tokens, ...rest } = params;
    return { ...rest, max_tokens: max_completion_tokens };
  }
  return null;
}

function enrichOpenAIError(error: unknown, baseURL?: string): Error {
  if (error instanceof OpenAI.APIConnectionError) {
    return new Error(connectionErrorMessage("OpenAI-compatible", baseURL, error));
  }
  if (error instanceof OpenAI.APIError) {
    const detail = error.status ? `${error.status} ${error.message}` : error.message;
    return new Error(`OpenAI-compatible API error: ${detail}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function enrichAnthropicError(error: unknown, baseURL?: string): Error {
  if (error instanceof Anthropic.APIConnectionError) {
    return new Error(connectionErrorMessage("Anthropic-compatible", baseURL, error));
  }
  if (error instanceof Anthropic.APIError) {
    const detail = error.status ? `${error.status} ${error.message}` : error.message;
    return new Error(`Anthropic-compatible API error: ${detail}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function connectionErrorMessage(provider: string, baseURL: string | undefined, error: Error): string {
  const endpoint = normalizeBaseURL(baseURL) ?? "default endpoint";
  return `${provider} connection failed (${endpoint}): ${error.message}. Проверь, что base URL доступен с этой машины, сервер запущен, путь включает нужный OpenAI/Anthropic-compatible endpoint и ключ подходит провайдеру.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function makeLLM(cfg: ProfileConfig["llm"]): LLMClient {
  return cfg.proto === "anthropic" ? new AnthropicLike(cfg) : new OpenAILike(cfg);
}
