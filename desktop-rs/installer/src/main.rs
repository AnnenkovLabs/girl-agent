//! girl-agent installer (iced wizard).
//!
//! Walks the user through Telegram credentials, LLM provider, persona
//! basics, then extracts a bundled portable Node + cli.js into
//! `%APPDATA%\girl-agent\runtime\` and writes the profile config. No
//! `npm` / `npx` is required on the target machine — everything lives
//! inside this single .exe.

// Keep the console attached on Windows for now so panics are visible.
// Re-enable `windows_subsystem = "windows"` once the wizard is stable.
// #![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod config;
mod data;
mod install;
mod tg_proxy;
mod ui;

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use girl_agent_shared::fonts;
use iced::{Subscription, Task};
use rand::Rng;

use crate::config::{NameMode, UserbotAuthSource, WizardData};
use crate::data::{find_llm_preset, pick_random_name, search_tz, default_tz_for_nationality, NAMES_RU, NAMES_UA};
use crate::install::{InstallProgress, InstallStage};
use crate::ui::{InstallOutcome, Msg, Step, TgAuthSuccess, TgVerifyOutcome};

fn main() -> iced::Result {
    install_panic_hook();
    init_tracing();

    iced::application("girl-agent installer", App::update, App::view)
        .theme(|_| girl_agent_shared::theme::iced_theme())
        .font(fonts::UNBOUNDED_REGULAR_TTF)
        .font(fonts::UNBOUNDED_BOLD_TTF)
        .font(fonts::ONEST_REGULAR_TTF)
        .font(fonts::ONEST_MEDIUM_TTF)
        .font(fonts::ONEST_BOLD_TTF)
        .font(fonts::JETBRAINS_MONO_TTF)
        .font(fonts::INSTRUMENT_SERIF_ITALIC_TTF)
        .default_font(fonts::ONEST)
        .subscription(App::subscription)
        .window(window_settings())
        .run_with(App::new)
}

struct App {
    model: ui::Model,
    install_rx: Option<mpsc::Receiver<InstallProgress>>,
}

impl App {
    fn new() -> (Self, Task<Msg>) {
        let mut model = ui::Model::default();
        // pre-fill a random name so the persona screen is never blank
        let seed: u64 = rand::thread_rng().gen();
        model.data.name = pick_random_name(&model.data.nationality, seed).to_string();
        model.data.refresh_slug();
        (Self { model, install_rx: None }, Task::none())
    }

