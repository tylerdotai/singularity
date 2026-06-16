import { expect, test } from 'bun:test';
import { buildCommands, formatHelp, parseCommand } from './commands.js';

const STUB_REPLY = async (_text: string) => {};
const STUB_CHAT = async function* (_m: string): AsyncGenerator<string> {};
const STUB_PLAN = async function* (_g: string): AsyncGenerator<string> {};

const makeCtx = () => ({
  platform: 'telegram' as const,
  chatId: 1,
  threadId: null,
  skills: {
    list: async () => [],
    enable: async (n: string) => n,
    disable: async (n: string) => n,
  },
  memory: { facts: async () => [], sessions: async () => [] },
  loops: {
    run: async (g: string) => g,
    list: async () => [],
    status: async () => null,
    cancel: async (id: string) => id,
  },
  profile: {
    current: async () => ({
      id: 'p1',
      name: 'default',
      rootPath: '~/.singularity',
      isDefault: true,
    }),
    list: async () => [],
    use: async (n: string) => n,
  },
  gateway: {
    status: async () => ({
      platform: 'telegram' as const,
      activeSessions: 0,
      uptime: '0s',
      version: '0.1.0',
    }),
    channels: async () => [],
  },
  session: {
    current: () => undefined,
    cancel: async () => 'cancelled',
    list: async () => [],
  },
  agent: { chat: STUB_CHAT, plan: STUB_PLAN },
  reply: STUB_REPLY,
});

test('parseCommand strips leading slash and lowercases', () => {
  expect(parseCommand('/CHAT hello world')).toEqual({
    cmd: 'chat',
    args: ['hello', 'world'],
  });
});

test('parseCommand handles no args', () => {
  expect(parseCommand('/sessions')).toEqual({ cmd: 'sessions', args: [] });
});

test('parseCommand handles text without slash', () => {
  expect(parseCommand('help me')).toEqual({ cmd: 'help', args: ['me'] });
});

test('parseCommand trims whitespace', () => {
  expect(parseCommand('  /plan   goal with spaces  ')).toEqual({
    cmd: 'plan',
    args: ['goal', 'with', 'spaces'],
  });
});

test('parseCommand empty string', () => {
  expect(parseCommand('')).toEqual({ cmd: '', args: [] });
});

test('formatHelp groups agent and system commands', () => {
  const ctx = makeCtx();
  const cmds = buildCommands(ctx);
  const help = formatHelp(cmds);
  expect(help).toContain('Agent Commands');
  expect(help).toContain('System Commands');
  expect(help).toContain('/chat');
  expect(help).toContain('/skills');
});

test('buildCommands returns 13 commands', () => {
  const ctx = makeCtx();
  const cmds = buildCommands(ctx);
  expect(cmds.length).toBe(13);
});

test('buildCommands splits agent vs system', () => {
  const ctx = makeCtx();
  const cmds = buildCommands(ctx);
  const agent = cmds.filter((c) => c.type === 'agent');
  const system = cmds.filter((c) => c.type === 'system');
  expect(agent.length).toBeGreaterThan(0);
  expect(system.length).toBeGreaterThan(0);
});

test('buildCommands includes all required names', () => {
  const ctx = makeCtx();
  const names = buildCommands(ctx).map((c) => c.name);
  expect(names).toContain('chat');
  expect(names).toContain('plan');
  expect(names).toContain('cancel');
  expect(names).toContain('sessions');
  expect(names).toContain('skills');
  expect(names).toContain('memory');
  expect(names).toContain('loops');
  expect(names).toContain('profile');
  expect(names).toContain('gateway');
  expect(names).toContain('start');
  expect(names).toContain('status');
  expect(names).toContain('ping');
  expect(names).toContain('help');
});

test('skills command has enable and disable subactions', () => {
  const ctx = makeCtx();
  const skillsCmd = buildCommands(ctx).find((c) => c.name === 'skills');
  expect(skillsCmd).toBeDefined();
  expect(skillsCmd?.usage).toBe('[list | enable <name> | disable <name>]');
});

test('memory command has facts and sessions subactions', () => {
  const ctx = makeCtx();
  const memoryCmd = buildCommands(ctx).find((c) => c.name === 'memory');
  expect(memoryCmd).toBeDefined();
  expect(memoryCmd?.usage).toBe('[facts <query> | sessions <query>]');
});

test('loops command has run, list, status, cancel subactions', () => {
  const ctx = makeCtx();
  const loopsCmd = buildCommands(ctx).find((c) => c.name === 'loops');
  expect(loopsCmd).toBeDefined();
  expect(loopsCmd?.usage).toBe(
    '[run <goal> | list | status <id> | cancel <id>]'
  );
});

test('profile command has current, list, use subactions', () => {
  const ctx = makeCtx();
  const profileCmd = buildCommands(ctx).find((c) => c.name === 'profile');
  expect(profileCmd).toBeDefined();
  expect(profileCmd?.usage).toBe('[current | list | use <name>]');
});

test('gateway command has status and channels subactions', () => {
  const ctx = makeCtx();
  const gatewayCmd = buildCommands(ctx).find((c) => c.name === 'gateway');
  expect(gatewayCmd).toBeDefined();
  expect(gatewayCmd?.usage).toBe('[status | channels]');
});
