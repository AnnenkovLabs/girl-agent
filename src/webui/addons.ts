import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Аддоны girl-agent. Манифест-формат описан в WebUI-ТЗ §3.3.2.
 *
 * Виды аддонов:
 *   - fix:    патч исходников / конфига для фикса конкретного бага
 *   - mod:    модификация поведения (hook'и в runtime)
 *   - persona: готовые файлы персоны + config-overrides
 *   - mcp:    MCP-сервер с готовой конфигурацией
 *   - theme:  CSS-тема для WebUI
 *   - locale: переводы UI/промптов
 *
 * Источники:
 *   - официальный реестр (TheSashaDev/girl-agent-addons/index.json)
 *   - сторонние URL (git/npm)
 *   - локальные папки (для разработчиков)
 *
 * Установка:
 *   - persona / theme / locale: распаковка файлов в data/<slug>/ или ~/.local/share/girl-agent/addons/
 *   - mod / mcp: запись в config (mcp[]) + npm install для MCP-сервера
 *   - fix: применение patch'а через git apply (если есть git) или ручное merging
 */

export type AddonType = "fix" | "mod" | "persona" | "mcp" | "theme" | "locale";

export interface AddonManifest {
  type: AddonType;
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  /** semver range girl-agent совместимости */
  compatibility?: string;
  tags?: string[];
  /** id'ы других аддонов (зависимости) */
  dependencies?: string[];
  /** какие поля config'а профиля переопределяет (для persona/mod) */
  configOverrides?: Record<string, unknown>;
  /** какие файлы memory профиля кладёт (persona) — относительные пути */
  files?: { path: string; content: string }[];
  /** для mcp — id пресета MCP + список секретов которые надо запросить */
  mcp?: { presetId?: string; spawn?: { command: string; args: string[]; env?: Record<string, string> }; secrets?: { key: string; label: string }[] };
  /** для theme — CSS-переменные / inline css */
  theme?: { css?: string; vars?: Record<string, string> };
  /** для locale — карта строк { "key": "перевод" } */
  locale?: { lang: string; strings: Record<string, string> };
  /** для fix — текст patch'а */
  patch?: string;
  /** настройки аддона — пользователь заполняет при установке/позже */
  settings?: AddonSetting[];
  /** превью / иконка (URL или data:) */
  icon?: string;
  homepage?: string;
}

export interface AddonSetting {
  /** уникальный ключ настройки (латиница, без пробелов) */
  key: string;
  /** отображаемое название */
  label: string;
  /** описание / подсказка */
  hint?: string;
  /** тип поля */
  type: "string" | "number" | "boolean" | "select";
  /** значение по умолчанию */
  default?: string | number | boolean;
  /** варианты для type=select */
  options?: { value: string; label: string }[];
  /** обязательное ли поле */
  required?: boolean;
}

export interface InstalledAddon {
  manifest: AddonManifest;
  enabled: boolean;
  installedAt: string;
  source: "registry" | "url" | "local";
  /** пользовательские значения настроек */
  settingsValues?: Record<string, string | number | boolean>;
}

export const REGISTRY_URL = process.env.GIRL_AGENT_ADDON_REGISTRY
  ?? "https://raw.githubusercontent.com/TheSashaDev/girl-agent-addons/main/index.json";

function addonsDir(): string {
  const root = process.env.GIRL_AGENT_DATA
    ? path.resolve(process.env.GIRL_AGENT_DATA, "..")
    : path.join(os.homedir(), ".local", "share", "girl-agent");
  return path.join(root, "addons");
}

async function ensureDir(): Promise<string> {
  const dir = addonsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readJsonOrEmpty<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

export async function listInstalled(): Promise<InstalledAddon[]> {
  const dir = await ensureDir();
  const indexPath = path.join(dir, "installed.json");
  return await readJsonOrEmpty<InstalledAddon[]>(indexPath, []);
}

async function writeInstalled(list: InstalledAddon[]): Promise<void> {
  const dir = await ensureDir();
  await fs.writeFile(path.join(dir, "installed.json"), JSON.stringify(list, null, 2), "utf8");
}

export async function fetchRegistry(): Promise<AddonManifest[]> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return BUILTIN_ADDONS;
    const data = await res.json() as { addons?: AddonManifest[] };
    if (!data || !Array.isArray(data.addons)) return BUILTIN_ADDONS;
    return [...BUILTIN_ADDONS, ...data.addons];
  } catch {
    return BUILTIN_ADDONS;
  }
}