    fn view(&self) -> iced::Element<'_, Msg> {
        ui::view(&self.model)
    }

    fn subscription(&self) -> Subscription<Msg> {
        if self.model.installing {
            iced::time::every(Duration::from_millis(80)).map(|_| Msg::InstallProgressTick(InstallProgress {
                stage: InstallStage::Start,
                fraction: -1.0,
                note: String::new(),
            }))
        } else {
            Subscription::none()
        }
    }

    fn update(&mut self, msg: Msg) -> Task<Msg> {
        match msg {
            Msg::Next => {
                self.model.step = next_step(self.model.step, &self.model.data);
                if self.model.step == Step::Summary {
                    self.model.data.refresh_slug();
                    self.model.data.apply_llm_preset_defaults();
                }
                Task::none()
            }
            Msg::Back => {
                self.model.step = prev_step(self.model.step, &self.model.data);
                Task::none()
            }

            // Telegram
            Msg::ModeChanged(v) => {
                self.model.data.mode = v;
                Task::none()
            }
            Msg::UserbotSourceChanged(s) => {
                self.model.data.userbot_source = s;
                Task::none()
            }
            Msg::TgTokenChanged(v) => {
                self.model.data.tg_token = v;
                Task::none()
            }
            Msg::TgApiIdChanged(v) => {
                self.model.data.tg_api_id = v;
                Task::none()
            }
            Msg::TgApiHashChanged(v) => {
                self.model.data.tg_api_hash = v;
                Task::none()
            }
            Msg::TgPhoneChanged(v) => {
                self.model.data.tg_phone = v;
                Task::none()
            }
            Msg::TgCodeChanged(v) => {
                self.model.data.tg_code = v;
                Task::none()
            }
            Msg::Tg2FaChanged(v) => {
                self.model.data.tg_2fa = v;
                Task::none()
            }

            Msg::TgSendCode => {
                let phone = self.model.data.tg_phone.clone();
                self.model.tg_status = ui::AsyncStatus { busy: true, error: None, note: None };
                Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || tg_proxy::send_code(&phone))
                            .await
                            .unwrap_or_else(|e| Err(anyhow::anyhow!("join: {e}")))
                            .map(|r| r.login_token)
                            .map_err(|e| e.to_string())
                    },
                    Msg::TgSendCodeFinished,
                )
            }
            Msg::TgSendCodeFinished(res) => {
                self.model.tg_status.busy = false;
                match res {
                    Ok(token) => {
                        self.model.data.tg_login_token = token;
                        self.model.tg_status.note = Some("код отправлен в telegram".into());
                        self.model.step = Step::TgUserbotCode;
                    }
                    Err(e) => {
                        self.model.tg_status.error = Some(e);
                    }
                }
                Task::none()
            }

            Msg::TgVerifyCode => {
                let token = self.model.data.tg_login_token.clone();
                let code = self.model.data.tg_code.clone();
                self.model.tg_status = ui::AsyncStatus { busy: true, error: None, note: None };
                Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || tg_proxy::verify_code(&token, &code))
                            .await
                            .unwrap_or_else(|e| Err(anyhow::anyhow!("join: {e}")))
                            .map(|r| match r {
                                tg_proxy::VerifyCodeResult::Success(s) => TgVerifyOutcome {
                                    success: Some(TgAuthSuccess {
                                        session_string: s.session_string,
                                        api_id: s.api_id,
                                        api_hash: s.api_hash,
                                    }),
                                    needs_2fa_login_token: None,
                                },
                                tg_proxy::VerifyCodeResult::Needs2Fa { login_token } => {
                                    TgVerifyOutcome {
                                        success: None,
                                        needs_2fa_login_token: Some(login_token),
                                    }
                                }
                            })
                            .map_err(|e| e.to_string())
                    },
                    Msg::TgVerifyCodeFinished,
                )
            }
            Msg::TgVerifyCodeFinished(res) => {
                self.model.tg_status.busy = false;
                match res {
                    Ok(out) => {
                        if let Some(s) = out.success {
                            self.model.data.tg_session_string = s.session_string;
                            self.model.data.tg_resolved_api_id = s.api_id.to_string();
                            self.model.data.tg_resolved_api_hash = s.api_hash;
                            self.model.tg_status.note = Some("вход выполнен".into());
                            self.model.step = Step::LlmPicker;
                        } else if let Some(token) = out.needs_2fa_login_token {
                            self.model.data.tg_login_token = token;
                            self.model.data.tg_needs_2fa = true;
                            self.model.tg_status.note = Some("включена двухфакторная — введи пароль".into());
                            self.model.step = Step::TgUserbot2Fa;
                        }
                    }
                    Err(e) => {
                        self.model.tg_status.error = Some(e);
                    }
                }
                Task::none()
            }

            Msg::TgVerifyPassword => {
                let token = self.model.data.tg_login_token.clone();
                let pass = self.model.data.tg_2fa.clone();
                self.model.tg_status = ui::AsyncStatus { busy: true, error: None, note: None };
                Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || tg_proxy::verify_password(&token, &pass))
                            .await
                            .unwrap_or_else(|e| Err(anyhow::anyhow!("join: {e}")))
                            .map(|s| TgAuthSuccess {
                                session_string: s.session_string,
                                api_id: s.api_id,
                                api_hash: s.api_hash,
                            })
                            .map_err(|e| e.to_string())
                    },
                    Msg::TgVerifyPasswordFinished,
                )
            }
            Msg::TgVerifyPasswordFinished(res) => {
                self.model.tg_status.busy = false;
                match res {
                    Ok(s) => {
                        self.model.data.tg_session_string = s.session_string;
                        self.model.data.tg_resolved_api_id = s.api_id.to_string();
                        self.model.data.tg_resolved_api_hash = s.api_hash;
                        self.model.tg_status.note = Some("вход выполнен".into());
                        self.model.step = Step::LlmPicker;
                    }
                    Err(e) => {
                        self.model.tg_status.error = Some(e);
                    }
                }
                Task::none()
            }

            // LLM
            Msg::LlmPresetChanged(v) => {
                self.model.data.llm_preset = v;
                self.model.data.llm_model = String::new();
                self.model.data.llm_base_url = String::new();
                self.model.data.llm_api_key = String::new();
                self.model.data.apply_llm_preset_defaults();
                Task::none()
            }
            Msg::LlmModelChanged(v) => {
                self.model.data.llm_model = v;
                Task::none()
            }
            Msg::LlmKeyChanged(v) => {
                self.model.data.llm_api_key = v;
                Task::none()
            }
            Msg::LlmBaseUrlChanged(v) => {
                self.model.data.llm_base_url = v;
                Task::none()
            }

            // Persona
            Msg::NationalityChanged(v) => {
                self.model.data.nationality = v.clone();
                if self.model.data.tz.is_empty()
                    || matches!(self.model.data.tz.as_str(), "Europe/Moscow" | "Europe/Kyiv")
                {
                    self.model.data.tz = default_tz_for_nationality(&v).to_string();
                }
                if matches!(self.model.data.name_mode, NameMode::Random) {
                    let seed: u64 = rand::thread_rng().gen();
                    self.model.data.name = pick_random_name(&v, seed).to_string();
                    self.model.data.refresh_slug();
                }
                Task::none()
            }
            Msg::NameModeChanged(m) => {
                self.model.data.name_mode = m;
                Task::none()
            }
            Msg::NameChanged(v) => {
                self.model.data.name = v;
                self.model.data.name_mode = NameMode::Manual;
                self.model.data.refresh_slug();
                Task::none()
            }
            Msg::NameRandom => {
                let seed: u64 = rand::thread_rng().gen();
                self.model.data.name = pick_random_name(&self.model.data.nationality, seed).to_string();
                self.model.data.name_mode = NameMode::Random;
                self.model.data.refresh_slug();
                Task::none()
            }
            Msg::AgeChanged(v) => {
                self.model.data.age = v.clamp(14, 99);
                Task::none()
            }
            Msg::TzQueryChanged(v) => {
                self.model.tz_query = v;
                Task::none()
            }
            Msg::TzSelected(v) => {
                self.model.data.tz = v;
                Task::none()
            }
            Msg::SleepPresetChanged(v) => {
                self.model.data.sleep_preset = v;
                Task::none()
            }
            Msg::SleepCustomFromChanged(v) => {
                if let Some(h) = parse_hour(&v) {
                    self.model.data.sleep_custom_from = h;
                }
                Task::none()
            }
            Msg::SleepCustomToChanged(v) => {
                if let Some(h) = parse_hour(&v) {
                    self.model.data.sleep_custom_to = h;
                }
                Task::none()
            }
            Msg::SleepCustomChanceChanged(v) => {
                self.model.data.sleep_custom_wake_chance = v.min(100);
                Task::none()
            }

            // Tournament
            Msg::NameTournamentStart => {
                tournament_start(&mut self.model.data);
                Task::none()
            }
            Msg::NameTournamentPick(name) => {
                tournament_pick(&mut self.model.data, &name);
                Task::none()
            }
            Msg::NameTournamentSkip => {
                tournament_skip(&mut self.model.data);
                Task::none()
            }
            Msg::NameTournamentRestart => {
                tournament_start(&mut self.model.data);
                Task::none()
            }

            // Clipboard paste (works regardless of keyboard layout — explicit
            // button avoids relying on Ctrl+V which iced binds to the Latin
            // "v" only).
            Msg::PasteRequest(target) => {
                iced::clipboard::read().map(move |s| Msg::PasteContent(target, s))
            }
            Msg::PasteContent(target, content) => {
                let value = match content {
                    Some(s) => s,
                    None => return Task::none(),
                };
                paste_into(&mut self.model.data, &mut self.model.tz_query, target, value);
                Task::none()
            }

            // Style
            Msg::StageChanged(v) => {
                self.model.data.stage = v;
                Task::none()
            }
            Msg::CommunicationChanged(v) => {
                self.model.data.communication = v;
                Task::none()
            }
            Msg::PrivacyChanged(v) => {
                self.model.data.privacy = v;
                Task::none()
            }

            // Notes
            Msg::NotesChanged(v) => {
                self.model.data.persona_notes = v;
                Task::none()
            }

            // Install
            Msg::StartInstall => {
                self.model.installing = true;
                self.model.install_error = None;
                self.model.step = Step::Installing;
                self.model.install_progress = InstallProgress {
                    stage: InstallStage::Start,
                    fraction: 0.02,
                    note: "подготовка…".into(),
                };
                let (tx, rx) = mpsc::channel();
                self.install_rx = Some(rx);
                let data = self.model.data.clone();
                Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || install::run(&data, tx))
                            .await
                            .unwrap_or_else(|e| Err(anyhow::anyhow!("join: {e}")))
                            .map(|r| InstallOutcome {
                                log: r.log,
                                config_path: r.config_path.display().to_string(),
                                runtime_dir: r.runtime_dir.display().to_string(),
                            })
                            .map_err(|e| e.to_string())
                    },
                    Msg::InstallFinished,
                )
            }
            Msg::InstallProgressTick(_marker) => {
                if let Some(rx) = &self.install_rx {
                    while let Ok(p) = rx.try_recv() {
                        self.model.install_progress = p;
                    }
                }
                Task::none()
            }
            Msg::InstallFinished(res) => {
                self.model.installing = false;
                self.install_rx = None;
                match res {
                    Ok(o) => {
                        self.model.install = Some(o);
                        self.model.step = Step::Done;
                    }
                    Err(e) => {
                        self.model.install_error = Some(e);
                        self.model.step = Step::Done;
                    }
                }
                Task::none()
            }

            Msg::LaunchAndQuit => {
                let _ = launch_desktop_app();
                std::process::exit(0);
            }
            Msg::Quit => std::process::exit(0),
            Msg::OpenLink(url) => {
                let _ = open::that_in_background(url);
                Task::none()
            }
        }
    }
}

