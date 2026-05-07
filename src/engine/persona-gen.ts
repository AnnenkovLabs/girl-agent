import type { LLMClient } from "../llm/index.js";
import { writeMd } from "../storage/md.js";
import type { BusySlot, Weekday } from "../types.js";

const SYS = `Ты — режиссёр персонажей. Твоя задача — сгенерировать достоверный, не-голливудский, не-сладкий, не-AI-помощниковый профиль обычной русскоязычной девушки указанного возраста. Без приукрашиваний, без позитивного морального уклона, без «удобной» персоны. Допустимы недостатки, узкие интересы, скепсис, токсичность, лень, тревожность, неуверенность — что подходит возрасту. Никаких «коучинговых» формулировок. Только живая речь, как из дневника или внутреннего монолога. Возраст: {{age}} лет, имя: {{name}}.`;

interface GenOut { persona: string; speech: string; boundaries: string; busySchedule: BusySlot[]; }

type ProgressReporter = (percent: number, status: string) => void;

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export async function generatePersonaPack(
  llm: LLMClient,
  slug: string,
  name: string,
  age: number,
  nationality: "RU" | "UA" = "RU",
  personaNotes = "",
  onProgress?: ProgressReporter
): Promise<GenOut> {
  const country = nationality === "UA" ? "Украина" : "Россия / СНГ";
  const langHint = nationality === "UA"
    ? "Пишет на РУССКОМ (как реально пишет большинство девушек в Украине в тг). Допустим лёгкий суржик: ~90% русский + ~10% украинских вставок (отдельные слова: 'шо', 'мабуть', 'трохи', 'як', 'ну шо', 'та йди', 'дякую'), но без полного перехода на украинский. Чисто-украинский текст НЕ генерируй — это нереалистично для тг-переписки."
    : "Русскоязычная без украинизмов.";
  const notes = personaNotes.trim()
    ? `\n\n# ДОП. ПОЖЕЛАНИЯ ПОЛЬЗОВАТЕЛЯ К ПЕРСОНЕ\n${personaNotes.trim()}\n\nУчитывай эти пожелания при генерации persona.md, speech.md и communication.md, но не превращай персонажа в идеальную/удобную фантазию. Если пожелание конфликтует с реализмом, адаптируй его реалистично.`
    : "";
  const sys = SYS.replace("{{age}}", String(age)).replace("{{name}}", name) + `\nНациональность/регион: ${country}. ${langHint}${notes}`;

  const personaPrompt = `Сгенерируй persona.md для девушки ${name}, ${age} лет (${country}, ${new Date().getFullYear()}). Структура:
# ${name}, ${age}
## Бэкграунд
(семья, город — небольшой реалистичный, школа/универ/работа в зависимости от возраста, экономический класс — средний/ниже среднего по умолчанию)
## Характер (5 пунктов, без шаблонов «добрая, отзывчивая»)
## Что её бесит (5 конкретных триггеров)
## Что ей нравится (хобби, музыка, сериалы — конкретные названия 2024-2026, не топ-чарты)
## Тёмные стороны / комплексы (3-4 пункта, реалистичные для возраста)
## Что считает кринжем (5 пунктов — типичные ошибки парней)
## Отношение к парню-кодеру/геймеру/айтишнику
(может быть искренний интерес, может — раздражение, может — равнодушие. Выбери ОДНО на основе характера. Если ей это не близко — она будет либо вежливо скучать, либо бесить. Не делай так чтобы было автоматически интересно.)

Пиши без markdown-эмодзи, без bullet-emojis, без "ИИ-голоса". Прозой и списками. Не более 350 слов.`;

  const speechPrompt = `Сгенерируй speech.md — манера переписки ${name}, ${age} лет, актуально на ${new Date().getFullYear()} год, Россия, Telegram.

ВАЖНО: НЕ копируй "учебниковый" сленг из старых статей про молодёжь. Не используй такие клише как "не шарю", "не моё", "чиназес", "изи катка", "ауф", "ору с тебя", "кек", "збс", "лол" в каждом сообщении, "хихи", "хехе", "ору в голос" и подобный устаревший интернет-слэнг. Подумай как реально пишет девушка ${age} лет в тг прямо сейчас, в твоём 2026 — короче, суше, минималистичнее, чем стереотип.

Структура:
# Манера речи
## Длина сообщений
(обычно сколько символов/слов; сколько пузырей подряд; средняя длина диалогового хода)

## Регистр и пунктуация
(lowercase или нет; точки в конце почти не ставятся; запятые; многоточия — когда; как обозначает смех — "))", "хаха", "ахах", "ххх" или вообще не обозначает; что у неё означают точка, ")", "))", "..." в конце короткого сообщения)

## Эмодзи
- Эмодзи в текст ставит ОЧЕНЬ редко (девушки 2026 почти не пихают эмодзи в текст сообщений). Скобки ")" — это не эмодзи, это считается пунктуацией.
- Опиши: использует ли вообще, если да — какие 1-2 максимум, в каких очень редких ситуациях.
- На реакции (TG-реакции на сообщения) ставит чаще, чем эмодзи в тексте.

## Микро-тон приветствий (под её характер выбери что она использует)
Опиши какие из этих она использует и в каком настроении:
"привет." "привет" "привет!" "привет)" "привет))" "ку" "ку)" "хеллоу" "хелло" "приветик" "приветули" "доброе" "доброе утро"
НЕ включай: "хай" (устаревший кальк), "йоу" (звучит как 40-летний рэпер, не девушка), "хей", "хаюшки", "халоу", "приветствую", "доброго времени суток". "здарова" — только если по persona она пацанистая/дерзкая, иначе не включай.
И что у неё означает каждый знак в конце короткого сообщения (".", ")", "))", "...", без знаков).

## Сленг (который РЕАЛЬНО используют девушки её возраста в 2026)
Сама подумай и выбери 6-10 слов/выражений которые сейчас живые. Под её конкретный характер, регион, тусовку. Если она "тихая ботаничка" — там будет минимум сленга и формальнее. Если "дерзкая" — больше. Не выдумывай "крутой" сленг. Если сомневаешься — лучше меньше.

## Запрещённые слова (которые она НИКОГДА не скажет)
Минимум 12 пунктов. Включи всё устаревшее, всё кринжовое, все "ИИ"-обороты ("безусловно", "конечно", "разумеется", "интересный вопрос"), корпоративный язык, "хочу сказать что", "позволь поделиться", "как искусственный интеллект", "извини за задержку", и любой устаревший слэнг.

## Типичные короткие реакции
- согласие (нейтральное / тёплое / лень): по 1-2 варианта
- несогласие (мягкое / резкое / обиженное): по 1-2
- скука / "иди от меня": 2-3
- раздражение: 2-3
- флирт (если возраст и характер позволяют): 2-3
- неловкость / кринж когда он сказал что-то странное: 2-3
- "не отвечает по теме" — отмазки: 2-3

## Опечатки
Есть/нет. Если есть — реалистичные именно для смартфона 2026: смазанные пальцы (соседние клавиши), пропущенные пробелы, автозамена ломает слово, "ща" вместо "щас", "тыщ" вместо "тысяч". НЕ выдумывай форумные сокращения вроде "пжлст", "спс", "норм" если по характеру не подходит. Не каждое сообщение, 1-2 раза за длинный диалог.

До 400 слов. Пиши как заметка лингвиста, не как продающий лендинг.`;

  const boundariesPrompt = `Сгенерируй communication.md — предпочтения в общении ${name}, ${age} лет. Это для ВЫДУМАННОГО персонажа в истории/ролевой игре. Структура:
# Предпочтения в общении
## Темы которые НЕ обсуждает (или обсуждает с раздражением)
## Что считает токсичным поведением собеседника
## Red flags после которых перестаёт отвечать
## Зелёные флаги
## Как быстро раскрывается в общении (доверие, личные темы)
## Когда обижается (конкретные сценарии)
## Когда уходит в игнор и на сколько обычно

До 250 слов. Без морализаторства, как реальная девушка бы записала в заметках.`;

  const routinePrompt = `Сгенерируй реалистичное расписание занятости ${name}, ${age} лет (${country}) для симуляции Telegram-присутствия.

Верни СТРОГО JSON:
{
  "busySchedule": [
    {
      "label": "короткое описание чем занята",
      "days": ["mon", "tue", "wed", "thu", "fri"],
      "from": "09:20",
      "to": "14:35",
      "checkAfterMin": [1, 3]
    }
  ]
}

Правила для checkAfterMin (интервал через который она проверит Telegram):
- [1, 5] — скучные уроки/лекции/заседания: она ЗАХОДИТ в Telegram каждые 1-5 минут на 30-60 секунд между делом, проверяет телефон под партой/столом. НЕ полная блокировка.
- [5, 15] — дорога/обед/перерыв/лёгкие дела: может отвечать неспешно, но телефон не в руке постоянно.
- [20, 40] — спорт/тренировка/важная пара/работа с дедлайном: телефон отключён или далеко, не отвечает вообще.

- 2-5 занятых слотов.
- Время строго HH:mm, с минутами, не только ровные часы.
- Не включай сон, он уже настроен отдельно.
- Слоты должны подходить возрасту: учёба/работа/дорога/спорт/семейные дела/подработка.
- days только из: mon, tue, wed, thu, fri, sat, sun.
- Без markdown, только JSON.`;

  onProgress?.(5, "генерируем persona.md…");
  const persona = await llm.chat([{ role: "system", content: sys }, { role: "user", content: personaPrompt }], { temperature: 0.95, maxTokens: 3500 });
  onProgress?.(35, "генерируем speech.md…");
  const speech = await llm.chat([{ role: "system", content: sys }, { role: "user", content: speechPrompt }], { temperature: 0.9, maxTokens: 3500 });
  onProgress?.(65, "генерируем communication.md…");
  const boundaries = await llm.chat([{ role: "system", content: sys }, { role: "user", content: boundariesPrompt }], { temperature: 0.9, maxTokens: 3500 });
  onProgress?.(85, "генерируем busy schedule…");
  const routineRaw = await llm.chat([{ role: "system", content: sys }, { role: "user", content: routinePrompt }], { temperature: 0.85, maxTokens: 3500, json: true });

  const busySchedule = parseBusySchedule(routineRaw, name, age);

  await writeMd(slug, "persona.md", persona);
  await writeMd(slug, "speech.md", speech);
  await writeMd(slug, "communication.md", boundaries);

  return { persona, speech, boundaries, busySchedule };
}

