/**
 * Тесты роутов `/api/inbox/:slug` (Task 5.5 manager-mode, Req 11.1-11.8).
 *
 * Паттерн совпадает с `contacts.spec.ts`/`mandate.spec.ts` — реальный HTTP-сервер
 * с auth-guard'ом и роутером, запросы через `fetch`. Стораджом подменяем
 * `MANAGER_AGENT_DATA` на tmp-каталог, тикеты сидим через `saveTickets`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ticket, TicketsFile } from "../../types.js";

let tmpRoot: string;
let server: http.Server;
let baseUrl: string;
const AUTH_PASSWORD = "test-inbox-secret-9k";
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_PASSWORD}` };
const SLUG_OK = "test-inbox-routes";
const SLUG_MISSING = "no-such-profile-zzz";

let storage: typeof import("../../storage/md.js");

async function writeFakeConfig(slug: string): Promise<void> {
  const dir = path.join(tmpRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ slug, name: "Test" }), "utf8");
}

function makeTicket(
  id: string,
  chatId: string,
  state: Ticket["state"],
  createdAt: string,
  extra: Partial<Ticket> = {}
): Ticket {
  return {
    id,
    chatId,
    summary: `summary for ${id}`,
    state,
    createdAt,
    history: [{ ts: createdAt, from: "<initial>", to: "open", reason: "test", by: "system" }],
    ...extra
  };
}

async function seedTickets(slug: string, tickets: Ticket[], nextId = 100): Promise<void> {
  const file: TicketsFile = { version: 1, nextId, tickets };
  await storage.saveTickets(slug, file);
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-webui-inbox-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  process.env.MANAGER_AGENT_WEBUI_PASSWORD = AUTH_PASSWORD;

  storage = await import("../../storage/md.js");
  const httpMod = await import("../../webui/http.js");
  const routesMod = await import("../../webui/routes/inbox.js");
  const auth = await import("../../webui/auth.js");

  await writeFakeConfig(SLUG_OK);

  const router = new httpMod.Router();
  routesMod.registerInboxRoutes(router);

  server = http.createServer(async (req, res) => {
    httpMod.setCors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
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
      if (e instanceof httpMod.HttpError) {
        httpMod.sendJson(res, e.status, { error: e.message, details: e.details });
        return;
      }
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

async function postJson(url: string, body: unknown, withAuth = true): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { ...(withAuth ? AUTH_HEADER : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("GET /api/inbox/:slug", () => {
  it("возвращает все тикеты, по умолчанию desc по createdAt (Req 11.3)", async () => {
    const slug = "list-default-sort";
    await writeFakeConfig(slug);
    await seedTickets(slug, [
      makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z"),
      makeTicket("#T-2", "c-2", "answered",    "2024-05-12T10:00:00.000Z"),
      makeTicket("#T-3", "c-3", "closed",      "2024-05-11T10:00:00.000Z")
    ]);
    const r = await fetch(`${baseUrl}/api/inbox/${slug}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(200);
    const { tickets } = (await r.json()) as { tickets: Ticket[] };
    expect(tickets.map(t => t.id)).toEqual(["#T-2", "#T-3", "#T-1"]);
  });

  it("сортирует asc при ?sort=asc", async () => {
    const slug = "list-asc-sort";
    await writeFakeConfig(slug);
    await seedTickets(slug, [
      makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z"),
      makeTicket("#T-2", "c-2", "answered",    "2024-05-12T10:00:00.000Z"),
      makeTicket("#T-3", "c-3", "closed",      "2024-05-11T10:00:00.000Z")
    ]);
    const r = await fetch(`${baseUrl}/api/inbox/${slug}?sort=asc`, { headers: AUTH_HEADER });
    const { tickets } = (await r.json()) as { tickets: Ticket[] };
    expect(tickets.map(t => t.id)).toEqual(["#T-1", "#T-3", "#T-2"]);
  });

  it("фильтрует по ?state=waiting-boss (Req 11.3)", async () => {
    const slug = "list-filter-state";
    await writeFakeConfig(slug);
    await seedTickets(slug, [
      makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z"),
      makeTicket("#T-2", "c-2", "answered",    "2024-05-12T10:00:00.000Z"),
      makeTicket("#T-3", "c-3", "waiting-boss", "2024-05-11T10:00:00.000Z"),
      makeTicket("#T-4", "c-4", "closed",      "2024-05-09T10:00:00.000Z")
    ]);
    const r = await fetch(`${baseUrl}/api/inbox/${slug}?state=waiting-boss`, { headers: AUTH_HEADER });
    const { tickets } = (await r.json()) as { tickets: Ticket[] };
    expect(tickets.every(t => t.state === "waiting-boss")).toBe(true);
    expect(tickets.map(t => t.id)).toEqual(["#T-3", "#T-1"]);
  });

  it("отклоняет невалидный ?state c 400", async () => {
    const r = await fetch(`${baseUrl}/api/inbox/${SLUG_OK}?state=not-a-state`, { headers: AUTH_HEADER });
    expect(r.status).toBe(400);
  });

  it("возвращает 404 для несуществующего профиля", async () => {
    const r = await fetch(`${baseUrl}/api/inbox/${SLUG_MISSING}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(404);
  });

  it("возвращает 401 без Authorization (Req 11.1)", async () => {
    const r = await fetch(`${baseUrl}/api/inbox/${SLUG_OK}`);
    expect(r.status).toBe(401);
  });
});

describe("GET /api/inbox/:slug/:ticketId", () => {
  it("возвращает один тикет с llmDraftForBoss для waiting-boss (Req 11.6)", async () => {
    const slug = "detail-with-draft";
    await writeFakeConfig(slug);
    await seedTickets(slug, [
      makeTicket("#T-7", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z", {
        llmDraftForBoss: "Предлагаю отказаться, ставка низкая"
      })
    ]);
    const r = await fetch(`${baseUrl}/api/inbox/${slug}/%23T-7`, { headers: AUTH_HEADER });
    expect(r.status).toBe(200);
    const { ticket } = (await r.json()) as { ticket: Ticket };
    expect(ticket.id).toBe("#T-7");
    expect(ticket.llmDraftForBoss).toBe("Предлагаю отказаться, ставка низкая");
  });

  it("возвращает 404 для несуществующего ticketId", async () => {
    const slug = "detail-missing";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "open", "2024-05-10T10:00:00.000Z")]);
    const r = await fetch(`${baseUrl}/api/inbox/${slug}/%23T-99`, { headers: AUTH_HEADER });
    expect(r.status).toBe(404);
  });

  it("возвращает 401 без Authorization (Req 11.1)", async () => {
    const r = await fetch(`${baseUrl}/api/inbox/${SLUG_OK}/%23T-1`);
    expect(r.status).toBe(401);
  });
});

describe("POST /api/inbox/:slug/:ticketId/reply", () => {
  it("happy path: waiting-boss → answered, поля bossReplyRaw/clientReply фиксируются (Req 11.4)", async () => {
    const slug = "reply-happy";
    await writeFakeConfig(slug);
    await seedTickets(slug, [
      makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z")
    ]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, {
      text: "Да, согласен на встречу в среду в 14:00"
    });
    expect(r.status).toBe(200);
    const { ticket } = (await r.json()) as { ticket: Ticket };
    expect(ticket.state).toBe("answered");
    expect(ticket.bossReplyRaw).toBe("Да, согласен на встречу в среду в 14:00");
    expect(ticket.clientReply).toBe("Да, согласен на встречу в среду в 14:00");
    expect(ticket.bossReplyAt).toBeDefined();
    expect(ticket.clientReplyAt).toBeDefined();

    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].state).toBe("answered");
    expect(persisted.tickets[0].history.at(-1)?.to).toBe("answered");
    expect(persisted.tickets[0].history.at(-1)?.by).toBe("owner-webui");
  });

  it("отклоняет пустой text (1..4096) c 400 (Req 11.5)", async () => {
    const slug = "reply-empty";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z")]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, { text: "" });
    expect(r.status).toBe(400);
    // Тикет не изменился.
    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].state).toBe("waiting-boss");
    expect(persisted.tickets[0].bossReplyRaw).toBeUndefined();
  });

  it("отклоняет text длиной 4097 c 400 (Req 11.5)", async () => {
    const slug = "reply-too-long";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z")]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, { text: "x".repeat(4097) });
    expect(r.status).toBe(400);
    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].state).toBe("waiting-boss");
  });

  it("принимает text ровно 4096 (граница)", async () => {
    const slug = "reply-boundary";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z")]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, { text: "y".repeat(4096) });
    expect(r.status).toBe(200);
    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].bossReplyRaw?.length).toBe(4096);
  });

  it("отклоняет повторный reply на тикет в state=answered (Req 11.8)", async () => {
    const slug = "reply-on-answered";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "answered", "2024-05-10T10:00:00.000Z", {
      bossReplyRaw: "ранее ответил", clientReply: "ранее ответил"
    })]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, { text: "повторный ответ" });
    expect(r.status).toBe(400);
    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].bossReplyRaw).toBe("ранее ответил");
  });

  it("отклоняет reply на тикет в state=closed (Req 11.8)", async () => {
    const slug = "reply-on-closed";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "closed", "2024-05-10T10:00:00.000Z")]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, { text: "что-то" });
    expect(r.status).toBe(400);
  });

  it("отклоняет reply при confidentiality leak с деталями, тикет не меняется (Req 7+11.4)", async () => {
    // composeClientReplyFromBoss проверяет первичный порог 80 символов
    // относительно `summary`. Делаем summary >80 и текст содержит его целиком.
    const slug = "reply-leak";
    await writeFakeConfig(slug);
    const longSummary = "Клиент Х спрашивает про условия контракта на поставку оборудования "
      + "которые мы обсуждали на прошлой встрече и просит уточнить сроки.";
    expect(longSummary.length).toBeGreaterThan(80);
    await seedTickets(slug, [
      makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z", { summary: longSummary })
    ]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/reply`, { text: longSummary });
    expect(r.status).toBe(400);
    const j = await r.json() as { error: string; details?: { kind: string; violationKind: string } };
    expect(j.details?.kind).toBe("confidentiality-leak");
    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].state).toBe("waiting-boss");
    expect(persisted.tickets[0].bossReplyRaw).toBeUndefined();
  });

  it("возвращает 401 без Authorization (Req 11.1)", async () => {
    const r = await postJson(`${baseUrl}/api/inbox/${SLUG_OK}/%23T-1/reply`, { text: "x" }, false);
    expect(r.status).toBe(401);
  });
});

describe("POST /api/inbox/:slug/:ticketId/cancel", () => {
  it("happy path: waiting-boss → closed", async () => {
    const slug = "cancel-happy";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "waiting-boss", "2024-05-10T10:00:00.000Z")]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/cancel`, {});
    expect(r.status).toBe(200);
    const { ticket } = (await r.json()) as { ticket: Ticket };
    expect(ticket.state).toBe("closed");
    expect(ticket.closedAt).toBeDefined();
    const persisted = await storage.loadTickets(slug);
    expect(persisted.tickets[0].state).toBe("closed");
    expect(persisted.tickets[0].history.at(-1)?.reason).toBe("webui-cancel");
    expect(persisted.tickets[0].history.at(-1)?.by).toBe("owner-webui");
  });

  it("отклоняет cancel на closed с 400 (Req 11.8)", async () => {
    const slug = "cancel-on-closed";
    await writeFakeConfig(slug);
    await seedTickets(slug, [makeTicket("#T-1", "c-1", "closed", "2024-05-10T10:00:00.000Z")]);
    const r = await postJson(`${baseUrl}/api/inbox/${slug}/%23T-1/cancel`, {});
    expect(r.status).toBe(400);
  });

  it("возвращает 401 без Authorization (Req 11.1)", async () => {
    const r = await postJson(`${baseUrl}/api/inbox/${SLUG_OK}/%23T-1/cancel`, {}, false);
    expect(r.status).toBe(401);
  });
});
