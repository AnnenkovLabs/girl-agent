import type { CommunicationProfile, InitiativeLevel, LifeSharingLevel, MessageStyle, NotificationMode, ProfileConfig } from "../types.js";

/**
 * Этот модуль остался от girl-agent. Manager-mode заменяет его на
 * `presets/manager-tone.ts` + `presets/persona-style.ts` (см. design.md § 3.3).
 * Чтобы не делать L-рефакторинг в одном PR, на этапе 2 от модуля остаётся
 * нейтральная заглушка-пресет: один профиль `manager-default` и публичные
 * хелперы, которыми пользуется legacy-код. В задачах 3.3 / 4.11 / 5.x этот
 * файл будет полностью замещён manager-tone и persona-style.
 */

export interface CommunicationPreset {
  id: string;
  label: string;
  description: string;
  profile: CommunicationProfile;
}

const NOTIFICATIONS: NotificationMode[] = ["muted", "normal", "priority"];
const MESSAGE_STYLES: MessageStyle[] = ["one-liners", "balanced", "bursty", "longform"];
const INITIATIVES: InitiativeLevel[] = ["low", "medium", "high"];
const LIFE_SHARING: LifeSharingLevel[] = ["low", "medium", "high"];

const MANAGER_DEFAULT_PROFILE: CommunicationProfile = {
  notifications: "normal",
  messageStyle: "balanced",
  initiative: "medium",
  lifeSharing: "low"
};

const MANAGER_DEFAULT_PRESET: CommunicationPreset = {
  id: "manager-default",
  label: "Manager-default",
  description: "Нейтральный деловой профиль (заглушка после удаления girl-agent communication-пресетов).",
  profile: MANAGER_DEFAULT_PROFILE
};

export const COMMUNICATION_PRESETS: CommunicationPreset[] = [MANAGER_DEFAULT_PRESET];

export function findCommunicationPreset(_id: string | undefined): CommunicationPreset | undefined {
  void _id;
  return MANAGER_DEFAULT_PRESET;
}

export function normalizeCommunicationProfile(source?: Pick<Partial<ProfileConfig>, "communication" | "vibe">): CommunicationProfile {
  const raw = source?.communication;
  return {
    notifications: includes(NOTIFICATIONS, raw?.notifications) ? raw.notifications : MANAGER_DEFAULT_PROFILE.notifications,
    messageStyle: includes(MESSAGE_STYLES, raw?.messageStyle) ? raw.messageStyle : MANAGER_DEFAULT_PROFILE.messageStyle,
    initiative: includes(INITIATIVES, raw?.initiative) ? raw.initiative : MANAGER_DEFAULT_PROFILE.initiative,
    lifeSharing: includes(LIFE_SHARING, raw?.lifeSharing) ? raw.lifeSharing : MANAGER_DEFAULT_PROFILE.lifeSharing
  };
}

export function normalizeIgnoreTendency(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 35;
  if (!Number.isFinite(parsed)) return 35;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function ignoreTendencyLabel(value: number): string {
  const pct = normalizeIgnoreTendency(value);
  if (pct <= 10) return `${pct}% — почти не игнорит без причины`;
  if (pct <= 30) return `${pct}% — отвечает чаще обычного`;
  if (pct <= 50) return `${pct}% — нормальная живость/избирательность`;
  if (pct <= 70) return `${pct}% — сухая, часто пропадает`;
  return `${pct}% — очень холодная, игнорит часто`;
}

export function ignoreTendencyPrompt(value: unknown): string {
  const pct = normalizeIgnoreTendency(value);
  return `# СКЛОННОСТЬ К ИГНОРУ
${pct}/100. Это НЕ прямой процент рандома, а характерный вес: выше = чаще оставляет без ответа, медленнее восстанавливает диалог, чаще read/ignore на скуку; ниже = чаще отвечает, даже если коротко.`;
}

/** @deprecated будет удалён вместе с полем vibe в задаче 4.12 */
export function deriveLegacyVibe(_profile: CommunicationProfile): "short" | "warm" {
  void _profile;
  return "warm";
}

export function communicationProfileLabel(profile: CommunicationProfile): string {
  return `notifications=${profile.notifications}, style=${profile.messageStyle}, initiative=${profile.initiative}, life=${profile.lifeSharing}`;
}

export function communicationPromptFragment(profile: CommunicationProfile): string {
  const notifications = profile.notifications === "priority"
    ? "уведомления приоритетные: реагирует быстро на важные сообщения"
    : profile.notifications === "muted"
      ? "уведомления тише: можно отвечать с задержкой"
      : "уведомления обычные";
  const style = profile.messageStyle === "one-liners"
    ? "коротко и по делу, 1-5 слов"
    : profile.messageStyle === "bursty"
      ? "может писать сериями коротких пузырей"
      : profile.messageStyle === "longform"
        ? "может развёрнуто объяснить, когда нужно"
        : "1-3 пузыря разной длины";
  const initiative = profile.initiative === "high"
    ? "часто пишет первой по делу"
    : profile.initiative === "low"
      ? "первой пишет редко"
      : "пишет первой по поводу";
  const life = profile.lifeSharing === "high"
    ? "может делиться рабочим контекстом"
    : profile.lifeSharing === "low"
      ? "личным/рабочим без необходимости не делится"
      : "иногда делится контекстом по работе";
  return `# ТОНКАЯ НАСТРОЙКА ОБЩЕНИЯ
- Уведомления: ${notifications}.
- Стиль сообщений: ${style}.
- Инициатива: ${initiative}.
- Делёжка контекстом: ${life}.

Правила ритма:
- В активном диалоге отвечай быстро. В неактивном — раз в N минут, без неестественной "пропажи".
- Не выдумывай ссылки, имена, цифры — лучше эскалировать боссу.`;
}

export function communicationDecisionState(profile: CommunicationProfile): string {
  return `communication={notifications:${profile.notifications}, messageStyle:${profile.messageStyle}, initiative:${profile.initiative}, lifeSharing:${profile.lifeSharing}}`;
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}
