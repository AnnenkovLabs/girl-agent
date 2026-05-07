//! Modal popup shown when the user asks to minimise the app.
//!
//! Two choices ("в трей" / "в таск-бар"), default = taskbar, with a "запомнить
//! выбор" toggle. Rendered as a centred card on top of a dimmed background.

use girl_agent_shared::fonts::{instrument_italic, onest_bold, onest_medium, ONEST};
use girl_agent_shared::settings::MinimizeTarget;
use girl_agent_shared::theme::{INK, MUTED};
use iced::widget::{button, checkbox, column, container, row, text, Space};
use iced::{Alignment, Background, Color, Element, Length, Padding};

use crate::app::{Message, Model};
use crate::ui::styles;

pub fn view(model: &Model) -> Element<'_, Message> {
    let dim = container(Space::new(Length::Fill, Length::Fill))
        .style(|_| iced::widget::container::Style {
            background: Some(Background::Color(Color { r: 0.0, g: 0.0, b: 0.0, a: 0.45 })),
            ..Default::default()
        })
        .width(Length::Fill)
        .height(Length::Fill);

    let card = container(card_body(model))
        .padding(Padding::from([24, 28]))
        .style(styles::card)
        .max_width(440.0);

    let centred = container(card)
        .center_x(Length::Fill)
        .center_y(Length::Fill);

    iced::widget::stack![dim, centred].into()
}

fn card_body(model: &Model) -> Element<'_, Message> {
    let title = column![
        text("свернуть окно").font(onest_bold()).size(20).color(INK),
        text("куда отправить girl-agent на время?")
            .font(instrument_italic())
            .size(15)
            .color(MUTED),
    ]
    .spacing(4);

    let buttons = row![
        button(
            column![
                text("в таск-бар").font(onest_medium()).size(15),
                text("по умолчанию").font(ONEST).size(11).color(MUTED),
            ]
            .spacing(2),
        )
        .padding(Padding::from([12, 18]))
        .style(styles::primary_button)
        .on_press(Message::MinimizeChosen(MinimizeTarget::Taskbar)),
        Space::with_width(10),
        button(
            column![
                text("в трей").font(onest_medium()).size(15),
                text("спрятать").font(ONEST).size(11).color(MUTED),
            ]
            .spacing(2),
        )
        .padding(Padding::from([12, 18]))
        .style(styles::accent_button)
        .on_press(Message::MinimizeChosen(MinimizeTarget::Tray)),
    ]
    .align_y(Alignment::Center);

    let remember = checkbox("запомнить выбор", model.minimize_remember)
        .on_toggle(Message::MinimizeRememberToggled)
        .text_size(13)
        .font(ONEST);

    let cancel = button(text("отмена").font(ONEST).size(13))
        .padding(Padding::from([8, 14]))
        .style(styles::ghost_button)
        .on_press(Message::MinimizeCancelled);

    column![
        title,
        Space::with_height(18),
        buttons,
        Space::with_height(14),
        remember,
        Space::with_height(14),
        row![Space::with_width(Length::Fill), cancel].align_y(Alignment::Center),
    ]
    .into()
}
