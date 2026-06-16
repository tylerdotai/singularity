import {
  type CreateSubagentTaskContractInput,
  DEFAULT_SUBAGENT_MAX_TURNS,
  MAX_SUBAGENT_CONTEXT_LENGTH,
  MAX_SUBAGENT_GOAL_LENGTH,
  MAX_SUBAGENT_MAX_TURNS,
  MIN_SUBAGENT_MAX_TURNS,
  type SubagentContext,
  type SubagentContextReferenceKind,
  type SubagentModelPolicy,
  type SubagentResultSchema,
  type SubagentTaskContract,
  type SubagentWorkIsolation,
} from './contract.js';
import { SubagentContractError } from './errors.js';

const TOOL_NAME_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const REQUIRED_FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
const ID_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const CONTEXT_REFERENCE_KINDS: readonly SubagentContextReferenceKind[] = [
  'file',
  'url',
  'session',
  'profile',
  'artifact',
];

export function normalizeSubagentTaskContract(
  input: CreateSubagentTaskContractInput
): SubagentTaskContract {
  const contract: SubagentTaskContract = {
    id: input.id ?? generateContractId(),
    goal: input.goal,
    context:
      typeof input.context === 'string'
        ? { summary: input.context }
        : cloneContext(input.context),
    allowedTools: [...(input.allowedTools ?? [])],
    modelPolicy: { ...(input.modelPolicy ?? {}) },
    workIsolation: cloneWorkIsolation(input.workIsolation ?? { kind: 'none' }),
    resultSchema: cloneResultSchema(input.resultSchema ?? { kind: 'text' }),
    maxTurns: input.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS,
    profileId: input.profileId,
    parentSessionId: input.parentSessionId,
    agentId: input.agentId,
    reviewerRole: input.reviewerRole,
    metadata: input.metadata === undefined ? undefined : { ...input.metadata },
  };

  validateSubagentTaskContract(contract);
  return contract;
}

export function validateSubagentTaskContract(
  contract: SubagentTaskContract
): void {
  validateIdentifier(contract.id, 'id');
  validateGoal(contract.goal);
  validateContext(contract.context);
  validateAllowedTools(contract.allowedTools);
  validateModelPolicy(contract.modelPolicy);
  validateWorkIsolation(contract.workIsolation);
  validateResultSchema(contract.resultSchema);
  validateMaxTurns(contract.maxTurns);

  if (contract.profileId !== undefined) {
    validateIdentifier(contract.profileId, 'profileId');
  }
  if (contract.parentSessionId !== undefined) {
    validateIdentifier(contract.parentSessionId, 'parentSessionId');
  }
  if (contract.agentId !== undefined) {
    validateIdentifier(contract.agentId, 'agentId');
  }
  if (
    contract.reviewerRole !== undefined &&
    contract.reviewerRole.trim() === ''
  ) {
    throw new SubagentContractError(
      'context_reference_invalid',
      'reviewerRole',
      'reviewerRole must be non-empty when provided',
      contract.reviewerRole
    );
  }
}

function validateGoal(goal: string): void {
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    throw new SubagentContractError(
      'goal_empty',
      'goal',
      'goal must be non-empty',
      goal
    );
  }
  if (trimmed.length > MAX_SUBAGENT_GOAL_LENGTH) {
    throw new SubagentContractError(
      'goal_too_long',
      'goal',
      `goal must be <= ${MAX_SUBAGENT_GOAL_LENGTH} characters`,
      goal
    );
  }
}

function validateContext(context: SubagentContext): void {
  const summary = context.summary.trim();
  if (summary.length === 0) {
    throw new SubagentContractError(
      'context_empty',
      'context.summary',
      'context.summary must be non-empty',
      context.summary
    );
  }
  if (summary.length > MAX_SUBAGENT_CONTEXT_LENGTH) {
    throw new SubagentContractError(
      'context_too_long',
      'context.summary',
      `context.summary must be <= ${MAX_SUBAGENT_CONTEXT_LENGTH} characters`,
      context.summary
    );
  }

  for (const ref of context.references ?? []) {
    if (!CONTEXT_REFERENCE_KINDS.includes(ref.kind)) {
      throw new SubagentContractError(
        'context_reference_invalid',
        'context.references.kind',
        `unsupported context reference kind: ${ref.kind}`,
        ref.kind
      );
    }
    if (ref.value.trim() === '') {
      throw new SubagentContractError(
        'context_reference_invalid',
        'context.references.value',
        'context reference value must be non-empty',
        ref.value
      );
    }
  }
}

