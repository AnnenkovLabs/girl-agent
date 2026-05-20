# Design Document — manager-mode

Технический дизайн форка `manager-agent`. Основан на `.kiro/specs/manager-mode/requirements.md` (20 требований в EARS) и текущей кодовой базе оригинального `girl-agent` (TypeScript ESM, Node.js >=20, Grammy/GramJS, OpenAI/Anthropic SDK, самописный WebUI на `node:http`).

## Overview

### Что меняется на уровне поведения

`girl-agent` — однопользовательская симуляция отношений: один профиль обслуживает одного «парня» (`ownerId`), 9 стадий отношений, 5 счётчиков, гормоны, романтические границы. `manager-agent` — многопользовательский секретарь: один профиль обслуживает одного владельца (`Boss`) и неограниченное число клиентов (`Contact`-ов), каждый со своим уровнем доверия. Главная новая поведенческая петля — `Escalation_Loop`: запрос вне мандата → холдинг-сообщение клиенту → резюме боссу с тикетом `#T-N` → ответ босса (reply / `#T-N` / `@username`) → формулировка клиенту, без утечки внутреннего контекста.

### Что меняется на уровне кода

- Удаляются: `presets/stages.ts`, `engine/hormones.ts`, романтические ветки в `runtime.ts` (`isRomanticApproach`, `maybeBlockAfterBoundary`, `switchPrimaryAfterDumped`, `dumped`-стадия), 5 communication-пресетов оригинала.
- Добавляются: `engine/mandate.ts`, `engine/escalation.ts`, `engine/boss-reply-parser.ts`, `engine/contacts.ts`, `engine/digests.ts`, `presets/contact-tiers.ts`, `presets/manager-tone.ts`, `presets/persona-style.ts`, `webui/routes/contacts.ts`, `webui/routes/inbox.ts`.
- Перерабатываются: `engine/runtime.ts` (новые ветки в `handleIncoming`, новый `handleBossMessage`), `engine/prompt.ts` (включает `mandate`, `tone`, `persona-style`, контактную карточку вместо relationship.md), `engine/agenda.ts` (двусторонняя), `engine/presence.ts` (work-hours семантика), `storage/md.ts` (per-contact JSON, atomic writes для tickets.json), `webui/server.ts` (порт 3100, новые роуты), `cli.ts` (бинарь `manager-agent`, `MANAGER_AGENT_*` env), `types.ts` (новые поля в `ProfileConfig`, новые типы), `package.json` (имя пакета, bin, description, repository).

### Что сохраняется без изменений

`engine/behavior-tick.ts` (per-message JSON-решение reply/ignore/delay/bubbles), `engine/online-tick.ts`, `engine/daily-life.ts`, `engine/memory-palace.ts` (только индексирование меняется на per-contact), `engine/typos.ts` (с пониженной плотностью через новый пресет), `engine/security.ts`, `engine/media.ts`, `llm/index.ts`, `telegram/bot.ts` и `telegram/userbot.ts` (адаптеры остаются как есть), `webui/server.ts` HTTP-каркас, `webui/runtime-bus.ts`, `migrations/index.ts` framework. Это подтверждает Requirement 13.

### Граничные принципы дизайна

1. **Конфиденциальность по построению**: сообщения боссу и клиенту формируются разными промптами и проходят через `confidentiality-guard` перед отправкой клиенту (Requirement 7, 19.3-19.4).
2. **Атомарные записи на диск** для `tickets.json` и `contacts/<id>.json` (write-temp + rename), чтобы прерывание процесса не оставляло частичные байты (Requirement 4.9, 18.5, 19.9, 19.11).
3. **Сосуществование без коллизий**: ни одно дефолтное значение форка не совпадает с дефолтом оригинала (package, bin, port 3100, env `MANAGER_AGENT_*`, data root) — Requirement 15, 19.12.
4. **Backward-compat для миграций**: профили оригинала, прошедшие миграцию `0115-manager-mode`, не теряют существующих логов и memory-palace.


## Architecture

### Модули и зависимости

```
                         ┌──────────────────┐
                         │   cli.ts         │  manager-agent CLI
                         │   server.ts      │  headless / docker
                         │   webui/server.ts│  HTTP+WS на :3100
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  webui/          │
                         │   runtime-bus.ts │  ←─ многопрофильный оркестратор
                         │   routes/*       │
                         └────────┬─────────┘
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
         ┌────────────┐  ┌────────────────┐  ┌─────────────────┐
         │  Runtime   │  │  Runtime       │  │  Runtime        │
         │  (slug A)  │  │  (slug B)      │  │  (slug ...)     │
         └──────┬─────┘  └────────────────┘  └─────────────────┘
                │
   ┌────────────┼─────────────────────────────────────┐
   ▼            ▼            ▼            ▼           ▼
┌─────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐
│ tg  │  │ behavior │  │ mandate  │  │escalation│  │ agenda │
│ bot │  │  tick    │  │ decider  │  │  loop    │  │ (двунапр)│
│ ub  │  └──────────┘  └────┬─────┘  └─────┬────┘  └────────┘
└─────┘                     │              │
                            ▼              ▼
                     ┌──────────────────────────┐
                     │ contacts (read/write JSON)│
                     │ tickets  (atomic JSON)    │
                     │ mandate  (.md, hot-reload)│
                     │ memory-palace (per chatId)│
                     └──────────────────────────┘
                            │
                            ▼
                     ┌────────────────┐
                     │ LLM client     │  OpenAI / Anthropic
                     │ (serialized)   │
                     └────────────────┘
```

### Новые модули `src/engine/`

| Файл | Назначение | Главные экспорты |
|---|---|---|
| `mandate.ts` | Загрузка `mandate.md`, hot-reload, классификация решения | `loadMandate`, `decideAction(ctx) → "answer-self"\|"escalate"\|"decline"\|"ignore"`, `mandateGuard(text) → boolean` |
| `escalation.ts` | Управление жизненным циклом тикета | `createTicket`, `transitionTicket`, `summarizeForBoss`, `composeClientReplyFromBoss`, `tickEscalationTimeouts` |
| `boss-reply-parser.ts` | Парсинг ответа босса по 3 идентификаторам | `parseBossReply(msg, tickets) → BossReplyParseResult` |
| `contacts.ts` | CRUD контактов, тиры, manualOverride | `loadContact`, `saveContact`, `upsertOnIncoming`, `decideTierTransition`, `listContacts` |
| `digests.ts` | Дайджест боссу (Requirement 9.2-9.3) | `composeDailyDigest`, `scheduleDigest` |
| `confidentiality-guard.ts` | Проверка >80-char overlap (Requirement 7.2, 19.3) | `assertNoLeak(client, summary, mandate) → throws | void` |

### Новые модули `src/presets/`

| Файл | Назначение |
|---|---|
| `contact-tiers.ts` | 6 значений `Tier` с дефолтами поведения (ignore-chance, reply-delay) — заменяет `stages.ts` |
| `manager-tone.ts` | 3 значения `Tone` (formal-вы / friendly-ты / mixed-by-tier) с промпт-фрагментами — заменяет 5 communication-пресетов |
| `persona-style.ts` | 3 значения `PersonaStyle` для согласования местоимений в system prompt |

### Новые модули `src/webui/routes/`

| Файл | Назначение |
|---|---|
| `contacts.ts` | `GET /api/contacts/:slug`, `PATCH /api/contacts/:slug/:chatId` — таблица и редактирование контактов |
| `inbox.ts` | `GET /api/inbox/:slug`, `POST /api/inbox/:slug/:ticketId/reply` — список тикетов, отправка ответа |
| `mandate.ts` | `GET/PUT /api/mandate/:slug` — чтение и редактирование `mandate.md` |

Существующие `routes/profiles.ts`, `routes/presets.ts`, `routes/system.ts`, `routes/auth.ts`, `routes/tg-auth.ts`, `routes/addons.ts`, `routes/assistant.ts` остаются с минимальными правками (новые поля в визарде).

### Модули, которые удаляются

