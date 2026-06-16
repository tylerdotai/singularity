/**
 * singularity-engine — session runner.
 *
 * Outer loop: process Activity stream (steer/queue) until exhausted.
 * Inner loop: run up to maxSteps turns.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import { configStore } from 'singularity-config/store';
import type { ToolRiskScore } from 'singularity-tools';
import type { PromptCacheManager } from './cache.js';
import { StepLimitError } from './errors.js';
import { type ApproverTurnEvent, runTurn } from './turn-executor.js';
import type {
  Activity,
  EngineDeps,
  RunState,
  SessionRunnerConfig,
  TurnResult,
} from './types.js';

// ─── Activity queue ───────────────────────────────────────────────────────────

type ActivitySource = AsyncIterable<Activity> | Activity[];

function toAsyncIterable(source: ActivitySource): AsyncIterable<Activity> {
  if (Array.isArray(source)) {
    return (async function* () {
      yield* source;
    })();
  }
  return source;
}

// ─── SessionRunner ────────────────────────────────────────────────────────────

export class SessionRunner {
  private readonly cache: PromptCacheManager | undefined;

  constructor(
    private readonly config: SessionRunnerConfig,
    private readonly deps: EngineDeps
  ) {
    this.cache = deps.cache;
  }

  get approvalStore() {
    return this.deps.approvalStore;
  }

  async *run(
    input: ActivitySource,
    sessionID: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<TurnResult> {
    const maxSteps =
      this.config.maxSteps ??
      (configStore.get('engine.maxSteps') as number) ??
      25;

    const messages: Array<{ role: string; content: string }> = [];

    const activityQueue: Activity[] = [];
    const activities = toAsyncIterable(input)[Symbol.asyncIterator]();

    const state: RunState = {
      sessionID,
      step: 0,
      needsContinuation: true,
      stopReason: null,
    };

    while (true) {
      // Refill queue from iterator if empty
      if (activityQueue.length === 0) {
        const { value, done } = await activities.next();
        if (done) break;
        if (value) activityQueue.push(value);
      }

      const activity = activityQueue.shift();
      if (!activity) break;

      const activityContent =
        activity.type === 'steer'
          ? `[STEER] ${activity.input}`
          : `[QUEUE] ${activity.input}`;

      messages.push({ role: 'user', content: activityContent });

      for (state.step = 0; state.step < maxSteps; state.step++) {
        if (abortSignal?.aborted) {
          state.needsContinuation = false;
          state.stopReason = 'cancelled';
          break;
        }

        let turnResult: TurnResult | null = null;

        for await (const event of runTurn({
          sessionID,
          messages,
          model:
            this.config.model ??
            (configStore.get('engine.model') as string) ??
            'gpt-4o',
          llm: this.deps.llm as unknown as Parameters<typeof runTurn>[0]['llm'],
          tools: this.deps.tools as unknown as Parameters<
            typeof runTurn
          >[0]['tools'],
          approvalStore: this.deps.approvalStore as Parameters<
            typeof runTurn
          >[0]['approvalStore'],
          abortSignal,
          cache: this.cache,
        })) {
          if (event.type === 'approval-required') {
            yield {
              needsContinuation: true,
              stopReason: undefined,
              textBuffer: '',
              toolResults: [],
              approval: {
                approvalId: event.approvalId,
                callId: event.callId,
                tool: event.tool,
                args: event.args,
                riskScore: event.riskScore,
              },
            };
          } else if (event.type === 'turn-result') {
            turnResult = event.result;
          }
        }

        if (!turnResult) {
          state.needsContinuation = false;
          state.stopReason = 'worker-error';
          break;
        }

        state.needsContinuation = turnResult.needsContinuation;
        state.stopReason = turnResult.stopReason ?? null;

        if (turnResult.toolResults.length > 0) {
          const parts: Array<Record<string, unknown>> = [];
          if (turnResult.textBuffer) {
            parts.push({ type: 'text', text: turnResult.textBuffer });
          }
          for (const tr of turnResult.toolResults) {
            parts.push({
              type: 'tool-result',
              id: tr.id,
              name: tr.name,
              content:
                typeof tr.result === 'string'
                  ? tr.result
                  : JSON.stringify(tr.result),
            });
          }
          messages.push({ role: 'assistant', content: JSON.stringify(parts) });

          for (const tr of turnResult.toolResults) {
            messages.push({
              role: 'user',
              content: JSON.stringify({
                type: 'tool-result',
                id: tr.id,
                tool_call_id: tr.id,
                name: tr.name,
                content:
                  typeof tr.result === 'string'
                    ? tr.result
                    : JSON.stringify(tr.result),
              }),
            });
          }
        } else if (turnResult.textBuffer) {
          messages.push({ role: 'assistant', content: turnResult.textBuffer });
        }

        try {
          const store = this.deps.store as unknown as Record<string, unknown>;
          if (store.upsertSession) {
            await (
              store.upsertSession as (
                id: string,
                meta: unknown
              ) => Promise<void>
            )(sessionID, {
              updatedAt: Date.now(),
              messageCount: messages.length,
            });
          }
        } catch {
          // Non-fatal
        }

        yield turnResult;

        if (turnResult.stopReason && !turnResult.needsContinuation) {
          if (activityQueue.length > 0) {
            continue;
          }
          return;
        }

        if (!turnResult.needsContinuation && !turnResult.stopReason) {
          return;
        }
      }

      if (state.needsContinuation && state.stopReason === null) {
        throw new StepLimitError(sessionID, maxSteps);
      }
    }
  }
}

export async function* runSession(
  config: SessionRunnerConfig,
  deps: EngineDeps,
  activity: Activity,
  sessionID: string,
  abortSignal?: AbortSignal
): AsyncGenerator<TurnResult> {
  const runner = new SessionRunner(config, deps);
  yield* runner.run([activity], sessionID, abortSignal);
}
