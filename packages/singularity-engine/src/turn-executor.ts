/**
 * singularity-engine — turn executor.
 *
 * Runs one turn: LLM stream → accumulate text/tool-calls → settle tools → TurnResult.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { LLMEvent } from 'singularity-llm';
import type { Materialization, ToolRiskScore } from 'singularity-tools';
import type { PromptCacheManager } from './cache.js';
import { TurnTransitionError } from './errors.js';
import type { ToolCallResult, TurnResult } from './types.js';

// ─── Turn executor events ───────────────────────────────────────────────────

/**
 * Events yielded by `runTurn` while processing a single LLM turn.
 * Allows the caller (SessionRunner) to intercept approval-required
 * events and suspend execution until the user resolves them.
 */
export type ApproverTurnEvent =
  | {
      type: 'approval-required';
      approvalId: string;
      callId: string;
      tool: string;
      args: unknown;
      riskScore: ToolRiskScore;
    }
  | { type: 'turn-result'; result: TurnResult };

// ─── Turn executor ─────────────────────────────────────────────────────────

export interface RunTurnParams {
  sessionID: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  llm: {
    chat(
      model: string,
      messages: Array<{ role: string; content: string }>,
      tools?: ReadonlyArray<unknown>
    ): AsyncGenerator<LLMEvent>;
  };
  tools: {
    materialize(permissions?: ReadonlyArray<string>): Materialization;
    get(name: string):
      | {
          name: string;
          riskScore: ToolRiskScore;
          approvalRequired?: boolean;
          execute(input: unknown, context: unknown): Promise<unknown>;
        }
      | undefined;
  };
  approvalStore?: {
    createRequest(
      sessionId: string,
      callId: string,
      tool: string,
      args: unknown,
      riskScore: ToolRiskScore
    ): string;
    resolve(id: string, approved: boolean): void;
    waitForResolution(id: string): Promise<boolean>;
  };
  abortSignal?: AbortSignal;
  cache?: PromptCacheManager;
}

/**
 * Async generator that executes one complete agent turn.
 *
 * Steps:
 * 1. Stream LLM events — accumulate text, collect tool calls
 * 2. For each tool call: materialize tools, check approvals for HIGH-risk, then settle
 * 3. Yield approval-required events when user decision is needed
 * 4. Yield turn-result when the turn is complete
 */
