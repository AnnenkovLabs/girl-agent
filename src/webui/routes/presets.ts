import { Router } from "../http.js";
import { LLM_PRESETS, findPreset } from "../../presets/llm.js";
import { STAGE_PRESETS } from "../../engine/legacy-stage.js";
import { COMMUNICATION_PRESETS } from "../../presets/communication.js";
import { TIMEZONES, findTzByQuery } from "../../data/timezones.js";
import { pickRandomNames } from "../../data/names.js";
import type { Nationality } from "../../types.js";

export function registerPresetRoutes(r: Router): void {
  r.get("/api/presets/llm", () => ({
    presets: LLM_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      proto: p.proto,
      baseURL: p.baseURL,
      defaultModel: p.defaultModel,
      models: p.models ?? [],
      apiKeyRequired: p.apiKeyRequired !== false,
      recommended: !!p.recommended,
      oauth: !!p.oauth,
      hint: p.hint,
      custom: !!p.custom,
      disabled: !!(p as { disabled?: boolean }).disabled,
      disabledReason: (p as { disabledReason?: string }).disabledReason
    }))
  }));

  r.get("/api/presets/llm/:id", ({ params }) => {
    const preset = findPreset(params.id ?? "");
    return { preset: preset ?? null };
  });

  r.get("/api/presets/stages", () => ({
    stages: STAGE_PRESETS.map(s => ({
      id: s.id, num: s.num, label: s.label, description: s.description, defaults: s.defaults
    }))
  }));

  r.get("/api/presets/communication", () => ({
    presets: COMMUNICATION_PRESETS.map(p => ({
      id: p.id, label: p.label, description: p.description, profile: p.profile
    }))
  }));

  r.get("/api/presets/timezones", ({ searchParams }) => {
    const q = searchParams.get("q") ?? "";
    // Без поиска — возвращаем все таймзоны (UA → CIS → RU), фронту нужен полный список.
    const all = q ? findTzByQuery(q, 200) : TIMEZONES;
    return { zones: all.map(t => ({ iana: t.iana, gmtWinter: t.gmtWinter, city: t.city, country: t.country, aliases: t.aliases, group: t.group })) };
  });

  r.get("/api/presets/names", ({ searchParams }) => {
    const nat = (searchParams.get("nationality") as Nationality) ?? "RU";
    const count = Math.max(1, Math.min(40, Number(searchParams.get("count") ?? 12)));
    return { names: pickRandomNames(nat, count) };
  });
}