fn next_step(s: Step, d: &WizardData) -> Step {
    use Step::*;
    match s {
        Welcome => TgMode,
        TgMode => {
            if d.mode == "bot" {
                TgBotToken
            } else {
                TgUserbotSource
            }
        }
        TgBotToken => LlmPicker,
        TgUserbotSource => match d.userbot_source {
            UserbotAuthSource::Owner => TgUserbotPhone,
            UserbotAuthSource::Own => TgUserbotApi,
        },
        TgUserbotApi => TgUserbotPhone,
        TgUserbotPhone => TgUserbotCode,
        TgUserbotCode => {
            if d.tg_needs_2fa {
                TgUserbot2Fa
            } else {
                LlmPicker
            }
        }
        TgUserbot2Fa => LlmPicker,
        LlmPicker => LlmConfig,
        LlmConfig => Persona,
        Persona => {
            if matches!(d.name_mode, NameMode::Tournament) {
                NameTournament
            } else {
                Style
            }
        }
        NameTournament => Style,
        Style => Notes,
        Notes => Summary,
        Summary => Installing,
        Installing => Done,
        Done => Done,
    }
}

fn prev_step(s: Step, d: &WizardData) -> Step {
    use Step::*;
    match s {
        Welcome => Welcome,
        TgMode => Welcome,
        TgBotToken => TgMode,
        TgUserbotSource => TgMode,
        TgUserbotApi => TgUserbotSource,
        TgUserbotPhone => match d.userbot_source {
            UserbotAuthSource::Owner => TgUserbotSource,
            UserbotAuthSource::Own => TgUserbotApi,
        },
        TgUserbotCode => TgUserbotPhone,
        TgUserbot2Fa => TgUserbotCode,
        LlmPicker => {
            if d.mode == "bot" {
                TgBotToken
            } else if d.tg_needs_2fa {
                TgUserbot2Fa
            } else {
                TgUserbotCode
            }
        }
        LlmConfig => LlmPicker,
        Persona => LlmConfig,
        NameTournament => Persona,
        Style => {
            if matches!(d.name_mode, NameMode::Tournament) {
                NameTournament
            } else {
                Persona
            }
        }
        Notes => Style,
        Summary => Notes,
        Installing => Summary,
        Done => Summary,
    }
}

