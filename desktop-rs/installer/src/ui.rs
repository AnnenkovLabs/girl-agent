//! Iced UI for the wizard.
//!
//! The flow mirrors `src/wizard/index.tsx` from the TS CLI wizard, ported to a
//! native iced GUI:
//!
//! Welcome → TgMode → (TgBotToken | TgUserbotPhone → TgUserbotCode →
//! TgUserbot2FA?) → LlmPicker → LlmConfig → Persona → Style → Notes →
//! Summary → Installing → Done

use std::sync::Arc;

use girl_agent_shared::fonts::{instrument_italic, onest_bold, onest_medium, JETBRAINS, ONEST};
use girl_agent_shared::theme::{
    ACCENT, ACCENT2, ACCENT3, BONE, BONE2, INK, LINE, MUTED, RADIUS_MD,
};
use iced::widget::{
    button, column, container, pick_list, progress_bar, row, scrollable, slider, text,
    text_input, Column, Space,
};
use iced::{Alignment, Background, Border, Element, Length, Padding};

use crate::config::{NameMode, UserbotAuthSource, WizardData};
use crate::data::{
    find_llm_preset, search_tz, COMMUNICATION_PRESETS, LLM_PRESETS, NATIONALITIES,
    PRIVACY_OPTIONS, SLEEP_PRESETS, STAGE_PRESETS, TIMEZONES,
};
use crate::install::{InstallProgress, InstallStage};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PasteTarget {
    TgToken,
    TgApiId,
    TgApiHash,
    TgPhone,
    TgCode,
    Tg2Fa,
    LlmModel,
    LlmKey,
    LlmBaseUrl,
    Name,
    Notes,
    TzQuery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Step {
    Welcome,
    TgMode,
    TgBotToken,
    TgUserbotSource,
    TgUserbotApi,
    TgUserbotPhone,
    TgUserbotCode,
    TgUserbot2Fa,
    LlmPicker,
    LlmConfig,
    Persona,
    NameTournament,
    Style,
    Notes,
    Summary,
    Installing,
    Done,
}

#[derive(Debug, Clone)]
pub enum Msg {
    Next,
    Back,

    // Telegram
    ModeChanged(String),
    UserbotSourceChanged(UserbotAuthSource),
    TgTokenChanged(String),
    TgApiIdChanged(String),
    TgApiHashChanged(String),
    TgPhoneChanged(String),
    TgCodeChanged(String),
    Tg2FaChanged(String),
    TgSendCode,
    TgSendCodeFinished(Result<String, String>),
    TgVerifyCode,
    TgVerifyCodeFinished(Result<TgVerifyOutcome, String>),
    TgVerifyPassword,
    TgVerifyPasswordFinished(Result<TgAuthSuccess, String>),

    // LLM
    LlmPresetChanged(String),
    LlmModelChanged(String),
    LlmKeyChanged(String),
    LlmBaseUrlChanged(String),

    // Persona
    NationalityChanged(String),
    NameModeChanged(NameMode),
    NameChanged(String),
    NameRandom,
    AgeChanged(u8),
    TzQueryChanged(String),
    TzSelected(String),
    SleepPresetChanged(String),
    SleepCustomFromChanged(String),
    SleepCustomToChanged(String),
    SleepCustomChanceChanged(u8),

    // Tournament
    NameTournamentStart,
    NameTournamentPick(String),
    NameTournamentSkip,
    NameTournamentRestart,

    // Style
    StageChanged(String),
    CommunicationChanged(String),
    PrivacyChanged(String),

    // Notes
    NotesChanged(String),

    // Clipboard paste (works with Russian keyboard layout)
    PasteRequest(PasteTarget),
    PasteContent(PasteTarget, Option<String>),

    // Install
    StartInstall,
    InstallProgressTick(InstallProgress),
    InstallFinished(Result<InstallOutcome, String>),
    LaunchAndQuit,
    Quit,
    OpenLink(&'static str),
}

#[derive(Debug, Clone)]
pub struct TgVerifyOutcome {
    pub success: Option<TgAuthSuccess>,
    pub needs_2fa_login_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TgAuthSuccess {
    pub session_string: String,
    pub api_id: i64,
    pub api_hash: String,
}

#[derive(Debug, Clone)]
pub struct InstallOutcome {
    pub log: String,
    pub config_path: String,
    pub runtime_dir: String,
}

#[derive(Debug, Default, Clone)]
pub struct AsyncStatus {
    pub busy: bool,
    pub error: Option<String>,
    pub note: Option<String>,
}

pub struct Model {
    pub step: Step,
    pub data: WizardData,
    pub tz_query: String,
    pub install: Option<InstallOutcome>,
    pub install_error: Option<String>,
    pub install_progress: InstallProgress,
    pub installing: bool,
    pub tg_status: AsyncStatus,
}

impl Default for Model {
    fn default() -> Self {
        Self {
            step: Step::Welcome,
            data: WizardData::default(),
            tz_query: String::new(),
            install: None,
            install_error: None,
            install_progress: InstallProgress {
                stage: InstallStage::Start,
                fraction: 0.0,
                note: String::new(),
            },
            installing: false,
            tg_status: AsyncStatus::default(),
        }
    }
}

const MAIN_STEPS: &[(Step, &str)] = &[
    (Step::TgMode, "telegram"),
    (Step::LlmPicker, "ai"),
    (Step::Persona, "персона"),
    (Step::Style, "характер"),
    (Step::Notes, "детали"),
    (Step::Summary, "проверка"),
    (Step::Installing, "установка"),
];

fn current_main_index(s: Step) -> usize {
    use Step::*;
    match s {
        Welcome => 0,
        TgMode | TgBotToken | TgUserbotSource | TgUserbotApi | TgUserbotPhone | TgUserbotCode
        | TgUserbot2Fa => 0,
        LlmPicker | LlmConfig => 1,
        Persona | NameTournament => 2,
        Style => 3,
        Notes => 4,
        Summary => 5,
        Installing => 6,
        Done => 6,
    }
}

pub fn view(m: &Model) -> Element<'_, Msg> {
    let body = match m.step {
        Step::Welcome => welcome(),
        Step::TgMode => tg_mode_view(&m.data),
        Step::TgBotToken => tg_bot_token_view(&m.data),
        Step::TgUserbotSource => tg_userbot_source_view(&m.data),
        Step::TgUserbotApi => tg_userbot_api_view(&m.data),
        Step::TgUserbotPhone => tg_userbot_phone_view(&m.data, &m.tg_status),
        Step::TgUserbotCode => tg_userbot_code_view(&m.data, &m.tg_status),
        Step::TgUserbot2Fa => tg_userbot_2fa_view(&m.data, &m.tg_status),
        Step::LlmPicker => llm_picker_view(&m.data),
        Step::LlmConfig => llm_config_view(&m.data),
        Step::Persona => persona_view(m),
        Step::NameTournament => name_tournament_view(&m.data),
        Step::Style => style_view(&m.data),
        Step::Notes => notes_view(&m.data),
        Step::Summary => summary_view(&m.data),
        Step::Installing => installing_view(m),
        Step::Done => done_view(m),
    };

    let nav = nav_row(m);

    let header = if matches!(m.step, Step::Welcome | Step::Done | Step::Installing) {
        column![].into()
    } else {
        progress_header(m.step)
    };

    let main = column![
        header,
        Space::with_height(8),
        scrollable(body).height(Length::Fill).width(Length::Fill),
        Space::with_height(8),
        nav,
    ]
    .padding(Padding::from([20, 28]))
    .spacing(0);

    container(main)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(|_t| container::Style {
            background: Some(Background::Color(BONE)),
            text_color: Some(INK),
            ..Default::default()
        })
        .into()
}

fn progress_header(step: Step) -> Element<'static, Msg> {
    let idx = current_main_index(step);
    let total = MAIN_STEPS.len();
    let label = MAIN_STEPS
        .get(idx)
        .map(|(_, l)| l.to_string())
        .unwrap_or_else(|| "...".into());
    let counter = format!("шаг {} из {}", idx + 1, total);
    container(
        row![
            text(counter).size(12).color(MUTED).font(onest_medium()),
            Space::with_width(12),
            text(label).size(12).color(ACCENT).font(onest_bold()),
        ]
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding(Padding::from([4, 0]))
    .into()
}

// =====================================================================
// step views
// =====================================================================

fn welcome() -> Element<'static, Msg> {
    column![
        text("girl-agent").size(54).font(onest_bold()),
        text("живая ai-девушка для telegram. молчит когда занята, спит ночью.")
            .size(15)
            .color(MUTED)
            .font(ONEST),
        Space::with_height(20),
        text("установка займёт ~30 секунд. node, зависимости и cli уже внутри этого окна — ничего ставить отдельно не надо.")
            .size(14)
            .color(INK)
            .font(ONEST),
        Space::with_height(12),
        text("дальше визард задаст вопросы про telegram, ai-провайдера и характер девушки. весь стейт пишется в %APPDATA%\\girl-agent\\.")
            .size(13)
            .color(MUTED)
            .font(instrument_italic()),
    ]
    .spacing(8)
    .into()
}

fn tg_mode_view(d: &WizardData) -> Element<'_, Msg> {
    column![
        h2("куда подключиться"),
        sub("girl-agent умеет работать как обычный bot (через @BotFather) или как user-account (твой обычный telegram, общается как ты)."),
        Space::with_height(16),
        choice_card(
            "bot",
            "bot · @BotFather",
            "стандартный telegram bot. быстро, любой может писать.",
            d.mode == "bot",
            Msg::ModeChanged("bot".into()),
        ),
        Space::with_height(8),
        choice_card(
            "userbot",
            "userbot · через твой аккаунт",
            "общается как живая девушка с твоего telegram-аккаунта. требует логина по номеру.",
            d.mode == "userbot",
            Msg::ModeChanged("userbot".into()),
        ),
    ]
    .spacing(0)
    .into()
}

