# Changelog

## Unreleased

### Added

- `engine/digests.ts` — `composeDailyDigest(slug)` собирает сводку по открытым тикетам, ожидающим босса и новым контактам за период (по `createdAt`); пишет ссылку `Inbox: /inbox/<slug>`. `scheduleDigest` принимает период 1..168 часов (дефолт 24h в 09:00 по `cfg.tz`) и `markAgendaItemFailed` помечает пункт как `failed` без авто-повтора (Task 4.10, Req 9).
- `engine/agenda.ts:agendaItemDirection` / `gateAgendaByFlags` — двусторонняя повестка с гейтингом по `proactiveClients` / `proactiveBoss`. `AgendaItem.direction` (`client` | `boss`) расширяет существующее хранилище без миграции (старые записи трактуются как `client`).
- `engine/digests.ts:schedulePromiseFollowUp` — идемпотентное планирование follow-up клиенту по обещанию; без `dueAtMs` ставит `now + 24h` (Req 9.1).
- Wiring в `engine/runtime.ts`: при `proactiveBoss=true` стартует `scheduleDigest`, на тик отправляет дайджест через `tg.sendText(cfg.ownerId)`. Ошибка адаптера → пункт повестки идёт в `failed` без авто-повтора (Req 9.6). `tickAgenda` гейтит клиентские пункты по `proactiveClients`.
- `engine/gate.ts` — чистая функция `evaluateGate` для ветвления входящих по `cfg.gateLevel` (`open` / `gated` / `whitelist`) с регистронезависимым матчингом whitelist по `chatId` и `@username`.
- `storage/md.ts:subscribeConfig` — наблюдатель `config.json` через `fs.watch`, чтобы runtime подхватывал изменения `gateLevel` и `whitelist` без рестарта (≤5 секунд).
- Wiring в `engine/runtime.ts:handleIncoming` для не-primary клиентов: `upsertOnIncoming` → `isBlocked` → `evaluateGate` с эмитом `ignored`/`info` для `block`/`force-escalate`.
- `engine/after-hours.ts` — чистый роутер `evaluateAfterHours` по `cfg.afterHoursPolicy` (`silent` / `auto-reply` / `vip-only`) с одноразовым auto-reply на off-окно (поле `lastAutoReplyAt`) и хелпер `computeOffWindowStart` для определения границ непрерывного нерабочего окна (Task 4.9, Req 8).
- Wiring в `engine/runtime.ts:handleIncoming` после gate `allow` для не-primary клиентов: вне рабочих часов решение `silent` → ignored, `auto-reply` → одно сообщение + persist `lastAutoReplyAt`, `auto-reply-skip` → info, `normal` → продолжение flow.
- Hot-reload `cfg.afterHoursPolicy` через существующий `subscribeConfig` (Task 4.8).

## 0.4.4

Дата: 2026-05-17

📝 Документация

- Обновлена лицензионная политика: проект переведён на Community License (GSACL) версии 1.1, в лицензии явно уточнена позиция по дезинформации.


## 0.4.3

Дата: 2026-05-17

🐛 Исправления

- Устранено дублирование сообщений, возникавшее при перефразировании ответов моделью — одинаковые или близкие по содержанию «пузыри» больше не появляются дважды.


## 0.4.2

Дата: 2026-05-17

🐛 Исправления

- Корректно сопоставляются все fallback-значения реакций с записями в allowlist, чтобы реакции работали предсказуемо.
- Устранены несколько багов из сообщества: парсинг прокси, ошибки при инициализации бота и проблема с дублированием в ежедневных сценариях (daily-life).

📝 Документация

- В quick-start вкладку с Windows npx переместили на первое место и добавили инструкции для запуска на Windows.
- Русифицирована пользовательская документация и обновлён README.
- Исправлена информация о ценах для ClaudeHub.
- Развернут и обновлён полный сайт документации Fumadocs на docs.girl-agent.com


## 0.4.1

Дата: 2026-05-14

🐛 Исправления
- Исправлены некорректные Docker URL, из‑за которых могли ломаться загрузка образов
- Устранены проблемы с памятью при работе с медиа (снижение утечек/чрезмерного потребления)
- Исправлены ошибки в процессе установки и в веб‑интерфейсе (WebUI), мешавшие корректной настройке

🔧 Улучшения
- Улучшен пользовательский опыт аддонов: доработан интерфейс и поведение при взаимодействии с расширениями


## 0.4.0

Дата: 2026-05-14

🚀 Новое

