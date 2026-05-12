import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Аддоны girl-agent (.gaa формат).
 *
 * .gaa файл — zip-архив с содержимым папки аддона.
 *
 * Структура папки аддона:
 *   manifest.json      — метаданные (обязательно)
 *   files/             — файлы для копирования в data/<slug>/ (persona.md, speech.md и т.д.)
 *   config.patch.json  — JSON-объект с полями config'а профиля для мёрджа
 *   theme.css          — CSS-стили для WebUI (для theme-аддонов)
 *   install.sh         — скрипт пост-установки (опционально)
 *   README.md          — документация (опционально)
 */

export interface AddonManifest {
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
  /** настройки аддона — пользователь заполняет при установке/позже */
  settings?: AddonSetting[];
  /** превью / иконка (URL или относительный путь) */
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
  source: "registry" | "file" | "local";
  /** пользовательские значения настроек */
  settingsValues?: Record<string, string | number | boolean>;
  /** список файлов из files/ (для удаления при деинсталляции) */
  installedFiles?: string[];
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

// ==================== installed.json ====================

export async function listInstalled(): Promise<InstalledAddon[]> {
  const dir = await ensureDir();
  const indexPath = path.join(dir, "installed.json");
  return await readJsonOrEmpty<InstalledAddon[]>(indexPath, []);
}

async function writeInstalled(list: InstalledAddon[]): Promise<void> {
  const dir = await ensureDir();
  await fs.writeFile(path.join(dir, "installed.json"), JSON.stringify(list, null, 2), "utf8");
}

// ==================== registry ====================

export async function fetchRegistry(): Promise<AddonManifest[]> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json() as { addons?: AddonManifest[] };
    if (!data || !Array.isArray(data.addons)) return [];
    return data.addons;
  } catch {
    return [];
  }
}

// ==================== .gaa pack / unpack ====================

/**
 * Распаковать .gaa (zip) файл во временную директорию.
 * Возвращает путь к распакованной папке.
 */
