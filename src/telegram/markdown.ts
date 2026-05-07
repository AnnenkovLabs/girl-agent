/**
 * Telegram message formatting helpers.
 *
 * Strategy:
 *   - Plain text by default (no parse_mode) — safest, no escaping needed.
 *   - If the text contains ||spoiler|| markers, convert to HTML <tg-spoiler>
 *     and send with parse_mode: "HTML". HTML only requires escaping < > &,
 *     which almost never appear in natural conversation (unlike MarkdownV2
 *     which reserves 18+ common characters like . ! ( ) etc.).
 */

export function hasSpoilers(text: string): boolean {
  return /\|\|.+?\|\|/.test(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toHtmlWithSpoilers(text: string): string {
  return escapeHtml(text).replace(/\|\|(.+?)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");
}
