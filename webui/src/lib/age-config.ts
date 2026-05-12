// Возрастные ограничения для UI. Должны совпадать с src/config/age.ts на бекенде.
// Менять тут — не забудь синхронизировать с бекендом.

export const MIN_AGE = 18;
export const MAX_AGE = 45;
export const DEFAULT_AGE = 22;

export function clampAge(age: number): number {
  if (!Number.isFinite(age)) return DEFAULT_AGE;
  if (age < MIN_AGE) return MIN_AGE;
  if (age > MAX_AGE) return MAX_AGE;
  return Math.round(age);
}

export function isValidAge(age: number): boolean {
  return Number.isFinite(age) && age >= MIN_AGE && age <= MAX_AGE;
}