- `src/presets/stages.ts` — целиком (Requirement 14.1)
- `src/engine/hormones.ts` — целиком (Requirement 14.4)
- из `src/engine/runtime.ts`: `isRomanticApproach`, `maybeBlockAfterBoundary`, `switchPrimaryAfterDumped`, ветка `dumped` в `handleIncoming` (Requirement 14.2-14.3)
- из `src/presets/communication.ts`: 5 пресетов (`normal`, `cute`, `alt`, `clingy`, `chatty`) и `findCommunicationPreset` (Requirement 14.5)
- из `src/types.ts`: `StageId`, `StagePreset`, `RelationshipScope`, романтические поля


## Data Models

### 3.1 ProfileConfig — изменения

`src/types.ts` теряет поля оригинала, относящиеся к стадиям/романтике/гормонам, и получает менеджерские поля.

**Удаляется**:
- `stage: StageId` — заменяется per-contact полем `tier`
- `nightWakeChance` — без сонной семантики смысла нет (вместо неё `afterHoursPolicy`)
- `vibe: "short" | "warm"` — заменяется `tone`
- `communication: CommunicationProfile` — заменяется `tone` + `personaStyle`
- `mcp` (уже `@deprecated` в оригинале) — выносится в аддоны
- `ignoreTendency` — переинтерпретируется как weight per-tier

**Добавляется**:

```ts
export type Tier =
  | "cold-stranger"
  | "introduced"
  | "regular"
  | "trusted-partner"
  | "vip"
  | "blocked";

export type Tone = "formal-вы" | "friendly-ты" | "mixed-by-tier";

export type PersonaStyle =
  | "gender-neutral-assistant"
  | "female-secretary"
  | "male-secretary";

export type GateLevel = "open" | "gated" | "whitelist";

export type AfterHoursPolicy = "silent" | "auto-reply" | "vip-only";

export type WhitelistEntry = { kind: "id"; chatId: number } | { kind: "username"; username: string };

export interface ProfileConfig {
  // Сохраняется без изменений
  slug: string;
  name: string;
  age: number;
  nationality: Nationality;
  tz: string;
  mode: ClientMode;
  llm: { /* ...как было... */ };
  telegram: { /* ...как было... */ };
  ownerId: number; // ОБЯЗАТЕЛЬНО, явный ввод в визарде (Requirement 1.6)
  createdAt: string;
  busySchedule?: BusySlot[]; // переинтерпретируется как work meetings
  sleepFrom: number; // переинтерпретируется как начало нерабочих часов
  sleepTo: number;   // переинтерпретируется как конец нерабочих часов

  // Новые поля manager-mode
  tone: Tone;                          // дефолт mixed-by-tier
  personaStyle: PersonaStyle;          // дефолт gender-neutral-assistant
  gateLevel: GateLevel;                // дефолт gated
  afterHoursPolicy: AfterHoursPolicy;  // дефолт vip-only
  proactiveClients: boolean;           // дефолт false
  proactiveBoss: boolean;              // дефолт false
  whitelist?: WhitelistEntry[];        // только для gateLevel=whitelist
  escalationTimeoutMin: number;        // дефолт 240, диапазон 5..1440
  digestPeriodHours?: number;          // дефолт 24, диапазон 1..168
  digestTime?: string;                 // дефолт "09:00", формат HH:MM
  personaNotes?: string;               // как было
  profileType: "manager";              // discriminator на будущее
}
```

`profileType: "manager"` — служебное поле-дискриминатор. Сейчас всегда `"manager"`. Если пользователь хочет работать со старым `girl-agent`, он использует оригинальный пакет, а не форк (см. Requirement 15 — coexistence).

### 3.2 Contact

```ts
// data/<slug>/contacts/<chat_id>.json
export interface ContactRecord {
  chatId: string;             // строка, чтобы покрыть и числа bot-id, и user-id userbot
  username?: string;          // 0..64 символа, нижний регистр для индексации
  tier: Tier;
  notes?: string;             // 0..2000 символов, set владельцем через WebUI
  score: ContactScore;        // 5 счётчиков (см. ниже)
  manualOverride: boolean;    // если true — auto-tier-transition отключён (Requirement 2.7)
  updatedAt: string;          // ISO-8601 с миллисекундами и Z
  createdAt: string;
  lastMessageAt?: string;     // ISO-8601, обновляется на каждое входящее
  meta?: {
    firstName?: string;
    promoMarker?: string;     // если босс пометил «реклама не отвечать»
  };
}

export interface ContactScore {
  relevance: number;   // -100..100, насколько по делу
  trust: number;       // -100..100, можно ли решать без босса
  urgency: number;     // 0..100, средняя срочность
  annoyance: number;   // 0..100, спам/хамство
  spamScore: number;   // 0..100, чисто мусор
}
```

`ContactScore` — пять менеджерских счётчиков на смену оригинальным `interest/trust/attraction/annoyance/cringe`. `attraction` и `cringe` неуместны для делового сценария. `relevance` и `urgency` — новые. `trust` и `annoyance` сохраняют семантику.

### 3.3 Ticket

```ts
// data/<slug>/tickets.json (массив всех тикетов профиля)
export type TicketState = "open" | "waiting-boss" | "answered" | "closed";

export interface TicketTransition {
  ts: string;            // ISO-8601 с миллисекундами и Z
  from: TicketState | "<initial>";
  to: TicketState;
  reason: string;        // например "hold-sent", "boss-reply", "boss-timeout", "client-confirm-timeout"
  by: "system" | "boss" | "owner-webui";
}

export interface Ticket {
  id: string;                      // формат "#T-<n>", n ∈ 1..2_147_483_647
  chatId: string;                  // клиент
  clientUsername?: string;         // нижний регистр
  summary: string;                 // ≤500 символов, отправляется боссу
  state: TicketState;
  createdAt: string;
  closedAt?: string;
  bossReplyRaw?: string;           // оригинальный текст ответа босса для аудита
  bossReplyAt?: string;
  clientReply?: string;            // что отправили клиенту (для аудита и confidentiality-guard)
  clientReplyAt?: string;
  timeoutNotified?: boolean;       // Requirement 5
  history: TicketTransition[];     // Requirement 18.7
  bossMessageId?: number;          // ID сообщения, отправленного боссу — для reply_to-привязки
  bossChatId?: number;             // chatId босса (= ownerId)
  llmDraftForBoss?: string;        // черновик ответа клиенту для Inbox_Page (Requirement 11.6)
  meta?: {
    confidentialityBlocks?: number; // счётчик инцидентов confidentiality-guard
  };
}

// Корневая структура файла tickets.json
export interface TicketsFile {
  version: 1;
  nextId: number;            // монотонно растущий счётчик для #T-<n>
  tickets: Ticket[];
}
```

### 3.4 Mandate

`data/<slug>/mandate.md` — markdown в свободной форме, hot-reload (Requirement 3.1-3.2). Структура рекомендуется, но не enforced:

```markdown
# Mandate

## Решаю сама
- стандартные вопросы о ценах до 50_000
- расписание встреч на следующие 7 дней
- отказ спаму и реклама

## Эскалирую
- скидки выше 10%
- новые проекты
- любые юридические вопросы
- любые упоминания NDA

## Никогда не отвечаю
- запросы на личный контакт владельца напрямую
- любые предложения работы / сотрудничества с конкурентами
```

LLM при принятии решения получает полный текст `mandate.md` в system prompt (но **не** в сообщения клиенту — confidentiality-guard, Requirement 3.6, 3.9). Это компромисс между гибкостью (владелец пишет правила свободно) и контролем (LLM решает по тексту, а не по жёсткому регексу).

### 3.5 Whitelist

При `gateLevel=whitelist` хранится в `ProfileConfig.whitelist` как массив дискриминированных объединений. WebUI редактирует через `/api/profiles/:slug` PATCH. Запись формата:

```json
[{"kind":"id","chatId":123456789}, {"kind":"username","username":"vitya_helper"}]
```

`username` хранится в нижнем регистре, сравнение регистронезависимо (Requirement 17.6).


### Файловая раскладка

### 4.1 Корень данных

