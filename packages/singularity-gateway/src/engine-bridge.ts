/**
 * singularity-gateway — engine bridge.
 *
 * Wires gateway adapters (Telegram/Discord) to the singularity-engine SessionRunner.
 * receive() → Activity → SessionRunner → OutgoingMessage stream.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { Activity, TurnResult } from 'singularity-engine';
import type { Platform } from './platform.js';

// ─── Bridge interfaces ─────────────────────────────────────────────────────────

export interface EngineRunner {
  run(
    activity: Activity,
    sessionID: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<TurnResult, void, unknown>;
  /** Approval store for resolving pending approvals. Wakes suspended engine. */
  readonly approvalStore?: {
    resolve(id: string, approved: boolean): void;
  };
}

export interface GatewaySessionBridgeOptions {
  engineRunner: EngineRunner;
  /** Map of platform+chatId to sessionID. Caller manages persistence. */
  sessionIndex?: Map<string, string>;
}

export interface OutgoingMessage {
  platform: Platform;
  chatId: string | number;
  threadId: string | number | null;
  text: string;
  approval?: {
    id: string;
    tool: string;
    args: unknown;
    riskScore: string;
  };
}

// ─── Session key helpers ──────────────────────────────────────────────────────

function sessionKey(platform: Platform, chatId: string | number): string {
  return `${platform}:${chatId}`;
}

// ─── Bridge ──────────────────────────────────────────────────────────────────

export class GatewaySessionBridge {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly sessionIndex: Map<string, string>;
  private readonly pendingApprovals = new Map<
    string,
    (approved: boolean) => void
  >();
  private readonly pendingApprovalResults = new Map<string, boolean>();

  constructor(private readonly opts: GatewaySessionBridgeOptions) {
    this.sessionIndex = opts.sessionIndex ?? new Map();
  }

  /**
   * Get existing sessionID for a platform+chatId, or undefined if none exists.
   */
  getSession(platform: Platform, chatId: string | number): string | undefined {
    return this.sessionIndex.get(sessionKey(platform, chatId));
  }

  /**
   * Register a sessionID for a platform+chatId.
   */
  registerSession(
    platform: Platform,
    chatId: string | number,
    sessionID: string
  ): void {
    this.sessionIndex.set(sessionKey(platform, chatId), sessionID);
  }

  /**
   * Receive an incoming message and run it through the engine.
   * Yields OutgoingMessage chunks to send back via the gateway adapter.
   */
  async *receive(
    platform: Platform,
    chatId: string | number,
    threadId: string | number | null,
    text: string,
    sessionID: string,
    isSteer: boolean = false
  ): AsyncGenerator<OutgoingMessage, void, unknown> {
    // Cancel any existing run for this session
    this.abortControllers.get(sessionID)?.abort();

    const abortController = new AbortController();
    this.abortControllers.set(sessionID, abortController);

    const activity: Activity = isSteer
      ? {
          type: 'steer',
          input: text.startsWith('/steer ') ? text.slice(7) : text,
        }
      : { type: 'queue', input: text };

    try {
      for await (const turnResult of this.opts.engineRunner.run(
        activity,
        sessionID,
        abortController.signal
      )) {
        if (turnResult.approval) {
          yield {
            platform,
            chatId,
            threadId,
            text: `🔔 Approval required for \`${turnResult.approval.tool}\` (risk: ${turnResult.approval.riskScore})`,
            approval: {
              id: turnResult.approval.approvalId,
              tool: turnResult.approval.tool,
              args: turnResult.approval.args,
              riskScore: turnResult.approval.riskScore,
            },
          };
          continue;
        }

        if (turnResult.textBuffer) {
          yield { platform, chatId, threadId, text: turnResult.textBuffer };
        }

        for (const tr of turnResult.toolResults) {
          const content =
            typeof tr.result === 'string'
              ? tr.result
              : JSON.stringify(tr.result);
          yield { platform, chatId, threadId, text: `[${tr.name}] ${content}` };
        }
      }
    } finally {
      this.abortControllers.delete(sessionID);
    }
  }

  /**
   * Resolve a pending approval by ID. Wakes the suspended engine.
   */
  resolveApproval(approvalId: string, approved: boolean): void {
    (
      this.opts.engineRunner as EngineRunner & {
        approvalStore?: { resolve(id: string, approved: boolean): void };
      }
    ).approvalStore?.resolve(approvalId, approved);
    const resolve = this.pendingApprovals.get(approvalId);
    if (resolve) {
      this.pendingApprovals.delete(approvalId);
      resolve(approved);
    } else {
      this.pendingApprovalResults.set(approvalId, approved);
    }
  }

  /**
   * Cancel an active session run.
   */
  cancel(sessionID: string): void {
    this.abortControllers.get(sessionID)?.abort();
    this.abortControllers.delete(sessionID);
  }
}

// ─── Activity factories ────────────────────────────────────────────────────────

export function textToActivity(text: string): Activity {
  if (text.startsWith('/steer ')) {
    return { type: 'steer', input: text.slice(7) };
  }
  return { type: 'queue', input: text };
}

export function isSteerCommand(text: string): boolean {
  return text.startsWith('/steer ');
}
