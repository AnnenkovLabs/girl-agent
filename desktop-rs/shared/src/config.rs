//! Subset of the bot's `ProfileConfig` that the Rust app needs to read.
//!
//! We deliberately keep this narrow: the desktop app does not own the full
//! profile schema; it only inspects what it needs (slug, name, age, mode,
//! stage) to render the dashboard, list profiles and pre-fill the installer
//! wizard. New fields the bot adds are tolerated via `serde(other)`-style
//! permissiveness and ignored.

use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ProfileConfig {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub age: u32,
    #[serde(default)]
    pub nationality: String,
    #[serde(default)]
    pub tz: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// Read all profiles found under `data_root` (one folder per slug, each with
/// `config.json`). Skips folders without a parseable config.
pub fn list_profiles(data_root: &Path) -> Vec<ProfileConfig> {
    let mut out = Vec::new();
    let dir = match std::fs::read_dir(data_root) {
        Ok(d) => d,
        Err(_) => return out,
    };
    for entry in dir.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let cfg_path = entry.path().join("config.json");
        let Ok(text) = std::fs::read_to_string(&cfg_path) else { continue; };
        if let Ok(cfg) = serde_json::from_str::<ProfileConfig>(&text) {
            out.push(cfg);
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}
