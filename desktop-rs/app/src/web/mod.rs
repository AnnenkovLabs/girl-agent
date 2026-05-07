//! Local Web UI server.
//!
//! Bound to `127.0.0.1:<port>` so that only processes on the same machine can
//! talk to it. A random opaque token (`web_token` in `Settings`) is required
//! on every endpoint as a tiny extra layer in case the user accidentally
//! forwards the port.
//!
//! Routes:
//!
//!  - `GET  /                   ` — HTML shell of the dashboard.
//!  - `GET  /assets/app.css     ` — stylesheet (uses brand fonts + palette).
//!  - `GET  /assets/app.js      ` — small vanilla-JS client.
//!  - `GET  /assets/fonts/*name`  — embedded TTF.
//!  - `GET  /api/state          ` — JSON snapshot of [`crate::state::DashboardState`].
//!  - `POST /api/command        ` — dispatch `:command` line to the bot.
//!  - `GET  /ws                 ` — push channel for live events.

use std::sync::Arc;

use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use girl_agent_shared::fonts;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;
use crate::supervisor::BotHandle;

pub mod html;

#[derive(Clone)]
pub struct WebState {
    pub state: Arc<AppState>,
    pub bot: BotHandle,
    pub token: String,
}

pub fn router(ws: WebState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/assets/app.css", get(stylesheet))
        .route("/assets/app.js", get(script))
        .route("/assets/fonts/:name", get(font_asset))
        .route("/api/state", get(api_state))
        .route("/api/command", post(api_command))
        .route("/ws", get(ws_handler))
        .with_state(ws)
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

fn check_token(ws: &WebState, q: &Option<String>) -> Result<(), StatusCode> {
    match q {
        Some(t) if t == &ws.token => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn index(State(ws): State<WebState>, Query(q): Query<TokenQuery>) -> Response {
    // Index is the only endpoint that *generates* a token-bearing URL when
    // visited without one — the desktop app prints `?token=...` to stdout.
    if q.token.is_none() {
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            html::landing(),
        )
            .into_response();
    }
    if q.token.as_deref() != Some(ws.token.as_str()) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html::dashboard(&ws.token),
    )
        .into_response()
}

async fn stylesheet() -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        html::CSS,
    )
        .into_response()
}

async fn script() -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        html::JS,
    )
        .into_response()
}

async fn font_asset(AxumPath(name): AxumPath<String>) -> Response {
    for (entry_name, bytes) in fonts::ALL_FONTS {
        if entry_name == &name {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "font/ttf"), (header::CACHE_CONTROL, "public, max-age=86400")],
                bytes.to_vec(),
            )
                .into_response();
        }
    }
    (StatusCode::NOT_FOUND, "no such font").into_response()
}

async fn api_state(State(ws): State<WebState>, Query(q): Query<TokenQuery>) -> Response {
    if let Err(s) = check_token(&ws, &q.token) {
        return s.into_response();
    }
    let snap = ws.state.snapshot().await;
    Json(snap).into_response()
}

#[derive(Deserialize)]
struct CommandPayload {
    line: String,
    token: String,
}

async fn api_command(
    State(ws): State<WebState>,
    Json(payload): Json<CommandPayload>,
) -> Response {
    if payload.token != ws.token {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    match ws.bot.send_command(&payload.line).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(err) => Json(json!({"ok": false, "error": err.to_string()})).into_response(),
    }
}

async fn ws_handler(
    ws_state: State<WebState>,
    Query(q): Query<TokenQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if let Err(s) = check_token(&ws_state, &q.token) {
        return s.into_response();
    }
    upgrade.on_upgrade(move |socket| ws_loop(socket, ws_state.0))
}

async fn ws_loop(mut socket: WebSocket, ws: WebState) {
    // Send initial snapshot immediately so the page can render even before
    // any new event arrives.
    if let Ok(snap) = serde_json::to_string(&json!({
        "type": "snapshot",
        "data": ws.state.snapshot().await,
    })) {
        let _ = socket.send(Message::Text(snap.into())).await;
    }

    let mut rx = ws.state.events_tx.subscribe();
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(ev) => {
                    let payload = json!({"type": "event", "event": ev});
                    if let Ok(text) = serde_json::to_string(&payload) {
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            return;
                        }
                    }
                }
                Err(_) => return,
            },
            // Drain incoming pings to keep the connection alive.
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None => return,
                Some(Err(_)) => return,
                _ => {}
            },
        }
    }
}

/// Spawn the axum server in the background. Returns immediately.
pub async fn serve(ws: WebState, port: u16) -> anyhow::Result<()> {
    let app = router(ws);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!("web ui listening on http://127.0.0.1:{}", port);
    tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            tracing::error!(?err, "axum server stopped");
        }
    });
    Ok(())
}
