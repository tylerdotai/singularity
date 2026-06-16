import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { FactStore, SessionStore } from 'singularity-core';
import {
  getFact,
  getSession,
  listApprovals,
  listFacts,
  listGatewayChannels,
  listSchedulerJobs,
  listSessions,
  listSkills,
  resetStores,
  searchSessions,
  setStores,
} from './api.js';

describe('Dashboard API', () => {
  let db: Database;
  let sessionStore: SessionStore;
  let factStore: FactStore;
  let createdFactId: string;

  beforeEach(() => {
    // Reset and create fresh stores for each test
    resetStores();
    db = new Database(':memory:');
    sessionStore = new SessionStore(db);
    factStore = new FactStore(db);
    factStore.migrate();

    // Inject stores for this test
    setStores({ sessionStore, factStore, db });

    // Seed test sessions
    sessionStore.upsert({
      id: 'sess_1',
      runtime: 'cli',
      runtime_session_id: null,
      started_at: '2026-06-01T10:00:00Z',
      ended_at: '2026-06-01T10:30:00Z',
      duration_min: 30,
      label: 'Setup session',
      summary: 'Initial setup',
      body: null,
      status: 'closed',
      transcript_kind: null,
      transcript_path: null,
      transcript_offset: null,
      transcript_length: null,
    });
    sessionStore.upsert({
      id: 'sess_2',
      runtime: 'telegram',
      runtime_session_id: null,
      started_at: '2026-06-14T09:00:00Z',
      ended_at: null,
      duration_min: null,
      label: 'Code review',
      summary: 'Review changes',
      body: null,
      status: 'active',
      transcript_kind: null,
      transcript_path: null,
      transcript_offset: null,
      transcript_length: null,
    });

    // Seed test facts - capture the actual ID
    const created = factStore.create({
      profile_id: 'default',
      subject: 'Singularity',
      predicate: 'uses',
      value: 'TypeScript + Bun',
      kind: 'decision',
      confidence: 0.9,
      source_quote: 'Stack decision',
      source_session_id: 'sess_1',
    });
    createdFactId = created.id;
  });

  describe('listSessions', () => {
    it('should return sessions for a profile', () => {
      const sessions = listSessions('default');
      expect(sessions.length).toBeGreaterThan(0);
    });

    it('should return all sessions regardless of profileId', () => {
      // SessionStore doesn't filter by profileId in searchDigests
      const sessions = listSessions('nonexistent');
      expect(sessions.length).toBeGreaterThan(0);
    });
  });

  describe('getSession', () => {
    it('should return a session by id', () => {
      const session = getSession('sess_1');
      expect(session?.id).toBe('sess_1');
    });

    it('should return null for unknown id', () => {
      expect(getSession('unknown')).toBeNull();
    });
  });

  describe('searchSessions', () => {
    it('should filter by query', () => {
      const results = searchSessions('default', 'setup');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty for no match', () => {
      const results = searchSessions('default', 'xyzabc');
      expect(results).toHaveLength(0);
    });
  });

  describe('listFacts', () => {
    it('should return facts for a profile', () => {
      const facts = listFacts('default');
      expect(facts.length).toBeGreaterThan(0);
    });
  });

  describe('getFact', () => {
    it('should return a fact by id', () => {
      const fact = getFact(createdFactId);
      expect(fact?.id).toBe(createdFactId);
    });

    it('should return null for unknown id', () => {
      expect(getFact('unknown')).toBeNull();
    });
  });

  describe('listSkills', () => {
    it('should return skills for a profile', () => {
      const skills = listSkills('default');
      // Skills subsystem not yet wired - returns empty array
      expect(skills).toBeArray();
    });
  });

  describe('listApprovals', () => {
    it('should return approvals', () => {
      const approvals = listApprovals('default');
      // Approval audit log not yet wired - returns empty array
      expect(approvals).toBeArray();
    });
  });

  describe('listGatewayChannels', () => {
    it('should return gateway channels', () => {
      const channels = listGatewayChannels('default');
      // Gateway store not yet wired - returns empty array
      expect(channels).toBeArray();
    });
  });

  describe('listSchedulerJobs', () => {
    it('should return scheduler jobs', () => {
      const jobs = listSchedulerJobs('default');
      // Scheduler store not yet wired - returns empty array
      expect(jobs).toBeArray();
    });
  });
});
