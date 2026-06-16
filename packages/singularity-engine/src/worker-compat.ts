/**
 * singularity-engine — worker compatibility.
 *
 * Documents and verifies compatibility between singularity-engine's turn executor
 * and singularity-loop's Worker interface.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { Activity, TurnResult } from './types.js';

// ─── singularity-loop Worker interface (imported as type reference) ──────────────
// The singularity-loop package defines:
//   type Worker = (state: LoopState) => Promise<ActionResult>
// We adapt the engine's SessionRunner.run() to this contract.

// ─── LoopState (from singularity-loop) ────────────────────────────────────────

export interface LoopState {
  sessionID: string;
  goal: string;
  attempt: number;
  step: number;
  abortSignal?: AbortSignal;
}

// ─── ActionResult (from singularity-loop) ──────────────────────────────────────

export interface ActionResult {
  kind: 'success' | 'error' | 'max-steps' | 'stop';
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ─── Compatibility adapter ──────────────────────────────────────────────────────

/**
 * Adapt SessionRunner.run() to the singularity-loop Worker contract.
 *
 * singularity-loop Worker: (state: LoopState) => Promise<ActionResult>
 * SessionRunner.run(): (activity, sessionID, abortSignal?) => AsyncGenerator<TurnResult>
 *
 * This adapter:
 *   1. Converts LoopState.goal → Activity{type:"queue", input: goal}
 *   2. Streams TurnResults from SessionRunner
 *   3. Maps the final TurnResult.stopReason → ActionResult.kind
 */
export async function workerAdapter(
  state: LoopState,
  runSession: (
    activity: Activity,
    sessionID: string,
    signal?: AbortSignal
  ) => AsyncGenerator<TurnResult>
): Promise<ActionResult> {
  const activity: Activity = { type: 'queue', input: state.goal };
  let lastResult: TurnResult | undefined;

  try {
    for await (const turnResult of runSession(
      activity,
      state.sessionID,
      state.abortSignal
    )) {
      lastResult = turnResult;

      if (turnResult.stopReason && !turnResult.needsContinuation) {
        return mapStopReason(turnResult.stopReason, turnResult);
      }
    }

    if (!lastResult) {
      return { kind: 'error', error: 'Session produced no turns' };
    }

    // Fell through without a stop reason — check needsContinuation
    if (lastResult.needsContinuation) {
      return {
        kind: 'max-steps',
        result: {
          text: lastResult.textBuffer,
          toolResults: lastResult.toolResults,
        },
      };
    }

    return mapStopReason(lastResult.stopReason ?? 'goal-met', lastResult);
  } catch (err) {
    return {
      kind: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapStopReason(reason: string, turnResult: TurnResult): ActionResult {
  switch (reason) {
    case 'goal-met':
      return {
        kind: 'success',
        result: {
          text: turnResult.textBuffer,
          toolResults: turnResult.toolResults,
        },
      };
    case 'max-iterations':
      return {
        kind: 'max-steps',
        result: {
          text: turnResult.textBuffer,
          toolResults: turnResult.toolResults,
        },
      };
    case 'cancelled':
      return { kind: 'stop', error: 'Session cancelled' };
    case 'context-overflow':
      return {
        kind: 'error',
        error: 'Context overflow after compaction',
      };
    case 'worker-error':
      return {
        kind: 'error',
        error: 'Tool execution error',
      };
    case 'evaluator-error':
      return {
        kind: 'error',
        error: 'Evaluator error',
      };
    default:
      return {
        kind: 'error',
        error: `Unknown stop reason: ${reason}`,
      };
  }
}

// ─── Type compatibility check ─────────────────────────────────────────────────
// These compile-time assertions verify the adapter signature is compatible
// with the singularity-loop Worker type.

// Compile-time compatibility check:
// workerAdapter signature must be assignable to (state: LoopState, runSession: ...) => Promise<ActionResult>
type _Check1 = typeof workerAdapter extends (
  state: LoopState,
  runSession: (
    activity: Activity,
    sessionID: string,
    signal?: AbortSignal
  ) => AsyncGenerator<TurnResult>
) => Promise<ActionResult>
  ? true
  : never;
const _check1: true = undefined as unknown as _Check1;
