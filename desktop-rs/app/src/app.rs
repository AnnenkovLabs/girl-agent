//! Iced application: state, messages, update/view/subscription.

use std::path::PathBuf;
use std::sync::Arc;

use girl_agent_shared::config::{list_profiles, ProfileConfig};
use girl_agent_shared::paths;
use girl_agent_shared::runtime_client::BotLauncher;
use girl_agent_shared::settings::{MinimizeTarget, Settings};
use girl_agent_shared::types::RuntimeEvent;
use iced::{Element, Subscription, Task};
use tokio::sync::broadcast;

use crate::state::{AppState, DashboardState};
use crate::supervisor::{BotHandle, BotLaunchSpec};
use crate::ui;

/// Boot-time configuration injected by `main`.
#[derive(Clone)]
pub struct AppContext {
    pub state: Arc<AppState>,
    pub bot: BotHandle,
    pub settings: Settings,
    pub web_url: Option<String>,
    pub data_root: PathBuf,
    pub profiles: Vec<ProfileConfig>,
    pub launcher: BotLauncher,
}

#[derive(Debug, Clone)]
pub enum Message {
    DashboardTick(DashboardState),
    EventReceived(Box<RuntimeEvent>),
    EventStreamClosed,
    CommandInputChanged(String),
    SubmitCommand,
    CommandSent(Result<(), String>),
    TogglePause,
    OpenWebUi,
    AskMinimize,
    MinimizeChosen(MinimizeTarget),
    MinimizeCancelled,
    MinimizeRememberToggled(bool),
    StartBot,
    BotStarted(Result<(), String>),
    Refresh,
    SelectProfile(String),
    OpenProfilePicker,
    CloseProfilePicker,
    Noop,
}

pub struct Model {
    pub ctx: AppContext,
    pub dashboard: DashboardState,
    pub command_input: String,
    pub minimize_prompt_visible: bool,
    pub minimize_remember: bool,
    pub profile_picker_visible: bool,
}

impl Model {
    pub fn new(ctx: AppContext) -> (Self, Task<Message>) {
        // Show the profile picker if we have 2+ profiles and no clear last
        // choice — or if the saved last_profile no longer exists on disk.
        let profile_count = ctx.profiles.len();
        let last_exists = ctx
            .settings
            .last_profile
            .as_ref()
            .map(|slug| ctx.profiles.iter().any(|p| p.slug == *slug))
            .unwrap_or(false);
        let show_picker = profile_count >= 2 && !last_exists;

        let model = Self {
            minimize_remember: ctx.settings.remember_minimize_choice,
            command_input: String::new(),
            dashboard: DashboardState::default(),
            profile_picker_visible: show_picker,
            ctx,
            minimize_prompt_visible: false,
        };

        // Trigger an initial state pull so the UI reflects whatever the bot
        // has emitted before we got a chance to subscribe.
        let state = model.ctx.state.clone();
        let initial = Task::perform(async move { state.snapshot().await }, Message::DashboardTick);

        // Auto-start bot only if we know which profile to load and we're not
        // showing the picker.
        let auto_start = if !show_picker && last_exists {
            Task::done(Message::StartBot)
        } else if !show_picker && profile_count == 1 {
            Task::done(Message::StartBot)
        } else {
            Task::none()
        };

        (model, Task::batch([initial, auto_start]))
    }

    pub fn title(&self) -> String {
        match &self.dashboard.profile {
            Some(p) => format!("girl-agent · {}", p.name),
            None => String::from("girl-agent"),
        }
    }

