import { Router, HttpError } from "../http.js";
import { readConfig, writeConfig } from "../../storage/md.js";
import type { ProfileConfig, WhitelistEntry } from "../../types.js";

/**
 * Маршруты управления `whitelist` через WebUI (Task 5.3, Req 1.9, 17.6, 17.7).
 * `GET` отдаёт `cfg.whitelist` (дефолт `[]`); `PUT` валидирует записи
 * (Req 17.6), отвергает дубликаты внутри списка и атомарно сохраняет
 * `ProfileConfig`. Hot-reload (≤5 секунд, Req 17.7) обеспечивает
 * `subscribeConfig` из `engine/runtime.ts` (Task 4.8) — рестарт не нужен.
 * Аутентификация — общий guard `isAuthorized` в `webui/server.ts`.
 */

/** Допустимый диапазон Telegram chatId (Req 17.6). */
const CHAT_ID_MIN = 1;
const CHAT_ID_MAX = 9_999_999_999_999;
/** Длина и алфавит username (Req 17.6). */
const USERNAME_MIN_LEN = 3;
const USERNAME_MAX_LEN = 32;
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/** Нормализует и валидирует одну запись whitelist. */
function normalizeEntry(
  raw: unknown,
  index: number
): { ok: true; entry: WhitelistEntry } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `whitelist[${index}]: not an object` };
  }
  const e = raw as Partial<WhitelistEntry>;
  if (e.kind === "id") {
    const idRaw = (e as { chatId?: unknown }).chatId;
    const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
    if (!Number.isFinite(id) || !Number.isSafeInteger(id) || id < CHAT_ID_MIN || id > CHAT_ID_MAX) {
      return { ok: false, error: `whitelist[${index}]: chatId must be integer ${CHAT_ID_MIN}..${CHAT_ID_MAX}` };
    }
    return { ok: true, entry: { kind: "id", chatId: id } };
  }
  if (e.kind === "username") {
    const uRaw = (e as { username?: unknown }).username;
    if (typeof uRaw !== "string") {
      return { ok: false, error: `whitelist[${index}]: username must be string` };
    }
    // Лидирующий `@` в форме допустим — обрезаем перед валидацией.
    const u = uRaw.startsWith("@") ? uRaw.slice(1) : uRaw;
    if (u.length < USERNAME_MIN_LEN || u.length > USERNAME_MAX_LEN || !USERNAME_RE.test(u)) {
      return {
        ok: false,
        error: `whitelist[${index}]: username must be ${USERNAME_MIN_LEN}..${USERNAME_MAX_LEN} chars [a-zA-Z0-9_]`
      };
    }
    return { ok: true, entry: { kind: "username", username: u.toLowerCase() } };
  }
  return { ok: false, error: `whitelist[${index}]: kind must be 'id' or 'username'` };
}

export function registerWhitelistRoutes(r: Router): void {
  r.get("/api/whitelist/:slug", async ({ params }) => {
    const cfg = await readConfig(params.slug ?? "");
    if (!cfg) throw new HttpError(404, "profile not found");
    return { whitelist: cfg.whitelist ?? [] };
  });

  r.put("/api/whitelist/:slug", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const data = body as { whitelist?: unknown } | null | undefined;
    if (!data || typeof data !== "object") throw new HttpError(400, "invalid body");
    if (!Array.isArray(data.whitelist)) throw new HttpError(400, "whitelist must be array");

    const entries: WhitelistEntry[] = [];
    const seenIds = new Set<number>();
    const seenUsernames = new Set<string>();
    for (let i = 0; i < data.whitelist.length; i++) {
      const result = normalizeEntry(data.whitelist[i], i);
      if (!result.ok) throw new HttpError(400, result.error);
      const entry = result.entry;
      if (entry.kind === "id") {
        if (seenIds.has(entry.chatId)) {
          throw new HttpError(400, `whitelist[${i}]: duplicate chatId ${entry.chatId}`);
        }
        seenIds.add(entry.chatId);
      } else {
        // Имена уже в нижнем регистре — сравнение регистронезависимо.
        if (seenUsernames.has(entry.username)) {
          throw new HttpError(400, `whitelist[${i}]: duplicate username @${entry.username}`);
        }
        seenUsernames.add(entry.username);
      }
      entries.push(entry);
    }

    // Атомарная замена `whitelist`. Hot-reload через `subscribeConfig`
    // (Task 4.8) подхватит изменение в runtime.
    const next: ProfileConfig = { ...cfg, whitelist: entries };
    await writeConfig(next);
    return { ok: true, whitelist: entries };
  });
}
