import { defaultDecision, type PolicyDecision } from './risk.js';

export type PolicyRule = {
  readonly pattern: string;
  readonly decision: PolicyDecision;
};

export type PolicyContext = {
  readonly projectId: string;
  readonly savedRules: readonly PolicyRule[];
  readonly globalRules: readonly PolicyRule[];
};

export type PolicyResult = {
  readonly decision: PolicyDecision;
  readonly preferredAction?: string;
  readonly reason: string;
};

export class ApprovalPolicy {
  evaluate(action: string, context: PolicyContext): PolicyResult {
    if (this.isExternalMutation(action)) {
      return {
        decision: 'ask',
        reason: 'external mutation requires confirmation',
      };
    }

    for (const rule of context.globalRules) {
      if (rule.decision === 'deny' && this.matchesRule(action, rule)) {
        return {
          decision: 'deny',
          reason: 'denied by policy',
        };
      }
    }

    for (const rule of context.savedRules) {
      if (rule.decision === 'deny' && this.matchesRule(action, rule)) {
        return {
          decision: 'deny',
          reason: 'denied by policy',
        };
      }
    }

    for (const rule of context.savedRules) {
      if (rule.decision === 'allow' && this.matchesRule(action, rule)) {
        return {
          decision: 'allow',
          reason: 'allowed by project policy',
        };
      }
    }

    for (const rule of context.globalRules) {
      if (rule.decision === 'allow' && this.matchesRule(action, rule)) {
        return {
          decision: 'allow',
          reason: 'allowed by global policy',
        };
      }
    }

    const decision = defaultDecision(action);

    if (action === 'delete:file') {
      return {
        decision,
        preferredAction: 'bash:trash',
        reason: 'consider using trash instead of permanent deletion',
      };
    }

    return {
      decision,
      reason: 'default policy',
    };
  }

  private isExternalMutation(action: string): boolean {
    return action === 'network:fetch';
  }

  private matchesRule(action: string, rule: PolicyRule): boolean {
    return rule.pattern === action;
  }
}
