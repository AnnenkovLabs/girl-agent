# Создание аддонов для girl-agent

## Обзор

Аддоны — модульные расширения girl-agent. Каждый аддон — JSON-файл (манифест) описывающий что он делает и какие данные несёт.

## Типы аддонов

| Тип      | Описание                                                  |
|----------|-----------------------------------------------------------|
| `fix`    | Патч для фикса конкретного бага                           |
| `mod`    | Модификация поведения (расписание, параметры)              |
| `persona`| Готовая персона: файлы persona.md, speech.md и т.д.       |
| `mcp`    | MCP-сервер с конфигурацией                                |
| `theme`  | CSS-тема для WebUI                                        |
| `locale` | Перевод интерфейса WebUI                                  |

## Структура манифеста

```jsonc
{
  // === Обязательные поля ===
  "type": "mod",                    // Тип аддона (см. таблицу)
  "id": "mod-my-addon",             // Уникальный ID (латиница, дефисы)
  "name": "Название аддона",        // Человекочитаемое имя
  "description": "Описание",        // Что делает аддон
  "version": "1.0.0",               // Версия (semver)

  // === Опциональные мета-поля ===
  "author": "username",             // Автор
  "compatibility": ">=0.1.15",      // Совместимая версия girl-agent (semver range)
  "tags": ["mod", "schedule"],      // Теги для поиска в маркетплейсе
  "dependencies": ["other-addon"],  // ID других аддонов-зависимостей
  "icon": "https://...",            // URL иконки
  "homepage": "https://...",        // Ссылка на документацию

  // === Данные аддона (зависит от type) ===
  // Подробности ниже
}
```

## Поля по типам

### `persona` — готовая персона

```jsonc
{
  "type": "persona",
  "id": "persona-anime-tsundere",
  "name": "Аниме-цундере",
  "description": "Цундере из аниме.",
  "version": "1.0.0",
  // Файлы кладутся в data/<slug>/
  "files": [
    { "path": "persona.md", "content": "Цундере. Притворяется холодной..." },
    { "path": "speech.md", "content": "Короткие резкие фразы..." },
    { "path": "boundaries.md", "content": "Не флиртует напрямую..." }
  ],
  // Переопределения config.json профиля
  "configOverrides": {
    "ignoreTendency": 55,
    "communication": {
      "messageStyle": "one-liners",
      "initiative": "low",
      "lifeSharing": "low",
      "notifications": "muted"
    }
  }
}
```

### `mod` — модификация поведения

```jsonc
{
  "type": "mod",
  "id": "mod-night-owl",
  "name": "Night Owl",
  "description": "Активна ночью, спит днём.",
  "version": "1.0.0",
  "configOverrides": {
    "sleepFrom": 6,
    "sleepTo": 14,
    "nightWakeChance": 0.6
  },
  // Пользовательские настройки (см. раздел ниже)
  "settings": [
    { "key": "sleepFrom", "label": "Засыпает в", "type": "number", "default": 6 },
    { "key": "sleepTo", "label": "Просыпается в", "type": "number", "default": 14 }
  ]
}
```

### `theme` — тема WebUI

```jsonc
{
  "type": "theme",
  "id": "theme-cyberpunk",
  "name": "Cyberpunk",
  "description": "Неоново-розовая тема.",
  "version": "1.0.0",
  "theme": {
    // CSS-переменные (переопределяют дефолтные)
    "vars": {
      "--ga-accent": "#ff2bd6",
      "--ga-accent-2": "#00f0ff",
      "--ga-bg": "#0a0014",
      "--ga-bg-glass": "rgba(20, 0, 40, 0.55)",
      "--ga-text": "#ffe2ff",
      "--ga-border": "rgba(255, 43, 214, 0.35)"
    },
    // Дополнительный CSS (опционально)
    "css": ".sidebar { border-right: 2px solid #ff2bd6; }"
  }
}
```

**Доступные CSS-переменные:**
- `--ga-accent` — основной цвет акцента
- `--ga-accent-2` — вторичный акцент
- `--ga-bg` — фон приложения
- `--ga-bg-glass` — фон карточек (с прозрачностью)
- `--ga-text` — основной цвет текста
- `--ga-border` — цвет рамок

### `mcp` — MCP-сервер

```jsonc
{
  "type": "mcp",
  "id": "mcp-exa-search",
  "name": "Exa Web Search",
  "description": "Поиск в интернете через Exa.",
  "version": "1.0.0",
  "mcp": {
    "presetId": "exa",           // ID пресета из presets/mcp.ts
    "secrets": [                 // Секреты которые нужно запросить у пользователя
      { "key": "EXA_API_KEY", "label": "API-ключ Exa" }
    ]
  }
}
```

### `locale` — перевод UI

