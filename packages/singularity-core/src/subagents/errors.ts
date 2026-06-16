export type SubagentContractErrorReason =
  | 'goal_empty'
  | 'goal_too_long'
  | 'context_empty'
  | 'context_too_long'
  | 'context_reference_invalid'
  | 'allowed_tool_invalid'
  | 'allowed_tool_duplicate'
  | 'model_policy_invalid'
  | 'work_isolation_invalid'
  | 'result_schema_invalid'
  | 'max_turns_invalid';
export class SubagentContractError extends Error {
  readonly reason: SubagentContractErrorReason;
  readonly field: string;
  readonly value?: unknown;

  constructor(
    reason: SubagentContractErrorReason,
    field: string,
    message: string,
    value?: unknown
  ) {
    super(message);
    this.name = 'SubagentContractError';
    this.reason = reason;
    this.field = field;
    this.value = value;
  }
}