export async function installFromManifest(manifest: AddonManifest, source: "registry" | "url" | "local" = "registry"): Promise<InstalledAddon> {
  validateManifest(manifest);
  const list = await listInstalled();
  const existingIdx = list.findIndex(a => a.manifest.id === manifest.id);
  const item: InstalledAddon = { manifest, enabled: true, installedAt: new Date().toISOString(), source };
  if (existingIdx >= 0) list[existingIdx] = item;
  else list.push(item);
  await writeInstalled(list);
  return item;
}

export async function uninstall(id: string): Promise<boolean> {
  const list = await listInstalled();
  const next = list.filter(a => a.manifest.id !== id);
  if (next.length === list.length) return false;
  await writeInstalled(next);
  return true;
}

export async function toggle(id: string, enabled: boolean): Promise<InstalledAddon | null> {
  const list = await listInstalled();
  const item = list.find(a => a.manifest.id === id);
  if (!item) return null;
  item.enabled = enabled;
  await writeInstalled(list);
  return item;
}

export async function updateSettings(id: string, values: Record<string, string | number | boolean>): Promise<InstalledAddon | null> {
  const list = await listInstalled();
  const item = list.find(a => a.manifest.id === id);
  if (!item) return null;
  item.settingsValues = { ...(item.settingsValues ?? {}), ...values };
  await writeInstalled(list);
  return item;
}

export function validateManifest(m: unknown): asserts m is AddonManifest {
  if (!m || typeof m !== "object") throw new Error("manifest must be object");
  const x = m as Record<string, unknown>;
  if (typeof x.id !== "string" || !x.id) throw new Error("manifest.id required");
  if (typeof x.name !== "string" || !x.name) throw new Error("manifest.name required");
  if (typeof x.description !== "string") throw new Error("manifest.description required");
  if (typeof x.version !== "string") throw new Error("manifest.version required");
  if (!["fix", "mod", "persona", "mcp", "theme", "locale"].includes(String(x.type))) {
    throw new Error("manifest.type invalid");
  }
}

/**
 * Встроенные аддоны — доступны без подключения к сети.
 * Это демо-каталог чтобы UI маркетплейса всегда был непустым в офлайне.
 */
