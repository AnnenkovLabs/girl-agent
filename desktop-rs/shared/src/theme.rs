//! Brand palette + iced styles for the girl-agent desktop app.
//!
//! Colours and font roles are pinned to the project's design spec — anything
//! that visually represents the brand should reach for these constants rather
//! than hard-coding values.

use iced::{Background, Border, Color, Shadow, Theme};

/// `#ECE7DA` — main bone background.
pub const BONE: Color = Color::from_rgb(0xEC as f32 / 255.0, 0xE7 as f32 / 255.0, 0xDA as f32 / 255.0);
/// `#E3DDCD` — warmer card surface.
pub const BONE2: Color = Color::from_rgb(0xE3 as f32 / 255.0, 0xDD as f32 / 255.0, 0xCD as f32 / 255.0);
/// `#0C0A06` — primary text, terminal contrast.
pub const INK: Color = Color::from_rgb(0x0C as f32 / 255.0, 0x0A as f32 / 255.0, 0x06 as f32 / 255.0);
/// `#E8412A` — primary accent / CTA.
pub const ACCENT: Color = Color::from_rgb(0xE8 as f32 / 255.0, 0x41 as f32 / 255.0, 0x2A as f32 / 255.0);
/// `#C4DC3C` — positive / active state.
pub const ACCENT2: Color = Color::from_rgb(0xC4 as f32 / 255.0, 0xDC as f32 / 255.0, 0x3C as f32 / 255.0);
/// `#FF7351` — warm hover/press accent.
pub const ACCENT3: Color = Color::from_rgb(0xFF as f32 / 255.0, 0x73 as f32 / 255.0, 0x51 as f32 / 255.0);
/// `#6F6957` — secondary text.
pub const MUTED: Color = Color::from_rgb(0x6F as f32 / 255.0, 0x69 as f32 / 255.0, 0x57 as f32 / 255.0);
/// `#CDC6B1` — borders and dividers.
pub const LINE: Color = Color::from_rgb(0xCD as f32 / 255.0, 0xC6 as f32 / 255.0, 0xB1 as f32 / 255.0);

pub const RADIUS_SM: f32 = 6.0;
pub const RADIUS_MD: f32 = 12.0;
pub const RADIUS_LG: f32 = 18.0;

/// iced palette tuned to our colours. We register this as a custom theme so
/// every default widget gets sensible defaults without per-widget overrides.
pub fn iced_theme() -> Theme {
    Theme::custom(
        "girl-agent".to_string(),
        iced::theme::Palette {
            background: BONE,
            text: INK,
            primary: ACCENT,
            success: ACCENT2,
            danger: ACCENT,
        },
    )
}

/// Re-usable container style for accent cards.
pub fn card_bg() -> iced::widget::container::Style {
    iced::widget::container::Style {
        text_color: Some(INK),
        background: Some(Background::Color(BONE2)),
        border: Border {
            color: LINE,
            width: 1.0,
            radius: RADIUS_MD.into(),
        },
        shadow: Shadow::default(),
    }
}

/// Surface used for the dark, terminal-contrast log panel.
pub fn ink_panel() -> iced::widget::container::Style {
    iced::widget::container::Style {
        text_color: Some(BONE),
        background: Some(Background::Color(INK)),
        border: Border {
            color: INK,
            width: 1.0,
            radius: RADIUS_MD.into(),
        },
        shadow: Shadow::default(),
    }
}

/// Thin horizontal divider colour used in card layouts.
pub fn divider() -> Color {
    LINE
}
