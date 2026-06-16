/**
 * singularity-engine — approval suspension tests.
 *
 * Tests that the engine correctly suspends on CRITICAL tool approval-required
 * and resumes when the approval is resolved.
 *
 * bun test packages/singularity-engine/src/approval-suspend.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LLMEvent } from 'singularity-llm';
import { SessionRunner } from './session-runner.ts';
import type { EngineDeps, TurnResult } from './types.ts';

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

// ─── Mock ToolRegistry ───────────────────────────────────────────────────────

function createMockToolRegistry(
  tools: Record<string, (input: unknown) => unknown>,
  riskScores: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {}
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
        riskScore: riskScores[name] ?? 'LOW',
        approvalRequired: riskScores[name] === 'CRITICAL',
        execute: async (input: unknown) => ({
          result: tools[name]?.(input) ?? 'ok',
        }),
      };
    },
  };
}

// ─── Mock SessionStore ───────────────────────────────────────────────────────

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

// ─── Mock ApprovalStore with manual resolution ──────────────────────────────

function createControllableApprovalStore() {
  // Store pending approval values (set by resolve before waitForResolution is called)
  const pendingApprovals = new Map<string, boolean>();
  // Store resolver functions (set by waitForResolution)
  const pendingResolvers = new Map<string, (approved: boolean) => void>();

  return {
    createRequest(
      _sessionId: string,
      _callId: string,
      _tool: string,
      _args: unknown,
      _riskScore: string
    ): string {
      const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      pendingApprovals.set(id, undefined as unknown as boolean);
      return id;
    },
    resolve(id: string, approved: boolean): void {
      pendingApprovals.set(id, approved);
      const resolve = pendingResolvers.get(id);
      if (resolve) {
        pendingResolvers.delete(id);
        resolve(approved);
      }
    },
    waitForResolution(id: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        const pending = pendingApprovals.get(id);
        if (pending !== undefined) {
          pendingApprovals.delete(id);
          resolve(pending);
        } else {
          pendingResolvers.set(id, resolve);
        }
      });
    },
  };
}

// ─── Mock FactStore ──────────────────────────────────────────────────────────

function createMockFactStore() {
  return {
    async recall() {
      return [];
    },
    async create() {},
    async supersede() {},
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('approval suspension', () => {
  let mockStore: ReturnType<typeof createMockSessionStore>;

  beforeEach(() => {
    mockStore = createMockSessionStore();
  });

  afterEach(() => {
    mockStore.sessions.clear();
  });

  test('engine yields approval-required for CRITICAL tool', async () => {
    const events: LLMEvent[] = [
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        input: { command: 'rm -rf /' },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];

    const approvalStore = createControllableApprovalStore();
    const tools = createMockToolRegistry(
      { bash: () => 'done' },
      { bash: 'CRITICAL' }
    );

    const deps: EngineDeps = {
      llm: createMockLLM(events) as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore: approvalStore as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);

    const iterator = runner
      .run([{ type: 'queue', input: 'Delete everything' }], 'sess_approval_1')
      [Symbol.asyncIterator]();

    // Get first result - should be approval-required
    const { value: firstResult, done } = await iterator.next();
    expect(done).toBe(false);
    expect(firstResult.approval).toBeDefined();
    expect(firstResult.approval?.approvalId).toBeDefined();
    expect(firstResult.approval?.tool).toBe('bash');
    expect(firstResult.approval?.riskScore).toBe('CRITICAL');
    expect(firstResult.needsContinuation).toBe(true);
  });

  test('engine resumes and executes tool on approve', async () => {
    // First turn: tool call with CRITICAL risk
    const turn1Events: LLMEvent[] = [
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        input: { command: 'rm -rf /' },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];
    // Second turn: text finish (after approval resolves, turn completes, next turn is text)
    const turn2Events: LLMEvent[] = [
      { type: 'text-delta', id: '2', text: 'Files deleted successfully.' },
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

    const bashMock = mock((_cmd: unknown) => 'all files deleted');
    const approvalStore = createControllableApprovalStore();
    const tools = createMockToolRegistry(
      { bash: bashMock as (input: unknown) => unknown },
      { bash: 'CRITICAL' }
    );

    const deps: EngineDeps = {
      llm: llm as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore: approvalStore as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);

    // Use for-await instead of manual iterator.next() to stay within the same turn context.
    // With manual iterator.next(), each call starts a NEW turn with a NEW approvalId,
    // so resolving the old approvalId doesn't help. With for-await, we resolve within
    // the same turn iteration.
    let toolExecuted = false;
    for await (const result of runner.run(
      [{ type: 'queue', input: 'Delete everything' }],
      'sess_approval_2'
    )) {
      if (result.approval) {
        // First result: approval required - resolve it and continue the turn
        expect(result.approval.tool).toBe('bash');
        approvalStore.resolve(result.approval.approvalId, true);
      } else if (result.toolResults.length > 0) {
        // Second result: tool execution completed within same turn
        expect(result.toolResults[0].name).toBe('bash');
        toolExecuted = true;
      }
    }
    expect(toolExecuted).toBe(true);
  });

  test('engine returns DENIED result when approval is denied', async () => {
    // Single turn: tool call with CRITICAL risk, then denied
    const turn1Events: LLMEvent[] = [
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        input: { command: 'rm -rf /' },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];
    // Second turn: after denial, engine gets tool result with DENIED error, then text
    const turn2Events: LLMEvent[] = [
      { type: 'text-delta', id: '2', text: 'Tool was denied.' },
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

    const bashMock = mock((_cmd: unknown) => 'deleted');
    const approvalStore = createControllableApprovalStore();
    const tools = createMockToolRegistry(
      { bash: bashMock as (input: unknown) => unknown },
      { bash: 'CRITICAL' }
    );

    const deps: EngineDeps = {
      llm: llm as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore: approvalStore as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);

    let gotDenial = false;
    for await (const result of runner.run(
      [{ type: 'queue', input: 'Delete everything' }],
      'sess_approval_3'
    )) {
      if (result.approval) {
        // Deny the approval and continue the turn
        approvalStore.resolve(result.approval.approvalId, false);
      } else if (result.toolResults.length > 0) {
        // Tool result reflects the denial
        expect(result.toolResults[0].result).toEqual({
          error: 'DENIED',
          message: "Tool 'bash' denied by approval",
        });
        gotDenial = true;
      }
    }
    expect(gotDenial).toBe(true);
    // The tool should NOT have been called
    expect(bashMock).not.toHaveBeenCalled();
  });

  test('engine does NOT suspend for LOW risk tools', async () => {
    // Turn 1: tool call. Turn 2: text finish
    const turn1Events: LLMEvent[] = [
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'read',
        input: { path: '/tmp/test.txt' },
      },
      { type: 'finish', reason: 'tool_calls' },
    ];
    const turn2Events: LLMEvent[] = [
      { type: 'text-delta', id: '2', text: 'File contents here.' },
      { type: 'finish', reason: 'stop' },
    ];

    let turnCount = 0;
    const llm = {
      chat() {
        const events = turnCount++ === 0 ? turn1Events : turn2Events;
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    };

    const readMock = mock((_input: unknown) => ({ content: 'hello' }));
    const approvalStore = createControllableApprovalStore();
    const tools = createMockToolRegistry(
      { read: readMock as (input: unknown) => unknown },
      { read: 'LOW' }
    );

    const deps: EngineDeps = {
      llm: llm as unknown as EngineDeps['llm'],
      tools: tools as unknown as EngineDeps['tools'],
      store: mockStore as unknown as EngineDeps['store'],
      approvalStore: approvalStore as unknown as EngineDeps['approvalStore'],
      factStore: createMockFactStore() as unknown as EngineDeps['factStore'],
    };

    const runner = new SessionRunner({ maxSteps: 5 }, deps);

    const results: TurnResult[] = [];
    for await (const result of runner.run(
      [{ type: 'queue', input: 'Read a file' }],
      'sess_approval_4'
    )) {
      results.push(result);
    }

    // Should have two results: first with tool result, second with text
    expect(results.length).toBe(2);

    // First result: tool executed, no approval needed
    expect(results[0].approval).toBeUndefined();
    expect(results[0].toolResults.length).toBe(1);
    expect(results[0].toolResults[0].name).toBe('read');

    // Second result: text response
    expect(results[1].textBuffer).toBe('File contents here.');
  });
});
