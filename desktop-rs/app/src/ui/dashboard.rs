//! The main dashboard view — header / scores / log / command input.

use girl_agent_shared::fonts::{
    instrument_italic, onest_bold, onest_medium, unbounded_bold, JETBRAINS, ONEST,
};
use girl_agent_shared::theme::{ACCENT, ACCENT2, ACCENT3, BONE, INK, LINE, MUTED};
use iced::widget::{button, column, container, row, scrollable, stack, text, text_input, Space};
use iced::{Alignment, Color, Element, Length, Padding};

use crate::app::{Message, Model};
use crate::state::{DashboardState, LogLine};
use crate::ui::styles;

pub fn view(model: &Model) -> Element<'_, Message> {
    let body = column![
        topbar(model),
        identity_card(&model.dashboard),
        row![scores_card(&model.dashboard), log_card(&model.dashboard)]
            .spacing(18)
            .height(Length::Fill),
        prompt_card(&model.command_input),
    ]
    .spacing(18)
    .padding(Padding::from([20, 24]));

    let base: Element<'_, Message> = container(body)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(BONE)),
            ..Default::default()
        })
        .into();

    if model.profile_picker_visible {
        stack![base, super::profile_picker::view(model)].into()
    } else if model.minimize_prompt_visible {
        stack![base, super::minimize_popup::view(model)].into()
    } else {
        base
    }
}

fn topbar(model: &Model) -> Element<'_, Message> {
    let brand = row![
        text("girl-agent").font(unbounded_bold()).size(22),
        text("/ desktop").font(instrument_italic()).color(MUTED).size(16),
    ]
    .spacing(10)
    .align_y(Alignment::Center);

    let status_dot_colour = if !model.dashboard.running {
        ACCENT
    } else if model.dashboard.paused {
        ACCENT3
    } else {
        ACCENT2
    };

    let status_label = if !model.dashboard.running {
        "stopped"
    } else if model.dashboard.paused {
        "paused"
    } else {
        "running"
    };

    let status = row![
        container(Space::new(10, 10))
            .style(move |_| iced::widget::container::Style {
                background: Some(iced::Background::Color(status_dot_colour)),
                border: iced::Border {
                    color: status_dot_colour,
                    width: 0.0,
                    radius: 6.0.into(),
                },
                ..Default::default()
            }),
        text(status_label).font(JETBRAINS).size(12).color(INK),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let mut buttons = row![].spacing(8);
    if model.ctx.profiles.len() >= 2 {
        buttons = buttons.push(
            button(text("сменить профиль").font(ONEST).size(13))
                .on_press(Message::OpenProfilePicker)
                .style(styles::ghost_button),
        );
    }
    buttons = buttons
        .push(
            button(text("свернуть").font(ONEST).size(13))
                .on_press(Message::AskMinimize)
                .style(styles::ghost_button),
        )
        .push(
            button(text(if model.dashboard.paused { "▶ resume" } else { "⏸ pause" }).font(ONEST).size(13))
                .on_press(Message::TogglePause)
                .style(styles::ghost_button),
        )
        .push(
            button(text("web ui").font(ONEST).size(13))
                .on_press(Message::OpenWebUi)
                .style(styles::primary_button),
        );

    let row = row![
        brand,
        Space::with_width(Length::Fill),
        status,
        Space::with_width(20),
        buttons,
    ]
    .align_y(Alignment::Center);

    container(row)
        .width(Length::Fill)
        .padding(Padding {
            top: 4.0,
            right: 4.0,
            bottom: 16.0,
            left: 4.0,
        })
        .into()
}