- WebUI теперь показывает сразу 3 понятные ссылки при запуске:
  - `http://127.0.0.1:<port>` — для локального запуска на этой же машине;
  - `http://localhost:<port>` — привычный локальный адрес;
  - `http://<public-ip>:<port>` — адрес, который удобно открыть с основного ПК, если girl-agent запущен на сервере, VPS или в Docker.
- Добавлена авторизация WebUI. Если задан `GIRL_AGENT_WEBUI_PASSWORD` или `GIRL_AGENT_WEBUI_TOKEN`, интерфейс просит пароль и защищает API/WebSocket от доступа без входа. При обычном локальном запуске без переменной окружения WebUI остаётся максимально удобным и не требует пароль.
- Добавлена поддержка Telegram-прокси формата `tg://proxy?server=...&port=...&secret=...`. Теперь можно вставлять ссылку из Telegram напрямую, без ручного перевода в socks-формат.
- Добавлено осторожное обнаружение известных интернет-мемов в медиа без reverse image search. Если vision-модель уверенно понимает, что изображение — известный мем, эта информация передаётся персоне; если уверенности нет, картинка считается обычной, чтобы не плодить false positive.
- Для Termux добавлен отдельный low-memory build-сценарий: сборка старается потреблять меньше ОЗУ именно на этапе компиляции, при этом качество ответов, лимиты токенов и runtime-память диалогов не урезаются.
- WebUI теперь использует отдельный React/Vite-интерфейс из папки `webui/` как основной пользовательский интерфейс. Встроенная серверная часть `src/webui` остаётся backend/API/runtime-слоем.

🔧 Улучшения

- Минимальная версия Node.js снижена с 20 до `18.18+`. На Node 18/19 приложение больше не останавливается из-за жёсткого требования Node 20: показывается предупреждение, но запуск продолжается.
- Установка в Termux теперь использует `pkg install nodejs`, проверяет установленную версию Node и даёт понятную подсказку, если нужна установка/обновление.
- Docker-запуск стал удобнее для реального сервера: порт `3000` пробрасывается наружу, WebUI слушает `0.0.0.0`, а контейнер запускается от текущего пользователя, чтобы не создавать файлы с неожиданными правами root.
- Улучшена работа с папкой `data`: если текущая директория недоступна для записи, girl-agent выбирает нормальное пользовательское хранилище вместо падения с `permission denied`.
- `GIRL_AGENT_PUBLIC_URL` продолжает поддерживаться для reverse proxy/доменов, но теперь не скрывает локальные ссылки — пользователь всё равно видит все варианты входа.
- В userbot-настройке API ID/API HASH больше не требуются там, где выбран сценарий «прокси автора». Если пользователь выбирает свои Telegram API credentials, поля остаются обязательными.
- Для владельческого proxy-flow добавлены переменные `GIRL_AGENT_OWNER_PROXY_API_ID` и `GIRL_AGENT_OWNER_PROXY_API_HASH` с fallback на `GIRL_AGENT_TG_API_ID`/`GIRL_AGENT_TG_API_HASH`.
- WebUI dev-server теперь слушает `0.0.0.0`, чтобы интерфейс было проще открыть снаружи VM/сервера во время разработки.
- В сборке WebUI явно закреплён `esbuild`, чтобы избежать несовпадения JS-обёртки и native binary при разных install-сценариях.
- Сохранены и расширены улучшения из текущего PR: более понятные Docker URL, исправления медиа/стикеров, безопасная память о не-владельцах, UX аддонов и улучшения desktop installer.

🐛 Исправления

- Исправлена ошибка `runtime start failed: Invalid sockets params: ip=undefined, port=undefined, socksType=undefined`, которая возникала из-за неподдержанного `tg://proxy` или некорректно разобранного proxy URL.
- Исправлена проблема, когда после изменения настроек и нажатия «Применить» значения в WebUI визуально возвращались на старые, хотя после перезагрузки уже были сохранены. Теперь draft очищается только после успешного сохранения/применения.
- Исправлено зависание на генерации персоны: если persona-файлы уже есть, они переиспользуются; если LLM не отвечает или падает, создаётся базовый persona pack, чтобы мастер настройки не висел бесконечно.
- Исправлены permission denied сценарии при создании `data` в Linux/Docker, из-за которых раньше мог потребоваться ручной `chmod`.
- Исправлены проблемы с Telegram media pipeline: фото и статичные стикеры корректнее передаются в vision-контекст, а повторные стикеры не создают лишние дубли в памяти.
- Исправлены edge cases в installer/desktop flow: обновление runtime стало атомарнее, а вставка через Ctrl/Cmd+V лучше работает даже при кириллической раскладке.

