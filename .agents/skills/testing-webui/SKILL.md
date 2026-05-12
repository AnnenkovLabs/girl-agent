---
name: testing-webui
description: Test the girl-agent WebUI end-to-end locally. Use when verifying profile setup, profile selection, config, assistant, addons, logs, memory, and runtime controls.
---

# girl-agent WebUI Testing

## Devin Secrets Needed

- `CLAUDEHUB_API_KEY`: API key for ClaudeHub LLM testing. Use it as a temporary/session secret unless the user explicitly saves it.
- `TELEGRAM_BOT_TOKEN`: BotFather token for full runtime start/send testing.
- `TELEGRAM_USERBOT_PHONE`, `TELEGRAM_USERBOT_API_ID`, `TELEGRAM_USERBOT_API_HASH`, and `_2FA_TELEGRAM_USERBOT`: only needed for real userbot login testing.

Do not write real API keys, bot tokens, phone codes, or 2FA values into reports, screenshots, commits, or skill files.

## Local Setup

1. From repo root, install dependencies:
   ```bash
   npm install
   ```
2. Build and typecheck before runtime testing:
   ```bash
   npm run typecheck
   npm run build
   ```
3. Start WebUI with an isolated test data directory:
   ```bash
   GIRL_AGENT_DATA=/home/ubuntu/girl-agent-test-data GIRL_AGENT_PORT=3000 npm run start -- --no-browser
   ```
4. Open `http://127.0.0.1:3000` in Chrome.

## Useful API Smoke Checks

Run these before recording UI tests to verify the server can reach seeded profiles:

```bash
curl -sS http://127.0.0.1:3000/api/profiles | python3 -m json.tool
curl -i http://127.0.0.1:3000/api/profiles/<slug>
```

If `/api/profiles` lists profiles but `/api/profiles/<slug>` returns route-level `404 {"error":"not found","path":...}`, profile-dependent UI flows will be blocked. In that case, focus the test on proving the dynamic-route blocker and mark config, memory, logs, assistant apply, and runtime controls as blocked.

## Primary UI Flow

1. Verify an existing profile appears in the sidebar and becomes active.
2. Open Logs and confirm a status card is shown for that profile.
3. Open Configuration and run the LLM connection test using ClaudeHub/Sonnet when a valid `CLAUDEHUB_API_KEY` is available.
4. Use AI assistant to request a concrete config change, e.g. `ignoreTendency=12`, then click the tool card's apply button and refresh to verify persistence.
5. Use Setup Flow to create a new profile; verify it appears in the picker and becomes active after finish.
6. Check Addons marketplace and Diagnostics as static/no-profile pages if profile activation is blocked.

## Recording Guidance

- Maximize Chrome before recording:
  ```bash
  sudo apt-get install -y wmctrl 2>/dev/null; wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
  ```
- Add recording annotations for profile load, setup completion, each failed assertion, and any static page that still works.
- Include screenshots of visible toasts/error states and attach a markdown test report with inline images.