fn tg_bot_token_view(d: &WizardData) -> Element<'_, Msg> {
    column![
        h2("token из @BotFather"),
        sub("открой telegram, напиши @BotFather → /newbot → следуй шагам. в конце он пришлёт строку вида 1234567890:AAH... — её сюда."),
        Space::with_height(14),
        labelled_input_with_paste(
            "bot token",
            text_input("1234567890:AA...", &d.tg_token)
                .on_input(Msg::TgTokenChanged)
                .padding(12)
                .font(JETBRAINS)
                .size(14),
            PasteTarget::TgToken,
        ),
        Space::with_height(8),
        link_button("открыть @BotFather", "https://t.me/BotFather"),
    ]
    .spacing(0)
    .into()
}

fn tg_userbot_source_view(d: &WizardData) -> Element<'_, Msg> {
    column![
        h2("как залогиниться"),
        sub("два варианта. рекомендуем proxy — там ничего не надо запоминать."),
        Space::with_height(14),
        choice_card(
            "owner",
            "через proxy.girl-agent.com (рекомендуется)",
            "введёшь только номер телефона и код. api_id и api_hash подтянутся автоматически.",
            matches!(d.userbot_source, UserbotAuthSource::Owner),
            Msg::UserbotSourceChanged(UserbotAuthSource::Owner),
        ),
        Space::with_height(8),
        choice_card(
            "own",
            "свои api_id / api_hash",
            "если есть свой apps.telegram.org — введёшь руками.",
            matches!(d.userbot_source, UserbotAuthSource::Own),
            Msg::UserbotSourceChanged(UserbotAuthSource::Own),
        ),
    ]
    .into()
}

fn tg_userbot_api_view(d: &WizardData) -> Element<'_, Msg> {
    column![
        h2("свои api_id / api_hash"),
        sub("регистрация на my.telegram.org → API development tools."),
        Space::with_height(14),
        labelled_input_with_paste(
            "api_id",
            text_input("12345678", &d.tg_api_id)
                .on_input(Msg::TgApiIdChanged)
                .padding(12)
                .font(JETBRAINS),
            PasteTarget::TgApiId,
        ),
        Space::with_height(8),
        labelled_input_with_paste(
            "api_hash",
            text_input("abcdef0123456789...", &d.tg_api_hash)
                .on_input(Msg::TgApiHashChanged)
                .padding(12)
                .font(JETBRAINS),
            PasteTarget::TgApiHash,
        ),
        Space::with_height(8),
        link_button("открыть my.telegram.org", "https://my.telegram.org/apps"),
    ]
    .into()
}

