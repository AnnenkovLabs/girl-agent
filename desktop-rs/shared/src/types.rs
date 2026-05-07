//! Mirror types for the JSON-events protocol exposed by the Node.js CLI in
//! `--json-events` mode.
//!
//! Field names are deliberately matched to the TypeScript runtime so that the
//! [`RuntimeEvent`] and [`Snapshot`] structs round-trip cleanly via
//! `serde_json`. Unknown variants are preserved through the `Other` tag rather
//! than failing — newer bot versions can add events without breaking older
//! desktop builds.

use serde::{Deserialize, Serialize};

/// 5-vector relationship score, identical to `RelationshipScore` in `types.ts`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct RelationshipScore {
    #[serde(default)]
    pub interest: i32,
    #[serde(default)]
    pub trust: i32,
    #[serde(default)]
    pub attraction: i32,
    #[serde(default)]
    pub annoyance: i32,
    #[serde(default)]
    pub cringe: i32,
}

impl Default for RelationshipScore {
    fn default() -> Self {
        Self { interest: 0, trust: 0, attraction: 0, annoyance: 0, cringe: 0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSummary {
    pub slug: String,
    pub name: String,
    pub age: u32,
    pub mode: String,
    #[serde(default)]
    pub nationality: String,
    #[serde(default)]
    pub tz: String,
    pub stage: StageRef,
}

/// One line out of the bot's NDJSON stdout stream.
///
/// We keep the discriminant as a plain string so we don't lose lines if the
/// bot adds a new event variant. The struct is intentionally permissive: every
/// optional field is `default`-able.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default, rename = "chatId")]
    pub chat_id: Option<serde_json::Value>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub score: Option<RelationshipScore>,
    #[serde(default)]
    pub stage: Option<StageRef>,
    #[serde(default)]
    pub profile: Option<ProfileSummary>,
    #[serde(default)]
    pub paused: Option<bool>,
    #[serde(default)]
    pub ok: Option<bool>,
    /// Producer timestamp in ms since epoch.
    #[serde(default)]
    pub t: Option<u64>,
}

impl RuntimeEvent {
    pub fn is_log_line(&self) -> bool {
        matches!(
            self.kind.as_str(),
            "incoming" | "outgoing" | "ignored" | "error" | "info" | "response" | "ready" | "stopped"
        )
    }

    pub fn pretty_log(&self) -> String {
        let txt = self.text.clone().unwrap_or_default();
        match self.kind.as_str() {
            "incoming" => format!("← {}", txt),
            "outgoing" => format!("→ {}", txt),
            "ignored" => format!("· ignore ({}): {}", self.reason.clone().unwrap_or_default(), txt),
            "error" => format!("! {}", txt),
            "response" => match self.ok {
                Some(false) => format!("? err: {}", txt),
                _ => format!("? {}", txt),
            },
            "ready" => "i ready".to_string(),
            "stopped" => "i stopped".to_string(),
            _ => format!("i {}", txt),
        }
    }

    pub fn ts_string(&self) -> String {
        let secs = self.t.unwrap_or(0) / 1000;
        let h = (secs / 3600) % 24;
        let m = (secs / 60) % 60;
        let s = secs % 60;
        format!("{:02}:{:02}:{:02}", h, m, s)
    }
}

/// Snapshot returned by `:snapshot` command in headless mode.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Snapshot {
    #[serde(default)]
    pub paused: bool,
    pub profile: Option<ProfileSummary>,
    pub stage: Option<StageRef>,
    #[serde(default)]
    pub score: RelationshipScore,
}
