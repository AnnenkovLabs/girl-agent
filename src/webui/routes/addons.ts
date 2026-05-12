import { Router, HttpError } from "../http.js";
import { fetchRegistry, listInstalled, installFromManifest, uninstall, toggle, updateSettings, BUILTIN_ADDONS, validateManifest, type AddonManifest } from "../addons.js";
import { readConfig, writeConfig, writeMd } from "../../storage/md.js";

export function registerAddonRoutes(r: Router): void {
  r.get("/api/addons", async () => {
    const [available, installed] = await Promise.all([fetchRegistry(), listInstalled()]);
    const installedIds = new Set(installed.map(a => a.manifest.id));
    return {
      available: available.map(m => ({ ...m, installed: installedIds.has(m.id) })),
      installed,
      builtin: BUILTIN_ADDONS.map(a => a.id)
    };
  });

  r.get("/api/addons/installed", async () => {
    return { installed: await listInstalled() };
  });

  r.post("/api/addons/:id/install", async ({ params, body }) => {
    const id = params.id ?? "";
    const data = body as { manifest?: AddonManifest; profileSlug?: string } | undefined;
    let manifest = data?.manifest;
    if (!manifest) {
      const list = await fetchRegistry();
      manifest = list.find(a => a.id === id);
      if (!manifest) throw new HttpError(404, "addon not found in registry");
    }
    validateManifest(manifest);
    if (manifest.id !== id) throw new HttpError(400, "id mismatch");

    // Apply addon to profile if applicable
    const applied: string[] = [];
    if (data?.profileSlug && (manifest.type === "persona" || manifest.type === "mod" || manifest.type === "mcp")) {
      const cfg = await readConfig(data.profileSlug);
      if (!cfg) throw new HttpError(404, "profile not found");
      if (manifest.configOverrides) {
        Object.assign(cfg, manifest.configOverrides);
        applied.push(`config (${Object.keys(manifest.configOverrides).length} field(s))`);
      }
      if (manifest.type === "mcp" && manifest.mcp?.presetId) {
        const cur = cfg.mcp ?? [];
        if (!cur.find(m => m.id === manifest.mcp?.presetId)) {
          const secrets: Record<string, string> = {};
          for (const s of manifest.mcp.secrets ?? []) secrets[s.key] = "";
          cur.push({ id: manifest.mcp.presetId, secrets });
          cfg.mcp = cur;
          applied.push(`mcp ${manifest.mcp.presetId}`);
        }
      }
      if (manifest.type === "persona" && manifest.files) {
        for (const f of manifest.files) {
          if (!f.path || /\.\./.test(f.path) || f.path.startsWith("/")) continue;
          await writeMd(data.profileSlug, f.path, f.content ?? "");
        }
        if (manifest.files.length) applied.push(`${manifest.files.length} file(s)`);
      }
      await writeConfig(cfg);
    }

    const installed = await installFromManifest(manifest, "registry");
    return { ok: true, installed, applied };
  });

  r.post("/api/addons/install-url", async ({ body }) => {
    const data = body as { url?: string; profileSlug?: string } | undefined;
    if (!data?.url) throw new HttpError(400, "url required");
    let manifest: AddonManifest;
    try {
      const res = await fetch(data.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new HttpError(502, `fetch failed: HTTP ${res.status}`);
      const json = await res.json() as AddonManifest;
      validateManifest(json);
      manifest = json;
    } catch (e) {
      throw new HttpError(400, `invalid manifest: ${(e as Error).message}`);
    }

    if (data.profileSlug && (manifest.type === "persona" || manifest.type === "mod" || manifest.type === "mcp")) {
      const cfg = await readConfig(data.profileSlug);
      if (!cfg) throw new HttpError(404, "profile not found");
      if (manifest.configOverrides) Object.assign(cfg, manifest.configOverrides);
      if (manifest.type === "persona" && manifest.files) {
        for (const f of manifest.files) {
          if (!f.path || /\.\./.test(f.path) || f.path.startsWith("/")) continue;
          await writeMd(data.profileSlug, f.path, f.content ?? "");
        }
      }
      await writeConfig(cfg);
    }
    const installed = await installFromManifest(manifest, "url");
    return { ok: true, installed };
  });

  r.post("/api/addons/preview", async ({ body }) => {
    const data = body as { manifest?: AddonManifest; profileSlug?: string } | undefined;
    if (!data?.manifest) throw new HttpError(400, "manifest required");
    try { validateManifest(data.manifest); } catch (e) { throw new HttpError(400, `invalid: ${(e as Error).message}`); }
    const conflicts: string[] = [];
    const installed = await listInstalled();
    if (installed.find(a => a.manifest.id === data.manifest!.id)) conflicts.push(`addon ${data.manifest.id} уже установлен`);
    if (data.profileSlug) {
      const cfg = await readConfig(data.profileSlug);
      if (cfg && data.manifest.configOverrides) {
        for (const k of Object.keys(data.manifest.configOverrides)) {
          if ((cfg as unknown as Record<string, unknown>)[k] !== undefined) conflicts.push(`перепишет config.${k}`);
        }
      }
      if (cfg && data.manifest.type === "persona" && data.manifest.files) {
        for (const f of data.manifest.files) conflicts.push(`перепишет ${f.path}`);
      }
    }
    return { ok: true, conflicts };
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
}
