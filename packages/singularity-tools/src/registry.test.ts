import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  makeTool,
  settle,
  stripUnknownFields,
  ToolRegistry,
  validateInput,
} from './registry.js';
import type { ToolContext, ToolResult } from './types.js';

const TEST_CONTEXT: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

function mockTool(overrides = {}) {
  return makeTool({
    name: 'mock',
    description: 'Mock tool',
    riskScore: 'LOW',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    execute: async (input) => ({ result: { type: 'json', value: input } }),
    ...overrides,
  });
}

describe('makeTool', () => {
  test('creates tool with required fields', () => {
    const tool = mockTool({ name: 'test', riskScore: 'HIGH' });
    expect(tool.name).toBe('test');
    expect(tool.riskScore).toBe('HIGH');
    expect(tool.approvalRequired).toBe(false);
  });

  test('defaults approvalRequired to false', () => {
    const tool = mockTool();
    expect(tool.approvalRequired).toBe(false);
  });

  test('sets approvalRequired when provided', () => {
    const tool = mockTool({ approvalRequired: true });
    expect(tool.approvalRequired).toBe(true);
  });
});

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  test('register adds tool', () => {
    registry.register(mockTool({ name: 'foo' }));
    expect(registry.get('foo')).toBeDefined();
  });

  test('unregister removes tool', () => {
    registry.register(mockTool({ name: 'foo' }));
    registry.unregister('foo');
    expect(registry.get('foo')).toBeUndefined();
  });

  test('getByRisk filters correctly', () => {
    registry.register(mockTool({ name: 'low', riskScore: 'LOW' }));
    registry.register(mockTool({ name: 'high', riskScore: 'HIGH' }));
    expect(registry.getByRisk('LOW')).toHaveLength(1);
    expect(registry.getByRisk('LOW')[0].name).toBe('low');
  });

  test('getAll returns all tools', () => {
    registry.register(mockTool({ name: 'a' }));
    registry.register(mockTool({ name: 'b' }));
    expect(registry.getAll()).toHaveLength(2);
  });

  test('materialize returns definitions + settle', () => {
    registry.register(mockTool({ name: 'mat' }));
    const mat = registry.materialize();
    expect(mat.definitions).toHaveLength(1);
    expect(mat.definitions[0].name).toBe('mat');
  });

  test('materialize().settle calls correct tool', async () => {
    let called = false;
    registry.register(
      makeTool({
        name: 'called',
        riskScore: 'LOW',
        inputSchema: {
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
        },
        execute: async (input) => {
          called = true;
          return { result: { type: 'json', value: input } };
        },
      })
    );
    const mat = registry.materialize();
    await mat.settle({
      sessionID: 's',
      agent: 'a',
      assistantMessageID: 'm',
      call: { name: 'called', input: { x: 1 } },
    });
    expect(called).toBe(true);
  });

  test('materialize().settle throws ToolNotFoundError for unknown tool', async () => {
    const mat = registry.materialize();
    await expect(
      mat.settle({
        sessionID: 's',
        agent: 'a',
        assistantMessageID: 'm',
        call: { name: 'nonexistent', input: {} },
      })
    ).rejects.toThrow('Tool not found: nonexistent');
  });
});

describe('validateInput', () => {
  test('passes valid string', () => {
    expect(() => validateInput({ type: 'string' }, 'hello')).not.toThrow();
  });

  test('throws on wrong type string', () => {
    expect(() => validateInput({ type: 'string' }, 123)).toThrow(
      'Expected string'
    );
  });

  test('passes valid number', () => {
    expect(() => validateInput({ type: 'number' }, 42)).not.toThrow();
  });

  test('throws on wrong type number', () => {
    expect(() => validateInput({ type: 'number' }, 'foo')).toThrow(
      'Expected number'
    );
  });

  test('passes valid boolean', () => {
    expect(() => validateInput({ type: 'boolean' }, true)).not.toThrow();
  });

  test('throws on wrong type boolean', () => {
    expect(() => validateInput({ type: 'boolean' }, 'true')).toThrow(
      'Expected boolean'
    );
  });

  test('passes valid object', () => {
    expect(() =>
      validateInput({ type: 'object', properties: {} }, {})
    ).not.toThrow();
  });

  test('throws on wrong type object', () => {
    expect(() =>
      validateInput({ type: 'object', properties: {} }, '[]')
    ).toThrow('Expected object');
  });

  test('passes valid array', () => {
    expect(() =>
      validateInput({ type: 'array', items: { type: 'string' } }, ['a', 'b'])
    ).not.toThrow();
  });

  test('throws on wrong type array', () => {
    expect(() => validateInput({ type: 'array', items: {} }, {})).toThrow(
      'Expected array'
    );
  });

  test('minLength throws', () => {
    expect(() => validateInput({ type: 'string', minLength: 3 }, 'ab')).toThrow(
      'too short'
    );
  });

  test('maxLength throws', () => {
    expect(() =>
      validateInput({ type: 'string', maxLength: 2 }, 'abcd')
    ).toThrow('too long');
  });

  test('minimum throws', () => {
    expect(() => validateInput({ type: 'number', minimum: 5 }, 3)).toThrow(
      'too small'
    );
  });

  test('maximum throws', () => {
    expect(() => validateInput({ type: 'number', maximum: 2 }, 5)).toThrow(
      'too large'
    );
  });

  test('pattern mismatch throws', () => {
    expect(() =>
      validateInput({ type: 'string', pattern: '^\\d+$' }, 'abc')
    ).toThrow('does not match');
  });

  test('pattern match passes', () => {
    expect(() =>
      validateInput({ type: 'string', pattern: '^\\d+$' }, '123')
    ).not.toThrow();
  });

  test('enum throws', () => {
    expect(() =>
      validateInput({ type: 'string', enum: ['a', 'b'] }, 'c')
    ).toThrow('must be one of');
  });

  test('enum passes', () => {
    expect(() =>
      validateInput({ type: 'string', enum: ['a', 'b'] }, 'a')
    ).not.toThrow();
  });

  test('missing required field throws', () => {
    expect(() =>
      validateInput(
        {
          type: 'object',
          properties: { x: { type: 'string' } },
          required: ['x'],
        },
        {}
      )
    ).toThrow('Missing required field: x');
  });

  test('unknown fields in object are validated but not rejected', () => {
    const schema = { type: 'object', properties: { x: { type: 'string' } } };
    expect(() => validateInput(schema, { x: 'a', extra: 1 })).not.toThrow();
  });

  test('nested object validation', () => {
    const schema = {
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: { inner: { type: 'string' } },
          required: ['inner'],
        },
      },
      required: ['outer'],
    };
    expect(() =>
      validateInput(schema, { outer: { inner: 'ok' } })
    ).not.toThrow();
    expect(() => validateInput(schema, { outer: {} })).toThrow(
      'Missing required field'
    );
  });

  test('throws on deep nesting', () => {
    const schema: Record<string, unknown> = {
      type: 'object' as const,
      properties: {},
    };
    let current: Record<string, unknown> = schema;
    for (let i = 1; i < 22; i++) {
      const next: Record<string, unknown> = {
        type: 'object' as const,
        properties: {},
      };
      current.properties = { n: next };
      current = next;
    }
    const input: Record<string, unknown> = {};
    let cur = input;
    for (let i = 0; i < 22; i++) {
      cur = cur.n = {} as Record<string, unknown>;
    }
    expect(() => validateInput(schema, input)).toThrow('nesting too deep');
  });
});

