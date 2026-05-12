import { EventEmitter } from "node:events";
import type { ProfileConfig } from "../types.js";
import { Runtime, type RuntimeEvent } from "../engine/runtime.js";
import { readConfig } from "../storage/md.js";
import { checkForPendingMigrations, runMigrations, formatUpdateWarnings } from "../migrations/index.js";
import { makeLLM } from "../llm/index.js";

/**
 * RuntimeBus — оркестратор runtime'ов агента для WebUI.
 *
 * Один процесс girl-agent держит несколько профилей. Бэкенд WebUI
 * стартует/гасит/перезапускает их по запросу фронта, держит ring-buffer
 * последних событий каждого профиля для catch-up при подключении WS.
 */
export interface BufferedEvent extends RuntimeEvent {
  t: number;
}

export interface RuntimeStatus {
  slug: string;
  state: "running" | "paused" | "stopped" | "error";
  startedAt?: number;
  lastError?: string;
}

const LOG_BUFFER_SIZE = 500;

export class RuntimeBus extends EventEmitter {
  private runtimes = new Map<string, Runtime>();
  private logs = new Map<string, BufferedEvent[]>();
  private states = new Map<string, RuntimeStatus>();
  private eventListeners = new Map<string, (e: RuntimeEvent) => void>();

  list(): RuntimeStatus[] {
    return Array.from(this.states.values());
  }

  get(slug: string): Runtime | undefined {
    return this.runtimes.get(slug);
  }

  status(slug: string): RuntimeStatus {
    return this.states.get(slug) ?? { slug, state: "stopped" };
  }

  recentLogs(slug: string, limit = LOG_BUFFER_SIZE): BufferedEvent[] {
    const buf = this.logs.get(slug) ?? [];
    return buf.slice(-limit);
  }

  async start(slug: string): Promise<RuntimeStatus> {
    if (this.runtimes.has(slug)) return this.status(slug);
    const cfg = await readConfig(slug);
    if (!cfg) throw new Error(`profile not found: ${slug}`);
    return this.startWithConfig(cfg);
  }

  async startWithConfig(cfg: ProfileConfig): Promise<RuntimeStatus> {
    if (this.runtimes.has(cfg.slug)) return this.status(cfg.slug);

    if (await checkForPendingMigrations()) {
      const result = await runMigrations({
        verbose: false,
        llmFactory: (c) => { try { return makeLLM(c.llm); } catch { return undefined; } }
      });
      if (result.warnings.length) {
        this.pushLog(cfg.slug, { type: "info", text: formatUpdateWarnings(result.warnings) });
      }
    }

    const rt = new Runtime(cfg);
    const onEv = (e: RuntimeEvent) => this.pushLog(cfg.slug, e);
    rt.on("event", onEv);
    this.eventListeners.set(cfg.slug, onEv);
    this.runtimes.set(cfg.slug, rt);
    this.states.set(cfg.slug, { slug: cfg.slug, state: "running", startedAt: Date.now() });
    try {
      await rt.start();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      this.states.set(cfg.slug, { slug: cfg.slug, state: "error", lastError: msg });
      this.runtimes.delete(cfg.slug);
      rt.off("event", onEv);
      this.eventListeners.delete(cfg.slug);
      this.pushLog(cfg.slug, { type: "error", text: `runtime start failed: ${msg}` });
      throw e;
    }
    this.emit("status", this.status(cfg.slug));
    return this.status(cfg.slug);
  }

  async stop(slug: string): Promise<void> {
    const rt = this.runtimes.get(slug);
    if (!rt) return;
    const onEv = this.eventListeners.get(slug);
    if (onEv) rt.off("event", onEv);
    this.eventListeners.delete(slug);
    try { await rt.stop(); } catch { /* ignore */ }
    this.runtimes.delete(slug);
    this.states.set(slug, { slug, state: "stopped" });
    this.emit("status", this.status(slug));
  }

  async restart(slug: string): Promise<RuntimeStatus> {
    if (this.runtimes.has(slug)) await this.stop(slug);
    return this.start(slug);
  }

  pause(slug: string): boolean {
    const rt = this.runtimes.get(slug);
    if (!rt) return false;
    rt.pause();
    const cur = this.states.get(slug);
    if (cur) this.states.set(slug, { ...cur, state: "paused" });
    this.emit("status", this.status(slug));
    return true;
  }

  resume(slug: string): boolean {
    const rt = this.runtimes.get(slug);
    if (!rt) return false;
    rt.resume();
    const cur = this.states.get(slug);
    if (cur) this.states.set(slug, { ...cur, state: "running" });
    this.emit("status", this.status(slug));
    return true;
  }

  pushLog(slug: string, e: RuntimeEvent): void {
    const evt: BufferedEvent = { ...e, t: Date.now() };
    let buf = this.logs.get(slug);
    if (!buf) { buf = []; this.logs.set(slug, buf); }
    buf.push(evt);
    if (buf.length > LOG_BUFFER_SIZE) buf.splice(0, buf.length - LOG_BUFFER_SIZE);
    this.emit(`log:${slug}`, evt);
    this.emit("log", { slug, event: evt });
  }

  async stopAll(): Promise<void> {
    const slugs = Array.from(this.runtimes.keys());
    await Promise.all(slugs.map(s => this.stop(s)));
  }
}

export const bus = new RuntimeBus();
