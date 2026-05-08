# AGENTS.md

## Project Overview

girl-agent — AI persona engine for Telegram. Simulates realistic girl behavior in chat: presence patterns, sleep, busy schedule, relationship stages, conflict system, memory, anti-AI prompting. Supports bot mode (Grammy) and userbot mode (MTProto/GramJS).

## Tech Stack

- **Runtime**: Node.js >= 20, TypeScript, ESM
- **TUI**: React + Ink (terminal UI framework)
- **Build**: tsup (single-file bundle `dist/cli.js`)
- **Telegram**: Grammy (bot mode), GramJS/`telegram` (userbot mode)
- **LLM**: OpenAI-compatible + Anthropic SDK
- **Desktop**: Rust/iced (in `desktop-rs/`)

## Project Structure

```
src/
  cli.tsx              # CLI entry point, flag parsing, subcommands
  server.ts            # Headless server mode (no TTY)
  headless.ts          # JSON-events output for desktop wrapper
  types.ts             # All shared types (ProfileConfig, StageId, BusySlot, etc.)
  storage/md.ts        # Profile storage: config.json, logs, memory, agenda
  engine/
    runtime.ts         # Main runtime — orchestrates all modules
    presence.ts        # Online/offline simulation, busy slots, sleep
    behavior-tick.ts   # Per-message decision: reply/ignore/delay/reaction
    conflict.ts        # Conflict escalation and cold periods
    daily-life.ts      # Daily schedule generation
    daily-summarizer.ts
    persona-gen.ts     # LLM-based persona/speech/boundaries generation
    prompt.ts          # System prompt assembly
    hormones.ts        # Mood/hormone simulation
    agenda.ts          # Proactive messaging scheduler
    realism.ts         # Anti-AI realism rules
    security.ts        # Input sanitization
    stickers.ts        # Sticker reactions
    media.ts           # Media handling
    reflect.ts         # Self-reflection after conversations
  telegram/
    bot.ts             # Grammy bot adapter
    userbot.ts         # GramJS userbot adapter
  wizard/index.tsx     # Ink TUI wizard for profile creation
  dashboard/index.tsx  # Ink TUI dashboard (runtime monitoring)
  presets/
    llm.ts             # LLM provider presets
    stages.ts          # Relationship stage presets (met-irl -> long-term)
    communication.ts   # Communication style presets (normal/cute/alt/clingy/chatty)
    mcp.ts             # MCP integration presets
  data/
    timezones.ts       # Timezone utilities
    names.ts           # Name pools by nationality
  llm/                 # LLM client wrappers
  mcp/                 # MCP server implementations
```

## Commands

```bash
npm install            # Install dependencies
npm run dev            # Run from source (tsx)
npm run build          # Build dist/cli.js (tsup)
npm run typecheck      # Type check (tsc --noEmit)
npm run start          # Run built dist/cli.js
```

## Data Directory

Profiles are stored in `./data/<slug>/` (or `$GIRL_AGENT_DATA/<slug>/`):
- `config.json` — profile configuration (ProfileConfig)
- `persona.md`, `speech.md`, `boundaries.md` — LLM-generated persona files
- `communication.md` — communication style description
- `relationship.md` — relationship state + score
- `long-term.md` — long-term memory
- `agenda.json` — proactive messaging schedule
- `log/<YYYY-MM-DD>.md` — daily conversation logs
- `memory/daily/<YYYY-MM-DD>.md` — daily summaries
- `memory/episodes/` — episode memories

## Coding Conventions

- Language: TypeScript strict mode, ESM (`"type": "module"`)
- Imports: use `.js` extension in import paths (ESM requirement)
- Comments and user-facing strings: Russian (Cyrillic)
- No default exports; use named exports
- Types in `src/types.ts`; presets in `src/presets/`
- No `any` unless wrapping external untyped APIs (e.g., mri argv)
- Run `npm run typecheck` before every commit

## PR Checklist

1. `npm run typecheck` passes
2. `npm run build` produces working `dist/cli.js`
3. No changes to `data/`, `dist/`, `.env`, or secrets
4. Version bump via `npm version patch|minor|major --no-git-tag-version` for releases
5. Changelog entry in `CHANGELOG.md` for releases
6. NSFW content is not accepted
7. No vector DBs or RAG — not accepted per CONTRIBUTING.md

## Key Design Decisions

- **Presence simulation**: Girls have realistic online patterns (phone-attached, burst-checker, rare-checker, evening-only, night-owl). Not always available.
- **Relationship stages**: 9 stages from "met-irl-got-tg" to "dumped", each with numeric ID (1-9). Stages affect behavior, reply speed, ignore chance.
- **Conflict system**: Escalates on spam/pressure. Cold periods = silence for hours/days.
- **Anti-AI**: System prompt strictly forbids markdown formatting, "of course", "I understand", emoji rows, questions at end of messages.
- **WSS by default**: Telegram connections use WebSocket (port 443) to bypass ISP blocks.
- **Migration system**: `src/migrations/` contains versioned data migration scripts. Run via `npx @thesashadev/girl-agent update`.

## Adding New Features

- **New LLM preset**: Add to `src/presets/llm.ts`
- **New MCP integration**: Add preset to `src/presets/mcp.ts`, implementation to `src/mcp/`
- **New stage**: Add to `STAGE_PRESETS` in `src/presets/stages.ts`, add StageId to `src/types.ts`
- **New communication preset**: Add to `COMMUNICATION_PRESETS` in `src/presets/communication.ts`
- **New engine module**: Add to `src/engine/`, wire into `runtime.ts`
- **Data migration**: Create `src/migrations/XXXX-description.ts`, register in `src/migrations/index.ts`
