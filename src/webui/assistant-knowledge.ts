import { COMMUNICATION_PRESETS } from "../presets/communication.js";
import { LLM_PRESETS } from "../presets/llm.js";
import { STAGE_PRESETS } from "../presets/stages.js";

export interface KnowledgeArticle {
  category: string;
  subcategory: string;
  title: string;
  keywords: string[];
  body: string;
}

const CORE_KNOWLEDGE_BASE: KnowledgeArticle[] = [
  {
    category: "overview",
    subcategory: "product",
    title: "Что такое girl-agent",
    keywords: ["проект", "girl-agent", "бот", "что это", "концепция", "архитектура", "идея"],
    body: "girl-agent — движок Telegram-персоны, а не обычный чат-бот. Он симулирует живое поведение девушки: онлайн/офлайн, сон, занятость, настроение, память, стадии отношений, конфликты, задержки, реакции, стикеры, опечатки и проактивные сообщения. README прямо подчёркивает: она не отвечает на каждое сообщение, иногда читает и молчит — это задумано."
  },
  {
    category: "overview",
    subcategory: "layers",
    title: "Слоистая архитектура",
    keywords: ["слои", "архитектура", "runtime", "prompt", "behavior", "presence", "memory"],
    body: "Поведение собирается из нескольких слоёв: Telegram adapter принимает события; Runtime оркестрирует state; presence решает доступность; behavior-tick выбирает intent/delay/reaction; prompt собирает persona/speech/boundaries/relationship/memory; LLM пишет текст; storage фиксирует логи, score, memory, agenda. Поэтому проблему нельзя объяснять одним system prompt — почти всегда надо смотреть слой, который отвечает за симптом."
  },
  {
    category: "overview",
    subcategory: "tech-stack",
    title: "Технологии проекта",
    keywords: ["стек", "typescript", "node", "react", "vite", "grammy", "gramjs", "tsup", "rust", "desktop"],
    body: "Runtime: Node.js >=20, TypeScript strict, ESM. Build: tsup в dist/cli.js. WebUI: React + Vite. Telegram: grammY для bot mode и GramJS/telegram для userbot. LLM: OpenAI-compatible и Anthropic SDK. Desktop: Rust/iced в desktop-rs. Импорты TypeScript используют .js extension."
  },
  {
    category: "overview",
    subcategory: "project-structure",
    title: "Карта директорий",
    keywords: ["директории", "файлы", "структура", "src", "engine", "webui", "telegram", "storage"],
    body: "src/engine — ядро поведения: runtime, presence, behavior-tick, prompt, memory-palace, conflict, agenda, daily-life. src/telegram — bot/userbot adapters. src/llm — клиенты провайдеров. src/storage/md.ts — файловое хранилище профилей. src/webui — HTTP API, runtime bus, routes. webui/src — React страницы. src/presets — stages, llm, communication."
  },
  {
    category: "overview",
    subcategory: "commands",
    title: "Команды разработки и запуска",
    keywords: ["команды", "npm", "build", "typecheck", "dev", "start", "server", "update", "addon"],
    body: "Основные команды: npm install, npm run dev, npm run build, npm run typecheck, npm run start. CLI: npx girl-agent запускает WebUI; --profile запускает профиль; server --print-config/--config/--headless для серверов; update применяет data-миграции; addon init/pack работает с .gaa аддонами."
  },
  {
    category: "storage",
    subcategory: "data-root",
    title: "Где лежат данные",
    keywords: ["data", "MANAGER_AGENT_DATA", "папка", "профили", "windows", "macos", "linux", "хранилище"],
    body: "Корень профилей берётся из MANAGER_AGENT_DATA, иначе в исходниках это ./data, в npm/global запуске — XDG data dir, на Windows %APPDATA%/girl-agent/data, на macOS ~/Library/Application Support/girl-agent/data. Каждый профиль живёт в data/<slug>/."
  },
  {
    category: "storage",
    subcategory: "profile-files",
    title: "Файлы профиля",
    keywords: ["config.json", "persona.md", "speech.md", "boundaries.md", "communication.md", "relationship.md", "agenda.json"],
    body: "config.json хранит ProfileConfig. persona.md — личность, speech.md — речь, boundaries.md — границы, communication.md — стиль общения. relationship.md хранит stage и score. agenda.json — будущие проактивные пинги. conflict.json — текущий конфликт и coldUntil."
  },
  {
    category: "storage",
    subcategory: "memory-files",
    title: "Файлы памяти",
    keywords: ["memory", "long-term", "facts", "uncertain", "timeline", "promises", "open-loops"],
    body: "Главные memory-файлы: memory/long-term.md, memory/facts.md, memory/uncertain.md, relationship/timeline.md, time/open-loops.md, time/promises.md. Есть legacy long-term.md. MemoryPage и assistant разрешают только безопасный whitelist путей, плюс memory/daily/YYYY-MM-DD.md, memory/episodes/*.md, memory/palace/*."
  },
  {
    category: "storage",
    subcategory: "logs-and-days",
    title: "Логи и дневные summary",
    keywords: ["log", "daily", "summary", "session", "дневник", "дата", "05:00"],
    body: "log/YYYY-MM-DD.md — сессионные логи. sessionDate считает день по timezone профиля; до 05:00 локального времени события относятся к предыдущему дню. memory/daily/YYYY-MM-DD.md — дневные summary для долгого контекста и поиска по прошлым дням."
  },
  {
    category: "config",
    subcategory: "profile-config",
    title: "ProfileConfig",
    keywords: ["ProfileConfig", "config", "slug", "name", "age", "nationality", "tz", "mode"],
    body: "ProfileConfig включает slug, name, age, nationality RU/UA, timezone, mode bot/userbot, stage, llm, telegram, ownerId, privacy, sleepFrom/sleepTo, nightWakeChance, ignoreTendency, vibe, communication, personaNotes, addons и busySchedule. При чтении storage нормализует ownerId, communication и ignoreTendency."
  },
  {
    category: "config",
    subcategory: "sleep-and-schedule",
    title: "Сон и занятость",
    keywords: ["sleepFrom", "sleepTo", "nightWakeChance", "busySchedule", "сон", "расписание", "занятость"],
    body: "sleepFrom/sleepTo — часы сна 0..23, могут пересекать полночь. nightWakeChance — шанс проснуться ночью без :wake. busySchedule содержит label, days, from/to и checkAfterMin; daily-life и presence используют его, чтобы объяснять задержки и недоступность телефона."
  },
  {
    category: "telegram",
    subcategory: "bot-mode",
    title: "Bot mode",
    keywords: ["bot", "grammy", "Bot API", "токен", "message_reaction", "бот"],
    body: "bot mode использует grammY и telegram.botToken. Принимает message и message_reaction, умеет sendMessage, typing action, setMessageReaction, editMessageText и sendSticker. Проще в настройке, но выглядит как бот и имеет ограничения Bot API."
  },
  {
    category: "telegram",
    subcategory: "userbot-mode",
    title: "Userbot mode",
    keywords: ["userbot", "gramjs", "mtproto", "apiId", "apiHash", "sessionString", "реальный аккаунт"],
    body: "userbot mode использует GramJS/MTProto как обычный Telegram аккаунт. Нужны apiId/apiHash и sessionString, полученный через авторизацию. Поддерживает readHistory, typing, reactions, stickers, block/unblock/reportSpam и обработку удалённых сообщений через raw updates."
  },
  {
    category: "telegram",
    subcategory: "wss-and-proxy",
    title: "WSS и proxy",
    keywords: ["wss", "useWSS", "proxy", "socks", "блокировки", "443"],
    body: "telegram.useWSS по умолчанию true и включает WebSocket через 443 вместо TCP 80 — это помогает при блокировках Telegram. Для userbot можно задать SOCKS proxy в config или через MANAGER_AGENT_TG_PROXY."
  },
  {
    category: "telegram",
    subcategory: "privacy",
    title: "Privacy и owner",
    keywords: ["privacy", "owner", "ownerId", "allow-strangers", "strangers", "чужие", "primary"],
    body: "privacy=owner-only отвечает только ownerId/primary owner. allow-strangers разрешает сторонние личные чаты, но с relationshipScope=acquaintance: без памяти основного парня, без романтической истории и с границами, если основной relationship уже committed."
  },
  {
    category: "runtime",
    subcategory: "runtime-bus",
    title: "RuntimeBus в WebUI",
    keywords: ["runtimebus", "runtime", "start", "stop", "pause", "resume", "restart", "logs"],
    body: "RuntimeBus держит Runtime на каждый профиль, состояния running/paused/stopped/error и ring-buffer последних 500 событий. WebUI через него стартует/останавливает профили, показывает status и recentLogs, а WebSocket раздаёт события UI."
  },
  {
    category: "runtime",
    subcategory: "message-flow",
    title: "Путь входящего сообщения",
    keywords: ["handleIncoming", "incoming", "message flow", "сообщение", "ответ"],
    body: "Telegram adapter создаёт IncomingMessage. Runtime проверяет приватность/owner, media, deletion/reaction, историю, presence, conflict, active dialog и behavior-tick. Если shouldReply=false — логирует ignored/read. Если reply — scheduleReply с delay, потом generateAndSend собирает prompt, вызывает LLM, санитайзит ответ, режет на bubbles и отправляет."
  },
  {
    category: "runtime",
    subcategory: "behavior-tick",
    title: "Behavior tick",
    keywords: ["behavior", "intent", "reply", "ignore", "short", "left-on-read", "reaction-only", "delay", "moodDelta"],
    body: "behavior-tick — внутренний decision layer. Возвращает JSON: intent, shouldReply, shouldRead, delaySec, bubbles, typing, reaction, reactionTargetMessageId, ignoreReason и moodDelta. Он учитывает stage defaults, score, ignoreTendency, presence, conflict, active dialog и последние сообщения."
  },
  {
    category: "runtime",
    subcategory: "presence",
    title: "Presence simulation",
    keywords: ["presence", "online", "offline", "phone-attached", "burst-checker", "rare-checker", "evening-only", "night"],
    body: "PresenceProfile детерминированно выбирает pattern: phone-attached, burst-checker, rare-checker, evening-only или phone-attached-night. Он задаёт checkEveryMin, onlineWindowMin, offlineReplyChance и nightWakeChance. Communication notifications и stage могут ускорять/замедлять доступность."
  },
  {
    category: "runtime",
    subcategory: "ignore-tendency",
    title: "ignoreTendency",
    keywords: ["ignoreTendency", "игнор", "молчит", "не отвечает", "read", "left-on-read"],
    body: "ignoreTendency 0..100 — характерный вес, а не прямой процент. 0 почти не игнорит без причины, 35 дефолт, 70+ сухая и часто пропадает. Сон, busy, стадия, конфликт и score сильнее. При жалобе 'не отвечает' проверяй runtime state, recent logs, sleep/busy/conflict/stage/score."
  },
  {
    category: "runtime",
    subcategory: "active-dialog",
    title: "Активный диалог",
    keywords: ["активный диалог", "activeDialog", "бурст", "быстрый ответ", "не пропадает"],
    body: "Если она уже недавно ответила, а он написал в течение нескольких минут, Runtime помечает activeDialog. Behavior-layer должен продолжать переписку и не уходить в случайный игнор без веской причины. Это делает диалог похожим на реальную переписку, а не на независимые запросы."
  },
  {
    category: "runtime",
    subcategory: "bubbles",
    title: "Пузыри сообщений",
    keywords: ["bubbles", "пузырь", "split", "---", "сообщения", "дробить"],
    body: "LLM получает указание: если bubbles > 1, разделять сообщения строкой '---'. smartSplitBubbles и dedupeBubbles превращают ответ в отдельные TG-сообщения. Переносы строк без '---' запрещены, потому что в Telegram это одно сообщение столбиком и палит ИИ."
  },
  {
    category: "runtime",
    subcategory: "typing-and-delays",
    title: "Typing и задержки",
    keywords: ["typing", "delay", "задержка", "печатает", "scheduleReply", "sendBubbles"],
    body: "delaySec приходит из behavior-tick и может увеличиваться из-за offline/busy. scheduleReply ставит таймер. sendBubbles имитирует typing: перед первым пузырём короткая пауза, между пузырями задержка по длине текста и WPM. Если userbot доступен, перед отправкой может readHistory."
  },
  {
    category: "runtime",
    subcategory: "anti-ai",
    title: "Anti-AI и санитайзинг",
    keywords: ["anti-ai", "sanitize", "markdown", "jailbreak", "system prompt", "chatgpt", "техническая ошибка"],
    body: "ANTI_AI_RULES запрещают ChatGPT-повадки, markdown и мета-фразы. security.ts вычищает code fences, action leak narration, system/developer labels, CJK мусор и technical error replies. Jailbreak-подобные длинные ответы отбрасываются; при технических ошибках Runtime уходит в безопасный fallback/ignored."
  },
  {
    category: "runtime",
    subcategory: "media",
    title: "Медиа",
    keywords: ["media", "photo", "voice", "video", "video_note", "sticker", "document", "фото", "голосовое"],
    body: "IncomingMedia описывает фото, видео, голосовое, кружок, стикер или документ. Фото с base64 передаётся LLM как image part, если провайдер поддерживает. На голосовые без расшифровки персона может попросить текстом. На исходящие просьбы фото/видео/voice Runtime чаще даёт отказ вроде 'не хочу фоткаться ща'."
  },
  {
    category: "runtime",
    subcategory: "deleted-messages",
    title: "Удалённые сообщения",
    keywords: ["удалил", "deleted", "delete", "saw-and-read", "saw-not-read", "missed"],
    body: "deletion-handler классифицирует удаление: saw-and-read — она уже прочла и может сказать 'поздно, я видела'; saw-not-read — видела факт сообщения, но не прочла и может попросить показать; missed — не заметила и молчит. Userbot кэширует входящие, чтобы восстановить текст по raw update."
  },
  {
    category: "runtime",
    subcategory: "emoji-reactions",
    title: "Реакции пользователя",
    keywords: ["emoji", "reaction", "реакция", "токсичная", "positive", "react-back", "silent-mood"],
    body: "emoji-reaction-handler делит реакции на toxic, positive, funny, sad, neutral. Токсичные эмодзи на её сообщение обычно молча ухудшают mood; но если эмодзи относится к внешней ситуации из её текста, annoyance не растёт. Positive иногда react-back/короткий текст, но чаще молча. Снятие реакции обычно игнорируется."
  },
  {
    category: "runtime",
    subcategory: "typos",
    title: "Реалистичные опечатки",
    keywords: ["typos", "опечатки", "клавиатура", "qwerty", "йцукен", "ошибки"],
    body: "typos.ts вставляет опечатки после LLM, чтобы контролировать плотность. Типы: соседняя клавиша, пропуск, дубль, перестановка соседних букв, редкая неправильная раскладка RU/EN. Не ломает короткие слова, ссылки, смайлы и пунктуацию. Интенсивность зависит от communication messageStyle и vibe."
  },
  {
    category: "relationship",
    subcategory: "stages",
    title: "Стадии отношений",
    keywords: ["stage", "стадия", "отношения", "мет", "cold", "warming", "dating", "long-term", "dumped"],
    body: "Стадия задаёт близость, тон, шанс игнора и задержки. Основной порядок: met-irl-got-tg → tg-given-cold → tg-given-warming → convinced → first-date-done → dating-early → dating-stable → long-term. dumped — служебная терминальная стадия с полным игнором."
  },
  {
    category: "relationship",
    subcategory: "score",
    title: "Score отношений",
    keywords: ["score", "interest", "trust", "attraction", "annoyance", "cringe", "метрики"],
    body: "RelationshipScore: interest — интерес, trust — доверие, attraction — романтическое/физическое притяжение, annoyance — раздражение, cringe — насколько он кринжует/давит. Score меняется через moodDelta и reflection, влияет на conflict, stage transitions, stressLoad гормонов, ignore и тон."
  },
  {
    category: "relationship",
    subcategory: "stage-transitions",
    title: "Автосмена стадий",
    keywords: ["stage transition", "автосмена", "повысить", "понизить", "регресс", "upgrade", "downgrade"],
    body: "decideStageTransition не рандомный: сначала проверяет downgrade, потом upgrade. Для upgrade нужно минимум 6 её сообщений в текущей стадии, подходящие score и отсутствие активного конфликта. Downgrade срабатывает при высоком annoyance, низких interest/trust или большом количестве игноров на тёплой стадии. dumped автоматически не повышается."
  },
  {
    category: "relationship",
    subcategory: "dumped",
    title: "dumped",
    keywords: ["dumped", "отшила", "разрыв", "сброс", "reset", "не отвечает"],
    body: "dumped — служебная стадия 'отшила': ignoreChance=1.0 и огромные delays. Runtime может поставить dumped при annoyance > 80 и interest < -30. Выход — :reset или ручной set_stage. reset чистит score, long-term memory, conflict и возвращает из dumped в tg-given-cold."
  },
  {
    category: "relationship",
    subcategory: "timeline",
    title: "relationship/timeline.md",
    keywords: ["timeline", "история отношений", "relationship", "стадия изменилась"],
    body: "maybeAdvanceRelationshipTimeline при смене стадии мигрирует существующую память в Memory Palace и пишет в relationship/timeline.md строку вида 'стадия изменилась previous → next'. Это важно для ответа помощника о том, как развивались отношения."
  },
  {
    category: "conflict",
    subcategory: "levels",
    title: "Уровни конфликта",
    keywords: ["conflict", "конфликт", "coldUntil", "обида", "level", "молчит"],
    body: "conflict.json хранит level 0..4, reason, since, coldUntil и history. level 1 — лёгкая обида на час, 2 — обижена на несколько часов/сутки, 3 — серьёзный конфликт на дни, 4 — на грани разрыва. Пока coldUntil активен, behavior почти всегда ignore или сухой short."
  },
  {
    category: "conflict",
    subcategory: "escalation",
    title: "Эскалация и примирение",
    keywords: ["escalate", "soften", "annoyance", "cringe", "interestDrop", "помириться"],
    body: "escalateFromMood смотрит на delta annoyance/cringe/interestDrop и текущий score. trigger >= 8 даёт лёгкую обиду, >=15 — серьёзнее, >=25 или annoyance >70 — level 3. annoyance >85 + cringe >70 + interest < -30 ведёт к level 4. softenFromMood снижает level, если positive delta attraction+trust+interest >=12."
  },
  {
    category: "memory",
    subcategory: "memory-palace",
    title: "Memory Palace",
    keywords: ["memory palace", "mempalace", "palace", "hall", "drawer", "память", "дворец"],
    body: "Memory Palace — структурная память в memory/palace. Она разбита на halls и drawers, которые можно искать по входящему сообщению и подмешивать в prompt. Это не векторная БД: хранение файловое, выбор релевантного контекста лёгкий и локальный."
  },
  {
    category: "memory",
    subcategory: "halls",
    title: "Залы Memory Palace",
    keywords: ["hall_facts", "hall_events", "hall_discoveries", "hall_preferences", "hall_advice", "hall_promises", "hall_open_loops", "hall_feelings", "hall_uncertain"],
    body: "Залы: hall_facts — факты; hall_events — события; hall_discoveries — открытия о нём/ней; hall_preferences — предпочтения; hall_advice — советы; hall_promises — обещания; hall_open_loops — незакрытые темы; hall_feelings — чувства; hall_uncertain — сомнительное/неподтверждённое."
  },
  {
    category: "memory",
    subcategory: "recording",
    title: "Запись памяти",
    keywords: ["recordInteractionMemory", "maybeReflect", "memory", "reflect", "interaction"],
    body: "После primary interaction Runtime вызывает recordInteractionMemory. Каждые ~6 turns maybeReflect может дописать осмысление в долгую память с учётом conflict. Для agenda используются будущие события из сообщений; для daily summaries — закрытие stale/current sessions."
  },
  {
    category: "memory",
    subcategory: "retrieval",
    title: "Доставание памяти в prompt",
    keywords: ["retrieval", "searchDailySummaries", "loadMemoryPalaceContext", "recall", "prompt"],
    body: "buildSystemPrompt читает persona/speech/communication/relationship, legacy memory и при incoming ищет daily summaries. Runtime дополнительно передаёт loadRealismContext=loadMemoryPalaceContext, который добавляет релевантные palace drawers. Модель должна использовать память как фон, не цитируя 'в логе написано'."
  },
  {
    category: "life",
    subcategory: "daily-life",
    title: "Daily-life",
    keywords: ["daily-life", "жизнь", "день", "blocks", "events", "wants", "weather", "расписание"],
    body: "daily-life генерирует один день жизни: weather, vibe, blocks активности, events и wants. Кэш хранится в data/<slug>/daily-life/YYYY-MM-DD.md. Генерация учитывает persona, возраст, stage, timezone, sleep и busySchedule, а conflict делает день тяжелее."
  },
  {
    category: "life",
    subcategory: "age-context",
    title: "Возраст и учёба",
    keywords: ["возраст", "школа", "универ", "колледж", "пары", "уроки"],
    body: "prompt.ts отдельно контролирует учебный язык. До 17 лет она школьница: 'урок', 'школа', 'перемена', 'домашка', не 'пары/универ/лекция'. В 17-22 можно колледж/универ, если persona это допускает. Daily-life тоже учитывает это в blocks."
  },
  {
    category: "life",
    subcategory: "agenda",
    title: "Проактивная agenda",
    keywords: ["agenda", "проактив", "сама пишет", "пинг", "напомнить", "событие"],
    body: "Agenda engine делает mental notes о будущих событиях пользователя и поводах написать самой. extractAgendaUpdates создаёт/update/cancel items после его сообщений; tickAgenda примерно раз в минуту проверяет due items; handleResponseToProactive понимает его реакцию. На cold стадиях agenda почти ничего не создаёт."
  },
  {
    category: "life",
    subcategory: "autonomous-agenda",
    title: "Автономные пинги",
    keywords: ["autonomous", "самостоятельно", "первой", "initiative", "lifeSharing", "пишет сама"],
    body: "ensureAutonomousAgenda может создавать самостоятельные поводы написать, не привязанные к его явному будущему событию. Это зависит от stage, communication initiative/lifeSharing, conflict и дневного контекста. Runtime не спамит: по одному due item за тик и не лезет, если недавно была активность."
  },
  {
    category: "persona",
    subcategory: "prompt-files",
    title: "persona/speech/boundaries/communication",
    keywords: ["persona", "speech", "boundaries", "communication.md", "персона", "речь", "границы"],
    body: "persona.md описывает личность и биографию, speech.md — манеру речи и словечки, boundaries.md — запреты и личные границы, communication.md — стиль коммуникации. buildSystemPrompt вставляет эти файлы как основные источники, поэтому править их лучше через MemoryPage или assistant tools, а не менять код."
  },
  {
    category: "persona",
    subcategory: "generation",
    title: "Генерация персоны",
    keywords: ["generatePersonaPack", "generate_persona", "создать персону", "setup", "personaNotes"],
    body: "generatePersonaPack через LLM создаёт persona.md, speech.md, boundaries.md и communication.md. Assistant tool generate_persona использует текущие name/age/nationality/personaNotes. SetupFlow и CLI тоже могут генерировать стартовый профиль."
  },
  {
    category: "communication",
    subcategory: "fields",
    title: "CommunicationProfile",
    keywords: ["communication", "notifications", "messageStyle", "initiative", "lifeSharing"],
    body: "CommunicationProfile состоит из notifications muted/normal/priority, messageStyle one-liners/balanced/bursty/longform, initiative low/medium/high, lifeSharing low/medium/high. Он влияет на presence, agenda, typo density, prompt и поведение в активном диалоге."
  },
  {
    category: "communication",
    subcategory: "legacy-vibe",
    title: "legacy vibe",
    keywords: ["vibe", "short", "warm", "legacy", "deriveLegacyVibe"],
    body: "Старое поле vibe остаётся для совместимости. vibe=warm мапится примерно в cute/тёплый стиль, vibe=short — в alt/one-liners/low initiative. Новая настройка — communication, а vibe только legacy."
  },
  {
    category: "llm",
    subcategory: "client",
    title: "LLM client",
    keywords: ["llm", "openai", "anthropic", "client", "timeout", "retries", "json"],
    body: "src/llm/index.ts даёт единый LLMClient.chat для OpenAI-compatible и Anthropic. Есть timeout 120s, maxRetries=1 и сериализация вызовов через очередь, чтобы не грузить провайдера параллельными запросами. Опции: temperature, maxTokens, json/jsonSchema."
  },
  {
    category: "llm",
    subcategory: "providers",
    title: "Провайдеры LLM",
    keywords: ["provider", "preset", "claudehub", "openrouter", "groq", "deepseek", "mistral", "gemini", "ollama"],
    body: "LLM presets включают claudehub, openai, lmstudio, ollama, anthropic, openrouter, groq, deepseek, mistral, google, xai, together, fireworks, perplexity, cerebras и др. У каждого есть proto openai/anthropic, baseURL, defaultModel, models, apiKeyRequired и hints. GirlAI сейчас disabled."
  },
  {
    category: "llm",
    subcategory: "oauth",
    title: "OAuth GirlAI",
    keywords: ["oauth", "girlai", "refresh token", "access token", "expires"],
    body: "LLM config поддерживает oauthRefreshToken и oauthExpiresAt. OpenAILike перед вызовом делает ensureFreshToken: если токен истёк, refreshAccessToken обновляет access/refresh tokens. При ошибке refresh поля oauth очищаются, чтобы не ломать последующие настройки."
  },
  {
    category: "diagnostics",
    subcategory: "runtime-commands",
    title: "Runtime команды",
    keywords: ["status", "why", "wake", "debug", "reset", "stage", "sticker", "amnesia", "команды"],
    body: "send_command в assistant может отправить runtime-команды: status, why, wake, debug, reset. Runtime также имеет :stage, :sticker, :amnesia и другие CLI/chat commands. status — общий снимок, why — причины последнего решения, debug — расширенный presence/stage/conflict/score/communication, wake — временно будит, reset — чистит score/memory/conflict."
  },
  {
    category: "diagnostics",
    subcategory: "not-replying",
    title: "Если она не отвечает",
    keywords: ["не отвечает", "молчит", "ignore", "ignored", "почему", "why", "read_logs"],
    body: "Алгоритм: проверь RuntimeBus state и lastError; read_logs на ignored/error; команду why/debug; sleep/busy/presence; conflict coldUntil; stage defaults ignoreChance; ignoreTendency; score annoyance/cringe/interest; LLM/provider errors; Telegram mode/token/session. Не надо сразу советовать менять модель, если причина в stage/sleep/conflict."
  },
  {
    category: "diagnostics",
    subcategory: "llm-errors",
    title: "Ошибки LLM",
    keywords: ["401", "403", "429", "quota", "billing", "timeout", "api key", "baseURL", "model", "ошибка модели"],
    body: "silentErrorLabel классифицирует технические ошибки как auth/quota/rate-limit/network/provider. При LLM ошибке проверяй llm.presetId, proto, baseURL, apiKey, model, баланс/квоты и совместимость max_tokens/max_completion_tokens. Локальные LM Studio/Ollama могут работать без настоящего ключа."
  },
  {
    category: "diagnostics",
    subcategory: "telegram-errors",
    title: "Ошибки Telegram",
    keywords: ["telegram error", "BOT_TOKEN", "API_ID", "API_HASH", "session", "connect", "timeout"],
    body: "bot mode требует telegram.botToken. userbot требует apiId/apiHash/sessionString и может падать на connect/getMe. Для блокировок включай useWSS или proxy. MANAGER_AGENT_DEBUG=1 печатает debug userbot connect/getMe/handlers."
  },
  {
    category: "webui",
    subcategory: "pages",
    title: "Страницы WebUI",
    keywords: ["webui", "страницы", "assistant", "configuration", "diagnostics", "logs", "memory", "relationship", "addons"],
    body: "WebUI React страницы: SetupFlow — первичная настройка; ConfigurationPage — config; AssistantPage — помощник с tool blocks и question buttons; DiagnosticsPage — runtime/system diagnostics; LogsPage — события; MemoryPage — editing/preview memory; RelationshipPage — stage/score/timeline; AddonsPage — marketplace/installed."
  },
  {
    category: "webui",
    subcategory: "assistant",
    title: "WebUI assistant",
    keywords: ["assistant", "помощник", "tool", "question", "кнопки", "assistant page"],
    body: "AssistantPage отправляет /api/assistant/chat историю сообщений. Ответ может содержать <tool> JSON-блоки, которые UI показывает как применяемые действия, и <question> с options, которые рендерятся кнопками. Пользователь подтверждает tool calls, они не применяются автоматически."
  },
  {
    category: "webui",
    subcategory: "assistant-tools",
    title: "Инструменты помощника",
    keywords: ["set_field", "set_stage", "write_memory", "append_memory", "runtime_action", "read_logs", "read_memory", "list_presets"],
    body: "Backend assistant tools: set_field, set_stage, set_communication_preset, write_memory, append_memory, generate_persona, runtime_action, send_command, list_presets, read_logs, read_memory. ALLOWED_FIELDS и ALLOWED_MEMORY ограничивают, что можно менять, чтобы помощник не писал произвольные файлы."
  },
  {
    category: "webui",
    subcategory: "theme-and-css",
    title: "Темы и кнопки WebUI",
    keywords: ["theme", "dark", "light", "css", "кнопки", "цвет", "bone", "ink"],
    body: "styles.css использует bone/ink палитру и CSS variables. В light/dark меняются --bone и --ink, а app colors идут через --ga-text, --ga-bg-* и --ga-border. Button text должен явно наследовать/inherit или использовать --ga-text, иначе браузерный default может дать плохой контраст."
  },
  {
    category: "webui",
    subcategory: "api",
    title: "WebUI API",
    keywords: ["api", "routes", "profiles", "presets", "system", "tg-auth", "addons", "websocket"],
    body: "src/webui/routes содержит profiles, presets, assistant, addons, system, tg-auth. runtime-bus даёт runtime state/logs, websocket отдаёт live events. static.ts раздаёт webui/dist. system diagnostics показывает platform, arch, node, dataRoot, ipv4 и memory."
  },
  {
    category: "addons",
    subcategory: "format",
    title: "Формат .gaa аддонов",
    keywords: ["addon", "gaa", "manifest", "files", "config.patch", "theme.css", "install.sh"],
    body: ".gaa — zip-архив папки аддона. manifest.json обязателен. files/ копируются в data/<slug>/, config.patch.json deep-merge в config, code.patch может применяться git apply, theme.css добавляет CSS, install.sh опционален. Marketplace берётся из MANAGER_AGENT_ADDON_REGISTRY или GitHub raw registry."
  },
  {
    category: "addons",
    subcategory: "manifest",
    title: "manifest.json аддона",
    keywords: ["manifest", "addon", "id", "version", "compatibility", "settings"],
    body: "Manifest требует id/name/description/version. Дополнительно: author, compatibility semver range, tags, dependencies, settings, icon, homepage. Settings поддерживают string/number/boolean/select с default/options/required."
  },
  {
    category: "migrations",
    subcategory: "data-migrations",
    title: "Миграции данных",
    keywords: ["migration", "update", "0112", "0113", "0114", "миграции"],
    body: "src/migrations содержит versioned data migrations. RuntimeBus перед стартом проверяет pending migrations и запускает runMigrations. CLI update [--verbose] применяет миграции вручную. Недавние: 0112 useWSS default, 0113 communication.md, 0114 Memory Palace."
  },
  {
    category: "desktop",
    subcategory: "wrapper",
    title: "desktop-rs",
    keywords: ["desktop", "rust", "iced", "windows", "installer", "json-events"],
    body: "README описывает desktop-rs: нативный Rust/iced клиент и installer wizard для Windows. Он ставит Node package, создаёт профиль и открывает WebUI на 127.0.0.1:7777. CLI поддерживает --json-events/--headless для desktop wrapper."
  },
  {
    category: "release",
    subcategory: "install",
    title: "Установка пользователем",
    keywords: ["install", "установка", "curl", "docker", "npx", "node", "server", "systemd"],
    body: "Пользовательская установка: curl install.sh ставит docker wrapper или локальный Node 22 LTS в ~/.local/share/girl-agent/runtime, не требует sudo. Альтернативы: npx @thesashadev/girl-agent, docker run с volume /data, server --print-config/--print-systemd/--print-docker."
  }
];

