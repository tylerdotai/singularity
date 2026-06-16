import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { SchedulerStore } from './scheduler.js';

let db: Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
});

describe('SchedulerStore', () => {
  describe('create', () => {
    it('should create a scheduler job', () => {
      const store = new SchedulerStore(db);
      const job = store.create({
        profileId: 'prof_test',
        name: 'Daily cleanup',
        schedule: '@every 1h',
        prompt: 'Run cleanup',
      });
      expect(job.id).toMatch(/^sch_/);
      expect(job.profileId).toBe('prof_test');
      expect(job.name).toBe('Daily cleanup');
      expect(job.schedule).toBe('@every 1h');
      expect(job.enabled).toBe(true);
      expect(job.deliveryTarget).toBe('cli');
      expect(job.toolsets).toEqual([]);
    });

    it('should create with all options', () => {
      const store = new SchedulerStore(db);
      const job = store.create({
        profileId: 'prof_1',
        name: 'Hourly report',
        schedule: '0 * * * *',
        prompt: 'Generate report',
        enabled: false,
        deliveryTarget: 'discord',
        toolsets: ['shell', 'read'],
        modelPolicy: { provider: 'openai', model: 'gpt-4' },
      });
      expect(job.enabled).toBe(false);
      expect(job.deliveryTarget).toBe('discord');
      expect(job.toolsets).toEqual(['shell', 'read']);
      expect(job.modelPolicy.provider).toBe('openai');
    });
  });

  describe('getById', () => {
    it('should return a job by id', () => {
      const store = new SchedulerStore(db);
      const created = store.create({
        profileId: 'p',
        name: 'n',
        schedule: '@every 1h',
        prompt: 'x',
      });
      const found = store.getById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('should return null for unknown id', () => {
      const store = new SchedulerStore(db);
      expect(store.getById('unknown')).toBeNull();
    });
  });

  describe('listByProfile', () => {
    it('should list jobs for a profile', () => {
      const store = new SchedulerStore(db);
      store.create({
        profileId: 'p',
        name: 'a',
        schedule: '@every 1h',
        prompt: 'x',
      });
      store.create({
        profileId: 'p',
        name: 'b',
        schedule: '@every 2h',
        prompt: 'y',
      });
      store.create({
        profileId: 'q',
        name: 'c',
        schedule: '@every 3h',
        prompt: 'z',
      });
      const jobs = store.listByProfile('p');
      expect(jobs).toHaveLength(2);
    });
  });

  describe('listEnabled', () => {
    it('should list only enabled jobs', () => {
      const store = new SchedulerStore(db);
      store.create({
        profileId: 'p',
        name: 'a',
        schedule: '@every 1h',
        prompt: 'x',
        enabled: true,
      });
      store.create({
        profileId: 'p',
        name: 'b',
        schedule: '@every 2h',
        prompt: 'y',
        enabled: false,
      });
      const enabled = store.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('a');
    });
  });

  describe('update', () => {
    it('should update a job', () => {
      const store = new SchedulerStore(db);
      const created = store.create({
        profileId: 'p',
        name: 'old',
        schedule: '@every 1h',
        prompt: 'x',
      });
      const updated = store.update(created.id, { name: 'new' });
      expect(updated?.name).toBe('new');
    });

    it('should return null for unknown id', () => {
      const store = new SchedulerStore(db);
      expect(store.update('unknown', { name: 'x' })).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a job', () => {
      const store = new SchedulerStore(db);
      const created = store.create({
        profileId: 'p',
        name: 'n',
        schedule: '@every 1h',
        prompt: 'x',
      });
      const deleted = store.delete(created.id);
      expect(deleted).toBe(true);
      expect(store.getById(created.id)).toBeNull();
    });

    it('should return false for unknown id', () => {
      const store = new SchedulerStore(db);
      expect(store.delete('unknown')).toBe(false);
    });
  });
});
