import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api, statusSocket } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

const SCORES: { key: string; label: string; negative?: boolean }[] = [
  { key: "interest", label: "Интерес" },
  { key: "trust", label: "Доверие" },
  { key: "attraction", label: "Влечение" },
  { key: "annoyance", label: "Раздражение", negative: true },
  { key: "cringe", label: "Кринж", negative: true }
];

interface ScorePoint { t: number; values: Record<string, number> }

export function RelationshipPage() {
  const cfg = useStore(s => s.activeConfig);
  const showSetupFlow = useStore(s => s.showSetupFlow);
  const toast = useStore(s => s.toast);
  const [stage, setStage] = useState<{ id: string; num: number; label: string } | null>(null);
  const [score, setScore] = useState<Record<string, number> | null>(null);
  const [history, setHistory] = useState<ScorePoint[]>([]);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!cfg) return;
    setHistory([]);
    void api.getRelationship(cfg.slug)
      .then(r => { setStage(r.stage); setScore(r.score); })
      .catch(() => { /* silent */ });
    void api.readMemoryFile(cfg.slug, "relationship.md")
      .then(r => setNotes(r.content))
      .catch(() => setNotes(""));
    const off = statusSocket(cfg.slug, (s) => {
      if (s.score) {
        setScore(s.score);
        setHistory(prev => [...prev.slice(-119), { t: s.t, values: { ...s.score } }]);
      }
    });
    return () => off();
  }, [cfg?.slug]);

  if (!cfg) {
    return <div className="empty"><div className="em-icon">♥</div><div className="em-title">Профиль не выбран</div><button className="btn primary" onClick={() => showSetupFlow(true)}>Создать</button></div>;
  }

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 920 }}>
      <div className="card">
        <div className="card-header">
          <div className="h-title">Стадия отношений</div>
          <div className="h-meta">
            {stage ? <span className="chip accent">{stage.num}. {stage.label}</span> : "—"}
          </div>
          <div className="h-actions">
            <button className="btn tiny" onClick={() => sendCmd("status", toast, cfg.slug)}>:status</button>
            <button className="btn tiny" onClick={() => sendCmd("why", toast, cfg.slug)}>:why</button>
            <button className="btn tiny danger" onClick={() => { if (confirm("Сбросить relationship?")) sendCmd("reset", toast, cfg.slug); }}>:reset</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">Текущие шкалы</div>
        </div>
        {score && (
          <div className="score-grid">
            {SCORES.map(s => (
              <div key={s.key} className={`score-cell ${s.negative ? "negative" : ""}`}>
                <div className="lbl">{s.label}</div>
                <div className="val">{Math.round(score[s.key] ?? 0)}</div>
                <div className="bar"><div className="fill" style={{ width: `${Math.min(100, Math.max(0, score[s.key] ?? 0))}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">История за сессию</div>
          <div className="h-meta">снимки за {history.length} тиков</div>
        </div>
        <Sparklines data={history} />
        {history.length === 0 && <div className="hint" style={{ marginTop: 8 }}>Запусти runtime — он будет присылать снапшоты по WebSocket каждые 5 секунд.</div>}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="h-title">relationship.md</div>
          <div className="h-meta">заметки и история (Markdown)</div>
        </div>
        <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) || "<p style='color:var(--ga-text-faint)'>(пусто)</p>" }} />
      </div>
    </div>
  );
}

function Sparklines({ data }: { data: ScorePoint[] }) {
  if (!data.length) return null;
  const W = 720;
  const H = 120;
  const PAD = 6;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {SCORES.map(s => {
        const points = data.map((p, i) => {
          const x = PAD + (i / Math.max(1, data.length - 1)) * (W - PAD * 2);
          const v = Math.max(0, Math.min(100, p.values[s.key] ?? 0));
          const y = H - PAD - (v / 100) * (H - PAD * 2);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        const fillCol = s.negative ? "url(#gradN)" : "url(#gradP)";
        const strokeCol = s.negative ? "var(--ga-warn)" : "var(--ga-accent)";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 88, fontSize: 12, color: "var(--ga-text-dim)" }}>{s.label}</div>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="40" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gradP" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgba(255,122,214,0.35)"/><stop offset="100%" stopColor="rgba(255,122,214,0)"/></linearGradient>
                <linearGradient id="gradN" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgba(255,208,122,0.35)"/><stop offset="100%" stopColor="rgba(255,208,122,0)"/></linearGradient>
              </defs>
              <polyline points={points} fill="none" stroke={strokeCol} strokeWidth="2" />
              <polygon points={`${PAD},${H - PAD} ${points} ${W - PAD},${H - PAD}`} fill={fillCol} />
            </svg>
            <div style={{ width: 36, textAlign: "right", fontFamily: "var(--ga-font-mono)", fontSize: 12 }}>
              {Math.round(data[data.length - 1]!.values[s.key] ?? 0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function sendCmd(cmd: string, toast: (t: string, k?: "success" | "error" | "info") => void, slug: string) {
  try {
    const r = await api.sendCommand(slug, cmd);
    toast(r.text || `${cmd} ok`, "success");
  } catch (e) {
    toast(`${cmd}: ${(e as Error)?.message}`, "error");
  }
}
