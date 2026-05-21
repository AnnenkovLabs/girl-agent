import { Router, HttpError } from "../http.js";
import { readConfig, loadTickets, saveTickets, loadMandate } from "../../storage/md.js";
import {
  composeClientReplyFromBoss,
  isAllowedTransition,
  transitionTicket
} from "../../engine/escalation.js";
import type { Ticket, TicketState, TicketsFile } from "../../types.js";

/**
 * Маршруты инбокса тикетов через WebUI (Task 5.5 manager-mode,
 * Requirement 11).
 *
 * - `GET  /api/inbox/:slug?state=<state>&sort=asc|desc` — список тикетов,
 *   сортировка по `createdAt` (по умолчанию `desc`), фильтр `state` (Req 11.2-11.3).
 * - `GET  /api/inbox/:slug/:ticketId` — детали тикета; `llmDraftForBoss`
 *   попадает в ответ как обычное поле `Ticket`, фронт его и показывает для
 *   `waiting-boss` (Req 11.6).
 * - `POST /api/inbox/:slug/:ticketId/reply` — ответ боссу через WebUI;
 *   эквивалент `Boss_Reply` в Telegram (Req 11.4): прогон через
 *   `composeClientReplyFromBoss` (тот же confidentiality-guard, что и в
 *   `runtime.handleBossMessage`), затем переход `waiting-boss → answered`.
 * - `POST /api/inbox/:slug/:ticketId/cancel` — `open`/`waiting-boss → closed`.
 *
 * Аутентификация выше по стеку (`server.ts` → `auth.ts:isAuthorized`).
 *
 * Замечание о доставке: WebUI не имеет хэндла Telegram-адаптера, поэтому
 * фактическую отправку клиенту выполняет runtime'овый Telegram-флоу. Тут мы
 * атомарно фиксируем boss-reply на тикете (`bossReplyRaw`/`clientReply` +
 * transition `waiting-boss → answered`) — это совпадает с состоянием тикета
 * после успешной отправки в `handleBossMessage`. Спека описывает поведение
 * через инвариант состояний (Req 11.4 + Req 18), а не дублирующийся send.
 */

/** Лимиты длины ответа из Req 11.4-11.5. */
const REPLY_MIN_LEN = 1;
const REPLY_MAX_LEN = 4096;

const VALID_FILTER_STATES: ReadonlyArray<TicketState> = [
  "open",
  "waiting-boss",
  "answered",
  "closed"
];

function isValidFilterState(value: unknown): value is TicketState {
  return typeof value === "string" && (VALID_FILTER_STATES as readonly string[]).includes(value);
}

/** Сортировка по `createdAt` (ISO-строка лексикографически = хронологически). */
function compareByCreatedAt(a: Ticket, b: Ticket, dir: "asc" | "desc"): number {
  if (a.createdAt === b.createdAt) return 0;
  const sign = dir === "asc" ? 1 : -1;
  return a.createdAt < b.createdAt ? -1 * sign : 1 * sign;
}

/**
 * Per-slug мьютекс — сериализует `loadTickets → mutate → saveTickets`,
 * чтобы параллельные reply/cancel не затирали друг друга. Один файл на
 * профиль, поэтому ключ — slug, а не `(slug, ticketId)`.
 */
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await next;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

function findTicketIndex(file: TicketsFile, ticketId: string): number {
  return file.tickets.findIndex(t => t.id === ticketId);
}