fn tg_userbot_phone_view<'a>(d: &'a WizardData, status: &'a AsyncStatus) -> Element<'a, Msg> {
    let send_btn: Element<'_, Msg> = if status.busy {
        ghost_label("отправляем код…")
    } else {
        primary_button("отправить код", Msg::TgSendCode).into()
    };
    column![
        h2("номер телефона"),
        sub("в международном формате: +79991234567. telegram пришлёт код в приложение."),
        Space::with_height(14),
        labelled_input_with_paste(
            "phone",
            text_input("+79991234567", &d.tg_phone)
                .on_input(Msg::TgPhoneChanged)
                .padding(12)
                .font(JETBRAINS),
            PasteTarget::TgPhone,
        ),
        Space::with_height(12),
        send_btn,
        Space::with_height(8),
        async_status(status),
    ]
    .into()
}

fn tg_userbot_code_view<'a>(d: &'a WizardData, status: &'a AsyncStatus) -> Element<'a, Msg> {
    let verify_btn: Element<'_, Msg> = if status.busy {
        ghost_label("проверяем…")
    } else {
        primary_button("подтвердить", Msg::TgVerifyCode).into()
    };
    column![
        h2("код из telegram"),
        sub("приложение telegram прислало код. введи его сюда."),
        Space::with_height(14),
        labelled_input_with_paste(
            "код",
            text_input("12345", &d.tg_code)
                .on_input(Msg::TgCodeChanged)
                .padding(12)
                .font(JETBRAINS),
            PasteTarget::TgCode,
        ),
        Space::with_height(12),
        verify_btn,
        Space::with_height(8),
        async_status(status),
    ]
    .into()
}

fn tg_userbot_2fa_view<'a>(d: &'a WizardData, status: &'a AsyncStatus) -> Element<'a, Msg> {
    let verify_btn: Element<'_, Msg> = if status.busy {
        ghost_label("проверяем…")
    } else {
        primary_button("подтвердить", Msg::TgVerifyPassword).into()
    };
    column![
        h2("пароль two-step"),
        sub("на аккаунте включён cloud password. введи его."),
        Space::with_height(14),
        labelled_input_with_paste(
            "пароль",
            text_input("••••••••", &d.tg_2fa)
                .on_input(Msg::Tg2FaChanged)
                .padding(12)
                .font(JETBRAINS)
                .secure(true),
            PasteTarget::Tg2Fa,
        ),
        Space::with_height(12),
        verify_btn,
        Space::with_height(8),
        async_status(status),
    ]
    .into()
}

fn llm_picker_view(d: &WizardData) -> Element<'_, Msg> {
    let mut col = Column::new().spacing(0);
    col = col.push(h2("ai-провайдер")).push(sub(
        "что будет генерить ответы. если есть аккаунт в одном из этих сервисов — выбирай его. новичкам: openai или ClaudeHub.",
    ));
    col = col.push(Space::with_height(14));

    let mut grid = Column::new().spacing(8);
    let mut row_chunk: Vec<Element<'_, Msg>> = Vec::new();
    for (i, p) in LLM_PRESETS.iter().enumerate() {
        let card = llm_card(p, &d.llm_preset);
        row_chunk.push(card);
        if row_chunk.len() == 2 || i + 1 == LLM_PRESETS.len() {
            let mut r = iced::widget::Row::new().spacing(8);
            for c in row_chunk.drain(..) {
                r = r.push(c);
            }
            grid = grid.push(r);
        }
    }
    col.push(grid).into()
}

fn llm_card<'a>(p: &'a crate::data::LlmPreset, current: &str) -> Element<'a, Msg> {
    let active = p.id == current;
    let badge: Element<'a, Msg> = if p.recommended {
        container(text("рекомендуем").size(10).font(onest_bold()).color(BONE))
            .padding(Padding::from([2, 8]))
            .style(|_t| container::Style {
                background: Some(Background::Color(ACCENT)),
                border: Border { radius: 6.0.into(), ..Default::default() },
                ..Default::default()
            })
            .into()
    } else {
        Space::new(0, 0).into()
    };
    let label = column![
        row![
            text(p.label).size(15).font(onest_bold()).color(INK),
            Space::with_width(Length::Fill),
            badge,
        ]
        .align_y(Alignment::Center),
        text(p.hint).size(12).color(MUTED).font(ONEST),
    ]
    .spacing(2);
    let id = p.id.to_string();
    button(label)
        .on_press(Msg::LlmPresetChanged(id))
        .width(Length::Fill)
        .padding(14)
        .style(move |_t, _s| pill_style(active))
        .into()
}

fn llm_config_view(d: &WizardData) -> Element<'_, Msg> {
    let preset = find_llm_preset(&d.llm_preset);
    let mut col = Column::new().spacing(0);
    if let Some(p) = preset {
        col = col
            .push(h2(&format!("настройки {}", p.label)))
            .push(sub(p.hint));
    } else {
        col = col.push(h2("настройки"));
    }
    col = col.push(Space::with_height(14));

    if let Some(p) = preset {
        if !p.models.is_empty() {
            let model_options: Vec<String> = p.models.iter().map(|s| s.to_string()).collect();
            let selected = if d.llm_model.is_empty() {
                Some(p.default_model.to_string())
            } else {
                Some(d.llm_model.clone())
            };
            col = col.push(labelled_input(
                "модель",
                pick_list(model_options, selected, Msg::LlmModelChanged)
                    .width(Length::Fill)
                    .padding(10),
            ));
        } else if p.custom {
            col = col.push(labelled_input(
                "модель",
                text_input("например llama3.1", &d.llm_model)
                    .on_input(Msg::LlmModelChanged)
                    .padding(12)
                    .font(JETBRAINS),
            ));
        }
    }

    let needs_base = preset.map(|p| p.custom).unwrap_or(false);
    if needs_base {
        col = col.push(Space::with_height(8)).push(labelled_input_with_paste(
            "base URL",
            text_input("https://api.example.com/v1", &d.llm_base_url)
                .on_input(Msg::LlmBaseUrlChanged)
                .padding(12)
                .font(JETBRAINS),
            PasteTarget::LlmBaseUrl,
        ));
    }

    let needs_key = preset.map(|p| p.api_key_required).unwrap_or(true);
    if needs_key {
        col = col.push(Space::with_height(8)).push(labelled_input_with_paste(
            "api key",
            text_input("sk-...", &d.llm_api_key)
                .on_input(Msg::LlmKeyChanged)
                .padding(12)
                .font(JETBRAINS)
                .secure(true),
            PasteTarget::LlmKey,
        ));
    } else if let Some(p) = preset {
        col = col
            .push(Space::with_height(8))
            .push(text(format!("ключ не нужен (используется default «{}»)", p.default_api_key.unwrap_or("none")))
                .size(12)
                .color(MUTED)
                .font(ONEST));
    }

    if let Some(p) = preset {
        if let (Some(url), Some(label)) = (p.referral_url, p.referral_label) {
            col = col
                .push(Space::with_height(14))
                .push(referral_card(p.label, label, url));
        }
    }

    col.into()
}

