# Создание аддонов для girl-agent

## Обзор

Аддон — это папка с файлами, которые модифицируют поведение girl-agent: файлы персоны, настройки конфига, CSS-темы, скрипты и т.д.

Готовый аддон упаковывается в `.gaa` файл (zip-архив) для распространения.

## Быстрый старт

```bash
# 1. Создать шаблон аддона
npx girl-agent addon init my-addon

# 2. Отредактировать файлы (см. ниже)

# 3. Упаковать в .gaa
npx girl-agent addon pack my-addon
# → my-addon.gaa
```

## Структура папки аддона

```
my-addon/
  manifest.json       # Метаданные (обязательно)
  files/              # Файлы для копирования в data/<slug>/
    persona.md        # Персона
    speech.md         # Стиль речи
    boundaries.md     # Границы
    communication.md  # Стиль общения
    ...               # Любые другие файлы
  config.patch.json   # Поля для мёрджа в config.json профиля
  code.patch          # git diff патч для исходного кода girl-agent
  theme.css           # CSS-стили для WebUI
  install.sh          # Скрипт пост-установки (опционально)
  README.md           # Документация (опционально)
```

Все файлы кроме `manifest.json` опциональны — добавляй только то, что нужно.

## manifest.json

```json
{
  "id": "my-addon",
  "name": "Название аддона",
  "description": "Что делает аддон",
  "version": "1.0.0",
  "author": "username",
  "compatibility": ">=0.1.15",
  "tags": ["persona", "mod"],
  "dependencies": [],
  "settings": [],
  "icon": "https://...",
  "homepage": "https://..."
}
```

### Обязательные поля

| Поле          | Тип      | Описание                          |
|---------------|----------|-----------------------------------|
| `id`          | `string` | Уникальный ID (латиница, дефисы)  |
| `name`        | `string` | Человекочитаемое название         |
| `description` | `string` | Описание                          |
| `version`     | `string` | Версия (semver)                   |

### Опциональные поля

| Поле            | Тип        | Описание                              |
|-----------------|------------|---------------------------------------|
| `author`        | `string`   | Автор                                 |
| `compatibility` | `string`   | semver range совместимости girl-agent  |
| `tags`          | `string[]` | Теги для поиска                       |
| `dependencies`  | `string[]` | ID других аддонов                     |
| `settings`      | `array`    | Пользовательские настройки (см. ниже) |
| `icon`          | `string`   | URL иконки                            |
| `homepage`      | `string`   | Ссылка на документацию                |

## files/ — Файлы профиля

Все файлы из `files/` копируются в `data/<slug>/` при установке. Используй для:

- **persona.md** — описание персоны
- **speech.md** — стиль речи, словечки, привычки
- **boundaries.md** — границы поведения
- **communication.md** — стиль коммуникации
- Любые другие `.md` файлы для памяти/промптов

### Пример: files/persona.md

```markdown
Цундере. Притворяется холодной но внутри тёплая.
Любит аниме, мангу, визуальные новеллы.
Зимой пьёт какао, летом гуляет в парке.
Раздражается когда её называют милой.
```

### Пример: files/speech.md

```markdown
Короткие резкие фразы. Часто «хмф», «ну и что», «не подумай чего».
После грубости иногда смягчается. Не использует эмодзи.
```

## config.patch.json — Настройки конфига

JSON-объект с полями для глубокого мёрджа в `config.json` профиля. Перезаписывает совпадающие поля, остальные оставляет.

### Пример: мод расписания

```json
{
  "sleepFrom": 6,
  "sleepTo": 14,
  "nightWakeChance": 0.6
}
```

### Пример: мод поведения

```json
{
  "ignoreTendency": 10,
  "communication": {
    "initiative": "high",
    "notifications": "frequent"
  }
}
```

### Доступные поля config.json

