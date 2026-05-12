// Минимальный markdown → safe HTML рендер. Без внешних зависимостей.
// Поддержка: # заголовки, **bold**, *italic*, `code`, ```code```,
// списки, блок-цитаты, ссылки, картинки, hr, простые таблицы.

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function esc(text: string): string {
  return text.replace(/[&<>"']/g, ch => ESCAPE[ch]!);
}

function renderInline(text: string): string {
  let out = esc(text);
  // images first
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) =>
    `<img alt="${esc(alt)}" src="${esc(src)}"${title ? ` title="${esc(title)}"` : ""} />`);
  // links
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) =>
    `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""} target="_blank" rel="noopener">${label}</a>`);
  // bold + italic
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");
  // inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // strikethrough
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return out;
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = "";
  let inList = false;
  let listType: "ul" | "ol" | null = null;
  let inQuote = false;
  let quoteBuf: string[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];

  function flushList() {
    if (inList && listType) { out.push(`</${listType}>`); inList = false; listType = null; }
  }
  function flushQuote() {
    if (inQuote) {
      out.push(`<blockquote>${quoteBuf.map(renderInline).join("<br/>")}</blockquote>`);
      inQuote = false; quoteBuf = [];
    }
  }
  function flushTable() {
    if (inTable) {
      out.push("<table><thead><tr>" + tableHeader.map(c => `<th>${renderInline(c.trim())}</th>`).join("") + "</tr></thead><tbody>");
      for (const row of tableRows) {
        out.push("<tr>" + row.map(c => `<td>${renderInline(c.trim())}</td>`).join("") + "</tr>");
      }
      out.push("</tbody></table>");
      inTable = false; tableHeader = []; tableRows = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (inCode) {
      if (/^```/.test(line)) {
        out.push(`<pre><code class="lang-${esc(codeLang)}">${esc(codeBuf.join("\n"))}</code></pre>`);
        inCode = false; codeBuf = []; codeLang = "";
      } else {
        codeBuf.push(line);
      }
      continue;
    }
    const codeOpen = /^```(\w+)?\s*$/.exec(line);
    if (codeOpen) {
      flushList(); flushQuote(); flushTable();
      inCode = true; codeLang = codeOpen[1] ?? "";
      continue;
    }

    // table?
    if (/^\|.+\|$/.test(line) && lines[i + 1] && /^\|[\s\-|:]+\|$/.test(lines[i + 1]!)) {
      flushList(); flushQuote();
      tableHeader = line.replace(/^\||\|$/g, "").split("|");
      i++; // skip the divider
      tableRows = [];
      while (lines[i + 1] && /^\|.+\|$/.test(lines[i + 1]!)) {
        i++;
        tableRows.push(lines[i]!.replace(/^\||\|$/g, "").split("|"));
      }
      inTable = true;
      flushTable();
      continue;
    }

    // headers
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      flushList(); flushQuote(); flushTable();
      const level = h[1]!.length;
      out.push(`<h${level}>${renderInline(h[2]!)}</h${level}>`);
      continue;
    }
    // hr
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushList(); flushQuote(); flushTable();
      out.push("<hr/>");
      continue;
    }
    // blockquote
    if (/^>\s?/.test(line)) {
      flushList(); flushTable();
      inQuote = true;
      quoteBuf.push(line.replace(/^>\s?/, ""));
      continue;
    } else flushQuote();
    // ordered / unordered list
    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ol) {
      if (!inList || listType !== "ol") { flushList(); out.push("<ol>"); inList = true; listType = "ol"; }
      out.push(`<li>${renderInline(ol[2]!)}</li>`);
      continue;
    }
    if (ul) {
      if (!inList || listType !== "ul") { flushList(); out.push("<ul>"); inList = true; listType = "ul"; }
      out.push(`<li>${renderInline(ul[1]!)}</li>`);
      continue;
    } else flushList();
    // empty line → paragraph break
    if (!line.trim()) { out.push(""); continue; }
    // default — paragraph
    out.push(`<p>${renderInline(line)}</p>`);
  }
  flushList();
  flushQuote();
  flushTable();
  if (inCode) {
    out.push(`<pre><code class="lang-${esc(codeLang)}">${esc(codeBuf.join("\n"))}</code></pre>`);
  }
  // collapse adjacent <p> after empty lines
  return out.filter(Boolean).join("\n");
}