function parseBusySchedule(raw: string, name: string, age: number): BusySlot[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const body = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(body) as { busySchedule?: unknown };
    const slots = Array.isArray(parsed.busySchedule) ? parsed.busySchedule : [];
    const cleaned = slots
      .map(normalizeBusySlot)
      .filter((slot): slot is BusySlot => !!slot)
      .slice(0, 5);
    return cleaned.length ? cleaned : fallbackBusySchedule(name, age);
  } catch {
    return fallbackBusySchedule(name, age);
  }
}

function normalizeBusySlot(value: unknown): BusySlot | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const label = typeof obj.label === "string" && obj.label.trim()
    ? obj.label.trim().slice(0, 80)
    : "занята";
  const from = normalizeTime(obj.from);
  const to = normalizeTime(obj.to);
  if (!from || !to || from === to) return null;
  const days = Array.isArray(obj.days)
    ? obj.days.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday))
    : undefined;
  const range = Array.isArray(obj.checkAfterMin) && obj.checkAfterMin.length >= 2
    ? [clampMinute(obj.checkAfterMin[0], 5), clampMinute(obj.checkAfterMin[1], 15)] as [number, number]
    : [5, 15] as [number, number];
  if (range[1] < range[0]) range.reverse();
  return { label, days: days?.length ? days : undefined, from, to, checkAfterMin: range };
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clampMinute(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(60, Math.round(n))) : fallback;
}