fn window_settings() -> iced::window::Settings {
    iced::window::Settings {
        size: iced::Size::new(820.0, 720.0),
        min_size: Some(iced::Size::new(720.0, 600.0)),
        ..iced::window::Settings::default()
    }
}

fn install_panic_hook() {
    let log_dir = girl_agent_shared::paths::app_log_dir();
    let log_path = log_dir.join("installer-crash.log");
    let log_path2 = log_path.clone();
    std::panic::set_hook(Box::new(move |info| {
        use std::io::Write;
        let backtrace = std::backtrace::Backtrace::force_capture();
        let msg = format!(
            "[{}] PANIC at {}\n{}\nbacktrace:\n{}\n\n",
            chrono::Utc::now().to_rfc3339(),
            info.location()
                .map(|l| format!("{}:{}", l.file(), l.line()))
                .unwrap_or_else(|| "<unknown>".into()),
            info,
            backtrace,
        );
        eprintln!("{msg}");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = f.write_all(msg.as_bytes());
            let _ = f.flush();
        }
    }));
    eprintln!("girl-agent installer · crash log: {}", log_path2.display());
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

fn launch_desktop_app() -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().unwrap_or(std::path::Path::new("."));
    let candidate: PathBuf = if cfg!(target_os = "windows") {
        dir.join("girl-agent-desktop.exe")
    } else {
        dir.join("girl-agent-desktop")
    };
    if candidate.exists() {
        std::process::Command::new(candidate).spawn().map(|_| ())
    } else {
        let _ = open::that_in_background(girl_agent_shared::paths::data_dir());
        Ok(())
    }
}

