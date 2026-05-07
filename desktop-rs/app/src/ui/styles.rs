//! Re-usable iced widget styles built on top of the brand palette.
//!
//! All styles intentionally take the active `iced::Theme` reference but ignore
//! it: we always paint from the shared palette rather than defaulting to the
//! standard light/dark themes.

use girl_agent_shared::theme::{
    self, ACCENT, ACCENT2, ACCENT3, BONE, BONE2, INK, LINE, MUTED, RADIUS_MD,
};
use iced::widget::{button, container, text_input};
use iced::{Background, Border, Color, Shadow, Theme};

pub fn card(_theme: &Theme) -> container::Style {
    theme::card_bg()
}

pub fn ink_panel(_theme: &Theme) -> container::Style {
    theme::ink_panel()
}

pub fn topbar(_theme: &Theme) -> container::Style {
    container::Style {
        text_color: Some(INK),
        background: Some(Background::Color(BONE)),
        border: Border {
            color: LINE,
            width: 0.0,
            radius: 0.0.into(),
        },
        shadow: Shadow::default(),
    }
}

pub fn divider_line(_theme: &Theme) -> container::Style {
    container::Style {
        text_color: Some(MUTED),
        background: Some(Background::Color(LINE)),
        border: Border::default(),
        shadow: Shadow::default(),
    }
}

pub fn primary_button(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered | button::Status::Pressed => ACCENT3,
        _ => INK,
    };
    let fg = match status {
        button::Status::Hovered | button::Status::Pressed => INK,
        _ => BONE,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: bg,
            width: 0.0,
            radius: RADIUS_MD.into(),
        },
        shadow: Shadow::default(),
    }
}

pub fn ghost_button(_theme: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered | button::Status::Pressed => (BONE2, INK),
        _ => (BONE, INK),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: LINE,
            width: 1.0,
            radius: RADIUS_MD.into(),
        },
        shadow: Shadow::default(),
    }
}

pub fn accent_button(_theme: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered | button::Status::Pressed => (ACCENT3, INK),
        _ => (ACCENT, BONE),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: bg,
            width: 0.0,
            radius: RADIUS_MD.into(),
        },
        shadow: Shadow::default(),
    }
}

pub fn success_button(_theme: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered | button::Status::Pressed => (ACCENT3, INK),
        _ => (ACCENT2, INK),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: bg,
            width: 0.0,
            radius: RADIUS_MD.into(),
        },
        shadow: Shadow::default(),
    }
}

pub fn input_style(_theme: &Theme, status: text_input::Status) -> text_input::Style {
    let border_colour = match status {
        text_input::Status::Focused { .. } => ACCENT3,
        _ => LINE,
    };
    text_input::Style {
        background: Background::Color(BONE),
        border: Border {
            color: border_colour,
            width: 1.0,
            radius: RADIUS_MD.into(),
        },
        icon: INK,
        placeholder: MUTED,
        value: INK,
        selection: ACCENT2,
    }
}

pub fn score_bar_track() -> Color {
    LINE
}

pub fn score_bar_fill_positive() -> Color {
    ACCENT2
}

pub fn score_bar_fill_negative() -> Color {
    ACCENT
}
