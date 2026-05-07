//! Static catalogues mirrored from the TS wizard.
//!
//! Kept in sync with `src/presets/llm.ts`, `src/presets/stages.ts`,
//! `src/presets/communication.ts` and `src/data/timezones.ts`.

#[derive(Debug, Clone)]
pub struct LlmPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub proto: &'static str, // "openai" | "anthropic"
    pub base_url: Option<&'static str>,
    pub default_model: &'static str,
    pub default_api_key: Option<&'static str>,
    pub api_key_required: bool,
    pub custom: bool,
    pub models: &'static [&'static str],
    pub hint: &'static str,
    pub recommended: bool,
    pub referral_url: Option<&'static str>,
    pub referral_label: Option<&'static str>,
}

pub const LLM_PRESETS: &[LlmPreset] = &[
    LlmPreset {
        id: "claudehub",
        label: "ClaudeHub",
        proto: "anthropic",
        base_url: Some("https://api.claudehub.fun"),
        default_model: "claude-sonnet-4.6",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "claude-opus-4.7", "claude-opus-4.6", "claude-opus-4.5",
            "claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5",
            "gpt-5.5", "gpt-5.4",
        ],
        hint: "рекомендуем · прокси для Claude / GPT · РФ, СБП, крипта · по реферальной ссылке +бонус",
        recommended: true,
        referral_url: Some("https://app.claudehub.fun/r/7BXGRY"),
        referral_label: Some("открыть claudehub.fun (реферал)"),
    },
    LlmPreset {
        id: "openai",
        label: "OpenAI",
        proto: "openai",
        base_url: None,
        default_model: "gpt-5.5",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "gpt-5.5", "gpt-5.5-thinking", "gpt-5.5-pro",
            "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-thinking",
            "gpt-5.3-chat-latest", "gpt-5.4-mini", "gpt-5.4-nano",
            "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini",
        ],
        hint: "ChatGPT API · нужен ключ из platform.openai.com",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "lmstudio",
        label: "LM Studio",
        proto: "openai",
        base_url: Some("http://localhost:1234/v1"),
        default_model: "",
        default_api_key: Some("lm-studio"),
        api_key_required: false,
        custom: true,
        models: &[],
        hint: "локально, OpenAI-совместимый эндпоинт; ключ не нужен",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "ollama",
        label: "Ollama",
        proto: "openai",
        base_url: Some("http://localhost:11434/v1"),
        default_model: "llama3.1",
        default_api_key: Some("ollama"),
        api_key_required: false,
        custom: true,
        models: &[],
        hint: "локально через /v1; ключ не нужен",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "anthropic",
        label: "Anthropic",
        proto: "anthropic",
        base_url: None,
        default_model: "claude-sonnet-4-6",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
            "claude-opus-4-6", "claude-sonnet-4-5", "claude-opus-4-1",
        ],
        hint: "Claude · нужен ключ из console.anthropic.com",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "openrouter",
        label: "OpenRouter",
        proto: "openai",
        base_url: Some("https://openrouter.ai/api/v1"),
        default_model: "openai/gpt-5.3-chat-latest",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "openai/gpt-5.3-chat-latest", "openai/gpt-5.5",
            "openai/gpt-5.5-thinking", "openai/gpt-5.5-pro",
            "anthropic/claude-sonnet-4.6", "anthropic/claude-opus-4.7",
            "google/gemini-3.1-pro", "deepseek/deepseek-v4-pro", "x-ai/grok-4.3",
        ],
        hint: "агрегатор моделей · openrouter.ai · приём в крипте",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "groq",
        label: "Groq",
        proto: "openai",
        base_url: Some("https://api.groq.com/openai/v1"),
        default_model: "llama-3.3-70b-versatile",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "llama-3.3-70b-versatile", "llama-3.1-8b-instant",
            "llama-4-scout-17b-16e-instruct", "qwen-3-32b", "mixtral-8x7b-32768",
        ],
        hint: "очень быстрый инференс на open-source моделях",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "deepseek",
        label: "DeepSeek",
        proto: "openai",
        base_url: Some("https://api.deepseek.com"),
        default_model: "deepseek-v4-flash",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
        hint: "deepseek-chat/reasoner deprecated 2026-07-24, бери V4",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "mistral",
        label: "Mistral",
        proto: "openai",
        base_url: Some("https://api.mistral.ai/v1"),
        default_model: "mistral-large-2512",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "mistral-large-2512", "mistral-small-2603",
            "ministral-8b-2512", "ministral-14b-2512",
            "mistral-large-latest", "mistral-small-latest",
        ],
        hint: "французский провайдер, Le Chat и API",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "google",
        label: "Google Gemini",
        proto: "openai",
        base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        default_model: "gemini-3.1-pro",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &["gemini-3.1-pro", "gemini-3-flash", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash"],
        hint: "Gemini через OpenAI-совместимый эндпоинт",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "xai",
        label: "xAI Grok",
        proto: "openai",
        base_url: Some("https://api.x.ai/v1"),
        default_model: "grok-4.3",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &["grok-4.3", "grok-4.20-reasoning", "grok-4.20-non-reasoning", "grok-4", "grok-3", "grok-3-mini"],
        hint: "Grok от xAI · ключ из console.x.ai",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "together",
        label: "Together AI",
        proto: "openai",
        base_url: Some("https://api.together.xyz/v1"),
        default_model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "meta-llama/Llama-4-scout-17b-instruct",
            "Qwen/Qwen2.5-72B-Instruct-Turbo",
            "deepseek-ai/DeepSeek-V3",
        ],
        hint: "хостинг open-source моделей",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "fireworks",
        label: "Fireworks",
        proto: "openai",
        base_url: Some("https://api.fireworks.ai/inference/v1"),
        default_model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &[
            "accounts/fireworks/models/llama-v3p3-70b-instruct",
            "accounts/fireworks/models/llama-4-scout-17b-16e-instruct",
            "accounts/fireworks/models/qwen2p5-72b-instruct",
            "accounts/fireworks/models/deepseek-v3",
        ],
        hint: "хостинг open-source моделей",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "perplexity",
        label: "Perplexity",
        proto: "openai",
        base_url: Some("https://api.perplexity.ai"),
        default_model: "sonar-pro",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &["sonar-pro", "sonar", "sonar-reasoning"],
        hint: "встроенный поиск в инференсе",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "cerebras",
        label: "Cerebras",
        proto: "openai",
        base_url: Some("https://api.cerebras.ai/v1"),
        default_model: "llama-3.3-70b",
        default_api_key: None,
        api_key_required: true,
        custom: false,
        models: &["llama-3.3-70b", "llama-4-scout-17b-16e-instruct", "qwen-3-32b"],
        hint: "ультра-быстрый инференс на чипах cerebras",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "custom-openai",
        label: "Custom (OpenAI-compatible)",
        proto: "openai",
        base_url: None,
        default_model: "",
        default_api_key: None,
        api_key_required: false,
        custom: true,
        models: &[],
        hint: "укажи свой base URL и модель",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
    LlmPreset {
        id: "custom-anthropic",
        label: "Custom (Anthropic-compatible)",
        proto: "anthropic",
        base_url: None,
        default_model: "",
        default_api_key: None,
        api_key_required: false,
        custom: true,
        models: &[],
        hint: "укажи свой base URL и модель",
        recommended: false,
        referral_url: None,
        referral_label: None,
    },
];