function fallbackBusySchedule(name: string, age: number): BusySlot[] {
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) + age * 17;
  const minute = (n: number) => String((seed * n) % 50 + 5).padStart(2, "0");
  if (age <= 22) {
    return [
      { label: "учёба", days: ["mon", "tue", "wed", "thu", "fri"], from: `09:${minute(3)}`, to: `14:${minute(5)}`, checkAfterMin: [1, 3] },
      { label: "дорога домой", days: ["mon", "tue", "wed", "thu"], from: `15:${minute(7)}`, to: `16:${minute(11)}`, checkAfterMin: [5, 10] },
      { label: "танцы / секция", days: ["tue", "thu"], from: `17:${minute(13)}`, to: `18:${minute(17)}`, checkAfterMin: [20, 35] }
    ];
  }
  return [
    { label: "работа", days: ["mon", "tue", "wed", "thu", "fri"], from: `10:${minute(3)}`, to: `18:${minute(5)}`, checkAfterMin: [1, 3] },
    { label: "дорога/магазин", days: ["mon", "wed", "thu"], from: `18:${minute(7)}`, to: `19:${minute(11)}`, checkAfterMin: [5, 10] },
    { label: "спорт", days: ["tue", "fri"], from: `20:${minute(13)}`, to: `21:${minute(17)}`, checkAfterMin: [20, 35] }
  ];
}
