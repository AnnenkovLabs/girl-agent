/**
 * Confidentiality guard для исходящих сообщений клиенту (Task 4.1 manager-mode,
 * Requirement 7).
 *
 * Гарантирует, что финальный текст клиенту не содержит:
 *  - непрерывного фрагмента длиной более 80 символов из резюме боссу или
 *    `mandate.md` (Requirement 7.2);
 *  - непрерывного фрагмента длиной более 20 символов из других источников,
 *    которые caller передаёт в `crossSources` (другие тикеты, чужие
 *    Boss_Reply'и и т.п.) (Requirement 7.4).
 *
 * Сравнение без учёта регистра, с учётом всех пробельных символов и
 * пунктуации. Никакой нормализации Unicode не делаем — это снижает поверхность
 * парадоксов (`A` vs `А`).
 *
 * Алгоритм линейный: для каждого источника пробегаем посимвольно, ища первое
 * вхождение префикса длиной `threshold + 1`, начиная с любой позиции в
 * клиентском тексте (двойной цикл). Длинные исходники режутся на скользящие
 * окна. Это O(N · M · K) в худшем случае, где K = `threshold + 1`. Для
 * типичных длин (≤4000 символов клиентского текста, ≤4000 символов мандата)
 * это в пределах ~1 мс, что устраивает все рантайм-сценарии.
 */

export interface ConfidentialityViolation {
  kind: "summary-overlap" | "mandate-overlap" | "cross-ticket-leak";
  /** Длина обнаруженного непрерывного фрагмента. */
  matchLength: number;
  /** Позиция начала фрагмента в клиентском тексте. */
  clientPos: number;
  /** Идентификатор источника (например `#T-42` или `mandate`). */
  sourceLabel: string;
  /** Сам матч (для логов). */
  matchSample: string;
}

export interface ConfidentialityGuardOptions {
  /** Резюме, отправленное боссу по этому же тикету. */
  summary?: string;
  /** Полный текст mandate.md. */
  mandate?: string;
  /**
   * Дополнительные источники, утечка из которых ловится с порогом 20.
   * Например: тексты других тикетов, summary других контактов.
   */
  crossSources?: Array<{ label: string; text: string }>;
  /** Порог утечки из summary/mandate. По умолчанию 80 (Requirement 7.2). */
  primaryThreshold?: number;
  /** Порог cross-leak. По умолчанию 20 (Requirement 7.4). */
  crossThreshold?: number;
}

const DEFAULT_PRIMARY = 80;
const DEFAULT_CROSS = 20;

/**
 * Возвращает первое нарушение или `null`. Не бросает — caller сам решает
 * (re-escalate, лог, отправка). Вернуть violation быстрее, чем перебрать все —
 * для guard'а важно не пропустить хоть одно.
 */
export function findConfidentialityViolation(
  clientText: string,
  opts: ConfidentialityGuardOptions
): ConfidentialityViolation | null {
  const primary = opts.primaryThreshold ?? DEFAULT_PRIMARY;
  const cross = opts.crossThreshold ?? DEFAULT_CROSS;

  const client = clientText;
  if (!client || client.length === 0) return null;

  if (opts.summary && opts.summary.length > primary) {
    const m = findOverlap(client, opts.summary, primary);
    if (m) {
      return {
        kind: "summary-overlap",
        matchLength: m.length,
        clientPos: m.clientPos,
        sourceLabel: "summary",
        matchSample: client.slice(m.clientPos, m.clientPos + Math.min(m.length, 120))
      };
    }
  }
  if (opts.mandate && opts.mandate.length > primary) {
    const m = findOverlap(client, opts.mandate, primary);
    if (m) {
      return {
        kind: "mandate-overlap",
        matchLength: m.length,
        clientPos: m.clientPos,
        sourceLabel: "mandate",
        matchSample: client.slice(m.clientPos, m.clientPos + Math.min(m.length, 120))
      };
    }
  }
  if (opts.crossSources && opts.crossSources.length) {
    for (const src of opts.crossSources) {
      if (!src.text || src.text.length <= cross) continue;
      const m = findOverlap(client, src.text, cross);
      if (m) {
        return {
          kind: "cross-ticket-leak",
          matchLength: m.length,
          clientPos: m.clientPos,
          sourceLabel: src.label,
          matchSample: client.slice(m.clientPos, m.clientPos + Math.min(m.length, 60))
        };
      }
    }
  }
  return null;
}

/**
 * Удобная обёртка: бросает на нарушении, иначе возвращает void. Используется
 * в `composeAndSendToClient` / boss-reply flow.
 */
export function assertNoLeak(
  clientText: string,
  opts: ConfidentialityGuardOptions
): void {
  const v = findConfidentialityViolation(clientText, opts);
  if (v) {
    const err = new Error(
      `confidentiality leak (${v.kind}): ${v.matchLength} chars from ${v.sourceLabel} at pos ${v.clientPos}`
    );
    (err as Error & { violation?: ConfidentialityViolation }).violation = v;
    throw err;
  }
}

interface OverlapMatch {
  length: number;
  clientPos: number;
  sourcePos: number;
}

/**
 * Ищет первый непрерывный посимвольный фрагмент длиной > `threshold`,
 * присутствующий и в `client`, и в `source`. Сравнение case-insensitive, без
 * нормализации Unicode. Возвращает максимальную найденную длину для первой
 * стартовой позиции в клиентском тексте (с учётом пунктуации).
 */
function findOverlap(client: string, source: string, threshold: number): OverlapMatch | null {
  if (client.length <= threshold || source.length <= threshold) return null;
  const c = client.toLowerCase();
  const s = source.toLowerCase();
  const minMatch = threshold + 1;

  // Скользящее окно по client. Для каждой стартовой позиции i ищем самое
  // длинное совпадение в s. Если оно ≥ minMatch — фиксируем.
  for (let i = 0; i <= c.length - minMatch; i++) {
    const sub = c.slice(i, i + minMatch);
    const j = s.indexOf(sub);
    if (j === -1) continue;
    // Нашли префикс длиной minMatch — попробуем расширить.
    let len = minMatch;
    while (i + len < c.length && j + len < s.length && c[i + len] === s[j + len]) {
      len++;
    }
    return { length: len, clientPos: i, sourcePos: j };
  }
  return null;
}
