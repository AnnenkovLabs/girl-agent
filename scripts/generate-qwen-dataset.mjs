import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.CLAUDEHUB_API_KEY;
if (!apiKey) {
  console.error("Set CLAUDEHUB_API_KEY. Example: CLAUDEHUB_API_KEY=... node scripts/generate-qwen-dataset.mjs");
  process.exit(1);
}

const root = path.resolve(new URL("..", import.meta.url).pathname);
const outDir = path.join(root, "datasets/qwen35-girl-agent");
const client = new Anthropic({ apiKey, baseURL: "https://api.claudehub.fun", timeout: 120_000, maxRetries: 1 });

const categories = [
  { name: "reply_short_realism", count: 18, description: "короткие живые ответы в Telegram на скучные, неловкие, тёплые и конфликтные сообщения" },
  { name: "multi_bubble_dialogue", count: 12, description: "длинноконтекстные диалоги 8-16 ходов с несколькими пузырями через ---" },
  { name: "persona_generation", count: 10, description: "генерация persona.md, speech.md, communication.md и busySchedule для разных возрастов RU/UA" },
  { name: "behavior_decision_json", count: 12, description: "decision layer: строго JSON intent/reaction/delay/moodDelta с учётом сна, занятости, стадии, конфликта" },
  { name: "memory_and_reflection", count: 10, description: "daily summary, long-term memory, memory palace, запрет выдумывать факты" },
  { name: "agenda_and_proactivity", count: 8, description: "agenda extraction, proactive messages, follow-up после событий парня без календарной сухости" },
  { name: "anti_ai_repair", count: 10, description: "переписывание ИИ-слопа в живой русский ответ без англицизмов и странного сленга" }
];

const projectSpec = `girl-agent — движок ИИ-персоны для Telegram. Не ассистент, а девушка с состоянием: сон, presence, daily-life, relationship stages, relationship score (interest, trust, attraction, annoyance, cringe), conflict/cold periods, long-term memory, agenda, реакции, печать, короткие пузырьки. Язык: русский, без англицизмов, без странного/устаревшего сленга, без NSFW.

Критичные правила ответов девушки:
- почти всегда с маленькой буквы, без markdown, без списков, без "конечно", "понимаю", "интересный вопрос", "с радостью", "к сожалению", "как ИИ";
- не обслуживать пользователя, не быть помощницей, не поддерживать разговор из вежливости;
- норма: 1-2 короткие фразы, иногда 2-3 пузыря через строку ---; длинно только при сильной эмоции;
- не заканчивать каждый ответ вопросом;
- не выдумывать факты о собеседнике, если их нет в памяти;
- скучные вопросы вроде "как дела" отвечать приземлённо: "норм", "устала", "лежу", "на парах";
- "ИИ/бот?" — отмахнуться по-человечески, не объяснять устройство;
- реакции и настроение зависят от стадии: холодная стадия не даёт сердечки, конфликт даёт сухость/игнор;
- модель Qwen 3.5 9B Instruct небольшая: примеры должны быть ясными, разнообразными и не перегруженными лишней теорией.`;

const generationSystem = `Ты создаёшь SFT-датасет для Qwen 3.5 9B Instruct под конкретный проект girl-agent. Верни только JSON-массив объектов, без markdown.
Каждый объект обязан иметь:
{
  "messages": [
    {"role":"system","content":"..."},
    {"role":"user","content":"..."},
    {"role":"assistant","content":"..."}
  ],
  "metadata": {
    "category":"...",
    "stage":"...",
    "quality_tags":["..."]
  }
}
Можно делать многоходовые диалоги, но последний ответ assistant должен быть эталоном.
Требования к эталонам:
- русский язык, естественно, без англицизмов там, где есть нормальное русское слово;
- без странного сленга: не используй "чиназес", "ауф", "изи", "краш", "кринж" без необходимости, "лол", "кек", "ору";
- никаких NSFW, несовершеннолетние только безопасные бытовые темы;
- для JSON-задач assistant должен быть валидным JSON без пояснений;
- для обычной переписки assistant — только текст сообщения девушки, без префиксов;
- покрывай боли пользователей: палится как бот, слишком длинно, всегда отвечает, выдумывает память, не умеет игнорить, не учитывает стадию, даёт сердечки рано, говорит как помощник, забывает сон/занятость, не умеет мириться.`;

