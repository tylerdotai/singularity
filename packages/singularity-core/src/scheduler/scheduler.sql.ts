/**
 * Scheduler SQLite schema and types
 * Per ARCHITECTURE.md L206-219
 */

export const SCHEDULER_JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS scheduler_jobs (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  schedule    TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  delivery_target TEXT NOT NULL DEFAULT 'cli',
  toolsets_json   TEXT NOT NULL DEFAULT '[]',
  model_policy_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_profile_id ON scheduler_jobs(profile_id);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_enabled ON scheduler_jobs(enabled);
`;

export interface SchedulerJob {
  id: string;
  profileId: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  deliveryTarget: DeliveryTarget;
  toolsets: string[];
  modelPolicy: ModelPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPolicy {
  provider?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export type DeliveryTarget = 'cli' | 'telegram' | 'discord' | 'dashboard';

/**
 * Minimum common SQLite surface shared by bun:sqlite and better-sqlite3.
 * Used by SchedulerStore to accept either backend.
 */
export interface SchedulerDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  exec(sql: string): void;
}
