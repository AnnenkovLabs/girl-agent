import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { api, type LLMPreset, type StagePreset, type CommunicationPreset, type ProfileConfig } from "../lib/api";
import { MIN_AGE, MAX_AGE, DEFAULT_AGE, clampAge } from "../lib/age-config";

const TOURNAMENT_ROUNDS = 12;

type TzZone = { iana: string; gmtWinter: string; city: string; country: string; aliases: string[]; group?: "UA" | "CIS" | "RU" };

interface DraftState {
  mode: "simple" | "advanced";
  step: number;
  // form
  name: string;
  age: number;
  nationality: "RU" | "UA";
  tz: string;
  tgMode: "bot" | "userbot";
  botToken: string;
  // userbot
  userbotMethod: "proxy" | "own";
  apiId: string;
  apiHash: string;
  phone: string;
  // login session refs
  loginToken?: string;
  loginSessionId?: string;
  code: string;
  password2fa: string;
  needs2fa: boolean;
  sessionString?: string;
  // llm
  llmPresetId: string;
  llmModel: string;
  llmApiKey: string;
  llmBaseURL: string;
  // misc
  stage: string;
  communicationId: string;
  ignoreTendency: number;
  sleepFrom: number;
  sleepTo: number;
  nightWakeChance: number;
  ownerId: string;
  privacy: "owner-only" | "allow-strangers";
  proxy: string;
  personaNotes: string;
  generating: boolean;
  generated: boolean;
  // ux
  sendingCode: boolean;
  verifying: boolean;
  tgError?: string;
}

const defaultDraft = (): DraftState => ({
  mode: "simple",
  step: 0,
  name: "",
  age: DEFAULT_AGE,
  nationality: "RU",
  tz: "Europe/Kyiv",
  tgMode: "bot",
  botToken: "",
  userbotMethod: "proxy",
  apiId: "",
  apiHash: "",
  phone: "",
  code: "",
  password2fa: "",
  needs2fa: false,
  llmPresetId: "claudehub",
  llmModel: "claude-sonnet-4.6",
  llmApiKey: "",
  llmBaseURL: "",
  stage: "tg-given-cold",
  communicationId: "normal",
  ignoreTendency: 35,
  sleepFrom: 23,
  sleepTo: 8,
  nightWakeChance: 0.05,
  ownerId: "",
  privacy: "owner-only",
  proxy: "",
  personaNotes: "",
  generating: false,
  generated: false,
  sendingCode: false,
  verifying: false
});

// Шаги. Любые шаги, перечисленные тут, идут в порядке. tg-userbot-code появляется
// динамически, когда пользователь ввёл телефон — добавляем в "advanced" режим
// только если он реально нужен.
const SIMPLE_STEPS = ["mode", "tg", "tg-userbot-code", "llm", "persona", "ready", "generating"] as const;
const ADV_STEPS = ["mode", "name", "tg", "tg-userbot-code", "llm", "api-config", "stage", "comm", "sleep", "owner", "tz", "persona", "ready", "generating"] as const;