    pub fn theme(&self) -> iced::Theme {
        girl_agent_shared::theme::iced_theme()
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::DashboardTick(snap) => {
                self.dashboard = snap;
                Task::none()
            }
            Message::EventReceived(_ev) => {
                // The state is updated asynchronously by `AppState::ingest`.
                // Refresh our UI snapshot so the next view reflects it.
                let state = self.ctx.state.clone();
                Task::perform(async move { state.snapshot().await }, Message::DashboardTick)
            }
            Message::EventStreamClosed => Task::none(),
            Message::CommandInputChanged(v) => {
                self.command_input = v;
                Task::none()
            }
            Message::SubmitCommand => {
                let line = self.command_input.trim().to_string();
                if line.is_empty() {
                    return Task::none();
                }
                self.command_input.clear();
                let bot = self.ctx.bot.clone();
                Task::perform(
                    async move { bot.send_command(&line).await.map_err(|e| e.to_string()) },
                    Message::CommandSent,
                )
            }
            Message::CommandSent(_) => Task::none(),
            Message::TogglePause => {
                let bot = self.ctx.bot.clone();
                let line = if self.dashboard.paused { ":resume" } else { ":pause" }.to_string();
                Task::perform(
                    async move { bot.send_command(&line).await.map_err(|e| e.to_string()) },
                    Message::CommandSent,
                )
            }
            Message::OpenWebUi => {
                if let Some(url) = self.ctx.web_url.clone() {
                    let _ = open::that_in_background(url);
                }
                Task::none()
            }
            Message::AskMinimize => {
                if self.ctx.settings.remember_minimize_choice {
                    apply_minimize(self.ctx.settings.minimize_to)
                } else {
                    self.minimize_prompt_visible = true;
                    Task::none()
                }
            }
            Message::MinimizeChosen(target) => {
                self.minimize_prompt_visible = false;
                if self.minimize_remember {
                    self.ctx.settings.remember_minimize_choice = true;
                    self.ctx.settings.minimize_to = target;
                    let _ = self.ctx.settings.save();
                }
                apply_minimize(target)
            }
            Message::MinimizeCancelled => {
                self.minimize_prompt_visible = false;
                Task::none()
            }
            Message::MinimizeRememberToggled(v) => {
                self.minimize_remember = v;
                Task::none()
            }
            Message::StartBot => {
                let slug = self
                    .ctx
                    .settings
                    .last_profile
                    .clone()
                    .or_else(|| self.ctx.profiles.first().map(|p| p.slug.clone()));
                let Some(slug) = slug else {
                    return Task::none();
                };
                let spec = BotLaunchSpec {
                    launcher: self.ctx.launcher.clone(),
                    profile_slug: slug,
                    data_root: self.ctx.data_root.clone(),
                    cwd: None,
                };
                let bot = self.ctx.bot.clone();
                Task::perform(
                    async move { bot.start(spec).await.map_err(|e| e.to_string()) },
                    Message::BotStarted,
                )
            }
            Message::BotStarted(Err(err)) => {
                tracing::warn!(?err, "bot failed to start");
                Task::none()
            }
            Message::BotStarted(Ok(())) => Task::none(),
            Message::Refresh => {
                let state = self.ctx.state.clone();
                Task::perform(async move { state.snapshot().await }, Message::DashboardTick)
            }
            Message::SelectProfile(slug) => {
                self.ctx.settings.last_profile = Some(slug);
                let _ = self.ctx.settings.save();
                self.profile_picker_visible = false;
                Task::done(Message::StartBot)
            }
            Message::OpenProfilePicker => {
                refresh_profiles(&mut self.ctx);
                self.profile_picker_visible = true;
                Task::none()
            }
            Message::CloseProfilePicker => {
                self.profile_picker_visible = false;
                Task::none()
            }
            Message::Noop => Task::none(),
        }
    }

    pub fn view(&self) -> Element<'_, Message> {
        ui::dashboard::view(self)
    }

    pub fn subscription(&self) -> Subscription<Message> {
        // Subscribe to the broadcast channel so view updates whenever the bot
        // emits a new event.
        let rx = self.ctx.state.events_tx.subscribe();
        let stream = broadcast_to_subscription(rx);
        Subscription::run_with_id(0u64, stream)
    }
}

fn apply_minimize(target: MinimizeTarget) -> Task<Message> {
    match target {
        MinimizeTarget::Taskbar => iced::window::get_latest().then(|id| match id {
            Some(id) => iced::window::minimize::<Message>(id, true).discard(),
            None => Task::none(),
        }),
        MinimizeTarget::Tray => iced::window::get_latest().then(|id| match id {
            Some(id) => iced::window::change_mode::<Message>(id, iced::window::Mode::Hidden)
                .discard(),
            None => Task::none(),
        }),
    }
}

fn broadcast_to_subscription(
    mut rx: broadcast::Receiver<RuntimeEvent>,
) -> impl iced::futures::Stream<Item = Message> + Send + 'static {
    iced::futures::stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Ok(ev) => Some((Message::EventReceived(Box::new(ev)), rx)),
            Err(_) => None,
        }
    })
}

/// Refresh the profile list from disk (called on installer-triggered refresh).
pub fn refresh_profiles(ctx: &mut AppContext) {
    ctx.profiles = list_profiles(&paths::data_dir());
}