pub fn find_llm_preset(id: &str) -> Option<&'static LlmPreset> {
    LLM_PRESETS.iter().find(|p| p.id == id)
}

#[derive(Debug, Clone)]
pub struct StagePreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}

pub const STAGE_PRESETS: &[StagePreset] = &[
    StagePreset { id: "met-irl-got-tg", label: "встретились в реале — дала тг", description: "только что обменялись тг. помнит лицо, голос. лёгкий интерес." },
    StagePreset { id: "tg-given-cold", label: "дала тг, но не убедил отвечать", description: "сомневается. часто игнорит, отвечает односложно. нужно добиваться." },
    StagePreset { id: "tg-given-warming", label: "дала тг, отвечает осторожно", description: "оттаивает. отвечает, но коротко. тестит тебя." },
    StagePreset { id: "convinced", label: "убедил отвечать стабильно", description: "общаетесь регулярно, флиртует, ещё не виделись после знакомства." },
    StagePreset { id: "first-date-done", label: "сходили один раз", description: "первое свидание было, в подвешенном состоянии — нравится, но не пара." },
    StagePreset { id: "dating-early", label: "только начали встречаться", description: "около месяца вместе. бабочки, всё внове, но границы ещё хрупкие." },
    StagePreset { id: "dating-stable", label: "пара, общаетесь свободно", description: "стабильные отношения, шутки, бытовуха, доверие." },
    StagePreset { id: "long-term", label: "давно вместе", description: "год+ вместе. иногда раздражение, рутина, глубокое доверие." },
];

