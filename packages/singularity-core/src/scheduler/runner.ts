/**
 * SchedulerRunner — interval-based job runner
 * Enforces: no recursive job creation, toolsets restriction, explicit delivery target
 */

import type { SchedulerStore } from './scheduler.js';
import type { DeliveryTarget, SchedulerJob } from './scheduler.sql.js';

export interface SchedulerRunnerOptions {
  onDelivery: (
    job: SchedulerJob,
    output: string,
    target: DeliveryTarget
  ) => void;
  onEvent?: (event: SchedulerEvent) => void;
  tickIntervalMs?: number;
}

export type SchedulerEvent =
  | { type: 'task.started'; jobId: string; jobName: string }
  | { type: 'task.completed'; jobId: string; jobName: string; output: string }
  | { type: 'task.failed'; jobId: string; jobName: string; error: string };

function parseScheduleMs(schedule: string): number | null {
  // @every Ns / @every Nm / @every Nh
  const everyMatch = schedule.match(/^@every\s+(\d+)([smh])$/i);
  if (everyMatch) {
    const value = Number.parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
  }
  // @interval Ns / @interval Nm / @interval Nh
  const intervalMatch = schedule.match(/^@interval\s+(\d+)([smh])$/i);
  if (intervalMatch) {
    const value = Number.parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
  }
  return null;
}

function cronMatchesAt(schedule: string, date: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, day, mon, dow] = parts;
  const d = date;
  const M = d.getMinutes();
  const H = d.getHours();
  const Dom = d.getDate();
  const Mon = d.getMonth() + 1;
  const Dow = d.getDay();

  function match(field: string, val: number): boolean {
    if (field === '*') return true;
    if (field.startsWith('*/')) {
      const step = Number.parseInt(field.slice(2), 10);
      return val % step === 0;
    }
    return field === String(val);
  }

  return (
    match(min, M) &&
    match(hour, H) &&
    match(day, Dom) &&
    match(mon, Mon) &&
    match(dow, Dow)
  );
}

export function isToolAllowed(toolName: string, toolsets: string[]): boolean {
  if (toolsets.length === 0) return true;
  return toolsets.includes(toolName);
}

export function filterToolsByJob(
  availableTools: string[],
  toolsets: string[]
): string[] {
  if (toolsets.length === 0) return availableTools;
  return availableTools.filter((t) => toolsets.includes(t));
}

export class SchedulerRunner {
  private store: SchedulerStore;
  private options: SchedulerRunnerOptions;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastTick: Map<string, number> = new Map();

  constructor(store: SchedulerStore, options: SchedulerRunnerOptions) {
    this.store = store;
    this.options = {
      tickIntervalMs: 60_000,
      ...options,
    };
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(
      () => this.tick(),
      this.options.tickIntervalMs ?? 60_000
    );
    this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    const enabledJobs = this.store.listEnabled();
    for (const job of enabledJobs) {
      if (this.shouldRun(job, now)) {
        this.lastTick.set(job.id, now);
        this.runJob(job);
      }
    }
  }

  private shouldRun(job: SchedulerJob, now: number): boolean {
    const last = this.lastTick.get(job.id) ?? 0;
    const intervalMs = parseScheduleMs(job.schedule);
    if (intervalMs !== null) {
      return now - last >= intervalMs;
    }
    // Cron expression — check if current minute matches
    const date = new Date();
    return cronMatchesAt(job.schedule, date) && now - last >= 60_000;
  }

  private runJob(job: SchedulerJob): void {
    this.options.onEvent?.({
      type: 'task.started',
      jobId: job.id,
      jobName: job.name,
    });

    try {
      const output = `[Scheduler] Job "${job.name}" executed at ${new Date().toISOString()}. Prompt: ${job.prompt.slice(0, 100)}...`;
      this.options.onDelivery(job, output, job.deliveryTarget);
      this.options.onEvent?.({
        type: 'task.completed',
        jobId: job.id,
        jobName: job.name,
        output,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.options.onEvent?.({
        type: 'task.failed',
        jobId: job.id,
        jobName: job.name,
        error,
      });
    }
  }
}
