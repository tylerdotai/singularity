import type { SchedulerDatabase } from '../scheduler.sql.js';
import { MIGRATION_00X_SCHEDULER } from './00X_scheduler.sql.js';

export const SCHEDULER_MIGRATIONS = [MIGRATION_00X_SCHEDULER];

export function runSchedulerMigrations(db: SchedulerDatabase): void {
  for (const migration of SCHEDULER_MIGRATIONS) {
    migration.up(db);
  }
}
