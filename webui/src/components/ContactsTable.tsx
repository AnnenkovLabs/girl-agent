import { useEffect, useRef, useState } from "react";
import type { ContactSummary, ContactTier } from "../lib/api";

/**
 * Таблица контактов менеджера (Task 5.7 manager-mode tasks.md, Req 10).
 *
 * Inline-редактирование `tier` (6 значений; смена ставит `manualOverride=true`
 * на бэкенде) и `notes` (≤2000 символов, коммит по Enter / blur). Колонка
 * `manualOverride` — read-only индикатор. Сохранение идёт через `onPatch`,
 * caller отвечает за toast и refresh строки. Полное обновление за ≤2 сек
 * обеспечивает caller (опросом или ручным refresh).
 */

const TIERS: ContactTier[] = [
  "cold-stranger",
  "introduced",
  "regular",
  "trusted-partner",
  "vip",
  "blocked"
];

const NOTES_MAX = 2000;

export interface ContactsTableProps {
  contacts: ContactSummary[];
  /** Применяет точечный патч; caller сам обрабатывает toast/refresh. */
  onPatch: (chatId: string, patch: { tier?: ContactTier; notes?: string }) => Promise<void>;
  /** chatId, по которому идёт запрос — на нём блокируем UI-ввод. */
  busyChatId?: string | null;
}

function formatLastMessage(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  // Локализуем под dd.MM HH:mm — компактно для таблицы.
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

export function ContactsTable({ contacts, onPatch, busyChatId }: ContactsTableProps) {
  if (contacts.length === 0) {
    return <div className="hint" style={{ padding: 16 }}>Нет контактов</div>;
  }
  return (
    <table className="contacts-table" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>chatId</th>
          <th style={th}>@username</th>
          <th style={th}>Тир</th>
          <th style={th}>Заметки</th>
          <th style={th}>lastMessageAt</th>
          <th style={th}>manual</th>
        </tr>
      </thead>
      <tbody>
        {contacts.map(c => (
          <ContactRow
            key={c.chatId}
            contact={c}
            onPatch={onPatch}
            busy={busyChatId === c.chatId}
          />
        ))}
      </tbody>
    </table>
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

const td: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--border-subtle, var(--border))",
  verticalAlign: "middle"
};

interface RowProps {
  contact: ContactSummary;
  onPatch: ContactsTableProps["onPatch"];
  busy: boolean;
}

function ContactRow({ contact, onPatch, busy }: RowProps) {
  const [notesDraft, setNotesDraft] = useState<string>(contact.notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const baseNotesRef = useRef<string>(contact.notes ?? "");

  // При обновлении контакта снаружи (refresh после PATCH) синхронизируемся,
  // если пользователь сейчас не редактирует.
  useEffect(() => {
    if (!editingNotes) {
      setNotesDraft(contact.notes ?? "");
      baseNotesRef.current = contact.notes ?? "";
    }
  }, [contact.notes, editingNotes]);

  async function commitNotes() {
    setEditingNotes(false);
    if (notesDraft === baseNotesRef.current) return;
    if (notesDraft.length > NOTES_MAX) {
      // Локально откатываем — сервер бы тоже отклонил.
      setNotesDraft(baseNotesRef.current);
      return;
    }
    try {
      await onPatch(contact.chatId, { notes: notesDraft });
      baseNotesRef.current = notesDraft;
    } catch {
      // caller покажет toast; локально откатываем.
      setNotesDraft(baseNotesRef.current);
    }
  }

  function cancelNotes() {
    setEditingNotes(false);
    setNotesDraft(baseNotesRef.current);
  }

  async function changeTier(next: ContactTier) {
    if (next === contact.tier) return;
    try {
      await onPatch(contact.chatId, { tier: next });
    } catch {
      // caller покажет toast; визуально откатимся при следующем refresh.
    }
  }

  const overLimit = notesDraft.length > NOTES_MAX;

  return (
    <tr style={{ opacity: busy ? 0.6 : 1 }}>
      <td style={{ ...td, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
        {contact.chatId}
      </td>
      <td style={td}>
        {contact.username ? (
          <span>@{contact.username}</span>
        ) : (
          <span className="hint">—</span>
        )}
      </td>
      <td style={td}>
        <select
          className="select"
          value={contact.tier}
          onChange={e => void changeTier(e.target.value as ContactTier)}
          disabled={busy}
          style={{ minWidth: 130 }}
        >
          {TIERS.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td style={{ ...td, minWidth: 240 }}>
        <input
          className="input"
          value={notesDraft}
          onChange={e => {
            setEditingNotes(true);
            setNotesDraft(e.target.value);
          }}
          onBlur={() => void commitNotes()}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelNotes();
              (e.target as HTMLInputElement).blur();
            }
          }}
          maxLength={NOTES_MAX + 100}
          disabled={busy}
          placeholder="—"
          style={overLimit ? { borderColor: "var(--accent)" } : undefined}
        />
        {overLimit && (
          <div className="hint" style={{ color: "var(--accent)", fontSize: 11 }}>
            больше {NOTES_MAX} — не сохранится
          </div>
        )}
      </td>
      <td style={{ ...td, fontSize: 12, color: "var(--muted)" }}>
        {formatLastMessage(contact.lastMessageAt)}
      </td>
      <td style={{ ...td, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={contact.manualOverride}
          readOnly
          aria-label="manualOverride"
        />
      </td>
    </tr>
  );
}
