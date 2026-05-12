import { useEffect, useState, useCallback } from "react";
import { useStore } from "../lib/store";
import { api, type AddonManifest, type InstalledAddon, type AddonSetting } from "../lib/api";

const TYPE_LABELS: Record<string, string> = {
  fix: "Фикс",
  mod: "Мод",
  persona: "Персона",
  mcp: "MCP",
  theme: "Тема",
  locale: "Локализация"
};

const TYPE_COLOR: Record<string, string> = {
  fix: "linear-gradient(135deg, #ff7a8c, #ffd07a)",
  mod: "linear-gradient(135deg, #7a8cff, #6df5ff)",
  persona: "linear-gradient(135deg, #ff7ad6, #c47aff)",
  mcp: "linear-gradient(135deg, #6df5ff, #7ce9a0)",
  theme: "linear-gradient(135deg, #ffd07a, #ff7ad6)",
  locale: "linear-gradient(135deg, #7ce9a0, #6df5ff)"
};

export function AddonsPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const toast = useStore(s => s.toast);
  const [available, setAvailable] = useState<AddonManifest[]>([]);
  const [installed, setInstalled] = useState<InstalledAddon[]>([]);
  const [filter, setFilter] = useState<"all" | "fix" | "mod" | "persona" | "mcp" | "theme" | "locale">("all");
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [search, setSearch] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const [confirmAddon, setConfirmAddon] = useState<AddonManifest | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  async function refresh() {
    try {
      const r = await api.listAddons();
      setAvailable(r.available);
      setInstalled(r.installed);
    } catch (e) {
      toast(`Не удалось загрузить аддоны: ${(e as Error)?.message}`, "error");
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function requestInstall(a: AddonManifest) {
    try {
      const r = await api.previewAddon(a, activeSlug ?? undefined);
      if (r.conflicts.length === 0) {
        await doInstall(a);
      } else {
        setConfirmAddon(a);
        setConflicts(r.conflicts);
      }
    } catch (e) {
      toast(`Сбой preview: ${(e as Error)?.message}`, "error");
    }
  }

  async function doInstall(a: AddonManifest) {
    setInstalling(true);
    try {
      const r = await api.installAddon(a.id, a, activeSlug ?? undefined);
      const extra = r.applied?.length ? ` (${r.applied.join(", ")})` : "";
      toast(`${a.name} установлен${extra}`, "success");
      setConfirmAddon(null);
      setConflicts([]);
      await refresh();
    } catch (e) {
      toast(`Не удалось установить: ${(e as Error)?.message}`, "error");
    } finally {
      setInstalling(false);
    }
  }

  async function installFromUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setInstalling(true);
    try {
      const r = await api.installAddonFromUrl(url, activeSlug ?? undefined);
      toast(`${r.installed.manifest.name} установлен из URL`, "success");
      setUrlInput("");
      await refresh();
    } catch (e) {
      toast(`URL install: ${(e as Error)?.message}`, "error");
    } finally {
      setInstalling(false);
    }
  }

  async function uninstall(id: string) {
    try {
      await api.uninstallAddon(id);
      toast("Удалён", "success");
      await refresh();
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    try {
      await api.toggleAddon(id, enabled);
      await refresh();
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = available.filter(a => {
    if (filter !== "all" && a.type !== filter) return false;
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (a.tags ?? []).some(t => t.toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="card-header" style={{ marginBottom: 16 }}>
        <button className={`btn tiny ${tab === "marketplace" ? "primary" : ""}`} onClick={() => setTab("marketplace")}>Маркетплейс</button>
        <button className={`btn tiny ${tab === "installed" ? "primary" : ""}`} onClick={() => setTab("installed")}>Установленные ({installed.length})</button>
      </div>

      {tab === "marketplace" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button className={`btn tiny ${filter === "all" ? "primary" : ""}`} onClick={() => setFilter("all")}>Все</button>
            {Object.keys(TYPE_LABELS).map(t => (
              <button key={t} className={`btn tiny ${filter === t ? "primary" : ""}`} onClick={() => setFilter(t as any)}>{TYPE_LABELS[t]}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <input className="input" placeholder="Поиск по названию / тегу / id…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 200px" }} />
            <input className="input" placeholder="URL manifest.json (https://...)" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} style={{ flex: "1.5 1 280px" }} />
            <button className="btn primary tiny" disabled={installing || !urlInput.trim()} onClick={() => void installFromUrl()}>Установить из URL</button>
          </div>
          <div className="grid cols-3">
            {filtered.map(a => (
              <div key={a.id} className="addon-card">
                <div className="head">
                  <div className="icon-wrap" style={{ background: TYPE_COLOR[a.type] ?? TYPE_COLOR.mod }}>{TYPE_LABELS[a.type]?.[0] ?? "?"}</div>
                  <div>
                    <h3>{a.name}</h3>
                    <div className="meta">{TYPE_LABELS[a.type]} · v{a.version}{a.author ? ` · ${a.author}` : ""}</div>
                  </div>
                </div>
                <p>{a.description}</p>
                <div className="actions">
                  {a.installed
                    ? <button className="btn tiny ghost" onClick={() => void uninstall(a.id)}>Удалить</button>
                    : <button className="btn tiny primary" disabled={installing} onClick={() => void requestInstall(a)}>Установить</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {confirmAddon && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(6px)" }} onClick={() => { setConfirmAddon(null); setConflicts([]); }}>
          <div className="card" style={{ maxWidth: 520, margin: 16 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Подтверждение установки</h3>
            <p><b>{confirmAddon.name}</b> v{confirmAddon.version}</p>
            <p style={{ color: "var(--ga-text-dim)" }}>{confirmAddon.description}</p>
            <div style={{ background: "rgba(255, 122, 140, 0.08)", border: "1px solid rgba(255, 122, 140, 0.3)", borderRadius: 10, padding: 12, margin: "12px 0" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Внимание — конфликты ({conflicts.length}):</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn tiny ghost" onClick={() => { setConfirmAddon(null); setConflicts([]); }}>Отмена</button>
              <button className="btn tiny primary" disabled={installing} onClick={() => void doInstall(confirmAddon)}>Всё равно установить</button>
            </div>
          </div>
        </div>
      )}

      {tab === "installed" && (
        <div className="grid cols-2">
          {installed.length === 0 && <div className="empty"><div className="em-icon">◉</div>Не установлено ни одного аддона.</div>}
          {installed.map(it => (
            <InstalledAddonCard
              key={it.manifest.id}
              addon={it}
              onToggle={toggleEnabled}
              onUninstall={uninstall}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InstalledAddonCard({ addon, onToggle, onUninstall, onRefresh }: {
  addon: InstalledAddon;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const toast = useStore(s => s.toast);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsValues, setSettingsValues] = useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = useState(false);

  const settings = addon.manifest.settings ?? [];
  const hasSettings = settings.length > 0;

  const initSettings = useCallback(() => {
    const vals: Record<string, string | number | boolean> = {};
    for (const s of settings) {
      vals[s.key] = addon.settingsValues?.[s.key] ?? s.default ?? (s.type === "boolean" ? false : s.type === "number" ? 0 : "");
    }
    setSettingsValues(vals);
  }, [addon, settings]);

  useEffect(() => { initSettings(); }, [initSettings]);

  async function saveSettings() {
    setSaving(true);
    try {
      await api.updateAddonSettings(addon.manifest.id, settingsValues);
      toast("Настройки сохранены", "success");
      setShowSettings(false);
      await onRefresh();
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: string, value: string | number | boolean) {
    setSettingsValues(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="addon-card">
      <div className="head">
        <div className="icon-wrap" style={{ background: TYPE_COLOR[addon.manifest.type] }}>{TYPE_LABELS[addon.manifest.type]?.[0]}</div>
        <div>
          <h3>{addon.manifest.name}</h3>
          <div className="meta">{TYPE_LABELS[addon.manifest.type]} · v{addon.manifest.version} · {new Date(addon.installedAt).toLocaleDateString("ru-RU")}</div>
        </div>
      </div>
      <p>{addon.manifest.description}</p>
      <div className="actions">
        <label className="toggle">
          <input type="checkbox" checked={addon.enabled} onChange={(e) => void onToggle(addon.manifest.id, e.target.checked)} />
          <span className="track"><span className="knob" /></span>
          <span>{addon.enabled ? "Включён" : "Выключен"}</span>
        </label>
        {hasSettings && (
          <button className="btn tiny ghost" onClick={() => { setShowSettings(!showSettings); if (!showSettings) initSettings(); }}>Настройки</button>
        )}
        <button className="btn tiny danger" onClick={() => void onUninstall(addon.manifest.id)}>Удалить</button>
      </div>
      {showSettings && hasSettings && (
        <div className="addon-settings">
          {settings.map(s => (
            <AddonSettingField
              key={s.key}
              setting={s}
              value={settingsValues[s.key]}
              onChange={(v) => updateSetting(s.key, v)}
            />
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn tiny primary" disabled={saving} onClick={() => void saveSettings()}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button className="btn tiny ghost" onClick={() => setShowSettings(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddonSettingField({ setting, value, onChange }: {
  setting: AddonSetting;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  return (
    <div className="form-row" style={{ marginBottom: 8 }}>
      <label>{setting.label}{setting.required ? " *" : ""}</label>
      {setting.type === "boolean" ? (
        <label className="toggle">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="track"><span className="knob" /></span>
        </label>
      ) : setting.type === "select" ? (
        <select className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(setting.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : setting.type === "number" ? (
        <input className="input" type="number" value={String(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
      ) : (
        <input className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
      {setting.hint && <div className="hint">{setting.hint}</div>}
    </div>
  );
}
