import { Router, HttpError } from "../http.js";
import {
  fetchRegistry, listInstalled, installFromGaa, installFromRegistry, installFromDir,
  uninstall, toggle, updateSettings, validateManifest, getAddonReadme, getAddonFiles,
  type AddonManifest
} from "../addons.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export function registerAddonRoutes(r: Router): void {
  r.get("/api/addons", async () => {
    const [available, installed] = await Promise.all([fetchRegistry(), listInstalled()]);
    const installedIds = new Set(installed.map(a => a.manifest.id));
    return {
      available: available.map(m => ({ ...m, installed: installedIds.has(m.id) })),
      installed
    };
  });

  r.get("/api/addons/installed", async () => {
    return { installed: await listInstalled() };
  });

  // Установка из реестра
  r.post("/api/addons/:id/install", async ({ params, body }) => {
    const id = params.id ?? "";
    const data = body as { profileSlug?: string } | undefined;

    const registry = await fetchRegistry();
    const manifest = registry.find(a => a.id === id);
    if (!manifest) throw new HttpError(404, "addon not found in registry");

    const result = await installFromRegistry(id, manifest, data?.profileSlug);
    return { ok: true, installed: result.addon, applied: result.applied };
  });

  // Установка из .gaa файла (upload)
  r.post("/api/addons/install-file", async ({ body }) => {
    const data = body as { gaaBase64?: string; profileSlug?: string } | undefined;
    if (!data?.gaaBase64) throw new HttpError(400, "gaaBase64 required");

    // Сохраняем во временный файл
    const buf = Buffer.from(data.gaaBase64, "base64");
    const tmpPath = path.join(os.tmpdir(), `upload-${Date.now()}.gaa`);
    await fs.writeFile(tmpPath, buf);

    try {
      const result = await installFromGaa(tmpPath, data.profileSlug);
      return { ok: true, installed: result.addon, applied: result.applied };
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  // Установка из URL (.gaa или manifest.json)
  r.post("/api/addons/install-url", async ({ body }) => {
    const data = body as { url?: string; profileSlug?: string } | undefined;
    if (!data?.url) throw new HttpError(400, "url required");

    const url = data.url.trim();

    if (url.endsWith(".gaa")) {
      // Скачиваем .gaa
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new HttpError(502, `fetch failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const tmpPath = path.join(os.tmpdir(), `url-${Date.now()}.gaa`);
      await fs.writeFile(tmpPath, buf);
      try {
        const result = await installFromGaa(tmpPath, data.profileSlug);
        return { ok: true, installed: result.addon, applied: result.applied };
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    } else {
      // Legacy: скачиваем manifest.json
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new HttpError(502, `fetch failed: HTTP ${res.status}`);
      const json = await res.json() as AddonManifest;
      validateManifest(json);
      const result = await installFromRegistry(json.id, json, data.profileSlug);
      return { ok: true, installed: result.addon, applied: result.applied };
    }
  });

  r.delete("/api/addons/:id", async ({ params }) => {
    const ok = await uninstall(params.id ?? "");
    if (!ok) throw new HttpError(404, "addon not installed");
    return { ok: true };
  });

  r.put("/api/addons/:id/toggle", async ({ params, body }) => {
    const data = body as { enabled?: boolean } | undefined;
    const result = await toggle(params.id ?? "", !!data?.enabled);
    if (!result) throw new HttpError(404, "addon not installed");
    return { ok: true, addon: result };
  });

  r.put("/api/addons/:id/settings", async ({ params, body }) => {
    const data = body as { values?: Record<string, string | number | boolean> } | undefined;
    if (!data?.values || typeof data.values !== "object") throw new HttpError(400, "values required");
    const result = await updateSettings(params.id ?? "", data.values);
    if (!result) throw new HttpError(404, "addon not installed");
    return { ok: true, addon: result };
  });

  r.get("/api/addons/:id/readme", async ({ params }) => {
    const readme = await getAddonReadme(params.id ?? "");
    return { readme: readme ?? "" };
  });

  r.get("/api/addons/:id/files", async ({ params }) => {
    const files = await getAddonFiles(params.id ?? "");
    return { files };
  });
}