fn identity_card(d: &DashboardState) -> Element<'_, Message> {
    let (name, sub) = match &d.profile {
        Some(p) => (
            p.name.clone(),
            format!("{} · {}{}", p.age, p.mode, if p.tz.is_empty() { String::new() } else { format!(" · {}", p.tz) }),
        ),
        None => (String::from("загружаем…"), String::from("если ничего не происходит — кликни «сменить профиль» в правом верхнем углу или запусти инсталлер ещё раз")),
    };

    let stage_label = d.stage.as_ref().map(|s| s.label.clone()).unwrap_or_else(|| String::from("—"));

    let inner = column![
        row![
            text(name).font(unbounded_bold()).size(28),
            Space::with_width(12),
            text(sub).font(instrument_italic()).color(MUTED).size(16),
        ]
        .align_y(Alignment::Center),
        row![
            text("stage:").color(MUTED).font(ONEST).size(13),
            Space::with_width(8),
            text(stage_label).font(onest_medium()).size(14),
        ]
        .align_y(Alignment::Center),
    ]
    .spacing(6);

    container(inner)
        .padding(Padding::from([16, 20]))
        .width(Length::Fill)
        .style(styles::card)
        .into()
}

fn scores_card(d: &DashboardState) -> Element<'_, Message> {
    let title = text("отношение").font(onest_medium()).color(MUTED).size(13);

    let entries: [(&str, i32, bool); 5] = [
        ("interest", d.score.interest, false),
        ("trust", d.score.trust, false),
        ("attraction", d.score.attraction, false),
        ("annoyance", d.score.annoyance, true),
        ("cringe", d.score.cringe, true),
    ];

    let mut col = column![title].spacing(12);
    for (key, value, negative) in entries {
        col = col.push(score_row(key, value, negative));
    }

    container(col)
        .padding(Padding::from([16, 18]))
        .width(Length::FillPortion(1))
        .style(styles::card)
        .into()
}

fn score_row<'a>(key: &'a str, value: i32, negative: bool) -> Element<'a, Message> {
    let v = value.clamp(-100, 100);
    let fill_colour = if negative || v < 0 {
        styles::score_bar_fill_negative()
    } else {
        styles::score_bar_fill_positive()
    };

    let bar_simple = simple_bar(v, fill_colour);

    row![
        container(text(key).font(JETBRAINS).size(13).color(INK))
            .width(Length::Fixed(110.0))
            .align_y(Alignment::Center),
        container(bar_simple).width(Length::Fill).align_y(Alignment::Center),
        container(text(format!("{:>4}", v)).font(JETBRAINS).size(13).color(INK))
            .width(Length::Fixed(50.0))
            .align_x(Alignment::End),
    ]
    .spacing(12)
    .align_y(Alignment::Center)
    .into()
}

fn simple_bar<'a>(value: i32, fill_colour: Color) -> Element<'a, Message> {
    let v = value.clamp(-100, 100);
    let pct = (v.unsigned_abs() as f32) / 100.0;

    // Track background.
    let neg_weight = if v < 0 { ((pct) * 1000.0) as u16 } else { 0 };
    let neg_pad_weight = if v < 0 { ((1.0 - pct) * 1000.0) as u16 } else { 500 };
    let pos_weight = if v >= 0 { (pct * 1000.0) as u16 } else { 0 };
    let pos_pad_weight = if v >= 0 { ((1.0 - pct) * 1000.0) as u16 } else { 500 };

    let neg_pad_w = neg_pad_weight.max(1);
    let neg_w = neg_weight.max(1);
    let pos_w = pos_weight.max(1);
    let pos_pad_w = pos_pad_weight.max(1);

    let neg_pad: Element<'a, Message> = Space::with_width(Length::FillPortion(neg_pad_w)).into();
    let pos_pad: Element<'a, Message> = Space::with_width(Length::FillPortion(pos_pad_w)).into();
    let neg_fill: Element<'a, Message> = container(Space::new(Length::Fill, Length::Fixed(8.0)))
        .style(move |_| iced::widget::container::Style {
            background: Some(iced::Background::Color(fill_colour)),
            border: iced::Border { radius: 4.0.into(), color: fill_colour, width: 0.0 },
            ..Default::default()
        })
        .width(Length::FillPortion(neg_w))
        .into();
    let pos_fill: Element<'a, Message> = container(Space::new(Length::Fill, Length::Fixed(8.0)))
        .style(move |_| iced::widget::container::Style {
            background: Some(iced::Background::Color(fill_colour)),
            border: iced::Border { radius: 4.0.into(), color: fill_colour, width: 0.0 },
            ..Default::default()
        })
        .width(Length::FillPortion(pos_w))
        .into();

    let inner = row![neg_pad, neg_fill, pos_fill, pos_pad]
        .height(Length::Fixed(8.0))
        .align_y(Alignment::Center);

    container(inner)
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(styles::score_bar_track())),
            border: iced::Border { radius: 4.0.into(), color: LINE, width: 0.0 },
            ..Default::default()
        })
        .height(Length::Fixed(10.0))
        .padding(Padding::from([1, 1]))
        .width(Length::Fill)
        .into()
}

