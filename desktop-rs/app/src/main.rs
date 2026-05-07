//! Entry point for `girl-agent-desktop`.
//!
//! Boots tracing, the local Web UI server, the bot supervisor, then hands
//! control to iced.

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod state;
mod supervisor;
mod tray;
mod ui;
mod web;

use std::path::PathBuf;

use girl_agent_shared::config::list_profiles;
use girl_agent_shared::fonts;
use girl_agent_shared::paths;
use girl_agent_shared::runtime_client::BotLauncher;
use girl_agent_shared::settings::Settings;

use crate::app::{AppContext, Model};
use crate::state::AppState;
use crate::supervisor::BotHandle;
use crate::web::WebState;

fn main() -> iced::Result {
    init_tracing();

    let settings = Settings::load();
    let data_root = paths::data_dir();
    let profiles = list_profiles(&data_root);

    tracing::info!(
        "starting girl-agent-desktop, data_root = {}",
        data_root.display()
    );

    let state = AppState::new_arc();
    let bot = BotHandle::new(state.clone());
    let token = settings.web_token.clone();
    let port = settings.web_port;
    let web_url = if settings.web_enabled {
        Some(format!("http://127.0.0.1:{}/?token={}", port, token))
    } else {
        None
    };

    let launcher = decide_launcher();

    // Build a tokio runtime to host the web server *outside* of iced's own
    // executor, so we don't entangle the GUI's event loop.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("girl-agent-bg")
        .build()
        .expect("failed to build tokio runtime");

    if settings.web_enabled {
        let ws = WebState {
            state: state.clone(),
            bot: bot.clone(),
            token: token.clone(),
        };
        runtime.spawn(async move {
            if let Err(err) = web::serve(ws, port).await {
                tracing::error!(?err, "web server failed to start");
            }
        });
    }

    // The system tray is best-effort. Even if it fails (e.g. on a headless
    // Linux runner), the app still works.
    let _tray = tray::imp::build()
        .map_err(|e| tracing::warn!(error = %e, "tray icon unavailable"))
        .ok();

    let ctx = AppContext {
        state: state.clone(),
        bot,
        settings,
        web_url,
        data_root,
        profiles,
        launcher,
    };

    if let Some(url) = &ctx.web_url {
        tracing::info!(url = %url, "Web UI available");
    }

    iced::application(Model::title, Model::update, Model::view)
        .theme(Model::theme)
        .subscription(Model::subscription)
        .font(fonts::UNBOUNDED_REGULAR_TTF)
        .font(fonts::UNBOUNDED_BOLD_TTF)
        .font(fonts::ONEST_REGULAR_TTF)
        .font(fonts::ONEST_MEDIUM_TTF)
        .font(fonts::ONEST_BOLD_TTF)
        .font(fonts::JETBRAINS_MONO_TTF)
        .font(fonts::INSTRUMENT_SERIF_ITALIC_TTF)
        .default_font(girl_agent_shared::fonts::ONEST)
        .window(window_settings())
        .run_with(move || {
            // Hold the runtime alive for the lifetime of the iced app — the
            // tokio tasks (web server, bot supervisor, broadcast pumps) need
            // it.
            std::mem::forget(runtime);
            Model::new(ctx)
        })
}

fn window_settings() -> iced::window::Settings {
    iced::window::Settings {
        size: iced::Size::new(960.0, 720.0),
        min_size: Some(iced::Size::new(720.0, 540.0)),
        ..iced::window::Settings::default()
    }
}

fn decide_launcher() -> BotLauncher {
    let runtime_dir = girl_agent_shared::paths::runtime_dir();
    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    let portable_node = runtime_dir.join(node_name);
    let portable_cli = runtime_dir.join("cli.js");
    if portable_node.exists() && portable_cli.exists() {
        return BotLauncher::Portable {
            node_path: portable_node,
            cli_path: portable_cli,
        };
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut p = exe.clone();
        for _ in 0..6 {
            if p.pop() {
                let candidate = p.join("dist").join("cli.js");
                if candidate.exists() {
                    return BotLauncher::Node { cli_path: candidate };
                }
            }
        }
    }
    if let Ok(env_path) = std::env::var("GIRL_AGENT_CLI") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return BotLauncher::Node { cli_path: p };
        }
    }
    BotLauncher::Npx
}

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();
}