#[derive(Debug, Clone)]
pub struct CommunicationPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub notifications: &'static str, // muted|normal|priority
    pub message_style: &'static str, // one-liners|balanced|bursty|longform
    pub initiative: &'static str,    // low|medium|high
    pub life_sharing: &'static str,  // low|medium|high
}

pub const COMMUNICATION_PRESETS: &[CommunicationPreset] = &[
    CommunicationPreset {
        id: "normal", label: "нормальная",
        description: "золотая середина — отвечает нормально, не липнет, иногда сама пишет",
        notifications: "normal", message_style: "balanced", initiative: "medium", life_sharing: "medium",
    },
    CommunicationPreset {
        id: "cute", label: "милая",
        description: "тёплая и заботливая, часто отвечает, пишет первой, делится моментами",
        notifications: "priority", message_style: "balanced", initiative: "high", life_sharing: "high",
    },
    CommunicationPreset {
        id: "alt", label: "альтушка",
        description: "холодная, сухая, короткие ответы, почти не пишет первой, личным не делится",
        notifications: "normal", message_style: "one-liners", initiative: "low", life_sharing: "low",
    },
    CommunicationPreset {
        id: "clingy", label: "залипала",
        description: "очень липучая, спамит пузырями, всегда онлайн, пишет первой постоянно",
        notifications: "priority", message_style: "bursty", initiative: "high", life_sharing: "high",
    },
    CommunicationPreset {
        id: "chatty", label: "болтушка",
        description: "любит рассказывать истории, пишет длинные тексты, часто делится бытовым",
        notifications: "priority", message_style: "longform", initiative: "medium", life_sharing: "high",
    },
];

#[derive(Debug, Clone)]
pub struct TzEntry {
    pub iana: &'static str,
    pub gmt_winter: &'static str,
    pub city: &'static str,
    pub country: &'static str,
    pub aliases: &'static [&'static str],
}