| Платформа | Путь по умолчанию | Override |
|---|---|---|
| Linux | `~/.local/share/manager-agent/data` | `MANAGER_AGENT_DATA` |
| macOS | `~/Library/Application Support/manager-agent/data` | `MANAGER_AGENT_DATA` |
| Windows | `%APPDATA%\manager-agent\data` | `MANAGER_AGENT_DATA` |

`storage/md.ts:defaultDataRoot()` обновляется: префикс `manager-agent` вместо `girl-agent`, env `MANAGER_AGENT_DATA` вместо `GIRL_AGENT_DATA`. Логика fallback на `./data` для рабочих папок остаётся (Requirement 15.7-15.10).

### 4.2 Раскладка профиля

```
data/<slug>/
├── config.json              # ProfileConfig
├── mandate.md               # текстовая политика (новое)
├── tickets.json             # все тикеты профиля (новое)
├── contacts/
│   ├── <chat_id_1>.json     # ContactRecord (новое, заменяет relationship.md)
│   └── <chat_id_2>.json
├── memory/
│   ├── palace/              # как было, но индексируется по chatId
│   ├── daily/<YYYY-MM-DD>.md
│   ├── conflicts.md         # переинтерпретируется как inci­denty (или удаляется)
│   └── long-term.md         # сохраняется только для миграции
├── log/
│   └── <YYYY-MM-DD>.md      # как было, но в строки добавляется chatId
├── digests/
│   └── <YYYY-MM-DD>.md      # сводки боссу (новое)
├── relationship.md          # удаляется при миграции 0115
├── conflict.json            # удаляется при миграции 0115
├── agenda.json              # сохраняется, но items получают новое поле direction:"client"|"boss"
├── persona.md               # сохраняется, генерируется под personaStyle
├── speech.md                # сохраняется
├── boundaries.md            # удаляется при миграции 0115 (заменяется mandate.md)
└── stickers/library.md      # сохраняется
```

### 4.3 Конкуретный доступ к файлам

`tickets.json` и `contacts/<chat_id>.json` могут писаться из нескольких мест: `Runtime` обрабатывает входящее сообщение, в это же время `webui/routes/inbox.ts` принимает PATCH от WebUI. Решение:

- **Атомарная запись** через write-temp + `fs.rename`: пишем в `tickets.json.tmp`, потом `rename` на `tickets.json`. POSIX/Windows гарантия atomic rename внутри той же FS. Это покрывает Requirement 4.9, 18.5.
- **Last-write-wins** с in-memory мьютексом на профиль. `Runtime` держит экземпляр `Mutex` и оборачивает все операции `read → mutate → write` для tickets и contacts. WebUI-routes используют тот же мьютекс через `runtime-bus.ts`, получая ссылку на `Runtime`.
- **Версионирование**: в каждом `Ticket` поле `history` пополняется при любом переходе. Конфликтные одновременные правки одного тикета (теоретически невозможные при мьютексе, но защищаемся в depth) детектируются по сравнению `history.length` в `read()` и `write()` — несовпадение = конфликт, операция отбрасывается с логом.

### 4.4 Что должно попадать в `.gitignore`

`data/`, `dist/`, `node_modules/` — уже в `.gitignore` оригинала, ничего менять не надо. Дополнительно проверяем при ребренде, что новые env-переменные `MANAGER_AGENT_*` нигде не попадают в коммитимые шаблоны.


## Components and Interfaces

### Поток входящего сообщения

### 5.1 Главный диспетчер `Runtime.handleIncoming(m)`

После рефакторинга метод становится диспетчером трёх потоков: сообщение от босса, сообщение от уже известного контакта, сообщение от нового контакта.

```
handleIncoming(m: IncomingMessage)
│
├── if m.deletion → handleDeletedMessage(m)        // оставляем как есть
├── if m.emojiReaction → handleEmojiReaction(m)    // оставляем как есть
├── if m.fromId === cfg.ownerId → handleBossMessage(m)  // НОВОЕ
└── else → handleClientMessage(m)                       // переименование оригинального flow
```

### 5.2 `handleBossMessage(m)` — НОВЫЙ

Босс пишет в чат с `Manager_Agent` (в bot-mode — DM в бот; в userbot-mode — DM в её userbot-аккаунт). Этот метод парсит сообщение через `boss-reply-parser`, привязывает к тикету, переводит тикет в `answered`.

```
handleBossMessage(m):
  1. parseResult = boss-reply-parser.parseBossReply(m, openTickets)
  2. switch (parseResult.kind):
     case "matched":
        ticket = parseResult.ticket
        text = parseResult.clientReplyText
        confidentiality-guard.assertNoLeak(text, ticket.summary, mandate)
        composeAndSendToClient(ticket, text)   // см. 5.4
        ticket.state = "answered"
        ticket.bossReplyAt = now()
        ticket.bossReplyRaw = m.text
        ticket.history += {from:"waiting-boss", to:"answered", reason:"boss-reply", by:"boss"}
        atomic-save tickets.json
     case "conflict":
        send-to-boss "Конфликт идентификации: #T-X, #T-Y, ... — какой имеется в виду?"
     case "ambiguous-username":
        send-to-boss "У @<username> несколько открытых тикетов: #T-X, #T-Y. Используй #T-N или reply."
     case "no-username-meta":
        send-to-boss "У #T-N нет username клиента — отвечай через reply или #T-N."
     case "ticket-not-found":
        send-to-boss "Тикет #T-N не найден или уже закрыт."
     case "no-identification":
        send-to-boss "Не понял к какому тикету это. Используй reply, #T-N или @username."
     case "empty-reply":
        send-to-boss "В ответе пусто после префикса. Сформулируй текст для клиента."
```

Все error-ветки парсера превращаются в самообъяснительные сообщения боссу (Requirement 6.6, 6.8, 6.11, 6.12). Боссу всегда пишем тем же транспортом, что он использовал — bot.api.sendMessage / userbot.sendMessage, не открывая нового чата.

### 5.3 `handleClientMessage(m)` — ПЕРЕИМЕНОВАНИЕ + РЕФАКТОРИНГ

Этот метод покрывает основной поток входящего от клиента. Замещает текущий код после строки `if (!isPrimary && !this.strangersAllowed())` в оригинальном `handleIncoming`.

```
handleClientMessage(m):
  1. contact = contacts.upsertOnIncoming(m)   // создаёт ContactRecord если нет
  2. if contact.tier === "blocked" → emit "ignored" reason "blocked", return  // R2.5
  3. gateLevel checks (см. раздел 8): may emit "ignored" и return
  4. afterHoursPolicy checks (см. раздел 8): may switch to auto-reply branch
  5. tick = behaviorTick(...)                  // как в оригинале
  6. apply mood delta to contact.score          // обновляем 5 счётчиков
  7. checkContactTierTransition(contact)        // см. раздел 8
  8. decision = mandate.decideAction(ctx)       // НОВОЕ — см. 5.4
  9. switch (decision):
     case "answer-self":
        scheduleReply(...) → composeAndSendToClient(...)   // как в оригинале, но без ticket
     case "escalate":
        escalation.openTicket(contact, m)                  // см. 5.5
     case "decline":
        composeAndSendDecline(contact)                     // короткий вежливый отказ
     case "ignore":
        emit "ignored" reason "mandate-ignore"; return
```

Романтические ветки (`isRomanticApproach`, `maybeBlockAfterBoundary`), `dumped`-стадия и `switchPrimaryAfterDumped` удаляются полностью.

### 5.4 Решатель `mandate.decideAction(ctx)`

LLM-вызов с structured JSON-ответом. Промпт включает:
- содержимое `mandate.md`
- текущее входящее сообщение
- метаданные контакта: `tier`, `notes`, последние 8 turn'ов истории
- `tone` и `personaStyle` для стиля
- состояние `WorkSchedule` (рабочие часы или нет)
- `gateLevel` (для подсказки про cold-stranger)

Возвращает:
```json
{
  "decision": "answer-self" | "escalate" | "decline" | "ignore",
  "reason": "короткое объяснение почему именно это решение",
  "confidence": 0.0..1.0,
  "tone_hint": "опционально, переопределяет глобальный tone для этого ответа"
}
```

