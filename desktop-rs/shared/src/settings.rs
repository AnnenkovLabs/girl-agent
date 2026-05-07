//! User-tunable settings persisted to `<app_dir>/settings.json`.
//!
//! Currently scoped to:
//!  * which profile to auto-load on launch,
//!  * minimize-target preference + "remember" toggle,
//!  * bind port for the local Web UI,
//!  * generated access token for the Web UI.

use std::fs;

use serde::{Deserialize, Serialize};

use crate::paths;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MinimizeTarget {
    Taskbar,
    Tray,
}

impl Default for MinimizeTarget {
    fn default() -> Self {
        MinimizeTarget::Taskbar
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// `slug` of the profile to auto-launch when the app starts.
    pub last_profile: Option<String>,
    /// Where to send the window when the user clicks the minimize control.
    pub minimize_to: MinimizeTarget,
    /// If `true`, the popup is suppressed and `minimize_to` is honoured silently.
    pub remember_minimize_choice: bool,
    /// Port for the local Web UI server (loopback only).
    pub web_port: u16,
    /// Random opaque token bundled into the Web UI URL for very basic
    /// LAN-snooping protection. Regenerated if missing.
    pub web_token: String,
    /// Auto-start the Web UI server on app launch.
    pub web_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            last_profile: None,
            minimize_to: MinimizeTarget::Taskbar,
            remember_minimize_choice: false,
            web_port: 7777,
            web_token: random_token(24),
            web_enabled: true,
        }
    }
}

impl Settings {
    pub fn load() -> Self {
        let path = paths::settings_path();
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Settings>(&text) {
                Ok(mut s) => {
                    // Heal corrupted/empty token.
                    if s.web_token.trim().is_empty() {
                        s.web_token = random_token(24);
                        let _ = s.save();
                    }
                    s
                }
                Err(err) => {
                    tracing::warn!("settings: parse failed ({}), using defaults", err);
                    let s = Settings::default();
                    let _ = s.save();
                    s
                }
            },
            Err(_) => {
                let s = Settings::default();
                let _ = s.save();
                s
            }
        }
    }

    pub fn save(&self) -> std::io::Result<()> {
        let path = paths::settings_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(self).expect("serialize settings");
        fs::write(path, text)
    }
}

/// Cheap, non-cryptographic token suitable for casual same-network protection.
/// We do not need crypto guarantees here — the UI binds to loopback by default
/// and the token is a simple "are you the same user as the desktop process".
fn random_token(len: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut state = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0xC0FFEE_DEAD_BEEFu64)
        ^ std::process::id() as u64;
    let mut out = String::with_capacity(len);
    while out.len() < len {
        // splitmix64
        state = state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^= z >> 31;
        const ALPH: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        for shift in (0..64).step_by(6) {
            if out.len() == len {
                break;
            }
            let idx = ((z >> shift) & 0x3F) as usize % ALPH.len();
            out.push(ALPH[idx] as char);
        }
    }
    out
}
