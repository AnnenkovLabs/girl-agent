//! Static HTML/CSS/JS for the Web UI.
//!
//! Kept as compile-time constants so the HTTP server never reads from disk —
//! a single binary ships the entire UI.

pub const CSS: &str = include_str!("../../static/app.css");
pub const JS: &str = include_str!("../../static/app.js");

const SHELL: &str = include_str!("../../static/index.html");
const LANDING: &str = include_str!("../../static/landing.html");

pub fn dashboard(token: &str) -> String {
    SHELL.replace("%%TOKEN%%", token)
}

pub fn landing() -> String {
    LANDING.to_string()
}
