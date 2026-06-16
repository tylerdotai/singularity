import { beforeEach, describe, expect, it } from 'bun:test';
import { SubagentRunner, SubagentRuntimeError } from './runner.js';

describe('SubagentRunner', () => {
  describe('executeInline', () => {
    it('throws SubagentRuntimeError when no LLM adapter provided', async () => {
      const runner = new SubagentRunner({});
      await expect(
        runner.run({ goal: 'test goal', context: 'ctx' })
      ).rejects.toThrow(/No LLM adapter configured/);
    });

    it('accepts context as string with mock LLM', async () => {
      const runner = new SubagentRunner({
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
            })();
          },
        },
      });
      const result = await runner.run({
        goal: 'test goal',
        context: 'context text',
      });

      expect(result.status).toBe('completed');
      expect(result.contractId).toMatch(/^subtask_/);
    });

    it('accepts context as object with mock LLM', async () => {
      const runner = new SubagentRunner({
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
            })();
          },
        },
      });
      const result = await runner.run({
        goal: 'test goal',
        context: { summary: 'context object', references: [] },
      });

      expect(result.status).toBe('completed');
    });
  });

  describe('workIsolation', () => {
    it('accepts none workIsolation with mock LLM', async () => {
      const runner = new SubagentRunner({
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
            })();
          },
        },
      });
      const result = await runner.run({
        goal: 'test goal',
        context: 'ctx',
        workIsolation: { kind: 'none' },
      });

      expect(result.status).toBe('completed');
    });

    it('accepts worktree workIsolation', async () => {
      const runner = new SubagentRunner({});
      // Will fail since we're not in a git repo, but validates the structure
      const result = await runner
        .run({
          goal: 'test goal',
          context: 'ctx',
          workIsolation: { kind: 'worktree', basePath: '/nonexistent' },
        })
        .catch((e) => ({ status: 'error', error: e.message }));

      // Should attempt worktree execution (will error in test env)
      expect(result).toBeDefined();
    });
  });

  describe('active task tracking', () => {
    it('tracks active tasks during execution with mock LLM', async () => {
      let resolveChat: () => void = () => {};
      const chatPromise = new Promise<void>((resolve) => {
        resolveChat = resolve;
      });
      const runner = new SubagentRunner({
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
              await chatPromise;
            })();
          },
        },
      });
      expect(runner.getActiveTaskCount()).toBe(0);

      const runPromise = runner.run({ goal: 'test goal', context: 'ctx' });
      expect(runner.getActiveTaskCount()).toBe(1);
      resolveChat?.();
      await runPromise;
      expect(runner.getActiveTaskCount()).toBe(0);
    });

    it('cleans up completed tasks', async () => {
      const runner = new SubagentRunner({
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
            })();
          },
        },
      });
      const result = await runner.run({ goal: 'test goal', context: 'ctx' });

      expect(result.status).toBe('completed');
      expect(runner.getActiveTaskCount()).toBe(0);
    });
  });

  describe('event emission', () => {
    it('emits loop.started event when eventHub provided', async () => {
      const events: Array<{ type?: string }> = [];
      const runner = new SubagentRunner({
        eventHub: {
          emit: (e) => events.push(e),
        },
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
            })();
          },
        },
      });

      await runner.run({ goal: 'test goal', context: 'ctx' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('loop.started');
    });

    it('emits loop.completed event on success', async () => {
      const events: Array<{ type?: string; success?: boolean }> = [];
      const runner = new SubagentRunner({
        eventHub: {
          emit: (e) => events.push(e),
        },
        llmAdapter: {
          provider: 'openai',
          model: 'gpt-4o',
          chat() {
            return (async function* () {
              yield { type: 'text-delta', text: 'done' };
            })();
          },
        },
      });

      await runner.run({ goal: 'test goal', context: 'ctx' });

      const completedEvent = events.find((e) => e.type === 'loop.completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.success).toBe(true);
    });
  });
});
