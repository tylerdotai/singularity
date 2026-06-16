export type ActionRisk = 'safe' | 'risky' | 'destructive';

export type ActionClass =
  | 'read:file'
  | 'write:file'
  | 'delete:file'
  | 'bash:shell'
  | 'network:fetch'
  | 'bash:trash';

export type PolicyDecision = 'allow' | 'ask' | 'deny';

const ACTION_RISK: Record<ActionClass, ActionRisk> = {
  'read:file': 'safe',
  'write:file': 'risky',
  'delete:file': 'destructive',
  'bash:shell': 'risky',
  'network:fetch': 'destructive',
  'bash:trash': 'risky',
};

const ACTION_DECISION: Record<ActionClass, PolicyDecision> = {
  'read:file': 'allow',
  'write:file': 'ask',
  'delete:file': 'ask',
  'bash:shell': 'ask',
  'network:fetch': 'ask',
  'bash:trash': 'ask',
};

function isActionClass(action: string): action is ActionClass {
  return action in ACTION_RISK;
}

export function classifyAction(action: string): ActionRisk {
  if (isActionClass(action)) {
    return ACTION_RISK[action];
  }
  return 'risky';
}

export function defaultDecision(action: string): PolicyDecision {
  if (isActionClass(action)) {
    return ACTION_DECISION[action];
  }
  return 'ask';
}

export function preferredAlternative(action: string): string | undefined {
  if (action === 'delete:file') {
    return 'bash:trash';
  }
  return undefined;
}
