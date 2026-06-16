import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { filterToolsByJob, isToolAllowed, SchedulerRunner } from './runner.js';
import { SchedulerStore } from './scheduler.js';

let db: Database;
let store: SchedulerStore;
let deliveredJobs: { job: unknown; output: string; target: string }[];

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  store = new SchedulerStore(db);
  deliveredJobs = [];
});

describe('isToolAllowed', () => {
  it('should allow all tools when toolsets is empty', () => {
    expect(isToolAllowed('shell', [])).toBe(true);
    expect(isToolAllowed('read', [])).toBe(true);
  });

  it('should allow only listed tools', () => {
    expect(isToolAllowed('shell', ['shell', 'read'])).toBe(true);
    expect(isToolAllowed('write', ['shell', 'read'])).toBe(false);
  });
});

describe('filterToolsByJob', () => {
  it('should return all tools when toolsets is empty', () => {
    const tools = ['shell', 'read', 'write'];
    expect(filterToolsByJob(tools, [])).toEqual(tools);
  });

  it('should filter to allowed tools', () => {
    const tools = ['shell', 'read', 'write'];
    expect(filterToolsByJob(tools, ['shell'])).toEqual(['shell']);
  });
});

describe('SchedulerRunner', () => {
  describe('start/stop', () => {
    it('should start and stop without error', () => {
      const runner = new SchedulerRunner(store, {
        onDelivery: () => {},
        tickIntervalMs: 10_000_000,
      });
      runner.start();
      runner.stop();
    });
  });

  describe('tick', () => {
    it('should emit delivery for enabled jobs', () => {
      store.create({
        profileId: 'p',
        name: 'Test job',
        schedule: '@every 1s',
        prompt: 'Test prompt',
        deliveryTarget: 'cli',
      });
      const runner = new SchedulerRunner(store, {
        onDelivery: (job, output, target) => {
          deliveredJobs.push({ job, output, target });
        },
        tickIntervalMs: 10_000_000,
      });
      runner.start();
      runner.stop();
      expect(deliveredJobs.length).toBeGreaterThan(0);
    });

    it('should not emit for disabled jobs', () => {
      store.create({
        profileId: 'p',
        name: 'Disabled job',
        schedule: '@every 1s',
        prompt: 'Test',
        enabled: false,
      });
      const runner = new SchedulerRunner(store, {
        onDelivery: (job) => {
          deliveredJobs.push({ job, output: '', target: '' });
        },
        tickIntervalMs: 10_000_000,
      });
      runner.start();
      runner.stop();
      expect(deliveredJobs.length).toBe(0);
    });
  });
});
