import type { SchedulerDatabase } from '../scheduler.sql.js';
import { SCHEDULER_JOBS_SCHEMA } from '../scheduler.sql.js';

export const MIGRATION_00X_SCHEDULER = {
  id: '00X_scheduler',
  up: (db: SchedulerDatabase) => {
    db.exec(SCHEDULER_JOBS_SCHEMA);
  },
  down: (_db: SchedulerDatabase) => {
    // no-op — schema is append-only for now
  },
};
