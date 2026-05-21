/**
 * Тесты роутов `/api/whitelist/:slug` (Task 5.3 manager-mode,
 * Req 1.9, 17.6, 17.7).
 *
 * Стратегия: поднимаем минимальный HTTP-сервер с тем же auth-guard'ом,
 * что и в `webui/server.ts` (см. mandate.spec.ts), и подаём реальные
 * запросы через `fetch`. Это покрывает и хендлеры, и слой 401.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRoot: string;
let server: http.Server;
let baseUrl: string;
const AUTH_PASSWORD = "test-whitelist-secret-yz";
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_PASSWORD}` };
const SLUG_OK = "test-whitelist-routes";
const SLUG_MISSING = "no-such-profile-xyz";

let storage: typeof import("../../storage/md.js");

async function writeFakeConfig(slug: string, extra: Record<string, unknown> = {}): Promise<void> {
  const dir = path.join(tmpRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({ slug, name: "Test Manager", ...extra }),
    "utf8"
  );
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-webui-whitelist-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  process.env.MANAGER_AGENT_WEBUI_PASSWORD = AUTH_PASSWORD;

  storage = await import("../../storage/md.js");
  const httpMod = await import("../../webui/http.js");
  const routesMod = await import("../../webui/routes/whitelist.js");
  const auth = await import("../../webui/auth.js");

  await writeFakeConfig(SLUG_OK);

  // Минимальный HTTP-сервер с auth-guard'ом — копия паттерна из
  // production-сервера (см. webui/server.ts) без websocket'ов.
  const router = new httpMod.Router();
  routesMod.registerWhitelistRoutes(router);

  server = http.createServer(async (req, res) => {
    httpMod.setCors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (!url.pathname.startsWith("/api/")) { httpMod.sendJson(res, 404, { error: "not found" }); return; }
      if (!auth.isAuthorized(req)) { httpMod.sendJson(res, 401, { error: "auth required" }); return; }
      const matched = router.match(req.method ?? "GET", url.pathname);
      if (!matched) { httpMod.sendJson(res, 404, { error: "not found" }); return; }
      let body: unknown;
      try { body = await httpMod.readBody(req); }
      catch (e) {
        if (e instanceof httpMod.HttpError) { httpMod.sendJson(res, e.status, { error: e.message }); return; }
        throw e;
      }
      try {
        const result = await matched.route.handler({
          req, res, params: matched.params, url, body, searchParams: url.searchParams
        });
        if (!res.writableEnded) httpMod.sendJson(res, 200, result);
      } catch (e) {
        if (e instanceof httpMod.HttpError) { httpMod.sendJson(res, e.status, { error: e.message }); return; }
        httpMod.sendJson(res, 500, { error: (e as Error)?.message ?? String(e) });
      }
    } catch (e) {
      httpMod.sendJson(res, 500, { error: (e as Error)?.message ?? String(e) });
    }
  });

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.MANAGER_AGENT_DATA;
  delete process.env.MANAGER_AGENT_WEBUI_PASSWORD;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function putWhitelist(slug: string, whitelist: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/whitelist/${slug}`, {
    method: "PUT",
    headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify({ whitelist })
  });
}

describe("GET /api/whitelist/:slug", () => {
  it("возвращает пустой массив, если whitelist не задан в конфиге", async () => {
    const r = await fetch(`${baseUrl}/api/whitelist/${SLUG_OK}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(200);
    const json = (await r.json()) as { whitelist: unknown[] };
    expect(json.whitelist).toEqual([]);
  });

  it("возвращает сохранённый whitelist (round-trip через writeConfig)", async () => {
    const slug = "wl-get-saved";
    await writeFakeConfig(slug, {
      whitelist: [{ kind: "id", chatId: 12345 }, { kind: "username", username: "alice" }]
    });
    const r = await fetch(`${baseUrl}/api/whitelist/${slug}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(200);
    const json = (await r.json()) as { whitelist: unknown[] };
    expect(json.whitelist).toEqual([{ kind: "id", chatId: 12345 }, { kind: "username", username: "alice" }]);
  });

  it("возвращает 404 для несуществующего профиля", async () => {
    const r = await fetch(`${baseUrl}/api/whitelist/${SLUG_MISSING}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(404);
  });

  it("возвращает 401 без Authorization заголовка", async () => {
    const r = await fetch(`${baseUrl}/api/whitelist/${SLUG_OK}`);
    expect(r.status).toBe(401);
  });
});

describe("PUT /api/whitelist/:slug", () => {
  it("заменяет whitelist (round-trip через readConfig)", async () => {
    const slug = "wl-put-roundtrip";
    await writeFakeConfig(slug);
    const r = await putWhitelist(slug, [
      { kind: "id", chatId: 42 },
      { kind: "username", username: "bob_42" }
    ]);
    expect(r.status).toBe(200);
    const cfg = await storage.readConfig(slug);
    expect(cfg?.whitelist).toEqual([
      { kind: "id", chatId: 42 },
      { kind: "username", username: "bob_42" }
    ]);
  });

  // Все случаи валидации Req 17.6 — параметризовано, чтобы не плодить
  // одинаковую обёртку. Каждая запись = одна некорректная запись в payload.
  const invalidEntries: Array<[string, unknown]> = [
    ["chatId=0", { kind: "id", chatId: 0 }],
    ["chatId=10_000_000_000_000 (>max)", { kind: "id", chatId: 10_000_000_000_000 }],
    ["username длиной 2 символа", { kind: "username", username: "ab" }],
    ["username длиной 33 символа", { kind: "username", username: "a".repeat(33) }],
    ["username с дефисом и `!`", { kind: "username", username: "bad-name!" }],
    ["неизвестный kind", { kind: "phone", value: "+79000000000" }]
  ];
  it.each(invalidEntries)("отклоняет %s c 400", async (_label, entry) => {
    const r = await putWhitelist(SLUG_OK, [entry]);
    expect(r.status).toBe(400);
  });

  it("обрезает лидирующий @ и приводит username к нижнему регистру", async () => {
    const slug = "wl-strip-at";
    await writeFakeConfig(slug);
    const r = await putWhitelist(slug, [{ kind: "username", username: "@AliCE_99" }]);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { whitelist: { kind: string; username: string }[] };
    expect(json.whitelist).toEqual([{ kind: "username", username: "alice_99" }]);
    const cfg = await storage.readConfig(slug);
    expect(cfg?.whitelist).toEqual([{ kind: "username", username: "alice_99" }]);
  });

  it("отклоняет дубликаты внутри списка (chatId и username case-insensitive)", async () => {
    const dupId = await putWhitelist(SLUG_OK, [
      { kind: "id", chatId: 100 }, { kind: "id", chatId: 100 }
    ]);
    expect(dupId.status).toBe(400);
    const dupName = await putWhitelist(SLUG_OK, [
      { kind: "username", username: "Alice" }, { kind: "username", username: "alice" }
    ]);
    expect(dupName.status).toBe(400);
  });

  it("возвращает 404 для несуществующего профиля", async () => {
    const r = await putWhitelist(SLUG_MISSING, []);
    expect(r.status).toBe(404);
  });

  it("возвращает 401 без Authorization заголовка", async () => {
    const r = await fetch(`${baseUrl}/api/whitelist/${SLUG_OK}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whitelist: [] })
    });
    expect(r.status).toBe(401);
  });
});
