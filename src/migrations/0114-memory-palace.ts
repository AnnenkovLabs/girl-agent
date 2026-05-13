import type { Migration } from "./index.js";
import { migrateExistingMemoryToPalace } from "../engine/memory-palace.js";

export const migration0114: Migration = {
  id: "0114-memory-palace",
  description: "Перенести существующие файлы памяти в структуру Memory Palace",

  async migrate(ctx): Promise<typeof ctx.config> {
    const made = await migrateExistingMemoryToPalace(ctx.config);
    if (made > 0) ctx.log(`memory palace drawers: +${made}`);
    return ctx.config;
  }
};
