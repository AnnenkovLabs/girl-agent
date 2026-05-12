/**
 * Глобальные ограничения возраста персонажа.
 *
 * MIN_AGE — минимальный возраст, ниже которого профиль создать НЕЛЬЗЯ.
 *   По умолчанию 18 (политика безопасности проекта: нет ничего связанного с
 *   несовершеннолетними).
 * MAX_AGE — верхняя граница UI-слайдера. Можно поднять при необходимости.
 *
 * Эти константы импортируются и в backend-валидации (storage/md, routes),
 * и в WebUI (webui/src/lib/age-config.ts тянет те же значения через API).
 */
export const MIN_AGE = 18;
export const MAX_AGE = 45;

/** Зажимает возраст в допустимые рамки. */
export function clampAge(age: number): number {
  if (!Number.isFinite(age)) return MIN_AGE;
  if (age < MIN_AGE) return MIN_AGE;
  if (age > MAX_AGE) return MAX_AGE;
  return Math.round(age);
}

/** Возвращает true, если возраст внутри допустимых рамок. */
export function isValidAge(age: number): boolean {
  return Number.isFinite(age) && age >= MIN_AGE && age <= MAX_AGE;
}
