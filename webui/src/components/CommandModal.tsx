import { useStore } from "../lib/store";

export function CommandModal() {
  const modal = useStore(s => s.commandModal);
  const closeCommandModal = useStore(s => s.closeCommandModal);

  if (!modal) return null;

  return (
    <div className="cmd-overlay" onClick={closeCommandModal}>
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-header">
          <div className="cmd-title">:{modal.command}</div>
          <button className="cmd-close" onClick={closeCommandModal}>✕</button>
        </div>
        <div className="cmd-body">
          {modal.loading ? (
            <div className="cmd-loading">
              <div className="spinner" />
              <span>Выполняю…</span>
            </div>
          ) : modal.error ? (
            <div className="cmd-error">{modal.error}</div>
          ) : (
            <div className="cmd-content">
              {formatCommandResult(modal.command, modal.text ?? "")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCommandResult(command: string, text: string) {
  if (!text) return <div className="cmd-empty">Нет данных</div>;

  const lines = text.split("\n").filter(Boolean);

  if (command === "status" || command === "debug") {
    return (
      <div className="cmd-kv-list">
        {lines.map((line, i) => {
          const colon = line.indexOf(":");
          if (colon === -1) return <div key={i} className="cmd-line">{line}</div>;
          const key = line.slice(0, colon).trim();
          const val = line.slice(colon + 1).trim();
          return (
            <div key={i} className="cmd-kv-row">
              <span className="cmd-key">{key}</span>
              <span className="cmd-val">{val}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="cmd-plain">
      {lines.map((line, i) => <div key={i} className="cmd-line">{line}</div>)}
    </div>
  );
}
