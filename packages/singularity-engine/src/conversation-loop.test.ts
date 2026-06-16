/**
 * singularity-engine — ConversationLoop tests.
 */

import type { LLMEvent } from 'singularity-llm';
import { describe, expect, it, vi } from 'vitest';
import type { LLMAdapter, Turn } from './conversation-loop.js';
import { DefaultConversationLoop } from './conversation-loop.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const TEXT_DELTA_ID = 'txt_1';
const CALL_ID = 'call_1';

/**
 * Build a mock LLM adapter that yields a predefined sequence of events.
 */
function mockLLM(events: LLMEvent[]): LLMAdapter {
  return {
    chat: vi.fn(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
  };
}

// ─── Turn Interface Tests ────────────────────────────────────────────────────

describe('Turn interface', () => {
  it('should accept a text-delta turn', () => {
    const turn = { type: 'text-delta' as const, textDelta: 'Hello' };
    expect(turn.type).toBe('text-delta');
    expect(turn.textDelta).toBe('Hello');
  });

  it('should accept a tool-call turn', () => {
    const turn = {
      type: 'tool-call' as const,
      toolCall: { name: 'Read', args: { path: 'a.txt' }, callId: 'c1' },
    };
    expect(turn.type).toBe('tool-call');
    expect(turn.toolCall?.name).toBe('Read');
  });

  it('should accept a tool-result turn', () => {
    const turn = {
      type: 'tool-result' as const,
      toolResult: { callId: 'c1', output: 'file contents' },
    };
    expect(turn.type).toBe('tool-result');
    expect(turn.toolResult?.output).toBe('file contents');
  });

  it('should accept an approval-required turn', () => {
    const turn = {
      type: 'approval-required' as const,
      approvalRequired: {
        callId: 'c1',
        tool: 'Bash',
        args: { cmd: 'rm -rf /' },
        riskScore: 'CRITICAL',
      },
    };
    expect(turn.type).toBe('approval-required');
    expect(turn.approvalRequired?.riskScore).toBe('CRITICAL');
  });

  it('should accept a finish turn', () => {
    const turn = {
      type: 'finish' as const,
      finishReason: 'stop' as const,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    expect(turn.type).toBe('finish');
    expect(turn.finishReason).toBe('stop');
    expect(turn.usage?.inputTokens).toBe(100);
  });
});

// ─── DefaultConversationLoop.run() Tests ────────────────────────────────────

describe('DefaultConversationLoop', () => {
  describe('run() — generator behavior', () => {
    it('should yield text-delta events from the LLM stream', async () => {
      const events: LLMEvent[] = [
        { type: 'text-delta', id: TEXT_DELTA_ID, text: 'Hello ' },
        { type: 'text-delta', id: TEXT_DELTA_ID, text: 'world' },
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', 'hi')) {
        turns.push(turn);
      }

      expect(turns.filter((t) => t.type === 'text-delta')).toHaveLength(2);
    });

    it("should yield a final 'finish' turn when stream ends", async () => {
      const events: LLMEvent[] = [
        { type: 'text-delta', id: TEXT_DELTA_ID, text: 'Done' },
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 5, outputTokens: 3 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', 'hello')) {
        turns.push(turn);
      }

      const finishTurn = turns.find((t) => t.type === 'finish');
      expect(finishTurn).toBeDefined();
      expect(finishTurn?.finishReason).toBe('stop');
    });

    it('should pass userMessage as content to the LLM adapter', async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      for await (const _ of loop.run('sess_1', 'Say hello')) {
        // consume
      }

      expect(llm.chat).toHaveBeenCalledWith('gpt-4o', [
        { role: 'user', content: 'Say hello' },
      ]);
    });

    it('should prepend context block when references are found', async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      for await (const _ of loop.run('sess_1', 'Read @file:src/a.ts')) {
        // consume
      }

      const calledWith = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = calledWith[1][0].content as string;
      expect(content).toContain('[context]');
      expect(content).toContain('@file:src/a.ts');
    });

    it('should NOT prepend context block when no references found', async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      for await (const _ of loop.run('sess_1', 'Hello world')) {
        // consume
      }

      const calledWith = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = calledWith[1][0].content as string;
      expect(content).not.toContain('[context]');
      expect(content).toBe('Hello world');
    });

    it('should yield tool-call turns from the LLM stream', async () => {
      const events: LLMEvent[] = [
        {
          type: 'tool-call',
          id: CALL_ID,
          name: 'Read',
          input: { path: 'a.txt' },
        },
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 5, outputTokens: 10 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', 'read a file')) {
        turns.push(turn);
      }

      const toolCallTurn = turns.find((t) => t.type === 'tool-call');
      expect(toolCallTurn).toBeDefined();
      expect(toolCallTurn?.toolCall?.name).toBe('Read');
      expect(toolCallTurn?.toolCall?.callId).toBe(CALL_ID);
    });

    it('should yield tool-result turns from the LLM stream', async () => {
      const events: LLMEvent[] = [
        {
          type: 'tool-result',
          id: CALL_ID,
          name: 'Read',
          result: { type: 'text', value: 'file contents here' },
        },
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 5, outputTokens: 5 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', 'read a file')) {
        turns.push(turn);
      }

      const toolResultTurn = turns.find((t) => t.type === 'tool-result');
      expect(toolResultTurn).toBeDefined();
      expect(toolResultTurn?.toolResult?.output).toBe('file contents here');
    });

    it('should use the model passed to the constructor', async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm, 'claude-3-opus');

      for await (const _ of loop.run('sess_1', 'test')) {
        // consume
      }

      const calledWith = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(calledWith[0]).toBe('claude-3-opus');
    });

    it('should accept empty user message without crashing', async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', '')) {
        turns.push(turn);
      }

      expect(turns[turns.length - 1].type).toBe('finish');
    });

    it("should map finish reason 'stop' correctly", async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', 'hello')) {
        turns.push(turn);
      }

      const finishTurn = turns.find((t) => t.type === 'finish');
      expect(finishTurn?.finishReason).toBe('stop');
    });

    it("should map finish reason 'max_tokens' to max_turns", async () => {
      const events: LLMEvent[] = [
        {
          type: 'finish',
          reason: 'max_tokens',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      const llm = mockLLM(events);
      const loop = new DefaultConversationLoop(llm);

      const turns: Turn[] = [];
      for await (const turn of loop.run('sess_1', 'hello')) {
        turns.push(turn);
      }

      const finishTurn = turns.find((t) => t.type === 'finish');
      expect(finishTurn?.finishReason).toBe('max_turns');
    });
  });
});
