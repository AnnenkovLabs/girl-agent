import type { ProfileConfig } from "../types.js";
import { appendMd } from "../storage/md.js";
import {
  loadMemoryPalaceContext,
  memoryPalacePromptFragment,
  migrateExistingMemoryToPalace,
  recordInteractionMemory,
  type MemoryPalaceContext
} from "./memory-palace.js";

export type RealismContext = MemoryPalaceContext;

export const loadRealismContext = loadMemoryPalaceContext;

export const realismPromptFragment = memoryPalacePromptFragment;

export { recordInteractionMemory };

export async function maybeAdvanceRelationshipTimeline(cfg: ProfileConfig, previousStage: string, nextStage: string): Promise<void> {
  if (previousStage === nextStage) return;
  await migrateExistingMemoryToPalace(cfg);
  await appendMd(cfg.slug, "relationship/timeline.md", `- ${new Date().toISOString()}: стадия изменилась ${previousStage} → ${nextStage}\n`);
}
