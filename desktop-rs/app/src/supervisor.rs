//! Owns the running bot child and bridges its stdout into [`AppState`].
//!
//! The supervisor exposes a synchronous-ish `BotHandle` that the iced UI uses
//! to start/stop the bot and dispatch commands without knowing anything about
//! tokio internals.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use girl_agent_shared::runtime_client::{BotLauncher, BotProcess, BotSpawnConfig};
use tokio::sync::Mutex;

use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct BotLaunchSpec {
    pub launcher: BotLauncher,
    pub profile_slug: String,
    pub data_root: PathBuf,
    pub cwd: Option<PathBuf>,
}

/// Cheap to clone; internally an Arc.
#[derive(Clone)]
pub struct BotHandle {
    inner: Arc<Mutex<Option<Arc<BotProcess>>>>,
    state: Arc<AppState>,
}

impl BotHandle {
    pub fn new(state: Arc<AppState>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            state,
        }
    }

    pub async fn start(&self, spec: BotLaunchSpec) -> Result<()> {
        // Stop existing first.
        self.stop().await;

        let cfg = BotSpawnConfig {
            launcher: spec.launcher,
            profile_slug: spec.profile_slug,
            cwd: spec.cwd,
            data_root: Some(spec.data_root),
            extra_args: Vec::new(),
        };
        let bot = Arc::new(BotProcess::spawn(cfg)?);
        let state = self.state.clone();
        let bot_for_pump = bot.clone();
        tokio::spawn(async move {
            loop {
                match bot_for_pump.events.recv().await {
                    Ok(ev) => state.ingest(ev).await,
                    Err(_) => break,
                }
            }
            state.set_running(false).await;
        });
        // Drain stderr to tracing.
        let stderr_rx = bot.stderr_lines.clone();
        tokio::spawn(async move {
            while let Ok(line) = stderr_rx.recv().await {
                tracing::debug!(target = "bot.stderr", "{}", line);
            }
        });
        let mut g = self.inner.lock().await;
        *g = Some(bot);
        self.state.set_running(true).await;
        Ok(())
    }

    pub async fn stop(&self) {
        let mut g = self.inner.lock().await;
        if let Some(bot) = g.take() {
            bot.shutdown(500).await;
        }
        self.state.set_running(false).await;
    }

    pub async fn send_command(&self, line: &str) -> Result<()> {
        let g = self.inner.lock().await;
        if let Some(bot) = g.as_ref() {
            bot.send_command(line).await
        } else {
            Err(anyhow::anyhow!("bot is not running"))
        }
    }

    pub async fn is_running(&self) -> bool {
        let g = self.inner.lock().await;
        match g.as_ref() {
            Some(bot) => bot.is_alive().await,
            None => false,
        }
    }
}