export async function unpackGaa(gaaPath: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), `gaa-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
  await execFileAsync("unzip", ["-o", "-q", gaaPath, "-d", tmpDir]);
  // Проверяем — если архив содержит одну подпапку, заходим внутрь
  const entries = await fs.readdir(tmpDir);
  if (entries.length === 1) {
    const sub = path.join(tmpDir, entries[0]!);
    const st = await fs.stat(sub);
    if (st.isDirectory()) {
      const innerManifest = path.join(sub, "manifest.json");
      try {
        await fs.access(innerManifest);
        return sub;
      } catch { /* manifest в корне */ }
    }
  }
  return tmpDir;
}

/**
 * Запаковать папку аддона в .gaa файл.
 * Возвращает путь к созданному .gaa файлу.
 */
export async function packGaa(addonDir: string, outputPath?: string): Promise<string> {
  const manifestPath = path.join(addonDir, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as AddonManifest;
  validateManifest(manifest);

  const out = outputPath ?? path.join(process.cwd(), `${manifest.id}.gaa`);

  // Удаляем старый если есть
  try { await fs.unlink(out); } catch { /* ok */ }

  const dirName = path.basename(addonDir);
  const parentDir = path.dirname(addonDir);
  await execFileAsync("zip", ["-r", "-q", out, dirName], { cwd: parentDir });

  return out;
}

// ==================== install / uninstall ====================

import { readConfig, writeConfig, writeMd } from "../storage/md.js";

/**
 * Установка аддона из распакованной папки.
 * Применяет файлы, config.patch.json, тему.
 */
export async function installFromDir(
  addonDir: string,
  profileSlug?: string,
  source: "registry" | "file" | "local" = "local"
): Promise<{ addon: InstalledAddon; applied: string[] }> {
  const manifestPath = path.join(addonDir, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as AddonManifest;
  validateManifest(manifest);

  const applied: string[] = [];
  const installedFiles: string[] = [];

  // 1. Копируем файлы из files/ в профиль
  const filesDir = path.join(addonDir, "files");
  try {
    const fileStat = await fs.stat(filesDir);
    if (fileStat.isDirectory() && profileSlug) {
      const fileEntries = await walkDir(filesDir);
      for (const relPath of fileEntries) {
        const content = await fs.readFile(path.join(filesDir, relPath), "utf8");
        await writeMd(profileSlug, relPath, content);
        installedFiles.push(relPath);
      }
      if (fileEntries.length) applied.push(`${fileEntries.length} файл(ов) скопировано`);
    }
  } catch { /* нет директории files/ — ок */ }

  // 2. Применяем config.patch.json
  const patchPath = path.join(addonDir, "config.patch.json");
  try {
    const patchRaw = await fs.readFile(patchPath, "utf8");
    const patch = JSON.parse(patchRaw) as Record<string, unknown>;
    if (profileSlug) {
      const cfg = await readConfig(profileSlug);
      if (cfg) {
        deepMerge(cfg as unknown as Record<string, unknown>, patch);
        await writeConfig(cfg);
        applied.push(`config (${Object.keys(patch).length} полей)`);
      }
    }
  } catch { /* нет config.patch.json — ок */ }

  // 3. Применяем code.patch (git apply)
  const codePatchPath = path.join(addonDir, "code.patch");
  try {
    const patchContent = await fs.readFile(codePatchPath, "utf8");
    if (patchContent.trim()) {
      const projectRoot = path.resolve(import.meta.url.replace("file://", ""), "../../../");
      try {
        await execFileAsync("git", ["apply", "--check", codePatchPath], { cwd: projectRoot });
        await execFileAsync("git", ["apply", codePatchPath], { cwd: projectRoot });
        applied.push("code.patch применён");
      } catch (e) {
        applied.push(`code.patch: ${(e as Error)?.message ?? "ошибка применения"}`);
      }
    }
  } catch { /* нет code.patch — ок */ }

  // 4. Сохраняем тему (theme.css)
  const themePath = path.join(addonDir, "theme.css");
  try {
    const css = await fs.readFile(themePath, "utf8");
    const dir = await ensureDir();
    await fs.writeFile(path.join(dir, `theme-${manifest.id}.css`), css, "utf8");
    applied.push("тема установлена");
  } catch { /* нет theme.css — ок */ }

  // 5. Сохраняем .gaa копию в addons/
  const dir = await ensureDir();
  const addonStorePath = path.join(dir, manifest.id);
  await fs.mkdir(addonStorePath, { recursive: true });
  // Копируем manifest
  await fs.copyFile(manifestPath, path.join(addonStorePath, "manifest.json"));
  // Копируем весь контент
  const allFiles = await walkDir(addonDir);
  for (const f of allFiles) {
    if (f === "manifest.json") continue;
    const src = path.join(addonDir, f);
    const dst = path.join(addonStorePath, f);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }

  // 5. Записываем в installed.json
  const list = await listInstalled();
  const item: InstalledAddon = {
    manifest,
    enabled: true,
    installedAt: new Date().toISOString(),
    source,
    installedFiles: installedFiles.length ? installedFiles : undefined
  };
  const existingIdx = list.findIndex(a => a.manifest.id === manifest.id);
  if (existingIdx >= 0) list[existingIdx] = item;
  else list.push(item);
  await writeInstalled(list);

  return { addon: item, applied };
}

/**
 * Установка .gaa файла.
 */
export async function installFromGaa(
  gaaPath: string,
  profileSlug?: string
): Promise<{ addon: InstalledAddon; applied: string[] }> {
  const dir = await unpackGaa(gaaPath);
  try {
    return await installFromDir(dir, profileSlug, "file");
  } finally {
    // Чистим tmp
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Установка аддона из реестра (скачиваем .gaa по URL из реестра).
 */
export async function installFromRegistry(
  id: string,
  registryManifest: AddonManifest & { downloadUrl?: string },
  profileSlug?: string
): Promise<{ addon: InstalledAddon; applied: string[] }> {
  const url = registryManifest.downloadUrl;
  if (!url) {
    // Если нет downloadUrl — это legacy манифест, ставим как JSON-based
    const list = await listInstalled();
    const item: InstalledAddon = {
      manifest: registryManifest,
      enabled: true,
      installedAt: new Date().toISOString(),
      source: "registry"
    };
    const existingIdx = list.findIndex(a => a.manifest.id === id);
    if (existingIdx >= 0) list[existingIdx] = item;
    else list.push(item);
    await writeInstalled(list);
    return { addon: item, applied: [] };
  }

  // Скачиваем .gaa
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Не удалось скачать аддон: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpGaa = path.join(os.tmpdir(), `${id}-${Date.now()}.gaa`);
  await fs.writeFile(tmpGaa, buf);
  try {
    return await installFromGaa(tmpGaa, profileSlug);
  } finally {
    await fs.unlink(tmpGaa).catch(() => {});
  }
}

export async function uninstall(id: string): Promise<boolean> {
  const list = await listInstalled();
  const next = list.filter(a => a.manifest.id !== id);
  if (next.length === list.length) return false;

  // Удаляем хранилище аддона
  const dir = addonsDir();
  const addonStore = path.join(dir, id);
  await fs.rm(addonStore, { recursive: true, force: true }).catch(() => {});

  // Удаляем тему если была
  const themePath = path.join(dir, `theme-${id}.css`);
  await fs.unlink(themePath).catch(() => {});

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

// ==================== validate ====================

export function validateManifest(m: unknown): asserts m is AddonManifest {
  if (!m || typeof m !== "object") throw new Error("manifest must be object");
  const x = m as Record<string, unknown>;
  if (typeof x.id !== "string" || !x.id) throw new Error("manifest.id required");
  if (typeof x.name !== "string" || !x.name) throw new Error("manifest.name required");
  if (typeof x.description !== "string") throw new Error("manifest.description required");
  if (typeof x.version !== "string") throw new Error("manifest.version required");
}

// ==================== helpers ====================

/** Рекурсивно обходит директорию, возвращает относительные пути файлов. */
async function walkDir(dir: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      result.push(...await walkDir(path.join(dir, e.name), rel));
    } else {
      result.push(rel);
    }
  }
  return result;
}

/** Глубокий мёрдж объектов (source перезаписывает target). */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      target[key] = sv;
    }
  }
}

/**
 * Получить содержимое README.md аддона (если есть).
 */
export async function getAddonReadme(id: string): Promise<string | null> {
  const dir = addonsDir();
  const readmePath = path.join(dir, id, "README.md");
  try {
    return await fs.readFile(readmePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Получить список файлов аддона.
 */
export async function getAddonFiles(id: string): Promise<string[]> {
  const dir = addonsDir();
  const addonDir = path.join(dir, id);
  try {
    return await walkDir(addonDir);
  } catch {
    return [];
  }
}
