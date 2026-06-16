/**
 * singularity-engine — conversation loop.
 *
 * Phase 14 — drives a single session turn: reference extraction,
 * context prepending, LLM streaming, and Turn yield.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { LLMEvent } from 'singularity-llm';
import { resolveReferences } from './context.js';

// ─── Turn ─────────────────────────────────────────────────────────────────────

/**
 * A single event yielded by the conversation loop while processing a turn.
 *
 * These mirror the raw LLM stream events so callers can observe
 * incremental progress (text deltas, tool calls, etc.) before the
 * turn completes.
 */
export interface Turn {
  type:
    | 'text-delta'
    | 'tool-call'
    | 'tool-result'
    | 'approval-required'
    | 'finish';
  textDelta?: string;
  toolCall?: { name: string; args: unknown; callId: string };
  toolResult?: { callId: string; output: string };
  approvalRequired?: {
    callId: string;
    tool: string;
    args: unknown;
    riskScore: string;
  };
  finishReason?: 'stop' | 'max_turns' | 'aborted';
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── LLM Adapter ─────────────────────────────────────────────────────────────

/**
 * Adapter interface for the LLM client.
 *
 * The loop holds an instance so it can stream from the LLM for each turn.
 */
export interface LLMAdapter {
  chat(
    model: string,
    messages: Array<{ role: string; content: string }>
  ): AsyncGenerator<LLMEvent>;
}

// ─── ConversationLoop ───────────────────────────────────────────────────────

/**
 * The conversation loop drives a single session turn from user input
 * to final Turn output.
 *
 * Callers use the async generator to observe incremental events
 * (text deltas, tool calls) as they arrive from the LLM stream.
 */
export interface ConversationLoop {
  /**
   * Run one turn of the conversation loop.
   *
   * @param sessionId — the active session ID
   * @param userMessage — the raw user message
   * @param signal — optional AbortSignal to cancel the turn
   */
  run(
    sessionId: string,
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<Turn>;
}

// ─── Context Block Builder ────────────────────────────────────────────────────

function buildContextBlock(
  references: Array<{ kind: string; value: string }>
): string {
  if (references.length === 0) return '';
  const lines = references.map((r) => `  [@${r.kind}:${r.value}]`);
  return `${['[context]', ...lines, '[/context]'].join('\n')}\n\n`;
}

// ─── DefaultConversationLoop ─────────────────────────────────────────────────

/**
 * Reference implementation of ConversationLoop.
 *
 * Steps for each turn:
 * 1. Call resolveReferences() on the userMessage
 * 2. Prepend a context block to the messages if references were found
 * 3. Stream from the LLM adapter, yielding Turn events
 * 4. Yield a final 'finish' Turn when the stream ends
 */
export class DefaultConversationLoop implements ConversationLoop {
  constructor(
    private llm: LLMAdapter,
    private model = 'gpt-4o'
  ) {}

  async *run(
    sessionId: string,
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<Turn> {
    // Step 1: extract references
    const refs = resolveReferences(userMessage);

    // Step 2: build messages with optional context block
    const contextBlock = buildContextBlock(refs);
    const content = contextBlock ? contextBlock + userMessage : userMessage;

    const messages = [{ role: 'user', content }];

    // Step 3: stream from LLM
    const stream = this.llm.chat(this.model, messages);

    let finishReason: Turn['finishReason'] | undefined;
    let usage: Turn['usage'] | undefined;

    try {
      for await (const event of stream) {
        if (signal?.aborted) {
          finishReason = 'aborted';
          break;
        }

        switch (event.type) {
          case 'text-delta':
            yield { type: 'text-delta', textDelta: event.text };
            break;

          case 'tool-call':
            yield {
              type: 'tool-call',
              toolCall: {
                name: event.name,
                args: event.input,
                callId: event.id,
              },
            };
            break;

          case 'tool-result': {
            const resultValue = event.result;
            let outputStr: string;
            if (resultValue.type === 'text') {
              outputStr = resultValue.value;
            } else if (resultValue.type === 'json') {
              outputStr = JSON.stringify(resultValue.value);
            } else if (resultValue.type === 'error') {
              outputStr = resultValue.value;
            } else {
              outputStr = JSON.stringify(resultValue);
            }
            yield {
              type: 'tool-result',
              toolResult: {
                callId: event.id,
                output: outputStr,
              },
            };
            break;
          }

          case 'finish':
          case 'step-finish':
            finishReason = mapFinishReason(event.reason);
            usage = event.usage as Turn['usage'];
            break;

          default:
            break;
        }
      }
    } catch (_err) {
      // Propagate error as aborted
      finishReason = 'aborted';
      void sessionId; // suppress unused warning
    }

    // Step 4: yield final finish turn
    yield {
      type: 'finish',
      finishReason: finishReason ?? 'aborted',
      usage,
    };
  }
}

// ─── Finish Reason Mapping ────────────────────────────────────────────────────

function mapFinishReason(reason: string): Turn['finishReason'] {
  switch (reason) {
    case 'stop':
    case 'content_filter':
      return 'stop';
    case 'max_tokens':
    case 'length':
      return 'max_turns';
    default:
      return 'aborted';
  }
}
