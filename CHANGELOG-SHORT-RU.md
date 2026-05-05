# Girl-Agent — короткий changelog патчей

## Runtime / Docker
- fix(runtime): добавлен headless-режим запуска без Ink/TUI в non-TTY Docker
- fix(deploy): контейнер `girl-agent` стабилизирован для запуска на Synology через Docker Compose

## Telegram / Group Mode
- feat(group): добавлен guarded group mode с явным `group.enabled`
- feat(group): добавлены `allowedChatIds`, `allowedUserIds`, `replyMode`, `triggers`, `ownerAlwaysAllowed`
- fix(group): логика переведена в fail-closed — без `allowedChatIds` бот в группах молчит
- fix(group): найден и прописан реальный group chat id `-1001753111999`
- fix(group): добавлен второй разрешённый user id `1782147496`
- fix(group): исправлен `ownerId` на реальный `421685445`

## Telegram Topics
- feat(telegram): добавлена поддержка `message_thread_id`
- fix(telegram): history key теперь учитывает `chatId:threadId`
- fix(telegram): ответы отправляются обратно в тот же topic/thread

## Reply Logic
- fix(behavior): owner mention/reply в разрешённой группе больше не режется ночным `asleep`
- fix(behavior): для owner/group mention добавлен forced reply bypass

## LLM / OmniRoute
- fix(llm): заменён невалидный OmniRoute API key на рабочий client key
- fix(llm): добавлена совместимость с SSE/event-stream ответами OmniRoute
- fix(llm): устранён silent fallback из-за несовместимого OpenAI-compatible ответа

## Deployment Artifacts
- feat(deploy): добавлены `deploy/synology/Dockerfile`
- feat(deploy): добавлены `deploy/synology/docker-compose.yml`
- feat(config): добавлен `examples/group-config.example.json`

## Ops / Docs
- docs(runbook): написано полное руководство по установке и эксплуатации на Synology NAS
- ops(backup): создан backup рабочего состояния `repo-20260506-012633.tgz`