#[allow(dead_code)]
fn unused_imports_silencer() {
    let _ = (find_llm_preset, search_tz, NAMES_RU, NAMES_UA);
}

fn parse_hour(label: &str) -> Option<u8> {
    label.split(':').next().and_then(|h| h.parse::<u8>().ok())
}

fn paste_into(
    d: &mut WizardData,
    tz_query: &mut String,
    target: ui::PasteTarget,
    value: String,
) {
    use ui::PasteTarget::*;
    let trimmed = value.trim().to_string();
    match target {
        TgToken => d.tg_token = trimmed,
        TgApiId => d.tg_api_id = trimmed,
        TgApiHash => d.tg_api_hash = trimmed,
        TgPhone => d.tg_phone = trimmed,
        TgCode => d.tg_code = trimmed,
        Tg2Fa => d.tg_2fa = trimmed,
        LlmModel => d.llm_model = trimmed,
        LlmKey => d.llm_api_key = trimmed,
        LlmBaseUrl => d.llm_base_url = trimmed,
        Name => {
            d.name = trimmed;
            d.name_mode = NameMode::Manual;
            d.refresh_slug();
        }
        Notes => d.persona_notes = value,
        TzQuery => *tz_query = trimmed,
    }
}

// =====================================================================
// Tournament name picker — mirrors src/wizard/index.tsx (lines 518–644).
// =====================================================================

const TOURNAMENT_QUALS: u32 = 20;

fn tournament_pool(d: &WizardData) -> Vec<&'static str> {
    let pool: &[&str] = if d.nationality == "UA" { NAMES_UA } else { NAMES_RU };
    pool.iter().copied().collect()
}

