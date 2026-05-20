/**
 * Заглушка времени миграции на manager-mode.
 *
 * `girl-agent` хранил поведение в 9 пресетах StageId+StagePreset (см. бывший
 * `src/presets/stages.ts` и `.kiro/specs/manager-mode/design.md` § 3.1, где
 * они заменяются per-contact полем `tier`). Чтобы не переписывать всю
 * runtime-логику в одном гигантском PR, на этапе 2 этого спека мы оставляем
 * нейтральную заглушку с дефолтами. Финальный refactor (Task 4.12 manager-mode
 * tasks.md) удалит и этот файл, и все ссылки на `cfg.stage` /
 * relationship-cтатистику.
 */

export type LegacyStageId = string;

export interface LegacyStagePreset {
  id: LegacyStageId;
  num: number;
  label: string;
  description: string;
  defaults: {
    interest: number;
    trust: number;
    attraction: number;
    annoyance: number;
    cringeTolerance: number;
    ignoreChance: number;
    replyDelaySec: [number, number];
  };
}

export const LEGACY_DEFAULT_STAGE: LegacyStagePreset = {
  id: "manager-default",
  num: 1,
  label: "manager-default",
  description: "Заглушка после удаления stages preset (см. .kiro/specs/manager-mode/tasks.md task 2.1).",
  defaults: {
    interest: 0,
    trust: 0,
    attraction: 0,
    annoyance: 0,
    cringeTolerance: 50,
    ignoreChance: 0.2,
    replyDelaySec: [5, 30]
  }
};

/**
 * Совместимый аналог `findStage` из удалённого `presets/stages.ts`. Возвращает
 * один и тот же дефолт независимо от запрошенного id, чтобы не падать на
 * местах, где старый код передаёт строку.
 */
export function findStage(_id?: string | number): LegacyStagePreset {
  void _id;
  return LEGACY_DEFAULT_STAGE;
}

export const STAGE_PRESETS: LegacyStagePreset[] = [LEGACY_DEFAULT_STAGE];
