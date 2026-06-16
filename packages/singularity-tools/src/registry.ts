import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolValidationError,
} from './errors.js';
import type {
  ToolContext,
  ToolResult,
  ToolResultValue,
  ToolRiskScore,
} from './types.js';

// ---------------------------------------------------------------------------
// JsonSchema (lightweight validation)
// ---------------------------------------------------------------------------

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
  optional?: boolean;
}

// ---------------------------------------------------------------------------
// Tool.make — tool author factory
// ---------------------------------------------------------------------------

export interface ToolConfig {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  riskScore: ToolRiskScore;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  approvalRequired?: boolean;
  subsystem?: string[];
}

export interface ToolInstance {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  riskScore: ToolRiskScore;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  approvalRequired: boolean;
  subsystem?: string[];
}

export function makeTool(config: ToolConfig): ToolInstance {
  return {
    name: config.name,
    description: config.description ?? '',
    inputSchema: config.inputSchema,
    riskScore: config.riskScore,
    execute: config.execute,
    approvalRequired: config.approvalRequired ?? false,
    subsystem: config.subsystem ?? [],
  };
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolInstance>();

  register(tool: ToolInstance): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolInstance | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolInstance[] {
    return [...this.tools.values()];
  }

  getByRisk(risk: ToolRiskScore): ToolInstance[] {
    return this.getAll().filter((t) => t.riskScore === risk);
  }

  getToolsBySubsystem(name: string): ToolInstance[] {
    return this.getAll().filter((t) => (t.subsystem ?? []).includes(name));
  }

  discoverSubsystems(): Array<{ name: string; tools: string[] }> {
    const subsystemMap = new Map<string, Set<string>>();
    for (const tool of this.getAll()) {
      for (const sub of tool.subsystem ?? []) {
        if (!subsystemMap.has(sub)) {
          subsystemMap.set(sub, new Set());
        }
        subsystemMap.get(sub)?.add(tool.name);
      }
    }
    return [...subsystemMap.entries()].map(([name, tools]) => ({
      name,
      tools: [...tools],
    }));
  }

  materialize(): Materialization {
    const defs = this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: undefined as unknown,
    }));

    const registry = this;

    return {
      definitions: defs,
      async settle(input: SettlementInput): Promise<Settlement> {
        const tool = registry.get(input.call.name);
        if (!tool)
          throw new ToolNotFoundError(`Tool not found: ${input.call.name}`);
        return settle(tool, input.call.input, {
          sessionID: input.sessionID,
          agent: input.agent,
          assistantMessageID: input.assistantMessageID,
          call: { name: input.call.name, id: input.call.id ?? '' },
          worktreePath: input.worktreePath,
        } as unknown as ToolContext);
      },
    };
  }
}

export interface Materialization {
  definitions: Array<{
    name: string;
    description: string;
    inputSchema: JsonSchema;
    outputSchema?: unknown;
  }>;
  settle(input: SettlementInput): Promise<Settlement>;
}

export interface SettlementInput {
  sessionID: string;
  agent: string;
  assistantMessageID: string;
  call: { name: string; input: unknown; id?: string };
  worktreePath?: string;
}