fn referral_card(provider: &'static str, label: &'static str, url: &'static str) -> Element<'static, Msg> {
    container(
        column![
            row![
                text("у тебя ещё нет ключа?").size(12).font(onest_medium()).color(INK),
                Space::with_width(Length::Fill),
                text("реферал").size(10).font(onest_bold()).color(BONE),
            ].align_y(Alignment::Center),
            Space::with_height(4),
            text(format!(
                "нажми кнопку, зарегайся на {}, оплати любым удобным способом — и получишь бонус ($) на счёт.",
                provider
            )).size(12).color(MUTED).font(ONEST),
            Space::with_height(8),
            button(text(label).size(13).font(onest_bold()).color(BONE))
                .on_press(Msg::OpenLink(url))
                .padding(Padding::from([10, 16]))
                .style(|_t, _s| button::Style {
                    background: Some(Background::Color(ACCENT)),
                    text_color: BONE,
                    border: Border { radius: RADIUS_MD.into(), ..Default::default() },
                    ..Default::default()
                }),
        ]
        .spacing(0),
    )
    .padding(Padding::from([12, 14]))
    .style(|_t| container::Style {
        background: Some(Background::Color(BONE2)),
        border: Border { color: ACCENT, width: 1.5, radius: RADIUS_MD.into() },
        ..Default::default()
    })
    .into()
}

fn persona_view(m: &Model) -> Element<'_, Msg> {
    let d = &m.data;
    let nat_options: Vec<String> = NATIONALITIES.iter().map(|(_, lab)| lab.to_string()).collect();
    let nat_selected = NATIONALITIES
        .iter()
        .find(|(id, _)| *id == d.nationality)
        .map(|(_, lab)| lab.to_string());

    let tz_filtered = search_tz(&m.tz_query);
    let tz_labels: Vec<String> = tz_filtered
        .iter()
        .map(|tz| format!("{} · {} · {}", tz.city, tz.country, tz.gmt_winter))
        .collect();
    let tz_selected = TIMEZONES
        .iter()
        .find(|tz| tz.iana == d.tz)
        .map(|tz| format!("{} · {} · {}", tz.city, tz.country, tz.gmt_winter));

    let sleep_options: Vec<String> = SLEEP_PRESETS.iter().map(|s| s.label.to_string()).collect();
    let sleep_selected = SLEEP_PRESETS
        .iter()
        .find(|s| s.id == d.sleep_preset)
        .map(|s| s.label.to_string());

    let name_random_btn = button(text("🎲 другое имя").font(onest_medium()).size(13))
        .on_press(Msg::NameRandom)
        .padding(Padding::from([6, 14]))
        .style(|_t, _s| ghost_button_style());

    let manual = matches!(d.name_mode, NameMode::Manual);

    let mut col = Column::new().spacing(0);
    col = col
        .push(h2("персона"))
        .push(sub("основное о девушке: национальность, часовой пояс, имя, возраст, режим сна. потом всё ещё можно менять."))
        .push(Space::with_height(14))
        // 1) Nationality first
        .push(labelled_input(
            "национальность",
            pick_list(nat_options, nat_selected, |label| {
                let id = NATIONALITIES
                    .iter()
                    .find(|(_, lab)| *lab == label)
                    .map(|(id, _)| (*id).to_string())
                    .unwrap_or_else(|| "RU".into());
                Msg::NationalityChanged(id)
            })
            .width(Length::Fill)
            .padding(10),
        ))
        .push(Space::with_height(10))
        // 2) Timezone moved up so its dropdown has room below
        .push(column![
            text("часовой пояс").size(12).color(MUTED).font(onest_medium()),
            Space::with_height(4),
            text_input("поиск: москва / kyiv / +5 …", &m.tz_query)
                .on_input(Msg::TzQueryChanged)
                .padding(10)
                .font(ONEST),
            Space::with_height(6),
            pick_list(tz_labels, tz_selected, move |label: String| {
                let m_label = label.clone();
                let mut chosen = "Europe/Moscow".to_string();
                for tz in TIMEZONES.iter() {
                    let pretty = format!("{} · {} · {}", tz.city, tz.country, tz.gmt_winter);
                    if pretty == m_label {
                        chosen = tz.iana.to_string();
                        break;
                    }
                }
                Msg::TzSelected(chosen)
            })
            .placeholder("выбери из списка")
            .width(Length::Fill)
            .padding(10),
        ])
        .push(Space::with_height(10))
        // 3) Name (with random/manual chips + dice + tournament)
        .push(column![
            row![
                text("имя").size(12).color(MUTED).font(onest_medium()),
                Space::with_width(Length::Fill),
                small_choice_chip("случайное", matches!(d.name_mode, NameMode::Random), Msg::NameModeChanged(NameMode::Random)),
                Space::with_width(6),
                small_choice_chip("вручную", manual, Msg::NameModeChanged(NameMode::Manual)),
                Space::with_width(6),
                small_choice_chip("турнир", matches!(d.name_mode, NameMode::Tournament), Msg::NameModeChanged(NameMode::Tournament)),
            ]
            .align_y(Alignment::Center),
            Space::with_height(6),
            row![
                text_input("Аня", &d.name)
                    .on_input(Msg::NameChanged)
                    .padding(12)
                    .font(JETBRAINS)
                    .size(14),
                Space::with_width(8),
                name_random_btn,
            ]
            .align_y(Alignment::Center),
            Space::with_height(4),
            text(if matches!(d.name_mode, NameMode::Tournament) {
                "режим «турнир» спросит пары имён на следующем экране"
            } else {
                ""
            }).size(11).color(MUTED).font(ONEST),
        ])
        .push(Space::with_height(10))
        // 4) Age
        .push(column![
            row![
                text("возраст").size(12).color(MUTED).font(onest_medium()),
                Space::with_width(Length::Fill),
                text(format!("{}", d.age)).size(20).font(onest_bold()).color(ACCENT),
            ]
            .align_y(Alignment::Center),
            slider(14u8..=99u8, d.age, Msg::AgeChanged).step(1u8),
            row![
                text("14").size(11).color(MUTED).font(ONEST),
                Space::with_width(Length::Fill),
                text("99").size(11).color(MUTED).font(ONEST),
            ],
        ])
        .push(Space::with_height(10))
        // 5) Sleep preset
        .push(labelled_input(
            "режим сна",
            pick_list(sleep_options, sleep_selected, |label| {
                let id = SLEEP_PRESETS
                    .iter()
                    .find(|s| s.label == label)
                    .map(|s| s.id.to_string())
                    .unwrap_or_else(|| "standard".into());
                Msg::SleepPresetChanged(id)
            })
            .width(Length::Fill)
            .padding(10),
        ));

    // 5b) Sleep custom inline editor
    if d.sleep_preset == "custom" {
        let hours: Vec<String> = (0..24).map(|h| format!("{:02}:00", h)).collect();
        let from_sel = Some(format!("{:02}:00", d.sleep_custom_from));
        let to_sel = Some(format!("{:02}:00", d.sleep_custom_to));
        col = col
            .push(Space::with_height(10))
            .push(container(column![
                text("свой режим сна").size(12).color(MUTED).font(onest_medium()),
                Space::with_height(8),
                row![
                    column![
                        text("ложится в").size(11).color(MUTED).font(ONEST),
                        Space::with_height(2),
                        pick_list(hours.clone(), from_sel, Msg::SleepCustomFromChanged)
                            .width(Length::Fill).padding(8),
                    ].width(Length::FillPortion(1)),
                    Space::with_width(10),
                    column![
                        text("встаёт в").size(11).color(MUTED).font(ONEST),
                        Space::with_height(2),
                        pick_list(hours, to_sel, Msg::SleepCustomToChanged)
                            .width(Length::Fill).padding(8),
                    ].width(Length::FillPortion(1)),
                ]
                .align_y(Alignment::Start),
                Space::with_height(10),
                row![
                    text("шанс ночного пробуждения").size(11).color(MUTED).font(ONEST),
                    Space::with_width(Length::Fill),
                    text(format!("{}%", d.sleep_custom_wake_chance))
                        .size(14).font(onest_bold()).color(ACCENT),
                ].align_y(Alignment::Center),
                slider(0u8..=50u8, d.sleep_custom_wake_chance, Msg::SleepCustomChanceChanged).step(1u8),
                row![
                    text("0% спит крепко").size(10).color(MUTED).font(ONEST),
                    Space::with_width(Length::Fill),
                    text("50% полупроснувшаяся").size(10).color(MUTED).font(ONEST),
                ],
            ].spacing(0))
            .padding(12)
            .style(|_t| container::Style {
                background: Some(Background::Color(BONE2)),
                border: Border { color: LINE, width: 1.0, radius: RADIUS_MD.into() },
                ..Default::default()
            }));
    }

    col.into()
}