Все поля описаны в `src/types.ts` → `ProfileConfig`. Основные:
- `sleepFrom`, `sleepTo` — часы сна (0–23)
- `nightWakeChance` — шанс проснуться ночью (0–1)
- `ignoreTendency` — склонность к игнору (0–100)
- `communication` — стиль общения (`notifications`, `messageStyle`, `initiative`, `lifeSharing`)

## code.patch — Патч исходного кода

Файл `code.patch` — стандартный `git diff` патч. При установке аддона применяется через `git apply` к корню проекта girl-agent. Используй для фикса багов или модификации внутренней логики.

### Как создать code.patch

1. Склонируй или открой girl-agent
2. Внеси нужные изменения в исходный код
3. Создай патч:

```bash
git diff > code.patch
```

Или для конкретного файла:

```bash
git diff src/engine/runtime.ts > code.patch
```

### Пример: фикс бага в runtime.ts

Допустим, нужно изменить минимальную задержку ответа. Вносишь изменение, делаешь `git diff`:

```diff
diff --git a/src/engine/runtime.ts b/src/engine/runtime.ts
index abc1234..def5678 100644
--- a/src/engine/runtime.ts
+++ b/src/engine/runtime.ts
@@ -150,7 +150,7 @@ export class Runtime {
   private async scheduleReply(delay: number) {
-    const minDelay = 2000;
+    const minDelay = 500;
     const actual = Math.max(delay, minDelay);
```

Структура аддона:

```
fix-fast-reply/
  manifest.json
  code.patch
  README.md
```

**manifest.json:**
```json
{
  "id": "fix-fast-reply",
  "name": "Быстрые ответы",
  "description": "Уменьшает минимальную задержку ответа с 2с до 0.5с",
  "version": "1.0.0",
  "tags": ["fix", "speed"],
  "compatibility": ">=0.1.15"
}
```

**Важно:**
- Патч применяется через `git apply` — проект должен быть git-репозиторием
- Перед применением проверяется `git apply --check` — если не подходит, патч не применится
- Патч привязан к конкретной версии кода — используй `compatibility` в manifest для указания версий

## theme.css — Тема WebUI

CSS-файл с переопределениями CSS-переменных и/или дополнительными стилями.

### Пример: theme.css

```css
:root {
  --ga-accent: #ff2bd6;
  --ga-accent-2: #00f0ff;
  --ga-bg: #0a0014;
  --ga-bg-glass: rgba(20, 0, 40, 0.55);
  --ga-text: #ffe2ff;
  --ga-border: rgba(255, 43, 214, 0.35);
}

.sidebar {
  border-right: 2px solid #ff2bd6;
}
```

### Доступные CSS-переменные

- `--ga-accent` — основной цвет акцента
- `--ga-accent-2` — вторичный акцент
- `--ga-bg` — фон приложения
- `--ga-bg-glass` — фон карточек (с прозрачностью)
- `--ga-text` — основной цвет текста
- `--ga-text-dim` — приглушённый текст
- `--ga-border` — цвет рамок
- `--ga-border-strong` — сильные рамки

## Настройки (settings)

Аддон может определить пользовательские настройки через поле `settings` в `manifest.json`. Пользователь видит и редактирует их в WebUI → «Установленные» → «Настройки».

### Структура

```json
{
  "settings": [
    {
      "key": "sleepFrom",
      "label": "Засыпает в",
      "hint": "Час (0–23)",
      "type": "number",
      "default": 6,
      "required": true
    },
    {
      "key": "mode",
      "label": "Режим",
      "type": "select",
      "default": "normal",
      "options": [
        { "value": "normal", "label": "Обычный" },
        { "value": "turbo", "label": "Турбо" }
      ]
    },
    {
      "key": "enabled",
      "label": "Включить фичу",
      "type": "boolean",
      "default": false
    }
  ]
}
```

### Типы полей

| Тип       | UI-элемент          | Значение              |
|-----------|---------------------|-----------------------|
| `string`  | Текстовое поле      | `string`              |
| `number`  | Числовое поле       | `number`              |
| `boolean` | Тогл (переключатель)| `true` / `false`      |
| `select`  | Выпадающий список   | Одно из `options.value` |