```jsonc
{
  "type": "locale",
  "id": "locale-en",
  "name": "English (UI)",
  "description": "Английский перевод WebUI.",
  "version": "1.0.0",
  "locale": {
    "lang": "en",
    "strings": {
      "tab.assistant": "Assistant",
      "tab.logs": "Logs",
      "tab.addons": "Addons",
      "tab.config": "Configuration",
      "apply": "Apply"
    }
  }
}
```

### `fix` — патч

```jsonc
{
  "type": "fix",
  "id": "fix-markdown-escape",
  "name": "Markdown escape fix",
  "description": "Фикс спецсимволов в MarkdownV2.",
  "version": "1.0.0",
  "compatibility": "<=0.1.16",   // Для каких версий актуален
  "patch": "diff --git a/..."    // git diff patch (опционально)
}
```

## Встроенные настройки (settings)

Любой аддон может определить пользовательские настройки через поле `settings`. Пользователь видит и редактирует их в WebUI на вкладке «Установленные» → кнопка «Настройки».

### Структура поля settings

```jsonc
{
  "settings": [
    {
      "key": "myParam",           // Уникальный ключ (латиница, без пробелов)
      "label": "Мой параметр",    // Название в UI
      "hint": "Подсказка",        // Описание (показывается мелким текстом)
      "type": "string",           // Тип: "string" | "number" | "boolean" | "select"
      "default": "hello",         // Значение по умолчанию
      "required": true            // Обязательное ли поле
    },
    {
      "key": "mode",
      "label": "Режим",
      "type": "select",
      "default": "normal",
      "options": [                 // Варианты для type=select
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

| Тип       | UI-элемент          | Значение            |
|-----------|---------------------|---------------------|
| `string`  | Текстовое поле      | `string`            |
| `number`  | Числовое поле       | `number`            |
| `boolean` | Тогл (переключатель)| `true` / `false`    |
| `select`  | Выпадающий список   | Одно из `options[].value` |

## Установка аддонов

### Через маркетплейс WebUI

1. Открой WebUI → вкладка «Addons» → «Маркетплейс»
2. Найди аддон по названию или тегу
3. Нажми «Установить»
4. Если есть конфликты — подтверди установку

### Из URL

1. Открой WebUI → вкладка «Addons» → «Маркетплейс»
2. Вставь URL manifest.json в поле
3. Нажми «Установить из URL»

### Программно (API)

```bash
# Установка из реестра
curl -X POST http://localhost:3000/api/addons/mod-night-owl/install \
  -H "Content-Type: application/json" \
  -d '{"profileSlug": "alina"}'

# Установка из URL
curl -X POST http://localhost:3000/api/addons/install-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/manifest.json", "profileSlug": "alina"}'

# Обновление настроек
curl -X PUT http://localhost:3000/api/addons/mod-night-owl/settings \
  -H "Content-Type: application/json" \
  -d '{"values": {"sleepFrom": 4, "sleepTo": 12}}'
```

## Публикация в реестр

Чтобы аддон появился в маркетплейсе:

1. Создай JSON-файл манифеста
2. Открой PR в [TheSashaDev/girl-agent-addons](https://github.com/TheSashaDev/girl-agent-addons)
3. Добавь свой манифест в `index.json` → массив `addons`
4. После мёрджа аддон появится у всех пользователей

### Формат index.json

```json
{
  "addons": [
    { "type": "mod", "id": "...", "name": "...", ... },
    { "type": "theme", "id": "...", "name": "...", ... }
  ]
}
```

## Хранение

Установленные аддоны хранятся в:
- `~/.local/share/girl-agent/addons/installed.json`
- Или `$GIRL_AGENT_DATA/../addons/installed.json`

Файлы персон копируются в `data/<slug>/` при установке.

## Полный пример: мод с настройками

```json
{
  "type": "mod",
  "id": "mod-clingy-mode",
  "name": "Прилипчивый режим",
  "description": "Девушка пишет чаще и не любит когда её игнорят.",
  "version": "1.0.0",
  "author": "community",
  "tags": ["mod", "behavior", "clingy"],
  "configOverrides": {
    "ignoreTendency": 10,
    "communication": {
      "initiative": "high",
      "notifications": "frequent"
    }
  },
  "settings": [
    {
      "key": "ignoreTendency",
      "label": "Тенденция игнора",
      "hint": "Чем ниже — тем реже игнорит (0-100)",
      "type": "number",
      "default": 10
    },
    {
      "key": "initiative",
      "label": "Инициативность",
      "type": "select",
      "default": "high",
      "options": [
        { "value": "low", "label": "Низкая" },
        { "value": "medium", "label": "Средняя" },
        { "value": "high", "label": "Высокая" }
      ]
    }
  ]
}
```