export function SetupFlow() {
  const showSetupFlow = useStore(s => s.showSetupFlow);
  const refreshProfiles = useStore(s => s.refreshProfiles);
  const selectProfile = useStore(s => s.selectProfile);
  const setTab = useStore(s => s.setTab);
  const toast = useStore(s => s.toast);

  const [d, setD] = useState<DraftState>(defaultDraft());
  const [llmPresets, setLLMPresets] = useState<LLMPreset[]>([]);
  const [stages, setStages] = useState<StagePreset[]>([]);
  const [comms, setComms] = useState<CommunicationPreset[]>([]);
  const [namePool, setNamePool] = useState<string[]>([]);
  const [tzZones, setTzZones] = useState<TzZone[]>([]);
  const [tzQuery, setTzQuery] = useState("");
  const [tzOpen, setTzOpen] = useState(false);
  const tzRef = useRef<HTMLDivElement>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // tournament state
  type TournamentState = {
    active: boolean;
    phase: "qualifier" | "knockout";
    round: number;
    pair: [string, string];
    qualifiers: string[];
    pool: string[];
    seen: Set<string>;
  };
  const [t, setT] = useState<TournamentState>({
    active: false, phase: "qualifier", round: 0, pair: ["", ""], qualifiers: [], pool: [], seen: new Set()
  });

  useEffect(() => {
    void api.listLLMPresets().then(r => setLLMPresets(r.presets));
    void api.listStages().then(r => setStages(r.stages));
    void api.listCommunicationPresets().then(r => setComms(r.presets));
    void api.listTimezones("").then(r => setTzZones(r.zones));
  }, []);

  useEffect(() => {
    void api.pickNames(d.nationality, 8).then(r => {
      setNamePool(r.names);
      if (!d.name && r.names.length) setD(s => ({ ...s, name: r.names[0] }));
    });
    // Если ещё не выбрали tz — поставим дефолтную для национальности.
    if (d.tz === "Europe/Moscow" && d.nationality === "UA") setD(s => ({ ...s, tz: "Europe/Kyiv" }));
  }, [d.nationality]);

  useEffect(() => {
    // Закрытие tz-дропдауна по клику снаружи.
    function onDocClick(e: MouseEvent) {
      if (tzRef.current && !tzRef.current.contains(e.target as Node)) setTzOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Динамически собираем список шагов: tg-userbot-code включаем только если режим userbot.
  const stepIds = useMemo(() => {
    const list = (d.mode === "advanced" ? ADV_STEPS : SIMPLE_STEPS) as readonly string[];
    return list.filter(s => {
      if (s === "tg-userbot-code") return d.tgMode === "userbot" && !d.sessionString;
      if (s === "api-config") return d.mode === "advanced";
      return true;
    });
  }, [d.mode, d.tgMode, d.sessionString]);

  const totalSteps = stepIds.length;
  const currentStep = stepIds[d.step] ?? "ready";

  const canNext = useMemo(() => stepValid(currentStep, d), [currentStep, d]);

  function set<K extends keyof DraftState>(k: K, v: DraftState[K]) {
    setD(prev => ({ ...prev, [k]: v }));
  }

  function patch(p: Partial<DraftState>) {
    setD(prev => ({ ...prev, ...p }));
  }

  // === Tournament ===
  function pickPair(exclude: Set<string>, pool: string[]): [string, string] | null {
    const avail = pool.filter(n => !exclude.has(n));
    if (avail.length < 2) return null;
    const a = avail[Math.floor(Math.random() * avail.length)]!;
    let b = avail[Math.floor(Math.random() * avail.length)]!;
    while (b === a) b = avail[Math.floor(Math.random() * avail.length)]!;
    return [a, b];
  }

  async function startTournament() {
    try {
      // забираем 24 имени для качественного турнира
      const r = await api.pickNames(d.nationality, 24);
      const pool = r.names;
      const pair = pickPair(new Set(), pool);
      if (!pair) {
        toast("Не удалось собрать пул имён", "error");
        return;
      }
      const seen = new Set([pair[0], pair[1]]);
      setT({ active: true, phase: "qualifier", round: 0, pair, qualifiers: [], pool, seen });
    } catch (e) {
      toast(`Не удалось запустить турнир: ${(e as Error)?.message}`, "error");
    }
  }

  function pickWinner(winner: string) {
    if (t.phase === "qualifier") {
      const qualifiers = [...t.qualifiers, winner];
      const nextRound = t.round + 1;
      if (nextRound >= TOURNAMENT_ROUNDS || qualifiers.length >= 8) {
        // Переход в knockout (или сразу финал).
        if (qualifiers.length === 1) {
          set("name", qualifiers[0]!);
          setT({ active: false, phase: "qualifier", round: 0, pair: ["", ""], qualifiers: [], pool: [], seen: new Set() });
          return;
        }
        const shuffled = [...qualifiers].sort(() => Math.random() - 0.5);
        const koPair: [string, string] = [shuffled[0]!, shuffled[1]!];
        setT(s => ({ ...s, phase: "knockout", round: 0, pair: koPair, qualifiers, pool: shuffled, seen: new Set(shuffled) }));
        return;
      }
      const seen = new Set([...t.seen, winner]);
      const next = pickPair(seen, t.pool) ?? pickPair(new Set(), t.pool);
      if (!next) {
        // не хватило пула — финал
        if (qualifiers.length === 1) set("name", qualifiers[0]!);
        else if (qualifiers.length > 1) {
          setT(s => ({ ...s, phase: "knockout", round: 0, pair: [qualifiers[0]!, qualifiers[1]!], qualifiers, pool: qualifiers, seen: new Set(qualifiers) }));
        }
        return;
      }
      setT({ active: true, phase: "qualifier", round: nextRound, pair: next, qualifiers, pool: t.pool, seen });
    } else {
      // knockout
      const loser = t.pair[0] === winner ? t.pair[1] : t.pair[0];
      const nextPool = t.pool.filter(n => n !== loser);
      if (nextPool.length <= 1) {
        set("name", nextPool[0] ?? winner);
        setT({ active: false, phase: "qualifier", round: 0, pair: ["", ""], qualifiers: [], pool: [], seen: new Set() });
        return;
      }
      const shuffled = [...nextPool].sort(() => Math.random() - 0.5);
      setT(s => ({ ...s, round: s.round + 1, pair: [shuffled[0]!, shuffled[1]!], pool: nextPool }));
    }
  }

  function skipPair() {
    const next = pickPair(t.seen, t.pool) ?? pickPair(new Set(), t.pool);
    if (next) setT(s => ({ ...s, pair: next, seen: new Set([...s.seen, next[0], next[1]]) }));
  }

  // === userbot login ===
  async function sendCode() {
    if (d.sendingCode) return;
    patch({ sendingCode: true, tgError: undefined });
    try {
      const useRemote = d.userbotMethod === "proxy";
      const apiId = useRemote ? undefined : Number(d.apiId);
      const apiHash = useRemote ? undefined : d.apiHash;
      const r = await api.tgSendCode({ phone: d.phone, useRemote, apiId, apiHash });
      patch({ loginToken: r.loginToken, loginSessionId: r.sessionId, sendingCode: false });
      toast("Код отправлен в Telegram", "success");
    } catch (e) {
      patch({ sendingCode: false, tgError: (e as Error)?.message });
      toast(`Не удалось отправить код: ${(e as Error)?.message}`, "error");
    }
  }

  async function verifyCode() {
    if (d.verifying) return;
    patch({ verifying: true, tgError: undefined });
    try {
      const r = await api.tgVerifyCode({ code: d.code, loginToken: d.loginToken, sessionId: d.loginSessionId });
      if (r.needs2fa) {
        patch({ needs2fa: true, loginToken: r.loginToken, loginSessionId: r.sessionId, verifying: false });
        toast("Введи пароль от облака Telegram (2FA)", "info");
        return;
      }
      if (r.sessionString) {
        patch({
          sessionString: r.sessionString,
          apiId: r.apiId ? String(r.apiId) : d.apiId,
          apiHash: r.apiHash ?? d.apiHash,
          verifying: false,
          needs2fa: false
        });
        toast("Логин успешен", "success");
        // Следующий шаг
        setD(s => ({ ...s, step: s.step + 1 }));
      }
    } catch (e) {
      patch({ verifying: false, tgError: (e as Error)?.message });
      toast(`Ошибка кода: ${(e as Error)?.message}`, "error");
    }
  }

  async function verify2fa() {
    if (d.verifying) return;
    patch({ verifying: true, tgError: undefined });
    try {
      const r = await api.tgVerifyPassword({ password: d.password2fa, loginToken: d.loginToken, sessionId: d.loginSessionId });
      patch({
        sessionString: r.sessionString,
        apiId: String(r.apiId),
        apiHash: r.apiHash,
        verifying: false,
        needs2fa: false
      });
      toast("Логин успешен", "success");
      setD(s => ({ ...s, step: s.step + 1 }));
    } catch (e) {
      patch({ verifying: false, tgError: (e as Error)?.message });
      toast(`Ошибка пароля: ${(e as Error)?.message}`, "error");
    }
  }

  async function createProfile(): Promise<ProfileConfig | null> {
    if (savingProfile) return null;
    setSavingProfile(true);
    try {
      const llmPreset = llmPresets.find(p => p.id === d.llmPresetId);
      const comm = comms.find(c => c.id === d.communicationId);
      const tgConfig: ProfileConfig["telegram"] = d.tgMode === "bot"
        ? { botToken: d.botToken, useWSS: true, proxy: d.proxy || undefined }
        : {
            apiId: d.apiId ? Number(d.apiId) : undefined,
            apiHash: d.apiHash || undefined,
            phone: d.phone || undefined,
            sessionString: d.sessionString || undefined,
            useWSS: true,
            proxy: d.proxy || undefined
          };
      const data: Partial<ProfileConfig> = {
        name: d.name,
        age: d.age,
        nationality: d.nationality,
        tz: d.tz,
        mode: d.tgMode,
        stage: d.stage,
        privacy: d.privacy,
        ownerId: d.ownerId ? Number(d.ownerId) : undefined,
        personaNotes: d.personaNotes || undefined,
        ignoreTendency: d.ignoreTendency,
        sleepFrom: d.sleepFrom,
        sleepTo: d.sleepTo,
        nightWakeChance: d.nightWakeChance,
        communication: comm?.profile,
        telegram: tgConfig,
        llm: {
          presetId: d.llmPresetId,
          proto: llmPreset?.proto ?? "openai",
          baseURL: d.llmBaseURL || llmPreset?.baseURL,
          model: d.llmModel || llmPreset?.defaultModel || "",
          apiKey: d.llmApiKey
        }
      };
      const r = await api.createProfile(data);
      return r.config;
    } catch (e) {
      toast(`Не удалось создать: ${(e as Error)?.message}`, "error");
      return null;
    } finally {
      setSavingProfile(false);
    }
  }

  async function generatePersona(slug: string) {
    set("generating", true);
    try {
      await api.generatePersona(slug, { name: d.name, age: d.age, nationality: d.nationality, notes: d.personaNotes });
      set("generated", true);
      toast("Персона сгенерирована", "success");
    } catch (e) {
      toast(`Генерация не удалась: ${(e as Error)?.message}`, "error");
    } finally {
      set("generating", false);
    }
  }

  async function startGeneration() {
    const cfg = await createProfile();
    if (!cfg) return;
    await refreshProfiles();
    await selectProfile(cfg.slug);
    // Переходим на шаг «generating» и запускаем генерацию
    await generatePersona(cfg.slug);
    try {
      await api.applyProfile(cfg.slug);
      toast("Рантайм запущен", "success");
    } catch (e) {
      toast(`Запуск не удался — проверь токены: ${(e as Error)?.message}`, "error");
    }
  }

  function finishAndClose() {
    showSetupFlow(false);
    setTab("logs");
  }

  function next() {
    if (d.step < totalSteps - 1) {
      const nextStep = stepIds[d.step + 1];
      if (nextStep === "generating") {
        set("step", d.step + 1);
        void startGeneration();
      } else {
        set("step", d.step + 1);
      }
    } else {
      finishAndClose();
    }
  }

  function back() {
    if (d.step > 0) set("step", d.step - 1);
  }

  // === tz dropdown ===
  const tzFiltered = useMemo(() => {
    const q = tzQuery.trim().toLowerCase();
    if (!q) return tzZones;
    return tzZones.filter(t => {
      if (t.iana.toLowerCase().includes(q)) return true;
      if (t.city.toLowerCase().includes(q)) return true;
      if (t.country.toLowerCase().includes(q)) return true;
      return t.aliases.some(a => a.toLowerCase().includes(q));
    });
  }, [tzZones, tzQuery]);

  // Группируем для красивого вывода
  const tzGroups = useMemo(() => {
    const groups: { group: "UA" | "CIS" | "RU" | "other"; zones: TzZone[] }[] = [];
    const map = new Map<string, TzZone[]>();
    for (const z of tzFiltered) {
      const g = z.group ?? "other";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(z);
    }
    for (const g of ["UA", "CIS", "RU", "other"] as const) {
      const zs = map.get(g);
      if (zs && zs.length) groups.push({ group: g as any, zones: zs });
    }
    return groups;
  }, [tzFiltered]);

  const selectedTz = tzZones.find(z => z.iana === d.tz);

  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="setup-stepper">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className={`setup-step ${i < d.step ? "done" : ""} ${i === d.step ? "active" : ""}`} />
          ))}
        </div>

        {currentStep === "mode" && (
          <>
            <h1 className="setup-title">Привет 👋</h1>
            <p className="setup-subtitle">Создаём твой первый профиль. Выберите формат настройки.</p>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className={`provider-card ${d.mode === "simple" ? "active" : ""}`} onClick={() => set("mode", "simple")}>
                <div className="p-name">Просто</div>
                <div className="p-hint">~3 минуты. 5 шагов. Имя и часовой пояс подберём за тебя.</div>
              </div>
              <div className={`provider-card ${d.mode === "advanced" ? "active" : ""}`} onClick={() => set("mode", "advanced")}>
                <div className="p-name">Подробно</div>
                <div className="p-hint">~7 минут. Полный контроль: сон, общение, owner, прокси, заметки.</div>
              </div>
            </div>
          </>
        )}

        {currentStep === "name" && (
          <>
            <h1 className="setup-title">Имя и возраст</h1>
            <p className="setup-subtitle">Это девушка, которая будет тебе писать.</p>
            <div className="grid cols-2">
              <div className="form-row">
                <label>Национальность</label>
                <select className="select" value={d.nationality} onChange={e => set("nationality", e.target.value as "RU" | "UA")}>
                  <option value="RU">Россия</option>
                  <option value="UA">Україна</option>
                </select>
              </div>
              <div className="form-row">
                <label>Возраст</label>
                <div className="age-slider-wrap">
                  <div className="age-slider-value">{d.age}<span className="age-unit">лет</span></div>
                  <input type="range" min={MIN_AGE} max={MAX_AGE} className="range" value={d.age} onChange={e => set("age", clampAge(Number(e.target.value)))} />
                  <div className="age-slider-bounds"><span>{MIN_AGE}</span><span>{MAX_AGE}</span></div>
                </div>
              </div>
            </div>

            {!t.active ? (
              <>
                <div className="form-row">
                  <label>Имя</label>
                  <input className="input" value={d.name} onChange={e => set("name", e.target.value)} placeholder="например, Алина" />
                </div>
                {namePool.length > 0 && (
                  <div className="form-row">
                    <label>Случайные варианты</label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {namePool.map(n => (
                        <button key={n} className="btn tiny ghost" onClick={() => set("name", n)}>{n}</button>
                      ))}
                      <button className="btn tiny ghost" onClick={() => { void api.pickNames(d.nationality, 8).then(r => setNamePool(r.names)); }}>↻ ещё</button>
                    </div>
                  </div>
                )}
                <div className="form-row">
                  <button className="btn ghost" onClick={() => void startTournament()}>🎲 Турнир имён — будут показывать пары имён, выбираешь интуитивно</button>
                </div>
              </>
            ) : (
              <div className="tournament-shell">
                <div className="tournament-progress">
                  {Array.from({ length: t.phase === "qualifier" ? TOURNAMENT_ROUNDS : Math.max(t.pool.length - 1, 1) }, (_, i) => (
                    <div key={i} className={`dot ${i < t.round ? "done" : ""} ${i === t.round ? "active" : ""}`} />
                  ))}
                </div>
                <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  {t.phase === "qualifier" ? `квалификация ${t.round + 1}/${TOURNAMENT_ROUNDS}` : `⚔ турнир выживших · осталось ${t.pool.length}`}
                </div>
                <div className="tournament-pair">
                  <div className="tournament-name-card" onClick={() => pickWinner(t.pair[0])}>{t.pair[0]}</div>
                  <div className="tournament-name-card" onClick={() => pickWinner(t.pair[1])}>{t.pair[1]}</div>
                </div>
                {t.phase === "qualifier" && (
                  <div className="tournament-skip" onClick={skipPair}>↻ обе мимо — следующая пара</div>
                )}
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)" }}>
                  прошли: {t.qualifiers.join(", ") || "—"}
                </div>
                <div style={{ textAlign: "center" }}>
                  <button className="btn ghost tiny" onClick={() => setT({ active: false, phase: "qualifier", round: 0, pair: ["", ""], qualifiers: [], pool: [], seen: new Set() })}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {currentStep === "tg" && (
          <>
            <h1 className="setup-title">Telegram</h1>
            <p className="setup-subtitle">Подключаем девушку к мессенджеру.</p>
            <div className="form-row">
              <label>Режим</label>
              <div className="grid cols-2" style={{ gap: 8 }}>
                <div className={`provider-card ${d.tgMode === "bot" ? "active" : ""}`} onClick={() => set("tgMode", "bot")}>
                  <div className="p-name">Бот</div>
                  <div className="p-hint">Рекомендуется. Нужен токен от @BotFather. Никаких номеров.</div>
                  {d.tgMode === "bot" && <div className="p-rec">REC</div>}
                </div>
                <div className={`provider-card ${d.tgMode === "userbot" ? "active" : ""}`} onClick={() => set("tgMode", "userbot")}>
                  <div className="p-name">Юзербот</div>
                  <div className="p-hint">Заходит как обычный TG-аккаунт. Нужен номер телефона + код.</div>
                </div>
              </div>
            </div>
            {d.tgMode === "bot" ? (
              <div className="form-row">
                <label>Bot Token</label>
                <input className="input" type="password" value={d.botToken} onChange={e => set("botToken", e.target.value)} placeholder="123456789:AAFxxxxxxxxx" />
                <div className="hint">
                  1. Открой <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a><br />
                  2. Команда /newbot, придумай имя и username<br />
                  3. Скопируй токен сюда
                </div>
              </div>
            ) : (
              <>
                <div className="form-row">
                  <label>Способ входа</label>
                  <div className="grid cols-2" style={{ gap: 8 }}>
                    <div className={`provider-card ${d.userbotMethod === "proxy" ? "active" : ""}`} onClick={() => set("userbotMethod", "proxy")}>
                      <div className="p-name">Через прокси автора</div>
                      <div className="p-hint">Не нужны свои api_id/api_hash — используем серверный прокси.</div>
                      {d.userbotMethod === "proxy" && <div className="p-rec">REC</div>}
                    </div>
                    <div className={`provider-card ${d.userbotMethod === "own" ? "active" : ""}`} onClick={() => set("userbotMethod", "own")}>
                      <div className="p-name">Свои api_id/hash</div>
                      <div className="p-hint">Возьми на my.telegram.org → API Development tools.</div>
                    </div>
                  </div>
                </div>
                {d.userbotMethod === "own" && (
                  <div className="grid cols-2">
                    <div className="form-row"><label>API ID</label><input className="input" value={d.apiId} onChange={e => set("apiId", e.target.value)} /></div>
                    <div className="form-row"><label>API Hash</label><input className="input" type="password" value={d.apiHash} onChange={e => set("apiHash", e.target.value)} /></div>
                  </div>
                )}
                <div className="form-row">
                  <label>Телефон</label>
                  <input className="input" value={d.phone} onChange={e => set("phone", e.target.value)} placeholder="+79..." />
                  <div className="hint">На следующем шаге придёт код в Telegram.</div>
                </div>
              </>
            )}
          </>
        )}

        {currentStep === "tg-userbot-code" && (
          <>
            <h1 className="setup-title">Код из Telegram</h1>
            <p className="setup-subtitle">Запрашиваем код подтверждения на номер <strong>{d.phone}</strong>.</p>

            {!d.loginToken && !d.loginSessionId ? (
              <div className="form-row">
                <button className="btn primary" onClick={() => void sendCode()} disabled={d.sendingCode || !d.phone}>
                  {d.sendingCode ? "Отправляю…" : "Отправить код"}
                </button>
                {d.tgError && <div className="hint" style={{ color: "var(--accent)" }}>{d.tgError}</div>}
              </div>
            ) : !d.needs2fa ? (
              <>
                <div className="form-row">
                  <label>Код из Telegram (5 цифр)</label>
                  <input className="code-input" inputMode="numeric" maxLength={6} value={d.code} onChange={e => set("code", e.target.value.replace(/\D/g, ""))} placeholder="12345" />
                </div>
                <div className="form-row" style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" onClick={() => void verifyCode()} disabled={d.verifying || d.code.length < 4}>
                    {d.verifying ? "Проверяю…" : "Подтвердить"}
                  </button>
                  <button className="btn ghost" onClick={() => { patch({ loginToken: undefined, loginSessionId: undefined, code: "", needs2fa: false }); }}>Отправить заново</button>
                </div>
                {d.tgError && <div className="hint" style={{ color: "var(--accent)" }}>{d.tgError}</div>}
              </>
            ) : (
              <>
                <div className="form-row">
                  <label>Пароль от облака Telegram (2FA)</label>
                  <input className="input" type="password" value={d.password2fa} onChange={e => set("password2fa", e.target.value)} placeholder="••••••" />
                </div>
                <button className="btn primary" onClick={() => void verify2fa()} disabled={d.verifying || !d.password2fa}>
                  {d.verifying ? "Проверяю…" : "Войти"}
                </button>
                {d.tgError && <div className="hint" style={{ color: "var(--accent)" }}>{d.tgError}</div>}
              </>
            )}
          </>
        )}

        {currentStep === "llm" && (
          <>
            <h1 className="setup-title">LLM-провайдер</h1>
            <p className="setup-subtitle">«Мозги» девушки. Из РФ без VPN: ClaudeHub.</p>
            <div className="form-row">
              <label>Провайдер</label>
              <div className="provider-grid">
                {llmPresets.map(p => (
                  <div
                    key={p.id}
                    className={`provider-card ${d.llmPresetId === p.id ? "active" : ""} ${p.disabled ? "disabled" : ""}`}
                    onClick={() => {
                      if (p.disabled) return;
                      patch({ llmPresetId: p.id, llmModel: p.defaultModel, llmBaseURL: p.baseURL ?? "" });
                    }}
                  >
                    <div className="p-name">{p.name}</div>
                    <div className="p-hint">{p.hint ?? (p.disabled ? p.disabledReason : "")}</div>
                    {p.recommended && !p.disabled && <div className="p-rec">REC</div>}
                    {p.disabled && <div className="p-tag">N/A</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>Модель</label>
              {(() => {
                const p = llmPresets.find(x => x.id === d.llmPresetId);
                return p?.models?.length
                  ? <select className="select" value={d.llmModel} onChange={e => set("llmModel", e.target.value)}>{p.models.map(m => <option key={m} value={m}>{m}</option>)}</select>
                  : <input className="input" value={d.llmModel} onChange={e => set("llmModel", e.target.value)} />;
              })()}
            </div>
            {(llmPresets.find(p => p.id === d.llmPresetId)?.apiKeyRequired !== false) && (
              <div className="form-row">
                <label>API Key</label>
                <input className="input" type="password" value={d.llmApiKey} onChange={e => set("llmApiKey", e.target.value)} />
              </div>
            )}
            {(llmPresets.find(p => p.id === d.llmPresetId)?.custom) && (
              <div className="form-row">
                <label>Base URL</label>
                <input className="input" value={d.llmBaseURL} onChange={e => set("llmBaseURL", e.target.value)} placeholder="https://..." />
              </div>
            )}
          </>
        )}

        {currentStep === "api-config" && (
          <>
            <h1 className="setup-title">Настройка API</h1>
            <p className="setup-subtitle">Детальная настройка подключения к {llmPresets.find(p => p.id === d.llmPresetId)?.name ?? d.llmPresetId}.</p>
            <div className="form-row">
              <label>Модель</label>
              {(() => {
                const p = llmPresets.find(x => x.id === d.llmPresetId);
                return p?.models?.length
                  ? <select className="select" value={d.llmModel} onChange={e => set("llmModel", e.target.value)}>{p.models.map(m => <option key={m} value={m}>{m}</option>)}</select>
                  : <input className="input" value={d.llmModel} onChange={e => set("llmModel", e.target.value)} placeholder="claude-sonnet-4.6, gpt-4o, и т.д." />;
              })()}
            </div>
            <div className="form-row">
              <label>API Key</label>
              <input className="input" type="password" value={d.llmApiKey} onChange={e => set("llmApiKey", e.target.value)} placeholder="sk-..." />
              <div className="hint">Ключ от провайдера. ClaudeHub — не нужен.</div>
            </div>
            <div className="form-row">
              <label>Base URL</label>
              <input className="input" value={d.llmBaseURL} onChange={e => set("llmBaseURL", e.target.value)} placeholder={llmPresets.find(p => p.id === d.llmPresetId)?.baseURL ?? "https://api.openai.com/v1"} />
              <div className="hint">URL API-эндпоинта. Пустое = по умолчанию для провайдера.</div>
            </div>
            <div className="form-row">
              <label>Протокол</label>
              <div style={{ display: "flex", gap: 8 }}>
                <div className={`provider-card ${(llmPresets.find(p => p.id === d.llmPresetId)?.proto ?? "openai") === "openai" ? "active" : ""}`} style={{ flex: 1, cursor: "default" }}>
                  <div className="p-name">{llmPresets.find(p => p.id === d.llmPresetId)?.proto ?? "openai"}</div>
                  <div className="p-hint">Определяется провайдером</div>
                </div>
              </div>
            </div>
          </>
        )}

        {currentStep === "stage" && (
          <>
            <h1 className="setup-title">Стадия отношений</h1>
            <p className="setup-subtitle">9 уровней — от «только что обменялись тг» до «давно вместе».</p>
            <div className="form-row">
              <select className="select" value={d.stage} onChange={e => set("stage", e.target.value)}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.num}. {s.label}</option>)}
              </select>
              <div className="hint">{stages.find(s => s.id === d.stage)?.description}</div>
            </div>
          </>
        )}

        {currentStep === "comm" && (
          <>
            <h1 className="setup-title">Стиль общения</h1>
            <p className="setup-subtitle">Какой характер у девушки.</p>
            <div className="provider-grid">
              {comms.map(c => (
                <div key={c.id} className={`provider-card ${d.communicationId === c.id ? "active" : ""}`} onClick={() => set("communicationId", c.id)}>
                  <div className="p-name">{c.label}</div>
                  <div className="p-hint">{c.description}</div>
                </div>
              ))}
            </div>
            <div className="form-row" style={{ marginTop: 12 }}>
              <label>Тенденция игнора: {d.ignoreTendency}%</label>
              <input type="range" min={0} max={100} className="range" value={d.ignoreTendency} onChange={e => set("ignoreTendency", Number(e.target.value))} />
              <div className="hint">Чем выше — тем чаще пропускает сообщения, отвечает позже.</div>
            </div>
          </>
        )}

        {currentStep === "sleep" && (
          <>
            <h1 className="setup-title">Расписание</h1>
            <p className="setup-subtitle">Когда она спит и не отвечает.</p>
            <div className="grid cols-2">
              <div className="form-row">
                <label>Засыпает в: {d.sleepFrom}:00</label>
                <input type="range" min={20} max={26} className="range" value={d.sleepFrom > 23 ? d.sleepFrom - 24 : d.sleepFrom} onChange={e => set("sleepFrom", (Number(e.target.value) + 24) % 24)} />
                <div className="hint">обычно 23–02 ночи</div>
              </div>
              <div className="form-row">
                <label>Просыпается в: {d.sleepTo}:00</label>
                <input type="range" min={5} max={12} className="range" value={d.sleepTo} onChange={e => set("sleepTo", Number(e.target.value))} />
                <div className="hint">обычно 7–10 утра</div>
              </div>
            </div>
            <div className="form-row">
              <label>Шанс «проснулась ночью»: {Math.round(d.nightWakeChance * 100)}%</label>
              <input type="range" min={0} max={20} className="range" value={Math.round(d.nightWakeChance * 100)} onChange={e => set("nightWakeChance", Number(e.target.value) / 100)} />
            </div>
          </>
        )}

        {currentStep === "owner" && (
          <>
            <h1 className="setup-title">Кому отвечать</h1>
            <p className="setup-subtitle">Чтобы бот не отвечал случайным людям.</p>
            <div className="form-row">
              <label>Privacy</label>
              <select className="select" value={d.privacy} onChange={e => set("privacy", e.target.value as "owner-only" | "allow-strangers")}>
                <option value="owner-only">только владельцу</option>
                <option value="allow-strangers">всем</option>
              </select>
            </div>
            <div className="form-row">
              <label>Owner Telegram ID</label>
              <input className="input" type="number" value={d.ownerId} onChange={e => set("ownerId", e.target.value)} placeholder="напиши боту /start чтобы узнать" />
              <div className="hint">Можно оставить пустым: при первой команде /start бот сам подскажет твой id.</div>
            </div>
            {d.tgMode === "userbot" && (
              <div className="form-row">
                <label>Прокси для юзербота (опционально)</label>
                <input className="input" value={d.proxy} onChange={e => set("proxy", e.target.value)} placeholder="socks5://login:pass@host:port" />
                <div className="hint">Если оставить пусто и есть GIRL_AGENT_TG_PROXY — будет использоваться он.</div>
              </div>
            )}
          </>
        )}

        {currentStep === "tz" && (
          <>
            <h1 className="setup-title">Часовой пояс</h1>
            <p className="setup-subtitle">Чтобы её рабочие часы и сон были по твоему времени.</p>
            <div className="form-row">
              <div className="tz-dropdown" ref={tzRef}>
                <div className="tz-input" onClick={() => setTzOpen(!tzOpen)}>
                  {selectedTz
                    ? <><span className="tz-city">{selectedTz.city}, {selectedTz.country}</span><span className="tz-gmt">{selectedTz.gmtWinter} · {selectedTz.iana}</span></>
                    : <span style={{ color: "var(--muted)" }}>Выбери город…</span>
                  }
                </div>
                {tzOpen && (
                  <div className="tz-list">
                    <div style={{ padding: 8 }}>
                      <input className="input" autoFocus value={tzQuery} onChange={e => setTzQuery(e.target.value)} placeholder="поиск: киев, msk, almaty…" />
                    </div>
                    {tzGroups.map(g => (
                      <div key={g.group}>
                        <div className="tz-group-label">{groupLabel(g.group)}</div>
                        {g.zones.map(z => (
                          <div
                            key={z.iana}
                            className={`tz-item ${z.iana === d.tz ? "selected" : ""}`}
                            onClick={() => { set("tz", z.iana); setTzOpen(false); setTzQuery(""); }}
                          >
                            <span className="tz-city">{z.city}, {z.country}</span>
                            <span className="tz-gmt">{z.gmtWinter}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {tzFiltered.length === 0 && <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>Ничего не нашлось</div>}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {currentStep === "persona" && (
          <>
            <h1 className="setup-title">Заметки для персоны</h1>
            <p className="setup-subtitle">Опиши кратко, какой её хочешь видеть. LLM использует это при генерации.</p>
            <div className="form-row">
              <textarea className="textarea" value={d.personaNotes} onChange={e => set("personaNotes", e.target.value)} placeholder="например: студентка дизайна, любит кошек, играет в visual novels, переехала из Питера в Москву..." style={{ minHeight: 140 }} />
            </div>
          </>
        )}

        {currentStep === "ready" && (
          <>
            <h1 className="setup-title">Всё готово</h1>
            <p className="setup-subtitle">Проверь настройки. На следующем шаге создадим профиль и сгенерируем персону через LLM.</p>
            <div className="form-row">
              <div><strong>{d.name}</strong>, {d.age}, {d.nationality}, {d.tz}</div>
              <div><strong>TG:</strong> {d.tgMode === "bot" ? `bot (token ${d.botToken ? "ok" : "missing"})` : `userbot (${d.sessionString ? "session ok" : d.apiId ? "creds ok, no session" : "missing"})`}</div>
              <div><strong>LLM:</strong> {d.llmPresetId} / {d.llmModel}</div>
              <div><strong>Стадия:</strong> {stages.find(s => s.id === d.stage)?.label}</div>
            </div>
          </>
        )}

        {currentStep === "generating" && (
          <>
            {d.generating ? (
              <>
                <h1 className="setup-title">Генерация персоны…</h1>
                <p className="setup-subtitle">LLM создаёт личность, стиль речи, границы и расписание. Обычно ~30-60 секунд.</p>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "32px 0" }}>
                  <div className="spinner" />
                  <div style={{ color: "var(--ga-text-dim)", fontSize: 13 }}>Генерируем persona.md, speech.md, boundaries.md…</div>
                </div>
              </>
            ) : d.generated ? (
              <>
                <h1 className="setup-title">Персона создана</h1>
                <p className="setup-subtitle">Профиль готов и рантайм запущен. Нажми «Готово» чтобы перейти к логам.</p>
                <div className="form-row">
                  <div><strong>{d.name}</strong>, {d.age}, {d.nationality}, {d.tz}</div>
                  <div><strong>LLM:</strong> {d.llmPresetId} / {d.llmModel}</div>
                  <div><strong>Стадия:</strong> {stages.find(s => s.id === d.stage)?.label}</div>
                  <div style={{ color: "var(--ga-success, #7ce9a0)", marginTop: 8 }}>Персона, стиль речи и расписание сгенерированы.</div>
                </div>
              </>
            ) : (
              <>
                <h1 className="setup-title">Создаю профиль…</h1>
                <p className="setup-subtitle">Подготавливаю данные для генерации.</p>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "32px 0" }}>
                  <div className="spinner" />
                </div>
              </>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "space-between" }}>
          <div>
            {d.step > 0 && currentStep !== "generating" && <button className="btn ghost" onClick={back}>← Назад</button>}
            {currentStep !== "generating" && <button className="btn ghost" onClick={() => showSetupFlow(false)}>Закрыть</button>}
          </div>
          {currentStep === "generating" ? (
            <button className="btn primary" disabled={!d.generated} onClick={() => finishAndClose()}>
              {d.generating ? "Генерирую персону…" : d.generated ? "Готово →" : "Подождите…"}
            </button>
          ) : (
            <button className="btn primary" disabled={!canNext || savingProfile} onClick={() => void next()}>
              {currentStep === "ready" ? (savingProfile ? "Создаю…" : "Создать и сгенерировать →") : "Далее →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function groupLabel(group: "UA" | "CIS" | "RU" | "other"): string {
  switch (group) {
    case "UA": return "Україна";
    case "CIS": return "СНГ";
    case "RU": return "Россия";
    default: return "Другое";
  }
}

function stepValid(step: string, d: DraftState): boolean {
  switch (step) {
    case "mode": return true;
    case "name": return !!d.name && d.age >= MIN_AGE && d.age <= MAX_AGE;
    case "tg":
      if (d.tgMode === "bot") return !!d.botToken;
      // userbot
      if (d.userbotMethod === "own") return !!d.apiId && !!d.apiHash && !!d.phone;
      return !!d.phone;
    case "tg-userbot-code":
      // Шаг пройден только если получили sessionString
      return !!d.sessionString;
    case "llm": return !!d.llmPresetId && !!d.llmModel;
    case "api-config": return true;
    case "generating": return d.generated;
    case "stage": return !!d.stage;
    case "comm": return !!d.communicationId;
    case "sleep": return true;
    case "owner": return true;
    case "tz": return !!d.tz;
    case "persona": return true;
    case "ready": return true;
    default: return true;
  }
}