## Формат .gaa

`.gaa` файл — это стандартный **zip-архив** с содержимым папки аддона. Расширение `.gaa` = **G**irl **A**gent **A**ddon.

### Создание .gaa

**CLI (рекомендуется):**
```bash
npx girl-agent addon pack my-addon
# → my-addon.gaa

npx girl-agent addon pack my-addon custom-name.gaa
# → custom-name.gaa
```

**Вручную (Linux/macOS):**
```bash
cd my-addon
zip -r ../my-addon.gaa .
```

**Вручную (PowerShell/Windows):**
```powershell
Compress-Archive -Path my-addon\* -DestinationPath my-addon.gaa
```

### Распаковка .gaa

```bash
unzip my-addon.gaa -d my-addon/
```

## Установка аддонов

### Через WebUI

1. Вкладка «Addons» → «Маркетплейс»
2. Из реестра: найти и нажать «Установить»
3. Из URL: вставить ссылку на `.gaa` или `manifest.json` → «Из URL»
4. Из файла: нажать «Из .gaa файла» → выбрать файл

### Через API

```bash
# Установка из реестра
curl -X POST http://localhost:3000/api/addons/my-addon/install \
  -H "Content-Type: application/json" \
  -d '{"profileSlug": "alina"}'

# Установка из URL
curl -X POST http://localhost:3000/api/addons/install-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/my-addon.gaa", "profileSlug": "alina"}'

# Обновление настроек
curl -X PUT http://localhost:3000/api/addons/my-addon/settings \
  -H "Content-Type: application/json" \
  -d '{"values": {"sleepFrom": 4, "sleepTo": 12}}'
```

## Публикация в реестр

1. Создай `.gaa` файл
2. Выложи `.gaa` на хостинг (GitHub Releases, свой сервер и т.д.)
3. Открой PR в [TheSashaDev/girl-agent-addons](https://github.com/TheSashaDev/girl-agent-addons)
4. Добавь в `index.json` → массив `addons` запись с `downloadUrl`:

```json
{
  "addons": [
    {
      "id": "my-addon",
      "name": "Мой аддон",
      "description": "Описание",
      "version": "1.0.0",
      "author": "username",
      "tags": ["mod"],
      "downloadUrl": "https://github.com/.../releases/download/v1.0.0/my-addon.gaa"
    }
  ]
}
```

## Хранение

- Установленные аддоны: `~/.local/share/girl-agent/addons/<id>/`
- Индекс: `~/.local/share/girl-agent/addons/installed.json`
- Или `$GIRL_AGENT_DATA/../addons/`

## Полный пример: персона-аддон

```
persona-tsundere/
  manifest.json
  files/
    persona.md
    speech.md
    boundaries.md
  config.patch.json
  README.md
```

**manifest.json:**
```json
{
  "id": "persona-tsundere",
  "name": "Аниме-цундере",
  "description": "Готовая персона: цундере с резкими переходами от грубости к нежности.",
  "version": "1.0.0",
  "author": "girl-agent",
  "tags": ["persona", "anime"]
}
```

**files/persona.md:**
```markdown
Цундере, 22 года. Притворяется холодной но внутри тёплая.
Любит аниме, мангу, визуальные новеллы.
Раздражается когда её называют милой.
```

**files/speech.md:**
```markdown
Короткие резкие фразы. Часто «хмф», «ну и что», «не подумай чего».
После грубости иногда смягчается.
```

**files/boundaries.md:**
```markdown
Не флиртует напрямую. Никогда не признаётся первой.
Если давить — уходит на сутки.
```

**config.patch.json:**
```json
{
  "ignoreTendency": 55,
  "communication": {
    "messageStyle": "one-liners",
    "initiative": "low"
  }
}
```

**Упаковка и установка:**
```bash
npx girl-agent addon pack persona-tsundere
# → persona-tsundere.gaa
# Далее через WebUI: «Из .gaa файла» → выбрать persona-tsundere.gaa
```
