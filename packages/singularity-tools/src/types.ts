// ToolDef — a defined tool with metadata
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown; // JSON Schema
  outputSchema?: unknown;
  riskScore: ToolRiskScore;
  approvalRequired?: boolean;
  subsystem?: string[];
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

// SubsystemMetadata — discovered subsystem information
export interface SubsystemMetadata {
  name: string;
  tools: string[];
  description?: string;
}

// ToolRiskScore
export type ToolRiskScore = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ToolInput — raw input to a tool (unvalidated)
export type ToolInput = unknown;

// ToolOutput — output from a tool (unvalidated)
export type ToolOutput = unknown;

// ToolContext — runtime context passed to every tool execution
export interface ToolContext {
  sessionID: string;
  agent: string;
  assistantMessageID: string;
  toolCallID: string;
  worktreePath?: string;
}

// ToolResult — what a tool returns
export interface ToolResult {
  result: ToolResultValue;
  output?: unknown;
  outputPaths?: ReadonlyArray<string>;
}

// ToolResultValue — structured result value
export type ToolResultValue =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string }
  | { type: 'error'; value: string }
  | { type: 'content'; value: ReadonlyArray<{ type: 'text'; text: string }> }
  | { type: 'truncated'; originalSize: number };

// Settlement — the full settlement pipeline result
export interface Settlement {
  result: ToolResultValue;
  output?: unknown;
  outputPaths?: ReadonlyArray<string>;
}

// ToolRegistryInterface
export interface ToolRegistryInterface {
  register(name: string, tool: ToolDef): void;
  materialize(permissions?: ReadonlyArray<string>): Materialization;
  get(name: string): ToolDef | undefined;
}

export interface Materialization {
  definitions: ReadonlyArray<ToolDefinition>;
  settle(input: SettlementInput): Promise<Settlement>;
}

export interface SettlementInput {
  sessionID: string;
  agent: string;
  assistantMessageID: string;
  call: { name: string; input: unknown };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}
