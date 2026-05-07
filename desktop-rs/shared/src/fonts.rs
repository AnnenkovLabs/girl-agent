//! Embedded fonts for the desktop app and the WebUI.
//!
//! TTF bytes are pulled in at compile time so a single self-contained
//! executable carries the full brand typography — no runtime install of system
//! fonts required.

use iced::Font;

pub const UNBOUNDED_REGULAR_TTF: &[u8] =
    include_bytes!("../assets/fonts/Unbounded-Regular.ttf");
pub const UNBOUNDED_BOLD_TTF: &[u8] =
    include_bytes!("../assets/fonts/Unbounded-Bold.ttf");
pub const ONEST_REGULAR_TTF: &[u8] =
    include_bytes!("../assets/fonts/Onest-Regular.ttf");
pub const ONEST_MEDIUM_TTF: &[u8] =
    include_bytes!("../assets/fonts/Onest-Medium.ttf");
pub const ONEST_BOLD_TTF: &[u8] =
    include_bytes!("../assets/fonts/Onest-Bold.ttf");
pub const JETBRAINS_MONO_TTF: &[u8] =
    include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf");
pub const INSTRUMENT_SERIF_ITALIC_TTF: &[u8] =
    include_bytes!("../assets/fonts/InstrumentSerif-Italic.ttf");

/// All TTFs in load order, used by `iced::Application::fonts()` and by the
/// HTTP server when serving `/assets/fonts/*`.
pub const ALL_FONTS: &[(&str, &[u8])] = &[
    ("Unbounded-Regular.ttf", UNBOUNDED_REGULAR_TTF),
    ("Unbounded-Bold.ttf", UNBOUNDED_BOLD_TTF),
    ("Onest-Regular.ttf", ONEST_REGULAR_TTF),
    ("Onest-Medium.ttf", ONEST_MEDIUM_TTF),
    ("Onest-Bold.ttf", ONEST_BOLD_TTF),
    ("JetBrainsMono-Regular.ttf", JETBRAINS_MONO_TTF),
    ("InstrumentSerif-Italic.ttf", INSTRUMENT_SERIF_ITALIC_TTF),
];

/// Brand display font — Unbounded.
pub const UNBOUNDED: Font = Font::with_name("Unbounded");

/// UI body font — Onest.
pub const ONEST: Font = Font::with_name("Onest");

/// Monospace font — JetBrains Mono. Used for log lines, command input,
/// technical text.
pub const JETBRAINS: Font = Font::with_name("JetBrains Mono");

/// Decorative italic. We ship a Cyrillic-aware serif italic — currently
/// PT Serif Italic, exposed under the original `INSTRUMENT_SERIF` name so
/// callers don't need to change.
pub const INSTRUMENT_SERIF: Font = Font::with_name("PT Serif");

/// Helper to create a bold Onest variant.
pub fn onest_bold() -> Font {
    let mut f = ONEST;
    f.weight = iced::font::Weight::Bold;
    f
}

/// Helper to create a medium Onest variant.
pub fn onest_medium() -> Font {
    let mut f = ONEST;
    f.weight = iced::font::Weight::Medium;
    f
}

/// Helper to create a bold Unbounded variant.
pub fn unbounded_bold() -> Font {
    let mut f = UNBOUNDED;
    f.weight = iced::font::Weight::Bold;
    f
}

/// Helper to create the italic Instrument Serif variant we ship.
pub fn instrument_italic() -> Font {
    let mut f = INSTRUMENT_SERIF;
    f.style = iced::font::Style::Italic;
    f
}