function validateAllowedTools(tools: readonly string[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!TOOL_NAME_RE.test(tool)) {
      throw new SubagentContractError(
        'allowed_tool_invalid',
        'allowedTools',
        `invalid allowed tool name: ${tool}`,
        tool
      );
    }
    if (seen.has(tool)) {
      throw new SubagentContractError(
        'allowed_tool_duplicate',
        'allowedTools',
        `duplicate allowed tool name: ${tool}`,
        tool
      );
    }
    seen.add(tool);
  }
}

function validateModelPolicy(policy: SubagentModelPolicy): void {
  if (policy.provider !== undefined && policy.provider.trim() === '') {
    throw new SubagentContractError(
      'model_policy_invalid',
      'modelPolicy.provider',
      'modelPolicy.provider must be non-empty when provided',
      policy.provider
    );
  }
  if (policy.model !== undefined && policy.model.trim() === '') {
    throw new SubagentContractError(
      'model_policy_invalid',
      'modelPolicy.model',
      'modelPolicy.model must be non-empty when provided',
      policy.model
    );
  }
  if (
    policy.temperature !== undefined &&
    (!Number.isFinite(policy.temperature) ||
      policy.temperature < 0 ||
      policy.temperature > 2)
  ) {
    throw new SubagentContractError(
      'model_policy_invalid',
      'modelPolicy.temperature',
      'modelPolicy.temperature must be between 0 and 2',
      policy.temperature
    );
  }
}

function validateWorkIsolation(isolation: SubagentWorkIsolation): void {
  if (isolation.kind === 'none') {
    return;
  }
  if (isolation.kind === 'worktree') {
    if (isolation.basePath !== undefined && isolation.basePath.trim() === '') {
      throw new SubagentContractError(
        'work_isolation_invalid',
        'workIsolation.basePath',
        'worktree basePath must be non-empty when provided',
        isolation.basePath
      );
    }
    if (
      isolation.branchName !== undefined &&
      isolation.branchName.trim() === ''
    ) {
      throw new SubagentContractError(
        'work_isolation_invalid',
        'workIsolation.branchName',
        'worktree branchName must be non-empty when provided',
        isolation.branchName
      );
    }
    return;
  }
  if (isolation.kind === 'sandbox') {
    if (isolation.rootPath !== undefined && isolation.rootPath.trim() === '') {
      throw new SubagentContractError(
        'work_isolation_invalid',
        'workIsolation.rootPath',
        'sandbox rootPath must be non-empty when provided',
        isolation.rootPath
      );
    }
    return;
  }

  throw new SubagentContractError(
    'work_isolation_invalid',
    'workIsolation.kind',
    'workIsolation.kind must be none, worktree, or sandbox',
    isolation
  );
}

function validateResultSchema(schema: SubagentResultSchema): void {
  if (schema.kind === 'text') {
    return;
  }
  if (schema.kind !== 'json') {
    throw new SubagentContractError(
      'result_schema_invalid',
      'resultSchema.kind',
      'resultSchema.kind must be text or json',
      schema
    );
  }

  const seen = new Set<string>();
  for (const field of schema.requiredFields ?? []) {
    if (!REQUIRED_FIELD_RE.test(field)) {
      throw new SubagentContractError(
        'result_schema_invalid',
        'resultSchema.requiredFields',
        `invalid required result field: ${field}`,
        field
      );
    }
    if (seen.has(field)) {
      throw new SubagentContractError(
        'result_schema_invalid',
        'resultSchema.requiredFields',
        `duplicate required result field: ${field}`,
        field
      );
    }
    seen.add(field);
  }
}

function validateMaxTurns(maxTurns: number): void {
  if (
    !Number.isInteger(maxTurns) ||
    maxTurns < MIN_SUBAGENT_MAX_TURNS ||
    maxTurns > MAX_SUBAGENT_MAX_TURNS
  ) {
    throw new SubagentContractError(
      'max_turns_invalid',
      'maxTurns',
      `maxTurns must be an integer between ${MIN_SUBAGENT_MAX_TURNS} and ${MAX_SUBAGENT_MAX_TURNS}`,
      maxTurns
    );
  }
}

function validateIdentifier(value: string, field: string): void {
  if (!ID_RE.test(value)) {
    throw new SubagentContractError(
      'context_reference_invalid',
      field,
      `${field} must match ${ID_RE}`,
      value
    );
  }
}

function cloneContext(context: SubagentContext): SubagentContext {
  return {
    summary: context.summary,
    references: context.references?.map((ref) => ({ ...ref })),
  };
}

function cloneWorkIsolation(
  isolation: SubagentWorkIsolation
): SubagentWorkIsolation {
  return { ...isolation };
}

function cloneResultSchema(schema: SubagentResultSchema): SubagentResultSchema {
  if (schema.kind === 'json') {
    return {
      kind: 'json',
      requiredFields: schema.requiredFields
        ? [...schema.requiredFields]
        : undefined,
    };
  }
  return { kind: 'text' };
}

function generateContractId(): string {
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return `subtask_${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
