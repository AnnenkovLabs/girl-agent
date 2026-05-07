# desktop-rs

Native Windows-first GUI for `girl-agent`, written in Rust. Three crates in one
workspace:

- **`shared`** — fonts, theme palette, JSON event types, paths, settings,
  `BotProcess` that spawns the Node CLI in `--json-events` mode.
- **`app`** — `girl-agent-desktop`. The dashboard (iced 0.13) with the same
  five-score layout, log feed and command bar as the CLI, plus a system tray,
  a "minimize to tray / taskbar" popup, and an embedded HTTP + WebSocket
  server on `http://127.0.0.1:7777` that mirrors the dashboard in any browser
  on the local machine.
- **`installer`** — `girl-agent-installer`. An iced wizard that runs through
  pre-flight checks (Node 20+), Telegram credentials, LLM provider and the
  persona basics, then `npm install -g @thesashadev/girl-agent` and writes
  the profile config straight into the data dir.

```powershell
cd desktop-rs
cargo run -p girl-agent-installer
cargo run -p girl-agent-desktop
```

The desktop app talks to the Node CLI through the new `--json-events` flag
(see `src/headless.ts`): NDJSON on stdout, `:command` lines on stdin. No
WebView, no Electron. Web UI assets and TTF fonts are embedded into the
binary at compile time and served from `127.0.0.1:7777` behind a one-time
token printed at startup.

## Layout

```
desktop-rs/
├── Cargo.toml                   # workspace
├── shared/                      # theme + fonts + bot IPC + types
│   ├── assets/fonts/*.ttf       # Unbounded / Onest / JetBrains Mono / Instrument Serif
│   └── src/
│       ├── fonts.rs             # include_bytes!() + iced::Font handles
│       ├── theme.rs             # palette + iced theme
│       ├── runtime_client.rs    # spawn the Node CLI, parse NDJSON
│       ├── settings.rs          # %APPDATA%/girl-agent/settings.json
│       ├── paths.rs             # XDG / Windows app-data dirs
│       ├── config.rs            # parse profile config.json
│       └── types.rs             # mirror of TS RuntimeEvent
├── app/                         # girl-agent-desktop
│   ├── src/
│   │   ├── main.rs              # iced::application + tokio bridge + tray
│   │   ├── app.rs               # Model / Message / update / view
│   │   ├── state.rs             # AppState + 500-line log buffer
│   │   ├── supervisor.rs        # start/stop the bot child
│   │   ├── tray.rs              # system tray (Windows / macOS only)
│   │   ├── ui/                  # dashboard, minimize popup, styles
│   │   └── web/                 # axum router + html / ws endpoints
│   └── static/                  # css + js + html for the web UI
└── installer/                   # girl-agent-installer
    └── src/
        ├── main.rs              # iced wizard wiring
        ├── ui.rs                # all wizard pages
        ├── data.rs              # preset / stage / mode lists
        ├── preflight.rs         # node + npm presence
        ├── install.rs           # npm install -g + write config.json
        └── config.rs            # wizard form state
```

## Theme

| Token   | Hex      | Use                                     |
| ------- | -------- | --------------------------------------- |
| BONE    | `#ECE7DA` | page background                         |
| BONE2   | `#E3DDCD` | cards / panels                          |
| INK     | `#0C0A06` | primary text, dark panels               |
| ACCENT  | `#E8412A` | CTA, status when stopped                |
| ACCENT2 | `#C4DC3C` | success / running                       |
| ACCENT3 | `#FF7351` | hover / warn                            |
| MUTED   | `#6F6957` | secondary captions                      |
| LINE    | `#CDC6B1` | borders, dividers                       |

Fonts: **Unbounded** (brand / hero), **Onest** (UI body), **JetBrains Mono**
(logs / paths / numbers), **Instrument Serif Italic** (decorative pulls).

## Future work

- MSI / NSIS bundle wrapping the two binaries
- Code signing
- Auto-update channel
- macOS / Linux smoke tests
