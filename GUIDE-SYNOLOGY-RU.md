# Girl-Agent на Synology NAS — установка, настройка и эксплуатация

## 1. Архитектура

Схема работы:

- **Synology NAS** хранит репозиторий и запускает контейнер `girl-agent`
- **Telegram Bot API** доставляет входящие сообщения боту
- **OmniRoute** на NAS отдаёт LLM-ответы по OpenAI-compatible API
- **girl-agent** хранит профиль, память и логи в `data/girl/`

Ключевые пути на NAS:

- Репозиторий: `/volume1/docker/girl-agent/repo`
- Бэкапы: `/volume1/docker/girl-agent/backups/`
- Логи профиля: `/volume1/docker/girl-agent/repo/data/girl/log/`
- Конфиг профиля: `/volume1/docker/girl-agent/repo/data/girl/config.json`
- OmniRoute API: `http://192.168.31.166:20128/v1`

---

## 2. Что уже реализовано в этом проекте

В текущем рабочем состоянии сделано:

- headless-запуск в Docker без Ink/TUI crash
- guarded group mode
- fail-closed для групп: без `allowedChatIds` бот в группах молчит
- allowlist по `allowedUserIds`
- поддержка Telegram forum topics через `message_thread_id`
- forced reply для owner mention/reply в разрешённой группе
- работа через OmniRoute

Актуальные боевые значения:

- bot username: `@kolibryxyz_bot`
- owner id: `421685445`
- дополнительный разрешённый user id: `1782147496`
- group id: `-1001753111999`
- рабочий topic/thread id в тесте: `3066`

---

## 3. Предварительные требования

На Synology должно быть:

1. Установлен **Container Manager / Docker Compose v2**
2. Доступен git
3. Работает OmniRoute
4. Есть Telegram bot token
5. Есть доступ по SSH

Подключение к NAS:

```bash
ssh -i /home/node/.openclaw/workspace/id_ed25519_nas -p 29 -o StrictHostKeyChecking=no root@192.168.31.166
```

---

## 4. Бэкап перед изменениями

Перед любыми изменениями репозитория на NAS:

```bash
BASE=/volume1/docker/girl-agent
BACK=$BASE/backups
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACK"
tar -czf "$BACK/repo-$TS.tgz" -C "$BASE" repo
ls -lh "$BACK/repo-$TS.tgz"
```

Пояснение:
- это сохраняет текущий рабочий снимок проекта
- откат делается распаковкой архива обратно в `repo`

---

## 5. Чистая установка проекта на NAS

### 5.1. Клонировать репозиторий

```bash
mkdir -p /volume1/docker/girl-agent
cd /volume1/docker/girl-agent
git clone https://github.com/TheSashaDev/girl-agent.git repo
```

Если репозиторий уже есть:

```bash
cd /volume1/docker/girl-agent/repo
git status
git pull --ff-only
```

---

## 6. Docker-файлы для Synology

### 6.1. `deploy/synology/Dockerfile`

Используется multi-stage build, который:
- собирает TypeScript
- кладёт `dist/`
- кладёт `data/`
- запускает headless runtime в контейнере

### 6.2. `deploy/synology/docker-compose.yml`

Рабочая схема:

```yaml
services:
  girl-agent:
    build:
      context: ../..
      dockerfile: deploy/synology/Dockerfile
    container_name: girl-agent
    restart: unless-stopped
    environment:
      - TZ=UTC
    volumes:
      - ../../data:/app/data
    command: ["node", "dist/cli.js", "--profile=girl"]
```

Пояснение:
- `../../data:/app/data` сохраняет профиль и логи вне контейнера
- `restart: unless-stopped` поднимает сервис после рестарта NAS

---

## 7. Конфиг профиля

Основной файл:

```bash
/volume1/docker/girl-agent/repo/data/girl/config.json
```

Ключевые поля:

```json
{
  "slug": "girl",
  "mode": "bot",
  "ownerId": 421685445,
  "llm": {
    "presetId": "custom-openai",
    "proto": "openai",
    "baseURL": "http://192.168.31.166:20128/v1",
    "apiKey": "<WORKING_OMNIROUTE_KEY>",
    "model": "gemini/gemini-2.5-flash"
  },
  "telegram": {
    "botToken": "<BOT_TOKEN>"
  },
  "group": {
    "enabled": true,
    "allowedChatIds": [-1001753111999, 1753111999],
    "allowedUserIds": [421685445, 1782147496],
    "replyMode": "owner-or-mentions",
    "triggers": ["kolibry", "колибри", "@kolibryxyz_bot"],
    "ownerAlwaysAllowed": true
  }
}
```

Пояснение по group policy:

- `enabled=true` — разрешить работу в группах
- `allowedChatIds` — список конкретных разрешённых групп
- `allowedUserIds` — кто может с ней говорить в группе
- `replyMode=owner-or-mentions` — отвечает owner'у или когда её явно позвали
- `ownerAlwaysAllowed=true` — owner имеет приоритет

---

## 8. Важный нюанс Telegram groups/topics

Для групп с темами нужен учёт:

- `chat id` группы, например `-1001753111999`
- `message_thread_id` темы, например `3066`

Без этого бот может:
- видеть сообщение
- сгенерировать ответ
- но отправить его не туда

В рабочем патче уже реализовано:
- захват `message_thread_id`
- отдельный history key вида `chat:thread`
- отправка ответа обратно в тот же topic

---

## 9. OmniRoute

Проверка моделей:

