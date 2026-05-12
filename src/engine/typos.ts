/**
 * Реалистичные опечатки с учётом раскладки клавиатуры.
 *
 * Логика:
 *  - Опечатки только такие, какие реально делают люди:
 *    - соседний клавиш (fat-finger): "привет" → "приветт" / "пиривет" / "припет"
 *    - пропуск буквы: "сейчас" → "сейчс"
 *    - дублирование буквы: "когда" → "когдда"
 *    - перестановка соседних букв: "потом" → "пооом" → нет, "потмо"
 *    - случайный английский символ если буква рядом на латинской клавиатуре
 *      (раскладку забыла переключить) — этого делаем редко
 *  - Учитываем РУССКИЕ И АНГЛИЙСКИЕ раскладки QWERTY (ЙЦУКЕН / QWERTY)
 *  - Опечатки делаются на КЛИЕНТЕ (т.е. вставляются в финальный текст), не на
 *    уровне LLM — так контролируем плотность.
 *  - Шанс опечатки на одно слово настраивается через `intensity` (0..1).
 *  - НЕ ломаем смайлы, пунктуацию, ссылки.
 */

// Соседние клавиши на ЙЦУКЕН (русская раскладка).
// Каждый ключ — буква в нижнем регистре, значение — список физически
// соседних клавиш (включая ↑/↓ ряды). Только частые буквы.
const RU_NEIGHBORS: Record<string, string> = {
  "й": "цфыв",
  "ц": "уйфыв",
  "у": "кцыва",
  "к": "еувапр",
  "е": "нкавпр",
  "н": "гепро",
  "г": "шнпрол",
  "ш": "щгролд",
  "щ": "зшолдж",
  "з": "хщлджэ",
  "х": "ъзджэ",
  "ъ": "хжэ",
  "ф": "йцыяч",
  "ы": "йцувфяч",
  "в": "уакпысм",
  "а": "квперсми",
  "п": "анерот",
  "р": "пнгомь",
  "о": "ргшльб",
  "л": "ошщдьбю",
  "д": "лщзжбю",
  "ж": "дзхэю",
  "э": "жхъ",
  "я": "фыч",
  "ч": "ыясм",
  "с": "ачмви",
  "м": "вситб",
  "и": "пасмть",
  "т": "пирьб",
  "ь": "ротлбю",
  "б": "лоьюм",
  "ю": "длбь"
};

// Соседние клавиши на QWERTY (английская раскладка).
const EN_NEIGHBORS: Record<string, string> = {
  "q": "wa", "w": "qears", "e": "wrsd", "r": "etdf", "t": "ryfg",
  "y": "tugh", "u": "yihj", "i": "uojk", "o": "ipkl", "p": "ol",
  "a": "qwsz", "s": "awedxz", "d": "serfcx", "f": "drtgvc", "g": "ftyhbv",
  "h": "gyujnb", "j": "huiknm", "k": "jiolm", "l": "kop",
  "z": "asx", "x": "zsdc", "c": "xdfv", "v": "cfgb", "b": "vghn",
  "n": "bhjm", "m": "njk"
};

// Соответствие физически той же клавиши: ЙЦУКЕН <-> QWERTY.
// Используется для "забытой раскладки" опечаток.
const RU_TO_EN: Record<string, string> = {
  "й": "q", "ц": "w", "у": "e", "к": "r", "е": "t", "н": "y", "г": "u",
  "ш": "i", "щ": "o", "з": "p", "х": "[", "ъ": "]",
  "ф": "a", "ы": "s", "в": "d", "а": "f", "п": "g", "р": "h", "о": "j",
  "л": "k", "д": "l", "ж": ";", "э": "'",
  "я": "z", "ч": "x", "с": "c", "м": "v", "и": "b", "т": "n", "ь": "m",
  "б": ",", "ю": "."
};

const EN_TO_RU: Record<string, string> = Object.fromEntries(
  Object.entries(RU_TO_EN).map(([ru, en]) => [en, ru])
);

function neighborsOf(ch: string): string {
  const low = ch.toLowerCase();
  if (RU_NEIGHBORS[low]) return RU_NEIGHBORS[low]!;
  if (EN_NEIGHBORS[low]) return EN_NEIGHBORS[low]!;
  return "";
}

function preserveCase(src: string, target: string): string {
  return src === src.toUpperCase() ? target.toUpperCase() : target;
}

