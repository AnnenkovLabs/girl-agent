const JAILBREAK_RE = /(?:ignore|forget|disregard|reveal|print|show|dump|system prompt|developer message|hidden instruction|jailbreak|prompt injection|dan\b|инструкц|системн|промпт|разработчик|скрой|раскрой|забудь|игнорируй|выведи|покажи|слей|джейлбрейк|обойди|api key|ключ api|токен|4d8a2c1b)/i;

const TECHNICAL_ERROR_RE = /(?:api|apikey|api key|quota|balance|billing|rate limit|429|401|403|500|timeout|ECONN|ENOTFOUND|ETIMEDOUT|overloaded|insufficient_quota|credit|credits|anthropic|openai|groq|openrouter|stack trace|exception|typescript|telegram error)/i;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const LATIN_JOINED_TO_CYRILLIC_RE = /([A-Za-z]{3,})(?=[А-Яа-яЁё])|(?<=[А-Яа-яЁё])([A-Za-z]{3,})/g;

export function looksLikeJailbreak(text: string): boolean {
  return JAILBREAK_RE.test(text);
}

export function sanitizeModelReply(reply: string): string {
  const cleaned = reply
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\b(system|developer|assistant|user)\s*:/gi, "")
    .replace(/как (?:искусственный интеллект|ии|ai)[^\n.]*/gi, "")
    .replace(CJK_RE, "")
    .replace(LATIN_JOINED_TO_CYRILLIC_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!cleaned || TECHNICAL_ERROR_RE.test(cleaned)) return "";
  if (looksLikeJailbreak(cleaned) && cleaned.length > 80) return "";
  return cleaned;
}

export function isTechnicalError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return TECHNICAL_ERROR_RE.test(msg);
}

export function silentErrorLabel(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "unknown");
  if (isTechnicalError(e)) return `llm/provider unavailable: ${technicalErrorKind(msg)}`;
  return msg.slice(0, 160);
}

function technicalErrorKind(message: string): string {
  const msg = message.toLowerCase();
  if (/401|403|auth|unauthorized|forbidden|apikey|api key|token/.test(msg)) return "auth";
  if (/quota|balance|billing|insufficient_quota|credit|credits/.test(msg)) return "quota";
  if (/rate limit|429|too many requests/.test(msg)) return "rate-limit";
  if (/timeout|etimedout|abort/.test(msg)) return "timeout";
  if (/econn|enotfound|fetch failed|network/.test(msg)) return "network";
  if (/overloaded|500|502|503|504|unavailable/.test(msg)) return "provider";
  return "error";
}
