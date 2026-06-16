/**
 * SchedulerStore — CRUD for scheduler_jobs table
 */

import type {
  DeliveryTarget,
  ModelPolicy,
  SchedulerDatabase,
  SchedulerJob,
} from './scheduler.sql.js';
import { SCHEDULER_JOBS_SCHEMA } from './scheduler.sql.js';

function generateId(): string {
  return `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export interface CreateSchedulerJobInput {
  profileId: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
  deliveryTarget?: DeliveryTarget;
  toolsets?: string[];
  modelPolicy?: ModelPolicy;
}

export interface UpdateSchedulerJobInput {
  name?: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
  deliveryTarget?: DeliveryTarget;
  toolsets?: string[];
  modelPolicy?: ModelPolicy;
}

function dehydrateJob(job: SchedulerJob): unknown[] {
  return [
    job.id,
    job.profileId,
    job.name,
    job.schedule,
    job.prompt,
    job.enabled ? 1 : 0,
    job.deliveryTarget,
    JSON.stringify(job.toolsets),
    JSON.stringify(job.modelPolicy),
    job.createdAt,
    job.updatedAt,
  ];
}

function hydrateJob(row: Record<string, unknown>): SchedulerJob {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    name: row.name as string,
    schedule: row.schedule as string,
    prompt: row.prompt as string,
    enabled: (row.enabled as number) === 1,
    deliveryTarget: row.delivery_target as DeliveryTarget,
    toolsets: JSON.parse((row.toolsets_json as string) || '[]'),
    modelPolicy: JSON.parse((row.model_policy_json as string) || '{}'),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SchedulerStore {
  private db: SchedulerDatabase;
  private insertStmt: ReturnType<SchedulerDatabase['prepare']>;
  private updateStmt: ReturnType<SchedulerDatabase['prepare']>;

  constructor(db: SchedulerDatabase) {
    this.db = db;
    this.db.exec(SCHEDULER_JOBS_SCHEMA);
    this.insertStmt = this.db.prepare(`
      INSERT INTO scheduler_jobs (id, profile_id, name, schedule, prompt, enabled, delivery_target, toolsets_json, model_policy_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateStmt = this.db.prepare(`
      UPDATE scheduler_jobs
      SET name = ?, schedule = ?, prompt = ?, enabled = ?,
          delivery_target = ?, toolsets_json = ?,
          model_policy_json = ?, updated_at = ?
      WHERE id = ?
    `);
  }

  create(input: CreateSchedulerJobInput): SchedulerJob {
    const now = new Date().toISOString();
    const job: SchedulerJob = {
      id: generateId(),
      profileId: input.profileId,
      name: input.name,
      schedule: input.schedule,
      prompt: input.prompt,
      enabled: input.enabled ?? true,
      deliveryTarget: input.deliveryTarget ?? 'cli',
      toolsets: input.toolsets ?? [],
      modelPolicy: input.modelPolicy ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.insertStmt.run(...dehydrateJob(job));
    return job;
  }

  getById(id: string): SchedulerJob | null {
    const row = this.db
      .prepare('SELECT * FROM scheduler_jobs WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? hydrateJob(row) : null;
  }

  listByProfile(profileId: string): SchedulerJob[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM scheduler_jobs WHERE profile_id = ? ORDER BY created_at DESC'
      )
      .all(profileId) as Record<string, unknown>[];
    return rows.map(hydrateJob);
  }

  listEnabled(): SchedulerJob[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM scheduler_jobs WHERE enabled = 1 ORDER BY created_at DESC'
      )
      .all() as Record<string, unknown>[];
    return rows.map(hydrateJob);
  }

  update(id: string, input: UpdateSchedulerJobInput): SchedulerJob | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const updated: SchedulerJob = {
      ...existing,
      ...input,
      toolsets: input.toolsets ?? existing.toolsets,
      modelPolicy: input.modelPolicy ?? existing.modelPolicy,
      updatedAt: new Date().toISOString(),
    };
    this.updateStmt.run(
      updated.name,
      updated.schedule,
      updated.prompt,
      updated.enabled ? 1 : 0,
      updated.deliveryTarget,
      JSON.stringify(updated.toolsets),
      JSON.stringify(updated.modelPolicy),
      updated.updatedAt,
      id
    );
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM scheduler_jobs WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
