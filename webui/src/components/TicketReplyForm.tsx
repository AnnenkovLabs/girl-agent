import { useState } from "react";
import type { TicketSummary } from "../lib/api";

/**
 * Форма ответа боссу на `waiting-boss` тикет (Task 5.8 manager-mode tasks.md,
 * Req 11.4-11.7). Inline-валидация: 1..4096 символов, пустой/слишком длинный
 * → кнопка отключена, инлайн-сообщение. На `closed`/`answered` форма
 * блокируется (Req 11.7-11.8). Caller передаёт llm-черновик через `draft`
 * для предзаполнения; авто-отправка не делается (Req 11.5).
 */

const REPLY_MIN = 1;
const REPLY_MAX = 4096;

export interface TicketReplyFormProps {
  ticket: TicketSummary;
  /** Pre-fill из `ticket.llmDraftForBoss`, рендерится только для waiting-boss. */
  draft?: string;
  /** Отправляет ответ; caller обрабатывает success/error и refresh. */
  onSubmit: (text: string) => Promise<void>;
  /** Отменяет тикет → closed (Req 11.8). */
  onCancel: () => Promise<void>;
  busy?: boolean;
}

export function TicketReplyForm({ ticket, draft, onSubmit, onCancel, busy }: TicketReplyFormProps) {
  const [text, setText] = useState<string>(draft ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const resolved = ticket.state === "answered" || ticket.state === "closed";
  const len = text.length;
  const tooShort = len < REPLY_MIN;
  const tooLong = len > REPLY_MAX;
  const invalid = tooShort || tooLong;
  const disabled = busy || resolved || submitting || cancelling;

  async function submit() {
    if (invalid || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(text);
      // Caller должен сам очистить форму через перерендер.
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (resolved || disabled) return;
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  }

  if (resolved) {
    return (
      <div className="hint" style={{ padding: 12 }}>
        Тикет в состоянии {ticket.state} — ответ повторно не принимается.
      </div>
    );
  }

  return (
    <div className="form-row">
      <label>
        Ответ боссу{" "}
        <span className="hint" style={{ marginLeft: 6 }}>
          {len} / {REPLY_MAX} символов
        </span>
      </label>
      <textarea
        className="textarea"
        rows={6}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Что сказать клиенту…"
        maxLength={REPLY_MAX + 100}
        style={tooLong ? { borderColor: "var(--accent)" } : undefined}
      />
      {tooLong && (
        <div className="hint" style={{ color: "var(--accent)" }}>
          больше {REPLY_MAX} — не сохранится
        </div>
      )}
      {tooShort && (
        <div className="hint" style={{ color: "var(--muted)" }}>
          напиши ответ
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn ghost" onClick={() => void cancel()} disabled={disabled}>
          {cancelling ? "Закрываю…" : "Закрыть тикет"}
        </button>
        <button
          className="btn primary"
          onClick={() => void submit()}
          disabled={invalid || disabled}
        >
          {submitting ? "Отправляю…" : "Отправить клиенту"}
        </button>
      </div>
    </div>
  );
}
