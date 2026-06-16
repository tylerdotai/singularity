/**
 * Shared command definitions for Telegram and Discord adapters.
 *
 * All slash/prefix commands are declared here in one place.
 * Each platform's adapter registers the commands it supports and
 * routes matching messages through the appropriate handler.
 *
 * Commands are split into two categories:
 * - Agent commands: routed through the SessionRunner (chat, plan)
 * - System commands: handled directly (skills, memory, loops, profile, gateway, cancel)
 */

import type { Platform } from './platform.js';

export interface Skill {
  name: string;
  description: string;
  status: 'active' | 'disabled' | 'pending';
  version: string;
}

export interface MemoryFact {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
}

export interface MemorySession {
  id: string;
  title: string;
  status: string;
  source: string;
  startedAt: string;
}

export interface LoopRun {
  id: string;
  goal: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  iterations: number;
  stopReason: string;
}

export interface GatewayStatus {
  platform: Platform;
  activeSessions: number;
  uptime: string;
  version: string;
}

export interface Profile {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
}

// ─── Command context ──────────────────────────────────────────────────────────

export interface CommandContext {
  platform: Platform;
  chatId: number | string;
  threadId: number | string | null;
  userId?: number | string;
  reply: (text: string, opts?: Record<string, unknown>) => Promise<void>;
  replyMarkdown?: (text: string) => Promise<void>;
}

// ─── Command handler types ────────────────────────────────────────────────────

export type AgentCommandHandler = (
  ctx: CommandContextExt,
  args: string[]
) => Promise<void>;
export type SystemCommandHandler = (
  ctx: CommandContextExt,
  args?: string[]
) => Promise<void>;

// ─── Command definition ────────────────────────────────────────────────────────

export interface CommandDef {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  /** Agent commands route through SessionRunner. System commands handle directly. */
  type: 'agent' | 'system';
  handler: AgentCommandHandler | SystemCommandHandler;
}

export interface CommandContextExt {
  platform: Platform;
  chatId: number | string;
  threadId: number | string | null;
  userId?: number | string;
  skills: {
    list: () => Promise<Skill[]>;
    enable: (name: string) => Promise<string>;
    disable: (name: string) => Promise<string>;
  };
  memory: {
    facts: (query?: string) => Promise<MemoryFact[]>;
    sessions: (query?: string) => Promise<MemorySession[]>;
  };
  loops: {
    run: (goal: string) => Promise<string>;
    list: () => Promise<LoopRun[]>;
    status: (id: string) => Promise<LoopRun | null>;
    cancel: (id: string) => Promise<string>;
  };
  profile: {
    current: () => Promise<Profile>;
    list: () => Promise<Profile[]>;
    use: (name: string) => Promise<string>;
  };
  gateway: {
    status: () => Promise<GatewayStatus>;
    channels: () => Promise<
      { platform: Platform; name: string; active: boolean }[]
    >;
  };
  session: {
    current: () => string | undefined;
    cancel: (sessionId?: string) => Promise<string>;
    list: () => Promise<{ id: string; status: string; platform: string }[]>;
  };
  agent: {
    chat: (message: string) => AsyncGenerator<string, void, unknown>;
    plan: (goal: string) => AsyncGenerator<string, void, unknown>;
  };
  reply: (text: string, opts?: Record<string, unknown>) => Promise<void>;
  replyMarkdown?: (text: string) => Promise<void>;
}

// ─── Command parsers ─────────────────────────────────────────────────────────

