/**
 * Чистые helper-функции для CLI `manager-agent`.
 *
 * Этот модуль изолирует тестируемую логику парсинга флагов и валидации
 * от `src/cli.ts`, который содержит side-effect `main()` на верхнем уровне
 * и не должен импортироваться из тестов.
 *
 * Реализует Task 5.9 (Requirement 20 manager-mode).
 */

/**
 * Имена всех публичных подкоманд `manager-agent`.
 *
 * Используется тестом «no girl-agent leak»: ни одна подкоманда не должна
 * содержать подстроку `girl-agent` (Requirement 20.8).
 */
export const KNOWN_SUBCOMMANDS = [
  "server",
  "update",
  "addon"
] as const;

/**
 * Имена всех CLI-флагов (длинная форма, без префикса `--`).
 *
 * Покрывает корневую команду `manager-agent` и подкоманду `server`.
 * Используется в тестах против утечки `girl-agent` в имена флагов.
 */
export const KNOWN_CLI_FLAGS = [
  // root: общие
  "help",
  "list",
  "no-browser",
  "verbose",
  // root: сетевые / WebUI
  "host",
  "port",
  // root: запуск профиля
  "profile",
  "json-events",
  "headless",
  // root: быстрые утилиты
  "set-model",
  "delete-profile",
  "yes",
  // root: формирование профиля из флагов
  "api-preset",
  "api-key",
  "model",
  "base-url",
  "proto",
  "name",
  "stage",
  "nationality",
  "tz",
  "vibe",
  "persona-notes",
  "communication-preset",
  "notifications",
  "message-style",
  "initiative",
  "life-sharing",
  "ignore-tendency",
  "owner-id",
  "privacy",
  "mode",
  "token",
  "api-id",
  "api-hash",
  "phone",
  "age",
  // server subcommand
  "config",
  "print-config",
  "print-systemd",
  "print-docker",
  "no-start"
] as const;

/**
 * Сообщение об ошибке для несуществующего slug-а профиля.
 *
 * Если профилей нет вообще — печатается подсказка про WebUI / server.
 * Иначе — перечисление доступных профилей в виде маркированного списка
 * (Requirement 20.4).
 */
export function describeMissingProfile(slug: string, existing: string[]): string {
  const head = `профиль не найден: ${slug}`;
  if (existing.length === 0) {
    return `${head}\nпрофилей пока нет — создай через WebUI (manager-agent) или из конфига (manager-agent server --config <path>).`;
  }
  const list = existing.map((name) => `  - ${name}`).join("\n");
  return `${head}\nдоступные профили (${existing.length}):\n${list}`;
}

/**
 * Сообщение об ошибке для невалидного `--config=<path>` подкоманды server.
 *
 * Включает абсолютный путь, чтобы пользователь видел, где ожидался файл
 * (Requirement 20.6).
 */
export function describeInvalidConfigPath(absPath: string, reason: string): string {
  return `[server] не могу прочитать --config=${absPath}: ${reason}`;
}

/**
 * Возвращает true, если заданная строка содержит подстроку `girl-agent`.
 *
 * Используется регрессионным тестом по Requirement 20.8 — ни одна команда
 * или флаг CLI форка не должны нести имя оригинального проекта.
 */
export function containsLegacyName(value: string): boolean {
  return value.toLowerCase().includes("girl-agent");
}
