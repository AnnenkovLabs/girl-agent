import { useStore } from "../lib/store";
import { api } from "../lib/api";
import { useState } from "react";

const TAB_TITLES: Record<string, string> = {
  assistant: "AI-помощник",
  logs: "Логи и статус",
  relationship: "Отношения",
  configuration: "Конфигурация",
  memory: "Память",
  addons: "Аддоны",
  diagnostics: "Диагностика"
};

export function Topbar() {
  const tab = useStore(s => s.tab);
  const activeSlug = useStore(s => s.activeSlug);
  const activeConfig = useStore(s => s.activeConfig);
  const profiles = useStore(s => s.profiles);
  const setSidebar = useStore(s => s.setSidebar);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const refreshProfiles = useStore(s => s.refreshProfiles);
  const refreshActive = useStore(s => s.refreshActive);
  const toast = useStore(s => s.toast);
  const [busy, setBusy] = useState(false);

  const active = profiles.find(p => p.slug === activeSlug) ?? null;

  async function startStop(action: "start" | "stop" | "pause" | "resume") {
    if (!activeSlug) return;
    setBusy(true);
    try {
      if (action === "start") await api.startProfile(activeSlug);
      if (action === "stop") await api.stopProfile(activeSlug);
      if (action === "pause") await api.pauseProfile(activeSlug);
      if (action === "resume") await api.resumeProfile(activeSlug);
      await refreshProfiles();
      await refreshActive();
      toast(`Команда ${action} выполнена`, "success");
    } catch (e) {
      toast(`${action} не удалось: ${(e as Error)?.message}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="topbar">
      <button className="menu-button" onClick={() => setSidebar(!sidebarOpen)} aria-label="меню">≡</button>
      <div>
        <div className="title">{TAB_TITLES[tab] ?? "girl-agent"}</div>
        {activeConfig && <div className="crumb">{activeConfig.name} · {activeConfig.age} · {activeConfig.mode}</div>}
      </div>
      <div className="right">
        {active && (
          <>
            {active.status === "stopped" && (
              <button className="btn primary tiny" disabled={busy} onClick={() => startStop("start")}>▶ Запустить</button>
            )}
            {active.status === "running" && (
              <>
                <button className="btn tiny" disabled={busy} onClick={() => startStop("pause")}>‖ Пауза</button>
                <button className="btn tiny" disabled={busy} onClick={() => startStop("stop")}>■ Стоп</button>
              </>
            )}
            {active.status === "paused" && (
              <button className="btn primary tiny" disabled={busy} onClick={() => startStop("resume")}>▶ Возобновить</button>
            )}
            {active.status === "error" && (
              <button className="btn primary tiny" disabled={busy} onClick={() => startStop("start")}>↻ Перезапуск</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