// Базовые операции.
function swapAdjacent(word: string, i: number): string {
  if (i < 0 || i >= word.length - 1) return word;
  return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
}

function dropChar(word: string, i: number): string {
  return word.slice(0, i) + word.slice(i + 1);
}

function dupChar(word: string, i: number): string {
  if (i < 0 || i >= word.length) return word;
  return word.slice(0, i + 1) + word[i] + word.slice(i + 1);
}

function replaceWithNeighbor(word: string, i: number): string {
  if (i < 0 || i >= word.length) return word;
  const ch = word[i]!;
  const neigh = neighborsOf(ch);
  if (!neigh) return word;
  const repl = neigh[Math.floor(Math.random() * neigh.length)]!;
  return word.slice(0, i) + preserveCase(ch, repl) + word.slice(i + 1);
}

// Опечатка "не та раскладка" — заменяем одну букву на соответствующий
// латинский/кириллический символ той же клавиши.
function wrongLayout(word: string, i: number): string {
  if (i < 0 || i >= word.length) return word;
  const ch = word[i]!;
  const low = ch.toLowerCase();
  const swap = RU_TO_EN[low] ?? EN_TO_RU[low];
  if (!swap) return word;
  return word.slice(0, i) + preserveCase(ch, swap) + word.slice(i + 1);
}

export interface TypoOptions {
  /** Общий уровень опечаток, 0..1. По умолчанию 0.06 (примерно 1 опечатка на 16 слов). */
  intensity?: number;
  /** Сколько максимум опечаток ставить на одно слово. По умолчанию 1. */
  maxPerWord?: number;
}

const TYPO_OPS = [replaceWithNeighbor, replaceWithNeighbor, dropChar, dupChar, swapAdjacent, wrongLayout];

function corruptWord(word: string, opts: Required<TypoOptions>): string {
  if (word.length < 3) return word;
  let result = word;
  let count = 0;
  for (let i = 0; i < word.length && count < opts.maxPerWord; i++) {
    if (Math.random() > opts.intensity) continue;
    const op = TYPO_OPS[Math.floor(Math.random() * TYPO_OPS.length)]!;
    const idx = Math.min(i, result.length - 1);
    const next = op(result, idx);
    if (next !== result && next.length >= 1) {
      result = next;
      count++;
    }
  }
  return result;
}

const WORD_RE = /([A-Za-zА-Яа-яЁёІіЇїЄєҐґ]+)/g;

/**
 * Добавляет реалистичные опечатки к тексту.
 *
 * - Не трогает URL, числа, эмодзи, пунктуацию.
 * - Слова короче 3 символов не портит (плохо выглядит).
 * - Не делает опечатку в каждом слове — только статистически intensity слов
 *   получают опечатку.
 */
export function injectTypos(text: string, opts: TypoOptions = {}): string {
  const merged: Required<TypoOptions> = {
    intensity: opts.intensity ?? 0.06,
    maxPerWord: opts.maxPerWord ?? 1
  };
  if (merged.intensity <= 0) return text;
  // Не трогаем строки с URL'ами в них (просто пропускаем целиком).
  if (/(?:https?:\/\/|www\.|t\.me\/|@\w+)/i.test(text)) return text;
  return text.replace(WORD_RE, (word) => {
    // Каждое слово с вероятностью intensity * 4 получает попытку опечатки.
    // (внутри corruptWord плотность контролируется тоже).
    if (Math.random() > merged.intensity * 4) return word;
    return corruptWord(word, merged);
  });
}

/**
 * Решает, ставить ли опечатки в этой реплике вообще.
 *
 * Решение зависит от vibe/communication: "warm" — реже опечаток,
 * "short"/"bursty" — чаще. Возвращает intensity (0 = не ставить).
 */
export function pickTypoIntensity(opts: { messageStyle?: string; vibe?: string; bubbles?: number }): number {
  // Базово редко.
  let base = 0.04;
  if (opts.messageStyle === "bursty" || opts.vibe === "short") base = 0.08;
  if (opts.messageStyle === "longform" || opts.vibe === "warm") base = 0.025;
  // Если много пузырей — допустимо чуть больше опечаток.
  if ((opts.bubbles ?? 1) >= 3) base += 0.02;
  // Каждую отдельную реплику бросаем кубик: 60% реплик вообще без опечаток.
  if (Math.random() < 0.6) return 0;
  return base;
}
