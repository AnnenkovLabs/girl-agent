# Git push rules

Правила красивого пуша кода в этот форк. Применяются всегда.

## Ветки

- Никогда не пушить напрямую в `master`. Только через PR.
- Имя ветки: `<type>/<short-kebab>`, где `<type>` ∈ `feat`, `fix`, `chore`, `refactor`, `docs`, `ci`, `style`, `test`, `perf`.
  - Пример: `feat/manager-mode-wizard`, `fix/escalation-timeout-race`, `chore/rename-to-manager-agent`.
- Длина имени ветки ≤ 50 символов.
- Одна ветка = одна логическая задача. Несвязанные изменения — отдельные ветки.

## Коммиты

- Conventional Commits: `<type>(<scope>): <subject>`.
  - `<type>`: `feat`, `fix`, `chore`, `refactor`, `docs`, `ci`, `style`, `test`, `perf`, `build`.
  - `<scope>` опционально, в kebab-case: `engine`, `webui`, `telegram`, `storage`, `cli`, `docs`, `ci`.
  - `<subject>`: повелительное наклонение, без точки в конце, ≤ 70 символов.
- Тело коммита (опционально): пустая строка после subject, далее причина и контекст. Перенос строк на ~72 символа.
- Footer для ссылок на issue: `Refs #123`, `Closes #123`. Для breaking change — `BREAKING CHANGE: ...`.
- Один коммит = одно атомарное изменение, которое проходит build и typecheck отдельно.
- Язык коммита: английский (для consistency с conventional commits и инструментами).
- Сообщения PR / описания issue / inline-комментарии в коде остаются на русском, как в оригинале.

### Примеры
- `feat(engine): add Boss_Reply_Parser with #T-N and @username modes`
- `fix(escalation): prevent duplicate ticket on rapid successive messages`
- `chore(rebrand): rename package to @thesashadev/manager-agent`
- `refactor(presence): drop sleep-girl wake logic, keep work-hours only`

## Что НЕ коммитить

Перед каждым `git add` проверять, что не попадает в коммит:

- `data/` — персональные профили, конфиги, сессии, ключи. Уже в `.gitignore`.
- `.env`, `.env.*`, `*.env` — секреты.
- `dist/` — артефакты сборки.
- `node_modules/`, `webui/node_modules/`.
- Любые файлы с реальными `botToken`, `apiId`, `apiHash`, `sessionString`, `apiKey`.
- Артефакты IDE: `.vscode/launch.json` с локальными путями, дампы, скриншоты с PII.

Перед пушем: `git diff --staged` глазами, ищем `token`, `key`, `secret`, `pat`, `bearer`, числа похожие на phone/api-id.

## Pre-push checklist

Прогнать **перед** каждым пушем:

1. `npm run typecheck` — нулевые ошибки. Если падает — НЕ пушить.
2. `npm run build` — собирается. Если падает — НЕ пушить.
3. `git status` — нет случайно затащенных файлов.
4. `git log <branch>..HEAD --oneline` — каждое сообщение читаемое, нет `wip`, `fix`, `asdf`, `tmp`.
5. Обновлён `CHANGELOG.md` под нужной секцией (Unreleased → Added/Changed/Fixed).
6. Если меняется публичное API / поведение — затронут `README.md` или `docs/`.
7. Версия в `package.json` НЕ повышается в feature-PR (это делает релизный коммит отдельно).

## Pull request

- Заголовок: тот же формат, что и коммит — `<type>(<scope>): <subject>`, ≤ 70 символов.
- Описание (на русском, шаблон):

  ```
  ## Что
  Кратко: что меняется и зачем.

  ## Как тестировать
  Шаги воспроизведения / запуск нужного сценария.

  ## Затронутое
  - Файлы / модули, важные для ревью
  - Спецификация: `.kiro/specs/<feature>/...` (если применимо)

  ## Чек
  - [ ] `npm run typecheck` зелёный
  - [ ] `npm run build` зелёный
  - [ ] `CHANGELOG.md` обновлён
  - [ ] Нет секретов в diff
  - [ ] README/docs обновлены при изменении публичного поведения
  ```

- Ссылка на спек или issue в теле PR обязательна, если PR реализует спек-требование.
- Размер PR: целевой ≤ 400 строк изменённого кода (без учёта lock-файлов и сгенерированного кода). Больше — разбивать.
- Один PR = одна тема. Если внутри ветки накопились разнородные коммиты — разнести по веткам и сделать несколько PR.

## Мерж PR

После того как PR прошёл pre-push checklist и владелец явно одобрил — агент мерджит PR сам через github MCP (`mcp_github_merge_pull_request`), не оставляя его висеть в ожидании ручного merge. После мерджа:

1. Локально переключиться на `master` и подтянуть `git pull --ff-only origin master`.
2. Удалить ветку локально: `git branch -d <branch>`.
3. Удалить ветку на origin: `git push origin --delete <branch>`.
4. Подтвердить владельцу: ссылка на merged PR + что master синхронизирован.

Метод merge по умолчанию — `squash`, чтобы история master была чистой (один коммит на тему = один коммит в master). Override (`merge` или `rebase`) — только по явной просьбе владельца.

Если в PR требуются правки — дописать коммитами в ту же ветку и снова запросить одобрение, не открывать новый PR.

## Force-push и rebase

- Force-push разрешён ТОЛЬКО на свою feature-ветку и ТОЛЬКО через `git push --force-with-lease`. Никогда — на `master` или ветку, на которую кто-то ссылается в открытом PR без явного согласия ревьюера.
- Rebase на `master` перед PR — разрешён и приветствуется. Merge-коммитов в feature-ветке избегать.
- `git reset --hard`, `git push --force` (без `with-lease`), `git clean -fdx` — только с явным подтверждением.

## Sign-off и attribution

- Поскольку проект — форк `TheSashaDev/girl-agent`, в первом коммите ребренда явно указать в теле:

  ```
  This is a fork of TheSashaDev/girl-agent.
  All rights to the original code remain with the original author.
  See LICENSE for terms.
  ```

- Не переписывать историю commits оригинала. Не править authorship чужих коммитов.

## Релизы и теги

- Тег формата `v<major>.<minor>.<patch>` (например `v0.5.0`).
- Тег создаётся ТОЛЬКО на коммите, в котором поднята версия в `package.json` и обновлён `CHANGELOG.md`.
- Релизный коммит: `chore(release): vX.Y.Z`.
- Не таскать теги между ветками.

## CI guard

- CI должен прогонять `npm run typecheck` и `npm run build` на каждом push.
- Если CI красный — ветка не мерджится, даже после approve. Сначала чинить.