describe('stripUnknownFields', () => {
  test('keeps known fields', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    };
    expect(stripUnknownFields(schema, { a: 'x', b: 1 })).toEqual({
      a: 'x',
      b: 1,
    });
  });

  test('removes unknown fields', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(stripUnknownFields(schema, { a: 'x', b: 2 })).toEqual({ a: 'x' });
  });

  test('returns input unchanged for non-object', () => {
    expect(stripUnknownFields({ type: 'string' }, 'hello')).toBe('hello');
  });

  test('nested strip', () => {
    const schema = {
      type: 'object',
      properties: {
        outer: { type: 'object', properties: { inner: { type: 'string' } } },
      },
    };
    expect(
      stripUnknownFields(schema, { outer: { inner: 'x', extra: 1 } })
    ).toEqual({ outer: { inner: 'x' } });
  });
});

describe('settle', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  test('settle parses JSON string input', async () => {
    registry.register(
      mockTool({
        name: 'jstr',
        inputSchema: {
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
        },
      })
    );
    const mat = registry.materialize();
    const result = await mat.settle({
      sessionID: 's',
      agent: 'a',
      assistantMessageID: 'm',
      call: { name: 'jstr', input: JSON.stringify({ x: 1 }) },
    });
    expect(
      (result.result as unknown as { type: 'string'; value: string }).type
    ).toBe('json');
  });

  test('settle throws on invalid JSON', async () => {
    registry.register(mockTool({ name: 'badjson' }));
    const mat = registry.materialize();
    await expect(
      mat.settle({
        sessionID: 's',
        agent: 'a',
        assistantMessageID: 'm',
        call: { name: 'badjson', input: 'not-json' },
      })
    ).rejects.toThrow('Invalid JSON input');
  });

  test('settle bounds large result to 1MB', async () => {
    registry.register(
      makeTool({
        name: 'large',
        riskScore: 'LOW',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({
          result: { type: 'json', value: { data: 'x'.repeat(2_000_000) } },
        }),
      })
    );
    const mat = registry.materialize();
    const result = await mat.settle({
      sessionID: 's',
      agent: 'a',
      assistantMessageID: 'm',
      call: { name: 'large', input: {} },
    });
    expect(result.result).toEqual({
      type: 'truncated',
      originalSize: expect.any(Number),
    });
  });

  test('settle catches tool execution errors', async () => {
    registry.register(
      makeTool({
        name: 'crash',
        riskScore: 'LOW',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          throw new Error('boom');
        },
      })
    );
    const mat = registry.materialize();
    const result = await mat.settle({
      sessionID: 's',
      agent: 'a',
      assistantMessageID: 'm',
      call: { name: 'crash', input: {} },
    });
    expect(result.result).toEqual({ type: 'error', value: 'boom' });
  });

  test('settle passes context to tool', async () => {
    let captured: unknown;
    registry.register(
      makeTool({
        name: 'ctx',
        riskScore: 'LOW',
        inputSchema: { type: 'object', properties: {} },
        execute: async (input, ctx) => {
          captured = ctx;
          return { result: { type: 'json', value: {} } };
        },
      })
    );
    const mat = registry.materialize();
    await mat.settle({
      sessionID: 's',
      agent: 'a',
      assistantMessageID: 'm',
      call: { name: 'ctx', input: {} },
      worktreePath: '/tmp',
    });
    expect(captured).toMatchObject({ sessionID: 's', agent: 'a' });
  });
});
