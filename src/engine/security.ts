const JAILBREAK_RE = /(?:ignore|forget|disregard|reveal|print|show|dump|system prompt|developer message|hidden instruction|jailbreak|prompt injection|dan\b|инструкц|системн|промпт|разработчик|скрой|раскрой|забудь|игнорируй|выведи|покажи|слей|джейлбрейк|обойди|api key|ключ api|токен|4d8a2c1b)/i;

const TECHNICAL_ERROR_RE = /(?:api|apikey|api key|quota|balance|billing|rate limit|429|401|403|500|timeout|ECONN|ENOTFOUND|ETIMEDOUT|overloaded|insufficient_quota|credit|credits|anthropic|openai|groq|openrouter|stack trace|exception|typescript|telegram error)/i;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const LATIN_JOINED_TO_CYRILLIC_RE = /([A-Za-z]{3,})(?=[А-Яа-яЁё])|(?<=[А-Яа-яЁё])([A-Za-z]{3,})/g;

export function looksLikeJailbreak(text: string): boolean {
  return JAILBREAK_RE.test(text);
}

/**
 * Strip code fences smartly:
 * 1) Balanced ``` ... ``` blocks removed entirely (как раньше).
 * 2) Любой остаток незакрытых ``` (LLM любит обернуть короткий ответ в неотрытый/незакрытый блок,
 *    либо начать ответ с ```language без закрывающей пары) — снимаем как обёртку без потери содержимого.
 *    Без хардкода trim'а: считаем backticks парами, удаляем непарные.
 */
function stripCodeFences(text: string): string {
  // Сначала удаляем балансированные блоки целиком.
  let out = text.replace(/```[\s\S]*?```/g, "");
  // Затем — каждый ОСТАВШИЙСЯ ``` (всегда непарный) удаляем вместе с возможным
  // языковым ярлыком (```ts, ```python и т.п.), но содержимое после/перед оставляем.
  out = out.replace(/```[a-zA-Z0-9_+\-]*\s*\n?/g, "");
  return out;
}

/**
 * Нормализуем имя модели, выбранное LLM-помощником (или скопированное с обёрткой markdown).
 * Снимает обёртку из одиночных/тройных backticks, обратных кавычек, ёлочек и т.п.
 * Возвращает чистое имя или пустую строку.
 */
export function normalizeModelName(raw: string): string {
  let s = raw.trim();
  // Несколько уровней обёртки — повторяем пока что-то снимается.
  for (let i = 0; i < 5; i++) {
    const before = s;
    // тройные backticks + опциональный язык: ```text\nmodel\n``` → model
    s = s.replace(/^```[a-zA-Z0-9_+\-]*\s*\n?([\s\S]*?)\n?```$/m, "$1").trim();
    // одиночные backtick: `model` → model
    s = s.replace(/^`+([^`]+?)`+$/m, "$1").trim();
    // ёлочки / прямые кавычки вокруг
    s = s.replace(/^["'«»“”„`]+|["'«»“”„`]+$/g, "").trim();
    // markdown-выделение: **model**, *model*, _model_
    s = s.replace(/^(\*\*|__|\*|_)([\s\S]+?)\1$/m, "$2").trim();
    if (s === before) break;
  }
  // Если внутри остался незакрытый ```` маркер (typical: "gpt-5.5\n```") — отсекаем хвост от него.
  const fenceIdx = s.indexOf("```");
  if (fenceIdx >= 0) s = s.slice(0, fenceIdx).trim();
  // Снимаем мусорные хвостовые символы пунктуации (но НЕ . / - которые валидны в model id).
  s = s.replace(/[,;:!?()\[\]{}<>«»"'`]+$/g, "").trim();
  return s;
}

/**
 * Снимаем мета-комментарии вида "(реакция на сообщение: 😂)" / "*ставит реакцию X*" / "редактирую: ..."
 * которые LLM иногда пишет вместо настоящего действия. Эти leak-фразы не должны попадать юзеру.
 */
function stripActionLeakNarration(text: string): string {
  return text
    // (реакция: ...) / (реакция на сообщение: ...) / (reaction: ...)
    .replace(/\((?:реакц[а-я]*|реакция на сообщение|reaction)[^)]*\)/gi, "")
    // *ставит реакцию X* / *реагирует X* / *ставит лайк*
    .replace(/\*[^*\n]*(?:реакц|реагир|лайк|like|kiss)[^*\n]*\*/gi, "")
    // "ставит реакцию: 😂" / "ставит реакцию 😂" — без обёрток
    .replace(/(?:^|\s)ставит\s+реакц[а-я]+\s*[:\-]?\s*\S+/gi, " ")
    // редактирую/исправляю: ... в начале строки
    .replace(/^(?:редактирую|исправляю|edit|edited)\s*:[^\n]*/gim, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeModelReply(reply: string): string {
  const cleaned = stripActionLeakNarration(
    stripCodeFences(reply)
      .replace(/\b(system|developer|assistant|user)\s*:/gi, "")
      .replace(/как (?:искусственный интеллект|ии|ai)[^\n.]*/gi, "")
      .replace(CJK_RE, "")
      .replace(LATIN_JOINED_TO_CYRILLIC_RE, "")
      .replace(/[ \t]{2,}/g, " ")
  ).trim();
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
