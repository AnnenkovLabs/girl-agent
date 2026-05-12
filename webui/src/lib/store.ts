import { create } from "zustand";
import { api, type ProfileSummary, type ProfileConfig } from "./api";

export type Tab = "assistant" | "logs" | "relationship" | "configuration" | "memory" | "addons" | "diagnostics";

interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export interface CommandModalState {
  command: string;
  text?: string;
  error?: string;
  loading: boolean;
}

interface State {
  ready: boolean;
  // profiles
  profiles: ProfileSummary[];
  activeSlug: string | null;
  activeConfig: ProfileConfig | null;
  // pending edits to active config (Apply button)
  draft: Partial<ProfileConfig> | null;
  // ui
  tab: Tab;
  showSetup: boolean;
  sidebarOpen: boolean;
  theme: "dark" | "light";
  toasts: Toast[];
  commandModal: CommandModalState | null;
  // actions
  init: () => Promise<void>;
  setTab: (t: Tab) => void;
  selectProfile: (slug: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
  refreshActive: () => Promise<void>;
  patchDraft: (patch: Partial<ProfileConfig>) => void;
  resetDraft: () => void;
  applyDraft: () => Promise<void>;
  toast: (text: string, kind?: "info" | "success" | "error") => void;
  dismissToast: (id: number) => void;
  toggleTheme: () => void;
  setSidebar: (open: boolean) => void;
  showSetupFlow: (show: boolean) => void;
  runCommand: (slug: string, command: string, args?: string[]) => Promise<void>;
  closeCommandModal: () => void;
}

let toastSeq = 1;

export const useStore = create<State>((set, get) => ({
  ready: false,
  profiles: [],
  activeSlug: null,
  activeConfig: null,
  draft: null,
  tab: "logs",
  showSetup: false,
  sidebarOpen: false,
  theme: (localStorage.getItem("ga-theme") as "dark" | "light") ?? "dark",
  toasts: [],
  commandModal: null,

  async init() {
    document.documentElement.setAttribute("data-theme", get().theme);
    try {
      const list = await api.listProfiles();
      set({ profiles: list.profiles, ready: true });
      // pick first by default
      const last = localStorage.getItem("ga-active-slug");
      const candidate = list.profiles.find(p => p.slug === last) ?? list.profiles[0];
      if (candidate) {
        await get().selectProfile(candidate.slug);
        set({ tab: "logs" });
      } else {
        // No profiles → show setup
        set({ showSetup: true, tab: "logs" });
      }
    } catch (e) {
      get().toast(`Не удалось загрузить профили: ${(e as Error)?.message}`, "error");
      set({ ready: true });
    }
  },

  async refreshProfiles() {
    try {
      const list = await api.listProfiles();
      set({ profiles: list.profiles });
    } catch { /* silent */ }
  },

  async selectProfile(slug) {
    localStorage.setItem("ga-active-slug", slug);
    try {
      const data = await api.getProfile(slug);
      set({ activeSlug: slug, activeConfig: data.config, draft: null });
    } catch (e) {
      get().toast(`Не удалось загрузить профиль: ${(e as Error)?.message}`, "error");
    }
  },

  async refreshActive() {
    const slug = get().activeSlug;
    if (!slug) return;
    try {
      const data = await api.getProfile(slug);
      set({ activeConfig: data.config });
    } catch { /* silent */ }
  },

  patchDraft(patch) {
    const cur = get().draft ?? {};
    set({ draft: { ...cur, ...patch } });
  },

  resetDraft() { set({ draft: null }); },

  async applyDraft() {
    const { activeSlug, draft } = get();
    if (!activeSlug || !draft) return;
    try {
      await api.updateProfile(activeSlug, draft);
      set({ draft: null });
      get().toast("Конфиг сохранён", "success");
      // restart runtime
      await api.applyProfile(activeSlug);
      await get().refreshActive();
      await get().refreshProfiles();
      get().toast("Рантайм перезапущен", "success");
    } catch (e) {
      get().toast(`Ошибка применения: ${(e as Error)?.message}`, "error");
    }
  },

  setTab(t) { set({ tab: t, sidebarOpen: false }); },
  setSidebar(open) { set({ sidebarOpen: open }); },
  showSetupFlow(show) { set({ showSetup: show }); },

  toast(text, kind = "info") {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },

  toggleTheme() {
    const next = get().theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ga-theme", next);
    set({ theme: next });
  },

  async runCommand(slug: string, command: string, args: string[] = []) {
    set({ commandModal: { command, loading: true } });
    try {
      const r = await api.sendCommand(slug, command, args);
      set({ commandModal: { command, text: r.text || `${command} выполнено`, loading: false } });
    } catch (e) {
      set({ commandModal: { command, error: (e as Error)?.message ?? "Неизвестная ошибка", loading: false } });
    }
  },

  closeCommandModal() {
    set({ commandModal: null });
  }
}));
