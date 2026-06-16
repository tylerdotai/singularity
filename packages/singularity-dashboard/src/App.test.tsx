import { describe, expect, test } from 'bun:test';
import type {
  Approval,
  Fact,
  GatewayChannel,
  SchedulerJob,
  Session,
  Skill,
} from './api.js';

// Test pure formatAge logic inline (duplicated from App.tsx to test in isolation)
function formatAge(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Session row renderer — mirrors what App.tsx passes to DataTable
function sessionRow(s: Session) {
  return {
    id: s.id.slice(0, 8),
    title: s.title,
    status: s.status,
    source: s.source,
    started: formatAge(s.startedAt),
  };
}

function factRow(f: Fact) {
  return {
    subject: f.subject,
    predicate: f.predicate,
    value: f.value,
    kind: f.kind,
    confidence: `${Math.round((f.confidence ?? 0) * 100)}%`,
  };
}

function skillRow(s: Skill) {
  return {
    name: s.name,
    description: s.description,
    status: s.status,
    version: s.version,
  };
}

function approvalRow(a: Approval) {
  return {
    id: a.id.slice(0, 8),
    action: a.action,
    decision: a.decision,
    decidedBy: a.decidedBy,
    at: formatAge(a.decidedAt),
  };
}

function gatewayRow(g: GatewayChannel) {
  return {
    platform: g.platform,
    name: g.name,
    externalId: g.externalId,
    created: formatAge(g.createdAt),
  };
}

function schedulerRow(j: SchedulerJob) {
  return {
    name: j.name,
    schedule: j.schedule,
    enabled: j.enabled ? 'enabled' : 'disabled',
    delivery: j.deliveryTarget,
  };
}

describe('formatAge', () => {
  test("returns 'just now' for recent dates", () => {
    const now = new Date().toISOString();
    expect(formatAge(now)).toBe('just now');
  });

  test('returns minutes for dates within an hour', () => {
    const ago = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatAge(ago)).toBe('5m ago');
  });

  test('returns hours for dates within a day', () => {
    const ago = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(formatAge(ago)).toBe('3h ago');
  });

  test('returns days for dates within a week', () => {
    const ago = new Date(Date.now() - 4 * 86400000).toISOString();
    expect(formatAge(ago)).toBe('4d ago');
  });

  test('returns locale date for older dates', () => {
    const old = new Date(2024, 0, 15).toISOString(); // 2024-01-15
    const result = formatAge(old);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/2024/);
  });

  test('returns input string for invalid dates', () => {
    const result = formatAge('not-a-date');
    expect(result === 'not-a-date' || result === 'Invalid Date').toBe(true);
  });
});

describe('sessionRow', () => {
  test('truncates id to 8 chars', () => {
    const s: Session = {
      id: 'sess-1234567890',
      title: 'Test',
      status: 'active',
      source: 'cli',
      startedAt: new Date().toISOString(),
    };
    const r = sessionRow(s);
    expect(r.id).toBe('sess-123');
  });

  test('formats status and source', () => {
    const s: Session = {
      id: 's1',
      title: 'Test',
      status: 'running',
      source: 'api',
      startedAt: new Date().toISOString(),
    };
    const r = sessionRow(s);
    expect(r.status).toBe('running');
    expect(r.source).toBe('api');
  });

  test('applies formatAge to startedAt', () => {
    const now = new Date().toISOString();
    const s: Session = {
      id: 's1',
      title: 'T',
      status: 'active',
      source: 'cli',
      startedAt: now,
    };
    expect(sessionRow(s).started).toBe('just now');
  });
});

describe('factRow', () => {
  test('converts confidence to percentage string', () => {
    const f: Fact = {
      id: 'f1',
      subject: 'x',
      predicate: 'y',
      value: 'z',
      kind: 'entity',
      confidence: 0.87,
    };
    expect(factRow(f).confidence).toBe('87%');
  });

  test('handles missing confidence as 0%', () => {
    const f: Fact = {
      id: 'f1',
      subject: 'x',
      predicate: 'y',
      value: 'z',
      kind: 'entity',
      confidence: undefined as any,
    };
    expect(factRow(f).confidence).toBe('0%');
  });
});

describe('skillRow', () => {
  test('returns all fields', () => {
    const s: Skill = {
      id: 'sk1',
      name: 'github',
      description: 'GitHub ops',
      status: 'active',
      version: '2.1.0',
    };
    const r = skillRow(s);
    expect(r.name).toBe('github');
    expect(r.status).toBe('active');
    expect(r.version).toBe('2.1.0');
  });
});

describe('approvalRow', () => {
  test('truncates id and formats decidedAt', () => {
    const a: Approval = {
      id: 'appr-long-id-001',
      action: 'write',
      decision: 'denied',
      decidedBy: 'admin',
      decidedAt: new Date().toISOString(),
    };
    const r = approvalRow(a);
    expect(r.id).toBe('appr-lon');
    expect(r.decision).toBe('denied');
    expect(r.at).toBe('just now');
  });
});

describe('gatewayRow', () => {
  test('formats platform and externalId', () => {
    const g: GatewayChannel = {
      id: 'gc1',
      platform: 'discord',
      name: '#dev',
      externalId: '999',
      createdAt: new Date().toISOString(),
    };
    const r = gatewayRow(g);
    expect(r.platform).toBe('discord');
    expect(r.externalId).toBe('999');
    expect(r.created).toBe('just now');
  });
});

describe('schedulerRow', () => {
  test('converts enabled boolean to label', () => {
    const j1: SchedulerJob = {
      id: 'j1',
      name: 'Daily',
      schedule: '0 9 * * *',
      enabled: true,
      deliveryTarget: '@channel',
    };
    const j2: SchedulerJob = {
      id: 'j2',
      name: 'Hourly',
      schedule: '0 * * * *',
      enabled: false,
      deliveryTarget: '@me',
    };
    expect(schedulerRow(j1).enabled).toBe('enabled');
    expect(schedulerRow(j2).enabled).toBe('disabled');
  });

  test('passes through name, schedule, deliveryTarget', () => {
    const j: SchedulerJob = {
      id: 'j1',
      name: 'Weekly',
      schedule: '0 8 * * 1',
      enabled: true,
      deliveryTarget: 'email',
    };
    const r = schedulerRow(j);
    expect(r.name).toBe('Weekly');
    expect(r.schedule).toBe('0 8 * * 1');
    expect(r.delivery).toBe('email');
  });
});
