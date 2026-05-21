import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TicketState, type TicketSummary } from "../lib/api";
import { useStore } from "../lib/store";
import { TicketRow } from "../components/TicketRow";
import { TicketReplyForm } from "../components/TicketReplyForm";

/**
 * Страница `/inbox/:slug` — инбокс тикетов менеджера (Task 5.8
 * manager-mode tasks.md, Requirement 11). Polling раз в 5 секунд держит
 * список свежим; параллельная отправка через Telegram перерисует тикет на
 * следующем тике (Req 11.7).
 */

const STATE_OPTIONS: Array<{ value: TicketState | "all"; label: string }> = [
  { value: "all", label: "все" },
  { value: "open", label: "open" },
  { value: "waiting-boss", label: "waiting-boss" },
  { value: "answered", label: "answered" },
  { value: "closed", label: "closed" }
];

const POLL_INTERVAL_MS = 5_000;

export function isInboxPath(): boolean {
  if (typeof window === "undefined") return false;
  return /^\/inbox(\/|$)/.test(window.location.pathname);
}

function slugFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const m = /^\/inbox\/([^/]+)\/?$/.exec(window.location.pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function InboxPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const toast = useStore(s => s.toast);

  const slug = slugFromPath() ?? activeSlug;

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [stateFilter, setStateFilter] = useState<TicketState | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    // Бэкенд уже отдаёт desc по createdAt, но явно сортируем здесь, чтобы
    // не зависеть от gateway-кеша/прокси.
    const arr = [...tickets];
    arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return arr;
  }, [tickets]);

  const selected = useMemo(
    () => sorted.find(t => t.id === selectedId) ?? null,
    [sorted, selectedId]
  );

  const refresh = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await api.listInbox(slug, { state: stateFilter });
      setTickets(r.tickets);
      setError(null);
      // Если выбранный тикет пропал из списка (например, фильтр сменился) —
      // снимаем выделение.
      if (selectedId && !r.tickets.some(t => t.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? "ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [slug, stateFilter, selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Polling раз в 5 секунд (Req 11.7 — параллельная отправка через TG не
  // должна ломать UI; periodic refresh синхронизирует состояние).
  useEffect(() => {
    if (!slug) return;
    const id = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [slug, refresh]);

  async function onSubmitReply(text: string) {
    if (!slug || !selected) return;
    setBusy(true);
    try {
      const r = await api.replyTicket(slug, selected.id, text);
      setTickets(prev => prev.map(t => t.id === r.ticket.id ? r.ticket : t));
      toast(`Ответ по ${r.ticket.id} отправлен`, "success");
    } catch (e) {
      const msg = (e as Error)?.message ?? "ошибка отправки";
      toast(`Не удалось отправить ответ: ${msg}`, "error");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function onCancelTicket() {
    if (!slug || !selected) return;
    setBusy(true);
    try {
      const r = await api.cancelTicket(slug, selected.id);
      setTickets(prev => prev.map(t => t.id === r.ticket.id ? r.ticket : t));
      toast(`Тикет ${r.ticket.id} закрыт`, "info");
    } catch (e) {
      const msg = (e as Error)?.message ?? "ошибка";
      toast(`Не удалось закрыть тикет: ${msg}`, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!slug) {
    return (
      <div className="setup-shell">
        <div className="setup-card">
          <h1 className="setup-title">Инбокс</h1>
          <p className="hint">Выбери профиль на сайдбаре, чтобы увидеть его инбокс.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-shell">
      <div className="setup-card" style={{ maxWidth: "min(100%, 1400px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h1 className="setup-title" style={{ marginBottom: 0 }}>
            Инбокс <span className="hint" style={{ marginLeft: 8 }}>{slug}</span>
          </h1>
          <button className="btn ghost" onClick={() => { window.history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); }}>
            ← В дашборд
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label style={{ marginBottom: 4 }}>Состояние</label>
            <select className="select" value={stateFilter} onChange={e => setStateFilter(e.target.value as TicketState | "all")}>
              {STATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Обновляю…" : "Обновить"}
          </button>
        </div>

        {error && (
          <div className="hint" style={{ color: "var(--accent)", marginBottom: 8 }}>
            Ошибка загрузки: {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 360px" : "1fr", gap: 16 }}>
          <div>
            {sorted.length === 0 ? (
              <div className="hint" style={{ padding: 16 }}>Тикетов нет</div>
            ) : (
              <table className="inbox-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>id</th>
                    <th style={th}>клиент</th>
                    <th style={th}>summary</th>
                    <th style={th}>state</th>
                    <th style={th}>createdAt</th>
                    <th style={th}>closedAt</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(t => (
                    <TicketRow
                      key={t.id}
                      ticket={t}
                      selected={t.id === selectedId}
                      onSelect={setSelectedId}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selected && (
            <aside style={{ borderLeft: "1px solid var(--border)", paddingLeft: 16 }}>
              <h2 style={{ fontSize: 16, marginBottom: 8 }}>{selected.id}</h2>
              <div className="hint" style={{ marginBottom: 8 }}>
                {selected.clientUsername ? `@${selected.clientUsername}` : selected.chatId}
                {" • "}
                {selected.state}
              </div>
              <div className="form-row">
                <label>Резюме</label>
                <div style={{ whiteSpace: "pre-wrap", padding: 8, background: "var(--bg-subtle)", borderRadius: 6 }}>
                  {selected.summary || "—"}
                </div>
              </div>
              <TicketReplyForm
                ticket={selected}
                draft={selected.state === "waiting-boss" ? selected.llmDraftForBoss ?? "" : undefined}
                onSubmit={onSubmitReply}
                onCancel={onCancelTicket}
                busy={busy}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  borderBottom: "1px solid var(--border)",
  fontSize: 12,
  color: "var(--muted)",
  fontWeight: 600
};