fn style_view(d: &WizardData) -> Element<'_, Msg> {
    let comm_options: Vec<String> = COMMUNICATION_PRESETS.iter().map(|c| c.label.to_string()).collect();
    let comm_selected = COMMUNICATION_PRESETS
        .iter()
        .find(|c| c.id == d.communication)
        .map(|c| c.label.to_string());

    let stage_options: Vec<String> = STAGE_PRESETS.iter().map(|s| s.label.to_string()).collect();
    let stage_selected = STAGE_PRESETS
        .iter()
        .find(|s| s.id == d.stage)
        .map(|s| s.label.to_string());

    let privacy_options: Vec<String> = PRIVACY_OPTIONS.iter().map(|(_, l, _)| l.to_string()).collect();
    let privacy_selected = PRIVACY_OPTIONS
        .iter()
        .find(|(id, _, _)| *id == d.privacy)
        .map(|(_, l, _)| l.to_string());

    let comm_hint = COMMUNICATION_PRESETS
        .iter()
        .find(|c| c.id == d.communication)
        .map(|c| c.description.to_string())
        .unwrap_or_default();
    let stage_hint = STAGE_PRESETS
        .iter()
        .find(|s| s.id == d.stage)
        .map(|s| s.description.to_string())
        .unwrap_or_default();
    let privacy_hint = PRIVACY_OPTIONS
        .iter()
        .find(|(id, _, _)| *id == d.privacy)
        .map(|(_, _, h)| h.to_string())
        .unwrap_or_default();

    column![
        h2("характер и контекст"),
        sub("стиль общения, в каких отношениях вы стартуете, кто может ей писать."),
        Space::with_height(14),
        labelled_input(
            "стиль общения",
            pick_list(comm_options, comm_selected, |label| {
                let id = COMMUNICATION_PRESETS
                    .iter()
                    .find(|c| c.label == label)
                    .map(|c| c.id.to_string())
                    .unwrap_or_else(|| "normal".into());
                Msg::CommunicationChanged(id)
            })
            .width(Length::Fill)
            .padding(10),
        ),
        text(comm_hint).size(12).color(MUTED).font(instrument_italic()),
        Space::with_height(10),
        labelled_input(
            "стадия отношений",
            pick_list(stage_options, stage_selected, |label| {
                let id = STAGE_PRESETS
                    .iter()
                    .find(|s| s.label == label)
                    .map(|s| s.id.to_string())
                    .unwrap_or_else(|| "tg-given-cold".into());
                Msg::StageChanged(id)
            })
            .width(Length::Fill)
            .padding(10),
        ),
        text(stage_hint).size(12).color(MUTED).font(instrument_italic()),
        Space::with_height(10),
        labelled_input(
            "кому отвечать",
            pick_list(privacy_options, privacy_selected, |label| {
                let id = PRIVACY_OPTIONS
                    .iter()
                    .find(|(_, l, _)| *l == label)
                    .map(|(id, _, _)| (*id).to_string())
                    .unwrap_or_else(|| "owner-only".into());
                Msg::PrivacyChanged(id)
            })
            .width(Length::Fill)
            .padding(10),
        ),
        text(privacy_hint).size(12).color(MUTED).font(instrument_italic()),
    ]
    .spacing(0)
    .into()
}

