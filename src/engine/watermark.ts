// Скрытая вотермарка на основе zero-width Unicode-символов.
// Кодирует уникальный хеш профиля в невидимую последовательность,
// которая обрезается большинством LLM API и не влияет на качество ответов.

/** Zero-width символы используемые как «биты» */
const ZW = {
  ZERO: "\u200B",   // Zero Width Space        → бит 0
  ONE:  "\u200C",   // Zero Width Non-Joiner   → бит 1
  SEP:  "\u200D",   // Zero Width Joiner       → разделитель
  PAD:  "\uFEFF"    // BOM / Zero Width No-Break Space → обёртка
} as const;

/** Регэкс для очистки всех zero-width символов из строки */
const ZW_STRIP_RE = /[\u200B\u200C\u200D\uFEFF]/g;

/** Простой FNV-1a 32-bit хеш */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Кодирует число в zero-width бинарную строку (32 бита) */
function encodeBits(n: number): string {
  const bits: string[] = [];
  for (let i = 31; i >= 0; i--) {
    bits.push((n >>> i) & 1 ? ZW.ONE : ZW.ZERO);
  }
  return bits.join("");
}

/**
 * Генерирует уникальную невидимую вотермарку для профиля.
 * Вотермарка состоит из:
 *  PAD + encodedHash1 + SEP + encodedHash2 + PAD
 * где hash1 = fnv1a(slug + name), hash2 = fnv1a(name + age + ts_day)
 * Это даёт 64-bit уникальность, привязанную к профилю и дню.
 */
export function generateWatermark(slug: string, name: string, age: number): string {
  const day = new Date().toISOString().slice(0, 10);
  const h1 = fnv1a(`${slug}:${name}:wm`);
  const h2 = fnv1a(`${name}:${age}:${day}:ga`);
  return ZW.PAD + encodeBits(h1) + ZW.SEP + encodeBits(h2) + ZW.PAD;
}

/**
 * Удаляет все zero-width символы из текста.
 * Используется для очистки ответа модели от случайно просочившейся вотермарки.
 */
export function stripWatermark(text: string): string {
  return text.replace(ZW_STRIP_RE, "");
}