function generatedKnowledge(): KnowledgeArticle[] {
  return [
    ...STAGE_PRESETS.map(stage => ({
      category: "relationship",
      subcategory: `stage-${stage.num}`,
      title: `${stage.num}. ${stage.id}`,
      keywords: ["stage", "стадия", stage.id, stage.label, String(stage.num)],
      body: `${stage.label}: ${stage.description}. Defaults: interest=${stage.defaults.interest}, trust=${stage.defaults.trust}, attraction=${stage.defaults.attraction}, annoyance=${stage.defaults.annoyance}, cringeTolerance=${stage.defaults.cringeTolerance}, ignoreChance=${stage.defaults.ignoreChance}, replyDelaySec=${stage.defaults.replyDelaySec[0]}-${stage.defaults.replyDelaySec[1]}.`
    })),
    ...COMMUNICATION_PRESETS.map(preset => ({
      category: "communication",
      subcategory: `preset-${preset.id}`,
      title: `Communication preset ${preset.id}`,
      keywords: ["communication", "preset", "общение", preset.id, preset.label],
      body: `${preset.label}: ${preset.description}. notifications=${preset.profile.notifications}, messageStyle=${preset.profile.messageStyle}, initiative=${preset.profile.initiative}, lifeSharing=${preset.profile.lifeSharing}.`
    })),
    {
      category: "llm",
      subcategory: "preset-index",
      title: "Индекс LLM presets",
      keywords: ["llm", "preset", "провайдеры", ...LLM_PRESETS.map(p => p.id)],
      body: LLM_PRESETS.map(p => `${p.id}: ${p.name}, proto=${p.proto}, default=${p.defaultModel || "custom"}${p.baseURL ? `, baseURL=${p.baseURL}` : ""}${p.disabled ? `, disabled=${p.disabledReason ?? "yes"}` : ""}${p.hint ? `, hint=${p.hint}` : ""}`).join("\n")
    },
    {
      category: "addons",
      subcategory: "integration-index",
      title: "Аддоны вместо MCP",
      keywords: ["addons", "аддоны", "интеграции", "gaa", "mcp"],
      body: "Внешние расширения теперь показываются как аддоны. MCP-пресеты не выводятся отдельной системой в WebUI; интеграции ставятся через Marketplace/.gaa и могут менять config.patch.json, файлы профиля, тему или code.patch."
    }
  ];
}