fn notes_view(d: &WizardData) -> Element<'_, Msg> {
    column![
        h2("заметки про персонажа"),
        sub("кратко: чем занимается, чем интересуется, как любит общаться. это попадёт в long-term.md и speech.md. можно пропустить."),
        Space::with_height(14),
        labelled_input_with_paste(
            "заметки",
            text_input("работает дизайнером, любит лоу-фай, играет в FromSoftware…", &d.persona_notes)
                .on_input(Msg::NotesChanged)
                .padding(14)
                .font(ONEST)
                .size(14),
            PasteTarget::Notes,
        ),
    ]
    .spacing(0)
    .into()
}

fn name_tournament_view(d: &WizardData) -> Element<'_, Msg> {
    use crate::config::TournamentPhase;
    let total_quals = 20u32; // mirrors TS const TOURNAMENT_ROUNDS
    let phase_label: String = match d.tournament_phase {
        TournamentPhase::Idle => "готов?".into(),
        TournamentPhase::Quals => format!("квалификация {} / {}", d.tournament_round + 1, total_quals),
        TournamentPhase::Knockout => format!("финал · осталось {}", d.tournament_pool.len()),
    };
    let qualifiers_text = if d.tournament_qualifiers.is_empty() {
        "—".to_string()
    } else {
        d.tournament_qualifiers.join(", ")
    };

    let mut col = Column::new().spacing(0);
    col = col
        .push(h2("турнир имён"))
        .push(sub("выбираешь интуитивно из пары — в конце останется одно. имя можно поменять и потом."))
        .push(Space::with_height(14))
        .push(text(phase_label).size(14).font(onest_bold()).color(ACCENT));

    if matches!(d.tournament_phase, TournamentPhase::Idle) {
        col = col
            .push(Space::with_height(12))
            .push(text("на каждом раунде показываем 2 имени — выбирай то, которое нравится больше. \"мимо\" — пропустить пару.")
                .size(13).color(MUTED).font(ONEST))
            .push(Space::with_height(16))
            .push(primary_button("начать турнир", Msg::NameTournamentStart));
    } else {
        let a = d.tournament_pair.0.clone();
        let b = d.tournament_pair.1.clone();
        col = col
            .push(Space::with_height(16))
            .push(row![
                tournament_choice(&a),
                Space::with_width(12),
                tournament_choice(&b),
            ])
            .push(Space::with_height(12))
            .push(row![
                button(text("мимо · следующая пара").size(13).font(onest_medium()).color(INK))
                    .on_press(Msg::NameTournamentSkip)
                    .padding(Padding::from([8, 16]))
                    .style(|_t, _s| ghost_button_style()),
                Space::with_width(8),
                button(text("начать заново").size(13).font(onest_medium()).color(MUTED))
                    .on_press(Msg::NameTournamentRestart)
                    .padding(Padding::from([8, 16]))
                    .style(|_t, _s| ghost_button_style()),
            ])
            .push(Space::with_height(12))
            .push(text(format!("прошли в финал: {}", qualifiers_text)).size(11).color(MUTED).font(ONEST));
    }

    col.into()
}

fn tournament_choice(name: &str) -> Element<'static, Msg> {
    let name = name.to_string();
    let display = if name.is_empty() { "—".into() } else { name.clone() };
    button(text(display).size(28).font(onest_bold()).color(INK))
        .on_press(Msg::NameTournamentPick(name))
        .padding(Padding::from([24, 12]))
        .width(Length::Fill)
        .style(|_t, _s| button::Style {
            background: Some(Background::Color(BONE2)),
            text_color: INK,
            border: Border { color: LINE, width: 1.5, radius: RADIUS_MD.into() },
            ..Default::default()
        })
        .into()
}

fn summary_view(d: &WizardData) -> Element<'_, Msg> {
    let llm_label = find_llm_preset(&d.llm_preset).map(|p| p.label).unwrap_or("?");
    let stage_label = STAGE_PRESETS
        .iter()
        .find(|s| s.id == d.stage)
        .map(|s| s.label)
        .unwrap_or("?");
    let comm_label = COMMUNICATION_PRESETS
        .iter()
        .find(|c| c.id == d.communication)
        .map(|c| c.label)
        .unwrap_or("?");
    let mode_label = if d.mode == "bot" { "bot · @BotFather" } else { "userbot · твой telegram" };

    column![
        h2("проверка"),
        sub("ничего ещё не записано. если что-то не так, вернись назад."),
        Space::with_height(14),
        kv_card("telegram", mode_label),
        kv_card("ai", &format!("{} · {}", llm_label, if d.llm_model.is_empty() { "<default>" } else { d.llm_model.as_str() })),
        kv_card("имя", &d.name),
        kv_card("возраст", &d.age.to_string()),
        kv_card("национальность", &d.nationality),
        kv_card("часовой пояс", &d.tz),
        kv_card("стиль", comm_label),
        kv_card("стадия", stage_label),
        kv_card("слаг профиля", &d.slug),
    ]
    .spacing(0)
    .into()
}

