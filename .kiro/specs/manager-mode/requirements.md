# Requirements Document

## Introduction

Фича `manager-mode` превращает форк `girl-agent` в персонального Telegram-секретаря (далее — `Manager_Agent`), который ведёт входящую переписку от имени одного владельца (`Boss`) и эскалирует ему вопросы вне мандата прямо в Telegram. Движок переиспользует слои реализма оригинала (presence, sleep/work-hours, daily-life, behavior-tick, agenda, memory-palace, typos, online-heartbeat, telegram-адаптеры bot/userbot, LLM-клиент, WebUI), но переосмысливает их под секретарские сценарии: 9 стадий отношений превращаются в 6 контактных уровней (`Tier`), 5 коммуникационных пресетов — в 3 деловых тона, романтические/гормональные слои удаляются полностью, а appearance-приватность заменяется уровнями ворот (`gateLevel`).

Главная новая поведенческая петля — `Escalation_Loop`: внешний клиент задаёт вопрос, не покрытый мандатом; `Manager_Agent` отправляет холдинг-сообщение, открывает тикет, пишет боссу краткое резюме с идентификатором тикета вида `#T-42` и/или упоминанием `@username` клиента, и после ответа босса доносит готовую формулировку клиенту, никогда не раскрывая внутренний контекст. Поверх этого вводятся: проактивные напоминания клиентам (по обещаниям) и периодические дайджесты боссу, политика после рабочих часов (`AfterHoursPolicy`), новые WebUI-страницы (`Contacts`, `Inbox`), ребренд пакета/CLI/портов/путей/env-переменных для одновременной работы рядом с оригинальным `girl-agent`, и обновлённые README/LICENSE с явной атрибуцией форка.

Документ ниже формулирует требования в нотации EARS, со строгим порядком клауз `WHERE → WHILE → WHEN/IF → THE → SHALL`, измеримыми условиями и без жаргона, скрывающего поведение. Отдельный раздел `Property-Based Correctness` фиксирует исполняемые свойства (целостность тикетов, конфиденциальность, монотонность тиров, изоляция от оригинала), которые должны быть проверены на этапе тестирования.

## Glossary

