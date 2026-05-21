import { Router, HttpError } from "../http.js";
import { readConfig, listContacts, loadContact, saveContact } from "../../storage/md.js";
import type { ContactRecord, Tier } from "../../types.js";
import { TIER_PRESETS } from "../../presets/contact-tiers.js";

/**
 * Маршруты управления `ContactRecord` через WebUI (Task 5.4 manager-mode,
 * Requirement 10).
 *
 * - `GET  /api/contacts/:slug?tier=&sort=desc|asc` — список контактов с
 *   сортировкой по `lastMessageAt` (по умолчанию `desc`, без даты — в хвост,
 *   Req 10.6) и опциональным фильтром по `tier` (Req 10.6).
 * - `PATCH /api/contacts/:slug/:chatId` — изменение `tier` и/или `notes`.
 *   Любая правка `tier` ставит `manualOverride=true` и сбрасывает
 *   `messagesSinceTransition` (Req 10.3, design § 8.4). Невалидный `tier`
 *   или `notes>2000` → 400 без модификации файла (Req 10.5).
 *
 * Hot-reload: `runtime.handleIncoming` зачитывает `loadContact` на каждое
 * сообщение, поэтому правка из WebUI подхватывается без рестарта (Req 10.3).
 *
 * Конкурентный доступ: per-(slug,chatId) мьютекс ниже сериализует
 * `read → mutate → write`. Атомарность на ФС — write-temp+rename в
 * `saveContact` (design § 4.3).
 */

/** Максимальная длина `notes` (Req 10.4, 10.5). */
const NOTES_MAX_LEN = 2000;

/** Допустимые значения `tier` (6 пресетов из `presets/contact-tiers.ts`). */
const VALID_TIERS: readonly Tier[] = TIER_PRESETS.map(p => p.id);

function isValidTier(value: unknown): value is Tier {
  return typeof value === "string" && (VALID_TIERS as readonly string[]).includes(value);
}

/**
 * Per-key асинхронный мьютекс — цепочка Promise'ов сериализует операции
 * для одного `(slug,chatId)`, не блокируя других.
 */
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  // `then(fn, fn)` — fn запускается независимо от исхода предыдущей операции.
  const next = previous.then(fn, fn);
  // Silent-promise в Map — поглощает отказы, чтобы не было unhandled-rejection.
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await next;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Сравнение по `lastMessageAt`: отсутствующие значения уезжают в хвост. */
function compareByLastMessage(a: ContactRecord, b: ContactRecord, dir: "asc" | "desc"): number {
  const ta = a.lastMessageAt ?? "";
  const tb = b.lastMessageAt ?? "";
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  if (ta === tb) return 0;
  const sign = dir === "asc" ? 1 : -1;
  return ta < tb ? -1 * sign : 1 * sign;
}

export function registerContactRoutes(r: Router): void {
  r.get("/api/contacts/:slug", async ({ params, searchParams }) => {
    const slug = params.slug ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");

    const tierParam = searchParams.get("tier");
    if (tierParam !== null && !isValidTier(tierParam)) {
      throw new HttpError(400, `invalid tier: must be one of ${VALID_TIERS.join("|")}`);
    }
    const sortParam = searchParams.get("sort");
    if (sortParam !== null && sortParam !== "asc" && sortParam !== "desc") {
      throw new HttpError(400, "sort must be 'asc' or 'desc'");
    }
    const direction: "asc" | "desc" = sortParam === "asc" ? "asc" : "desc";

    const all = await listContacts(slug);
    const filtered = tierParam ? all.filter(c => c.tier === tierParam) : all;
    filtered.sort((a, b) => compareByLastMessage(a, b, direction));
    return { contacts: filtered };
  });

  r.patch("/api/contacts/:slug/:chatId", async ({ params, body }) => {
    const slug = params.slug ?? "";
    const chatId = params.chatId ?? "";
    const cfg = await readConfig(slug);
    if (!cfg) throw new HttpError(404, "profile not found");

    const data = body as { tier?: unknown; notes?: unknown } | null | undefined;
    if (!data || typeof data !== "object") throw new HttpError(400, "invalid body");

    // Валидируем ВСЁ до открытия файла — Req 10.5: невалидный ввод не должен
    // менять файл.
    const hasTier = Object.prototype.hasOwnProperty.call(data, "tier");
    const hasNotes = Object.prototype.hasOwnProperty.call(data, "notes");
    if (!hasTier && !hasNotes) {
      throw new HttpError(400, "body must contain at least one of: tier, notes");
    }
    if (hasTier && !isValidTier(data.tier)) {
      throw new HttpError(400, `invalid tier: must be one of ${VALID_TIERS.join("|")}`);
    }
    if (hasNotes) {
      if (typeof data.notes !== "string") {
        throw new HttpError(400, "notes must be string");
      }
      if (data.notes.length > NOTES_MAX_LEN) {
        throw new HttpError(400, `notes must be ≤${NOTES_MAX_LEN} chars`);
      }
    }

    return withLock(`${slug}:${chatId}`, async () => {
      const existing = await loadContact(slug, chatId);
      if (!existing) throw new HttpError(404, "contact not found");

      const now = new Date().toISOString();
      let updated: ContactRecord = { ...existing, updatedAt: now };

      if (hasTier) {
        const nextTier = data.tier as Tier;
        // `manualOverride=true` ставим всегда при явной правке тира (Req 10.3),
        // даже если значение совпало с текущим — владелец «подтвердил» вручную.
        updated = {
          ...updated,
          tier: nextTier,
          manualOverride: true,
          messagesSinceTransition: 0
        };
      }
      if (hasNotes) {
        updated = { ...updated, notes: data.notes as string };
      }

      await saveContact(slug, updated);
      return { contact: updated };
    });
  });
}
