import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('todo tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./todo.js');
    expect(TOOL.name).toBe('todo');
    expect(TOOL.riskScore).toBe('LOW');
    expect(TOOL.approvalRequired).toBe(false);
  });

  test('lists todos', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute({ action: 'list' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as { todos: unknown[] };
    expect(Array.isArray(val.todos)).toBe(true);
  });

  test('creates todo with text', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute(
      { action: 'create', text: 'Buy groceries' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      todos: Array<{ id: string; text: string; status: string }>;
    };
    expect(val.todos[0].text).toBe('Buy groceries');
    expect(val.todos[0].status).toBe('pending');
  });

  test('returns error when creating without text', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute({ action: 'create' }, CTX);
    expect(result.result.type).toBe('error');
  });

  test('completes todo with id', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute(
      { action: 'complete', id: 'todo_123' },
      CTX
    );
    expect(result.result.type).toBe('json');
  });

  test('returns error when completing without id', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute({ action: 'complete' }, CTX);
    expect(result.result.type).toBe('error');
  });

  test('deletes todo with id', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute(
      { action: 'delete', id: 'todo_123' },
      CTX
    );
    expect(result.result.type).toBe('json');
  });

  test('returns error when deleting without id', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute({ action: 'delete' }, CTX);
    expect(result.result.type).toBe('error');
  });

  test('returns error for unknown action', async () => {
    const { TOOL } = await import('./todo.js');
    const result = await TOOL.execute(
      { action: 'unknown' as 'create', text: 'test' },
      CTX
    );
    expect(result.result.type).toBe('error');
  });
});
