/**
 * singularity-engine — session persistence.
 *
 * Wraps SessionStore for session persistence and tool call logging.
 * Tool output truncated at 1MB.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { ToolCallResult, TurnResult } from './types.js';

// ─── Record types ─────────────────────────────────────────────────────────────

export interface SessionMessageRecord {
  sessionID: string;
  role: string;
  content: string;
  timestamp: number;
}

export interface ToolCallRecord {
  sessionID: string;
  callId: string;
  name: string;
  input: string;
  output: string;
  status: 'success' | 'error' | 'denied';
  wallClockMs: number;
  riskScore: string;
  timestamp: number;
}

// ─── Store interface ───────────────────────────────────────────────────────────

/**
 * Subset of SessionStore methods we use — defined locally to avoid
 * importing the implementation and creating a hard coupling.
 */
export interface PersistenceDeps {
  get(sessionID: string): Promise<unknown>;
  appendMessage?(
    sessionID: string,
    message: SessionMessageRecord
  ): Promise<void>;
  appendToolCall?(sessionID: string, call: ToolCallRecord): Promise<void>;
  upsertSession?(sessionID: string, metadata: SessionMetadata): Promise<void>;
}

export interface SessionMetadata {
  updatedAt?: number;
  messageCount?: number;
  lastActivity?: string;
  model?: string;
}

// ─── 1MB constant ─────────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

// ─── truncate helper ─────────────────────────────────────────────────────────

function truncateOutput(output: unknown): string {
  const str = typeof output === 'string' ? output : JSON.stringify(output);
  if (str.length <= MAX_OUTPUT_BYTES) return str;
  return `${str.slice(0, MAX_OUTPUT_BYTES)}\n[OUTPUT TRUNCATED — exceeded 1MB]`;
}

// ─── PersistenceManager ──────────────────────────────────────────────────────

export class PersistenceManager {
  constructor(private readonly store: PersistenceDeps) {}

  /**
   * Retrieve a session by ID.
   */
  async getSession(sessionID: string): Promise<unknown> {
    try {
      return await this.store.get(sessionID);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to get session ${sessionID}: ${msg}`);
    }
  }

  /**
   * Upsert session metadata.
   * Creates if it doesn't exist, updates if it does.
   */
  async upsertSession(
    sessionID: string,
    metadata: SessionMetadata
  ): Promise<void> {
    try {
      await this.store.upsertSession?.(sessionID, metadata);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[persistence] upsertSession failed for ${sessionID}: ${msg}\n`
      );
    }
  }

  /**
   * Log a completed turn: append user + assistant messages.
   */
  async logTurn(
    sessionID: string,
    turnResult: TurnResult,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    try {
      // Log the last assistant message (if any text/tool results)
      if (turnResult.textBuffer || turnResult.toolResults.length > 0) {
        const role = 'assistant';
        const content =
          turnResult.textBuffer ||
          JSON.stringify(
            turnResult.toolResults.map((tr) => ({
              type: 'tool-result',
              id: tr.id,
              name: tr.name,
              content:
                typeof tr.result === 'string'
                  ? tr.result
                  : JSON.stringify(tr.result),
            }))
          );

        await this.store.appendMessage?.(sessionID, {
          sessionID,
          role,
          content,
          timestamp: Date.now(),
        });
      }

      // Log tool call messages (user role)
      for (const tr of turnResult.toolResults) {
        await this.store.appendMessage?.(sessionID, {
          sessionID,
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
          timestamp: Date.now(),
        });
      }

      // Update session metadata
      await this.upsertSession(sessionID, {
        updatedAt: Date.now(),
        messageCount: messages.length,
        lastActivity: turnResult.toolResults.length > 0 ? 'tool-use' : 'text',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[persistence] logTurn failed for ${sessionID}: ${msg}\n`
      );
    }
  }

  /**
   * Log a single tool call.
   */
  async logToolCall(
    sessionID: string,
    toolCallResult: ToolCallResult,
    riskScore = 'UNKNOWN'
  ): Promise<void> {
    try {
      const status = this.determineStatus(toolCallResult.result);
      const output = truncateOutput(toolCallResult.result);

      const record: ToolCallRecord = {
        sessionID,
        callId: toolCallResult.id,
        name: toolCallResult.name,
        input:
          typeof toolCallResult.input === 'string'
            ? toolCallResult.input
            : JSON.stringify(toolCallResult.input),
        output,
        status,
        wallClockMs: toolCallResult.wallClockMs,
        riskScore,
        timestamp: Date.now(),
      };

      await this.store.appendToolCall?.(sessionID, record);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[persistence] logToolCall failed for ${sessionID}/${toolCallResult.name}: ${msg}\n`
      );
    }
  }

  private determineStatus(result: unknown): 'success' | 'error' | 'denied' {
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      if (obj.error === 'DENIED') return 'denied';
      if (obj.error === 'EXECUTION_ERROR') return 'error';
    }
    return 'success';
  }
}
