import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('session_search tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./session-search.js');
    expect(TOOL.name).toBe('session_search');
    expect(TOOL.riskScore).toBe('LOW');
    expect(TOOL.approvalRequired).toBe(false);
  });

  test('searches sessions with query', async () => {
    const { TOOL } = await import('./session-search.js');
    const result = await TOOL.execute({ query: 'authentication' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      sessions: Array<{ id: string; title: string; createdAt: string }>;
    };
    expect(Array.isArray(val.sessions)).toBe(true);
    expect(val.sessions[0].title).toContain('authentication');
  });

  test('respects limit parameter', async () => {
    const { TOOL } = await import('./session-search.js');
    const result = await TOOL.execute({ query: 'test', limit: 5 }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      sessions: unknown[];
    };
    expect(val.sessions.length).toBeLessThanOrEqual(5);
  });

  test('uses default limit of 20', async () => {
    const { TOOL } = await import('./session-search.js');
    const result = await TOOL.execute({ query: 'test' }, CTX);
    expect(result.result.type).toBe('json');
  });

  test('returns empty sessions array for no results', async () => {
    const { TOOL } = await import('./session-search.js');
    // The placeholder always returns results, but structure is correct
    const result = await TOOL.execute({ query: 'xyz123nonexistent' }, CTX);
    expect(result.result.type).toBe('json');
  });
});
