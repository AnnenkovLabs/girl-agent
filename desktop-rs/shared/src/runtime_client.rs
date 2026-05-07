//! Drives the Node.js bot in `--json-events` headless mode.
//!
//! The lifecycle is: spawn a child process running `node` (or `npx`) with the
//! `--json-events` flag, read NDJSON events from its stdout, write commands to
//! its stdin. Events are broadcast over an `async_channel` so the iced GUI and
//! the WebSocket subscribers can both consume them.
//!
//! This module is GUI-agnostic — it only depends on `tokio` + `async_channel`.

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use async_channel::{Receiver, Sender};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

use crate::types::RuntimeEvent;

/// How we launch the bot.
///
/// `Portable` is the default after install: a fully self-contained `node.exe`
/// + bundled `cli.js` that lives under `<data>/runtime/`. `System` falls back
/// to the OS `node` if it's on the `$PATH`. `Npx` is the legacy install path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BotLauncher {
    /// Bundled portable runtime: `<runtime>/node(.exe) <runtime>/cli.js`.
    Portable {
        node_path: PathBuf,
        cli_path: PathBuf,
    },
    /// `npx @thesashadev/girl-agent` — picks up the package globally / via npx
    /// cache.
    Npx,
    /// `node <cli_path>` using the system `node` from `$PATH`.
    Node { cli_path: PathBuf },
}

#[derive(Debug, Clone)]
pub struct BotSpawnConfig {
    pub launcher: BotLauncher,
    /// Slug of the profile to launch with `--profile=...`.
    pub profile_slug: String,
    /// Working directory; defaults to the data dir's parent.
    pub cwd: Option<PathBuf>,
    /// Override for `GIRL_AGENT_DATA`.
    pub data_root: Option<PathBuf>,
    /// Extra CLI flags appended verbatim.
    pub extra_args: Vec<String>,
}

/// Live handle to the bot child process.
pub struct BotProcess {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    pub events: Receiver<RuntimeEvent>,
    pub stderr_lines: Receiver<String>,
}

impl BotProcess {
    /// Spawn the bot child and start two reader tasks for stdout (NDJSON
    /// events) and stderr (raw lines for debug logging).
    pub fn spawn(spec: BotSpawnConfig) -> Result<Self> {
        let mut cmd = build_command(&spec)?;
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(dr) = &spec.data_root {
            cmd.env("GIRL_AGENT_DATA", dr);
        }
        if let Some(cwd) = &spec.cwd {
            cmd.current_dir(cwd);
        }

        tracing::info!(launcher = ?spec.launcher, profile = %spec.profile_slug, "spawning bot");

        let mut child = cmd.spawn().with_context(|| "failed to spawn bot child process")?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("child stdin missing"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("child stdout missing"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("child stderr missing"))?;

        let (ev_tx, ev_rx) = async_channel::unbounded();
        let (err_tx, err_rx) = async_channel::unbounded();

        tokio::spawn(stdout_reader(stdout, ev_tx));
        tokio::spawn(stderr_reader(stderr, err_tx));

        Ok(Self {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(Some(stdin)),
            events: ev_rx,
            stderr_lines: err_rx,
        })
    }

    /// Send a `:command\n` line to the bot's stdin.
    pub async fn send_command(&self, line: &str) -> Result<()> {
        let line = line.trim();
        if line.is_empty() {
            return Ok(());
        }
        let mut guard = self.stdin.lock().await;
        let stdin = guard.as_mut().ok_or_else(|| anyhow!("bot stdin closed"))?;
        let mut payload = line.to_string();
        if !payload.starts_with(':') {
            payload.insert(0, ':');
        }
        payload.push('\n');
        stdin.write_all(payload.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Try to gracefully stop the bot (sending `:quit`) and then kill if it
    /// hasn't exited within `grace_ms`.
    pub async fn shutdown(&self, grace_ms: u64) {
        let _ = self.send_command(":quit").await;
        tokio::time::sleep(std::time::Duration::from_millis(grace_ms)).await;
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.kill().await;
        }
    }

    /// Whether the underlying child has exited.
    pub async fn is_alive(&self) -> bool {
        let mut guard = self.child.lock().await;
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                _ => false,
            },
            None => false,
        }
    }
}

fn build_command(spec: &BotSpawnConfig) -> Result<Command> {
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
    cmd.arg(format!("--profile={}", spec.profile_slug));
    cmd.arg("--json-events");
    for extra in &spec.extra_args {
        cmd.arg(extra);
    }
    Ok(cmd)
}

async fn stdout_reader<R>(stdout: R, tx: Sender<RuntimeEvent>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut reader = BufReader::new(stdout).lines();
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<RuntimeEvent>(&line) {
                    Ok(ev) => {
                        if tx.send(ev).await.is_err() {
                            return;
                        }
                    }
                    Err(err) => {
                        tracing::warn!(?err, line = %line, "non-JSON line on bot stdout");
                        let ev = RuntimeEvent {
                            kind: "info".into(),
                            text: Some(line),
                            chat_id: None,
                            reason: None,
                            score: None,
                            stage: None,
                            profile: None,
                            paused: None,
                            ok: None,
                            t: None,
                        };
                        if tx.send(ev).await.is_err() {
                            return;
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(err) => {
                tracing::error!(?err, "bot stdout reader failed");
                break;
            }
        }
    }
    let _ = tx
        .send(RuntimeEvent {
            kind: "stopped".into(),
            text: Some("bot stdout closed".into()),
            chat_id: None,
            reason: None,
            score: None,
            stage: None,
            profile: None,
            paused: None,
            ok: None,
            t: None,
        })
        .await;
}

async fn stderr_reader<R>(stderr: R, tx: Sender<String>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut reader = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if tx.send(line).await.is_err() {
            return;
        }
    }
}
