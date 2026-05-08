// Симуляция её ЖИЗНИ ВНЕ диалога. Каждый день генерируется расписание + ленивые "события дня".
// Используется в системном промпте: "сейчас ты на работе / в дороге / у подруги Кати".
// Кэшируется в data/<slug>/daily-life/YYYY-MM-DD.md по её локальной дате.

import type { LLMClient } from "../llm/index.js";
import type { ProfileConfig } from "../types.js";
import { readMd, writeMd } from "../storage/md.js";
import type { ConflictState } from "./conflict.js";

export interface DailyLifeBlock {
  fromHour: number;     // 0..23 в её локальном tz
  toHour: number;
  activity: string;     // "на работе", "у подруги Кати", "тренировка", "дорога домой"
  mood?: string;        // короткое настроение в эту фазу: "подзаебала Лена", "впервые за неделю выспалась"
  social: "alone" | "with-friends" | "with-family" | "with-coworkers" | "in-transit";
  phoneAvailable: boolean; // может ли отвечать в тг
}

export interface DailyLife {
  dateLocal: string;    // YYYY-MM-DD её локального дня
  weather?: string;     // короткое
  vibe: string;         // 1 строка общего настроения дня ("вяло, недосып", "огонь, день заебись")
  blocks: DailyLifeBlock[];
  /** Случайные мини-события которые произошли ИЛИ произойдут (1-3 шт) */
  events: string[];
  /** Что она сейчас "хочет" в течение дня (внутренние мотивы) */
  wants: string[];
}

function localDateStr(tz: string, now = new Date()): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function localHour(tz: string, now = new Date()): number {
  try {
    return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now), 10);
  } catch { return now.getHours(); }
}

function localWeekday(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
  } catch { return ""; }
}

const SYS = `Ты — режиссёр повседневной жизни персонажа. Сгенерируй ОДИН день её жизни. Никакого пафоса, никаких событий «голливудского масштаба» — обычная жизнь обычной девушки в этом возрасте: школа/колледж/универ/работа по возрасту, рутина, подруги, родители, мелкие конфликты, мысли о прошлой ночи, недосып, проблемы с одеждой, прыщ на лбу, тренировка, разговор с мамой. НЕ выдумывай парня — парень это тот с кем она в тг переписывается, его в blocks НЕ упоминать.`;

function buildPrompt(cfg: ProfileConfig, persona: string, weekday: string, dateLocal: string, conflict: ConflictState | null): string {
  const conflictNote = conflict && conflict.level > 0
    ? `\n\nВАЖНО: у неё сейчас КОНФЛИКТ с ним (level ${conflict.level}, причина: "${conflict.reason ?? "—"}"). Это влияет на её день:\n- Level 1: лёгкая обида — день чуть более вялый, меньше тёплых событий\n- Level 2: серьёзная обида — день мрачнее, больше бытовых проблем, меньше общения\n- Level 3+: сильный конфликт — день тяжёлый, она раздражена, события негативные, хочет побыть одна\n- В blocks/events/wants отрази это настроение.`
    : "";

  const busyNote = cfg.busySchedule && cfg.busySchedule.length > 0
    ? `\n\nЕё расписание занятости (busySchedule):\n${cfg.busySchedule.map(s => `- ${s.label}: ${s.from}-${s.to}${s.days ? ` (${s.days.join(", ")})` : ""}`).join("\n")}\n\nУЧИТЫВАЙ это при генерации blocks: если busySlot перекрывает время, activity должна соответствовать. Для возраста до 17 лет используй "в школе", "на уроке", "уроки", "перемена"; НЕ используй "пара", "лекция", "универ", "препод". Для 17+ можно колледж/универ если подходит persona. phoneAvailable=false только когда телефон реально недоступен.`
    : "";

  return `Имя: ${cfg.name}, ${cfg.age}. Стадия отношений с ним: ${cfg.stage}. Часовой пояс: ${cfg.tz}. Сегодня: ${weekday}, ${dateLocal}.${conflictNote}${busyNote}

Персона (выжимка):
${persona.slice(0, 1200)}

ОБРАТИ ВНИМАНИЕ на её график сна. Она ложится спать в ${cfg.sleepFrom}:00 и просыпается в ${cfg.sleepTo}:00.
Расписание (blocks) должно покрывать ТОЛЬКО её активное время бодрствования (все часы суток, кроме времени сна).

Сгенерируй STRICT JSON структуру:
{
  "vibe": "1 предложение, как она ощущает себя сегодня (вяло/устала/отдохнула/злая/в моменте)",
  "weather": "город+погода, короткой строкой по её региону",
  "blocks": [
    { "fromHour": ${cfg.sleepTo}, "toHour": ${cfg.sleepTo === 23 ? 0 : cfg.sleepTo + 1}, "activity": "просыпается, ленится, скроллит тг в кровати", "mood": "не выспалась", "social": "alone", "phoneAvailable": true },
    ... (всего 6-9 блоков, покрыть всё время её бодрствования; включи учёбу/работу если по persona актуально, обед, тренировку или нет, время с подругой/одна/с семьёй)
  ],
  "events": ["2-3 случайных мини-события которые сегодня происходят (преподша наорала / в кафе ошиблись с заказом / подруга позвала на тусу / разболелась голова)"],
  "wants": ["2-4 её сегодняшних внутренних желания (выспаться / новый кардиган посмотреть / увидеться с Машей / не общаться ни с кем час)"]
}

Правила social:
- "alone" — одна (дома, в дороге одна, прогулка одна)
- "with-friends" — с подругами
- "with-family" — с мамой/братом/сестрой
- "with-coworkers" — на работе/учёбе
- "in-transit" — в маршрутке/метро/такси

phoneAvailable=false когда: спит, тренировка (зал), важное занятие/заседание, баня/душ. Для СКУЧНЫХ уроков/лекций/заседаний — phoneAvailable=true (она заходит в Telegram каждые несколько минут под партой/столом, быстро проверяет, может ответить коротко, но может и не заметить сразу). Если ей меньше 17, называй это "уроки/школа", не "пары/лекции".

Только JSON, без комментариев.`;
}

