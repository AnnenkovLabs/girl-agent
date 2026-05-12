import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { api, logsSocket, statusSocket } from "../lib/api";

interface LogEvent { type: string; text?: string; t: number }

const SCORE_KEYS: { key: string; label: string; negative?: boolean }[] = [
  { key: "interest", label: "Интерес" },
  { key: "trust", label: "Доверие" },
  { key: "attraction", label: "Влечение" },
  { key: "annoyance", label: "Раздражение", negative: true },
  { key: "cringe", label: "Кринж", negative: true }
];

export function LogsPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const profiles = useStore(s => s.profiles);
  const toast = useStore(s => s.toast);
  const runCommand = useStore(s => s.runCommand);
  const showSetupFlow = useStore(s => s.showSetupFlow);

  const [events, setEvents] = useState<LogEvent[]>([]);
  const [score, setScore] = useState<Record<string, number> | null>(null);
  const [stage, setStage] = useState<string | undefined>();
  const [statusState, setStatusState] = useState<string>("stopped");
  const [autoscroll, setAutoscroll] = useState(true);
  const [filter, setFilter] = useState<"all" | "in" | "out" | "info" | "warn" | "error">("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"live" | "files">("live");
  const [days, setDays] = useState<{ date: string; lines: number }[]>([]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [dayContent, setDayContent] = useState<string>("");
  const boxRef = useRef<HTMLDivElement>(null);

  const active = profiles.find(p => p.slug === activeSlug) ?? null;

  useEffect(() => {
    if (!activeSlug) return;
    setEvents([]);
    api.getLogsBuffer(activeSlug).then(r => setEvents(r.events as LogEvent[])).catch(() => { /* silent */ });
    const offLogs = logsSocket(activeSlug, (e) => setEvents(prev => prev.concat(e).slice(-1000)));
    const offStatus = statusSocket(activeSlug, (s) => {
      setScore(s.score ?? null);
      setStage(s.stage);
      setStatusState(s.status?.state ?? "stopped");
    });
    return () => { offLogs(); offStatus(); };
  }, [activeSlug]);

  useEffect(() => {
    if (!activeSlug || tab !== "files") return;
    void api.listLogDays(activeSlug).then(r => {
      setDays(r.days);
      if (r.days.length && !activeDay) setActiveDay(r.days[r.days.length - 1]!.date);
    });
  }, [activeSlug, tab]);

  useEffect(() => {
    if (!activeSlug || !activeDay) return;
    void api.readLogFile(activeSlug, activeDay)
      .then(r => setDayContent(r.content))
      .catch(() => setDayContent(""));
  }, [activeSlug, activeDay]);

  useEffect(() => {
    if (autoscroll && tab === "live" && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [events, autoscroll, tab]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (filter !== "all" && e.type !== filter) return false;
      if (search && !(e.text ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [events, filter, search]);

  if (!activeSlug) {
    return (
      <div className="empty">
        <div className="em-icon">✦</div>
        <div className="em-title">Профилей пока нет</div>
        <div>Создайте первый профиль, чтобы начать.</div>
        <button className="btn primary" onClick={() => showSetupFlow(true)}>Создать профиль</button>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="h-title">Статус</div>
            <div className="h-meta">
              <span className={`chip ${statusState === "running" ? "success" : statusState === "error" ? "error" : ""}`}>{statusLabel(statusState)}</span>
              {active?.lastError && <span className="chip error" style={{ marginLeft: 8 }}>{active.lastError}</span>}
              {stage && <span className="chip accent" style={{ marginLeft: 8 }}>стадия: {stage}</span>}
            </div>
          </div>
          <div className="h-actions">
            <button className="btn tiny" onClick={() => void runCommand(activeSlug, "status")}>:status</button>
            <button className="btn tiny" onClick={() => void runCommand(activeSlug, "why")}>:why</button>
            <button className="btn tiny" onClick={() => void runCommand(activeSlug, "wake")}>:wake</button>
            <button className="btn tiny" onClick={() => void runCommand(activeSlug, "debug")}>:debug</button>
            <button className="btn tiny danger" onClick={() => { if (confirm("Сбросить relationship?")) void runCommand(activeSlug, "reset"); }}>:reset</button>
          </div>
        </div>
        {score && (
          <div className="score-grid">
            {SCORE_KEYS.map(k => (
              <div key={k.key} className={`score-cell ${k.negative ? "negative" : ""}`}>
                <div className="lbl">{k.label}</div>
                <div className="val">{Math.round(score[k.key] ?? 0)}</div>
                <div className="bar"><div className="fill" style={{ width: `${Math.min(100, Math.max(0, score[k.key] ?? 0))}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn tiny ${tab === "live" ? "primary" : ""}`} onClick={() => setTab("live")}>Live ({events.length})</button>
        <button className={`btn tiny ${tab === "files" ? "primary" : ""}`} onClick={() => setTab("files")}>Журнал по дням ({days.length})</button>
      </div>

      {tab === "live" && (
        <div className="card">
          <div className="card-header">
            <div className="h-title">События runtime'а</div>
            <div className="h-actions">
              <input className="input" placeholder="поиск..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 160, padding: "5px 10px" }} />
              <select className="select" style={{ width: 120 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">все</option>
                <option value="in">in</option>
                <option value="out">out</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
              <label className="toggle">
                <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
                <span className="track"><span className="knob" /></span>
                <span style={{ fontSize: 12 }}>автоскролл</span>
              </label>
              <button className="btn tiny ghost" onClick={() => setEvents([])}>Очистить</button>
            </div>
          </div>
          <div className="logs-box" ref={boxRef}>
            {filteredEvents.length === 0 && <div style={{ color: "var(--ga-text-faint)" }}>(нет событий)</div>}
            {filteredEvents.map((e, i) => (
              <div key={i} className={`log-line ${e.type}`}>
                <span className="ts">{new Date(e.t).toLocaleTimeString("ru-RU", { hour12: false })}</span>
                <span className="tag">[{e.type}]</span>
                <span className="msg">{e.text ?? JSON.stringify(e)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "files" && (
        <div className="memory-shell">
          <div className="card" style={{ padding: 14, overflowY: "auto", maxHeight: "70vh" }}>
            <div className="h-title" style={{ marginBottom: 8 }}>Дни с разговорами</div>
            <div className="memory-list">
              {days.length === 0 && <div className="hint">пока нет записей</div>}
              {days.slice().reverse().map(d => (
                <div key={d.date} className={`memory-item ${activeDay === d.date ? "active" : ""}`} onClick={() => setActiveDay(d.date)}>
                  <div className="name">{d.date}</div>
                  <div className="size">{d.lines} стр</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="card-header">
              <div className="h-title">{activeDay ?? "—"}</div>
              <div className="h-actions">
                <span className="chip">{dayContent.length} символов</span>
              </div>
            </div>
            <pre className="logs-box" style={{ flex: 1, height: "auto", maxHeight: "70vh" }}>{dayContent || "(пусто)"}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "running": return "● работает";
    case "paused": return "‖ пауза";
    case "error": return "! ошибка";
    case "stopped":
    default: return "○ остановлен";
  }
}