pub const TIMEZONES: &[TzEntry] = &[
    TzEntry { iana: "Europe/Kaliningrad", gmt_winter: "GMT+2", city: "Калининград", country: "Россия", aliases: &["калининград", "kaliningrad", "rus"] },
    TzEntry { iana: "Europe/Moscow", gmt_winter: "GMT+3", city: "Москва", country: "Россия", aliases: &["москва", "msk", "moscow", "питер", "санкт-петербург", "spb", "rus"] },
    TzEntry { iana: "Europe/Samara", gmt_winter: "GMT+4", city: "Самара", country: "Россия", aliases: &["самара", "samara", "ижевск"] },
    TzEntry { iana: "Asia/Yekaterinburg", gmt_winter: "GMT+5", city: "Екатеринбург", country: "Россия", aliases: &["екб", "yekaterinburg", "пермь", "уфа", "челябинск"] },
    TzEntry { iana: "Asia/Omsk", gmt_winter: "GMT+6", city: "Омск", country: "Россия", aliases: &["омск", "omsk"] },
    TzEntry { iana: "Asia/Novosibirsk", gmt_winter: "GMT+7", city: "Новосибирск", country: "Россия", aliases: &["нск", "новосибирск", "novosibirsk", "томск", "красноярск"] },
    TzEntry { iana: "Asia/Irkutsk", gmt_winter: "GMT+8", city: "Иркутск", country: "Россия", aliases: &["иркутск", "irkutsk", "улан-удэ"] },
    TzEntry { iana: "Asia/Yakutsk", gmt_winter: "GMT+9", city: "Якутск", country: "Россия", aliases: &["якутск", "yakutsk", "чита"] },
    TzEntry { iana: "Asia/Vladivostok", gmt_winter: "GMT+10", city: "Владивосток", country: "Россия", aliases: &["владивосток", "vladivostok", "хабаровск"] },
    TzEntry { iana: "Asia/Magadan", gmt_winter: "GMT+11", city: "Магадан", country: "Россия", aliases: &["магадан", "magadan", "сахалин"] },
    TzEntry { iana: "Asia/Kamchatka", gmt_winter: "GMT+12", city: "Камчатка", country: "Россия", aliases: &["камчатка", "kamchatka", "петропавловск"] },
    TzEntry { iana: "Europe/Kyiv", gmt_winter: "GMT+2", city: "Київ", country: "Україна", aliases: &["киев", "київ", "kyiv", "kiev", "ua", "украина", "україна", "львов", "львів", "одесса", "одеса", "харьков", "харків"] },
    TzEntry { iana: "Europe/Minsk", gmt_winter: "GMT+3", city: "Минск", country: "Беларусь", aliases: &["минск", "minsk", "бел", "беларусь", "by"] },
    TzEntry { iana: "Asia/Almaty", gmt_winter: "GMT+5", city: "Алматы", country: "Казахстан", aliases: &["алматы", "almaty", "kz", "казахстан", "астана", "нур-султан"] },
    TzEntry { iana: "Asia/Tashkent", gmt_winter: "GMT+5", city: "Ташкент", country: "Узбекистан", aliases: &["ташкент", "tashkent", "uz", "узбекистан"] },
    TzEntry { iana: "Asia/Bishkek", gmt_winter: "GMT+6", city: "Бишкек", country: "Кыргызстан", aliases: &["бишкек", "bishkek", "kg"] },
    TzEntry { iana: "Asia/Tbilisi", gmt_winter: "GMT+4", city: "Тбилиси", country: "Грузия", aliases: &["тбилиси", "tbilisi", "ge", "грузия"] },
    TzEntry { iana: "Asia/Yerevan", gmt_winter: "GMT+4", city: "Ереван", country: "Армения", aliases: &["ереван", "yerevan", "am", "армения"] },
    TzEntry { iana: "Asia/Baku", gmt_winter: "GMT+4", city: "Баку", country: "Азербайджан", aliases: &["баку", "baku", "az", "азербайджан"] },
];

pub fn search_tz(query: &str) -> Vec<&'static TzEntry> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return TIMEZONES.iter().collect();
    }
    TIMEZONES
        .iter()
        .filter(|tz| {
            tz.iana.to_lowercase().contains(&q)
                || tz.city.to_lowercase().contains(&q)
                || tz.country.to_lowercase().contains(&q)
                || tz.aliases.iter().any(|a| a.contains(&q))
        })
        .collect()
}

pub fn default_tz_for_nationality(nationality: &str) -> &'static str {
    match nationality {
        "UA" => "Europe/Kyiv",
        _ => "Europe/Moscow",
    }
}

pub const NATIONALITIES: &[(&str, &str)] = &[
    ("RU", "русская"),
    ("UA", "украинка"),
];

pub const NAMES_RU: &[&str] = &[
    "Аня", "Алина", "Алёна", "Алиса", "Альбина", "Ася",
    "Арина", "Ангелина", "Настя",
    "Варя", "Лера", "Ника", "Вика", "Виолетта", "Виталина",
    "Даша", "Диана", "Дина", "Дарина", "Доминика",
    "Ева", "Женя", "Катя", "Лена", "Лиза", "Злата",
    "Ира", "Инна", "Ксюша", "Кира", "Кристина", "Карина", "Камилла",
    "Лиля", "Маша", "Марина", "Рита", "Милана", "Милена", "Мила", "Мира", "Майя",
    "Надя", "Наташа", "Настя", "Нина",
    "Оля", "Оксана", "Полина", "Поля", "Олеся", "Олена",
    "Соня", "София", "Стася", "Снежана",
    "Таня", "Тоня",
    "Ульяна", "Уля",
    "Юля", "Юлиана",
    "Яна", "Яся",
];

