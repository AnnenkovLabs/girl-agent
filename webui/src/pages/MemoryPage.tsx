import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

const SUGGESTED = [
  { path: "persona.md", label: "persona.md", hint: "кто она: внешность, бэкграунд, привычки" },
  { path: "speech.md", label: "speech.md", hint: "как пишет: лексика, длина, эмоции" },
  { path: "boundaries.md", label: "boundaries.md", hint: "что не делает / реагирует негативно" },
  { path: "communication.md", label: "communication.md", hint: "стиль и темпы общения" },
  { path: "long-term.md", label: "long-term.md", hint: "долговременная память (заметки)" },
  { path: "relationship.md", label: "relationship.md", hint: "стадия + score + история отношений" }
];

export function MemoryPage() {
  const cfg = useStore(s => s.activeConfig);
  const toast = useStore(s => s.toast);
  const [files, setFiles] = useState<{ path: string; size: number; mtime: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"edit" | "preview" | "split">("split");

  useEffect(() => {
    if (!cfg) return;
    void api.listMemoryFiles(cfg.slug).then(r => {
      setFiles(r.files);
      if (!active && r.files.length) setActive(r.files[0].path);
    });
  }, [cfg?.slug]);

  useEffect(() => {
    if (!cfg || !active) return;
    setLoading(true);
    void api.readMemoryFile(cfg.slug, active)
      .then(r => { setContent(r.content); setOriginalContent(r.content); })
      .catch(() => { setContent(""); setOriginalContent(""); })
      .finally(() => setLoading(false));
  }, [cfg?.slug, active]);

  const previewHtml = useMemo(() => renderMarkdown(content), [content]);

  if (!cfg) {
    return (
      <div className="empty">
        <div className="em-icon">❀</div>
        <div className="em-title">Создайте профиль, чтобы редактировать память</div>
      </div>
    );
  }

  const dirty = content !== originalContent;
  async function save() {
    if (!cfg || !active) return;
    try {
      await api.writeMemoryFile(cfg.slug, active, content);
      setOriginalContent(content);
      toast(`${active} сохранён`, "success");
      void api.listMemoryFiles(cfg.slug).then(r => setFiles(r.files));
    } catch (e) {
      toast(`Ошибка сохранения: ${(e as Error)?.message}`, "error");
    }
  }

  // Merge known files with whatever is on disk (some may not exist yet).
  const knownPaths = new Set(SUGGESTED.map(s => s.path));
  const items = [
    ...SUGGESTED.map(s => ({ path: s.path, label: s.label, hint: s.hint, size: files.find(f => f.path === s.path)?.size, group: "core" as const })),
    ...files.filter(f => !knownPaths.has(f.path) && f.path.startsWith("memory/daily/")).map(f => ({ path: f.path, label: f.path.replace(/^memory\/daily\//, "📅 "), hint: undefined, size: f.size, group: "daily" as const })),
    ...files.filter(f => !knownPaths.has(f.path) && f.path.startsWith("memory/episodes/")).map(f => ({ path: f.path, label: f.path.replace(/^memory\/episodes\//, "✦ "), hint: undefined, size: f.size, group: "episodes" as const })),
    ...files.filter(f => !knownPaths.has(f.path) && !f.path.startsWith("memory/") && !f.path.startsWith("log/")).map(f => ({ path: f.path, label: f.path, hint: undefined, size: f.size, group: "core" as const }))
  ];

  const groups: Record<string, typeof items> = { core: [], daily: [], episodes: [] };
  for (const it of items) groups[it.group]!.push(it);

  return (
    <div className="memory-shell">
      <div className="card" style={{ padding: 14, overflowY: "auto", maxHeight: "82vh" }}>
        <div className="h-title" style={{ marginBottom: 8 }}>Файлы памяти</div>
        <div className="memory-list">
          {groups.core.map(it => (
            <div key={it.path} className={`memory-item ${active === it.path ? "active" : ""}`} onClick={() => setActive(it.path)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">{it.label}</div>
                {it.hint && <div className="size">{it.hint}</div>}
              </div>
              <div className="size">{it.size != null ? `${it.size}b` : "—"}</div>
            </div>
          ))}
        </div>

        {groups.daily.length > 0 && (
          <>
            <div className="h-title" style={{ margin: "16px 0 8px", fontSize: 13 }}>Дневные саммари</div>
            <div className="memory-list">
              {groups.daily.slice(-30).reverse().map(it => (
                <div key={it.path} className={`memory-item ${active === it.path ? "active" : ""}`} onClick={() => setActive(it.path)}>
                  <div className="name">{it.label}</div>
                  <div className="size">{it.size}b</div>
                </div>
              ))}
            </div>
          </>
        )}
        {groups.episodes.length > 0 && (
          <>
            <div className="h-title" style={{ margin: "16px 0 8px", fontSize: 13 }}>Эпизоды</div>
            <div className="memory-list">
              {groups.episodes.slice(-30).reverse().map(it => (
                <div key={it.path} className={`memory-item ${active === it.path ? "active" : ""}`} onClick={() => setActive(it.path)}>
                  <div className="name">{it.label}</div>
                  <div className="size">{it.size}b</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-header">
          <div className="h-title">{active ?? "—"}</div>
          <div className="h-actions">
            <div style={{ display: "flex", gap: 4, padding: 2, background: "var(--ga-bg-elev)", borderRadius: 8 }}>
              <button className={`btn tiny ${view === "edit" ? "primary" : "ghost"}`} style={{ padding: "4px 10px" }} onClick={() => setView("edit")}>Текст</button>
              <button className={`btn tiny ${view === "split" ? "primary" : "ghost"}`} style={{ padding: "4px 10px" }} onClick={() => setView("split")}>Раздельно</button>
              <button className={`btn tiny ${view === "preview" ? "primary" : "ghost"}`} style={{ padding: "4px 10px" }} onClick={() => setView("preview")}>Превью</button>
            </div>
            <span className="chip">{content.length}c</span>
            <button className="btn primary tiny" disabled={!dirty || loading} onClick={() => void save()}>Сохранить</button>
          </div>
        </div>
        <div style={{ flex: 1, display: view === "split" ? "grid" : "block", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 0 }}>
          {(view === "edit" || view === "split") && (
            <textarea
              className="editor"
              spellCheck={false}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={loading ? "загрузка..." : "пусто. Markdown поддерживается."}
            />
          )}
          {(view === "preview" || view === "split") && (
            <div className="md-preview" dangerouslySetInnerHTML={{ __html: previewHtml || "<p style='color:var(--ga-text-faint)'>(пусто)</p>" }} />
          )}
        </div>
      </div>
    </div>
  );
}
