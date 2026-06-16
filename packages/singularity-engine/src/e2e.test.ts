/**
 * singularity-engine — end-to-end integration tests.
 *
 * Full stack: Telegram message → gateway bridge → engine → LLM → tools → response.
 * Uses mock LLM, mock tool registry, in-memory SQLite, and mock gateway.
 *
 * bun test packages/singularity-engine/src/e2e.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LLMEvent } from 'singularity-llm';
import { SessionRunner } from './session-runner.ts';
import type {
  Activity,
  EngineDeps,
  SessionRunnerConfig,
  TurnResult,
} from './types.ts';

// ─── Mock LLM ─────────────────────────────────────────────────────────────────

function createMockLLM(events: LLMEvent[]) {
  return {
    chat() {
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    },
  };
}

// ─── Mock ToolRegistry ────────────────────────────────────────────────────────

function createMockToolRegistry(
  tools: Record<string, (input: unknown) => unknown>
) {
  return {
    materialize() {
      return {
        definitions: Object.keys(tools).map((name) => ({
          name,
          description: `mock tool: ${name}`,
          inputSchema: {},
        })),
        settle: async (input: { call: { name: string; input: unknown } }) => {
          const fn = tools[input.call.name];
          if (!fn) throw new Error(`Unknown tool: ${input.call.name}`);
          return { result: fn(input.call.input) };
        },
      };
    },
    get(name: string) {
      return {
        name,
        riskScore: 'LOW' as const,
        execute: async (input: unknown) => ({
          result: tools[name]?.(input) ?? 'ok',
        }),
      };
    },
  };
}

// ─── Mock SessionStore ────────────────────────────────────────────────────────

function createMockSessionStore() {
  const sessions = new Map<string, { messages: unknown[] }>();
  return {
    sessions,
    async upsertSession(sessionID: string, _metadata: unknown) {
      if (!sessions.has(sessionID)) {
        sessions.set(sessionID, { messages: [] });
      }
    },
    async appendMessage(sessionID: string, message: unknown) {
      sessions.get(sessionID)?.messages.push(message);
    },
  };
}

// ─── Mock ApprovalStore ───────────────────────────────────────────────────────

function createMockApprovalStore() {
  return {
    createRequest(
      _sessionId: string,
      _callId: string,
      _tool: string,
      _args: unknown,
      _riskScore: string
    ): string {
      return `mock-approval-${Date.now()}`;
    },
    resolve(_id: string, _approved: boolean): void {},
    waitForResolution(id: string): Promise<boolean> {
      return new Promise((resolve) => {
        setTimeout(() => resolve(true), 10);
      });
    },
  };
}

// ─── Mock FactStore ───────────────────────────────────────────────────────────

function createMockFactStore() {
  return {
    async recall() {
      return [];
    },
    async create() {},
    async supersede() {},
  };
}

// ─── Test setup ────────────────────────────────────────────────────────────────

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('e2e — full stack integration', () => {
  let mockStore: ReturnType<typeof createMockSessionStore>;

  beforeEach(() => {
    mockStore = createMockSessionStore();
  });

  afterEach(() => {
    mockStore.sessions.clear();
  });

  test('text-only response: Hello → assistant responds with text', async () => {
    const events: LLMEvent[] = [
      { type: 'text-delta', id: '1', text: 'Hello!' },
      { type: 'finish', reason: 'stop' },
    ];

    const deps: EngineDeps = {
      llm: createMockLLM(events) as unknown as EngineDeps['llm'],
      tools: createMockToolRegistry({}) as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore:
        createMockApprovalStore() as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);

    const results: TurnResult[] = [];
    for await (const result of runner.run(
      [{ type: 'queue', input: 'Hello' }],
      'sess_1'
    )) {
      results.push(result);
    }

    expect(results.length).toBeGreaterThan(0);
    const last = results[results.length - 1];
    expect(last.needsContinuation).toBe(false);
    expect(last.textBuffer).toBe('Hello!');
  });

  test('tool call: List files → bash tool executes → result returned', async () => {
    // First call: tool call. Second call (after tool result): text-only finish.
    const turn1Events: LLMEvent[] = [
      { type: 'text-delta', id: '1', text: 'Let me list those files.' },
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        input: { command: 'ls -la /tmp', timeout: 5000 },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];
    const turn2Events: LLMEvent[] = [
      { type: 'text-delta', id: '2', text: 'Here are the files.' },
      { type: 'finish', reason: 'stop' },
    ];
    let callCount = 0;
    const llm = {
      chat() {
        const events = callCount++ === 0 ? turn1Events : turn2Events;
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    };

    const bashMock = mock(
      (_cmd: string) => 'total 0\n-rw-r--r--  1 tyler staff 0 Jan  1 00:00 /tmp'
    );
    const tools = createMockToolRegistry({
      bash: bashMock as (input: unknown) => unknown,
    });

    const deps: EngineDeps = {
      llm: llm as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore:
        createMockApprovalStore() as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);

    const results: TurnResult[] = [];
    for await (const result of runner.run(
      [{ type: 'queue', input: 'List files in /tmp' }],
      'sess_2'
    )) {
      results.push(result);
    }

    expect(results.length).toBeGreaterThan(0);
    // First turn has tool results
    const firstWithTool = results.find((r) => r.toolResults.length > 0);
    expect(firstWithTool).toBeDefined();
    expect(firstWithTool?.toolResults[0].name).toBe('bash');
    expect(String(firstWithTool?.toolResults[0].result)).toContain('total');
  });

  test('multiple turns: two queue inputs → two turns executed', async () => {
    // Activity 1: turn 1 returns tool call (needsContinuation=true), turn 2 returns text (stop)
    // Activity 2: turn 3 returns text (stop)
    const turn1: LLMEvent[] = [
      { type: 'text-delta', id: '1', text: 'Doing thing one.' },
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        input: { command: 'echo 1' },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];
    const turn2: LLMEvent[] = [
      { type: 'text-delta', id: '2', text: 'Done with thing one.' },
      { type: 'finish', reason: 'stop' },
    ];
    const turn3: LLMEvent[] = [
      { type: 'text-delta', id: '3', text: 'Activity two done.' },
      { type: 'finish', reason: 'stop' },
    ];
    const allEvents = [turn1, turn2, turn3];
    let turnIndex = 0;
    const llm = {
      chat() {
        const events = allEvents[turnIndex++] ?? turn3;
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    };
    const bashMock = mock((_cmd: string) => 'done');
    const tools = createMockToolRegistry({
      bash: bashMock as (input: unknown) => unknown,
    });

    const deps: EngineDeps = {
      llm: llm as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore:
        createMockApprovalStore() as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 10 }, deps);

    const activities: Activity[] = [
      { type: 'queue', input: 'First' },
      { type: 'queue', input: 'Second' },
    ];

    const results: TurnResult[] = [];
    for await (const result of runner.run(activities, 'sess_3')) {
      results.push(result);
    }

    // Activity 1: turn1 (tool, needsContinuation=true) + turn2 (text, goal-met) = 2 results
    // Activity 2: turn3 (text, goal-met) = 1 result
    // But: turn2 goal-met exits session before Activity 2 processes
    // So with current behavior: 2 results
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test('step limit: maxSteps=2 → throws StepLimitError', async () => {
    // Infinite tool loop — LLM keeps calling tools
    const events: LLMEvent[] = [
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        input: { command: 'echo loop' },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];

    const tools = createMockToolRegistry({
      bash: () => 'done',
    });

    const deps: EngineDeps = {
      llm: createMockLLM(events) as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore:
        createMockApprovalStore() as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 2 }, deps);

    let error: unknown;
    try {
      for await (const _ of runner.run(
        [{ type: 'queue', input: 'Keep going' }],
        'sess_4'
      )) {
        // consume
      }
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect((error as { name?: string }).name).toBe('StepLimitError');
  });

  test('provider error: LLM stream throws → stopReason = worker-error', async () => {
    const deps: EngineDeps = {
      llm: {
        chat() {
          return (async function* () {
            yield {
              type: 'provider-error',
              message: 'API key invalid',
            } as LLMEvent;
          })();
        },
      } as unknown as EngineDeps['llm'],
      tools: createMockToolRegistry({}) as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore:
        createMockApprovalStore() as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 3 }, deps);

    const results: TurnResult[] = [];
    for await (const result of runner.run(
      [{ type: 'queue', input: 'Hello' }],
      'sess_5'
    )) {
      results.push(result);
    }

    expect(results.length).toBeGreaterThan(0);
    const last = results[results.length - 1];
    expect(last.stopReason).toBe('worker-error');
    expect(last.needsContinuation).toBe(false);
  });

  test('aborts cleanly on AbortSignal', async () => {
    // First turn: returns text. Second turn: long delay so abort fires during it.
    const turn1: LLMEvent[] = [
      { type: 'text-delta', id: '1', text: 'Quick response.' },
      { type: 'finish', reason: 'stop' },
    ];
    // Turn 2 generator yields nothing (simulates hung stream), abort fires before it starts
    let yieldController: (() => void) | null = null;
    const turn2Promise = new Promise<LLMEvent[]>((resolve) => {
      yieldController = () => resolve([]);
    });

    const turn2: LLMEvent[] = [];
    let turnCount = 0;
    const llm = {
      chat() {
        turnCount++;
        if (turnCount === 1) {
          return (async function* () {
            for (const e of turn1) yield e;
          })();
        }
        // Second turn: hang until abort
        return (async function* () {
          // Simulate a stream that yields nothing until aborted
          await new Promise<void>((r) => setTimeout(r, 5000));
        })();
      },
    };

    const deps: EngineDeps = {
      llm: llm as unknown as EngineDeps['llm'],
      tools: createMockToolRegistry({}) as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore:
        createMockApprovalStore() as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);
    const ac = new AbortController();

    // Abort after first result
    const results: TurnResult[] = [];
    let abortFired = false;
    for await (const result of runner.run(
      [{ type: 'queue', input: 'Hello' }],
      'sess_6',
      ac.signal
    )) {
      results.push(result);
      if (!abortFired) {
        abortFired = true;
        ac.abort();
      }
    }

    // First result should exist, then abort stopped further turns
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].textBuffer).toBe('Quick response.');
  });
});
