/**
 * Migration 0115: girl-agent → manager-mode миграция профиля.
 *
 * См. .kiro/specs/manager-mode/tasks.md task 3.6 и
 * .kiro/specs/manager-mode/design.md § 3.6.
 *
 * Что делает:
 *  1. Удаляет устаревшие girl-agent поля из ProfileConfig (vibe, communication
 *     полностью, stage сбрасывается до "manager-default").
 *  2. Выставляет дефолты новых manager-mode полей: tone="mixed-by-tier",
 *     personaStyle="gender-neutral-assistant", gateLevel="gated",
 *     afterHoursPolicy="vip-only", proactiveClients=false, proactiveBoss=false,
 *     escalationTimeoutMin=240, digestPeriodHours=24, digestTime="09:00",
 *     profileType="manager".
 *  3. Удаляет файлы relationship.md, conflict.json, boundaries.md из профиля
 *     (они потеряли смысл в manager-mode).
 *  4. Создаёт data/<slug>/mandate.md с шаблоном если отсутствует.
 *  5. Создаёт пустой data/<slug>/tickets.json с initial state.
 *  6. Создаёт пустую директорию data/<slug>/contacts/.
 *  7. Логирует warning если ownerId не задан (Requirement 1.6).
 */

import path from "node:path";
import { promises as fs } from "node:fs";

import type { Migration, MigrationContext } from "./index.js";
import { saveTickets, saveMandate, profileDir } from "../storage/md.js";
import type { ProfileConfig, TicketsFile } from "../types.js";

const MANDATE_TEMPLATE = `# Mandate

## Решаю сама
- стандартные приветствия
- (опиши темы, которые менеджер закрывает без вас)

## Эскалирую
- (опиши темы, которые требуют вашего решения)

## Никогда не отвечаю
- (опиши темы, которые менеджер должен молча игнорировать или отклонять)
`;

async function rmIfExists(p: string): Promise<boolean> {
  try {
    await fs.unlink(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export const migration0115: Migration = {
  id: "0115-manager-mode",
  description: "Перевод girl-agent профилей в manager-mode (Tier/Tone/Mandate/Tickets)",

  async migrate(ctx: MigrationContext): Promise<ProfileConfig> {
    const { config, log } = ctx;
    const dir = profileDir(config.slug);

    // 1. Сбрасываем legacy-поля и проставляем дефолты manager-mode.
    const next: ProfileConfig = {
      ...config,
      vibe: undefined,
      communication: undefined,
      stage: "manager-default",
      tone: config.tone ?? "mixed-by-tier",
      personaStyle: config.personaStyle ?? "gender-neutral-assistant",
      gateLevel: config.gateLevel ?? "gated",
      afterHoursPolicy: config.afterHoursPolicy ?? "vip-only",
      proactiveClients: config.proactiveClients ?? false,
      proactiveBoss: config.proactiveBoss ?? false,
      escalationTimeoutMin: config.escalationTimeoutMin ?? 240,
      digestPeriodHours: config.digestPeriodHours ?? 24,
      digestTime: config.digestTime ?? "09:00",
      profileType: "manager"
    };

    if (next.gateLevel !== "whitelist") {
      // Whitelist валиден только при gateLevel=whitelist (Requirement 1.9).
      next.whitelist = undefined;
    }

    // 2. Удаляем устаревшие файлы — игнорируем отсутствующие.
    let removed = 0;
    for (const name of ["relationship.md", "conflict.json", "boundaries.md"]) {
      if (await rmIfExists(path.join(dir, name))) removed++;
    }
    if (removed > 0) {
      log(`удалено ${removed} устаревших файлов girl-agent`);
    }

    // 3. Создаём mandate.md если отсутствует.
    const mandatePath = path.join(dir, "mandate.md");
    try {
      await fs.access(mandatePath);
    } catch {
      await saveMandate(config.slug, MANDATE_TEMPLATE);
      log("создан data/<slug>/mandate.md (шаблон)");
    }

    // 4. Создаём tickets.json если отсутствует.
    const ticketsPath = path.join(dir, "tickets.json");
    try {
      await fs.access(ticketsPath);
    } catch {
      const empty: TicketsFile = { version: 1, nextId: 1, tickets: [] };
      await saveTickets(config.slug, empty);
      log("создан data/<slug>/tickets.json (пустой)");
    }

    // 5. Создаём пустую папку contacts/ если её нет.
    await fs.mkdir(path.join(dir, "contacts"), { recursive: true });

    // 6. Warning если ownerId не задан.
    if (!next.ownerId || next.ownerId <= 0) {
      log("⚠ ownerId не задан — задайте его через WebUI до старта профиля");
    }

    return next;
  }
};
