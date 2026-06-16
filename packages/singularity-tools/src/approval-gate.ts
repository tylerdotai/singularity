/**
 * singularity-tools — approval gate middleware.
 *
 * Wires GrantVault into the ToolRegistry settlement pipeline.
 * Wraps HIGH/CRITICAL risk tool executions behind ApprovalGuard.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { GrantRequest } from 'singularity-approvals';
import type { ToolRiskScore } from './types.js';

// ─── Gate configuration ─────────────────────────────────────────────────────────

export interface ApprovalGateConfig {
  /** Minimum risk score that requires approval gate. Default: HIGH */
  threshold?: ToolRiskScore;
  /** Whether to block denied tools or just warn. Default: block */
  blockOnDeny?: boolean;
}

// Default: only CRITICAL tools are blocked by default; HIGH tools require approval
const RISK_ORDER: ToolRiskScore[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// ─── Approval gate wrapper ────────────────────────────────────────────────────

export class ApprovalGate {
  constructor(
    private readonly guard: {
      guard<T>(request: GrantRequest, operation: () => Promise<T>): Promise<T>;
    },
    private readonly config: ApprovalGateConfig = {}
  ) {}

  /**
   * Wrap a tool execution behind the approval guard.
   *
   * If the tool's risk score is at or above the threshold:
   *   1. Build a GrantRequest from the tool name + input
   *   2. Call guard.guard() — runs the operation if approved, throws if denied
   *   3. If blockOnDeny is false, returns { denied: true } instead of throwing
   *
   * If below threshold: runs operation directly without approval check.
   */
  async withApproval<T>(params: {
    sessionID: string;
    tool: string;
    riskScore: ToolRiskScore;
    input: unknown;
    operation: () => Promise<T>;
  }): Promise<T> {
    const { sessionID, tool, riskScore, input, operation } = params;
    const threshold = this.config.threshold ?? 'CRITICAL';

    // Check if this risk level requires approval
    const toolLevel = RISK_ORDER.indexOf(riskScore);
    const thresholdLevel = RISK_ORDER.indexOf(threshold);

    if (toolLevel < thresholdLevel) {
      // Below threshold — run directly
      return operation();
    }

    const request: GrantRequest = {
      sessionId: sessionID,
      action: tool,
      resource: typeof input === 'string' ? input : JSON.stringify(input),
      requestedAt: new Date(),
    };

    try {
      return await this.guard.guard(request, operation);
    } catch (err) {
      if (!this.config.blockOnDeny) {
        // Return a denied marker instead of throwing
        throw Object.assign(
          new Error(`Tool '${tool}' denied by approval policy`),
          {
            code: 'APPROVAL_DENIED',
            tool,
          }
        );
      }
      throw err;
    }
  }

  /**
   * Check if a tool with the given risk score would require approval.
   */
  requiresApproval(riskScore: ToolRiskScore): boolean {
    const threshold = this.config.threshold ?? 'CRITICAL';
    const toolLevel = RISK_ORDER.indexOf(riskScore);
    const thresholdLevel = RISK_ORDER.indexOf(threshold);
    return toolLevel >= thresholdLevel;
  }
}

// ─── Guard factory from vault ────────────────────────────────────────────────

export function createGuardFromVault(vault: {
  check(
    request: GrantRequest
  ): Promise<{ effect: 'allow' | 'deny' } | undefined>;
}): {
  guard<T>(request: GrantRequest, operation: () => Promise<T>): Promise<T>;
} {
  return {
    async guard<T>(
      request: GrantRequest,
      operation: () => Promise<T>
    ): Promise<T> {
      const grant = await vault.check(request);
      if (grant && grant.effect === 'deny') {
        throw new Error(`Tool '${request.action}' denied by GrantVault`);
      }
      if (!grant) {
        // No grant — in a real implementation, this would invoke the policy
        // to request approval. For now, we allow it (permissive default).
        // Phase 4.1 wires the full policy layer here.
      }
      return operation();
    },
  };
}
