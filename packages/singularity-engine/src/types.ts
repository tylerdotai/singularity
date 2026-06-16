/**
 * singularity-engine — type definitions for the agent session runner.
 *
 * Phase 1.0 is a skeleton — no runtime logic. Types are frozen until
 * the SessionRunner.run() implementation lands.
 */

import type { FactStore, SessionStore } from 'singularity-core';
import type { LLMEvent, Model, ToolDefinition, Usage } from 'singularity-llm';
import type { ToolRegistryInterface, ToolRiskScore } from 'singularity-tools';
import type { PromptCacheManager } from './cache.js';

// ─── SessionRunner ────────────────────────────────────────────────────────────

/**
 * Configuration for a single session run.
 *
 * All numeric fields have defaults so callers can pass a partial object.
 */
export interface SessionRunnerConfig {
  /** Hard cap on loop iterations. Default: 25. */
  maxSteps?: number;
  /** Rolling conversation buffer ceiling in tokens. Default: 20000. */
  bufferSize?: number;
  /** Tokens to preserve in the compaction window. Default: 8000. */
  keepTokens?: number;
  /** Tokens allocated for the summary LLM call. Default: 4096. */
  summaryTokens?: number;
  /** Model context window in tokens. Required — no default. */
  contextWindow?: number;
  /** LLM model name. Default: "gpt-4o". */
  model?: string;
}

// ─── Turn execution ──────────────────────────────────────────────────────────

/**
 * Result of a single turn (one LLM call + tool executions).
 */
export interface TurnResult {
  /** Whether the run should continue to the next turn. */
  needsContinuation: boolean;
  /** Why the turn stopped, if the run is ending. */
  stopReason?: StopReason;
  /** Accumulated text response from this turn. */
  textBuffer: string;
  /** Ordered list of tool call results from this turn. */
  toolResults: ReadonlyArray<ToolCallResult>;
  /** Token usage for this turn, if available. */
  usage?: Usage;
  /** Present when engine suspends waiting for user approval. */
  approval?: {
    approvalId: string;
    callId: string;
    tool: string;
    args: unknown;
    riskScore: ToolRiskScore;
  };
}

/**
 * A single tool call result captured during a turn.
 */
export interface ToolCallResult {
  id: string;
  name: string;
  input: unknown;
  result: unknown;
  wallClockMs: number;
}

// ─── Activity ────────────────────────────────────────────────────────────────

/**
 * User-facing activity signal injected into the session.
 *
 * - `"steer"` — the user is redirecting or correcting the agent.
 * - `"queue"`  — the user has queued work to be done next.
 */
export type Activity =
  | { type: 'steer'; input: string }
  | { type: 'queue'; input: string };

// ─── Run state ───────────────────────────────────────────────────────────────

/**
 * Ephemeral state for an in-flight run.
 */
export interface RunState {
  sessionID: string;
  step: number;
  needsContinuation: boolean;
  stopReason: StopReason | null;
}

// ─── StopReason ───────────────────────────────────────────────────────────────

/**
 * Why a session run terminated.
 *
 * Compatible with `singularity-loop`'s `StopReason` but expanded for
 * the engine layer. Engine-specific variants (context-overflow, etc.)
 * are distinct from loop-level stop conditions.
 */
export type StopReason =
  | 'goal-met' // evaluator / guard signaled success
  | 'max-iterations' // hit SessionRunnerConfig.maxSteps
  | 'worker-error' // tool execution threw
  | 'evaluator-error' // approval guard or policy check threw
  | 'cancelled' // external AbortSignal
  | 'context-overflow'; // compacted context still exceeds contextWindow

// ─── Compaction ──────────────────────────────────────────────────────────────

/**
 * Compaction strategy parameters derived from SessionRunnerConfig.
 *
 * Passed through to the memory subsystem so it knows how aggressively
 * to summarise the rolling context window.
 */
export interface CompactionConfig {
  bufferSize: number;
  keepTokens: number;
  summaryTokens: number;
  contextWindow: number;
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

/**
 * The concrete dependency bundle the engine requires at runtime.
 *
 * Each field is a typed interface from its own package boundary so the
 * engine stays decoupled from implementation details.
 */
export interface EngineDeps {
  /** LLM client — consumed via chat(model, messages, tools?). */
  llm: LLMRunner;
  /** Tool registry for materialising permitted tools. */
  tools: ToolRegistryInterface;
  /** Session persistence — upsert, get, lineage. */
  store: SessionStore;
  /** Approval store — tracks pending approval requests and their resolution. */
  approvalStore: {
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
  /** Fact memory — recall, create, supersede. */
  factStore: FactStore;
  /** Optional session-level cache for tool results and summaries. */
  cache?: PromptCacheManager;
}

/**
 * The approval guard interface the engine consumes.
 * Wraps a GrantVault and provides requiresApproval + checkApproval.
 */
export interface ApprovalGuardAdapter {
  requiresApproval(toolName: string, approvalRequired: boolean): boolean;
  checkApproval(
    sessionID: string,
    toolName: string,
    input?: unknown
  ): Promise<{ approved: boolean; reason?: string }>;
}

/**
 * The LLM interface the engine consumes.
 *
 * Returns an async generator of LLMEvent so the caller can stream tokens,
 * tool calls, and usage metadata incrementally.
 */
export interface LLMRunner {
  chat(
    model: Model,
    messages: unknown,
    tools?: ReadonlyArray<ToolDefinition>
  ): AsyncGenerator<LLMEvent>;
}