fn log_card(d: &DashboardState) -> Element<'_, Message> {
    let title = row![
        text("лог").font(onest_medium()).color(MUTED).size(13),
        Space::with_width(Length::Fill),
        text(format!("{} строк", d.logs.len())).font(JETBRAINS).color(MUTED).size(11),
    ];

    let mut rows = column![].spacing(2);
    let take_from = d.logs.len().saturating_sub(120);
    for line in &d.logs[take_from..] {
        rows = rows.push(log_row(line));
    }

    let inner = column![
        title,
        Space::with_height(8),
        container(scrollable(rows).height(Length::Fill))
            .padding(Padding::from([10, 12]))
            .style(styles::ink_panel)
            .width(Length::Fill)
            .height(Length::Fill),
    ];

    container(inner)
        .padding(Padding::from([16, 18]))
        .width(Length::FillPortion(1))
        .height(Length::Fill)
        .style(styles::card)
        .into()
}

fn log_row(line: &LogLine) -> Element<'_, Message> {
    let colour = match line.kind.as_str() {
        "outgoing" => ACCENT2,
        "incoming" => BONE,
        "error" => ACCENT3,
        "ignored" => MUTED,
        _ => BONE,
    };
    row![
        text(&line.time).font(JETBRAINS).color(MUTED).size(12),
        Space::with_width(8),
        text(&line.text).font(JETBRAINS).color(colour).size(12),
    ]
    .into()
}

fn prompt_card(input: &str) -> Element<'_, Message> {
    let prefix = text(">").font(JETBRAINS).color(ACCENT).size(18);

    let cmd_input = text_input(":status, :pause, :stage convinced …", input)
        .on_input(Message::CommandInputChanged)
        .on_submit(Message::SubmitCommand)
        .padding(Padding::from([10, 12]))
        .size(14)
        .font(JETBRAINS)
        .style(styles::input_style);

    let send = button(text("отправить").font(onest_medium()).size(13))
        .on_press(Message::SubmitCommand)
        .style(styles::primary_button)
        .padding(Padding::from([10, 16]));

    let hint = row![
        text("команды начинаются с").font(ONEST).color(MUTED).size(12),
        Space::with_width(4),
        text(":").font(JETBRAINS).color(ACCENT).size(13),
        Space::with_width(4),
        text("— как в нативном CLI").font(ONEST).color(MUTED).size(12),
    ];

    let inner = column![
        row![prefix, Space::with_width(8), cmd_input, Space::with_width(8), send]
            .align_y(Alignment::Center),
        Space::with_height(6),
        hint,
    ];

    container(inner)
        .padding(Padding::from([14, 18]))
        .width(Length::Fill)
        .style(styles::card)
        .into()
}

// Ensure `onest_bold` reference is alive — kept for future heading variants.
#[allow(dead_code)]
fn _force_onest_bold() -> iced::Font {
    onest_bold()
}
