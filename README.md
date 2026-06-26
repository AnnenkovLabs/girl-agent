<div align="center">

![girl-agent banner](https://girl-agent.com/og-image.png)

# girl-agent

**ИИ-девушка в Telegram, которая ведёт себя как человек.**
Со сном, расписанием, памятью, характером — и без «конечно, я понимаю».

[Сайт](https://girl-agent.com) · [Документация](https://docs.girl-agent.com) · [Канал](https://t.me/GirlAgentAI) · [Сообщество](https://t.me/GirlAgentAI_chat) · [Автор: @wamux](https://t.me/wamux)

[![License](https://img.shields.io/badge/license-source--available-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Telegram](https://img.shields.io/badge/Telegram-Bot%20%2B%20Userbot-26A5E4?logo=telegram&logoColor=white)](https://t.me/GirlAgentAI)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#docker-для-серверов)

</div>

---

> Это бета. Со всеми проблемами и багами — в [Issues](https://github.com/TheSashaDev/girl-agent/issues) или [@voided_net](https://t.me/voided_net).

## О проекте

Она не отвечает на каждое сообщение. Иногда читает и молчит. Иногда ставит реакцию. Иногда отвечает через час, потому что была занята или просто не хотела.

Это не баг. Так задумано.

`girl-agent` — движок ИИ-персоны для Telegram. **Не промпт. Не GPTs. Не плагин.** Это полноценный агент со своим состоянием: расписание дня, паттерн присутствия, сон, память на месяцы вперёд, конфликт-система, пять счётчиков отношений, девять стадий сближения. Поведение собирается из этих слоёв, а не из одного `system_prompt`.

---

## Содержание

- [Быстрый старт](#быстрый-старт)
  - [Linux / macOS / WSL — одной командой](#linux--macos--wsl--одной-командой)
  - [Windows — через npx](#windows--через-npx-рекомендуем)
  - [Если уже есть Node ≥ 22](#если-уже-есть-node--22)
  - [Docker (для серверов)](#docker-для-серверов)
- [Что под капотом](#что-под-капотом)
- [Почему не просто GPTs или промпт](#почему-не-просто-gpts-или-промпт)
- [Документация](https://docs.girl-agent.com)
- [Безопасность](#безопасность)
- [Лицензия](#лицензия)
- [Changelog](./CHANGELOG.md)

---

## Быстрый старт

### Linux / macOS / WSL — одной командой

Без Node на машине, без `sudo`:

```sh
curl -fsSL https://raw.githubusercontent.com/TheSashaDev/girl-agent/master/scripts/install.sh | sh
```

Что произойдёт:
- определит OS + arch (linux x64/arm64, macos x64/arm64, wsl);
- если есть Docker → поставит Docker-обёртку (полная изоляция от системы);
- иначе → скачает [официальный Node.js 22 LTS](https://nodejs.org) в `~/.local/share/girl-agent/runtime/` и поставит туда же `@thesashadev/girl-agent` (системный Node не трогается);
- положит shim `girl-agent` в `~/.local/bin/girl-agent`;
- ничего не пишется в `/usr/local/`, `sudo` не нужен.

Дальше:

```sh
girl-agent                  # интерактивный визард первичной настройки
girl-agent --profile=arina  # запустить готовый профиль
girl-agent server --help    # серверный режим (без TTY, для systemd / cron / CI)
```

Опции установщика:

```sh
curl -fsSL .../install.sh | sh -s -- --docker        # форсировать Docker
curl -fsSL .../install.sh | sh -s -- --local         # форсировать локальную Node
curl -fsSL .../install.sh | sh -s -- --version=0.4.1 # конкретную версию пакета
```

Удалить: `rm -rf ~/.local/share/girl-agent ~/.local/bin/girl-agent`.

---

### Windows — через npx (рекомендуем)

Самый быстрый способ. Без установщика, без WSL, без Docker.

1. Скачай и поставь [Node.js 22 LTS](https://nodejs.org/en/download/) (`.msi`-инсталлер, галочка **Add to PATH**).
2. В PowerShell:

   ```powershell
   npx @thesashadev/girl-agent
   ```

   Первый запуск скачает пакет (~30 МБ) и откроет визард прямо в PowerShell. WebUI поднимется на `http://localhost:3000`.

Хочешь короче — поставь глобально:

```powershell
npm install -g @thesashadev/girl-agent
girl-agent
```

Нужен системный лоток и автозапуск? Есть [нативный десктоп-клиент на Rust](./desktop-rs/) — готовые бинари в [Releases](https://github.com/TheSashaDev/girl-agent/releases).

---

### Если уже есть Node ≥ 22

```sh
npx @thesashadev/girl-agent
npx @thesashadev/girl-agent --profile=arina
```

Или глобально:

```sh
npm install -g @thesashadev/girl-agent
girl-agent
```

---

### Docker (для серверов)

Интерактивная первичная настройка (визард внутри контейнера):

```sh
docker run -it --rm -v girl-agent-data:/data ghcr.io/thesashadev/girl-agent:latest
```

Headless (для systemd / docker-compose / k8s) — сначала готовим конфиг, потом запускаем без TTY:

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

Или совсем без файла, через env-vars:

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

Готовые шаблоны (можно скопировать прямо из бинаря):

```sh
girl-agent server --print-config    # bot.json
girl-agent server --print-systemd   # /etc/systemd/system/girl-agent.service
girl-agent server --print-docker    # Dockerfile / compose / k8s snippets
```

И в корне: [`docker-compose.example.yml`](./docker-compose.example.yml).

**Из исходников:**

```sh
git clone https://github.com/TheSashaDev/girl-agent.git
cd girl-agent
npm install
npm run dev
```

---

## Что под капотом

Поведение собирается из нескольких слоёв, а не из одного промпта.

| | Слой              | Что делает |
|-|-------------------|------------|
| 📱 | **Presence**      | Она не всегда онлайн. Паттерн присутствия зависит от персонажа: кто-то в телефоне круглые сутки, кто-то заходит раз в час, кто-то только вечером. |
| 😴 | **Sleep**         | Ночью спит — можно разбудить через `:wake`, но без команды шанс ответа низкий. |
| 📅 | **Daily-life**    | У каждого дня есть расписание: пары, работа, дорога, свободное время. Если на занятиях — телефон недоступен. |
| ❤️ | **Relationship**  | Пять счётчиков: интерес, доверие, симпатия, раздражение, толер.кринжа. Меняются от каждого диалога. |
| 📈 | **Stages**        | 9 стадий сближения: «дала тг, но холодная» → «давно вместе». Стадия влияет на тепло, флирт, длину ответов. |
| ⚠️ | **Conflict**      | Если давить, спамить или нарушать границы — включается конфликт. Может замолчать на часы или дни. |
| 🧠 | **Memory**        | Важные события пишутся в `long-term.md` и всплывают в будущих диалогах. |
| 🚫 | **Anti-AI**       | Промпт запрещает markdown, «конечно», «я понимаю», эмодзи-ряды, вопросы в конце и всё что палит ChatGPT. |
| 👤 | **Userbot mode**  | Настоящий Telegram-аккаунт через MTProto. Умеет читать, ставить реакции, печатать, удалять и редактировать. Выглядит как живой человек. |
| 🗓 | **Agenda**        | Бот сам планирует проактивные сообщения: пожелать удачи на собес, спросить как прошла встреча, поздравить с днём рождения. |

[Подробный разбор каждого слоя →](https://docs.girl-agent.com/docs/developers/architecture)

---

## Почему не просто GPTs или промпт

Вариантов сделать «девушку в Telegram» несколько — от костыльных до полноценных. Разберём что есть и где дыры.

<details>
<summary><strong>ChatGPT GPTs</strong> — кастомный бот внутри ChatGPT с system prompt</summary>

- Нет памяти между сессиями — каждая начинается с нуля
- Нет Telegram — только веб-интерфейс
- Нет реакций, печати, редактирования
- Бот всегда «онлайн» — нет расписания или сна
- Память ограничена контекстным окном

**Итог:** чат-бот с кастомным промптом, без состояния и реалистичного поведения.

</details>

<details>
<summary><strong>OpenClaw + prompt</strong> — фреймворк для AI-ассистентов с личностью в markdown</summary>

Личность через `SOUL.md`, `IDENTITY.md`, `USER.md`. Telegram-bridge через GramJS (MTProto).

- Нет реализм-модулей: presence, sleep, conflict, daily-life, relationship stages
- Нет agenda — бот не планирует действия
- Память = история сообщений, нет long-term storage
- Нет relationship score и conflict system

**Итог:** хороший bridge для Telegram, но не персонаж-движок. Поведение = промпт + история.

</details>

<details>
<summary><strong>HeatherBot</strong> — локальный userbot, persona в YAML, 4-слойная память</summary>

~10K строк Python, MTProto via Telethon, 17 NSFW-overlays.

- Слишком специфично под NSFW
- Сложно настроить — нужны llama-server, Ollama, ComfyUI
- Требует мощного GPU — 12B модель локально
- Нет presence/sleep/conflict как отдельных модулей

**Итог:** мощное, но узкое решение под NSFW с тяжёлой инфраструктурой.

</details>

<details>
<summary><strong>Character.AI</strong> — закрытый сервис для AI-переписки</summary>

- Нет Telegram — только веб-интерфейс
- Нет контроля — всё на их серверах
- Память сбрасывается между сессиями
- Persona обрезается при росте истории

**Итог:** закрытый сервис с ограниченной памятью и без Telegram.

</details>

<details open>
<summary><strong>girl-agent</strong> — движок с несколькими слоями состояния</summary>

- **Presence** — паттерны присутствия (частота, офлайн, вероятность ответа)
- **Sleep** — время сна, night wake chance
- **Daily-life** — расписание, занятость, приоритеты
- **Relationship stages** — `met-irl-got-tg` → `convinced` → `dating-stable` → `long-term`
- **Relationship score** — интерес, доверие, симпатия, раздражение, толер.кринжа
- **Conflict** — если давить/спамить, включается конфликт, может замолчать
- **Memory** — важные события в `long-term.md`, всплывают в диалогах
- **Anti-AI** — промпт запрещает markdown, «конечно», «я понимаю», эмодзи-ряды
- **Userbot mode** — умеет читать, реагировать, печатать, удалять, редактировать
- **Agenda** — бот планирует действия, живёт своей жизнью

**Итог:** поведение собирается из состояния, а не из текстовых инструкций.

</details>

---

## Безопасность

> ⚠️ **Не публикуй:** `data/`, `config.json`, `sessionString`, API-ключи.
>
> 🔒 **Для userbot-режима** используй отдельный тестовый аккаунт — Telegram может забанить основной за подозрительную активность.

Подробнее: [Security & Privacy →](https://docs.girl-agent.com/docs/users/security-privacy)

---

## Лицензия

📄 **Source-available** — исходный код открыт для личного тестирования, оценки и вкладов.

| Разрешено | Запрещено без письменного разрешения |
|-----------|--------------------------------------|
| ✅ Клонировать и запускать локально | ❌ Коммерческое использование |
| ✅ Создавать issues и PR-ы | ❌ Платный хостинг |
| ✅ Изучать код и экспериментировать | ❌ Перепродажа |
| | ❌ Публичные конкурирующие клоны |
| | ❌ Использование кода в коммерческих продуктах |

📜 Полный текст: [LICENSE](./LICENSE).