export function parseCommand(text: string): { cmd: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase().replace(/^\//, '') ?? '';
  const args = parts.slice(1);
  return { cmd, args };
}

export function formatHelp(commands: CommandDef[]): string {
  const lines = ['📖 *Available Commands*\n'];
  const agent = commands.filter((c) => c.type === 'agent');
  const system = commands.filter((c) => c.type === 'system');
  if (agent.length) {
    lines.push('*Agent Commands*');
    for (const c of agent) {
      lines.push(
        `  /${c.name}${c.usage ? ` ${c.usage}` : ''} — ${c.description}`
      );
    }
    lines.push('');
  }
  if (system.length) {
    lines.push('*System Commands*');
    for (const c of system) {
      lines.push(
        `  /${c.name}${c.usage ? ` ${c.usage}` : ''} — ${c.description}`
      );
    }
    lines.push('');
  }
  lines.push('Send /help to show this message.');
  return lines.join('\n');
}

// ─── Default commands ────────────────────────────────────────────────────────

export function buildCommands(_ctx: CommandContextExt): CommandDef[] {
  return [
    // ── Agent commands ────────────────────────────────────────────────────
    {
      name: 'chat',
      description: 'Chat with the Singularity agent',
      usage: '<message>',
      type: 'agent',
      async handler(_ctx: CommandContextExt, args: string[]) {
        const msg = args.join(' ');
        if (!msg) {
          await _ctx.reply('Usage: /chat <message>');
          return;
        }
        let response = '';
        for await (const chunk of _ctx.agent.chat(msg)) {
          response += chunk;
        }
        if (response) await _ctx.reply(response);
        else await _ctx.reply('(no response)');
      },
    },
    {
      name: 'plan',
      description: 'Run the agent in plan mode (explain without executing)',
      usage: '<goal>',
      type: 'agent',
      async handler(_ctx: CommandContextExt, args: string[]) {
        const goal = args.join(' ');
        if (!goal) {
          await _ctx.reply('Usage: /plan <goal>');
          return;
        }
        let response = '';
        for await (const chunk of _ctx.agent.plan(goal)) {
          response += chunk;
        }
        if (response) await _ctx.reply(response);
        else await _ctx.reply('(no response)');
      },
    },
    // ── Session commands ───────────────────────────────────────────────────
    {
      name: 'cancel',
      description: 'Cancel the active or a specific session',
      usage: '[session-id]',
      type: 'system',
      aliases: ['stop'],
      async handler(_ctx: CommandContextExt, args: string[]) {
        const sessionId = args[0] ?? _ctx.session.current();
        if (!sessionId) {
          await _ctx.reply('No active session to cancel.');
          return;
        }
        const result = await _ctx.session.cancel(sessionId);
        await _ctx.reply(result);
      },
    },
    {
      name: 'sessions',
      description: 'List active sessions',
      type: 'system',
      aliases: ['session'],
      async handler(_ctx: CommandContextExt) {
        const sessions = await _ctx.session.list();
        if (!sessions.length) {
          await _ctx.reply('No active sessions.');
          return;
        }
        const lines = sessions.map(
          (s: { id: string; status: string; platform: string }) =>
            `• \`${s.id.slice(0, 8)}\` · ${s.status} · ${s.platform}`
        );
        await _ctx.reply(`Active Sessions:\n${lines.join('\n')}`);
      },
    },
    // ── Skills commands ─────────────────────────────────────────────────────
    {
      name: 'skills',
      description: 'Manage and list skills',
      usage: '[list | enable <name> | disable <name>]',
      type: 'system',
      async handler(_ctx: CommandContextExt, args: string[]) {
        const sub = args[0];
        if (!sub || sub === 'list') {
          const skills = await _ctx.skills.list();
          if (!skills.length) {
            await _ctx.reply('No skills registered.');
            return;
          }
          const lines = skills.map(
            (s: Skill) =>
              `• \`${s.name}\` (${s.version}) — ${s.status} — ${s.description}`
          );
          await _ctx.reply(`Skills (${skills.length}):\n${lines.join('\n')}`);
          return;
        }
        if (sub === 'enable') {
          const name = args[1];
          if (!name) {
            await _ctx.reply('Usage: /skills enable <name>');
            return;
          }
          const result = await _ctx.skills.enable(name);
          await _ctx.reply(result);
          return;
        }
        if (sub === 'disable') {
          const name = args[1];
          if (!name) {
            await _ctx.reply('Usage: /skills disable <name>');
            return;
          }
          const result = await _ctx.skills.disable(name);
          await _ctx.reply(result);
          return;
        }
        await _ctx.reply(
          'Usage: /skills [list | enable <name> | disable <name>]'
        );
      },
    },
    // ── Memory commands ─────────────────────────────────────────────────────
    {
      name: 'memory',
      description: 'Query memory (facts and sessions)',
      usage: '[facts <query> | sessions <query>]',
      type: 'system',
      aliases: ['mem'],
      async handler(_ctx: CommandContextExt, args: string[]) {
        const sub = args[0];
        if (sub === 'facts' || sub === 'fact') {
          const query = args.slice(1).join(' ');
          const facts = await _ctx.memory.facts(query || undefined);
          if (!facts.length) {
            await _ctx.reply('No facts found.');
            return;
          }
          const lines = facts
            .slice(0, 10)
            .map(
              (f: MemoryFact) =>
                `• *${f.subject}* ${f.predicate} ${f.value} (${Math.round(f.confidence * 100)}%)`
            );
          const more =
            facts.length > 10 ? `\n… and ${facts.length - 10} more` : '';
          await _ctx.reply(`Facts:\n${lines.join('\n')}${more}`);
          return;
        }
        if (sub === 'sessions' || sub === 'session') {
          const query = args.slice(1).join(' ');
          const sessions = await _ctx.memory.sessions(query || undefined);
          if (!sessions.length) {
            await _ctx.reply('No sessions found.');
            return;
          }
          const lines = sessions
            .slice(0, 10)
            .map(
              (s: MemorySession) =>
                `• \`${s.id.slice(0, 8)}\` ${s.title} [${s.status}] ${s.source}`
            );
          const more =
            sessions.length > 10 ? `\n… and ${sessions.length - 10} more` : '';
          await _ctx.reply(`Sessions:\n${lines.join('\n')}${more}`);
          return;
        }
        await _ctx.reply(
          'Usage:\n/memory facts [query]\n/memory sessions [query]'
        );
      },
    },
    // ── Loop commands ───────────────────────────────────────────────────────
    {
      name: 'loops',
      description: 'Manage closed-loop runs',
      usage: '[run <goal> | list | status <id> | cancel <id>]',
      type: 'system',
      aliases: ['loop'],
      async handler(_ctx: CommandContextExt, args: string[]) {
        const sub = args[0];
        if (!sub) {
          await _ctx.reply(
            'Usage:\n/loops run <goal>\n/loops list\n/loops status <id>\n/loops cancel <id>'
          );
          return;
        }
        if (sub === 'run') {
          const goal = args.slice(1).join(' ');
          if (!goal) {
            await _ctx.reply('Usage: /loops run <goal>');
            return;
          }
          const id = await _ctx.loops.run(goal);
          await _ctx.reply(`✅ Loop started: \`${id}\``);
          return;
        }
        if (sub === 'list') {
          const runs = await _ctx.loops.list();
          if (!runs.length) {
            await _ctx.reply('No active loops.');
            return;
          }
          const lines = runs.map(
            (r: LoopRun) =>
              `• \`${r.id.slice(0, 8)}\` — ${r.status} — ${r.iterations} iterations — ${r.goal.slice(0, 40)}`
          );
          await _ctx.reply(
            `Active Loops (${runs.length}):\n${lines.join('\n')}`
          );
          return;
        }
        if (sub === 'status') {
          const id = args[1];
          if (!id) {
            await _ctx.reply('Usage: /loops status <id>');
            return;
          }
          const run = await _ctx.loops.status(id);
          if (!run) {
            await _ctx.reply(`Loop \`${id}\` not found.`);
            return;
          }
          await _ctx.reply(
            `Loop ${run.id}\nGoal: ${run.goal}\nStatus: ${run.status}\nIterations: ${run.iterations}\nStop: ${run.stopReason}`
          );
          return;
        }
        if (sub === 'cancel') {
          const id = args[1];
          if (!id) {
            await _ctx.reply('Usage: /loops cancel <id>');
            return;
          }
          const result = await _ctx.loops.cancel(id);
          await _ctx.reply(result);
          return;
        }
        await _ctx.reply(
          'Usage:\n/loops run <goal>\n/loops list\n/loops status <id>\n/loops cancel <id>'
        );
      },
    },
    // ── Profile commands ────────────────────────────────────────────────────
    {
      name: 'profile',
      description: 'Manage profiles',
      usage: '[current | list | use <name>]',
      type: 'system',
      aliases: ['prof'],
      async handler(_ctx: CommandContextExt, args: string[]) {
        const sub = args[0];
        if (!sub || sub === 'current') {
          const p = await _ctx.profile.current();
          await _ctx.reply(
            `Current Profile:\n• Name: ${p.name}\n• ID: \`${p.id}\`\n• Root: ${p.rootPath}${p.isDefault ? ' (default)' : ''}`
          );
          return;
        }
        if (sub === 'list') {
          const profiles = await _ctx.profile.list();
          const lines = profiles.map(
            (p: { name: string; isDefault: boolean; id: string }) =>
              `• ${p.name}${p.isDefault ? ' (default)' : ''} — \`${p.id}\``
          );
          await _ctx.reply(`Profiles:\n${lines.join('\n')}`);
          return;
        }
        if (sub === 'use') {
          const name = args[1];
          if (!name) {
            await _ctx.reply('Usage: /profile use <name>');
            return;
          }
          const result = await _ctx.profile.use(name);
          await _ctx.reply(result);
          return;
        }
        await _ctx.reply('Usage: /profile [current | list | use <name>]');
      },
    },
    // ── Gateway commands ────────────────────────────────────────────────────
    {
      name: 'gateway',
      description: 'Gateway status and channels',
      usage: '[status | channels]',
      type: 'system',
      async handler(_ctx: CommandContextExt, args: string[]) {
        const sub = args[0];
        if (!sub || sub === 'status') {
          const status = await _ctx.gateway.status();
          await _ctx.reply(
            `Gateway Status\nPlatform: ${status.platform}\nSessions: ${status.activeSessions}\nUptime: ${status.uptime}\nVersion: ${status.version}`
          );
          return;
        }
        if (sub === 'channels') {
          const channels = await _ctx.gateway.channels();
          if (!channels.length) {
            await _ctx.reply('No gateway channels configured.');
            return;
          }
          const lines = channels.map(
            (c: { platform: string; name: string; active: boolean }) =>
              `• ${c.platform}: ${c.name} [${c.active ? 'active' : 'inactive'}]`
          );
          await _ctx.reply(`Channels:\n${lines.join('\n')}`);
          return;
        }
        await _ctx.reply('Usage: /gateway [status | channels]');
      },
    },
    // ── Utility commands ────────────────────────────────────────────────────
    {
      name: 'start',
      description: 'Start a new session',
      type: 'system',
      async handler(_ctx: CommandContextExt, _args: string[]) {
        const sessions = await _ctx.session.list();
        const status = await _ctx.gateway.status();
        await _ctx.reply(
          `👋 *Singularity Gateway*\n\nPlatform: ${status.platform}\nSessions: ${sessions.length} active\nVersion: ${status.version}\n\nType /chat <message> to start a conversation.`
        );
      },
    },
    {
      name: 'status',
      description: 'Show gateway and session status',
      type: 'system',
      async handler(_ctx: CommandContextExt, _args: string[]) {
        const gStatus = await _ctx.gateway.status();
        const _sessions = await _ctx.session.list();
        const current = _ctx.session.current();
        await _ctx.reply(
          `Gateway\nPlatform: ${gStatus.platform}\nSessions: ${gStatus.activeSessions}\nUptime: ${gStatus.uptime}\n\nActive Session: ${current ? `\`${current.slice(0, 8)}\`` : 'none'}`
        );
      },
    },
    {
      name: 'ping',
      description: 'Ping the gateway',
      type: 'system',
      async handler(_ctx: CommandContextExt, _args: string[]) {
        const before = Date.now();
        const status = await _ctx.gateway.status();
        const latency = `${Date.now() - before}ms`;
        await _ctx.reply(
          `🏓 Pong!\nGateway: ${status.platform} (${latency})\nVersion: ${status.version}`
        );
      },
    },
    {
      name: 'help',
      description: 'Show this help message',
      type: 'system',
      async handler(_ctx: CommandContextExt, _args: string[]) {
        await _ctx.reply(formatHelp(buildCommands(_ctx)));
      },
    },
  ];
}
