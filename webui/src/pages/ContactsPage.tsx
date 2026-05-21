import { useCallback, useEffect, useState } from "react";
import { api, type ContactSummary, type ContactTier } from "../lib/api";
import { useStore } from "../lib/store";
import { ContactsTable } from "../components/ContactsTable";

/**
 * Страница `/contacts/:slug` — таблица контактов профиля менеджера
 * (Task 5.7 manager-mode tasks.md, Requirement 10).
 *
 * Если slug в URL не указан, используется активный профиль из store.
 * Polling раз в 5 секунд держит таблицу свежей; PATCH применяет изменение
 * локально мгновенно и затем рефрешит с сервера за ≤2 секунды (Req 10.3).
 */

const TIER_OPTIONS: Array<{ value: "all" | ContactTier; label: string }> = [
  { value: "all", label: "все тиры" },
  { value: "cold-stranger", label: "cold-stranger" },
  { value: "introduced", label: "introduced" },
  { value: "regular", label: "regular" },
  { value: "trusted-partner", label: "trusted-partner" },
  { value: "vip", label: "vip" },
  { value: "blocked", label: "blocked" }
];

const POLL_INTERVAL_MS = 5_000;

export function isContactsPath(): boolean {
  if (typeof window === "undefined") return false;
  return /^\/contacts(\/|$)/.test(window.location.pathname);
}

/** Возвращает slug из `/contacts/<slug>` или `null` если только `/contacts`. */
function slugFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const m = /^\/contacts\/([^/]+)\/?$/.exec(window.location.pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function ContactsPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const toast = useStore(s => s.toast);

  // slug из path имеет приоритет над активным профилем — это даёт прямые ссылки.
  const slug = slugFromPath() ?? activeSlug;

  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [tier, setTier] = useState<"all" | ContactTier>("all");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [busyChatId, setBusyChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await api.listContacts(slug, {
        tier: tier === "all" ? undefined : tier,
        sort
      });
      setContacts(r.contacts);
      setError(null);
    } catch (e) {
      const msg = (e as Error)?.message ?? "ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [slug, tier, sort]);

  // Initial load + reload при смене фильтров.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling раз в 5 секунд (Task 5.7).
  useEffect(() => {
    if (!slug) return;
    const id = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [slug, refresh]);

  const onPatch = useCallback(
    async (chatId: string, patch: { tier?: ContactTier; notes?: string }) => {
      if (!slug) return;
      setBusyChatId(chatId);
      try {
        const r = await api.patchContact(slug, chatId, patch);
        // Локальное обновление строки за ≤2 сек — без ожидания polling.
        setContacts(prev => prev.map(c => c.chatId === chatId ? r.contact : c));
      } catch (e) {
        const msg = (e as Error)?.message ?? "ошибка сохранения";
        toast(`Не удалось сохранить контакт ${chatId}: ${msg}`, "error");
        // Re-throw для каллера (ContactsTable) чтобы откатить локальный draft.
        throw e;
      } finally {
        setBusyChatId(null);
      }
    },
    [slug, toast]
  );

  if (!slug) {
    return (
      <div className="setup-shell">
        <div className="setup-card">
          <h1 className="setup-title">Контакты</h1>
          <p className="hint">Выбери профиль на сайдбаре, чтобы увидеть его контактов.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-shell">
      <div className="setup-card" style={{ maxWidth: "min(100%, 1200px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h1 className="setup-title" style={{ marginBottom: 0 }}>
            Контакты <span className="hint" style={{ marginLeft: 8 }}>{slug}</span>
          </h1>
          <button className="btn ghost" onClick={() => { window.history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); }}>
            ← В дашборд
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label style={{ marginBottom: 4 }}>Фильтр по тиру</label>
            <select className="select" value={tier} onChange={e => setTier(e.target.value as "all" | ContactTier)}>
              {TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label style={{ marginBottom: 4 }}>Сортировка по lastMessageAt</label>
            <select className="select" value={sort} onChange={e => setSort(e.target.value as "asc" | "desc")}>
              <option value="desc">сначала свежие</option>
              <option value="asc">сначала старые</option>
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

        <ContactsTable
          contacts={contacts}
          onPatch={onPatch}
          busyChatId={busyChatId}
        />
      </div>
    </div>
  );
}
