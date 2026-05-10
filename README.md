![girl-agent banner](https://girl-agent.com/og-image.png)

[website]: https://girl-agent.com
[docs]: https://docs.girl-agent.com

**[website]** &nbsp;·&nbsp; **[docs]**


Это только бета-версия. Со временем будет дорабатыватся.
Со всеми проблемами и багами пишите в Issues.
ТГ создателя - @voided_net

Тг канал: https://t.me/GirlAgentAI/
Тг сообщество: https://t.me/GirlAgentAI_chat/
---

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Что под капотом](#что-под-капотом)
- [Почему не просто GPTs или промпт](#почему-не-просто-gpts-или-промпт)
- [Changelog](./CHANGELOG.md)
- [Безопасность](#безопасность)
- [Лицензия](#лицензия)

---

## О проекте

Она не отвечает на каждое сообщение. Иногда читает и молчит. Иногда ставит реакцию. Иногда отвечает через час, потому что была занята или просто не хотела.

Это не баг. Так задумано.

`girl-agent` — ИИ-девушка, которая ведёт себя в переписке как человек. Со сном, настроением, расписанием, памятью и характером. Без "конечно, я понимаю" и ChatGPT-повадок.

---

## Быстрый старт

### linux / macos / wsl / termux — одной командой (без node на машине)

```sh
curl -fsSL https://raw.githubusercontent.com/TheSashaDev/girl-agent/master/scripts/install.sh | sh
```

Что произойдёт:
- определит OS + arch (linux x64/arm64, macos x64/arm64, wsl)
- если запущен в **Termux** (Android) → установит Node.js через встроенный `pkg` и настроит пакет локально.
- если есть docker → поставит docker-обёртку (полная изоляция от системы)
- иначе → скачает [official Node.js 22 LTS](https://nodejs.org) в `~/.local/share/girl-agent/runtime/` и поставит туда же `@thesashadev/girl-agent` (system node не трогается)
- shim-скрипт `girl-agent` положит в `~/.local/bin/girl-agent`
- ничего не пишется в `/usr/local/`, `sudo` не нужен

Дальше:
```sh
girl-agent                   # ink-визард для интерактивной первичной настройки
girl-agent --profile=arina   # запустить готовый профиль
girl-agent server --help     # серверный режим (без TTY, для systemd / cron / CI)

# для Termux (Android): запуск в фоне через PM2
pm2 start girl-agent -- server --headless --profile=arina
```

Опции установщика:
```sh
# форсировать docker
curl -fsSL .../install.sh | sh -s -- --docker

# форсировать локальную ноду
curl -fsSL .../install.sh | sh -s -- --local

# конкретная версия пакета
curl -fsSL .../install.sh | sh -s -- --version=0.1.9
```

Удаление: `rm -rf ~/.local/share/girl-agent ~/.local/bin/girl-agent`

### windows — десктоп-приложение

В папке `desktop-rs/` лежит нативный десктоп-клиент на Rust (iced) и инсталлер-визард: ставит Node-пакет, создаёт профиль, открывает дашборд. Параллельно поднимается локальный веб-UI на `http://127.0.0.1:7777` с тем же дашбордом — открыть из соседнего окна / телефона по локалке. Без WebView, без Electron.

```powershell
cd desktop-rs
cargo run -p girl-agent-installer   # визард настройки персоны
cargo run -p girl-agent-desktop     # открыть дашборд
```

Готовые бинари будут собираться в CI чуть позже — пока нужно `cargo build --release`.

### если уже есть node ≥ 20

```sh
npx @thesashadev/girl-agent              # ink-визард
npx @thesashadev/girl-agent --profile=arina
```

### docker (для серверов; нулевые зависимости на хосте)

Интерактивная первичная настройка (ink-визард внутри контейнера):
```sh
docker run -it --rm -v girl-agent-data:/data ghcr.io/thesashadev/girl-agent:latest
```

Headless (для systemd / docker compose / k8s) — сначала готовим конфиг, потом запускаем без TTY:
```sh
# 1) шаблон конфига
docker run --rm ghcr.io/thesashadev/girl-agent:latest server --print-config > bot.json
# 2) отредактировать bot.json (token, api-key)
# 3) поднять в фоне
docker run -d --name girl-agent --restart=unless-stopped \
  -v girl-agent-data:/data \
  -v $PWD/bot.json:/config/bot.json:ro \
  ghcr.io/thesashadev/girl-agent:latest \
  server --config /config/bot.json --headless
```

Или совсем без файла, через env-vars (k8s secrets, docker compose):
```sh
docker run -d --name girl-agent --restart=unless-stopped \
  -v girl-agent-data:/data \
  -e GIRL_AGENT_MODE=bot \
  -e GIRL_AGENT_TOKEN=... \
  -e GIRL_AGENT_API_PRESET=claudehub \
  -e GIRL_AGENT_API_KEY=... \
  -e GIRL_AGENT_NAME='Аня' -e GIRL_AGENT_AGE=22 \
  ghcr.io/thesashadev/girl-agent:latest \
  server --headless
```

Готовые шаблоны:
- `girl-agent server --print-config` — bot.json
- `girl-agent server --print-systemd` — `/etc/systemd/system/girl-agent.service`
- `girl-agent server --print-docker` — Dockerfile / compose / k8s snippets
- [`docker-compose.example.yml`](./docker-compose.example.yml) в корне репо

**Из исходников:**

```powershell
git clone https://github.com/TheSashaDev/girl-agent.git
cd girl-agent
npm install
npm run dev
```

---

## Что под капотом

Поведение собирается из нескольких слоёв, а не из одного промпта.

- 📱 **Она не всегда онлайн** — паттерн присутствия зависит от персонажа: кто-то в телефоне круглые сутки, кто-то заходит раз в час, кто-то только вечером.
- 😴 **Ночью спит** — можно разбудить через `:wake`, но без команды шанс ответа низкий.
- 📅 **Расписание дня** — у каждого дня есть расписание: пары, работа, дорога, свободное время. Если она на занятиях, телефон может быть недоступен.
- ❤️ **Отношения** — пять счётчиков: интерес, доверие, привлекательность, раздражение, неловкость. Меняются от каждого диалога. Высокое раздражение — чаще игнор и холод.
- 📈 **Стадии сближения** — отношения проходят стадии: от "дала тг, но холодная" до "давно вместе". Стадия влияет на тепло, флирт, длину ответов.
- ⚠️ **Конфликты** — если давить, спамить или нарушать границы — включается конфликт. Она может замолчать на часы или дни.
- 🧠 **Память** — важные события пишутся в `long-term.md` и всплывают в будущих диалогах.
- 🚫 **Anti-AI** — промпт запрещает markdown, "конечно", "я понимаю", эмодзи-ряды, вопросы в конце сообщений и всё, что палит ChatGPT.
- 👤 **Userbot mode** — настоящий Telegram-аккаунт через MTProto. Умеет читать сообщения, ставить реакции, печатать, удалять и редактировать. Выглядит как живой человек, а не как бот.

---

## Почему не просто GPTs или промпт

Вариантов сделать "девушку в Telegram" несколько — от костыльных до полноценных. Разберём, что есть и где дыры.

### ChatGPT GPTs

**Как это работает:** Кастомный бот внутри ChatGPT с system prompt. Логика поведения = промпт.

**Что упущено:**
- Нет памяти между сессиями — каждая начинается с нуля
- Нет Telegram — только веб-интерфейс
- Нет реакций, печати, редактирования
- Бот всегда "онлайн" — нет расписания или сна
- Память ограничена контекстным окном

**Итог:** Чат-бот с кастомным промптом, без состояния и реалистичного поведения.

---

### OpenClaw + prompt (markdown-файлы)

**Как это работает:** Фреймворк для AI-ассистентов. Личность через markdown-файлы (SOUL.md, IDENTITY.md, USER.md). Telegram bridge через GramJS (MTProto).

**Что упущено:**
- Нет реализм-модулей: presence, sleep, conflict, daily-life, relationship stages
- Нет agenda — бот не планирует действия
- Память = история сообщений, нет long-term storage
- Нет relationship score и conflict system

**Итог:** Хороший bridge для Telegram, но не персонаж-движок. Поведение = промпт + история.

---

### HeatherBot

**Как это работает:** Локальный Telegram userbot (MTProto via Telethon), persona в YAML, 4-слойная память, 17 kink-specific overlays. ~10K строк Python.

**Что упущено:**
- Слишком специфично под NSFW — 17 kink overlays
- Сложно настроить — нужно llama-server, Ollama, ComfyUI
- Требует мощного GPU — 12B модель локально
- Нет presence/sleep/conflict как отдельных модулей

**Итог:** Мощное, но узкое решение под NSFW с тяжёлой инфраструктурой.

---

### Character.AI

**Как это работает:** Закрытый сервис для AI-переписки. Персоны через UI, поведение = prompt engineering + session-level memory.

**Что упущено:**
- Нет Telegram — только веб-интерфейс
- Нет контроля — всё на их серверах
- Память сбрасывается между сессиями
- Memory ограничена — persona обрезается при росте истории

**Итог:** Закрытый сервис с ограниченной памятью и без Telegram.

---

### girl-agent

**Как это работает:** Движок с несколькими слоями состояния: presence, sleep, daily-life, relationship stages, conflict, memory, anti-AI. Userbot mode через MTProto.

**Технические детали:**
- Presence — паттерны присутствия (частота, офлайн, вероятность ответа)
- Sleep — время сна, night wake chance
- Daily-life — расписание, занятость, приоритеты
- Relationship stages — stranger → convinced → close → intimate → bonded
- Relationship score — interest, trust, attraction, annoyance, cringe
- Conflict — если давить/спамить, включается конфликт, может замолчать
- Memory — важные события в long-term.md, всплывают в диалогах
- Anti-AI — промпт запрещает markdown, "конечно", "я понимаю", эмодзи-ряды
- Userbot mode — умеет читать, реагировать, печатать, удалять, редактировать
- Agenda — бот планирует действия, живёт своей жизнью

**Итог:** Движок с несколькими слоями решения. Поведение собирается из состояния, а не из текстовых инструкций.

---

## Безопасность

⚠️ **Не публикуй:** `data/`, `config.json`, `sessionString` и API-ключи.

🔒 **Для userbot mode** используй отдельный тестовый аккаунт — Telegram может забанить основной аккаунт за подозрительную активность.

---

## Лицензия

📄 **Source-available** — исходный код открыт для личного тестирования, оценки и вкладов.

**Разрешено:**
- Клонировать и запускать локально
- Создавать issues и отправлять pull requests
- Изучать код и экспериментировать

**Запрещено без письменного разрешения:**
- Коммерческое использование
- Платный хостинг
- Перепродажа
- Публичные конкурирующие клоны
- Использование кода внутри коммерческих продуктов

📜 Полный текст лицензии: [LICENSE](./LICENSE)