- **Manager_Agent**: ИИ-секретарь, поднятый из форка `girl-agent`, обслуживающий одного владельца и его внешних контактов в Telegram.
- **Boss**: единственный владелец `Manager_Agent`, чей Telegram chat-id хранится в `ProfileConfig.ownerId` и задаётся явно при создании профиля.
- **Contact**: внешний пользователь Telegram, пишущий в управляемый `Manager_Agent` аккаунт; для каждого контакта ведётся файл `data/<slug>/contacts/<chat_id>.json`.
- **Tier**: контактный уровень, заменяющий `StageId`; одно из значений `cold-stranger`, `introduced`, `regular`, `trusted-partner`, `vip`, `blocked`.
- **Mandate**: текстовая политика владельца (`data/<slug>/mandate.md`), определяющая темы, на которые `Manager_Agent` отвечает сам, и темы, которые эскалируются `Boss`.
- **Escalation**: процесс открытия тикета, отправки холдинг-сообщения клиенту и запроса у `Boss` ответа на тему вне мандата.
- **Ticket**: запись в `data/<slug>/tickets.json` с полями `id` (формата `#T-<n>`), `chatId`, `clientUsername?`, `summary`, `state`, `createdAt`, `closedAt?`, `bossReplyRaw?`, `clientReply?`.
- **Ticket_State**: одно из `open`, `waiting-boss`, `answered`, `closed`.
- **Hold_Message**: первое короткое сообщение клиенту вида «секунду, уточню», отправляемое перед эскалацией.
- **Boss_Reply**: сообщение от `Boss` в Telegram, разрешающее `Manager_Agent` ответить клиенту; формы — `reply_to`, префикс `#T-<n>`, префикс `@<client_username>`.
- **Boss_Reply_Parser**: модуль, превращающий `Boss_Reply` в пару `(ticketId, clientReplyText)`.
- **Tone**: деловой тон, одно из `formal-вы`, `friendly-ты`, `mixed-by-tier`.
- **Persona_Style**: визуальный/гендерный образ ассистента, одно из `gender-neutral-assistant`, `female-secretary`, `male-secretary`.
- **Gate_Level**: режим доступа к чату, одно из `open`, `gated`, `whitelist` (по умолчанию `gated`).
- **AfterHoursPolicy**: политика поведения вне рабочих часов, одно из `silent`, `auto-reply`, `vip-only` (по умолчанию `vip-only`).
- **WorkSchedule**: набор `BusySlot` плюс пара `sleepFrom/sleepTo`, переинтерпретированные как нерабочие часы.
- **Agenda_Outbound_Client**: проактивные сообщения от `Manager_Agent` к клиенту (follow-up по обещаниям).
- **Agenda_Outbound_Boss**: периодические дайджесты от `Manager_Agent` к `Boss` о состоянии входящих и тикетов.
- **WebUI**: встроенный HTTP-интерфейс управления `Manager_Agent`, по умолчанию слушающий порт `3100`.
- **Contacts_Page**: WebUI-страница `/contacts/<slug>` со списком контактов и их `Tier`.
- **Inbox_Page**: WebUI-страница `/inbox/<slug>` со списком тикетов, их состоянием и предложенными ответами.
- **Coexistence**: способность форка работать на одной машине с оригинальным `girl-agent` без коллизий по портам, путям, env-переменным, имени пакета и CLI-бинарю.
- **Original_Project**: оригинальный проект `@thesashadev/girl-agent` (https://github.com/TheSashaDev/girl-agent), который форкается.
- **Round_Trip**: свойство, при котором результат прямой и обратной операции эквивалентен исходному значению.

## Requirements

### Requirement 1: Создание профиля менеджера через WebUI-визард

**User Story:** Как владелец, я хочу пройти WebUI-визард создания профиля менеджера, чтобы получить готовую конфигурацию с явно указанным `ownerId`, тоном, режимом доступа и мандатом без редактирования файлов вручную.

#### Acceptance Criteria

1. THE WebUI SHALL предоставлять страницу создания профиля по пути `/setup/manager`, доступную из главного меню, и SHALL рендерить форму в течение не более 2 секунд после запроса.
2. WHEN владелец открывает страницу создания профиля, THE WebUI SHALL отображать поля: `slug` (текст, 3–32 символа, `[a-z0-9-]`), `name` (текст, 1–64 символа), `mode` (radio: `bot` / `userbot`), `ownerId` (целочисленный ввод, диапазон 1–9999999999999), `tone` (select: `formal-вы` / `friendly-ты` / `mixed-by-tier`), `personaStyle` (select: `gender-neutral-assistant` / `female-secretary` / `male-secretary`), `gateLevel` (select: `open` / `gated` / `whitelist`), `afterHoursPolicy` (select: `silent` / `auto-reply` / `vip-only`), `proactiveClients` (checkbox), `proactiveBoss` (checkbox), `mandate` (textarea, 0–4000 символов), `workSchedule` (редактор `BusySlot` плюс `sleepFrom`/`sleepTo` в формате `HH:MM`).
3. WHERE визард открывается без сохранённого профиля, THE WebUI SHALL предзаполнять `gateLevel` значением `gated`, `afterHoursPolicy` значением `vip-only`, `tone` значением `mixed-by-tier` и `personaStyle` значением `gender-neutral-assistant`.
4. IF поле `ownerId` пустое, не является целым числом, равно `0` или выходит за диапазон 1–9999999999999, THEN THE WebUI SHALL отклонять отправку формы, отображать сообщение об ошибке валидации рядом с полем `ownerId` и сохранять остальные введённые значения формы без потери.
5. IF поле `slug` пустое, короче 3 символов, длиннее 32 символов, содержит символы вне `[a-z0-9-]` или совпадает со `slug` уже существующего профиля, THEN THE WebUI SHALL отклонять отправку формы и отображать сообщение об ошибке валидации рядом с полем `slug` без создания каталога профиля.
6. THE WebUI SHALL сохранять `ownerId` в `ProfileConfig.ownerId` без автодетекта по первому входящему сообщению.
7. WHEN владелец отправляет валидную форму, THE WebUI SHALL создавать каталог `data/<slug>/`, файлы `config.json`, `mandate.md`, пустой каталог `contacts/`, файл `tickets.json` с пустой коллекцией, стартовать профиль без перезапуска процесса и отображать подтверждение создания в течение не более 5 секунд.
8. IF создание каталога профиля или запись любого из файлов `config.json`, `mandate.md`, `tickets.json` завершается ошибкой, THEN THE WebUI SHALL прерывать создание, удалять частично созданные файлы и каталог `data/<slug>/`, не запускать профиль и отображать сообщение об ошибке с указанием неуспешного шага.
9. WHERE `gateLevel` равен `whitelist`, THE WebUI SHALL отображать редактор списка разрешённых записей `chatId` (целое 1–9999999999999) или `@username` (3–32 символа `[a-zA-Z0-9_]`) и отклонять сохранение профиля, если список пуст или содержит хотя бы одну запись, не соответствующую этим форматам.
10. THE WebUI SHALL хранить `tone`, `personaStyle`, `gateLevel`, `afterHoursPolicy`, `proactiveClients`, `proactiveBoss`, `mandate`, `workSchedule` в `ProfileConfig` так, чтобы при последующем открытии профиля на редактирование все ранее сохранённые значения отображались идентично сохранённым.

### Requirement 2: Контактные уровни (Tier) вместо стадий отношений

**User Story:** Как владелец, я хочу видеть и менять контактный уровень для каждого собеседника, чтобы поведение `Manager_Agent` зависело от значимости контакта, а не от романтической стадии.

#### Acceptance Criteria

1. THE Manager_Agent SHALL поддерживать ровно шесть значений `Tier`: `cold-stranger`, `introduced`, `regular`, `trusted-partner`, `vip`, `blocked`.
2. THE Manager_Agent SHALL хранить состояние каждого контакта в файле `data/<slug>/contacts/<chat_id>.json` с ровно следующими полями: `chatId` (строка), `username` (опциональная строка длиной до 64 символов), `tier` (одно из шести значений `Tier`), `notes` (опциональная строка длиной до 2000 символов), `score` (целое число от -100 до 100 включительно), `manualOverride` (булево), `updatedAt` (строка ISO-8601 с миллисекундами, в UTC, суффикс `Z`).
3. WHEN новый контакт пишет впервые и файл контакта для его `chatId` отсутствует, THE Manager_Agent SHALL создавать файл контакта с `tier=cold-stranger`, `score=0`, `manualOverride=false` и `updatedAt`, равным текущему моменту.
4. THE Manager_Agent SHALL выполнять автоматические переходы между тирами только между соседними значениями последовательности `cold-stranger → introduced → regular → trusted-partner → vip` и в обратном направлении только до `cold-stranger`, не пропуская промежуточные тиры за один переход.
5. IF контакт имеет `tier=blocked`, THEN THE Manager_Agent SHALL прекращать любые автоматические ответы и проактивные сообщения этому контакту до явного изменения `tier` владельцем через WebUI или CLI.
6. THE Manager_Agent SHALL не выполнять автоматический переход из `blocked` в любой другой тир без явного действия владельца.
7. WHERE `manualOverride=true` для контакта, THE Manager_Agent SHALL не изменять `tier` этого контакта автоматически до сброса `manualOverride` в `false` владельцем.
8. IF файл контакта содержит значение `tier`, не входящее в список шести допустимых, или `score` вне диапазона от -100 до 100, THEN THE Manager_Agent SHALL отклонять загрузку этого контакта, не выполнять автоматических ответов и проактивных сообщений ему и регистрировать ошибку с указанием `chatId` и причины.

### Requirement 3: Мандат и решение об эскалации

**User Story:** Как владелец, я хочу хранить политику в `mandate.md` и быть уверенным, что `Manager_Agent` отвечает сам только на разрешённые темы, а остальные эскалирует мне.

#### Acceptance Criteria

1. WHEN `Manager_Agent` стартует, THE Manager_Agent SHALL загружать содержимое `data/<slug>/mandate.md` в течение не более 5 секунд от старта профиля.
2. WHEN `mandate.md` изменён через WebUI, THE Manager_Agent SHALL перечитывать файл и применять новую политику в течение не более 5 секунд после изменения, без перезапуска профиля.
3. IF чтение `mandate.md` завершается ошибкой, THEN THE Manager_Agent SHALL сохранять последнюю успешно загруженную версию политики в памяти, регистрировать ошибку с указанием `slug` и причины, и не прерывать работу профиля.
4. WHEN входящее сообщение от контакта получено, THE Manager_Agent SHALL принимать одно решение из закрытого множества `{answer-self, escalate, decline, ignore}` на основании содержимого `mandate.md`, текущего `Tier` и состояния `WorkSchedule`, в течение не более 10 секунд от приёма сообщения.
5. IF решение равно `answer-self`, THEN THE Manager_Agent SHALL отвечать клиенту без открытия тикета.
6. IF решение равно `escalate`, THEN THE Manager_Agent SHALL запускать `Escalation_Loop`, описанный в Requirement 4.
7. IF решение равно `decline`, THEN THE Manager_Agent SHALL отвечать клиенту вежливым отказом без любого непрерывного фрагмента длиной более 20 символов из `mandate.md`.
8. IF решение равно `ignore`, THEN THE Manager_Agent SHALL не отправлять клиенту никаких сообщений, фиксировать факт игнорирования в логах и не открывать тикет.
9. THE Manager_Agent SHALL не включать в любое исходящее сообщение клиенту непрерывный фрагмент длиной более 20 символов из `mandate.md`.
10. WHERE `mandate.md` отсутствует, пуст или содержит только пробельные символы, THE Manager_Agent SHALL отвечать `answer-self` на сообщения-приветствия длиной не более 50 символов и принимать `escalate` для всех остальных сообщений.

### Requirement 4: Цикл эскалации (Escalation_Loop)

**User Story:** Как владелец, я хочу, чтобы при вопросе вне мандата `Manager_Agent` сначала отправил клиенту холдинг-сообщение, затем написал мне краткое резюме с идентификатором тикета, дождался моего ответа и довёл финальную формулировку клиенту.

#### Acceptance Criteria

1. WHEN решение об эскалации принято, THE Manager_Agent SHALL создавать новый `Ticket` с уникальным `id` формата `#T-<n>`, где `<n>` — монотонно возрастающее целое число в пределах профиля, начиная с `1` и не превышающее `2147483647`, и состоянием `open`.
2. WHEN тикет создан, THE Manager_Agent SHALL отправлять клиенту `Hold_Message` длиной не более 80 символов (например, «секунду, уточню») с задержкой, рассчитанной слоем `presence` и `behavior-tick`.
3. WHEN `Hold_Message` отправлен, THE Manager_Agent SHALL переводить тикет в состояние `waiting-boss` и отправлять `Boss` сообщение в Telegram, содержащее: ссылку на клиента (`@username` если доступен или `chatId` если нет), идентификатор тикета `#T-<n>` и краткое LLM-резюме исходного запроса не длиннее 500 символов.
4. THE Manager_Agent SHALL не включать в сообщение боссу полный исходный текст клиента и SHALL не включать содержимое других тикетов.
5. IF генерация LLM-резюме завершается ошибкой или превышает таймаут 30 секунд, THEN THE Manager_Agent SHALL отправлять `Boss` сообщение с фиксированным фолбэк-резюме «не удалось сгенерировать резюме, см. лог тикета» и идентификатором `#T-<n>`, и фиксировать ошибку в логах.
6. WHEN получен `Boss_Reply`, THE Boss_Reply_Parser SHALL определять связанный тикет по правилам Requirement 6.
7. WHEN тикет идентифицирован и `Boss_Reply` распарсен, THE Manager_Agent SHALL отправлять клиенту ответ, основанный на `Boss_Reply`, и переводить тикет в состояние `answered`.
8. WHEN клиент ответил на сообщение тикета или истёк таймаут подтверждения 600 секунд после состояния `answered`, THE Manager_Agent SHALL переводить тикет в состояние `closed` и сохранять `closedAt` в формате ISO-8601 с миллисекундами и суффиксом `Z`.
9. THE Manager_Agent SHALL хранить все тикеты в `data/<slug>/tickets.json` с атомарной записью, при которой файл наблюдается только в исходном или в полностью применённом состоянии.
10. IF `clientUsername` отсутствует в момент эскалации, THEN THE Manager_Agent SHALL включать в сообщение боссу только `chatId` и идентификатор тикета.
11. IF `Boss` не отвечает в течение 86400 секунд от перехода тикета в `waiting-boss`, THEN THE Manager_Agent SHALL переводить тикет в `closed`, фиксировать `closedAt` и причину `boss-timeout` в логах, и не отправлять клиенту дополнительных сообщений сверх таймаут-уведомления Requirement 5.

### Requirement 5: Таймаут эскалации

**User Story:** Как клиент, я хочу получить мягкое уведомление о задержке, если босс не отвечает менеджеру в разумный срок, чтобы не оставаться без ответа.

#### Acceptance Criteria

1. THE Manager_Agent SHALL хранить параметр `escalationTimeoutMin` в `ProfileConfig` со значением по умолчанию `240` минут.
2. WHILE тикет находится в состоянии `waiting-boss` и время с `createdAt` превышает `escalationTimeoutMin`, THE Manager_Agent SHALL отправлять клиенту одно сообщение длиной от 20 до 200 символов, без emoji и без markdown, с информированием о задержке.
3. WHEN таймаут-уведомление отправлено, THE Manager_Agent SHALL устанавливать в тикете флаг `timeoutNotified=true`.
4. IF `timeoutNotified=true`, THEN THE Manager_Agent SHALL не отправлять клиенту дополнительных таймаут-уведомлений по этому тикету.
5. IF `Boss_Reply` поступает после отправки таймаут-уведомления, THEN THE Manager_Agent SHALL продолжать стандартный путь Requirement 4, переводя тикет в `answered`.
6. THE WebUI SHALL принимать значение `escalationTimeoutMin` только в диапазоне 5–1440 минут включительно и SHALL отклонять любое значение вне диапазона с сообщением об ошибке валидации.
7. IF отправка таймаут-уведомления завершается ошибкой Telegram-адаптера, THEN THE Manager_Agent SHALL не устанавливать `timeoutNotified=true`, регистрировать ошибку и повторять попытку при следующем срабатывании таймера.

### Requirement 6: Парсер ответа босса (Boss_Reply_Parser)

**User Story:** Как владелец, я хочу отвечать менеджеру тремя удобными способами (reply, `#T-42 ...`, `@username ...`), чтобы менеджер однозначно понимал, к какому тикету относится мой ответ.

#### Acceptance Criteria

1. THE Boss_Reply_Parser SHALL принимать сообщения только от пользователя, чей Telegram id равен `ProfileConfig.ownerId`.
2. IF отправитель `Boss_Reply` имеет Telegram id, не равный `ProfileConfig.ownerId`, THEN THE Boss_Reply_Parser SHALL не привязывать сообщение ни к какому тикету и обрабатывать его как обычное входящее сообщение от контакта.
3. WHEN `Boss_Reply` является ответом (`reply_to`) на сообщение `Manager_Agent`, в котором ранее был указан тикет `#T-<n>`, THE Boss_Reply_Parser SHALL связывать ответ с тикетом `#T-<n>`.
4. WHEN текст `Boss_Reply` начинается с подстроки `#T-<n>`, где `<n>` — целое в диапазоне 1..2147483647, за которой следует пробельный символ, THE Boss_Reply_Parser SHALL связывать ответ с тикетом `#T-<n>` (сравнение `#T-` регистрозависимо).
5. WHEN текст `Boss_Reply` начинается с подстроки `@<username>`, где `<username>` — 3–32 символа `[a-zA-Z0-9_]`, за которой следует пробельный символ, и существует ровно один открытый или ожидающий тикет с `clientUsername=<username>`, THE Boss_Reply_Parser SHALL связывать ответ с этим тикетом (сравнение `@username` регистронезависимо).
6. IF в `Boss_Reply` присутствуют несколько способов идентификации (`reply_to` и/или `#T-<n>` и/или `@<username>`) и они указывают на разные тикеты, THEN THE Boss_Reply_Parser SHALL не отправлять ответ клиенту и SHALL уведомлять босса о конфликте идентификации с перечислением кандидатов.
7. IF использован только префикс `@<username>` и существует более одного открытого или ожидающего тикета с этим `clientUsername`, THEN THE Boss_Reply_Parser SHALL не отправлять ответ клиенту и SHALL уведомлять босса о неоднозначности с перечислением идентификаторов кандидатов.
8. IF использован только префикс `@<username>` и `clientUsername` неизвестен, THEN THE Boss_Reply_Parser SHALL уведомлять босса, что для этого тикета доступны только `reply_to` и `#T-<n>`.
9. IF `#T-<n>` в `Boss_Reply` не существует в `tickets.json` или находится в состоянии `closed`, THEN THE Boss_Reply_Parser SHALL не отправлять ответ клиенту и SHALL уведомлять босса с указанием причины.
10. THE Boss_Reply_Parser SHALL извлекать `clientReplyText` как часть `Boss_Reply` после префикса (если префикс используется) или как полный текст (если использован `reply_to`), с обрезкой ведущих и завершающих пробельных символов.
11. IF извлечённый `clientReplyText` пуст после обрезки, THEN THE Boss_Reply_Parser SHALL не отправлять ответ клиенту и SHALL уведомлять босса с просьбой сформулировать ответ.
12. IF в `Boss_Reply` отсутствует любой из способов идентификации, THEN THE Boss_Reply_Parser SHALL не привязывать сообщение к тикету и SHALL уведомлять босса с подсказкой о трёх допустимых способах идентификации.

### Requirement 7: Конфиденциальность исходящих сообщений

**User Story:** Как владелец, я хочу быть уверенным, что внутренний контекст (мандат, мои сообщения, чужие тикеты) никогда не утекает клиенту.

#### Acceptance Criteria

1. WHEN формируется исходящее сообщение клиенту, THE Manager_Agent SHALL не включать в текст: полное или частичное содержимое `mandate.md`, идентификаторы других тикетов формата `#T-<n>`, имена или `chatId` других контактов, текст любого резюме, отправленного `Boss` по любому тикету, текст других сообщений `Boss_Reply`.
2. THE Manager_Agent SHALL применять валидацию исходящего сообщения клиенту, отклоняющую отправку, если в тексте обнаружен непрерывный фрагмент длиной более 80 символов (включая пробелы, без учёта регистра), совпадающий с любым резюме боссу по этому тикету или с любым фрагментом `mandate.md`.
3. IF проверка пункта 2 отклоняет сообщение, THEN THE Manager_Agent SHALL не отправлять сообщение клиенту, логировать инцидент с указанием `id` тикета, длины и позиции совпадения, источника совпадения, и эскалировать тикет повторно с пометкой `confidentiality-block` в течение не более 5 секунд.
4. IF при формировании ответа клиенту обнаружен любой идентификатор другого тикета, имя другого контакта или фрагмент другого `Boss_Reply` длиной более 20 символов, THEN THE Manager_Agent SHALL не отправлять сообщение, логировать инцидент с пометкой `cross-ticket-leak` и эскалировать тикет повторно.
5. THE Manager_Agent SHALL хранить пары (резюме боссу, ответ клиенту) в логах для аудита, доступных только владельцу через WebUI или файловую систему профиля, и не публиковать эти данные ни в один исходящий канал клиенту.

### Requirement 8: Политика после рабочих часов (AfterHoursPolicy)

**User Story:** Как владелец, я хочу управлять поведением менеджера вне рабочих часов, чтобы клиенты не получали ответов в неподходящее время или получали их только в особых случаях.

#### Acceptance Criteria

1. THE Manager_Agent SHALL поддерживать ровно три значения `AfterHoursPolicy`: `silent`, `auto-reply`, `vip-only`.
2. WHERE значение `AfterHoursPolicy` в `ProfileConfig` отсутствует или не входит в список трёх допустимых, THE Manager_Agent SHALL использовать значение по умолчанию `vip-only` и регистрировать предупреждение.
3. THE Manager_Agent SHALL вычислять «вне рабочих часов» как объединение временных интервалов из `busySchedule` и интервала `[sleepFrom, sleepTo]` с учётом `tz` профиля.
4. WHILE текущее время вне рабочих часов и `AfterHoursPolicy=silent`, THE Manager_Agent SHALL не отправлять клиенту ни одного сообщения, кроме уже запланированных таймаут-уведомлений Requirement 5.
5. WHILE текущее время вне рабочих часов и `AfterHoursPolicy=auto-reply`, THE Manager_Agent SHALL отвечать клиенту автоматическим сообщением длиной от 20 до 200 символов о возврате в рабочее время и не открывать тикет.
6. THE Manager_Agent SHALL не отправлять одному клиенту более одного `auto-reply`-сообщения в пределах одного непрерывного нерабочего окна.
7. WHILE текущее время вне рабочих часов и `AfterHoursPolicy=vip-only`, THE Manager_Agent SHALL обрабатывать сообщения от контактов с `tier∈{trusted-partner, vip}` по обычным правилам Requirement 3 и применять `auto-reply`-поведение для остальных.
8. WHERE для контакта `tier` не определён в момент решения `vip-only` (карточка контакта отсутствует или повреждена), THE Manager_Agent SHALL применять `auto-reply`-поведение к этому контакту.
9. THE Manager_Agent SHALL продолжать принимать `Boss_Reply` от босса вне рабочих часов и обрабатывать тикеты в состоянии `waiting-boss`.

### Requirement 9: Двусторонняя проактивная повестка (Agenda)

**User Story:** Как владелец, я хочу, чтобы менеджер сам напоминал клиентам о своих обещаниях и периодически присылал мне дайджест входящих, чтобы не терять контекст.

#### Acceptance Criteria

1. WHERE `proactiveClients=true`, THE Manager_Agent SHALL отслеживать в исходящих сообщениях клиенту обещания вида «явное будущее действие с указанным сроком» (например, «пришлю КП до пятницы», «отвечу завтра до 18:00») и планировать `Agenda_Outbound_Client` с напоминанием в момент, рассчитанный layer-ом `agenda`, либо, при отсутствии расчётного момента, через 24 часа после исходящего сообщения.
2. WHERE `proactiveBoss=true`, THE Manager_Agent SHALL отправлять `Boss` дайджест активности с настраиваемой периодичностью в диапазоне от 1 часа до 7 дней (по умолчанию один раз в сутки в 09:00 по часовому поясу профиля).
3. THE `Agenda_Outbound_Boss` дайджест SHALL содержать: число открытых тикетов, число тикетов в состоянии `waiting-boss`, число новых контактов за период (с момента предыдущего дайджеста или за последние 24 часа, если предыдущего не было), ссылку на `Inbox_Page`.
4. WHERE `proactiveClients=false`, THE Manager_Agent SHALL не отправлять клиентам никаких follow-up сообщений, не относящихся к активному тикету (тикету с `state∈{open, waiting-boss, answered}` и временем последнего входящего сообщения не более 7 суток назад).
5. WHERE `proactiveBoss=false`, THE Manager_Agent SHALL не отправлять `Boss` дайджесты.
6. IF отправка `Agenda_Outbound_Client` или `Agenda_Outbound_Boss` завершается ошибкой Telegram-адаптера, THEN THE Manager_Agent SHALL помечать пункт повестки как `failed`, сохранять причину в логах и не выполнять автоматический повтор по этому пункту.
7. IF клиент уже ответил после сохранения пункта `Agenda_Outbound_Client`, THEN THE Manager_Agent SHALL отменять напоминание, помечая пункт как `resolved`, и не отправлять его клиенту.

### Requirement 10: WebUI-страница контактов (Contacts_Page)

**User Story:** Как владелец, я хочу видеть таблицу контактов с их тиром, заметками и быстрым переопределением тира в одном месте.

#### Acceptance Criteria

1. THE WebUI SHALL предоставлять страницу `/contacts/<slug>`, где `<slug>` соответствует существующему профилю в каталоге `data/`, и SHALL отображать таблицу со всеми контактами этого профиля.
2. THE Contacts_Page SHALL отображать для каждого контакта столбцы `chatId`, `username` (пустая строка, если отсутствует), `tier`, `notes` (пустая строка, если отсутствует), `lastMessageAt` (ISO-8601 в часовом поясе профиля), `manualOverride` (true/false).
3. WHEN владелец меняет `tier` контакта через интерфейс на одно из шести допустимых значений, THE Contacts_Page SHALL сохранять новое значение в `data/<slug>/contacts/<chat_id>.json`, устанавливать `manualOverride=true` и обновлять строку без перезагрузки страницы за время не более 2 секунд.
4. THE Contacts_Page SHALL поддерживать редактирование `notes` каждого контакта длиной 0–2000 символов с сохранением в файл контакта по явному действию подтверждения.
5. IF при сохранении изменений `tier` или `notes` происходит ошибка записи файла либо передано недопустимое значение `tier` или `notes` длиной более 2000 символов, THEN THE Contacts_Page SHALL отклонять изменение, сохранять предыдущее значение в файле без модификаций и отображать сообщение об ошибке с указанием причины.
6. THE Contacts_Page SHALL поддерживать сортировку по `lastMessageAt` по убыванию (по умолчанию) и возрастанию, и фильтрацию по точному совпадению значения `tier` с любым из шести допустимых значений или отсутствие фильтра (показ всех контактов).

### Requirement 11: WebUI-страница инбокса тикетов (Inbox_Page)

**User Story:** Как владелец, я хочу видеть список эскалаций, их статус и предложенные ответы, чтобы при желании отвечать через WebUI, не теряя возможности отвечать в Telegram.

#### Acceptance Criteria

1. THE WebUI SHALL предоставлять страницу `/inbox/<slug>` со списком тикетов профиля, доступную только аутентифицированному владельцу профиля; неаутентифицированные запросы получают отказ в доступе.
2. THE Inbox_Page SHALL отображать для каждого тикета: `id`, `clientUsername` (или `chatId`, если `clientUsername` отсутствует), `summary` длиной не более 200 символов (с обрезкой и многоточием при превышении), `state`, `createdAt`, `closedAt` (при наличии) в формате ISO-8601 с миллисекундами и суффиксом `Z`.
3. THE Inbox_Page SHALL поддерживать фильтрацию по `state` со значениями `waiting-boss`, `answered`, `closed`, `all` и сортировку по `createdAt` по убыванию (по умолчанию) или возрастанию.
4. WHEN владелец отправляет через `Inbox_Page` ответ на тикет длиной от 1 до 4096 символов, THE Manager_Agent SHALL обрабатывать его эквивалентно `Boss_Reply` через `Boss_Reply_Parser` (Requirement 6).
5. IF владелец отправляет через `Inbox_Page` пустой ответ или ответ длиной более 4096 символов, THEN THE Inbox_Page SHALL отклонять отправку с сообщением об ошибке валидации и сохранять введённый текст в форме без потери.
6. WHILE тикет находится в состоянии `waiting-boss`, THE Inbox_Page SHALL отображать предложенный LLM-черновик ответа клиенту без автоматической отправки.
7. THE Manager_Agent SHALL обрабатывать ответы боссу, полученные в Telegram, параллельно с действиями через `Inbox_Page`.
8. IF на тикет в состоянии `answered` или `closed` поступает повторный ответ через `Inbox_Page` или Telegram, THEN THE Manager_Agent SHALL отклонять повторный ответ с уведомлением отправителю и сохранять текущее состояние тикета без изменений.

### Requirement 12: Деловой тон (Tone) и persona-стиль

**User Story:** Как владелец, я хочу выбирать один из трёх деловых тонов общения и трёх вариантов гендерного образа ассистента, чтобы текст менеджера соответствовал моему бренду.

#### Acceptance Criteria

1. THE Manager_Agent SHALL поддерживать ровно три значения `Tone`: `formal-вы`, `friendly-ты`, `mixed-by-tier`.
2. THE Manager_Agent SHALL поддерживать ровно три значения `Persona_Style`: `gender-neutral-assistant`, `female-secretary`, `male-secretary`.
3. WHERE значение `Tone` в `ProfileConfig` отсутствует или не входит в список допустимых, THE Manager_Agent SHALL использовать значение по умолчанию `mixed-by-tier` и регистрировать предупреждение.
4. WHERE значение `Persona_Style` в `ProfileConfig` отсутствует или не входит в список допустимых, THE Manager_Agent SHALL использовать значение по умолчанию `gender-neutral-assistant` и регистрировать предупреждение.
5. WHEN формируется каждое исходящее сообщение клиенту, THE Manager_Agent SHALL применять выбранный `Tone` к местоимениям и формам глаголов всего сообщения.
6. WHERE `Tone=formal-вы`, THE Manager_Agent SHALL формировать исходящие сообщения клиенту с обращением на «вы».
7. WHERE `Tone=friendly-ты`, THE Manager_Agent SHALL формировать исходящие сообщения клиенту с обращением на «ты».
8. WHERE `Tone=mixed-by-tier`, THE Manager_Agent SHALL использовать «вы» для контактов с `tier∈{cold-stranger, introduced, blocked}` и «ты» для контактов с `tier∈{regular, trusted-partner, vip}`.
9. WHERE `Tone=mixed-by-tier` и для контакта `tier` не определён (карточка отсутствует или повреждена), THE Manager_Agent SHALL применять «вы» для этого контакта.
10. THE Manager_Agent SHALL включать выбранный `Persona_Style` в системный промпт LLM-вызова для согласования местоимений и образа ассистента.

### Requirement 13: Сохранение слоёв реализма под секретарской семантикой

**User Story:** Как владелец, я хочу, чтобы менеджер сохранял задержки и человеческое поведение оригинала, но в рабочем контексте (встречи вместо пар, рабочие часы вместо сна и т.д.).

#### Acceptance Criteria

1. THE Manager_Agent SHALL переиспользовать модули `presence`, `online-tick`, `daily-life`, `behavior-tick`, `agenda`, `memory-palace`, `typos`, `security`, `media`, LLM-клиент, telegram-адаптеры (`bot`, `userbot`), миграции и WebUI-каркас без дублирования исходного кода и без модификации их публичных API сверх минимального, необходимого для смены семантики.
2. THE Manager_Agent SHALL передавать в `presence` и `daily-life` интерпретацию `BusySlot` как рабочих встреч или звонков, без изменения структуры типа `BusySlot` (поля и типы полей сохраняются).
3. THE Manager_Agent SHALL передавать `sleepFrom` и `sleepTo` в `AfterHoursPolicy` как границы нерабочих часов.
4. WHEN текущее время попадает в интервал `[sleepFrom, sleepTo]`, THE Manager_Agent SHALL не вызывать ни одну функцию ночного пробуждения «сонной девушки» (включая `nightWakeChance`, `forcedWake`-логику и сопутствующие поведения).
5. THE Manager_Agent SHALL применять модуль `typos` с пресетом, в котором вероятность опечатки на символ строго меньше, чем в пресете, использовавшемся в `Original_Project` по умолчанию.
6. THE Manager_Agent SHALL хранить контекстные карточки в `memory-palace` с индексом по `chatId`, и поиск по `chatId` SHALL возвращать только карточку, относящуюся к этому контакту.
7. THE Manager_Agent SHALL не вызывать ни одной функции из `src/engine/hormones.ts` в течение всего жизненного цикла процесса.

### Requirement 14: Удаление устаревших модулей оригинала

**User Story:** Как разработчик форка, я хочу удалить из кодовой базы артефакты, не относящиеся к менеджерскому сценарию, чтобы избежать путаницы и побочных эффектов.

#### Acceptance Criteria

1. THE Repository SHALL не содержать файла `src/presets/stages.ts`, и поиск в каталоге `src/` (за исключением `src/migrations/`) SHALL не находить ни одного `import` или ссылки на этот модуль.
2. THE Repository SHALL не содержать ветки кода для стадии `dumped` и функции `switchPrimaryAfterDumped` в `src/` (за исключением `src/migrations/`).
3. THE Repository SHALL не содержать функций `isRomanticApproach` и `maybeBlockAfterBoundary` в `src/` (за исключением `src/migrations/`).
4. THE Repository SHALL не содержать файла `src/engine/hormones.ts`, и поиск в каталоге `src/` (за исключением `src/migrations/`) SHALL не находить ни одного `import` или ссылки на этот модуль.
5. THE Repository SHALL не содержать пяти коммуникационных пресетов оригинала (`normal`, `cute`, `alt`, `clingy`, `chatty`) и логики выбора пресета по любому из этих пяти идентификаторов в `src/` (за исключением `src/migrations/`).
6. IF владелец передаёт через WebUI или CLI идентификатор любого удалённого пресета, THEN THE Manager_Agent SHALL отклонять значение, отображать сообщение об ошибке валидации и сохранять текущий пресет без изменений.
7. WHEN запускается команда `npm run typecheck`, THE Repository SHALL завершать её с кодом 0 без ошибок и предупреждений, относящихся к удалённым модулям и пресетам.

### Requirement 15: Ребренд пакета, CLI, портов, путей и переменных окружения

**User Story:** Как владелец, я хочу запускать оригинальный `girl-agent` и форк `manager-agent` рядом на одной машине, чтобы один не мешал другому ни через файлы, ни через порты, ни через env-переменные.

#### Acceptance Criteria

1. THE Repository SHALL объявлять имя пакета `@thesashadev/manager-agent` в `package.json`.
2. THE Repository SHALL объявлять CLI-бинарь `manager-agent` в поле `bin` `package.json`.
3. THE WebUI SHALL по умолчанию слушать TCP-порт `3100`, с возможностью переопределения через переменную окружения `MANAGER_AGENT_PORT` или флаг `--port=<n>` со значением в диапазоне 1–65535.
4. IF `MANAGER_AGENT_PORT` или `--port` принимает значение вне диапазона 1–65535 или не является целым числом, THEN THE Manager_Agent SHALL отказывать в старте WebUI и выводить сообщение об ошибке с указанием допустимого диапазона.
5. IF выбранный порт уже занят другим процессом, THEN THE Manager_Agent SHALL отказывать в старте WebUI с явным указанием конфликта порта.
6. THE Manager_Agent SHALL читать переменные окружения с префиксом `MANAGER_AGENT_` (например, `MANAGER_AGENT_DATA`, `MANAGER_AGENT_TOKEN`, `MANAGER_AGENT_API_KEY`, `MANAGER_AGENT_TG_PROXY`) и SHALL не читать переменные с префиксом `GIRL_AGENT_`.
7. THE Manager_Agent SHALL вычислять корневой каталог данных по умолчанию как `~/.local/share/manager-agent/data` на Linux, `~/Library/Application Support/manager-agent/data` на macOS и `%APPDATA%\manager-agent\data` на Windows, с возможностью переопределения через `MANAGER_AGENT_DATA`.
8. WHEN `Manager_Agent` стартует и корневой каталог данных не существует, THE Manager_Agent SHALL создавать его и все необходимые промежуточные каталоги.
9. THE Repository SHALL объявлять Docker-образ с тегом `ghcr.io/<owner>/manager-agent:<tag>`, без переиспользования имени `girl-agent` в опубликованных артефактах.
10. THE Manager_Agent SHALL не использовать ни одного из значений по умолчанию `Original_Project`: имя пакета `@thesashadev/girl-agent`, CLI-бинарь `girl-agent`, порт `3000`, префикс env `GIRL_AGENT_`, путь `~/.local/share/girl-agent/data` (и платформенные эквиваленты `~/Library/Application Support/girl-agent/data`, `%APPDATA%\girl-agent\data`), Docker-имя `girl-agent`.
11. WHEN владелец параллельно запускает оригинальный `girl-agent` и `manager-agent`, THE Manager_Agent SHALL не модифицировать каталог данных оригинала и SHALL не считывать его конфигурационные файлы.

### Requirement 16: Атрибуция форка в README, package.json и LICENSE

**User Story:** Как пользователь и автор оригинала, я хочу видеть в README, package.json и LICENSE явное указание, что проект — форк `TheSashaDev/girl-agent`, с сохранением условий исходной лицензии.

#### Acceptance Criteria

1. THE README SHALL содержать в первых 20 строках блок атрибуции с явным указанием, что проект является форком `TheSashaDev/girl-agent`, ссылкой на оригинальный репозиторий `https://github.com/TheSashaDev/girl-agent` и упоминанием авторства оригинала.
2. THE README SHALL быть написан на русском языке в визуальном стиле оригинала: badge-блок, таблица «Что под капотом», раздел «Быстрый старт», раздел «Лицензия».
3. THE README SHALL описывать продукт как «AI-менеджер в Telegram» и SHALL не содержать в собственных описаниях ни одной из следующих формулировок: «AI-девушка», «girlfriend», «парень», «свидание», «отношения с ней», «романтический».
4. THE `package.json` SHALL содержать в поле `description` строку длиной не более 200 символов с упоминанием форка и его назначения.
5. THE `package.json` SHALL содержать в поле `repository` объект с полями `type` (значение `git`) и `url` (URL форка), а в поле `homepage` или README SHALL присутствовать ссылка на оригинальный репозиторий.
6. THE LICENSE SHALL сохранять оригинальные условия source-available лицензии без удаления и замены текста.
7. THE LICENSE SHALL содержать в первых 5 строках заголовочную ноту: `This project is a fork of TheSashaDev/girl-agent. All rights to the original code remain with the original author.`.
8. IF в pull request присутствуют изменения файла LICENSE, удаляющие или заменяющие оригинальный текст, THEN THE Repository SHALL не принимать такой pull request без письменного разрешения автора оригинала.
9. THE Repository SHALL фиксировать факт письменного разрешения автора оригинала (при его наличии) в файле или комментарии PR, доступном для аудита.

### Requirement 17: Уровни ворот (Gate_Level)

**User Story:** Как владелец, я хочу управлять тем, кто вообще может писать менеджеру, чтобы фильтровать спам или ограничить общение белым списком.

#### Acceptance Criteria

1. THE Manager_Agent SHALL поддерживать ровно три значения `Gate_Level`: `open`, `gated`, `whitelist`.
2. WHERE значение `Gate_Level` в `ProfileConfig` отсутствует или не входит в список трёх допустимых, THE Manager_Agent SHALL использовать значение по умолчанию `gated` и регистрировать предупреждение.
3. WHERE `Gate_Level=open`, THE Manager_Agent SHALL принимать сообщения от любого контакта.
4. WHERE `Gate_Level=gated` и для контакта `tier=cold-stranger` и `manualOverride=false`, THE Manager_Agent SHALL принимать сообщения, но отвечать не более чем на 3 входящих сообщения в пределах 24 часов до явного подтверждения владельцем (повышения тира или установки `manualOverride=true`).
5. WHEN `Gate_Level=gated` и количество отправленных ответов клиенту с `tier=cold-stranger` превышает 3 в пределах 24 часов, THE Manager_Agent SHALL переводить решение в `escalate` и не отвечать клиенту до подтверждения владельцем.
6. WHERE `Gate_Level=whitelist`, THE Manager_Agent SHALL принимать сообщения только от контактов, чей `chatId` или `@username` присутствует в белом списке профиля, и SHALL игнорировать остальных без отправки ответа и без открытия тикета.
7. WHEN владелец изменяет `Gate_Level` через WebUI, THE Manager_Agent SHALL применять новое значение в течение не более 5 секунд без перезапуска процесса.

### Requirement 18: Жизненный цикл состояний тикета

**User Story:** Как владелец, я хочу, чтобы переходы состояний тикета были предсказуемыми и не допускали потерь.

#### Acceptance Criteria

1. THE `Ticket_State` SHALL принимать только значения из множества `{open, waiting-boss, answered, closed}`.
2. IF тикет загружается из `tickets.json` со значением `state` вне множества допустимых, THEN THE Manager_Agent SHALL отклонять загрузку этого тикета, регистрировать ошибку с указанием `id` и не выполнять никаких автоматических действий по этому тикету.
3. THE Manager_Agent SHALL разрешать переходы тикета только по списку: `open → waiting-boss`, `waiting-boss → answered`, `answered → closed`, `waiting-boss → closed` (отмена), `open → closed` (отмена до отправки боссу).
4. IF запрошен переход вне списка пункта 3 или для несуществующего идентификатора тикета, THEN THE Manager_Agent SHALL отклонять переход, сохранять текущее состояние без изменений и логировать ошибку с указанием `id` тикета, исходного состояния и целевого состояния.
5. THE Manager_Agent SHALL атомарно записывать изменения тикетов в `tickets.json`: файл наблюдается только в исходном или в полностью применённом состоянии, без частично записанных байт; запись завершается за время не более 2 секунд.
6. WHEN тикет переходит в `closed`, THE Manager_Agent SHALL фиксировать `closedAt` в формате ISO-8601 с миллисекундами и суффиксом `Z`.
7. THE Manager_Agent SHALL хранить для каждого тикета историю переходов состояний с метками времени и причиной перехода для аудита.

### Requirement 19: Свойства корректности (Property-Based Correctness)

**User Story:** Как разработчик, я хочу зафиксировать исполняемые свойства корректности, чтобы их можно было проверять property-based тестами на этапе реализации.

#### Acceptance Criteria

1. FOR ALL последовательностей входящих сообщений длиной от 1 до 10000, приводящих к решению `escalate`, THE Manager_Agent SHALL создавать ровно один тикет на каждое решение `escalate` и SHALL переводить каждый созданный тикет в состояние `closed` за число шагов, не превышающее 1000 переходов.
2. IF свойство пункта 1 нарушается в тестовой последовательности, THEN THE тестовый прогон SHALL завершаться с указанием минимального контрпримера, идентификатора тикета и фактического числа шагов.
3. FOR ALL пар (резюме, отправленного боссу) и (ответа, отправленного клиенту) внутри одного тикета, THE Manager_Agent SHALL не допускать совпадения непрерывного фрагмента длиной более 80 символов (посимвольно, с учётом пробелов, без учёта регистра) между этими двумя строками.
4. IF свойство пункта 3 нарушается, THEN THE Manager_Agent SHALL не отправлять ответ клиенту, фиксировать инцидент и эскалировать тикет с пометкой `confidentiality-block`.
5. FOR ALL `Boss_Reply`, содержащих одновременно `reply_to`, префикс `#T-<n>` и префикс `@<username>`, THE Boss_Reply_Parser SHALL либо возвращать один и тот же `ticketId` для всех трёх способов идентификации, либо возвращать ошибку конфликта без отправки клиенту.
6. IF свойство пункта 5 нарушается, THEN THE Boss_Reply_Parser SHALL фиксировать инцидент и уведомлять босса с перечислением кандидатов.
7. FOR ALL контактов с `tier=blocked`, THE Manager_Agent SHALL не выполнять автоматический переход в любой другой `tier` без явного действия владельца, при этом «явное действие владельца» определяется как событие смены тира, инициированное через WebUI или CLI и записанное с идентификатором владельца.
8. IF свойство пункта 7 нарушается, THEN THE Manager_Agent SHALL фиксировать инцидент и не применять незаконный автоматический переход.
9. THE Round_Trip между сериализацией и десериализацией `Ticket` через `tickets.json` SHALL давать значение, структурно эквивалентное исходному (равенство по всем полям схемы), для всех валидных значений `Ticket`.
10. IF Round_Trip пункта 9 не сохраняет эквивалентность, THEN THE тестовый прогон SHALL завершаться с указанием поля и фактического расхождения.
11. THE Round_Trip между сериализацией и десериализацией `Contact` через `data/<slug>/contacts/<chat_id>.json` SHALL давать значение, структурно эквивалентное исходному, для всех валидных значений `Contact`.
12. FOR ALL значений по умолчанию `Manager_Agent` (имя пакета, CLI-бинарь, порт WebUI, префикс env, корневой путь данных, Docker-имя), THE Manager_Agent SHALL не совпадать ни с одним соответствующим значением по умолчанию `Original_Project` (сравнение строк с учётом регистра, числовое для портов).
13. FOR ALL переходов состояний тикета, THE Manager_Agent SHALL разрешать только переходы, перечисленные в Requirement 18, пункт 3.
14. IF свойство пункта 13 нарушается, THEN THE Manager_Agent SHALL отклонять переход, сохранять текущее состояние без изменений и фиксировать инцидент.

### Requirement 20: CLI и серверный режим менеджера

**User Story:** Как владелец, я хочу запускать менеджер из терминала с привычными флагами и подкомандами, согласованными с переименованием.

#### Acceptance Criteria

1. WHEN команда `manager-agent` запускается без аргументов в TTY-терминале, THE CLI SHALL открывать интерактивный визард или WebUI с приглашением создать профиль.
2. WHEN команда `manager-agent` запускается без аргументов в окружении без TTY, THE CLI SHALL поднимать WebUI на порту по умолчанию `3100` и SHALL не запускать визард.
3. WHEN команда `manager-agent --profile=<slug>` запускается, THE CLI SHALL стартовать профиль с указанным `slug`.
4. IF указанный `<slug>` не существует в каталоге данных, THEN THE CLI SHALL завершаться с ненулевым кодом выхода и сообщением об ошибке, перечисляющим существующие профили.
5. THE CLI SHALL поддерживать подкоманду `manager-agent server` с флагами `--config=<path>`, `--headless`, `--print-config`.
6. IF указанный `--config=<path>` не существует или не читается, THEN THE CLI SHALL завершаться с ненулевым кодом выхода и сообщением об ошибке с указанием пути.
7. WHEN команда `manager-agent server --print-config` вызвана, THE CLI SHALL печатать в stdout шаблон конфигурации, использующий переменные окружения с префиксом `MANAGER_AGENT_`, завершаться с кодом 0 и не запускать сервер.
8. THE CLI SHALL не предоставлять команду `girl-agent` или подкоманды, имя которых содержит подстроку `girl-agent`.
