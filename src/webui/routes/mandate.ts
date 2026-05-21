import { Router, HttpError } from "../http.js";
import { loadMandate, saveMandate, readConfig } from "../../storage/md.js";

/**
 * Маршруты управления `mandate.md` через WebUI (Task 5.2 manager-mode,
 * Requirement 3.1, 3.2).
 *
 * - `GET  /api/mandate/:slug` — читает `mandate.md` профиля и возвращает
 *   `{ text }`. Если профиль не существует — 404.
 * - `PUT  /api/mandate/:slug` — принимает `{ text }` (≤4000 символов),
 *   сохраняет файл атомарно через `saveMandate`. Hot-reload в runtime
 *   происходит автоматически благодаря watcher'у `subscribeMandate`,
 *   подписанному из `engine/mandate.ts` при старте профиля (Task 4.3).
 *
 * Аутентификация: оба эндпоинта попадают под общий guard `isAuthorized`
 * в `webui/server.ts` для всех путей `/api/*`. Отдельная проверка здесь
 * не нужна: неаутентифицированные запросы отвечают 401 ещё до диспатча
 * к этому хендлеру.
 */

/** Максимум для тела `mandate.md` — синхронизирован с валидацией визарда. */
const MANDATE_MAX_LEN = 4000;

export function registerMandateRoutes(r: Router): void {
  r.get("/api/mandate/:slug", async ({ params }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const text = await loadMandate(slug);
    return { text };
  });

  r.put("/api/mandate/:slug", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const data = body as { text?: unknown } | null | undefined;
    if (!data || typeof data !== "object") {
      throw new HttpError(400, "invalid body");
    }
    if (typeof data.text !== "string") {
      throw new HttpError(400, "text must be string");
    }
    if (data.text.length > MANDATE_MAX_LEN) {
      throw new HttpError(400, `text must be ≤${MANDATE_MAX_LEN} chars`);
    }
    await saveMandate(slug, data.text);
    return { ok: true };
  });
}