export interface Settlement {
  result: ToolResultValue;
  output?: unknown;
  outputPaths?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateInput(
  schema: JsonSchema,
  input: unknown,
  depth = 0
): void {
  if (depth > 20) throw new ToolValidationError('Schema nesting too deep');

  if (input === null || input === undefined) {
    if (!schema.optional && schema.required?.includes(getKey(schema, input))) {
      throw new ToolValidationError('Missing required field');
    }
    return;
  }

  if (schema.type === 'string' && typeof input !== 'string') {
    throw new ToolValidationError(`Expected string, got ${typeof input}`);
  }
  if (schema.type === 'number' && typeof input !== 'number') {
    throw new ToolValidationError(`Expected number, got ${typeof input}`);
  }
  if (schema.type === 'boolean' && typeof input !== 'boolean') {
    throw new ToolValidationError(`Expected boolean, got ${typeof input}`);
  }
  if (
    schema.type === 'object' &&
    (typeof input !== 'object' || input === null || Array.isArray(input))
  ) {
    throw new ToolValidationError(`Expected object, got ${typeof input}`);
  }
  if (schema.type === 'array' && !Array.isArray(input)) {
    throw new ToolValidationError(`Expected array, got ${typeof input}`);
  }

  if (
    schema.minLength !== undefined &&
    typeof input === 'string' &&
    input.length < schema.minLength
  ) {
    throw new ToolValidationError(
      `String too short: min ${schema.minLength}, got ${input.length}`
    );
  }
  if (
    schema.maxLength !== undefined &&
    typeof input === 'string' &&
    input.length > schema.maxLength
  ) {
    throw new ToolValidationError(
      `String too long: max ${schema.maxLength}, got ${input.length}`
    );
  }
  if (
    schema.minimum !== undefined &&
    typeof input === 'number' &&
    input < schema.minimum
  ) {
    throw new ToolValidationError(
      `Number too small: min ${schema.minimum}, got ${input}`
    );
  }
  if (
    schema.maximum !== undefined &&
    typeof input === 'number' &&
    input > schema.maximum
  ) {
    throw new ToolValidationError(
      `Number too large: max ${schema.maximum}, got ${input}`
    );
  }
  if (schema.pattern !== undefined && typeof input === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(input)) {
      throw new ToolValidationError(
        `String does not match pattern: ${schema.pattern}`
      );
    }
  }
  if (schema.enum !== undefined && !schema.enum.includes(input)) {
    throw new ToolValidationError(
      `Value must be one of: ${schema.enum.join(', ')}`
    );
  }

  if (
    schema.type === 'object' &&
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input)
  ) {
    const obj = input as Record<string, unknown>;
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj) || obj[key] === undefined) {
          throw new ToolValidationError(`Missing required field: ${key}`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, value] of Object.entries(obj)) {
        const propSchema = schema.properties[key];
        if (propSchema) {
          validateInput(propSchema, value, depth + 1);
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(input)) {
    const itemSchema = schema.items;
    if (itemSchema) {
      for (const item of input) {
        validateInput(itemSchema, item, depth + 1);
      }
    }
  }
}

function getKey(_schema: JsonSchema, _input: unknown): string {
  return '';
}

export function stripUnknownFields(
  schema: JsonSchema,
  input: unknown
): unknown {
  if (
    schema.type !== 'object' ||
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input)
  ) {
    return input;
  }
  if (!schema.properties) return input;
  const obj = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key in (schema.properties ?? {})) {
      result[key] = stripUnknownFields(schema.properties?.[key], obj[key]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Settlement pipeline
// ---------------------------------------------------------------------------

const MAX_RESULT_SIZE = 1_000_000; // 1MB

export async function settle(
  tool: ToolInstance,
  rawInput: unknown,
  context: ToolContext
): Promise<Settlement> {
  // 1. Decode (string → JSON)
  let decoded: unknown;
  if (typeof rawInput === 'string') {
    try {
      decoded = JSON.parse(rawInput);
    } catch {
      throw new ToolValidationError('Invalid JSON input');
    }
  } else {
    decoded = rawInput;
  }

  // 2. Validate
  validateInput(tool.inputSchema, decoded);

  // 3. Strip unknown fields
  const cleaned = stripUnknownFields(tool.inputSchema, decoded);

  // 4. Execute
  let result: ToolResult;
  try {
    result = await tool.execute(cleaned, context as unknown as ToolContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { result: { type: 'error', value: message } };
  }

  // 5. Bound (1MB)
  const encoded = JSON.stringify(result.result);
  let finalResult: ToolResultValue;
  if (encoded.length > MAX_RESULT_SIZE) {
    finalResult = {
      type: 'truncated',
      originalSize: encoded.length,
    };
  } else {
    finalResult = result.result;
  }

  return {
    result: finalResult,
    output: result.output,
    outputPaths: result.outputPaths,
  };
}
