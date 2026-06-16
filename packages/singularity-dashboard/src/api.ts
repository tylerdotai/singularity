/**
 * Dashboard API — typed read-only access to Singularity data
 * Per ARCHITECTURE.md L342-356 and SPEC.md L263-269
 */

// ---------------------------------------------------------------------------
// Stub types (match singularity-core shapes)
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  profileId: string;
  title: string;
  status: 'active' | 'completed' | 'failed';
  startedAt: string;
  endedAt: string | null;
  source: string;
}

export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  kind: 'attribute' | 'decision' | 'open';
  confidence: number;
  sourceQuote: string;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  profileId: string;
  name: string;
  description: string;
  status: 'active' | 'pending' | 'denied';
  version: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  sessionId: string;
  action: string;
  decision: 'allow' | 'deny' | 'ask';
  decidedAt: string;
  decidedBy: string;
}

export interface GatewayChannel {
  id: string;
  profileId: string;
  platform: 'telegram' | 'discord';
  externalId: string;
  name: string;
  createdAt: string;
}

export interface SchedulerJob {
  id: string;
  profileId: string;
  name: string;
  schedule: string;
  enabled: boolean;
  deliveryTarget: 'cli' | 'telegram' | 'discord' | 'dashboard';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Real store access via ProfileResolver + singularity-core stores
// ---------------------------------------------------------------------------

import type { FactStore, SessionStore, SkillRegistry } from 'singularity-core';

// Injectable stores for testing and production use
let _sessionStore: SessionStore | null = null;
let _factStore: FactStore | null = null;
let _skillRegistry: SkillRegistry | null = null;

export function setStores(stores: {
  sessionStore?: SessionStore;
  factStore?: FactStore;
  skillRegistry?: SkillRegistry;
}): void {
  _sessionStore = stores.sessionStore ?? null;
  _factStore = stores.factStore ?? null;
  _skillRegistry = stores.skillRegistry ?? null;
}

export function resetStores(): void {
  _sessionStore = null;
  _factStore = null;
  _skillRegistry = null;
}

function getStores(_profileId: string): {
  sessionStore: SessionStore;
  factStore: FactStore;
  skillRegistry: SkillRegistry;
} {
  // Use injected stores if any were provided (allow partial injection - API functions only access what they need)
  if (
    _sessionStore !== null ||
    _factStore !== null ||
    _skillRegistry !== null
  ) {
    return {
      sessionStore: _sessionStore as SessionStore,
      factStore: _factStore as FactStore,
      skillRegistry: _skillRegistry as SkillRegistry,
    };
  }
  throw new Error(
    'Dashboard API stores not initialized. Call setStores() with real stores before using API functions.'
  );
}

// Adapter: convert any session-like object to Session interface
function toSession(s: unknown): Session {
  const r = s as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    profileId: String(r.profile_id ?? r.profileId ?? 'default'),
    title: String(r.label ?? 'Untitled session'),
    status:
      r.status === 'active'
        ? 'active'
        : r.status === 'closed'
          ? 'completed'
          : 'failed',
    startedAt: String(r.started_at ?? ''),
    endedAt: r.ended_at ? String(r.ended_at) : null,
    source: String(r.runtime ?? 'cli'),
  };
}

// Adapter: convert any fact-like object to Fact interface
function toFact(f: unknown): Fact {
  const r = f as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    subject: String(r.subject ?? ''),
    predicate: String(r.predicate ?? ''),
    value: String(r.value ?? ''),
    kind: (r.kind as 'attribute' | 'decision' | 'open') ?? 'open',
    confidence: Number(r.confidence ?? 0),
    sourceQuote: String(r.source_quote ?? ''),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  };
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export function listSessions(_profileId: string): Session[] {
  const { sessionStore } = getStores(_profileId);
  const sessions = sessionStore.searchDigests({});
  return sessions.map((s) => toSession(s));
}

export function getSession(sessionId: string): Session | null {
  const { sessionStore } = getStores('default');
  const session = sessionStore.getById(sessionId);
  return session ? toSession(session) : null;
}

export function searchSessions(_profileId: string, query: string): Session[] {
  const { sessionStore } = getStores(_profileId);
  const sessions = sessionStore.searchDigests({ query });
  return sessions.map((s) => toSession(s));
}

export function listFacts(_profileId: string): Fact[] {
  const { factStore } = getStores(_profileId);
  const facts = factStore.recall();
  return facts.map((f) => toFact(f));
}

export function getFact(factId: string): Fact | null {
  const { factStore } = getStores('default');
  const fact = factStore.getById(factId);
  return fact ? toFact(fact) : null;
}

export function listSkills(_profileId: string): Skill[] {
  const { skillRegistry } = getStores(_profileId);
  if (!skillRegistry) {
    return [];
  }
  const skills = skillRegistry.list({});
  return skills.map((s) => ({
    id: s.name,
    profileId: s.profileId ?? 'default',
    name: s.name,
    description: s.description,
    status: s.status,
    version: s.version,
    createdAt: '',
  }));
}

export function listApprovals(_profileId: string): Approval[] {
  // TODO: Wire to real approval audit log via GrantVault
  return [];
}

export function listGatewayChannels(_profileId: string): GatewayChannel[] {
  // TODO: Wire to real gateway store
  return [];
}

export function listSchedulerJobs(_profileId: string): SchedulerJob[] {
  // TODO: Wire to real scheduler store
  return [];
}
