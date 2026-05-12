import { useStore } from "../lib/store";

export function ApplyPill() {
  const draft = useStore(s => s.draft);
  const applyDraft = useStore(s => s.applyDraft);
  const resetDraft = useStore(s => s.resetDraft);

  if (!draft || Object.keys(draft).length === 0) return null;

  const fieldCount = Object.keys(draft).length;
  return (
    <div className="apply-pill">
      <div className="text">
        <strong>{fieldCount}</strong> {fieldCount === 1 ? "поле изменено" : "полей изменено"}
      </div>
      <button className="btn tiny ghost" onClick={resetDraft}>Отменить</button>
      <button className="btn primary tiny" onClick={() => void applyDraft()}>Применить</button>
    </div>
  );
}