📝 Для пользователя

- Если запускаешь локально — открывай `127.0.0.1` или `localhost`.
- Если запускаешь на сервере или в Docker — пробрось порт и открывай ссылку с public IP.
- Если хочешь закрыть WebUI паролем — запусти с `GIRL_AGENT_WEBUI_PASSWORD=твой_пароль`.
- Если используешь Telegram proxy-ссылку — теперь можно вставлять прямо `tg://proxy?...`.
- Если запускаешь на телефоне в Termux — используй обычный Termux `nodejs`; Node 20 больше не обязателен, но нужна версия `18.18+`.

## 0.3.2

Дата: 2026-05-13

🚀 Новое
- Расширена база знаний проекта для ассистента и внедрено категоризированное извлечение знаний — ответы теперь подбираются по тематическим категориям и стали более релевантными.

🐛 Исправления
- Исправлены цвета контекста ассистента и текста на кнопках для корректной читаемости в разных темах.
- Починена логика мастера настройки: корректно работает пропуск шагов и исправлена привязка значений ползунка «сон».


## 0.3.1

Дата: 2026-05-13

🚀 Новое
- Реализовано хранилище "memory palace" для долговременной памяти, позволяющее структурировать и сохранять воспоминания более эффективно.

🔧 Улучшения
- Расширено покрытие захвата памяти и улучшена непрерывность и воспроизведение воспоминаний, чтобы бот лучше сохранял и восстанавливал контекст разговоров.
- Убраны жестко заданные настройки "memory boosts", память стала работать гибче и настраиваться динамически.

🐛 Исправления
- Исправлен контекст сборки Docker для WebUI, что устраняет ошибки при создании образа интерфейса.


## 0.3.0

Дата: 2026-05-13

🚀 Новое

- Memory Palace: новая система памяти, вдохновлённая дворцом памяти. Персона раскладывает важные детали по «ящикам»: факты, события, открытия, предпочтения, советы, обещания, открытые темы, эмоции и сомнительные факты.
- Дословное сохранение: важные фразы и фрагменты переписки сохраняются без пересказа и без обрезки слов, чтобы не терять нюансы, интонацию и конкретику.
- Умная выдача в контекст: в запрос к модели попадает не вся история, а только релевантные текущему сообщению ящики памяти. Это помогает помнить вчерашнее/утреннее, не раздувая prompt.
- Майнинг дневных логов: старые дневные логи разбираются чанками, поэтому длинный день не теряется из-за лимита одного summary.
- Память ignored/reaction-only сообщений: если персона не ответила, но пользователь сказал важный факт, он всё равно может попасть в память.
- Миграция существующих профилей в Memory Palace через `npx @thesashadev/girl-agent update`.
- WebUI теперь показывает расширенные файлы памяти, включая Memory Palace drawers.

🔧 Улучшения

- Proactive agenda использует релевантные ящики Memory Palace вместо большого legacy long-term блока.
- Стабильные ID ящиков уменьшают дубли при повторном майнинге одного и того же фрагмента.
- Legacy-файлы памяти продолжают обновляться для обратной совместимости.

## 0.2.2

Дата: 2026-05-12

🚀 Новое

- Добавлен навык для тестирования веб‑интерфейса (WebUI) girl-agent


## 0.2.1

Дата: 2026-05-12

🚀 Новое
- Поддержка формата аддонов .gaa: загрузка через drag-and-drop, поддержка code.patch и CLI-команды pack/init.
- Существенное обновление WebUI: новый React‑фронтенд с HTTP API и WebSocket, редизайн интерфейса, превью Markdown, дашборд отношений, маркетплейс аддонов и десктоп‑supervisor.
- Модальные попапы для команд и настроек аддонов, генерация персоны прямо в визарде — WebUI теперь паритетен функционалу движка.
- Добавлен периодический "heartbeat" для userbot — имитация онлайн‑поведения пользователя.
- Множество улучшений диалога: исправления опечаток, правки сообщений, реакции, переходы этапов, обработка удаления и emoji.

🐛 Исправления
- Починена кнопка «Применить» и логика системы вопросов ИИ‑ассистента.
- Исправлен отдельный шаг генерации персоны и настройка API в визарде.
- Исправлены динамические маршруты WebUI и обновлены зависимости (аудит безопасности).
- Устранены утечки повествования, исправлена нарезка не‑сбалансированных code‑fence и нормализованы имена моделей.
- В движке устранены некорректные маркеры и поведение: строгая проверка маркеров инструментов, удаление [REPORT], вместо молчаливого игнора добавляется заполнитель, улучшено разделение "пузырей" сообщений.

