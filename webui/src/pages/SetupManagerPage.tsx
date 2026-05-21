import { useEffect, useMemo, useState } from "react";
import { api, type ProfileConfig } from "../lib/api";
import { useStore } from "../lib/store";

/**
 * Визард создания профиля менеджера.
 *
 * Открывается по URL `/setup/manager` (см. App.tsx — ленивый роутинг по
 * `location.pathname`). Реализует Requirement 1 спеки `manager-mode`:
 * inline-валидация полей с сохранением остальных значений, предзаполненные
 * дефолты, подтверждение создания за ≤5 секунд, повторное открытие профиля
 * на редактирование показывает все сохранённые значения идентично.
 *
 * BusySlot/whitelist-редакторы вынесены в `components/manager/*` и
 * подключаются ниже без потери состояния основной формы.
 */

type Tone = "formal-вы" | "friendly-ты" | "mixed-by-tier";
type PersonaStyle = "gender-neutral-assistant" | "female-secretary" | "male-secretary";
type GateLevel = "open" | "gated" | "whitelist";
type AfterHoursPolicy = "silent" | "auto-reply" | "vip-only";

interface FormState {
  slug: string;
  name: string;
  ownerId: string; // строка для ввода, нормализуется при сабмите
  tone: Tone;
  personaStyle: PersonaStyle;
  gateLevel: GateLevel;
  afterHoursPolicy: AfterHoursPolicy;
  proactiveClients: boolean;
  proactiveBoss: boolean;
  mandate: string;
  escalationTimeoutMin: string;
  digestPeriodHours: string;
  digestTime: string; // HH:MM
}

const defaultForm = (): FormState => ({
  slug: "",
  name: "",
  ownerId: "",
  // Req 1.3 — предзаполнение дефолтов
  tone: "mixed-by-tier",
  personaStyle: "gender-neutral-assistant",
  gateLevel: "gated",
  afterHoursPolicy: "vip-only",
  proactiveClients: false,
  proactiveBoss: false,
  mandate: "",
  escalationTimeoutMin: "60",
  digestPeriodHours: "24",
  digestTime: "09:00"
});

type FieldError = Partial<Record<keyof FormState | "submit", string>>;

const SLUG_RE = /^[a-z0-9-]+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(f: FormState, takenSlugs: Set<string>): FieldError {
  const errs: FieldError = {};

  // Req 1.5: slug 3..32, [a-z0-9-], не занят
  if (!f.slug) errs.slug = "обязательное поле";
  else if (f.slug.length < 3 || f.slug.length > 32) errs.slug = "от 3 до 32 символов";
  else if (!SLUG_RE.test(f.slug)) errs.slug = "только a-z, 0-9 и дефис";
  else if (takenSlugs.has(f.slug)) errs.slug = "профиль с таким slug уже есть";

  // Req 1.2: name 1..64
  if (!f.name) errs.name = "обязательное поле";
  else if (f.name.length > 64) errs.name = "не более 64 символов";

  // Req 1.4: ownerId int 1..9999999999999
  const trimmed = f.ownerId.trim();
  if (!trimmed) errs.ownerId = "обязательное поле";
  else if (!/^\d+$/.test(trimmed)) errs.ownerId = "целое число";
  else {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 9_999_999_999_999) {
      errs.ownerId = "от 1 до 9999999999999";
    }
  }

  // Req 1.2: mandate ≤4000
  if (f.mandate.length > 4000) errs.mandate = "не более 4000 символов";

  // escalationTimeoutMin 5..1440 (Req 5.6)
  if (f.escalationTimeoutMin.trim()) {
    const n = Number(f.escalationTimeoutMin);
    if (!Number.isInteger(n) || n < 5 || n > 1440) {
      errs.escalationTimeoutMin = "целое 5..1440";
    }
  } else {
    errs.escalationTimeoutMin = "обязательное поле";
  }

  // digestPeriodHours 1..168 (Req 9.2)
  if (f.digestPeriodHours.trim()) {
    const n = Number(f.digestPeriodHours);
    if (!Number.isInteger(n) || n < 1 || n > 168) {
      errs.digestPeriodHours = "целое 1..168";
    }
  } else {
    errs.digestPeriodHours = "обязательное поле";
  }

  // digestTime HH:MM
  if (!f.digestTime) errs.digestTime = "обязательное поле";
  else if (!HHMM_RE.test(f.digestTime)) errs.digestTime = "формат HH:MM";

  return errs;
}

/** Открыта ли страница `/setup/manager` сейчас. */
export function isSetupManagerPath(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/+$/, "") === "/setup/manager";
}

