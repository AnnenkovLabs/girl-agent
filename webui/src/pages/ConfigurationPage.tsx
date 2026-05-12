import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api, type LLMPreset, type StagePreset, type CommunicationPreset } from "../lib/api";

export function ConfigurationPage() {
  const cfg = useStore(s => s.activeConfig);
  const draft = useStore(s => s.draft);
  const patch = useStore(s => s.patchDraft);
  const toast = useStore(s => s.toast);
  const setTab = useStore(s => s.setTab);
  const showSetupFlow = useStore(s => s.showSetupFlow);
  const refreshActive = useStore(s => s.refreshActive);

  const [llmPresets, setLLMPresets] = useState<LLMPreset[]>([]);
  const [stages, setStages] = useState<StagePreset[]>([]);
  const [comms, setComms] = useState<CommunicationPreset[]>([]);
  const [mcpPresets, setMCPPresets] = useState<{ id: string; name: string; description: string; ready: boolean; secrets: { key: string; label: string }[] }[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void api.listLLMPresets().then(r => setLLMPresets(r.presets));
    void api.listStages().then(r => setStages(r.stages));
    void api.listCommunicationPresets().then(r => setComms(r.presets));
    void api.listMCPPresets().then(r => setMCPPresets(r.presets));
  }, []);

  if (!cfg) {
    return (
      <div className="empty">
        <div className="em-icon">⚙</div>
        <div className="em-title">Создайте профиль</div>
        <button className="btn primary" onClick={() => showSetupFlow(true)}>Открыть Setup Flow</button>
      </div>
    );
  }

  const merged = { ...cfg, ...(draft ?? {}) };

  function pf<K extends keyof typeof merged>(key: K, value: (typeof merged)[K]) {
    patch({ [key]: value } as any);
  }

  function pfDeep(path: string, value: unknown) {
    const parts = path.split(".");
    const head = parts[0]!;
    const sub = parts.slice(1).join(".");
    const current = (merged as any)[head] ?? {};
    if (sub) {
      patch({ [head]: { ...current, [sub]: value } } as any);
    } else {
      patch({ [head]: value } as any);
    }
  }

  async function genPersona() {
    if (!cfg) return;
    setGenerating(true);
    try {
      await api.generatePersona(cfg.slug, { name: merged.name, age: merged.age, nationality: merged.nationality, notes: merged.personaNotes });
      toast("Персона сгенерирована — проверьте файлы памяти", "success");
      await refreshActive();
      setTab("memory");
    } catch (e) {
      toast(`Генерация не удалась: ${(e as Error)?.message}`, "error");
    } finally {
      setGenerating(false);
    }
  }

  async function testLLM() {
    if (!cfg) return;
    try {
      const r = await api.testLLM(cfg.slug);
      if (r.ok) toast(`LLM ok: ${r.reply ?? ""}`.slice(0, 100), "success");
      else toast(`LLM error: ${r.error}`, "error");
    } catch (e) {
      toast(`LLM test failed: ${(e as Error)?.message}`, "error");
    }
  }

  async function deleteProfile() {
    if (!cfg) return;
    if (!confirm(`Удалить профиль ${cfg.name} (${cfg.slug}) безвозвратно? Все его данные будут стёрты.`)) return;
    try {
      await api.deleteProfile(cfg.slug);
      toast("Профиль удалён", "success");
      window.location.reload();
    } catch (e) {
      toast(`Не удалось удалить: ${(e as Error)?.message}`, "error");
    }
  }

  const llmPreset = llmPresets.find(p => p.id === merged.llm.presetId);

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 920 }}>

      <div className="card">
        <div className="card-header">
          <div className="h-title">Личность</div>
          <div className="h-meta">базовые поля персоны</div>
          <div className="h-actions">
            <button className="btn tiny" disabled={generating} onClick={() => void genPersona()}>{generating ? "Генерируем..." : "Перегенерить персону"}</button>
          </div>
        </div>
        <div className="grid cols-2">
          <div className="form-row"><label>Имя</label><input className="input" value={merged.name} onChange={e => pf("name", e.target.value)} /></div>
          <div className="form-row"><label>Возраст</label><input type="number" className="input" min={18} max={45} value={merged.age} onChange={e => pf("age", Number(e.target.value))} /></div>
          <div className="form-row"><label>Национальность</label>
            <select className="select" value={merged.nationality} onChange={e => pf("nationality", e.target.value as "RU" | "UA")}>
              <option value="RU">Россия</option>
              <option value="UA">Україна</option>
            </select>
          </div>
          <div className="form-row"><label>Часовой пояс</label><input className="input" value={merged.tz} onChange={e => pf("tz", e.target.value)} placeholder="Europe/Moscow" /></div>
        </div>
        <div className="form-row">
          <label>Заметки для персоны (свободный текст)</label>
          <textarea className="textarea" value={merged.personaNotes ?? ""} onChange={e => pf("personaNotes", e.target.value)} placeholder="например: студентка дизайна, любит кошек, играет в visual novels, только что переехала в Москву..." />
          <div className="hint">Эти заметки используются при генерации персоны (persona.md / speech.md / communication.md)</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">Telegram</div>
          <div className="h-meta">режим подключения и токен</div>
        </div>
        <div className="form-row">
          <label>Режим</label>
          <select className="select" value={merged.mode} onChange={e => pf("mode", e.target.value as "bot" | "userbot")}>
            <option value="bot">bot — Bot API (нужен @BotFather токен)</option>
            <option value="userbot">userbot — MTProto (api_id + api_hash + телефон)</option>
          </select>
          <div className="hint">{merged.mode === "bot"
            ? "Бот может писать только тем, кто уже добавил его в чат через /start. Подходит большинству."
            : "Userbot подключается под обычный TG-аккаунт. Может писать всем по username/телефону. Используй на своём аккаунте."}</div>
        </div>
        {merged.mode === "bot" ? (
          <div className="form-row">
            <label>Bot Token</label>
            <input className="input" type="password" value={merged.telegram.botToken ?? ""} onChange={e => pfDeep("telegram.botToken", e.target.value)} placeholder="123456789:AAFxxxxxxxxx" />
            <div className="hint">Получи у <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> командой /newbot</div>
          </div>
        ) : (
          <div className="grid cols-2">
            <div className="form-row"><label>API ID</label><input className="input" value={merged.telegram.apiId ?? ""} onChange={e => pfDeep("telegram.apiId", Number(e.target.value))} /></div>
            <div className="form-row"><label>API Hash</label><input className="input" type="password" value={merged.telegram.apiHash ?? ""} onChange={e => pfDeep("telegram.apiHash", e.target.value)} /></div>
            <div className="form-row"><label>Телефон</label><input className="input" value={merged.telegram.phone ?? ""} onChange={e => pfDeep("telegram.phone", e.target.value)} placeholder="+79..." /></div>
            <div className="form-row"><label>Session String (если есть)</label><input className="input" type="password" value={merged.telegram.sessionString ?? ""} onChange={e => pfDeep("telegram.sessionString", e.target.value)} /></div>
          </div>
        )}
        <div className="grid cols-2">
          <div className="form-row">
            <label className="toggle">
              <input type="checkbox" checked={merged.telegram.useWSS !== false} onChange={e => pfDeep("telegram.useWSS", e.target.checked)} />
              <span className="track"><span className="knob" /></span>
              <span>WSS (websocket, обходит блокировки РФ)</span>
            </label>
          </div>
          <div className="form-row">
            <label>Прокси (опционально)</label>
            <input className="input" value={merged.telegram.proxy ?? ""} onChange={e => pfDeep("telegram.proxy", e.target.value)} placeholder="http://user:pass@host:port или socks5://..." />
          </div>
        </div>
        <div className="form-row">
          <label>Privacy</label>
          <select className="select" value={merged.privacy ?? "owner-only"} onChange={e => pf("privacy", e.target.value as "owner-only" | "allow-strangers")}>
            <option value="owner-only">только владельцу — отвечает только тебе (по ownerId)</option>
            <option value="allow-strangers">всем — отвечает любому, кто пишет</option>
          </select>
        </div>
        <div className="form-row">
          <label>Owner ID (Telegram user id)</label>
          <input className="input" type="number" value={merged.ownerId ?? ""} onChange={e => pf("ownerId", Number(e.target.value) || undefined)} placeholder="напиши боту /start чтобы он сообщил твой id" />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">LLM</div>
          <div className="h-meta">модель и провайдер</div>
          <div className="h-actions">
            <button className="btn tiny" onClick={() => void testLLM()}>Тест соединения</button>
          </div>
        </div>
        <div className="grid cols-2">
          <div className="form-row">
            <label>Провайдер (preset)</label>
            <select className="select" value={merged.llm.presetId} onChange={e => {
              const id = e.target.value;
              const p = llmPresets.find(x => x.id === id);
              if (p && !p.disabled) pf("llm", { presetId: p.id, proto: p.proto, baseURL: p.baseURL, apiKey: merged.llm.apiKey ?? "", model: p.defaultModel });
            }}>
              {llmPresets.map(p => (
                <option key={p.id} value={p.id} disabled={p.disabled}>
                  {p.name}{p.recommended ? " ★" : ""}{p.disabled ? ` — ${p.disabledReason ?? "недоступен"}` : ""}
                </option>
              ))}
            </select>
            {llmPreset?.hint && <div className="hint">{llmPreset.hint}</div>}
          </div>
          <div className="form-row">
            <label>Модель</label>
            {llmPreset?.models?.length ? (
              <select className="select" value={merged.llm.model} onChange={e => pfDeep("llm.model", e.target.value)}>
                {llmPreset.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" value={merged.llm.model} onChange={e => pfDeep("llm.model", e.target.value)} placeholder="название модели" />
            )}
          </div>
          {llmPreset?.apiKeyRequired !== false && (
            <div className="form-row">
              <label>API Key</label>
              <input className="input" type="password" value={merged.llm.apiKey ?? ""} onChange={e => pfDeep("llm.apiKey", e.target.value)} />
            </div>
          )}
          {llmPreset?.custom && (
            <div className="form-row">
              <label>Base URL</label>
              <input className="input" value={merged.llm.baseURL ?? ""} onChange={e => pfDeep("llm.baseURL", e.target.value)} placeholder="https://..." />
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">Стадия отношений</div>
          <div className="h-meta">9 уровней: от «дала тг» до «расстались»</div>
        </div>
        <div className="form-row">
          <select className="select" value={merged.stage} onChange={e => pf("stage", e.target.value)}>
            {stages.map(s => <option key={s.id} value={s.id}>{s.num}. {s.label}</option>)}
          </select>
          <div className="hint">{stages.find(s => s.id === merged.stage)?.description}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">Стиль общения</div>
          <div className="h-meta">пресет, который собирает 4 параметра</div>
        </div>
        <div className="grid cols-2">
          {comms.map(c => {
            const cur = merged.communication;
            const isMatch = cur && cur.notifications === c.profile.notifications && cur.messageStyle === c.profile.messageStyle && cur.initiative === c.profile.initiative && cur.lifeSharing === c.profile.lifeSharing;
            return (
              <div key={c.id} className={`card`} style={{ padding: 14, cursor: "pointer", borderColor: isMatch ? "var(--ga-accent)" : "var(--ga-border)", boxShadow: isMatch ? "0 0 0 1px var(--ga-accent) inset" : "none" }} onClick={() => pf("communication", c.profile as any)}>
                <strong>{c.label}</strong>
                <div className="hint" style={{ marginTop: 4 }}>{c.description}</div>
              </div>
            );
          })}
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <label>Тенденция игнора: {merged.ignoreTendency ?? 35}%</label>
          <input type="range" className="range" min={0} max={100} value={merged.ignoreTendency ?? 35} onChange={e => pf("ignoreTendency", Number(e.target.value))} />
          <div className="hint">0% — почти не игнорит без причины. 100% — очень холодная.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">Сон</div>
        </div>
        <div className="grid cols-2">
          <div className="form-row"><label>Засыпает в (час)</label><input type="number" min={0} max={23} className="input" value={merged.sleepFrom} onChange={e => pf("sleepFrom", Number(e.target.value))} /></div>
          <div className="form-row"><label>Просыпается в (час)</label><input type="number" min={0} max={23} className="input" value={merged.sleepTo} onChange={e => pf("sleepTo", Number(e.target.value))} /></div>
          <div className="form-row" style={{ gridColumn: "span 2" }}>
            <label>Шанс ночного отклика: {Math.round((merged.nightWakeChance ?? 0) * 100)}%</label>
            <input type="range" min={0} max={100} className="range" value={Math.round((merged.nightWakeChance ?? 0) * 100)} onChange={e => pf("nightWakeChance", Number(e.target.value) / 100)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">MCP-интеграции</div>
          <div className="h-meta">внешние tool'ы для девушки (поиск, музыка, календарь...)</div>
        </div>
        <div className="grid cols-2">
          {mcpPresets.map(p => {
            const enabled = (merged.mcp ?? []).some(m => m.id === p.id);
            return (
              <div key={p.id} className="card" style={{ padding: 14 }}>
                <div className="card-header" style={{ marginBottom: 6 }}>
                  <strong>{p.name}</strong>
                  {!p.ready && <span className="chip warn" style={{ marginLeft: 8 }}>скоро</span>}
                </div>
                <div className="hint" style={{ marginBottom: 10 }}>{p.description}</div>
                <label className="toggle">
                  <input type="checkbox" disabled={!p.ready} checked={enabled} onChange={(e) => {
                    const cur = merged.mcp ?? [];
                    if (e.target.checked) {
                      const secrets: Record<string, string> = {};
                      for (const s of p.secrets ?? []) secrets[s.key] = "";
                      pf("mcp", [...cur, { id: p.id, secrets }] as any);
                    } else {
                      pf("mcp", cur.filter(m => m.id !== p.id) as any);
                    }
                  }} />
                  <span className="track"><span className="knob" /></span>
                  <span>{enabled ? "Включён" : "Выключен"}</span>
                </label>
                {enabled && p.secrets?.map(s => (
                  <div key={s.key} className="form-row" style={{ marginTop: 8 }}>
                    <label>{s.label}</label>
                    <input className="input" type="password" value={(merged.mcp ?? []).find(m => m.id === p.id)?.secrets[s.key] ?? ""}
                      onChange={(e) => {
                        const cur = (merged.mcp ?? []).map(m => m.id === p.id ? { ...m, secrets: { ...m.secrets, [s.key]: e.target.value } } : m);
                        pf("mcp", cur as any);
                      }} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ borderColor: "rgba(255, 122, 140, 0.3)" }}>
        <div className="card-header">
          <div className="h-title" style={{ color: "var(--ga-error)" }}>Опасная зона</div>
        </div>
        <div className="grid cols-2">
          <button className="btn danger" onClick={() => deleteProfile()}>Удалить профиль</button>
          <button className="btn" onClick={() => sendCommand("amnesia", toast, cfg.slug)}>Сбросить память</button>
        </div>
      </div>
    </div>
  );
}

async function sendCommand(cmd: string, toast: (t: string, k?: "success" | "error" | "info") => void, slug: string) {
  if (!confirm(`Выполнить :${cmd}?`)) return;
  try {
    const r = await api.sendCommand(slug, cmd);
    toast(r.text || `${cmd} ok`, "success");
  } catch (e) {
    toast(`${cmd}: ${(e as Error)?.message}`, "error");
  }
}