Кеш: для подряд идущих сообщений от одного контакта в течение 60 секунд сохраняем последнее решение, не вызывая LLM повторно (опционально, перенос на этап реализации). Если `mandate.md` пуст — LLM не вызывается, дефолт = `escalate` для всех сообщений длиннее 50 символов и `answer-self` для приветствий короче (Requirement 3.10).

### 5.5 `composeAndSendToClient(ticket | contact, text?)`

Выполняет финальную сборку ответа клиенту. Два режима:

**Режим A — ответ с тикета (после `Boss_Reply`)**:
- `text` приходит из `parseBossReply()` (фактически — что владелец написал)
- LLM получает system prompt с `tone`, `personaStyle`, persona/speech, и инструкцию: «преобразуй внутренний ответ владельца в ответ клиенту, не меняя сути, не раскрывая внутреннего контекста»
- результат проходит `confidentiality-guard.assertNoLeak(result, ticket.summary, mandate)` (Requirement 7.2-7.3)
- если guard сработал → re-escalate тикет с пометкой `confidentiality-block`, не отправляем
- иначе делим на пузыри и отправляем через существующий `sendBubbles`

**Режим B — ответ без тикета (`answer-self` или `decline`)**:
- LLM получает system prompt с теми же `tone`/`personaStyle`/persona, плюс `mandate.md` (для `answer-self` — чтобы знать что разрешено)
- `confidentiality-guard.assertNoLeak(result, "", mandate)` — проверяем только утечку мандата (резюме боссу нет)
- если guard сработал → не отправляем, эскалируем как `escalate` (защита от случайного раскрытия)
- иначе отправляем

Обе ветки используют тот же существующий механизм пузырей, typing-индикатора и опечаток (через `typos.injectTypos` с пресетом пониженной плотности — Requirement 13.5).


### Цикл эскалации (Escalation_Loop)

### 6.1 Состояния и переходы

```
                    open
                     │
                     │  [hold-message-sent]
                     ▼
                waiting-boss ──────────────────────┐
                  │      │                         │
                  │      │ [boss-timeout 24h]      │ [confidentiality-block]
                  │      │                         │
                  │      ▼                         │
                  │   closed                       │
                  │ (reason: boss-timeout)          │
                  │                                │
   [boss-reply]   │                                ▼
                  ▼                            re-open as new ticket
                answered ─── [client-confirm-timeout 600s] ─── closed
                                                                ▲
                                       [owner cancel via webui] │
   open ──────────────────────────────────────────────────────┘
```

Допустимые переходы (соответствуют Requirement 18.3):
- `open → waiting-boss` (после отправки hold-сообщения и резюме боссу)
- `waiting-boss → answered` (после успешного `Boss_Reply` и отправки клиенту)
- `answered → closed` (по подтверждению клиента или таймауту 600с)
- `waiting-boss → closed` (отмена через WebUI или таймаут босса 24ч)
- `open → closed` (отмена до отправки боссу — редкий кейс из WebUI)

Любая попытка перехода вне этого списка отклоняется в `escalation.transitionTicket()`, состояние сохраняется, ошибка логируется (Requirement 18.4).

### 6.2 `escalation.openTicket(contact, m)` — детальный flow

```ts
async function openTicket(contact, incomingMessage):
  // Шаг 1: создаём тикет в состоянии "open"
  ticketsFile = await readTickets()  // { version, nextId, tickets[] }
  ticket = {
    id: `#T-${ticketsFile.nextId}`,
    chatId: contact.chatId,
    clientUsername: contact.username,
    summary: "<placeholder>",       // заполним после summarizeForBoss
    state: "open",
    createdAt: nowIso(),
    history: [{ts: nowIso(), from: "<initial>", to: "open", reason: "decision-escalate", by: "system"}]
  }
  ticketsFile.nextId += 1
  ticketsFile.tickets.push(ticket)
  await atomicWriteTickets(ticketsFile)

  // Шаг 2: отправляем клиенту hold-message
  holdText = pickHoldMessage(contact.tier, tone)   // ≤80 символов из пресета
  delaySec = behaviorTick.suggestDelaySec(contact, "hold")
  await scheduleAndSend(contact.chatId, holdText, delaySec)

  // Шаг 3: генерируем резюме боссу через LLM
  summary = await summarizeForBoss(incomingMessage, contact, mandate, llm, timeout=30s)
  if (summary === null) {
     summary = "не удалось сгенерировать резюме, см. лог тикета"  // R4.5
  }

  // Шаг 4: переход в waiting-boss
  ticket.summary = summary.slice(0, 500)   // hard cap
  ticket.state = "waiting-boss"
  ticket.history.push({from: "open", to: "waiting-boss", reason: "hold-sent", by: "system", ts: nowIso()})

  // Шаг 5: формируем сообщение боссу
  bossText = formatBossNotification(ticket, contact)
  // Пример формата (плейн-текст, без markdown):
  //   {clientLabel} спрашивает: {summary}
  //   {ticketIdLine}
  // где clientLabel = "@vitya_helper" если есть, иначе "клиент"
  //     ticketIdLine = "[#T-42]" — обязательно в конце для парсера

  // Шаг 6: отправляем боссу
  bossMessageId = await tg.sendText(cfg.ownerId, bossText)
  ticket.bossMessageId = bossMessageId
  ticket.bossChatId = cfg.ownerId
  await atomicWriteTickets(ticketsFile)

  // Шаг 7: запускаем таймеры
  scheduleEscalationTimeoutCheck(ticket.id)  // через cfg.escalationTimeoutMin минут (раздел 6.4)
  scheduleBossTimeoutCheck(ticket.id)        // через 24 часа (Requirement 4.11)
```

### 6.3 Формат резюме для босса

LLM-вызов `summarizeForBoss()` получает:
- system prompt: «ты помощник менеджера, готовишь краткие сводки для босса. До 500 символов. От третьего лица. Не дословно цитируй клиента, перефразируй суть. Если есть конкретная цифра/срок/имя — сохрани её. Без эмодзи и markdown.»
- user message: текст клиента + 3 предыдущие пары из этого диалога (если были)
- temperature: 0.3 (низкая, чтобы стабильнее)
- max_tokens: 250

Итоговое сообщение боссу собирается в `formatBossNotification(ticket, contact)`:

```
@vitya_helper спрашивает: интересуется скидкой 20% на тариф enterprise. Срок принятия решения — пятница, его клиент уже одобрил бюджет. Контекст: писал нам полгода назад про базовый тариф.

