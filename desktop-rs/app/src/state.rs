//! Shared in-memory state used by both the iced UI and the HTTP/WebSocket
//! server.
//!
//! Both producers (the bot stdout reader) and consumers (UI subscriptions /
//! HTTP handlers) operate on the same `AppState`, guarded by a tokio mutex.

use std::collections::VecDeque;
use std::sync::Arc;

use girl_agent_shared::types::{ProfileSummary, RelationshipScore, RuntimeEvent, StageRef};
use serde::Serialize;
use tokio::sync::{broadcast, Mutex};

const LOG_RETAIN: usize = 500;

#[derive(Clone, Debug, Serialize)]
pub struct LogLine {
    pub kind: String,
    pub time: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct DashboardState {
    pub profile: Option<ProfileSummary>,
    pub stage: Option<StageRef>,
    pub score: RelationshipScore,
    pub paused: bool,
    pub running: bool,
    pub logs: Vec<LogLine>,
}

#[derive(Debug)]
pub struct AppState {
    inner: Mutex<Inner>,
    pub events_tx: broadcast::Sender<RuntimeEvent>,
}

#[derive(Debug, Default)]
struct Inner {
    profile: Option<ProfileSummary>,
    stage: Option<StageRef>,
    score: RelationshipScore,
    paused: bool,
    running: bool,
    logs: VecDeque<LogLine>,
}

impl Default for AppState {
    fn default() -> Self {
        let (tx, _rx) = broadcast::channel(256);
        Self {
            inner: Mutex::new(Inner::default()),
            events_tx: tx,
        }
    }
}

impl AppState {
    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn ingest(&self, ev: RuntimeEvent) {
        // Fan out to live subscribers first so latency is minimal.
        let _ = self.events_tx.send(ev.clone());

        let mut g = self.inner.lock().await;
        if let Some(profile) = &ev.profile {
            g.profile = Some(profile.clone());
        }
        if let Some(stage) = &ev.stage {
            g.stage = Some(stage.clone());
        }
        if let Some(score) = ev.score {
            g.score = score;
        }
        if let Some(paused) = ev.paused {
            g.paused = paused;
        }
        match ev.kind.as_str() {
            "ready" => g.running = true,
            "stopped" => g.running = false,
            _ => {}
        }
        if ev.is_log_line() {
            let line = LogLine {
                kind: ev.kind.clone(),
                time: ev.ts_string(),
                text: ev.pretty_log(),
            };
            g.logs.push_back(line);
            while g.logs.len() > LOG_RETAIN {
                g.logs.pop_front();
            }
        }
    }

    pub async fn snapshot(&self) -> DashboardState {
        let g = self.inner.lock().await;
        DashboardState {
            profile: g.profile.clone(),
            stage: g.stage.clone(),
            score: g.score,
            paused: g.paused,
            running: g.running,
            logs: g.logs.iter().cloned().collect(),
        }
    }

    pub async fn set_running(&self, running: bool) {
        let mut g = self.inner.lock().await;
        g.running = running;
    }
}
