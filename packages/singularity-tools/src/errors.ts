export class ToolValidationError extends Error {
  constructor(
    public message: string,
    public errors?: unknown
  ) {
    super(message);
    this.name = 'ToolValidationError';
  }
}
export class ToolExecutionError extends Error {
  constructor(
    public message: string,
    public toolName: string
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}
export class ToolNotFoundError extends Error {
  constructor(public toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}
