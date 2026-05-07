import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ImageBlockParam,
  MessageCreateParamsNonStreaming,
  MessageParam,
  TextBlockParam
} from "@anthropic-ai/sdk/resources/messages";
import type { ProfileConfig } from "../types.js";

interface OpenAIStreamChoice {
  delta?: { content?: unknown };
  message?: { content?: unknown };
  finish_reason?: ChatCompletion.Choice["finish_reason"];
}

interface OpenAIStreamChunk {
  id?: string;
  model?: string;
  created?: number;
  choices?: OpenAIStreamChoice[];
}

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
  jsonSchema?: ResponseFormatJSONSchema.JSONSchema;
}

export interface LLMClient {
  chat(messages: ChatMessage[], opts?: LLMOptions): Promise<string>;
}

const LLM_TIMEOUT_MS = 120_000;
const LLM_MAX_RETRIES = 1;

class OpenAILike implements LLMClient {
  private client: OpenAI;
  private fetchClient: OpenAI;
  constructor(private cfg: ProfileConfig["llm"]) {
    this.client = new OpenAI({
      apiKey: openAIApiKey(cfg),
      baseURL: normalizeBaseURL(cfg.baseURL),
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES
    });
    this.fetchClient = new OpenAI({
      apiKey: openAIApiKey(cfg),
      baseURL: normalizeBaseURL(cfg.baseURL),
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      fetch: compatibleFetch
    });
  }
  async chat(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: this.cfg.model,
      messages: openAIMessages(messages),
      temperature: opts.temperature ?? 0.85,
      response_format: openAIResponseFormat(opts)
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
    const attempted = new Set<string>();
    let current: ChatCompletionCreateParamsNonStreaming | null = params;
    let lastError: unknown;
    while (current) {
      const key = completionParamsKey(current);
      if (attempted.has(key)) break;
      attempted.add(key);
      try {
        return await this.client.chat.completions.create(current);
      } catch (error) {
        lastError = error;
        const next = completionFallback(current, error);
        if (!next) break;
        current = next;
      }
    }

    if (this.cfg.baseURL) {
      try {
        return await this.fetchClient.chat.completions.create({ ...params, stream: false });
      } catch (fetchError) {
        lastError = fetchError;
      }
    }

    throw enrichOpenAIError(lastError, this.cfg.baseURL);
  }
}

async function compatibleFetch(url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) return res;
  const text = await res.clone().text();
  if (contentType.includes("text/event-stream") || text.trimStart().startsWith("data:")) {
    return completionStreamToJsonResponse(res, text);
  }
  return res;
}

function completionStreamToJsonResponse(res: Response, text: string): Response {
  const completion = parseOpenAIEventStream(text);
  return new Response(JSON.stringify(completion), {
    status: res.status,
    statusText: res.statusText,
    headers: { "content-type": "application/json" }
  });
}

function parseOpenAIEventStream(raw: string): ChatCompletion {
  let id = "chatcmpl-stream";
  let model = "";
  let created = Math.floor(Date.now() / 1000);
  const content: string[] = [];
  let finishReason: ChatCompletion.Choice["finish_reason"] = "stop";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as ChatCompletionChunk & OpenAIStreamChunk;
      id = chunk.id || id;
      model = chunk.model || model;
      created = chunk.created || created;
      const choice = chunk.choices[0];
      finishReason = choice?.finish_reason ?? finishReason;
      const delta = choice?.delta?.content ?? choice?.message?.content;
      if (typeof delta === "string") content.push(delta);
    } catch {
      // Ignore malformed SSE keepalive/progress lines.
    }
  }
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: content.join(""), refusal: null },
      finish_reason: finishReason,
      logprobs: null
    }]
  };
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

function openAIApiKey(cfg: ProfileConfig["llm"]): string {
  return cfg.apiKey.trim() || (cfg.presetId === "ollama" ? "ollama" : cfg.presetId === "lmstudio" ? "lm-studio" : "");
}

function openAIResponseFormat(opts: LLMOptions): ChatCompletionCreateParamsNonStreaming["response_format"] {
  if (!opts.json) return undefined;
  if (opts.jsonSchema) return { type: "json_schema", json_schema: opts.jsonSchema };
  return {
    type: "json_schema",
    json_schema: {
      name: "json_response",
      strict: false,
      schema: { type: "object", additionalProperties: true }
    }
  };
}

function completionFallback(
  params: ChatCompletionCreateParamsNonStreaming,
  error: unknown
): ChatCompletionCreateParamsNonStreaming | null {
  return responseFormatFallback(params, error) ?? completionTokenFallback(params, error);
}

function responseFormatFallback(
  params: ChatCompletionCreateParamsNonStreaming,
  error: unknown
): ChatCompletionCreateParamsNonStreaming | null {
  const message = openAIErrorText(error);
  if (!params.response_format || !message.includes("response_format")) return null;
  if (params.response_format.type === "json_schema" && message.includes("json_object")) {
    return { ...params, response_format: { type: "text" } };
  }
  if (params.response_format.type === "json_schema") return { ...params, response_format: { type: "json_object" } };
  if (params.response_format.type === "json_object") return { ...params, response_format: { type: "text" } };
  return null;
}

function completionTokenFallback(
  params: ChatCompletionCreateParamsNonStreaming,
  error: unknown
): ChatCompletionCreateParamsNonStreaming | null {
  const message = openAIErrorText(error);
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

function completionParamsKey(params: ChatCompletionCreateParamsNonStreaming): string {
  const tokenKey = params.max_completion_tokens != null ? "max_completion_tokens" : "max_tokens";
  return `${params.response_format?.type ?? "default"}:${tokenKey}`;
}

function openAIErrorText(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    return `${error.status ?? ""} ${error.code ?? ""} ${error.type ?? ""} ${error.message}`.toLowerCase();
  }
  return errorMessage(error).toLowerCase();
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
