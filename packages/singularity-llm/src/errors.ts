export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMError';
  }
}
export class ProviderError extends LLMError {
  constructor(
    public message: string,
    public classification?: string,
    public retryable?: boolean
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
export class ContextOverflowError extends LLMError {
  constructor(
    public contextWindow: number,
    public usedTokens: number
  ) {
    super(`Context overflow: ${usedTokens} > ${contextWindow}`);
    this.name = 'ContextOverflowError';
  }
}
export class ToolFailure extends Error {
  constructor(public message: string) {
    super(message);
    this.name = 'ToolFailure';
  }
}