function knowledgeBase(): KnowledgeArticle[] {
  return [...CORE_KNOWLEDGE_BASE, ...generatedKnowledge()];
}

export function renderRelevantKnowledge(query: string, limit = 8): string {
  const articles = selectKnowledgeArticles(query, limit);
  return [
    "База знаний проекта girl-agent:",
    renderKnowledgeIndex(),
    "Выбранные релевантные категории/подкатегории:",
    ...articles.map(a => `## ${a.category} / ${a.subcategory}: ${a.title}\n${a.body}`),
    "Если вопрос не покрыт выбранными статьями — скажи осторожно и предложи проверить конкретный конфиг, память или runtime logs."
  ].join("\n\n");
}

function renderKnowledgeIndex(): string {
  const grouped = new Map<string, string[]>();
  for (const article of knowledgeBase()) {
    const list = grouped.get(article.category) ?? [];
    if (!list.includes(article.subcategory)) list.push(article.subcategory);
    grouped.set(article.category, list);
  }
  return [...grouped.entries()]
    .map(([category, subcategories]) => `- ${category}: ${subcategories.join(", ")}`)
    .join("\n");
}

function selectKnowledgeArticles(query: string, limit: number): KnowledgeArticle[] {
  const normalized = normalizeSearchText(query);
  const terms = searchTerms(normalized);
  const scored = knowledgeBase()
    .map(article => ({ article, score: knowledgeScore(article, normalized, terms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.article);
  if (scored.length) return scored;
  return knowledgeBase()
    .filter(article => article.category === "overview" || article.category === "diagnostics")
    .slice(0, limit);
}

function knowledgeScore(article: KnowledgeArticle, normalizedQuery: string, terms: string[]): number {
  const haystack = normalizeSearchText([
    article.category,
    article.subcategory,
    article.title,
    article.keywords.join(" "),
    article.body
  ].join(" "));
  let score = 0;
  for (const keyword of article.keywords) {
    const normalizedKeyword = normalizeSearchText(keyword);
    if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) score += 6;
  }
  for (const term of terms) {
    if (article.category.includes(term) || article.subcategory.includes(term)) score += 3;
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function searchTerms(text: string): string[] {
  return [...new Set(text.split(/[^a-zа-яё0-9]+/i).filter(t => t.length >= 3))];
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}