export function registerInboxRoutes(r: Router): void {
  r.get("/api/inbox/:slug", async ({ params, searchParams }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");

    const stateParam = searchParams.get("state");
    if (stateParam !== null && stateParam !== "all" && !isValidFilterState(stateParam)) {
      throw new HttpError(
        400,
        `invalid state: must be one of ${VALID_FILTER_STATES.join("|")}|all`
      );
    }
    const sortParam = searchParams.get("sort");
    if (sortParam !== null && sortParam !== "asc" && sortParam !== "desc") {
      throw new HttpError(400, "sort must be 'asc' or 'desc'");
    }
    const direction: "asc" | "desc" = sortParam === "asc" ? "asc" : "desc";

    const file = await loadTickets(slug);
    const filtered = stateParam && stateParam !== "all"
      ? file.tickets.filter(t => t.state === stateParam)
      : file.tickets.slice();
    filtered.sort((a, b) => compareByCreatedAt(a, b, direction));
    return { tickets: filtered };
  });

  r.get("/api/inbox/:slug/:ticketId", async ({ params }) => {
    const slug = params.slug ?? "";
    const ticketId = params.ticketId ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");

    const file = await loadTickets(slug);
    const ticket = file.tickets.find(t => t.id === ticketId);
    if (!ticket) throw new HttpError(404, "ticket not found");
    return { ticket };
  });

  r.post("/api/inbox/:slug/:ticketId/reply", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const ticketId = params.ticketId ?? "";

    // Валидируем тело ДО любых файловых операций — Req 11.5: невалидный ввод
    // не должен вызывать побочные эффекты, форма сохраняет введённый текст
    // (фронт получает 400 + body, поле `text` ничем не перезатирается).
    const data = body as { text?: unknown } | null | undefined;
    if (!data || typeof data !== "object") throw new HttpError(400, "invalid body");
    if (typeof data.text !== "string") throw new HttpError(400, "text must be string");
    const text = data.text;
    if (text.length < REPLY_MIN_LEN) {
      throw new HttpError(400, `reply must be at least ${REPLY_MIN_LEN} char`);
    }
    if (text.length > REPLY_MAX_LEN) {
      throw new HttpError(400, `reply must be ≤${REPLY_MAX_LEN} chars`);
    }

    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");

    return withLock(slug, async () => {
      const file = await loadTickets(slug);
      const idx = findTicketIndex(file, ticketId);
      if (idx < 0) throw new HttpError(404, "ticket not found");
      const ticket = file.tickets[idx];

      // Req 11.8: повторный ответ на answered/closed — отказ.
      if (ticket.state === "answered" || ticket.state === "closed") {
        throw new HttpError(400, `ticket already ${ticket.state}`);
      }
      // Reply имеет смысл только из waiting-boss — `open` всё ещё ждёт
      // решения mandate-слоя. Из `open` можно только cancel.
      if (!isAllowedTransition(ticket.state, "answered")) {
        throw new HttpError(400, `cannot reply: state=${ticket.state}`);
      }

      // Прогон через тот же путь, что и Boss_Reply в Telegram
      // (runtime.ts:handleBossMessage). Никакого LLM здесь — caller
      // (WebUI) явно просит отправить ровно `text` от имени босса.
      const mandateText = await loadMandate(slug).catch(() => "");
      const composed = await composeClientReplyFromBoss({
        ticket,
        bossReplyText: text,
        mandate: mandateText
      });
      if (composed.kind === "blocked") {
        throw new HttpError(400, "confidentiality leak", {
          kind: "confidentiality-leak",
          violationKind: composed.violationKind,
          reason: composed.reason
        });
      }

      const now = new Date().toISOString();
      const nextTicket = transitionTicket(ticket, "answered", "webui-reply", "owner-webui", now);
      nextTicket.bossReplyAt = now;
      nextTicket.bossReplyRaw = text;
      nextTicket.clientReply = composed.text;
      nextTicket.clientReplyAt = now;
      file.tickets[idx] = nextTicket;
      await saveTickets(slug, file);
      return { ticket: nextTicket };
    });
  });

  r.post("/api/inbox/:slug/:ticketId/cancel", async ({ params }) => {
    const slug = params.slug ?? "";
    const ticketId = params.ticketId ?? "";

    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");

    return withLock(slug, async () => {
      const file = await loadTickets(slug);
      const idx = findTicketIndex(file, ticketId);
      if (idx < 0) throw new HttpError(404, "ticket not found");
      const ticket = file.tickets[idx];

      // Cancel допустим только из активных состояний. Req 11.8 косвенно:
      // closed/answered — финальные, не трогаем.
      if (ticket.state !== "open" && ticket.state !== "waiting-boss") {
        throw new HttpError(400, `cannot cancel: state=${ticket.state}`);
      }

      const now = new Date().toISOString();
      const nextTicket = transitionTicket(ticket, "closed", "webui-cancel", "owner-webui", now);
      file.tickets[idx] = nextTicket;
      await saveTickets(slug, file);
      return { ticket: nextTicket };
    });
  });
}
