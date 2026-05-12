//! Spawns the Node-based WebUI server (`npx girl-agent` без `--json-events`).
//!
//! Эта обвязка не парсит stdout (там Vite + access-логи), а только
//! поддерживает дочерний процесс живым и предоставляет URL для открытия
//! браузера / встраивания в WebView.
//!
//! Используется десктопом как альтернатива встроенному (Rust) дашборду:
//!  - запуск: `WebUiNodeSupervisor::spawn(cfg)` → дочерний node-процесс
//!  - URL: `http://127.0.0.1:<port>/` (без токена — Node-сервер сам слушает loopback)
//!  - shutdown: `drop` или `.shutdown()` — посылает SIGTERM/kill-on-drop.

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::runtime_client::BotLauncher;

#[derive(Debug, Clone)]
pub struct WebUiNodeSpec {
    /// Launcher mode (Portable / Npx / Node) — переиспользует bot-launcher.
    pub launcher: BotLauncher,
    /// HTTP port для WebUI (по умолчанию 3000).
    pub port: u16,
    /// Bind host. Loopback по умолчанию для безопасности.
    pub host: String,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Override GIRL_AGENT_DATA.
    pub data_root: Option<PathBuf>,
}

impl Default for WebUiNodeSpec {
    fn default() -> Self {
        Self {
            launcher: BotLauncher::Npx,
            port: 3000,
            host: "127.0.0.1".to_string(),
            cwd: None,
            data_root: None,
        }
    }
}

/// Запущенный Node WebUI-процесс.
pub struct WebUiNodeProcess {
    child: Mutex<Option<Child>>,
    pub url: String,
}

impl WebUiNodeProcess {
    pub fn spawn(spec: WebUiNodeSpec) -> Result<Self> {
        let mut cmd = build_command(&spec)?;
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(dr) = &spec.data_root {
            cmd.env("GIRL_AGENT_DATA", dr);
        }
        if let Some(cwd) = &spec.cwd {
            cmd.current_dir(cwd);
        }

        tracing::info!(launcher = ?spec.launcher, port = spec.port, host = %spec.host, "spawning WebUI");

        let mut child = cmd.spawn().context("failed to spawn WebUI child process")?;

        // Drain stdout/stderr into tracing, not parsed.
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target = "webui.stdout", "{}", line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target = "webui.stderr", "{}", line);
                }
            });
        }

        let url = format!("http://{}:{}/", spec.host, spec.port);
        Ok(Self {
            child: Mutex::new(Some(child)),
            url,
        })
    }

    /// Стандартная попытка завершить процесс. Сначала kill, ждёт N мс.
    pub async fn shutdown(&self, _grace_ms: u64) {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }

    pub async fn is_alive(&self) -> bool {
        let mut guard = self.child.lock().await;
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => true,
                _ => false,
            }
        } else {
            false
        }
    }
}

fn build_command(spec: &WebUiNodeSpec) -> Result<Command> {
    let mut cmd = match &spec.launcher {
        BotLauncher::Npx => {
            let mut c = if cfg!(target_os = "windows") {
                let mut c = Command::new("npx.cmd");
                c.arg("--yes");
                c
            } else {
                let mut c = Command::new("npx");
                c.arg("--yes");
                c
            };
            c.arg("@thesashadev/girl-agent");
            c
        }
        BotLauncher::Node { cli_path } => {
            let mut c = Command::new(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
            c.arg(cli_path);
            c
        }
        BotLauncher::Portable { node_path, cli_path } => {
            let mut c = Command::new(node_path);
            c.arg(cli_path);
            c
        }
    };
    cmd.arg(format!("--port={}", spec.port));
    cmd.arg(format!("--host={}", spec.host));
    cmd.arg("--no-browser");
    Ok(cmd)
}