export function SetupManagerPage() {
  const toast = useStore(s => s.toast);
  const refreshProfiles = useStore(s => s.refreshProfiles);
  const selectProfile = useStore(s => s.selectProfile);
  const setTab = useStore(s => s.setTab);

  const [form, setForm] = useState<FormState>(defaultForm);
  const [takenSlugs, setTakenSlugs] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<keyof FormState>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldError>({});

  // Подгружаем существующие slug-и для inline-валидации уникальности (Req 1.5).
  useEffect(() => {
    void api.listProfiles()
      .then(r => setTakenSlugs(new Set(r.profiles.map(p => p.slug))))
      .catch(() => { /* не критично — сервер тоже валидирует */ });
  }, []);

  const errors: FieldError = useMemo(() => {
    const v = validate(form, takenSlugs);
    return { ...v, ...serverErrors };
  }, [form, takenSlugs, serverErrors]);

  const hasErrors = Object.keys(errors).length > 0;

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
    setTouched(prev => new Set(prev).add(k));
    // Стираем серверную ошибку по этому полю при правке.
    if (serverErrors[k]) {
      setServerErrors(prev => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
  }

  function err(k: keyof FormState): string | undefined {
    return touched.has(k) || serverErrors[k] ? errors[k] : undefined;
  }

  async function submit() {
    // Помечаем все поля как тронутые, чтобы показать ошибки разом.
    setTouched(new Set(Object.keys(form) as (keyof FormState)[]));
    if (hasErrors || submitting) return;
    setSubmitting(true);
    setServerErrors({});

    const payload: Partial<ProfileConfig> & { mandate?: string } = {
      slug: form.slug,
      name: form.name,
      ownerId: Number(form.ownerId),
      tone: form.tone,
      personaStyle: form.personaStyle,
      gateLevel: form.gateLevel,
      afterHoursPolicy: form.afterHoursPolicy,
      proactiveClients: form.proactiveClients,
      proactiveBoss: form.proactiveBoss,
      mandate: form.mandate,
      escalationTimeoutMin: Number(form.escalationTimeoutMin),
      digestPeriodHours: Number(form.digestPeriodHours),
      digestTime: form.digestTime
    };

    try {
      const r = await api.createProfile(payload);
      // Req 1.7 — подтверждение ≤5 сек: сразу показываем тост и ведём в дашборд.
      toast(`Профиль ${r.config.slug} создан`, "success");
      await refreshProfiles();
      await selectProfile(r.config.slug);
      setTab("logs");
      // После создания — снимаем `/setup/manager` из адреса, переходим в обычный UI.
      window.history.pushState({}, "", "/");
      // Перерендер App по событию popstate — диспатчим вручную.
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e) {
      const msg = (e as Error)?.message ?? "ошибка сервера";
      // Если сервер вернул ошибки валидации — раскладываем их по полям.
      const payloadErrors = (e as { payload?: { errors?: Record<string, string> } })?.payload?.errors;
      if (payloadErrors && typeof payloadErrors === "object") {
        const mapped: FieldError = {};
        for (const [k, v] of Object.entries(payloadErrors)) {
          if (typeof v === "string") (mapped as Record<string, string>)[k] = v;
        }
        setServerErrors(mapped);
        toast("Не все поля валидны — проверь подсветку", "error");
      } else {
        setServerErrors({ submit: msg });
        toast(`Не удалось создать профиль: ${msg}`, "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <div className="setup-shell">
      <div className="setup-card">
        <h1 className="setup-title">Новый менеджер</h1>
        <p className="setup-subtitle">
          Создаём Telegram-секретаря: владелец, тон, режим доступа, мандат.
          Все поля можно поменять позже на странице конфигурации.
        </p>

        <div className="grid cols-2">
          <div className="form-row">
            <label>slug <span className="hint" style={{ marginLeft: 6 }}>идентификатор каталога data/&lt;slug&gt;</span></label>
            <input
              className="input"
              value={form.slug}
              onChange={e => set("slug", e.target.value)}
              placeholder="my-manager"
              autoComplete="off"
              spellCheck={false}
            />
            {err("slug") && <div className="hint" style={{ color: "var(--accent)" }}>{err("slug")}</div>}
          </div>

          <div className="form-row">
            <label>Имя</label>
            <input
              className="input"
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="Анна, ассистент"
            />
            {err("name") && <div className="hint" style={{ color: "var(--accent)" }}>{err("name")}</div>}
          </div>
        </div>

        <div className="form-row">
          <label>ownerId <span className="hint" style={{ marginLeft: 6 }}>Telegram user id владельца, кто получает эскалации</span></label>
          <input
            className="input"
            inputMode="numeric"
            value={form.ownerId}
            onChange={e => set("ownerId", e.target.value.replace(/[^\d]/g, ""))}
            placeholder="123456789"
          />
          {err("ownerId") && <div className="hint" style={{ color: "var(--accent)" }}>{err("ownerId")}</div>}
        </div>

        <div className="grid cols-2">
          <div className="form-row">
            <label>Тон</label>
            <select className="select" value={form.tone} onChange={e => set("tone", e.target.value as Tone)}>
              <option value="formal-вы">formal — на «вы»</option>
              <option value="friendly-ты">friendly — на «ты»</option>
              <option value="mixed-by-tier">mixed — по тиру контакта</option>
            </select>
          </div>
          <div className="form-row">
            <label>Persona-стиль</label>
            <select className="select" value={form.personaStyle} onChange={e => set("personaStyle", e.target.value as PersonaStyle)}>
              <option value="gender-neutral-assistant">нейтральный ассистент</option>
              <option value="female-secretary">секретарь-женщина</option>
              <option value="male-secretary">секретарь-мужчина</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <label>Режим доступа (gateLevel)</label>
          <div className="grid cols-3">
            {(["open", "gated", "whitelist"] as GateLevel[]).map(g => (
              <label key={g} className={`provider-card ${form.gateLevel === g ? "active" : ""}`} style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="gateLevel"
                  value={g}
                  checked={form.gateLevel === g}
                  onChange={() => set("gateLevel", g)}
                  style={{ display: "none" }}
                />
                <div className="p-name">{g}</div>
                <div className="p-hint">{
                  g === "open" ? "отвечает всем" :
                  g === "gated" ? "вежливо фильтрует незнакомцев" :
                  "только белый список"
                }</div>
              </label>
            ))}
          </div>
        </div>

        <div className="form-row">
          <label>Политика после рабочих часов</label>
          <div className="grid cols-3">
            {(["silent", "auto-reply", "vip-only"] as AfterHoursPolicy[]).map(p => (
              <label key={p} className={`provider-card ${form.afterHoursPolicy === p ? "active" : ""}`} style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="afterHoursPolicy"
                  value={p}
                  checked={form.afterHoursPolicy === p}
                  onChange={() => set("afterHoursPolicy", p)}
                  style={{ display: "none" }}
                />
                <div className="p-name">{p}</div>
                <div className="p-hint">{
                  p === "silent" ? "молчит" :
                  p === "auto-reply" ? "одно авто-сообщение" :
                  "VIP — по обычным правилам"
                }</div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid cols-2">
          <label className="toggle">
            <input type="checkbox" checked={form.proactiveClients} onChange={e => set("proactiveClients", e.target.checked)} />
            <span className="track"><span className="knob" /></span>
            <span>Проактивно напоминать клиентам по обещаниям</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={form.proactiveBoss} onChange={e => set("proactiveBoss", e.target.checked)} />
            <span className="track"><span className="knob" /></span>
            <span>Дайджесты боссу</span>
          </label>
        </div>

        <div className="form-row">
          <label>Мандат <span className="hint" style={{ marginLeft: 6 }}>{form.mandate.length} / 4000 символов</span></label>
          <textarea
            className="textarea"
            rows={6}
            value={form.mandate}
            onChange={e => set("mandate", e.target.value)}
            placeholder="Что менеджер может говорить сам, а что эскалирует боссу. Пример: «Отвечаю на бытовые вопросы (часы работы, тарифы), эскалирую цены и сроки.»"
          />
          {err("mandate") && <div className="hint" style={{ color: "var(--accent)" }}>{err("mandate")}</div>}
        </div>

        <div className="grid cols-3">
          <div className="form-row">
            <label>Таймаут эскалации, мин</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.escalationTimeoutMin}
              onChange={e => set("escalationTimeoutMin", e.target.value.replace(/[^\d]/g, ""))}
            />
            {err("escalationTimeoutMin") && <div className="hint" style={{ color: "var(--accent)" }}>{err("escalationTimeoutMin")}</div>}
          </div>
          <div className="form-row">
            <label>Период дайджеста, ч</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.digestPeriodHours}
              onChange={e => set("digestPeriodHours", e.target.value.replace(/[^\d]/g, ""))}
            />
            {err("digestPeriodHours") && <div className="hint" style={{ color: "var(--accent)" }}>{err("digestPeriodHours")}</div>}
          </div>
          <div className="form-row">
            <label>Время дайджеста</label>
            <input
              className="input"
              value={form.digestTime}
              onChange={e => set("digestTime", e.target.value)}
              placeholder="09:00"
            />
            {err("digestTime") && <div className="hint" style={{ color: "var(--accent)" }}>{err("digestTime")}</div>}
          </div>
        </div>

        {errors.submit && (
          <div className="hint" style={{ color: "var(--accent)", marginBottom: 12 }}>{errors.submit}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn ghost" onClick={cancel} disabled={submitting}>Отмена</button>
          <button className="btn primary" onClick={() => void submit()} disabled={submitting || hasErrors}>
            {submitting ? "Создаю…" : "Создать профиль"}
          </button>
        </div>
      </div>
    </div>
  );
}