```bash
curl -s http://127.0.0.1:20128/v1/models
```

Если нужен тест из контейнера:

```bash
docker exec girl-agent node -e 'fetch("http://192.168.31.166:20128/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer <WORKING_OMNIROUTE_KEY>"},body:JSON.stringify({model:"gemini/gemini-2.5-flash",messages:[{role:"user",content:"привет"}],max_tokens:50})}).then(async r=>console.log(await r.text()))'
```

Важно:
- нужен **реальный client API key OmniRoute**, не произвольная строка
- OmniRoute может отдавать ответ как **SSE stream**, это уже учтено в патче LLM-слоя

---

## 10. Сборка и запуск

### 10.1. Локальная сборка на NAS

```bash
cd /volume1/docker/girl-agent/repo
docker compose -f deploy/synology/docker-compose.yml build girl-agent
docker compose -f deploy/synology/docker-compose.yml up -d girl-agent
```

### 10.2. Проверка статуса

```bash
cd /volume1/docker/girl-agent/repo
docker compose -f deploy/synology/docker-compose.yml ps
```

Ожидается:
- контейнер `girl-agent`
- статус `Up`

### 10.3. Проверка логов

```bash
cd /volume1/docker/girl-agent/repo
docker compose -f deploy/synology/docker-compose.yml logs --tail=100 girl-agent
```

Нормальный старт:

```text
runtime started for profile: girl
```

---

## 11. Где смотреть логи поведения

Файл дневного лога:

```bash
/volume1/docker/girl-agent/repo/data/girl/log/YYYY-MM-DD.md
```

Пример просмотра:

```bash
sed -n '1,240p' /volume1/docker/girl-agent/repo/data/girl/log/2026-05-05.md
```

Там видно:
- кто написал
- в какой chat/thread
- ignored ли сообщение
- какой текст отправила она

---

## 12. Типовые проблемы и root cause

### 12.1. Контейнер падает сразу после старта

Симптом:
- `Raw mode is not supported on the current process.stdin`

Причина:
- Ink/TUI стартует внутри non-TTY Docker

Решение:
- запускать runtime в headless-режиме

### 12.2. В личке отвечает, в группе молчит

Проверить по порядку:

1. `group.enabled`
2. `allowedChatIds`
3. `allowedUserIds`
4. mention/reply действительно есть
5. правильный `message_thread_id` для темы
6. не режет ли response logic по sleep/ignore

### 12.3. Видит сообщение, но молчит по ночам

Причина:
- behavior-layer считает, что персонаж спит

Рабочее решение для owner/group mention:
- делать forced reply bypass в разрешённой группе

### 12.4. LLM не отвечает

Проверить:
- рабочий ли OmniRoute key
- доступен ли `baseURL`
- не ломает ли прокси формат ответа

---

## 13. Минимальная процедура диагностики

### 13.1. Проверить контейнер

```bash
cd /volume1/docker/girl-agent/repo
docker compose -f deploy/synology/docker-compose.yml ps
```

### 13.2. Проверить runtime logs

```bash
docker compose -f deploy/synology/docker-compose.yml logs --tail=100 girl-agent
```

### 13.3. Проверить app log

```bash
sed -n '1,260p' /volume1/docker/girl-agent/repo/data/girl/log/$(date +%F).md
```

### 13.4. Проверить конфиг группы

```bash
python3 - <<'PY'
import json
p='/volume1/docker/girl-agent/repo/data/girl/config.json'
with open(p,'r',encoding='utf-8') as f:
    cfg=json.load(f)
print(json.dumps(cfg['group'], ensure_ascii=False, indent=2))
PY
```

---

## 14. Обновление кода после локальных правок

Если патч готов в локальном workspace OpenClaw:

1. изменить файлы локально
2. прогнать build локально
3. передать изменённые файлы на NAS
4. пересобрать контейнер

Локальная проверка:

```bash
cd /home/node/.openclaw/workspace/girl-agent
npm run build
```

Пересборка на NAS:

```bash
cd /volume1/docker/girl-agent/repo
docker compose -f deploy/synology/docker-compose.yml build girl-agent
docker compose -f deploy/synology/docker-compose.yml up -d girl-agent
```

---

## 15. Рекомендуемая эксплуатационная дисциплина

- перед изменениями делать backup архива `repo-*.tgz`
- не менять `config.json` без сохранения рабочего состояния
- не подставлять фейковый OmniRoute key
- проверять group/topic логикой только по фактическим log lines
- при появлении новых Telegram group/thread кейсов сначала смотреть app log, а не гадать

---

## 16. Быстрый чек-лист “бот не отвечает в группе”

1. Контейнер `Up`?
2. В app log есть входящее сообщение из группы?
3. `chat id` совпадает с `allowedChatIds`?
4. `fromId` входит в `allowedUserIds`?
5. Есть `mention` или `replyToSelf`?
6. Есть ли `thread id` и правильно ли он обработан?
7. Не заблокировал ли ответ `asleep / ignore`?
8. Работает ли OmniRoute?

Если первые 4 пункта не сходятся — проблема не в “характере”, а в маршрутизации/гейтинге.

---

## 17. Итог рабочего состояния на момент написания

Сервис работоспособен:
- личка отвечает
- группа отвечает
- Telegram topics учтены
- разрешены два user id
- группа ограничена конкретным chat id
- проект развернут на Synology и запускается через Docker Compose

Бэкап последнего рабочего состояния:

```text
/volume1/docker/girl-agent/backups/repo-20260506-012633.tgz
```
