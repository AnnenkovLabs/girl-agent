# Changelog

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
