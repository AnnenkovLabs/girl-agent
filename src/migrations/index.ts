/**
 * Система миграций данных.
 *
 * Каждая миграция — объект с id (семантическая версия), description и функцией migrate().
 * migrate() получает путь к профилю и config, может модифицировать файлы на диске.
 *
 * Миграции выполняются в порядке возрастания id. Уже применённые миграции
 * пропускаются (трекаются через .migrations.json в DATA_ROOT).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileConfig } from "../types.js";
import type { LLMClient } from "../llm/index.js";
import { DATA_ROOT, listProfiles, readConfig, writeConfig, profileDir } from "../storage/md.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface MigrationInputField {
  key: string;
  label: string;
  secret?: boolean;
}

export interface MigrationContext {
  profilePath: string;
  config: ProfileConfig;
  llm?: LLMClient;
  log: (msg: string) => void;
}

export interface Migration {
  id: string;
  description: string;
  needsLLM?: boolean;
  needsInput?: MigrationInputField[];
  migrate(ctx: MigrationContext): Promise<ProfileConfig>;
}

const MIGRATIONS_FILE = () => path.join(DATA_ROOT, ".migrations.json");

interface MigrationState {
  appliedMigrations: string[];
  lastRunVersion: string;
  lastRunAt: string;
}

async function readMigrationState(): Promise<MigrationState> {
  try {
    const raw = await fs.readFile(MIGRATIONS_FILE(), "utf8");
    return JSON.parse(raw) as MigrationState;
  } catch {
    return { appliedMigrations: [], lastRunVersion: "0.0.0", lastRunAt: "" };
  }
}

async function writeMigrationState(state: MigrationState): Promise<void> {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.writeFile(MIGRATIONS_FILE(), JSON.stringify(state, null, 2), "utf8");
}

// --- Реестр миграций (добавлять новые сюда в порядке возрастания) ---
import { migration0112 } from "./0112-add-use-wss-default.js";
import { migration0113 } from "./0113-ensure-communication-md.js";
import { migration0114 } from "./0114-memory-palace.js";
import { migration0115 } from "./0115-manager-mode.js";

export const ALL_MIGRATIONS: Migration[] = [
  migration0112,
  migration0113,
  migration0114,
  migration0115,
];

/**
 * Возвращает список миграций, которые ещё не были применены.
 */
export async function pendingMigrations(): Promise<Migration[]> {
  const state = await readMigrationState();
  return ALL_MIGRATIONS.filter(m => !state.appliedMigrations.includes(m.id));
}

export interface MigrationWarning {
  migrationId: string;
  description: string;
  missingInputs: MigrationInputField[];
}

export interface UpdateResult {
  profilesUpdated: number;
  migrationsApplied: string[];
  warnings: MigrationWarning[];
  errors: { profile: string; migration: string; error: string }[];
}

/**
 * Запуск всех pending-миграций по всем профилям.
 */
export async function runMigrations(opts?: {
  verbose?: boolean;
  llmFactory?: (cfg: ProfileConfig) => LLMClient | undefined;
}): Promise<UpdateResult> {
  const pending = await pendingMigrations();
  const log = opts?.verbose ? (msg: string) => process.stderr.write(msg + "\n") : () => {};

  if (pending.length === 0) {
    log("все миграции уже применены, данные актуальны.");
    return { profilesUpdated: 0, migrationsApplied: [], warnings: [], errors: [] };
  }

  const profiles = await listProfiles();
  const state = await readMigrationState();
  const result: UpdateResult = { profilesUpdated: 0, migrationsApplied: [], warnings: [], errors: [] };

  for (const migration of pending) {
    log(`\n[migration] ${migration.id}: ${migration.description}`);
    let profilesAffected = 0;

    for (const slug of profiles) {
      const cfg = await readConfig(slug);
      if (!cfg) {
        log(`  пропуск ${slug}: не удалось прочитать config.json`);
        continue;
      }

      if (migration.needsInput?.length) {
        const missing = migration.needsInput.filter(field => {
          const val = (cfg as unknown as Record<string, unknown>)[field.key];
          return val === undefined || val === null || val === "";
        });
        if (missing.length > 0) {
          result.warnings.push({
            migrationId: migration.id,
            description: migration.description,
            missingInputs: missing
          });
          log(`  ⚠ ${slug}: требуется ввод: ${missing.map(f => f.label).join(", ")}`);
        }
      }

      let llm: LLMClient | undefined;
      if (migration.needsLLM && opts?.llmFactory) {
        try {
          llm = opts.llmFactory(cfg);
        } catch (e) {
          log(`  ${slug}: не удалось создать LLM: ${(e as Error).message}`);
        }
      }

      try {
        const updated = await migration.migrate({
          profilePath: profileDir(slug),
          config: cfg,
          llm,
          log: (msg: string) => log(`  ${slug}: ${msg}`)
        });
        await writeConfig(updated);
        profilesAffected++;
        log(`  ${slug}: ок`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        log(`  ${slug}: ошибка — ${errMsg}`);
        result.errors.push({ profile: slug, migration: migration.id, error: errMsg });
      }
    }

    state.appliedMigrations.push(migration.id);
    result.migrationsApplied.push(migration.id);
    result.profilesUpdated = Math.max(result.profilesUpdated, profilesAffected);
    log(`  применено к ${profilesAffected} профилям`);
  }

  state.lastRunVersion = currentVersion();
  state.lastRunAt = new Date().toISOString();
  await writeMigrationState(state);

  return result;
}

/**
 * Проверяет, есть ли pending-миграции. Можно вызывать при старте runtime.
 */
export async function checkForPendingMigrations(): Promise<boolean> {
  const pending = await pendingMigrations();
  return pending.length > 0;
}

export function formatUpdateWarnings(warnings: MigrationWarning[]): string {
  if (!warnings.length) return "";
  const lines = ["[updater] ⚠ для завершения обновления необходимо:"];
  for (const w of warnings) {
    for (const field of w.missingInputs) {
      const secret = field.secret ? " (секрет)" : "";
      lines.push(`  • ${field.label}${secret} — требуется для: ${w.description}`);
    }
  }
  return lines.join("\n");
}

function currentVersion(): string {
  try {
    const here = fileURLToPath(import.meta.url);
    let dir = path.dirname(here);
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
        if (pkg.name === "@thesashadev/manager-agent" && pkg.version) return pkg.version;
      } catch { /* next */ }
      dir = path.dirname(dir);
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
