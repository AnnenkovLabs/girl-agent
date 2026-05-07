//! Wizard form state.

use crate::data::{find_llm_preset, slugify};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NameMode {
    Random,
    Manual,
    Tournament,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserbotAuthSource {
    /// Use the project's tgproxy.girl-agent.com proxy — no api id/hash needed.
    Owner,
    /// Provide own api_id/api_hash from my.telegram.org.
    Own,
}

#[derive(Debug, Clone)]
pub struct WizardData {
    // Telegram
    pub mode: String, // "bot" or "userbot"
    pub tg_token: String,
    pub userbot_source: UserbotAuthSource,
    pub tg_api_id: String,
    pub tg_api_hash: String,
    pub tg_phone: String,
    pub tg_code: String,
    pub tg_2fa: String,
    /// loginToken returned by /send-code (used by /verify-code)
    pub tg_login_token: String,
    /// session string + apiId/apiHash returned by /verify-code
    pub tg_session_string: String,
    pub tg_resolved_api_id: String,
    pub tg_resolved_api_hash: String,
    pub tg_needs_2fa: bool,

    // LLM
    pub llm_preset: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub llm_base_url: String,

    // Persona basics
    pub nationality: String, // "RU" or "UA"
    pub name_mode: NameMode,
    pub name: String,
    pub age: u8, // 14..=99, default 18
    pub tz: String,
    pub stage: String,
    pub communication: String,
    pub sleep_preset: String,
    /// only used when sleep_preset == "custom"
    pub sleep_custom_from: u8, // 0..=23
    pub sleep_custom_to: u8,   // 0..=23
    pub sleep_custom_wake_chance: u8, // 0..=100 percent
    pub privacy: String,
    pub persona_notes: String,
    pub slug: String,

    // Tournament-mode name picker
    pub tournament_round: u32,        // 0-based
    pub tournament_pair: (String, String),
    pub tournament_qualifiers: Vec<String>,
    pub tournament_seen: Vec<String>,
    pub tournament_pool: Vec<String>,
    pub tournament_phase: TournamentPhase,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TournamentPhase {
    Idle,
    Quals,
    Knockout,
}

impl Default for WizardData {
    fn default() -> Self {
        Self {
            mode: "bot".into(),
            tg_token: String::new(),
            userbot_source: UserbotAuthSource::Owner,
            tg_api_id: String::new(),
            tg_api_hash: String::new(),
            tg_phone: String::new(),
            tg_code: String::new(),
            tg_2fa: String::new(),
            tg_login_token: String::new(),
            tg_session_string: String::new(),
            tg_resolved_api_id: String::new(),
            tg_resolved_api_hash: String::new(),
            tg_needs_2fa: false,

            llm_preset: "claudehub".into(),
            llm_model: String::new(),
            llm_api_key: String::new(),
            llm_base_url: String::new(),

            nationality: "RU".into(),
            name_mode: NameMode::Random,
            name: String::new(),
            age: 18,
            tz: "Europe/Moscow".into(),
            stage: "tg-given-cold".into(),
            communication: "normal".into(),
            sleep_preset: "standard".into(),
            sleep_custom_from: 0,
            sleep_custom_to: 9,
            sleep_custom_wake_chance: 5,
            privacy: "owner-only".into(),
            persona_notes: String::new(),
            slug: String::new(),
            tournament_round: 0,
            tournament_pair: (String::new(), String::new()),
            tournament_qualifiers: Vec::new(),
            tournament_seen: Vec::new(),
            tournament_pool: Vec::new(),
            tournament_phase: TournamentPhase::Idle,
        }
    }
}

impl WizardData {
    pub fn refresh_slug(&mut self) {
        self.slug = slugify(&self.name);
    }

    pub fn apply_llm_preset_defaults(&mut self) {
        if let Some(p) = find_llm_preset(&self.llm_preset) {
            if self.llm_model.is_empty() {
                self.llm_model = p.default_model.to_string();
            }
            if self.llm_base_url.is_empty() {
                if let Some(b) = p.base_url {
                    self.llm_base_url = b.to_string();
                }
            }
            if let Some(k) = p.default_api_key {
                if self.llm_api_key.is_empty() {
                    self.llm_api_key = k.to_string();
                }
            }
        }
    }

    pub fn current_llm_proto(&self) -> &str {
        find_llm_preset(&self.llm_preset).map(|p| p.proto).unwrap_or("openai")
    }

    pub fn current_llm_requires_key(&self) -> bool {
        find_llm_preset(&self.llm_preset).map(|p| p.api_key_required).unwrap_or(true)
    }

    pub fn is_telegram_valid(&self) -> bool {
        match self.mode.as_str() {
            "bot" => !self.tg_token.trim().is_empty(),
            "userbot" => {
                if self.tg_session_string.is_empty() {
                    return false;
                }
                match self.userbot_source {
                    UserbotAuthSource::Owner => !self.tg_phone.trim().is_empty(),
                    UserbotAuthSource::Own => {
                        !self.tg_api_id.trim().is_empty()
                            && !self.tg_api_hash.trim().is_empty()
                            && !self.tg_phone.trim().is_empty()
                    }
                }
            }
            _ => false,
        }
    }

    pub fn is_llm_valid(&self) -> bool {
        let p = match find_llm_preset(&self.llm_preset) {
            Some(p) => p,
            None => return false,
        };
        if p.api_key_required && self.llm_api_key.trim().is_empty() {
            return false;
        }
        true
    }

    pub fn is_persona_valid(&self) -> bool {
        !self.name.trim().is_empty() && (14..=99).contains(&self.age) && !self.tz.is_empty()
    }
}