export async function* runTurn(
  params: RunTurnParams
): AsyncGenerator<ApproverTurnEvent> {
  const {
    sessionID,
    messages,
    model,
    llm,
    tools,
    approvalStore,
    abortSignal,
    cache,
  } = params;

  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  let textBuffer = '';
  let finishReason: string | undefined;
  let usage: LLMEvent extends { type: 'finish'; usage: infer U }
    ? U
    : undefined;
  let providerErrorMessage: string | undefined;

  let materialized: Materialization | null = null;
  function getMaterialized(): Materialization {
    if (!materialized) materialized = tools.materialize();
    return materialized;
  }

  try {
    const stream = llm.chat(model, messages);

    for await (const event of stream) {
      if (abortSignal?.aborted) {
        throw new TurnTransitionError('Turn aborted');
      }

      switch (event.type) {
        case 'text-delta': {
          textBuffer += event.text;
          break;
        }

        case 'tool-call': {
          toolCalls.push({
            id: event.id,
            name: event.name,
            input: event.input,
          });
          break;
        }

        case 'finish':
        case 'step-finish': {
          finishReason = event.reason;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          usage = event.usage as any;
          break;
        }

        case 'provider-error': {
          providerErrorMessage = event.message;
          break;
        }

        default:
          break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof TurnTransitionError) throw err;
    throw new TurnTransitionError(`LLM stream error: ${msg}`);
  }

  if (providerErrorMessage) {
    yield {
      type: 'turn-result',
      result: {
        needsContinuation: false,
        stopReason: 'worker-error',
        textBuffer,
        toolResults: [],
        usage,
      },
    };
    return;
  }

  const mat = getMaterialized();
  const settled: Array<{
    id: string;
    name: string;
    input: unknown;
    result: unknown;
    wallClockMs: number;
  }> = [];

  for (const tc of toolCalls) {
    const start = Date.now();
    const def = tools.get(tc.name);
    const riskScore = def?.riskScore ?? 'LOW';
    const approvalRequired = def?.approvalRequired ?? false;

    if (approvalStore && riskScore === 'CRITICAL' && approvalRequired) {
      const approvalId = approvalStore.createRequest(
        sessionID,
        tc.id,
        tc.name,
        tc.input,
        riskScore
      );
      yield {
        type: 'approval-required',
        approvalId,
        callId: tc.id,
        tool: tc.name,
        args: tc.input,
        riskScore,
      };
      const approved = await approvalStore.waitForResolution(approvalId);
      if (!approved) {
        settled.push({
          id: tc.id,
          name: tc.name,
          input: tc.input,
          result: {
            error: 'DENIED',
            message: `Tool '${tc.name}' denied by approval`,
          },
          wallClockMs: Date.now() - start,
        });
        continue;
      }
    }

    // Check cache before executing tool
    const cachedResult = cache
      ? cache.getCachedToolResult(tc.name, cache.computeInputHash(tc.input))
      : undefined;

    if (cachedResult) {
      settled.push({
        id: tc.id,
        name: tc.name,
        input: tc.input,
        result: cachedResult.value,
        wallClockMs: 0,
      });
      continue;
    }

    try {
      const result = await mat.settle({
        sessionID,
        agent: 'engine',
        assistantMessageID: tc.id,
        call: { name: tc.name, input: tc.input },
      });
      settled.push({
        id: tc.id,
        name: tc.name,
        input: tc.input,
        result: result.result,
        wallClockMs: Date.now() - start,
      });
      // Store in cache for future use
      if (cache) {
        cache.setCachedToolResult(
          tc.name,
          cache.computeInputHash(tc.input),
          result.result
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      settled.push({
        id: tc.id,
        name: tc.name,
        input: tc.input,
        result: { error: 'EXECUTION_ERROR', message: msg },
        wallClockMs: Date.now() - start,
      });
    }
  }

  const toolResults: ReadonlyArray<ToolCallResult> = settled.map((s) => ({
    id: s.id,
    name: s.name,
    input: s.input,
    result: s.result,
    wallClockMs: s.wallClockMs,
  }));

  const needsContinuation =
    toolResults.length > 0 || finishReason === 'tool_calls';
  let stopReason: TurnResult['stopReason'] | undefined;
  if (!needsContinuation) {
    if (finishReason === 'stop' || finishReason === 'content_filter') {
      stopReason = 'goal-met';
    } else if (finishReason === 'max_tokens' || finishReason === 'length') {
      stopReason = 'context-overflow';
    }
  }

  yield {
    type: 'turn-result',
    result: {
      needsContinuation,
      stopReason,
      textBuffer,
      toolResults,
      usage,
    },
  };
}

/**
 * Build the messages array for the next turn, appending the assistant's
 * text and tool results so they can be sent as the next conversation batch.
 */
export function buildNextTurnMessages(
  currentMessages: Array<{ role: string; content: string }>,
  assistantText: string,
  toolResults: ReadonlyArray<ToolCallResult>
): Array<{ role: string; content: string }> {
  const updated = [...currentMessages];

  const parts: Array<Record<string, unknown>> = [];
  if (assistantText) parts.push({ type: 'text', text: assistantText });
  for (const tr of toolResults) {
    parts.push({
      type: 'tool-result',
      id: tr.id,
      name: tr.name,
      content:
        typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
    });
  }

  updated.push({ role: 'assistant', content: JSON.stringify(parts) });

  for (const tr of toolResults) {
    updated.push({
      role: 'user',
      content: JSON.stringify({
        type: 'tool-result',
        id: tr.id,
        tool_call_id: tr.id,
        name: tr.name,
        content:
          typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
      }),
    });
  }

  return updated;
}