🔧 Улучшения
- Переключились на использование реального Telegram message ID для реакций вместо смещений (offset).
- Расширена совместимость установки: install.sh теперь поддерживает Termux/Android (pkg install nodejs, без glibc).
- Провайдер GirlAI в пресетах видим, но деактивирован — его нельзя выбрать.
- Полировка работы маркетплейса аддонов, визарда и общего UI/UX.

📝 Документация
- Обновлён комментарий по часовому поясу для России.
- Добавлена и расширена документация по аддонам и их использованию в интерфейсе.


## 0.1.19

Дата: 2026-05-09

🔧 Улучшения

- Переработан автоматический процесс релизов: улучшена стабильность и функциональность workflow для автопубликации релизов


## 0.1.18

Дата: 2026-05-09

- chore(ci): switch changelog model to gpt-5-mini
- feat(ci): AI-powered changelog generation via GitHub Models API
- Improve profile and model config UX


## 0.1.17

Дата: 2026-05-09

- Merge pull request #65 from TheSashaDev/devin/1778314838-bug-sweep
- Harden owner id handling
- Improve why and wake commands
- Fix Telegram behavior and setup issues

## 0.1.16

Дата: 2026-05-08

- Merge pull request #63 from TheSashaDev/devin/1778244236-serialize-llm-requests
- Serialize LLM provider requests

## 0.1.15

Дата: 2026-05-08

- Merge pull request #62 from TheSashaDev/devin/1778239329-fix-proactive-memory-and-username
- fix: proactive messages account for conversation memory + add TG identity to system prompt

## 0.1.14

Дата: 2026-05-08

- Merge pull request #59 from TheSashaDev/devin/1778231542-oauth-fixed-port
- fix: update OAuth client credentials and add client_secret to token requests
- fix: use fixed port 3000 for OAuth callback

## 0.1.13

Дата: 2026-05-08

- Merge pull request #56 from TheSashaDev/devin/1778220196-data-migration-system
- feat: GirlAI OAuth login and token refresh support
- feat: add GirlAI API preset and recommended status for LLM providers
- feat: extend migration system with LLM support and auto-run on startup
- fix: robust version lookup for bundled output, fix AGENTS.md auto-run claim
- fix: remove unused import, dynamic version from package.json, use static listProfiles
- feat: AGENTS.md + update command with migration system

## 0.1.12

Дата: 2026-05-08

- Merge pull request #58 from k1gs/fix/daily-life-sleep-schedule-11930283897782997721
- fix: use dynamic sleep schedule in daily-life prompt generator
- fix: update daily-life prompt to support dynamic sleep schedules

## 0.1.11

Дата: 2026-05-07

- Merge pull request #53 from TheSashaDev/devin/1778183666-smart-busy-notify
- feat: smart busy-transition notification based on context, persona, stage, duration

## 0.1.10

Дата: 2026-05-07

