//! OS-aware paths for app data, settings, profile data and bundled runtime.
//!
//! On Windows we deliberately collapse the layout to a single tidy folder:
//!
//! ```text
//! %APPDATA%/girl-agent/
//!     settings.json          // tray choice, ports, last-used profile
//!     data/                  // bot's GIRL_AGENT_DATA root, one folder per profile
//!     runtime/               // bundled node.exe + cli.js + node_modules
//!     log/
//! ```
//!
//! On Linux/macOS we use XDG-style data dirs so command-line users keep their
//! existing layout.

use std::path::PathBuf;

/// `%APPDATA%/girl-agent` on Windows.
/// `$XDG_DATA_HOME/girl-agent` (or `~/.local/share/girl-agent`) on Linux.
/// `~/Library/Application Support/girl-agent` on macOS.
pub fn app_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Ok(roaming) = std::env::var("APPDATA") {
            return PathBuf::from(roaming).join("girl-agent");
        }
    } else if cfg!(target_os = "macos") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("girl-agent");
        }
    } else if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("girl-agent");
    } else if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".local").join("share").join("girl-agent");
    }
    PathBuf::from(".")
}

/// Where profile markdown / JSON live. Passed to the bot via
/// `GIRL_AGENT_DATA`.
pub fn data_dir() -> PathBuf {
    let p = app_dir().join("data");
    let _ = std::fs::create_dir_all(&p);
    p
}

/// Bundled runtime: portable `node.exe`, `cli.js`, `node_modules/`, etc.
/// Created by the installer.
pub fn runtime_dir() -> PathBuf {
    let p = app_dir().join("runtime");
    let _ = std::fs::create_dir_all(&p);
    p
}

/// Path to `settings.json`.
pub fn settings_path() -> PathBuf {
    let _ = std::fs::create_dir_all(app_dir());
    app_dir().join("settings.json")
}

/// Path used by the desktop app for its own logs.
pub fn app_log_dir() -> PathBuf {
    let p = app_dir().join("log");
    let _ = std::fs::create_dir_all(&p);
    p
}