function stripCodeFence(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }
  return trimmed;
}

async function generateCategory(category) {
  const prompt = `${projectSpec}\n\nКатегория: ${category.name}\nОписание: ${category.description}\nНужно примеров: ${category.count}.\n\nСделай максимально полезные и разнообразные записи. Метаданные category строго "${category.name}".`;
  const res = await client.messages.create({
    model: "claude-sonnet-4.6",
    max_tokens: 16000,
    temperature: 0.7,
    system: generationSystem,
    messages: [{ role: "user", content: prompt }]
  });
  const text = res.content.find(x => x.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch (err) {
    const debugPath = path.join(outDir, `debug-${category.name}.txt`);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(debugPath, text, "utf8");
    throw new Error(`Cannot parse ${category.name}: ${err.message}. Raw saved to ${debugPath}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${category.name}: expected array`);
  return parsed.slice(0, category.count).map((row, i) => ({
    ...row,
    metadata: {
      ...(row.metadata ?? {}),
      category: category.name,
      source: "claudehub_claude_sonnet_4_6",
      target_model: "qwen_3_5_9b_instruct",
      generated_at: "2026-05-15",
      index_in_category: i
    }
  }));
}

function validateRecord(row, idx) {
  if (!row || typeof row !== "object" || !Array.isArray(row.messages)) throw new Error(`row ${idx}: messages missing`);
  if (row.messages.length < 3) throw new Error(`row ${idx}: too few messages`);
  for (const msg of row.messages) {
    if (!["system", "user", "assistant"].includes(msg.role)) throw new Error(`row ${idx}: bad role ${msg.role}`);
    if (typeof msg.content !== "string" || !msg.content.trim()) throw new Error(`row ${idx}: empty content`);
  }
  const last = row.messages[row.messages.length - 1];
  if (last.role !== "assistant") throw new Error(`row ${idx}: last message must be assistant`);
}

const all = [];
for (const category of categories) {
  process.stderr.write(`generating ${category.name}...\n`);
  const rows = await generateCategory(category);
  all.push(...rows);
}
all.forEach(validateRecord);

const evalCategories = new Set(["behavior_decision_json", "memory_and_reflection", "anti_ai_repair", "multi_bubble_dialogue"]);
const evalRows = [];
const trainRows = [];
const byCategoryTaken = new Map();
for (const row of all) {
  const category = row.metadata.category;
  const taken = byCategoryTaken.get(category) ?? 0;
  if (evalCategories.has(category) && taken < 2) {
    evalRows.push(row);
    byCategoryTaken.set(category, taken + 1);
  } else {
    trainRows.push(row);
  }
}

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "train.jsonl"), trainRows.map(x => JSON.stringify(x)).join("\n") + "\n", "utf8");
await fs.writeFile(path.join(outDir, "eval.jsonl"), evalRows.map(x => JSON.stringify(x)).join("\n") + "\n", "utf8");
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify({
  name: "qwen35-girl-agent",
  target_model: "Qwen 3.5 9B Instruct",
  format: "jsonl messages",
  generated_with: { provider: "ClaudeHub", model: "claude-sonnet-4.6" },
  generated_at: "2026-05-15",
  train_records: trainRows.length,
  eval_records: evalRows.length,
  categories: categories.map(c => ({ name: c.name, count: c.count, description: c.description }))
}, null, 2) + "\n", "utf8");
console.log(`wrote ${trainRows.length} train and ${evalRows.length} eval records`);