- Merge pull request #51 from TheSashaDev/devin/1778179420-proxy-wss-support
- refactor: remove proxy support, WSS enabled by default
- feat: add numeric identifiers to stages for convenience
- feat: add proxy/WSS support for Telegram (fixes #38, #32)

## 0.1.9

Дата: 2026-05-07

- Merge pull request #48 from TheSashaDev/devin/1778156776-auto-release-workflow
- Merge pull request #50 from TheSashaDev/devin/1778176335-fix-markdown-escape
- fix: also switch userbot editLastMessage to HTML spoilers, remove dead escapeMarkdownV2
- fix(telegram): replace MarkdownV2 with HTML spoilers, plain text default (#46)
- feat(ci): auto-release workflow — hourly patch bump + changelog
- Merge pull request #47 from TheSashaDev/devin/1778156514-docker-latest-on-master
- fix(docker): tag latest on master pushes, not main
- Merge pull request #45 from TheSashaDev/devin/1778149966-fix-dockerfile-build-stage
- fix(docker): add build tools to build stage for arm64 native modules
- Merge pull request #44 from TheSashaDev/devin/1778149678-fix-dockerfile-arm64
- fix(docker): add build tools for native modules on alpine arm64
- Merge pull request #43 from TheSashaDev/devin/1778149272-fix-docker-install
- fix: docker install — fix branch ref (main→master), fallback to local on pull failure
- Merge pull request #37 from TheSashaDev/devin/1778090781-windows-installer-webui
- feat(server): curl|sh installer + docker image + headless server mode
- fix(cli): fail loudly on non-TTY terminals + catch unhandled rejections
- feat(installer/desktop): paste, ClaudeHub referral, tournament names, custom sleep, profile picker
- fix(installer): silent crash on Windows — panic=abort + windowed subsystem hid the panic
- fix(installer): replace empty-text widgets in progress header with Space
- feat(installer): bundle portable Node + cli.js, full TS-wizard parity, Cyrillic fonts
- perf: add release-fast profile, mold linker, windows_subsystem
- Добавить ссылки на Telegram канал и сообщество
- feat: native Windows installer + desktop app + web UI (Rust/iced)
- Merge pull request #36 from TheSashaDev/devin/1778089384-changelog-pr35
- docs: add PR 35 to changelog

## 0.1.8 — OpenAI-compatible API compatibility

Дата: 2026-05-06

- JSON-ответы теперь сначала запрашиваются через `json_schema`, с fallback на `json_object` и `text` для разных OpenAI-compatible API. (#33)
- LM Studio и Ollama больше не требуют реальный API ключ в wizard/headless setup.
- Добавлена совместимость с OpenAI-compatible прокси, которые возвращают SSE/event-stream даже на обычный chat completions запрос.
- Добавлена Docker-поддержка для 24/7 запуска на сервере: `Dockerfile`, `docker-compose.yml`, volume для `data` и инструкции в README. (#35)

## 0.1.7 — MarkdownV2 escaping fix

Дата: 2026-05-06

- Исправлена ошибка `400: Bad Request: can't parse entities` при отправке сообщений с точками, скобками и другими зарезервированными символами MarkdownV2. (#15)
- Добавлен `escapeMarkdownV2()` хелпер для экранирования всех 18 зарезервированных символов.
- Fallback на plain text если экранирование не помогает.

## 0.1.6 — --new flag

Дата: 2026-05-06

- Добавлен флаг `--new` для принудительного открытия визарда при создании нового профиля (даже если уже есть существующие).

## 0.1.5 — owner TG credentials proxy

Дата: 2026-05-06

- Добавлен TG auth proxy для пользователей без доступа к my.telegram.org (виртуальные номера, новые аккаунты, VPN с IP датацентра).
- Новый шаг визарда: выбор между своими api_id/api_hash или использованием от владельца.
- Весь процесс авторизации через MTProto идёт через прокси-сервер — креды владельца не отображаются.
- Добавлен модуль `src/telegram/remote-auth.ts` — HTTP-клиент для прокси.
- Proxy URL настраивается через `GIRL_AGENT_AUTH_PROXY` env var (по умолчанию `https://tgproxy.girl-agent.com`).

## 0.1.4 — npm publish automation

Дата: 2026-05-06

- Добавлен GitHub Actions workflow для публикации пакета в npm по тегу `v*`.
- Добавлено правило релиза: каждая публичная обнова должна менять версию в `package.json`/`package-lock.json` и добавлять запись в changelog.

## 0.1.3 — Telegram formatting fix

Дата: 2026-05-05

- Исправлено: включён `parse_mode: "MarkdownV2"` для отправки сообщений в Telegram (bot и userbot).
- Теперь поддерживается форматирование спойлеров `||текст||` и другие MarkdownV2-стили.

## 0.1.2 — communication realism update

Дата: 2026-05-05

- Hotfix: профили из wizard теперь сохраняются раньше, а список профилей больше не показывает недосохранённые папки без `config.json`.
- Добавлены жизненные стили общения: **Нормальная**, **Милая**, **Альтушка**, **Залипала**, **Болтушка**.
- Добавлен `CommunicationProfile` с настройками уведомлений, стиля сообщений, инициативы и life sharing.
- Presence, reply timing, bubbles, ignore chance и proactive agenda теперь учитывают профиль общения.
- Wizard и CLI получили настройку communication profile.
- Runtime `:status` и `:debug` показывают профиль общения.
- Команда `:log` стала удобнее и поддерживает выбор дня/лимита вывода.
- Старый `vibe` автоматически нормализуется в новый формат.

## 0.1.1 — stability baseline

- Базовый публичный релиз с Telegram bot/userbot режимами.
- Persona, speech, relationship state, memory, conflict и agenda-модули.
- Документация по установке, конфигурации, реализм-модулям и troubleshooting.
