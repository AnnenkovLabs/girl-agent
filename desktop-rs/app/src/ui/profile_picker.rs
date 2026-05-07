//! Modal popup that lists installed profiles when there are 2+ persons on
//! disk, so the user can pick which one to load.

use girl_agent_shared::config::ProfileConfig;
use girl_agent_shared::fonts::{instrument_italic, onest_bold, onest_medium, ONEST};
use girl_agent_shared::theme::{ACCENT, BONE2, INK, LINE, MUTED};
use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Alignment, Background, Border, Color, Element, Length, Padding};

use crate::app::{Message, Model};
use crate::ui::styles;

pub fn view(model: &Model) -> Element<'_, Message> {
    let dim = container(Space::new(Length::Fill, Length::Fill))
        .style(|_| iced::widget::container::Style {
            background: Some(Background::Color(Color { r: 0.0, g: 0.0, b: 0.0, a: 0.55 })),
            ..Default::default()
        })
        .width(Length::Fill)
        .height(Length::Fill);

    let card = container(card_body(model))
        .padding(Padding::from([24, 28]))
        .style(styles::card)
        .max_width(520.0);

    let centred = container(card)
        .center_x(Length::Fill)
        .center_y(Length::Fill);

    iced::widget::stack![dim, centred].into()
}

fn card_body(model: &Model) -> Element<'_, Message> {
    let count = model.ctx.profiles.len();
    let title = column![
        text("выбери профиль").font(onest_bold()).size(22).color(INK),
        text(format!("найдено {} персон в %APPDATA%\\girl-agent\\data", count))
            .font(instrument_italic())
            .size(14)
            .color(MUTED),
    ]
    .spacing(4);

    let mut items = column![].spacing(8);
    for p in &model.ctx.profiles {
        items = items.push(profile_row(p));
    }

    let footer = row![
        Space::with_width(Length::Fill),
        button(text("закрыть").font(ONEST).size(13))
            .padding(Padding::from([8, 14]))
            .style(styles::ghost_button)
            .on_press(Message::CloseProfilePicker),
    ]
    .align_y(Alignment::Center);

    column![
        title,
        Space::with_height(16),
        scrollable(items).height(Length::Fixed(320.0)).width(Length::Fill),
        Space::with_height(14),
        footer,
    ]
    .into()
}

fn profile_row(p: &ProfileConfig) -> Element<'_, Message> {
    let head = row![
        text(p.name.clone()).font(onest_bold()).size(18).color(INK),
        Space::with_width(8),
        text(format!("{} лет", p.age)).font(ONEST).size(13).color(MUTED),
        Space::with_width(Length::Fill),
        text(p.mode.clone()).font(onest_medium()).size(12).color(ACCENT),
    ]
    .align_y(Alignment::Center);

    let sub_parts: Vec<String> = [&p.nationality, &p.tz, &p.stage]
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| (**s).clone())
        .collect();
    let sub = if sub_parts.is_empty() {
        String::from("—")
    } else {
        sub_parts.join(" · ")
    };

    let body = column![
        head,
        Space::with_height(2),
        text(sub).font(ONEST).size(12).color(MUTED),
        Space::with_height(2),
        text(format!("slug: {}", p.slug)).font(ONEST).size(11).color(MUTED),
    ]
    .spacing(0);

    let slug = p.slug.clone();
    button(body)
        .on_press(Message::SelectProfile(slug))
        .width(Length::Fill)
        .padding(Padding::from([12, 16]))
        .style(|_t, _s| iced::widget::button::Style {
            background: Some(Background::Color(BONE2)),
            text_color: INK,
            border: Border { color: LINE, width: 1.0, radius: 10.0.into() },
            ..Default::default()
        })
        .into()
}