fn installing_view(m: &Model) -> Element<'_, Msg> {
    let pct = (m.install_progress.fraction.clamp(0.0, 1.0) * 100.0) as u32;
    let stage = m.install_progress.stage;
    let stages: [(InstallStage, &str); 4] = [
        (InstallStage::UnpackNode, "node.exe"),
        (InstallStage::UnpackRuntime, "cli.js + зависимости"),
        (InstallStage::WriteConfig, "профиль и персона"),
        (InstallStage::Done, "готово"),
    ];
    let mut steps_col = Column::new().spacing(8);
    for (s, label) in stages.iter() {
        let done = stage_index(*s) <= stage_index(stage) && stage_index(stage) > stage_index(*s)
            || (stage_index(*s) <= stage_index(stage) && stage == InstallStage::Done);
        let active = *s == stage && stage != InstallStage::Done;
        let dot_color = if done {
            ACCENT2
        } else if active {
            ACCENT
        } else {
            LINE
        };
        let mark = if done { "✓" } else if active { "●" } else { "○" };
        let label_color = if done || active { INK } else { MUTED };
        steps_col = steps_col.push(
            row![
                container(text(mark).size(13).font(onest_bold()).color(BONE))
                    .width(Length::Fixed(20.0))
                    .height(Length::Fixed(20.0))
                    .center_x(Length::Fixed(20.0))
                    .center_y(Length::Fixed(20.0))
                    .style(move |_t| container::Style {
                        background: Some(Background::Color(dot_color)),
                        border: Border { radius: 10.0.into(), ..Default::default() },
                        ..Default::default()
                    }),
                Space::with_width(10),
                text((*label).to_string()).size(13).font(onest_medium()).color(label_color),
            ]
            .align_y(Alignment::Center),
        );
    }

    column![
        Space::with_height(40),
        text("устанавливаем girl-agent")
            .size(28)
            .font(onest_bold())
            .color(INK),
        Space::with_height(6),
        text(&m.install_progress.note).size(14).color(MUTED).font(ONEST),
        Space::with_height(20),
        progress_bar(0.0..=1.0, m.install_progress.fraction.clamp(0.0, 1.0))
            .height(10)
            .style(|_t| iced::widget::progress_bar::Style {
                background: Background::Color(BONE2),
                bar: Background::Color(ACCENT),
                border: Border {
                    radius: 6.0.into(),
                    ..Default::default()
                },
            }),
        Space::with_height(6),
        text(format!("{}%", pct)).size(13).color(MUTED).font(JETBRAINS),
        Space::with_height(24),
        steps_col,
        Space::with_height(20),
        text("распакуем portable-node, cli и зависимости в %APPDATA%\\girl-agent\\runtime, потом сгенерируем папку с профилем и персоной.")
            .size(12)
            .color(MUTED)
            .font(instrument_italic()),
    ]
    .align_x(Alignment::Center)
    .spacing(0)
    .into()
}

fn stage_index(s: InstallStage) -> u8 {
    match s {
        InstallStage::Start => 0,
        InstallStage::UnpackNode => 1,
        InstallStage::UnpackRuntime => 2,
        InstallStage::WriteConfig => 3,
        InstallStage::Done => 4,
    }
}

fn done_view(m: &Model) -> Element<'_, Msg> {
    let runtime = m
        .install
        .as_ref()
        .map(|i| i.runtime_dir.clone())
        .unwrap_or_default();
    let cfg = m
        .install
        .as_ref()
        .map(|i| i.config_path.clone())
        .unwrap_or_default();

    if let Some(err) = &m.install_error {
        return column![
            h2("установка не дошла до конца"),
            sub(err),
            Space::with_height(14),
            primary_button("попробовать ещё раз", Msg::StartInstall),
        ]
        .into();
    }

    column![
        Space::with_height(40),
        text("готово").size(48).font(onest_bold()).color(ACCENT),
        text("girl-agent установлен на этот компьютер.").size(15).color(INK).font(ONEST),
        Space::with_height(20),
        kv_card("runtime", &runtime),
        kv_card("профиль", &cfg),
        Space::with_height(20),
        primary_button("открыть приложение", Msg::LaunchAndQuit),
        Space::with_height(8),
        ghost("закрыть инсталлер", Msg::Quit),
    ]
    .align_x(Alignment::Center)
    .spacing(0)
    .into()
}

// =====================================================================
// nav row
// =====================================================================

fn nav_row(m: &Model) -> Element<'_, Msg> {
    use Step::*;
    let next_label = match m.step {
        Welcome => "начать",
        Summary => "установить",
        _ => "дальше",
    };

    let next_msg = match m.step {
        Summary => Some(Msg::StartInstall),
        Installing => None,
        Done => None,
        _ => {
            if can_advance(m) {
                Some(Msg::Next)
            } else {
                None
            }
        }
    };

    let next_btn: Element<'_, Msg> = if matches!(m.step, Done) {
        Space::with_width(0).into()
    } else if let Some(msg) = next_msg {
        primary_button(next_label, msg).into()
    } else if matches!(m.step, Installing) {
        ghost_label("…")
    } else {
        ghost_label(next_label)
    };

    let back_btn: Element<'_, Msg> = if matches!(m.step, Welcome | Installing | Done) {
        Space::with_width(0).into()
    } else {
        ghost("назад", Msg::Back)
    };

    row![
        back_btn,
        Space::with_width(Length::Fill),
        next_btn,
    ]
    .align_y(Alignment::Center)
    .into()
}

fn can_advance(m: &Model) -> bool {
    use Step::*;
    let d = &m.data;
    match m.step {
        Welcome => true,
        TgMode => !d.mode.is_empty(),
        TgBotToken => !d.tg_token.trim().is_empty(),
        TgUserbotSource => true,
        TgUserbotApi => !d.tg_api_id.trim().is_empty() && !d.tg_api_hash.trim().is_empty(),
        TgUserbotPhone => !d.tg_phone.trim().is_empty() && !d.tg_login_token.is_empty(),
        TgUserbotCode => !d.tg_session_string.is_empty() || d.tg_needs_2fa,
        TgUserbot2Fa => !d.tg_session_string.is_empty(),
        LlmPicker => !d.llm_preset.is_empty(),
        LlmConfig => d.is_llm_valid(),
        Persona => !d.name.trim().is_empty() && !d.tz.is_empty(),
        NameTournament => !d.name.trim().is_empty(),
        Style => true,
        Notes => true,
        Summary => true,
        Installing => false,
        Done => true,
    }
}

// =====================================================================
// shared widgets
// =====================================================================

fn h2(s: impl Into<String>) -> Element<'static, Msg> {
    let s: String = s.into();
    column![
        text(s).size(28).font(onest_bold()).color(INK),
        Space::with_height(2),
    ]
    .into()
}