fn tournament_start(d: &mut WizardData) {
    use crate::config::TournamentPhase;
    let pool = tournament_pool(d);
    d.tournament_round = 0;
    d.tournament_qualifiers.clear();
    d.tournament_seen.clear();
    d.tournament_pool = pool.iter().map(|s| s.to_string()).collect();
    d.tournament_phase = TournamentPhase::Quals;
    tournament_next_pair(d);
}

fn tournament_next_pair(d: &mut WizardData) {
    use crate::config::TournamentPhase;
    match d.tournament_phase {
        TournamentPhase::Idle => {}
        TournamentPhase::Quals => {
            if d.tournament_round >= TOURNAMENT_QUALS {
                tournament_promote_to_knockout(d);
                return;
            }
            let pair = pick_unseen_pair(&d.tournament_pool, &d.tournament_seen);
            match pair {
                Some((a, b)) => {
                    d.tournament_seen.push(a.clone());
                    d.tournament_seen.push(b.clone());
                    d.tournament_pair = (a, b);
                }
                None => {
                    tournament_promote_to_knockout(d);
                }
            }
        }
        TournamentPhase::Knockout => {
            if d.tournament_pool.len() <= 1 {
                if let Some(winner) = d.tournament_pool.first().cloned() {
                    d.name = winner;
                    d.name_mode = NameMode::Tournament;
                    d.refresh_slug();
                }
                d.tournament_phase = TournamentPhase::Idle;
                d.tournament_pair = (String::new(), String::new());
                return;
            }
            let a = d.tournament_pool.remove(0);
            let b = d.tournament_pool.remove(0);
            d.tournament_pair = (a, b);
        }
    }
}

fn tournament_promote_to_knockout(d: &mut WizardData) {
    use crate::config::TournamentPhase;
    if d.tournament_qualifiers.is_empty() {
        // No qualifiers? fall back to a single random name.
        let seed: u64 = rand::thread_rng().gen();
        d.name = pick_random_name(&d.nationality, seed).to_string();
        d.name_mode = NameMode::Tournament;
        d.refresh_slug();
        d.tournament_phase = TournamentPhase::Idle;
        d.tournament_pair = (String::new(), String::new());
        return;
    }
    if d.tournament_qualifiers.len() == 1 {
        d.name = d.tournament_qualifiers[0].clone();
        d.name_mode = NameMode::Tournament;
        d.refresh_slug();
        d.tournament_phase = TournamentPhase::Idle;
        d.tournament_pair = (String::new(), String::new());
        return;
    }
    d.tournament_pool = d.tournament_qualifiers.clone();
    d.tournament_qualifiers.clear();
    d.tournament_phase = TournamentPhase::Knockout;
    tournament_next_pair(d);
}

fn pick_unseen_pair(pool: &[String], seen: &[String]) -> Option<(String, String)> {
    let candidates: Vec<&String> = pool.iter().filter(|n| !seen.contains(n)).collect();
    if candidates.len() < 2 {
        return None;
    }
    let mut rng = rand::thread_rng();
    use rand::seq::SliceRandom;
    let mut shuffled = candidates.clone();
    shuffled.shuffle(&mut rng);
    Some((shuffled[0].clone(), shuffled[1].clone()))
}

fn tournament_pick(d: &mut WizardData, name: &str) {
    use crate::config::TournamentPhase;
    if name.is_empty() {
        return;
    }
    match d.tournament_phase {
        TournamentPhase::Quals => {
            if !d.tournament_qualifiers.iter().any(|n| n == name) {
                d.tournament_qualifiers.push(name.to_string());
            }
            d.tournament_round += 1;
            tournament_next_pair(d);
        }
        TournamentPhase::Knockout => {
            d.tournament_pool.push(name.to_string());
            tournament_next_pair(d);
        }
        TournamentPhase::Idle => {}
    }
}

fn tournament_skip(d: &mut WizardData) {
    use crate::config::TournamentPhase;
    if matches!(d.tournament_phase, TournamentPhase::Quals) {
        d.tournament_round += 1;
    }
    tournament_next_pair(d);
}