export const BUILTIN_ADDONS: AddonManifest[] = [
  {
    type: "persona",
    id: "persona-anime-tsundere",
    name: "Аниме-цундере",
    description: "Готовая персона: цундере с резкими переходами от грубости к нежности. Любит мангу, играет в визуальные новеллы.",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["persona", "anime", "tsundere"],
    configOverrides: { ignoreTendency: 55, communication: { messageStyle: "one-liners", initiative: "low", lifeSharing: "low", notifications: "muted" } },
    files: [
      { path: "persona.md", content: "Цундере. Притворяется холодной но внутри тёплая. Любит аниме, мангу, визуальные новеллы. Зимой пьёт какао, летом гуляет в парке. Раздражается когда её называют милой." },
      { path: "speech.md", content: "Короткие резкие фразы. Часто 'хмф', 'ну и что', 'не подумай чего'. После грубости иногда смягчается." },
      { path: "boundaries.md", content: "Не флиртует напрямую. Никогда не признаётся первой. Если давить — уходит на сутки." }
    ]
  },
  {
    type: "persona",
    id: "persona-goth-girl",
    name: "Готка",
    description: "Тёмная эстетика, любит индастриал, чёрный юмор, читает Камю и Чорана.",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["persona", "goth", "dark"],
    configOverrides: { ignoreTendency: 40, communication: { messageStyle: "balanced", initiative: "medium", lifeSharing: "medium", notifications: "normal" } },
    files: [
      { path: "persona.md", content: "Готка, 22, изучает философию. Любит The Cure, Type O Negative, Sisters of Mercy. Курит. Пьёт чёрный кофе и красное вино." },
      { path: "speech.md", content: "Спокойная сухая ирония, без капса и эмодзи. Любит чёрный юмор. Не пишет 'хи-хи' и не использует милых сокращений." }
    ]
  },
  {
    type: "mod",
    id: "mod-night-owl",
    name: "Night Owl",
    description: "Активна ночью (23:00–05:00), спит днём. Удобно для тех, кто сам ложится поздно.",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["mod", "schedule"],
    configOverrides: { sleepFrom: 6, sleepTo: 14, nightWakeChance: 0.6 },
    settings: [
      { key: "sleepFrom", label: "Засыпает в", type: "number", default: 6, hint: "Час (0–23)" },
      { key: "sleepTo", label: "Просыпается в", type: "number", default: 14, hint: "Час (0–23)" },
      { key: "nightWakeChance", label: "Шанс проснуться ночью", type: "select", default: "0.6", options: [
        { value: "0.2", label: "Низкий (20%)" },
        { value: "0.4", label: "Средний (40%)" },
        { value: "0.6", label: "Высокий (60%)" },
        { value: "0.8", label: "Очень высокий (80%)" }
      ] }
    ]
  },
  {
    type: "theme",
    id: "theme-cyberpunk",
    name: "Cyberpunk",
    description: "Неоново-розовая тема для WebUI с акцентами cyan + magenta.",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["theme"],
    theme: {
      vars: {
        "--ga-accent": "#ff2bd6",
        "--ga-accent-2": "#00f0ff",
        "--ga-bg": "#0a0014",
        "--ga-bg-glass": "rgba(20, 0, 40, 0.55)",
        "--ga-text": "#ffe2ff",
        "--ga-border": "rgba(255, 43, 214, 0.35)"
      }
    }
  },
  {
    type: "theme",
    id: "theme-pastel",
    name: "Pastel",
    description: "Мягкая пастельная тема для светлого режима.",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["theme", "light"],
    theme: {
      vars: {
        "--ga-accent": "#f5a3c7",
        "--ga-accent-2": "#a3d8f5",
        "--ga-bg": "#fdfaf8",
        "--ga-bg-glass": "rgba(255, 245, 250, 0.78)",
        "--ga-text": "#3a2a3f",
        "--ga-border": "rgba(245, 163, 199, 0.45)"
      }
    }
  },
  {
    type: "locale",
    id: "locale-en",
    name: "English (UI)",
    description: "Английский перевод интерфейса WebUI (промпты остаются русскими).",
    version: "0.1.0",
    author: "girl-agent",
    tags: ["locale"],
    locale: {
      lang: "en",
      strings: {
        "tab.assistant": "Assistant",
        "tab.logs": "Logs",
        "tab.addons": "Addons",
        "tab.config": "Configuration",
        "tab.memory": "Memory",
        "apply": "Apply"
      }
    }
  },
  {
    type: "fix",
    id: "fix-markdown-escape",
    name: "Markdown escape fix",
    description: "Дополнительный patch для экранирования спецсимволов в MarkdownV2 (если ваш билд старый).",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["bugfix", "telegram", "markdown"],
    compatibility: "<=0.1.16"
  },
  {
    type: "mcp",
    id: "mcp-exa-search",
    name: "Exa Web Search",
    description: "Девушка может погуглить мем, трек, тренд через Exa.",
    version: "1.0.0",
    author: "girl-agent",
    tags: ["mcp", "search"],
    mcp: {
      presetId: "exa",
      secrets: [{ key: "EXA_API_KEY", label: "Exa API key" }]
    }
  }
];