[#T-42]
```

Тег `[#T-N]` всегда последняя строка — для устойчивого парсинга в `boss-reply-parser` через regex anchored в конце. `@username` или `chatId` всегда в начале — для опции `@username`-парсинга через начало.

### 6.4 Таймеры

`Runtime` поддерживает один общий тикер раз в 60 секунд `tickEscalationTimeouts()`, который проходит по всем `state ∈ {waiting-boss, answered}` тикетам и проверяет:

```
for each ticket in waiting-boss:
  if (now - ticket.createdAt) >= escalationTimeoutMin minutes && !ticket.timeoutNotified:
     send to client: "ваш менеджер сейчас занят, отвечу позже" (длина 20-200, без эмодзи и md)
     ticket.timeoutNotified = true; save
  if (now - ticket.createdAt) >= 24 hours:
     ticket.state = "closed"
     ticket.closedAt = nowIso()
     ticket.history.push({from:"waiting-boss", to:"closed", reason:"boss-timeout", by:"system"})
     save
     // клиенту уже ушло timeoutNotified, второго сообщения не шлём (R5.3)

for each ticket in answered:
  if (now - ticket.bossReplyAt) >= 600 seconds:
     ticket.state = "closed"
     ticket.closedAt = nowIso()
     ticket.history.push({from:"answered", to:"closed", reason:"client-confirm-timeout", by:"system"})
     save
```

Этот тикер встраивается в существующий `agendaTimer` (раз в 60 секунд) или становится отдельным `escalationTimer`. Решение на этапе реализации — отдельный таймер чище в плане SRP, но добавляет один interval. Я склоняюсь к отдельному `escalationTimer`.


### Парсер ответа босса (`boss-reply-parser`)

### 7.1 Сигнатура

```ts
export type BossReplyParseResult =
  | { kind: "matched"; ticket: Ticket; clientReplyText: string; method: "reply_to" | "ticket-id" | "username" }
  | { kind: "conflict"; candidates: Ticket[] }              // несколько способов идентификации указали на разные тикеты
  | { kind: "ambiguous-username"; username: string; candidates: Ticket[] }  // @username, но открытых тикетов с этим username > 1
  | { kind: "no-username-meta"; ticket: Ticket }            // указали @username, но у клиента нет username
  | { kind: "ticket-not-found"; ticketId: string }          // #T-N не существует или закрыт
  | { kind: "empty-reply"; ticket: Ticket }                 // после префикса пусто
  | { kind: "no-identification" };                          // ни reply_to, ни #T-N, ни @username

export function parseBossReply(
  m: IncomingMessage,            // от босса
  openTickets: Ticket[],
  managerSentMessages: Map<number, string>  // bot_message_id → ticket_id (для reply_to)
): BossReplyParseResult;
```

### 7.2 Алгоритм

```
parseBossReply(m, openTickets, sentMap):
  text = m.text.trim()
  candidatesByMethod = {}  // {reply_to?, ticketId?, username?} → ticket

  // Метод 1: reply_to
  if m.replyToMessageId && sentMap.has(m.replyToMessageId):
     ticketId = sentMap.get(m.replyToMessageId)
     ticket = openTickets.find(t => t.id === ticketId)
     if ticket: candidatesByMethod.reply_to = ticket

  // Метод 2: префикс #T-N с whitespace после
  match = text.match(/^#T-(\d{1,10})(?=\s)/)   // регистрозависимо для "#T-"
  if match:
     n = parseInt(match[1], 10)
     if 1 <= n <= 2_147_483_647:
        ticketId = `#T-${n}`
        ticket = openTickets.find(t => t.id === ticketId)
        if !ticket:
           return {kind: "ticket-not-found", ticketId}
        candidatesByMethod.ticketId = ticket
        textAfterPrefix = text.substring(match[0].length).trimStart()

  // Метод 3: префикс @username с whitespace после
  umatch = text.match(/^@([a-zA-Z0-9_]{3,32})(?=\s)/)
  if umatch:
     username = umatch[1].toLowerCase()
     matches = openTickets.filter(t => (t.clientUsername || "").toLowerCase() === username)
     if matches.length === 0:
        return {kind: "no-username-meta", ticket: <stub or last-known>}
     if matches.length > 1:
        return {kind: "ambiguous-username", username, candidates: matches}
     candidatesByMethod.username = matches[0]
     textAfterUsername = text.substring(umatch[0].length).trimStart()

  // Шаг агрегации
  uniqueTickets = unique(values(candidatesByMethod))
  if uniqueTickets.length === 0:
     return {kind: "no-identification"}
  if uniqueTickets.length > 1:
     return {kind: "conflict", candidates: uniqueTickets}

  // Один уникальный тикет — выбираем clientReplyText
  ticket = uniqueTickets[0]
  if candidatesByMethod.reply_to && !candidatesByMethod.ticketId && !candidatesByMethod.username:
     clientReplyText = text   // полный текст
     method = "reply_to"
  elif candidatesByMethod.ticketId:
     clientReplyText = textAfterPrefix
     method = "ticket-id"
  else:
     clientReplyText = textAfterUsername
     method = "username"

  if clientReplyText.trim() === "":
     return {kind: "empty-reply", ticket}

  return {kind: "matched", ticket, clientReplyText, method}
```

### 7.3 Закрытые тикеты

Закрытый или несуществующий `#T-N` — `ticket-not-found`. Босс получает сообщение «Тикет #T-42 не найден или уже закрыт. Открытые: #T-43, #T-44.» (Requirement 6.9). Если босс ответил `reply_to` на сообщение об уже закрытом тикете, возвращаем тот же `ticket-not-found` с reason "ticket already closed".

### 7.4 Регистр

- `#T-` сравнивается **регистрозависимо** (строго заглавное `T`)
- `@username` сравнивается **регистронезависимо** (Requirement 6.4 финальный пункт)

### 7.5 Ограничение скорости

Если босс случайно нажал `reply` несколько раз и прислал две идентичные строки в течение 2 секунд — обработать как один ответ (используем существующий debounce-механизм `incomingSeq`). Это защищает от двойного перевода тикета `waiting-boss → answered`.


### After-hours, gateLevel и переходы тиров

### 8.1 Расчёт «вне рабочих часов»

`engine/presence.ts` уже умеет вычислять `BusySlot`-овершлапы и `sleepFrom..sleepTo`. Добавляется хелпер:

```ts
// engine/work-hours.ts (новый файл, тонкая обёртка над presence)
export function isOutOfHours(cfg: ProfileConfig, now = new Date()): boolean {
  // объединение всех текущих busySchedule-слотов плюс окна [sleepFrom, sleepTo)
  // с учётом cfg.tz
}
```

Используется в `mandate.decideAction`, `escalation.openTicket` (для решения отправлять auto-reply вместо холдинг-сообщения) и в `digests.scheduleDigest` (для дайджестов в 09:00 локали).

### 8.2 AfterHoursPolicy: ветвление

В `handleClientMessage` после `gateLevel` checks:

```
if isOutOfHours(cfg, now):
  switch (cfg.afterHoursPolicy):
    case "silent":
       emit "ignored" reason "after-hours-silent"
       return  // не отвечаем (R8.4)
    case "auto-reply":
       if not alreadyAutoRepliedInThisOffWindow(contact):
          send autoReplyText (длина 20-200, без эмодзи и md)
          mark contact as auto-replied for current off-window
       return  // тикет не открываем (R8.5)
    case "vip-only":
       if contact.tier in {"trusted-partner", "vip"}:
          // обычная обработка через mandate.decideAction
          fallthrough
       elif contact.tier missing or "blocked":
          // R8.8: tier не определён — auto-reply
          apply auto-reply branch
          return
       else:
          apply auto-reply branch
          return
```

Хранение «авто-уже-ответил в этом окне» — поле `lastAutoReplyAt` в `ContactRecord`. Окно сбрасывается, когда наступает следующий период «вне рабочих часов» (то есть после промежутка работы). Это покрывает Requirement 8.6.

### 8.3 GateLevel: ветвление

В `handleClientMessage` до `mandate.decideAction`:

```
switch (cfg.gateLevel):
  case "open":
     fallthrough  // принимаем всех

  case "gated":
     if contact.tier === "cold-stranger" && !contact.manualOverride:
        countTodayCold = how many replies sent to this contact in last 24h
        if countTodayCold >= 3:
           // лимит — переключаем decision на forced-escalate
           // создаём тикет с reason: "gated-cold-stranger-limit"
           escalation.openTicket(contact, m, reason="gated-limit")
           return
     fallthrough

  case "whitelist":
     if !whitelistAllows(contact):
        emit "ignored" reason "whitelist"
        return  // R17.6 — без ответа, без тикета
     fallthrough
```

`whitelistAllows(contact)`:
- если `cfg.whitelist` содержит `{kind:"id", chatId: contact.chatId}` → разрешено
- если `cfg.whitelist` содержит `{kind:"username", username: contact.username.toLowerCase()}` → разрешено
- иначе → запрещено

### 8.4 Auto tier transitions

`engine/contacts.ts:decideTierTransition(contact, recentInteractions)` запускается раз в 5 сообщений от контакта (как `shouldRunStageTransitionCheck` в оригинале):

```
if contact.manualOverride: return null   // R2.7

let next = null
let direction = null

// Понижение
if contact.score.annoyance >= 60 && contact.score.relevance <= -10 && contact.score.spamScore >= 50:
   next = downgrade(contact.tier, 1)   // двинуть на 1 тир вниз, не ниже cold-stranger
   direction = "down"

// Повышение
elif contact.score.relevance >= 50 && contact.score.trust >= 30:
   conditions = perTierUpgradeRules(contact.tier)
   if conditions met:
      next = upgrade(contact.tier, 1)
      direction = "up"

if next === "blocked":
   // blocked устанавливается ТОЛЬКО вручную или через spam-detection rules
   return null   // R2.6, R19.7

if next === null: return null
return {next, direction, reason}
```

Дефолтные пороги по тирам — в `presets/contact-tiers.ts`:

```ts
export const TIER_PRESETS: TierPreset[] = [
  { id: "cold-stranger",   ignoreChance: 0.40, replyDelaySec: [60, 600] },
  { id: "introduced",      ignoreChance: 0.18, replyDelaySec: [30, 300] },
  { id: "regular",         ignoreChance: 0.10, replyDelaySec: [15, 180] },
  { id: "trusted-partner", ignoreChance: 0.05, replyDelaySec: [10, 90]  },
  { id: "vip",             ignoreChance: 0.02, replyDelaySec: [5, 60]   },
  { id: "blocked",         ignoreChance: 1.00, replyDelaySec: [99999, 99999] }
];
```

Эти пороги передаются в `behavior-tick` через тот же `BehaviorContext`, что в оригинале использовал `StagePreset.defaults`.

### 8.5 Принудительный blocked через ручной override

WebUI `Contacts_Page` PATCH `tier=blocked` устанавливает `manualOverride=true` и `tier=blocked` (Requirement 10.3). Дальше `handleClientMessage` в первой же ветке отбрасывает все входящие (R2.5).

Снятие `blocked` — только через ручное изменение `tier` на любой другой через WebUI, что также сбрасывает `manualOverride` в `false` (если только владелец не оставил его `true` намеренно через advanced-toggle).


### WebUI: новые роуты и страницы

### 9.1 Новые HTTP-эндпоинты

```
GET    /api/contacts/:slug                         → ContactRecord[]
PATCH  /api/contacts/:slug/:chatId                 → ContactRecord (применяет изменения tier/notes)
GET    /api/inbox/:slug                            → Ticket[] (с фильтрами state, sort)
GET    /api/inbox/:slug/:ticketId                  → Ticket (один)
POST   /api/inbox/:slug/:ticketId/reply            → отправляет ответ через тот же Boss_Reply_Parser flow
POST   /api/inbox/:slug/:ticketId/cancel           → переход в closed (open → closed или waiting-boss → closed)
GET    /api/mandate/:slug                          → строка (содержимое mandate.md)
PUT    /api/mandate/:slug                          → принимает {text}, сохраняет, hot-reload
GET    /api/whitelist/:slug                        → WhitelistEntry[]
PUT    /api/whitelist/:slug                        → принимает массив записей
```

Все эндпоинты идут через существующий `webui/server.ts` HTTP-каркас. Аутентификация — через существующий `webui/auth.ts` (PIN/cookie). Без auth → 401 (Requirement 11.1).

### 9.2 Регистрация в `webui/server.ts:buildRouter()`

```ts
function buildRouter(): Router {
  const r = new Router();
  registerAuthRoutes(r);
  registerProfileRoutes(r);
  registerPresetRoutes(r);
  registerSystemRoutes(r);
  registerAddonRoutes(r);
  registerAssistantRoutes(r);
  registerTgAuthRoutes(r);
  // НОВОЕ
  registerContactsRoutes(r);
  registerInboxRoutes(r);
  registerMandateRoutes(r);
  return r;
}
```

### 9.3 Изменения в `routes/profiles.ts`

Существующий визард на фронте получает новые поля. На бэкенде — расширение `ProfileConfig`-валидации:

```ts
// при создании профиля (POST /api/profiles)
validateNewProfilePayload(body):
  // существующие проверки для slug, name, mode, age, llm, telegram
  // НОВЫЕ:
  if !body.ownerId || typeof body.ownerId !== "number" || body.ownerId <= 0 || body.ownerId > 9999999999999:
     throw 400 "ownerId required, integer 1..9999999999999"
  if !["formal-вы", "friendly-ты", "mixed-by-tier"].includes(body.tone):
     throw 400 "invalid tone"
  if !["gender-neutral-assistant", "female-secretary", "male-secretary"].includes(body.personaStyle):
     throw 400 "invalid personaStyle"
  if !["open", "gated", "whitelist"].includes(body.gateLevel):
     throw 400 "invalid gateLevel"
  if !["silent", "auto-reply", "vip-only"].includes(body.afterHoursPolicy):
     throw 400 "invalid afterHoursPolicy"
  if body.gateLevel === "whitelist" && (!Array.isArray(body.whitelist) || body.whitelist.length === 0):
     throw 400 "whitelist required when gateLevel=whitelist"
  if typeof body.escalationTimeoutMin !== "number" || body.escalationTimeoutMin < 5 || body.escalationTimeoutMin > 1440:
     throw 400 "escalationTimeoutMin must be 5..1440"
  if body.mandate && body.mandate.length > 4000:
     throw 400 "mandate too long"
  // ... etc для proactive*, digestPeriodHours, digestTime
```

Дефолты при отсутствии: `gateLevel="gated"`, `afterHoursPolicy="vip-only"`, `tone="mixed-by-tier"`, `personaStyle="gender-neutral-assistant"`, `escalationTimeoutMin=240`, `proactiveClients=false`, `proactiveBoss=false`.

### 9.4 Frontend (директория `webui/`)

Frontend на Vite, исходники в `webui/src/`. Сейчас не углубляюсь в TSX-структуру (это покрывается в `tasks.md`), фиксирую только маршруты:

| Path | Назначение |
|---|---|
| `/setup/manager` | Визард создания профиля менеджера (Requirement 1) |
| `/profiles/:slug` | Существующая страница профиля, расширяется новыми полями |
| `/contacts/:slug` | Новая страница списка контактов (Requirement 10) |
| `/inbox/:slug` | Новая страница инбокса тикетов (Requirement 11) |
| `/mandate/:slug` | Редактор `mandate.md` |

### 9.5 WebSocket-каналы

Существующий `ws://host:3100/ws/logs/<slug>` сохраняется. Добавляется (опционально, на будущее):

- `ws://host:3100/ws/inbox/<slug>` — пуш новых тикетов и смены состояния, чтобы Inbox_Page обновлялась live без polling

Для MVP реализации достаточно polling на `Inbox_Page` раз в 5 секунд через `GET /api/inbox/:slug`. WS-канал — задача второй итерации, не блокирует Requirement 11.


## Migration and Rebrand

### Ребренд и сосуществование с оригиналом

### 10.1 Таблица замен (полный список)

| Категория | Оригинал | Форк |
|---|---|---|
| `package.json` `name` | `@thesashadev/girl-agent` | `@thesashadev/manager-agent` |
| `package.json` `bin` ключ | `girl-agent` | `manager-agent` |
| `package.json` `description` | (про persona engine) | про AI-менеджер с упоминанием форка, ≤200 символов |
| `package.json` `repository` | отсутствует | `{ type: "git", url: "https://github.com/shxpe0x/girl-agent-manager" }` + `homepage` ссылка на оригинал |
| CLI вход (`bin/manager-agent`) | `dist/cli.js` (как и было) | `dist/cli.js` (содержимое поменяется) |
| WebUI порт | `3000` | `3100` |
| env-переменная `*_DATA` | `GIRL_AGENT_DATA` | `MANAGER_AGENT_DATA` |
| env-переменная `*_TOKEN` | `GIRL_AGENT_TOKEN` | `MANAGER_AGENT_TOKEN` |
| env-переменная `*_API_KEY` | `GIRL_AGENT_API_KEY` | `MANAGER_AGENT_API_KEY` |
| env-переменная `*_API_PRESET` | `GIRL_AGENT_API_PRESET` | `MANAGER_AGENT_API_PRESET` |
| env-переменная `*_PORT` | `GIRL_AGENT_PORT` | `MANAGER_AGENT_PORT` |
| env-переменная `*_HOST` | `GIRL_AGENT_HOST` | `MANAGER_AGENT_HOST` |
| env-переменная `*_PUBLIC_URL` | `GIRL_AGENT_PUBLIC_URL` | `MANAGER_AGENT_PUBLIC_URL` |
| env-переменная `*_TG_PROXY` | `GIRL_AGENT_TG_PROXY` | `MANAGER_AGENT_TG_PROXY` |
| env-переменная `*_OWNER_ID` | `GIRL_AGENT_OWNER_ID` | `MANAGER_AGENT_OWNER_ID` |
| env-переменная `*_NO_BROWSER` | `GIRL_AGENT_NO_BROWSER` | `MANAGER_AGENT_NO_BROWSER` |
| env-переменная `*_DOCKER` | `GIRL_AGENT_DOCKER` | `MANAGER_AGENT_DOCKER` |
| Data root Linux | `~/.local/share/girl-agent/data` | `~/.local/share/manager-agent/data` |
| Data root macOS | `~/Library/Application Support/girl-agent/data` | `~/Library/Application Support/manager-agent/data` |
| Data root Windows | `%APPDATA%\girl-agent\data` | `%APPDATA%\manager-agent\data` |
| Docker image | `ghcr.io/thesashadev/girl-agent` | `ghcr.io/<owner>/manager-agent` |
| Install script header | `[girl-agent]` | `[manager-agent]` |
| Server help banner | `girl-agent — AI girl for Telegram` | `manager-agent — AI manager for Telegram` |
| README заголовок и описание | "ИИ-девушка в Telegram..." | "ИИ-менеджер в Telegram..." (уже сделано) |
| LICENSE notice | (нет) | "This project is a fork of TheSashaDev/girl-agent..." (уже сделано) |
| GitHub Actions workflows (`.github/workflows/*`) | имена и образы под `girl-agent` | под `manager-agent` |
| GitHub repository name | (репо автора оригинала) | `shxpe0x/girl-agent-manager` (имя репозитория сейчас, не меняем — это форк) |

### 10.2 Конкретные точки в коде

`storage/md.ts:defaultDataRoot()` — строки `girl-agent` заменяются на `manager-agent`:

```ts
// Было:
function defaultDataRoot(): string {
  if (process.env.GIRL_AGENT_DATA) return process.env.GIRL_AGENT_DATA;
  // ...
  return path.join(os.homedir(), ".local", "share", "girl-agent", "data");
}

// Станет:
function defaultDataRoot(): string {
  if (process.env.MANAGER_AGENT_DATA) return process.env.MANAGER_AGENT_DATA;
  // ...
  return path.join(os.homedir(), ".local", "share", "manager-agent", "data");
}
```

Аналогично для всех мест чтения env. По всему коду:

```sh
grep -rn "GIRL_AGENT_" src/   # должен вернуть пусто после ребренда
grep -rn "girl-agent" src/    # допустимо только в src/migrations/ (для legacy-логики)
```

`cli.ts` — баннер и хелп. `webui/server.ts` — порт по умолчанию. `Dockerfile` — image name. `scripts/install.sh` — пути установки.

### 10.3 Запрет совпадений (Requirement 19.12)

Property-based проверка:

```ts
test("manager-agent defaults are disjoint from girl-agent defaults", () => {
  const forkDefaults = {
    pkgName: "@thesashadev/manager-agent",
    binName: "manager-agent",
    port: 3100,
    envPrefix: "MANAGER_AGENT_",
    dataDirLinux: "~/.local/share/manager-agent/data",
    dockerImage: "manager-agent"
  };
  const originalDefaults = {
    pkgName: "@thesashadev/girl-agent",
    binName: "girl-agent",
    port: 3000,
    envPrefix: "GIRL_AGENT_",
    dataDirLinux: "~/.local/share/girl-agent/data",
    dockerImage: "girl-agent"
  };
  for (const key of Object.keys(forkDefaults)) {
    expect(forkDefaults[key]).not.toBe(originalDefaults[key]);
  }
});
```

### 10.4 Что НЕ меняется

- содержимое `LICENSE` ниже первых 5 строк (только prepend ноты — уже сделано)
- npm-скоуп `@thesashadev` (по просьбе пользователя)
- структура `src/` директорий
- именование внутренних типов TypeScript, не относящихся к удаляемым стадиям
- API подписи `LLMClient`, `TgAdapter`, `Runtime.start/stop/pause/resume`


### Миграции

### 11.1 `src/migrations/0115-manager-mode.ts`

Цель: позволить пользователю, запустившему оригинальный `girl-agent` и заведшему профиль, перевести его в `manager-mode` без потери истории. На практике: при первом запуске форка с существующими профилями, миграция превращает их в манагерские.

```ts
import type { Migration } from "./index.js";

export const migration0115: Migration = {
  id: "0115-manager-mode",
  description: "Переводит профиль из girl-agent в manager-agent: тиры вместо стадий, mandate вместо boundaries, ownerId required",
  async migrate(ctx) {
    const cfg = ctx.config;

    // Удаляем устаревшие поля (если они там были)
    delete (cfg as any).stage;
    delete (cfg as any).vibe;
    delete (cfg as any).communication;
    delete (cfg as any).nightWakeChance;
    delete (cfg as any).ignoreTendency;
    delete (cfg as any).mcp;

    // Устанавливаем дефолты для новых полей
    if (!(cfg as any).tone) (cfg as any).tone = "mixed-by-tier";
    if (!(cfg as any).personaStyle) (cfg as any).personaStyle = "gender-neutral-assistant";
    if (!(cfg as any).gateLevel) (cfg as any).gateLevel = "gated";
    if (!(cfg as any).afterHoursPolicy) (cfg as any).afterHoursPolicy = "vip-only";
    if ((cfg as any).proactiveClients === undefined) (cfg as any).proactiveClients = false;
    if ((cfg as any).proactiveBoss === undefined) (cfg as any).proactiveBoss = false;
    if (!(cfg as any).escalationTimeoutMin) (cfg as any).escalationTimeoutMin = 240;
    (cfg as any).profileType = "manager";

    // ownerId — если не было задано, миграция не может его восстановить.
    // Помечаем профиль warning'ом, который покажется в WebUI до тех пор, пока владелец не задаст явно.
    if (!cfg.ownerId) {
      ctx.log("WARNING: ownerId не задан в профиле; задайте его в WebUI");
    }

    // Удаляем устаревшие файлы
    await rmIfExists(ctx.profilePath, "relationship.md");
    await rmIfExists(ctx.profilePath, "conflict.json");
    await rmIfExists(ctx.profilePath, "boundaries.md");

    // Создаём mandate.md если его нет
    const mandatePath = path.join(ctx.profilePath, "mandate.md");
    if (!fileExists(mandatePath)) {
      await fs.writeFile(mandatePath, DEFAULT_MANDATE_TEMPLATE, "utf8");
    }

    // Создаём пустой tickets.json
    const ticketsPath = path.join(ctx.profilePath, "tickets.json");
    if (!fileExists(ticketsPath)) {
      await fs.writeFile(ticketsPath, JSON.stringify({version: 1, nextId: 1, tickets: []}, null, 2), "utf8");
    }

    // Создаём папку contacts/
    const contactsDir = path.join(ctx.profilePath, "contacts");
    await fs.mkdir(contactsDir, { recursive: true });

    return cfg;
  }
};

const DEFAULT_MANDATE_TEMPLATE = `# Mandate

## Решаю сама
- (опишите темы, на которые менеджер может отвечать без согласования)

## Эскалирую
- (опишите темы, по которым менеджер должен спрашивать вас)

## Никогда не отвечаю
- (опишите темы, на которые менеджер не отвечает вообще)
`;
```

Регистрируется в `src/migrations/index.ts:ALL_MIGRATIONS`. Пользователь применяет через `manager-agent update` или автоматически при запуске форка с pending-миграциями.

### 11.2 Совместимость с `relationship.md`

При миграции `relationship.md` удаляется. Но если пользователь хочет сохранить логи отношений из старого режима, он перед апдейтом запускает `cp data/<slug>/relationship.md data/<slug>/_backup_relationship.md`. В коде форка `_backup_*` файлы игнорируются. Это явно описывается в README раздела «Безопасность» при добавлении.

### 11.3 Откат миграции

`migrations/index.ts` фреймворк не поддерживает откат by design. Если пользователь захочет вернуться к `girl-agent`, он использует оригинальный пакет с оригинальным data-каталогом — они не пересекаются по путям (см. Requirement 15).

## Correctness Properties

Свойства корректности из Requirement 19, оформленные для property-based тестирования. Реализация: в `src/__tests__/properties/` использовать `fast-check` (добавляется в `devDependencies`).

### Property 1: Тикеты не теряются

**Validates: Requirements 19.1, 19.2**

`FOR ALL` последовательностей входящих сообщений длиной 1..1000, приводящих к решению `escalate`, движок создаёт ровно один тикет на каждое такое решение, и каждый тикет завершается в состоянии `closed` за число шагов, не превышающее 1000 переходов.

### Property 2: Конфиденциальность

**Validates: Requirements 19.3, 19.4, 7.2**

`FOR ALL` пар `(summary, clientReply)` внутри одного тикета не существует непрерывного фрагмента длиной более 80 символов (посимвольно, с учётом пробелов, без учёта регистра), совпадающего между `summary` и `clientReply`. Проверяется в `confidentiality-guard.assertNoLeak`.

### Property 3: Однозначность парсера ответа босса

**Validates: Requirements 19.5, 19.6, 6.6**

`FOR ALL` `Boss_Reply`, содержащих одновременно `reply_to`, префикс `#T-<n>` и префикс `@<username>`, парсер либо возвращает один и тот же `ticketId` для всех трёх способов, либо возвращает `conflict` без отправки клиенту.

### Property 4: Монотонность blocked-тира

**Validates: Requirements 19.7, 19.8, 2.6**

`FOR ALL` контактов с `tier=blocked`, движок не выполняет автоматический переход в любой другой `tier` без явного действия владельца, записанного как событие смены тира с идентификатором владельца.

### Property 5: Round-trip Ticket

**Validates: Requirements 19.9, 19.10**

`FOR ALL` валидных значений `Ticket`, последовательность `JSON.stringify → JSON.parse` даёт значение, структурно эквивалентное исходному (равенство по всем полям схемы).

### Property 6: Round-trip Contact

**Validates: Requirements 19.11**

`FOR ALL` валидных значений `ContactRecord`, последовательность `JSON.stringify → JSON.parse` через `data/<slug>/contacts/<chat_id>.json` даёт значение, структурно эквивалентное исходному.

### Property 7: Coexistence — изоляция от оригинала

**Validates: Requirements 19.12, 15.10**

`FOR ALL` значений по умолчанию `manager-agent` (имя пакета, CLI-бинарь, порт WebUI, префикс env, корневой путь данных, Docker-имя), ни одно не совпадает со значением по умолчанию `girl-agent`.

### Property 8: Допустимые переходы тикета

**Validates: Requirements 19.13, 19.14, 18.3**

`FOR ALL` переходов состояний тикета, движок разрешает только переходы из явного списка: `open → waiting-boss`, `waiting-boss → answered`, `answered → closed`, `waiting-boss → closed`, `open → closed`.

## Testing Strategy

### Property-based тесты

Покрывают свойства из секции `Correctness Properties` выше через `fast-check`. Каждое свойство — отдельный тест в `src/__tests__/properties/<property-name>.spec.ts`. Целевой объём прогона — 1000 итераций на свойство.

### Юнит-тесты

- `boss-reply-parser.spec.ts` — все 12 acceptance criteria из Requirement 6, плюс edge-cases (multibyte username, эмодзи в начале, очень длинный текст)
- `mandate.spec.ts` — все 10 acceptance criteria из Requirement 3, включая hot-reload
- `confidentiality-guard.spec.ts` — позитивные и негативные кейсы overlap-detection
- `escalation.spec.ts` — все переходы состояний из Requirement 18
- `contacts.spec.ts` — round-trip, tier transitions, manualOverride respect
- `presence-work-hours.spec.ts` — `isOutOfHours` для разных tz и BusySlot

### E2E-тест в headless-режиме

Опциональный smoke-test через `--json-events` режим: спайнаем фейковый Telegram-адаптер, который шлёт сценарий «новый клиент → escalate → reply от босса → ответ клиенту → confirm», читаем NDJSON-события, ассертим переходы тикета. Это покрывает интеграцию слоёв без необходимости поднимать настоящий Telegram.

### План верификации

1. После реализации каждого модуля: `npm run typecheck` зелёный, юнит-тесты модуля зелёные.
2. После интеграции всех модулей: `npm run build` собирает `dist/cli.js`, объём не вырастает более чем в 1.5× от оригинала (738 KB → ≤1.1 MB).
3. Smoke-test: создать тестовый профиль через WebUI, отправить серию сообщений через сценарий бот → менеджер → DM боссу → ответ → клиент. Проверить полный цикл вручную.
4. Property-based прогон: 1000 итераций каждого PBT-свойства, ноль контрпримеров.
5. Backward-compat: на чистой машине поставить и запустить параллельно `girl-agent` и `manager-agent`, убедиться, что оба работают без коллизий портов и каталогов данных.

## Error Handling

### Риски и митигации

| Риск | Митигация |
|---|---|
| LLM генерирует ответ клиенту, содержащий >80 char overlap с mandate.md | `confidentiality-guard` блокирует и эскалирует повторно с пометкой `confidentiality-block`; счётчик `meta.confidentialityBlocks` в тикете для аудита |
| Босс отвечает на тикет, который уже закрылся по таймауту | `boss-reply-parser` возвращает `ticket-not-found`, боссу шлётся уведомление с подсказкой |
| Race между Runtime-handler и WebUI-PATCH на тот же `Ticket` | In-memory мьютекс на профиль + atomic write tickets.json + детект расхождения `history.length` |
| `tickets.json` распух до тысяч закрытых тикетов | Архивация: раз в неделю переносить тикеты со `state=closed` старше 90 дней в `tickets.archive.<YYYY-MM>.json`; реализуется в `digests`-тикере |
| Telegram-адаптер падает при отправке боссу | `escalation.openTicket` имеет retry 3 раза с backoff; если не доходит — тикет остаётся в `open`, в логах ошибка, владелец видит в WebUI inbox |
| Удаление `hormones.ts` ломает рантайм оригинальных профилей до миграции | `migrations/0115` запускается до старта `Runtime`; `runtime-bus.ts` уже это делает (`checkForPendingMigrations` в `startWithConfig`) |
| Owner случайно установил `ownerId` на чужой Telegram-id | WebUI визард показывает «отправьте `/whoami` боту, чтобы узнать свой chat-id»; добавить в форму подсказку с командой |
| LLM-стоимость растёт из-за двойных вызовов (mandate.decideAction + ответ) | Кеш решения mandate в течение 60с для одного контакта; mandate.decideAction может использовать модель меньше/дешевле |
| Userbot бан от Telegram при росте числа клиентов | Неустранимо архитектурно; описать в README раздел «Безопасность» как ограничение userbot-режима |

### 12.5 План верификации

1. После реализации каждого модуля: `npm run typecheck` зелёный, юнит-тесты модуля зелёные.
2. После интеграции всех модулей: `npm run build` собирает `dist/cli.js`, объём не вырастает более чем в 1.5× от оригинала (738 KB → ≤1.1 MB).
3. Smoke-test: создать тестовый профиль через WebUI, отправить серию сообщений через сценарий бот → менеджер → DM боссу → ответ → клиент. Проверить полный цикл вручную.
4. Property-based прогон: 1000 итераций каждого PBT-свойства, ноль контрпримеров.
5. Backward-compat: на чистой машине поставить и запустить параллельно `girl-agent` и `manager-agent`, убедиться, что оба работают без коллизий портов и каталогов данных.

---

Документ описывает целевое состояние. Конкретные файлы, изменения и порядок их внесения — в `tasks.md` (следующая фаза spec-workflow).
