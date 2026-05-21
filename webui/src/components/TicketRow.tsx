import type { TicketSummary } from "../lib/api";

/**
 * Строка тикета в инбоксе менеджера (Task 5.8 manager-mode tasks.md, Req 11).
 *
 * Колонки: id, client, summary (обрезанная до 200 с `…`), state, createdAt,
 * closedAt. Драфт боссу (`llmDraftForBoss`) показывается ТОЛЬКО для
 * `waiting-boss` без авто-отправки (Req 11.4-11.6). Клик по строке
 * открывает деталь — caller отвечает за роут.
 */

const SUMMARY_MAX = 200;

function truncate(s: string | undefined, n = SUMMARY_MAX): string {
  if (!s) return "—";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatTs(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

const STATE_LABELS: Record<TicketSummary["state"], string> = {
  open: "open",
  "waiting-boss": "waiting-boss",
  answered: "answered",
  closed: "closed"
};

const STATE_COLORS: Record<TicketSummary["state"], string> = {
  open: "var(--accent, #f59e0b)",
  "waiting-boss": "var(--info, #3b82f6)",
  answered: "var(--success, #22c55e)",
  closed: "var(--muted, #6b7280)"
};

export interface TicketRowProps {
  ticket: TicketSummary;
  selected?: boolean;
  onSelect: (ticketId: string) => void;
}

export function TicketRow({ ticket, selected, onSelect }: TicketRowProps) {
  return (
    <tr
      onClick={() => onSelect(ticket.id)}
      style={{
        cursor: "pointer",
        background: selected ? "var(--bg-hover, rgba(255,255,255,0.04))" : undefined
      }}
    >
      <td style={td}>
        <code>{ticket.id}</code>
      </td>
      <td style={td}>
        {ticket.clientUsername ? (
          <span>@{ticket.clientUsername}</span>
        ) : (
          <span className="hint" style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
            {ticket.chatId}
          </span>
        )}
      </td>
      <td style={{ ...td, maxWidth: 480 }}>{truncate(ticket.summary)}</td>
      <td style={td}>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            color: STATE_COLORS[ticket.state],
            border: `1px solid ${STATE_COLORS[ticket.state]}`
          }}
        >
          {STATE_LABELS[ticket.state]}
        </span>
      </td>
      <td style={{ ...td, fontSize: 12, color: "var(--muted)" }}>
        {formatTs(ticket.createdAt)}
      </td>
      <td style={{ ...td, fontSize: 12, color: "var(--muted)" }}>
        {formatTs(ticket.closedAt)}
      </td>
    </tr>
  );
}

const td: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid var(--border-subtle, var(--border))",
  verticalAlign: "middle"
};
