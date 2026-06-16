/**
 * singularity-engine — error types.
 *
 * All errors extend EngineError so callers can catch the base class and
 * switch on the subclass name (instanceof checks also work).
 */

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Thrown when the loop hits SessionRunnerConfig.maxSteps. */
export class StepLimitError extends EngineError {
  constructor(
    public sessionID: string,
    public limit: number
  ) {
    super(`Step limit exceeded: ${limit}`);
    this.name = 'StepLimitError';
  }
}

/** Thrown when compacted context still exceeds the model context window. */
export class ContextOverflowError extends EngineError {
  constructor(
    public usedTokens: number,
    public limit: number
  ) {
    super(`Context overflow: ${usedTokens} > ${limit}`);
    this.name = 'ContextOverflowError';
  }
}

/** Thrown when a turn transition fails (e.g. invalid state machine move). */
export class TurnTransitionError extends EngineError {
  constructor(public message: string) {
    super(message);
    this.name = 'TurnTransitionError';
  }
}

/** Thrown when a tool with approvalRequired=true is called without prior approval. */
export class ApprovalRequiredError extends EngineError {
  constructor(
    public toolName: string,
    public approvalId?: string
  ) {
    super(`Tool '${toolName}' requires approval before execution`);
    this.name = 'ApprovalRequiredError';
  }
}