pub const NAMES_UA: &[&str] = &[
    "Анна", "Альона", "Аліна", "Аліса", "Анастасія",
    "Богдана", "Валерія", "Вікторія", "Віолетта",
    "Дарина", "Діана", "Дарія",
    "Євгенія", "Єлизавета",
    "Злата", "Зоряна",
    "Ірина", "Інна",
    "Катерина", "Карина", "Кіра", "Ксенія",
    "Лілія", "Лариса", "Леся",
    "Марія", "Маріанна", "Мілана", "Мілена",
    "Надія", "Наталія", "Наталка", "Ніна",
    "Оксана", "Олена", "Олеся", "Ольга",
    "Поліна", "Перелесниця",
    "Світлана", "Софія", "Соломія",
    "Таїсія", "Тетяна",
    "Уляна",
    "Христина",
    "Юлія", "Юліана",
    "Яна", "Ярина",
];

pub fn pick_random_name(nationality: &str, seed: u64) -> &'static str {
    let pool: &[&str] = if nationality == "UA" { NAMES_UA } else { NAMES_RU };
    let idx = (seed as usize) % pool.len();
    pool[idx]
}

#[derive(Debug, Clone)]
pub struct SleepPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub from_h: u8,
    pub to_h: u8,
    pub wake_chance: f32,
}

pub const SLEEP_PRESETS: &[SleepPreset] = &[
    SleepPreset { id: "standard", label: "обычный", description: "00:00 — 09:00 · ~5% что разбудит сообщение", from_h: 0, to_h: 9, wake_chance: 0.05 },
    SleepPreset { id: "late", label: "сова", description: "02:00 — 11:00 · поздно ложится, поздно встаёт", from_h: 2, to_h: 11, wake_chance: 0.05 },
    SleepPreset { id: "early", label: "жаворонок", description: "22:00 — 07:00 · рано спать, рано на работу", from_h: 22, to_h: 7, wake_chance: 0.04 },
    SleepPreset { id: "owl", label: "не спит до утра", description: "04:00 — 13:00 · ночной образ жизни", from_h: 4, to_h: 13, wake_chance: 0.08 },
    SleepPreset { id: "custom", label: "кастом", description: "задай свой режим сна", from_h: 0, to_h: 0, wake_chance: 0.0 },
];

pub const PRIVACY_OPTIONS: &[(&str, &str, &str)] = &[
    ("owner-only", "только владельцу", "отвечает только тебе. незнакомцам — игнор."),
    ("allow-strangers", "всем, кто пишет", "отвечает кому угодно — нужно для bot-режима в группах."),
];

pub fn slugify(name: &str) -> String {
    let mapped: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                match c {
                    'а'..='я' | 'А'..='Я' | 'ё' | 'Ё' | 'і' | 'І' | 'ї' | 'Ї' | 'є' | 'Є' | 'ґ' | 'Ґ' => {
                        translit_ru(c)
                    }
                    _ => '-',
                }
            }
        })
        .collect();
    let mut prev_dash = false;
    let mut out = String::new();
    for c in mapped.chars() {
        if c == '-' {
            if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "persona".to_string()
    } else {
        trimmed
    }
}

fn translit_ru(c: char) -> char {
    let lower = c.to_lowercase().next().unwrap_or(c);
    match lower {
        'а' => 'a', 'б' => 'b', 'в' => 'v', 'г' => 'g', 'д' => 'd', 'е' | 'ё' | 'є' => 'e',
        'ж' => 'z', 'з' => 'z', 'и' | 'і' | 'ї' => 'i', 'й' => 'y', 'к' => 'k', 'л' => 'l',
        'м' => 'm', 'н' => 'n', 'о' => 'o', 'п' => 'p', 'р' => 'r', 'с' => 's', 'т' => 't',
        'у' => 'u', 'ф' => 'f', 'х' => 'h', 'ц' => 'c', 'ч' => 'c', 'ш' => 's', 'щ' => 's',
        'ъ' | 'ь' => '-', 'ы' => 'y', 'э' => 'e', 'ю' => 'u', 'я' => 'a', 'ґ' => 'g',
        _ => '-',
    }
}
