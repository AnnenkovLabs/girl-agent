import { useStore } from "../lib/store";

export function Toasts() {
  const toasts = useStore(s => s.toasts);
  const dismiss = useStore(s => s.dismissToast);

  if (!toasts.length) return null;
  return (
    <div className="banner-stack">
      {toasts.map(t => (
        <div key={t.id} className={`banner ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === "success" && <span style={{ color: "var(--ga-success)" }}>✓</span>}
          {t.kind === "error" && <span style={{ color: "var(--ga-error)" }}>!</span>}
          {t.kind === "info" && <span style={{ color: "var(--ga-accent-2)" }}>•</span>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
