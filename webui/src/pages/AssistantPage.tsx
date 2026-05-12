import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";

interface Msg {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { tool: string; args: Record<string, unknown> }[];
  /** Вопрос от ассистента — кнопки для выбора */
  question?: AssistantQuestion;
}

interface AssistantQuestion {
  text: string;
  options: { label: string; description?: string }[];
}

const GREETING = "Привет! Я встроенный помощник. Спроси про любые настройки, попроси сменить стадию или ignoreTendency, объясни ошибки из логов — я помогу.";

/**
 * Парсим <question> блок из ответа ассистента.
 * Формат:
 * <question text="Какой стиль общения?">
 *   <option label="Тёплый">Дружелюбный и нежный</option>
 *   <option label="Холодный">Цундере</option>
 * </question>
 */
function parseQuestion(text: string): { clean: string; question?: AssistantQuestion } {
  const match = text.match(/<question\s+text="([^"]*)">([\s\S]*?)<\/question>/);
  if (!match) return { clean: text };
  const qText = match[1] ?? "";
  const body = match[2] ?? "";
  const options: { label: string; description?: string }[] = [];
  const optMatches = [...body.matchAll(/<option\s+label="([^"]*)">([\s\S]*?)<\/option>/g)];
  for (const om of optMatches) {
    options.push({ label: om[1] ?? "", description: (om[2] ?? "").trim() || undefined });
  }
  // Также парсим короткий формат: <option label="..."/>
  const shortOptMatches = [...body.matchAll(/<option\s+label="([^"]*)"\s*\/>/g)];
  for (const om of shortOptMatches) {
    if (!options.some(o => o.label === om[1])) {
      options.push({ label: om[1] ?? "" });
    }
  }
  const clean = text.replace(/<question[\s\S]*?<\/question>/, "").trim();
  return options.length > 0 ? { clean, question: { text: qText, options } } : { clean: text };
}

export function AssistantPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const toast = useStore(s => s.toast);
  const refreshActive = useStore(s => s.refreshActive);
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<AssistantQuestion | null>(null);
  const [appliedTools, setAppliedTools] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages, pendingQuestion]);

  async function sendMessage(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setDraft("");
    setPendingQuestion(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    try {
      const payload = next.filter(m => m.role !== "tool").map(m => ({ role: m.role, content: m.content }));
      const r = await api.assistantChat(activeSlug ?? undefined, payload);
      const { clean, question } = parseQuestion(r.reply);
      const reply: Msg = { role: "assistant", content: clean, toolCalls: r.toolCalls, question };
      setMessages(prev => [...prev, reply]);
      if (question) setPendingQuestion(question);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `(ошибка: ${(e as Error)?.message})` }]);
    } finally {
      setBusy(false);
    }
  }

  function send() {
    void sendMessage(draft.trim());
  }

  function selectOption(label: string) {
    void sendMessage(label);
  }

  async function applyTool(idx: number, tcIdx: number) {
    const msg = messages[idx];
    if (!msg?.toolCalls?.[tcIdx]) return;
    if (!activeSlug) {
      toast("Сначала выберите профиль", "error");
      return;
    }
    const toolKey = `${idx}-${tcIdx}`;
    if (appliedTools.has(toolKey)) {
      toast("Уже применено", "info");
      return;
    }
    const tc = msg.toolCalls[tcIdx];
    try {
      const r = await api.applyAssistantTool(activeSlug, tc);
      toast(`Применено: ${r.message}`, "success");
      setAppliedTools(prev => new Set([...prev, toolKey]));
      await refreshActive();
      setMessages(prev => [...prev, { role: "tool", content: `✓ ${tc.tool}: ${r.message}` }]);
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  }

  return (
    <div className="chat-shell">
      <div className="chat-msgs" ref={boxRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            {m.toolCalls?.map((tc, j) => {
              const toolKey = `${i}-${j}`;
              const applied = appliedTools.has(toolKey);
              return (
                <div key={j} style={{ marginTop: 8, padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, fontFamily: "var(--ga-font-mono)", fontSize: 12 }}>
                  <div><strong>{tc.tool}</strong>({Object.entries(tc.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})</div>
                  <button
                    className={`btn tiny ${applied ? "ghost" : "primary"}`}
                    style={{ marginTop: 8 }}
                    disabled={applied}
                    onClick={() => void applyTool(i, j)}
                  >
                    {applied ? "Применено ✓" : "Применить"}
                  </button>
                </div>
              );
            })}
            {m.question && (
              <div className="assistant-question" style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{m.question.text}</div>
                <div className="question-options">
                  {m.question.options.map((opt, oi) => (
                    <button
                      key={oi}
                      className="question-option-btn"
                      onClick={() => selectOption(opt.label)}
                      disabled={busy}
                    >
                      <div className="qo-label">{opt.label}</div>
                      {opt.description && <div className="qo-desc">{opt.description}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg assistant"><span className="spinner" /> думаю...</div>}
      </div>

      {/* Кнопки вопроса над инпутом */}
      {pendingQuestion && !busy && (
        <div className="question-bar">
          <div className="question-bar-text">{pendingQuestion.text}</div>
          <div className="question-bar-options">
            {pendingQuestion.options.map((opt, i) => (
              <button
                key={i}
                className="question-bar-btn"
                onClick={() => selectOption(opt.label)}
                title={opt.description}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat-input">
        <textarea
          placeholder={pendingQuestion ? "или напиши свой вариант..." : "спроси меня что-нибудь..."}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button className="btn primary" disabled={busy || !draft.trim()} onClick={send}>Отправить</button>
      </div>
    </div>
  );
}