export async function loadOrGenerateDailyLife(
  llm: LLMClient,
  cfg: ProfileConfig,
  now = new Date(),
  conflict: ConflictState | null = null
): Promise<DailyLife> {
  const dateLocal = localDateStr(cfg.tz, now);
  const path = `daily-life/${dateLocal}.md`;
  const existing = await readMd(cfg.slug, path);
  if (existing) {
    try {
      const m = existing.match(/<!--daily:(.+?)-->/s);
      if (m && m[1]) return JSON.parse(m[1]) as DailyLife;
    } catch { /* regenerate */ }
  }

  const persona = await readMd(cfg.slug, "persona.md");
  const weekday = localWeekday(cfg.tz, now);
  let dl: DailyLife;
  try {
    const raw = await llm.chat(
      [
        { role: "system", content: SYS },
        { role: "user", content: buildPrompt(cfg, persona, weekday, dateLocal, conflict) }
      ],
      { temperature: 0.95, maxTokens: 3500, json: true }
    );
    const parsed = JSON.parse(raw);
    dl = {
      dateLocal,
      weather: typeof parsed.weather === "string" ? parsed.weather : undefined,
      vibe: typeof parsed.vibe === "string" ? parsed.vibe : "обычный день",
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      wants: Array.isArray(parsed.wants) ? parsed.wants : []
    };
  } catch {
    dl = { dateLocal, vibe: "обычный день", blocks: [], events: [], wants: [] };
  }

  // Сохраняем
  const human = renderDailyLifeHuman(dl);
  await writeMd(cfg.slug, path, `${human}\n\n<!--daily:${JSON.stringify(dl)}-->\n`);
  return dl;
}

export function renderDailyLifeHuman(dl: DailyLife): string {
  const lines: string[] = [];
  lines.push(`# День ${dl.dateLocal}`);
  if (dl.weather) lines.push(`погода: ${dl.weather}`);
  lines.push(`vibe: ${dl.vibe}`);
  if (dl.blocks?.length) {
    lines.push("");
    lines.push("## Расписание");
    for (const b of dl.blocks) {
      lines.push(`- ${String(b.fromHour).padStart(2, "0")}:00–${String(b.toHour).padStart(2, "0")}:00 — ${b.activity} [${b.social}${b.phoneAvailable ? "" : ", без телефона"}]${b.mood ? ` (${b.mood})` : ""}`);
    }
  }
  if (dl.events?.length) {
    lines.push("");
    lines.push("## Сегодняшние мини-события");
    dl.events.forEach(e => lines.push(`- ${e}`));
  }
  if (dl.wants?.length) {
    lines.push("");
    lines.push("## Чего хочет сегодня");
    dl.wants.forEach(e => lines.push(`- ${e}`));
  }
  return lines.join("\n");
}

export function currentBlock(dl: DailyLife, tz: string, now = new Date()): DailyLifeBlock | undefined {
  const h = localHour(tz, now);
  return dl.blocks?.find(b => h >= b.fromHour && h < b.toHour)
    ?? dl.blocks?.[dl.blocks.length - 1];
}

export function dailyLifePromptFragment(dl: DailyLife, tz: string, now = new Date()): string {
  const b = currentBlock(dl, tz, now);
  const parts = [
    `# Твой сегодняшний день (${dl.dateLocal}) — это ТВОЯ жизнь, не его`,
    `Общий настрой дня: ${dl.vibe}`
  ];
  if (dl.weather) parts.push(`Погода: ${dl.weather}`);
  if (b) {
    parts.push(`Сейчас (${b.fromHour}:00–${b.toHour}:00) ты: ${b.activity}. Социально: ${b.social}.${b.phoneAvailable ? "" : " Телефон сейчас НЕ доступен — отвечать не можешь / не хочешь."}`);
    if (b.mood) parts.push(`Текущее микро-настроение: ${b.mood}`);
  }
  if (dl.events?.length) {
    parts.push(`Что произошло/произойдёт сегодня: ${dl.events.slice(0, 3).join("; ")}`);
  }
  if (dl.wants?.length) {
    parts.push(`Чего ты хочешь сегодня: ${dl.wants.slice(0, 3).join("; ")}`);
  }
  parts.push(`Не вываливай это всё на него сразу. Это для ТЕБЯ — фон. Упоминай естественно когда уместно ("щас на паре", "блин с мамой повздорила", "ща в маршрутке"), не разово как лекцию.`);
  return parts.join("\n");
}