fn sub(s: impl Into<String>) -> Element<'static, Msg> {
    let s: String = s.into();
    text(s)
        .size(13)
        .color(MUTED)
        .font(ONEST)
        .into()
}

fn labelled_input<'a, M: 'a>(
    label: impl Into<String>,
    inner: impl Into<Element<'a, M>>,
) -> Element<'a, M> {
    let label: String = label.into();
    column![
        text(label).size(12).color(MUTED).font(onest_medium()),
        Space::with_height(4),
        inner.into(),
    ]
    .spacing(0)
    .into()
}

/// Text input + a "📋 вставить" button that explicitly reads the clipboard.
/// The button works regardless of keyboard layout (iced's built-in Ctrl+V
/// shortcut only matches the Latin "v", which fails on Cyrillic layouts).
pub fn labelled_input_with_paste<'a>(
    label: impl Into<String>,
    inner: impl Into<Element<'a, Msg>>,
    target: PasteTarget,
) -> Element<'a, Msg> {
    let label: String = label.into();
    let paste_btn = button(text("вставить").size(11).font(onest_medium()).color(MUTED))
        .on_press(Msg::PasteRequest(target))
        .padding(Padding::from([6, 12]))
        .style(|_t, _s| ghost_button_style());
    column![
        row![
            text(label).size(12).color(MUTED).font(onest_medium()),
            Space::with_width(Length::Fill),
            paste_btn,
        ]
        .align_y(Alignment::Center),
        Space::with_height(4),
        inner.into(),
    ]
    .spacing(0)
    .into()
}

fn kv_card(k: impl Into<String>, v: impl Into<String>) -> Element<'static, Msg> {
    let k: String = k.into();
    let v: String = v.into();
    container(
        row![
            text(k).size(12).color(MUTED).font(onest_medium()).width(Length::FillPortion(1)),
            text(v).size(13).color(INK).font(JETBRAINS).width(Length::FillPortion(2)),
        ]
        .spacing(8),
    )
    .padding(Padding::from([10, 14]))
    .width(Length::Fill)
    .style(|_t| container::Style {
        background: Some(Background::Color(BONE2)),
        border: Border {
            radius: RADIUS_MD.into(),
            color: LINE,
            width: 1.0,
        },
        ..Default::default()
    })
    .into()
}

fn primary_button(label: impl Into<String>, msg: Msg) -> button::Button<'static, Msg> {
    let label: String = label.into();
    button(text(label).font(onest_bold()).size(15).color(BONE))
        .on_press(msg)
        .padding(Padding::from([12, 22]))
        .style(|_t, _s| button::Style {
            background: Some(Background::Color(ACCENT)),
            text_color: BONE,
            border: Border {
                radius: RADIUS_MD.into(),
                ..Default::default()
            },
            ..Default::default()
        })
}

fn ghost(label: impl Into<String>, msg: Msg) -> Element<'static, Msg> {
    let label: String = label.into();
    button(text(label).size(14).font(onest_medium()).color(MUTED))
        .on_press(msg)
        .padding(Padding::from([10, 16]))
        .style(|_t, _s| ghost_button_style())
        .into()
}

fn ghost_label(label: impl Into<String>) -> Element<'static, Msg> {
    let label: String = label.into();
    container(text(label).size(14).font(onest_medium()).color(MUTED))
        .padding(Padding::from([10, 16]))
        .style(|_t| container::Style {
            background: Some(Background::Color(BONE2)),
            border: Border {
                radius: RADIUS_MD.into(),
                color: LINE,
                width: 1.0,
            },
            ..Default::default()
        })
        .into()
}

fn link_button(label: impl Into<String>, href: &'static str) -> Element<'static, Msg> {
    let label: String = label.into();
    button(text(label).font(onest_medium()).size(13).color(ACCENT))
        .on_press(Msg::OpenLink(href))
        .padding(Padding::from([6, 0]))
        .style(|_t, _s| ghost_button_style())
        .into()
}

fn small_choice_chip(label: impl Into<String>, active: bool, msg: Msg) -> Element<'static, Msg> {
    let label: String = label.into();
    let bg = if active { ACCENT } else { BONE2 };
    let fg = if active { BONE } else { INK };
    button(text(label).size(11).font(onest_medium()).color(fg))
        .on_press(msg)
        .padding(Padding::from([4, 10]))
        .style(move |_t, _s| button::Style {
            background: Some(Background::Color(bg)),
            text_color: fg,
            border: Border {
                radius: 8.0.into(),
                color: LINE,
                width: 1.0,
            },
            ..Default::default()
        })
        .into()
}

fn choice_card(_id: &'static str, title: impl Into<String>, body: impl Into<String>, active: bool, msg: Msg) -> Element<'static, Msg> {
    let title: String = title.into();
    let body: String = body.into();
    let inner = column![
        text(title).size(15).font(onest_bold()).color(INK),
        text(body).size(12).color(MUTED).font(ONEST),
    ]
    .spacing(2);
    button(inner)
        .on_press(msg)
        .width(Length::Fill)
        .padding(14)
        .style(move |_t, _s| pill_style(active))
        .into()
}

fn pill_style(active: bool) -> button::Style {
    button::Style {
        background: Some(Background::Color(if active { BONE } else { BONE2 })),
        text_color: INK,
        border: Border {
            radius: RADIUS_MD.into(),
            color: if active { ACCENT } else { LINE },
            width: if active { 2.0 } else { 1.0 },
        },
        ..Default::default()
    }
}

fn ghost_button_style() -> button::Style {
    button::Style {
        background: Some(Background::Color(BONE2)),
        text_color: INK,
        border: Border {
            radius: RADIUS_MD.into(),
            color: LINE,
            width: 1.0,
        },
        ..Default::default()
    }
}

fn async_status(status: &AsyncStatus) -> Element<'_, Msg> {
    if let Some(err) = &status.error {
        return text(err.clone()).size(12).color(ACCENT3).font(ONEST).into();
    }
    if let Some(note) = &status.note {
        return text(note.clone()).size(12).color(ACCENT2).font(ONEST).into();
    }
    Space::with_height(0).into()
}

#[allow(dead_code)]
type ArcStr = Arc<str>;
