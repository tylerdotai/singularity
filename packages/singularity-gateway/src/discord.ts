/**
 * Discord Adapter for Singularity Messaging Gateway
 *
 * Transport layer over singularity-core session system.
 * Does NOT fork a separate agent loop.
 *
 * Supports:
 * - Native Discord slash commands (registered via REST API)
 * - Text prefix commands (/start, /status, /ping, /help)
 * - Approval button interactions
 *
 * Slash commands:
 * /chat, /plan, /cancel, /sessions — agent & session
 * /skills [list|enable|disable] — skills
 * /memory [facts|sessions] — memory
 * /loops [run|list|status|cancel] — loop engine
 * /profile [current|list|use] — profiles
 * /gateway [status|channels] — gateway
 * /start, /status, /ping, /help — utility
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import {
  buildCommands,
  type CommandContextExt,
  type LoopRun,
  type Skill,
} from './commands.js';
import { type EngineRunner, GatewaySessionBridge } from './engine-bridge.js';
import type { Platform, PlatformAdapter } from './platform.js';
import type { SkillAuthoringService } from './skill-authoring.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLATFORM: Platform = 'discord';

// ---------------------------------------------------------------------------
// Module-scoped client reference (replaces globalThis hack)
// ---------------------------------------------------------------------------

let _discordClient: Client | null = null;

function getDiscordClient(): Client | null {
  return _discordClient;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DiscordMessage {
  channelId: string;
  threadId: string | null;
  text: string;
  source: Platform;
}

export interface ApprovalAction {
  type: 'approve' | 'deny';
  approvalId: string;
}

export interface Approval {
  id: string;
  label?: string;
}

export interface ReactionEvent {
  type: 'add' | 'remove';
  messageId: string;
  emoji: string;
  userId: string;
}

export interface DiscordAdapterOptions {
  allowedGuilds?: string[];
  allowedChannels?: string[];
  onMessage?: (msg: DiscordMessage) => void;
  onApprovalAction?: (action: ApprovalAction) => void;
  onTyping?: () => void;
  onReaction?: (event: ReactionEvent) => void;
  rateLimitTokens?: number;
  rateLimitWindow?: number;
  getSkillsList?: () => Promise<
    { name: string; description: string; status: string; version: string }[]
  >;
  enableSkill?: (name: string) => Promise<string>;
  disableSkill?: (name: string) => Promise<string>;
  getFacts?: (query?: string) => Promise<
    {
      id: string;
      subject: string;
      predicate: string;
      value: string;
      confidence: number;
    }[]
  >;
  getSessions?: (query?: string) => Promise<
    {
      id: string;
      title: string;
      status: string;
      source: string;
      startedAt: string;
    }[]
  >;
  runLoop?: (goal: string) => Promise<string>;
  listLoops?: () => Promise<
    {
      id: string;
      goal: string;
      status: string;
      iterations: number;
      stopReason: string;
    }[]
  >;
  getLoopStatus?: (id: string) => Promise<{
    id: string;
    goal: string;
    status: string;
    iterations: number;
    stopReason: string;
  } | null>;
  cancelLoop?: (id: string) => Promise<string>;
  getCurrentProfile?: () => Promise<{
    id: string;
    name: string;
    rootPath: string;
    isDefault: boolean;
  }>;
  listProfiles?: () => Promise<
    { id: string; name: string; rootPath: string; isDefault: boolean }[]
  >;
  useProfile?: (name: string) => Promise<string>;
  getGatewayStatus?: () => Promise<{
    platform: Platform;
    activeSessions: number;
    uptime: string;
    version: string;
  }>;
  listChannels?: () => Promise<
    { platform: Platform; name: string; active: boolean }[]
  >;
  getCurrentSession?: () => string | undefined;
  cancelSession?: (sessionId?: string) => Promise<string>;
  listSessions?: () => Promise<
    { id: string; status: string; platform: string }[]
  >;
  agentChat?: (message: string) => AsyncGenerator<string, void, unknown>;
  agentPlan?: (goal: string) => AsyncGenerator<string, void, unknown>;
  /** Wired engine runner — when provided, chat/plan use GatewaySessionBridge. */
  engineRunner?: EngineRunner;
  /** Skill authoring service for platform-triggered skill drafting. */
  skillAuthoringService?: SkillAuthoringService;
}

// ---------------------------------------------------------------------------
// DiscordAdapter
// ---------------------------------------------------------------------------

export class DiscordAdapterImpl implements PlatformAdapter {
  readonly platform: Platform = 'discord';
  readonly platformDisplayName = 'Discord';

  private readonly client: Client;
  private readonly sessionsByChannel = new Map<string, string>();
  private readonly channelIdBySession = new Map<string, string>();
  private readonly pendingApprovalIds = new Set<string>();

  constructor(token: string, options: DiscordAdapterOptions = {}) {
    this.client = this.createClient(token, options);
  }

  private createClient(token: string, options: DiscordAdapterOptions): Client {
    const self = this;
    const _rest = new REST({ version: '10' }).setToken(token);
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
      ],
    });

    _discordClient = client;

    const {
      allowedChannels,
      onMessage,
      onTyping,
      agentChat,
      agentPlan,
      engineRunner,
      skillAuthoringService,
      getGatewayStatus = async () => ({
        platform: PLATFORM,
        activeSessions: 0,
        uptime: '0s',
        version: '0.1.0',
      }),
      listSessions = async () => [],
      getCurrentSession = () => undefined,
      cancelSession = async (id) => `Session ${id ?? 'active'} cancelled`,
    } = options;

    let bridge: GatewaySessionBridge | undefined;
    if (engineRunner) {
      bridge = new GatewaySessionBridge({ engineRunner });
    }

    function _resolveApprovalViaBridge(action: ApprovalAction) {
      bridge?.resolveApproval(action.approvalId, action.type === 'approve');
      options.onApprovalAction?.(action);
    }

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await handleSlashCommand(interaction as any);
    });

    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      const text = message.content.trim();
      if (!text) return;

      const channelId = message.channel.id;
      if (
        allowedChannels &&
        allowedChannels.length > 0 &&
        !allowedChannels.includes(channelId)
      ) {
        return;
      }

      if (text.startsWith('/')) return;

      const attachments = message.attachments;
      if (attachments.size > 0 && !text) {
        const summary = attachments
          .map((a) => `${a.name ?? a.id} (${a.contentType ?? '?'})`)
          .join(', ');
        await message.reply(
          `[Singularity] Received ${attachments.size} attachment(s): ${summary}.\nAdd a caption to ask about them.`
        );
        return;
      }

      const threadId = message.channel.isThread() ? message.channel.id : null;

      onTyping?.();
      void message.channel.sendTyping().catch(() => {});

      onMessage?.({
        channelId: message.channel.id,
        threadId,
        text,
        source: PLATFORM,
      });

      if (bridge) {
        let sessionId = self.sessionsByChannel.get(channelId);
        if (!sessionId) {
          sessionId = `discord:${channelId}:${Date.now()}`;
          self.sessionsByChannel.set(channelId, sessionId);
          self.channelIdBySession.set(sessionId, channelId);
        }
        try {
          for await (const outgoing of bridge.receive(
            PLATFORM,
            channelId,
            threadId,
            text,
            sessionId
          )) {
            if (outgoing.approval) {
              const row = buildApprovalActionRow([
                { id: outgoing.approval.id, label: outgoing.approval.tool },
              ]);
              await message.reply({
                content: outgoing.text,
                components: [row],
              });
            } else if (outgoing.text) {
              await message.reply(outgoing.text);
            }
          }
        } catch (e: any) {
          await message.reply(
            `[Singularity] error: ${e?.message ?? 'engine failure'}`
          );
        }
      }
    });

    client.on(Events.MessageReactionAdd, (reaction) => {
      options.onReaction?.({
        type: 'add',
        messageId: reaction.message.id,
        emoji: reaction.emoji.name ?? '',
        userId: reaction.users.cache.first()?.id ?? '',
      });
    });

    client.on(Events.MessageReactionRemove, (reaction) => {
      options.onReaction?.({
        type: 'remove',
        messageId: reaction.message.id,
        emoji: reaction.emoji.name ?? '',
        userId: reaction.users.cache.first()?.id ?? '',
      });
    });

    async function handleSlashCommand(interaction: any): Promise<void> {
      if (!interaction.isChatInputCommand()) return;

      const name = interaction.commandName;
      const opts = interaction.options;
      const ctx: CommandContextExt = {
        platform: PLATFORM,
        chatId: interaction.channelId,
        threadId: interaction.channel?.isThread()
          ? interaction.channel.id
          : null,
        userId: interaction.user.id,
        skills: {
          list: (options.getSkillsList ?? (async () => [])) as () => Promise<
            Skill[]
          >,
          enable: options.enableSkill ?? (async (n) => `Skill ${n} enabled`),
          disable: options.disableSkill ?? (async (n) => `Skill ${n} disabled`),
        },
        memory: {
          facts: options.getFacts ?? (async () => []),
          sessions: options.getSessions ?? (async () => []),
        },
        loops: {
          run:
            options.runLoop ?? (async (g) => `Loop started: ${g.slice(0, 20)}`),
          list: (options.listLoops ?? (async () => [])) as () => Promise<
            LoopRun[]
          >,
          status: (options.getLoopStatus ?? (async () => null)) as (
            id: string
          ) => Promise<LoopRun | null>,
          cancel: options.cancelLoop ?? (async (id) => `Loop ${id} cancelled`),
        },
        profile: {
          current:
            options.getCurrentProfile ??
            (async () => ({
              id: 'default',
              name: 'default',
              rootPath: '~/.singularity',
              isDefault: true,
            })),
          list: options.listProfiles ?? (async () => []),
          use: options.useProfile ?? (async (n) => `Switched to ${n}`),
        },
        gateway: {
          status: getGatewayStatus,
          channels:
            options.listChannels ??
            (async () =>
              [] as { platform: 'discord'; name: string; active: boolean }[]),
        },
        session: {
          current: getCurrentSession,
          cancel: cancelSession,
          list: listSessions,
        },
        agent: {
          chat: agentChat ?? async function* () {},
          plan: agentPlan ?? async function* () {},
        },
        reply: async (text: string) => {
          await interaction.reply(text);
        },
      };

      const allCommands = buildCommands(ctx);

      if (name === 'chat') {
        const msg = opts.getString('message') ?? '';
        await interaction.reply('Thinking…');
        if (bridge) {
          const channelId = interaction.channelId;
          const threadId = interaction.channel?.isThread()
            ? interaction.channel.id
            : null;
          let sessionId = self.sessionsByChannel.get(channelId);
          if (!sessionId) {
            sessionId = `discord:${channelId}:${Date.now()}`;
            self.sessionsByChannel.set(channelId, sessionId);
            self.channelIdBySession.set(sessionId, channelId);
          }
          let streamed = false;
          for await (const outgoing of bridge.receive(
            PLATFORM,
            channelId,
            threadId ? threadId : null,
            msg,
            sessionId
          )) {
            streamed = true;
            if (outgoing.approval) {
              const row = buildApprovalActionRow([
                { id: outgoing.approval.id, label: outgoing.approval.tool },
              ]);
              await interaction.editReply({
                content: outgoing.text,
                components: [row],
              });
            } else if (outgoing.text) {
              await interaction.editReply(outgoing.text);
            }
          }
          if (!streamed) await interaction.editReply('(no response)');
        } else {
          let response = '';
          for await (const chunk of (agentChat ?? async function* () {})(msg)) {
            response += chunk;
          }
          if (response) await interaction.editReply(response);
          else await interaction.editReply('(no response)');
        }
        return;
      }

      if (name === 'plan') {
        const goal = opts.getString('goal') ?? '';
        await interaction.reply('Planning…');
        if (bridge) {
          const channelId = interaction.channelId;
          const threadId = interaction.channel?.isThread()
            ? interaction.channel.id
            : null;
          let sessionId = self.sessionsByChannel.get(channelId);
          if (!sessionId) {
            sessionId = `discord:${channelId}:${Date.now()}`;
            self.sessionsByChannel.set(channelId, sessionId);
            self.channelIdBySession.set(sessionId, channelId);
          }
          let streamed = false;
          for await (const outgoing of bridge.receive(
            PLATFORM,
            channelId,
            threadId ? threadId : null,
            `/steer ${goal}`,
            sessionId
          )) {
            streamed = true;
            if (outgoing.approval) {
              const row = buildApprovalActionRow([
                { id: outgoing.approval.id, label: outgoing.approval.tool },
              ]);
              await interaction.editReply({
                content: outgoing.text,
                components: [row],
              });
            } else if (outgoing.text) {
              await interaction.editReply(outgoing.text);
            }
          }
          if (!streamed) await interaction.editReply('(no response)');
        } else {
          let response = '';
          for await (const chunk of (agentPlan ?? async function* () {})(
            goal
          )) {
            response += chunk;
          }
          if (response) await interaction.editReply(response);
          else await interaction.editReply('(no response)');
        }
        return;
      }

      if (name === 'cancel') {
        const sessionId =
          opts.getString('session-id') ??
          self.sessionsByChannel.get(interaction.channelId);
        if (bridge && sessionId) {
          bridge.cancel(sessionId);
          self.sessionsByChannel.delete(interaction.channelId);
          await interaction.reply(`✅ Session cancelled.`);
        } else {
          const result = await cancelSession(sessionId);
          await interaction.reply(result);
        }
        return;
      }

      if (name === 'sessions') {
        const sessions = await listSessions();
        if (!sessions.length) {
          await interaction.reply('No active sessions.');
          return;
        }
        const lines = sessions.map(
          (s) => `• \`${s.id.slice(0, 8)}\` · ${s.status} · ${s.platform}`
        );
        await interaction.reply(`Active Sessions:\n${lines.join('\n')}`);
        return;
      }

      if (name === 'skills') {
        const action = opts.getString('action');
        const skillName = opts.getString('name');
        if (action === 'list') {
          const skills = await (options.getSkillsList ?? (async () => []))();
          if (!skills.length) {
            await interaction.reply('No skills registered.');
            return;
          }
          const lines = skills.map(
            (s) =>
              `• \`${s.name}\` (${s.version}) — ${s.status} — ${s.description}`
          );
          await interaction.reply(
            `Skills (${skills.length}):\n${lines.join('\n')}`
          );
          return;
        }
        if (action === 'enable' && skillName) {
          const result = await (
            options.enableSkill ?? (async (n) => `Skill ${n} enabled`)
          )(skillName);
          await interaction.reply(result);
          return;
        }
        if (action === 'disable' && skillName) {
          const result = await (
            options.disableSkill ?? (async (n) => `Skill ${n} disabled`)
          )(skillName);
          await interaction.reply(result);
          return;
        }
        await interaction.reply(
          'Usage: /skills [list | enable <name> | disable <name>]'
        );
        return;
      }

      if (name === 'memory') {
        const type = opts.getString('type');
        const query = opts.getString('query');
        if (type === 'facts') {
          const facts = await (options.getFacts ?? (async () => []))(
            query ?? undefined
          );
          if (!facts.length) {
            await interaction.reply('No facts found.');
            return;
          }
          const lines = facts
            .slice(0, 10)
            .map(
              (f) =>
                `• *${f.subject}* ${f.predicate} ${f.value} (${Math.round(f.confidence * 100)}%)`
            );
          await interaction.reply(`Facts:\n${lines.join('\n')}`);
          return;
        }
        if (type === 'sessions') {
          const sessions = await (options.getSessions ?? (async () => []))(
            query ?? undefined
          );
          if (!sessions.length) {
            await interaction.reply('No sessions found.');
            return;
          }
          const lines = sessions
            .slice(0, 10)
            .map(
              (s) =>
                `• \`${s.id.slice(0, 8)}\` · ${s.title} · ${s.status} · ${s.source}`
            );
          await interaction.reply(`Sessions:\n${lines.join('\n')}`);
          return;
        }
        await interaction.reply(
          'Usage: /memory [facts <query> | sessions <query>]'
        );
        return;
      }

      if (name === 'loops') {
        const action = opts.getString('action');
        const value = opts.getString('value');
        if (action === 'run' && value) {
          const result = await (
            options.runLoop ?? (async (g) => `Loop started: ${g.slice(0, 20)}`)
          )(value);
          await interaction.reply(result);
          return;
        }
        if (action === 'list') {
          const loops = await (options.listLoops ?? (async () => []))();
          if (!loops.length) {
            await interaction.reply('No active loops.');
            return;
          }
          const lines = loops.map(
            (l) =>
              `• \`${l.id.slice(0, 8)}\` · ${l.goal.slice(0, 30)} · ${l.status} · ${l.iterations} iters`
          );
          await interaction.reply(`Active Loops:\n${lines.join('\n')}`);
          return;
        }
        if (action === 'status' && value) {
          const loop = await (options.getLoopStatus ?? (async () => null))(
            value
          );
          if (!loop) {
            await interaction.reply(`Loop not found: ${value}`);
            return;
          }
          await interaction.reply(
            `Loop ${loop.id}\nGoal: ${loop.goal}\nStatus: ${loop.status}\nIterations: ${loop.iterations}\nStop: ${loop.stopReason}`
          );
          return;
        }
        if (action === 'cancel' && value) {
          const result = await (
            options.cancelLoop ?? (async (id) => `Loop ${id} cancelled`)
          )(value);
          await interaction.reply(result);
          return;
        }
        await interaction.reply(
          'Usage: /loops [run <goal> | list | status <id> | cancel <id>]'
        );
        return;
      }

      if (name === 'profile') {
        const action = opts.getString('action');
        const nameArg = opts.getString('name');
        if (action === 'current') {
          const profile = await (
            options.getCurrentProfile ??
            (async () => ({
              id: 'default',
              name: 'default',
              rootPath: '~/.singularity',
              isDefault: true,
            }))
          )();
          await interaction.reply(
            `Current Profile: ${profile.name} (${profile.id})\nRoot: ${profile.rootPath}\nDefault: ${profile.isDefault}`
          );
          return;
        }
        if (action === 'list') {
          const profiles = await (options.listProfiles ?? (async () => []))();
          if (!profiles.length) {
            await interaction.reply('No profiles found.');
            return;
          }
          const lines = profiles.map(
            (p) => `• ${p.name} (${p.id})${p.isDefault ? ' [default]' : ''}`
          );
          await interaction.reply(`Profiles:\n${lines.join('\n')}`);
          return;
        }
        if (action === 'use' && nameArg) {
          const result = await (
            options.useProfile ?? (async (n) => `Switched to ${n}`)
          )(nameArg);
          await interaction.reply(result);
          return;
        }
        await interaction.reply(
          'Usage: /profile [current | list | use <name>]'
        );
        return;
      }

      if (name === 'gateway') {
        const action = opts.getString('action');
        if (action === 'status') {
          const status = await getGatewayStatus();
          await interaction.reply(
            `Gateway Status\nPlatform: ${status.platform}\nActive Sessions: ${status.activeSessions}\nUptime: ${status.uptime}\nVersion: ${status.version}`
          );
          return;
        }
        if (action === 'channels') {
          const channels = await (options.listChannels ?? (async () => []))();
          if (!channels.length) {
            await interaction.reply('No channels configured.');
            return;
          }
          const lines = channels.map(
            (c) =>
              `• ${c.platform}:${c.name} (${c.active ? 'active' : 'inactive'})`
          );
          await interaction.reply(`Channels:\n${lines.join('\n')}`);
          return;
        }
        await interaction.reply('Usage: /gateway [status | channels]');
        return;
      }

      if (name === 'start') {
        await interaction.reply(
          'Welcome to Singularity! Use /chat <message> to talk to the agent.'
        );
        return;
      }

      if (name === 'status') {
        const sessionId = self.sessionsByChannel.get(interaction.channelId);
        if (sessionId && bridge) {
          await interaction.reply(`Active session: ${sessionId.slice(0, 8)}`);
        } else {
          await interaction.reply('No active session.');
        }
        return;
      }

      if (name === 'ping') {
        await interaction.reply('Pong!');
        return;
      }

      if (name === 'help') {
        const lines = allCommands.map((c) => `• /${c.name} — ${c.description}`);
        await interaction.reply(`Available Commands:\n${lines.join('\n')}`);
        return;
      }

      // Skill authoring commands
      if (name === 'draftskill') {
        const skillName = opts.getString('name') ?? '';
        const description =
          opts.getString('description') ??
          'Skill drafted from Discord conversation';
        if (!skillName) {
          await interaction.reply('Usage: /draftskill <name> [description]');
          return;
        }
        if (!skillAuthoringService) {
          await interaction.reply('Skill authoring service not configured.');
          return;
        }
        const channelId = interaction.channelId;
        const threadId = interaction.channel?.isThread()
          ? interaction.channel.id
          : null;
        const sessionId = `discord:${channelId}:${threadId ?? 'main'}`;
        try {
          const result = await skillAuthoringService.draftSkillFromChat(
            {
              platform: 'discord',
              chatId: channelId,
              sessionId,
              userId: interaction.user.id,
            },
            {
              skillName,
              sessionSummary: description,
              toolCallSummary: 'User described the skill in Discord chat',
              failuresAndFixes: 'N/A',
              verificationCommands: "echo 'Verify the skill works'",
            }
          );
          await interaction.reply(
            `✅ Skill draft created: *${result.skill.name}*\n\n\`\`\`\n${result.markdown}\n\`\`\`\n\nUse /approveskill ${result.skill.name} to register it.`
          );
        } catch (e: any) {
          await interaction.reply(
            `❌ Draft failed: ${e?.message ?? 'unknown error'}`
          );
        }
        return;
      }

      if (name === 'drafts') {
        if (!skillAuthoringService) {
          await interaction.reply('Skill authoring service not configured.');
          return;
        }
        const channelId = interaction.channelId;
        const threadId = interaction.channel?.isThread()
          ? interaction.channel.id
          : null;
        const sessionId = `discord:${channelId}:${threadId ?? 'main'}`;
        const drafts = skillAuthoringService.listPendingDrafts(sessionId);
        if (drafts.length === 0) {
          await interaction.reply('No pending skill drafts.');
          return;
        }
        const lines = drafts.map(
          (d) =>
            `• *${d.skillName}* (drafted ${new Date(d.draftedAt).toLocaleString()})`
        );
        await interaction.reply(`Pending drafts:\n${lines.join('\n')}`);
        return;
      }

      if (name === 'approveskill') {
        const skillName = opts.getString('name') ?? '';
        if (!skillName) {
          await interaction.reply('Usage: /approveskill <name>');
          return;
        }
        if (!skillAuthoringService) {
          await interaction.reply('Skill authoring service not configured.');
          return;
        }
        const channelId = interaction.channelId;
        const threadId = interaction.channel?.isThread()
          ? interaction.channel.id
          : null;
        const sessionId = `discord:${channelId}:${threadId ?? 'main'}`;
        try {
          skillAuthoringService.approveDraft(sessionId, skillName);
          await interaction.reply(
            `✅ Skill *${skillName}* approved and registered.`
          );
        } catch (e: any) {
          await interaction.reply(
            `❌ Approve failed: ${e?.message ?? 'unknown error'}`
          );
        }
        return;
      }

      if (name === 'discardskill') {
        const skillName = opts.getString('name') ?? '';
        if (!skillName) {
          await interaction.reply('Usage: /discardskill <name>');
          return;
        }
        if (!skillAuthoringService) {
          await interaction.reply('Skill authoring service not configured.');
          return;
        }
        const channelId = interaction.channelId;
        const threadId = interaction.channel?.isThread()
          ? interaction.channel.id
          : null;
        const sessionId = `discord:${channelId}:${threadId ?? 'main'}`;
        skillAuthoringService.discardDraft(sessionId, skillName);
        await interaction.reply(`Discarded draft: *${skillName}*`);
        return;
      }
    }

    return client;
  }

  async start(): Promise<void> {
    if (!this.client.token) {
      throw new Error('Discord client token is not available');
    }
    await this.client.login(this.client.token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  startSession(chatId: string, _source: Platform): string {
    const existingSessionId = this.sessionsByChannel.get(chatId);
    if (existingSessionId) {
      return existingSessionId;
    }
    const sessionId = `discord:${chatId}:${Date.now()}`;
    this.sessionsByChannel.set(chatId, sessionId);
    this.channelIdBySession.set(sessionId, chatId);
    return sessionId;
  }

  endSession(sessionId: string): void {
    const channelId = this.channelIdBySession.get(sessionId);
    if (channelId !== undefined) {
      this.sessionsByChannel.delete(channelId);
      this.channelIdBySession.delete(sessionId);
    }
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const channelId = this.channelIdBySession.get(sessionId);
    if (channelId === undefined) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const channel = this.client.channels.cache.get(channelId);
    if (channel && 'send' in channel) {
      await channel.send(text);
    }
  }

  async sendTypingIndicator(sessionId: string): Promise<void> {
    const channelId = this.channelIdBySession.get(sessionId);
    if (channelId === undefined) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const channel = this.client.channels.cache.get(channelId);
    if (channel && 'sendTyping' in channel) {
      await (channel as any).sendTyping();
    }
  }

  async sendApprovalRequest(
    _sessionId: string,
    _tool: string,
    _args: unknown
  ): Promise<string> {
    const approvalId = `approval:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.pendingApprovalIds.add(approvalId);
    return approvalId;
  }

  async approve(approvalId: string): Promise<void> {
    if (!this.pendingApprovalIds.has(approvalId)) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    this.pendingApprovalIds.delete(approvalId);
  }

  async deny(approvalId: string): Promise<void> {
    if (!this.pendingApprovalIds.has(approvalId)) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    this.pendingApprovalIds.delete(approvalId);
  }
}

// Keep interface for backwards compatibility
export interface DiscordAdapter extends PlatformAdapter {}

// ---------------------------------------------------------------------------
// Rate limiter (simple token bucket per user)
// ---------------------------------------------------------------------------

const rateLimits = new Map<string, { count: number; resetAt: number }>();

function _checkRateLimit(
  userId: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Command context builder
// ---------------------------------------------------------------------------

function _buildCmdCtx(
  msg: { channelId: string; threadId: string | null; userId?: string },
  opts: DiscordAdapterOptions
): CommandContextExt {
  return {
    platform: PLATFORM,
    chatId: msg.channelId,
    threadId: msg.threadId,
    userId: msg.userId,
    skills: {
      list: (opts.getSkillsList ?? (async () => [])) as () => Promise<Skill[]>,
      enable: opts.enableSkill ?? (async (n) => `Skill ${n} enabled`),
      disable: opts.disableSkill ?? (async (n) => `Skill ${n} disabled`),
    },
    memory: {
      facts: opts.getFacts ?? (async () => []),
      sessions: opts.getSessions ?? (async () => []),
    },
    loops: {
      run: opts.runLoop ?? (async (g) => `Loop started: ${g.slice(0, 20)}`),
      list: (opts.listLoops ?? (async () => [])) as () => Promise<LoopRun[]>,
      status: (opts.getLoopStatus ?? (async () => null)) as (
        id: string
      ) => Promise<LoopRun | null>,
      cancel: opts.cancelLoop ?? (async (id) => `Loop ${id} cancelled`),
    },
    profile: {
      current:
        opts.getCurrentProfile ??
        (async () => ({
          id: 'default',
          name: 'default',
          rootPath: '~/.singularity',
          isDefault: true,
        })),
      list: opts.listProfiles ?? (async () => []),
      use: opts.useProfile ?? (async (n) => `Switched to ${n}`),
    },
    gateway: {
      status:
        opts.getGatewayStatus ??
        (async () => ({
          platform: PLATFORM as 'discord',
          activeSessions: 0,
          uptime: '0s',
          version: '0.1.0',
        })),
      channels:
        opts.listChannels ??
        (async () =>
          [] as { platform: 'discord'; name: string; active: boolean }[]),
    },
    session: {
      current: opts.getCurrentSession ?? (() => undefined),
      cancel:
        opts.cancelSession ??
        (async (id) => `Session ${id ?? 'active'} cancelled`),
      list: opts.listSessions ?? (async () => []),
    },
    agent: {
      chat: opts.agentChat ?? async function* () {},
      plan: opts.agentPlan ?? async function* () {},
    },
    reply: async (text: string) => {
      const client = getDiscordClient();
      const channel = client?.channels?.cache?.get(msg.channelId) as
        | { send?: (text: string) => Promise<unknown> }
        | undefined;
      if (channel?.send) {
        await channel.send(text);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Build Discord slash command JSON
// ---------------------------------------------------------------------------

function _buildSlashCommands(): SlashCommandOptionsOnlyBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName('chat')
      .setDescription('Chat with the Singularity agent')
      .addStringOption((o) =>
        o.setName('message').setDescription('Message to send').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('plan')
      .setDescription('Run in plan mode (explain without executing)')
      .addStringOption((o) =>
        o.setName('goal').setDescription('Goal to plan for').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('cancel')
      .setDescription('Cancel the active or a specific session')
      .addStringOption((o) =>
        o
          .setName('session-id')
          .setDescription('Session ID to cancel')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('sessions')
      .setDescription('List active sessions'),
    new SlashCommandBuilder()
      .setName('skills')
      .setDescription('Manage skills')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Action')
          .setRequired(true)
          .addChoices(
            { name: 'list', value: 'list' },
            { name: 'enable', value: 'enable' },
            { name: 'disable', value: 'disable' }
          )
      )
      .addStringOption((o) =>
        o.setName('name').setDescription('Skill name').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('memory')
      .setDescription('Query memory')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Memory type')
          .setRequired(true)
          .addChoices(
            { name: 'facts', value: 'facts' },
            { name: 'sessions', value: 'sessions' }
          )
      )
      .addStringOption((o) =>
        o.setName('query').setDescription('Search query').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('loops')
      .setDescription('Manage closed-loop runs')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Action')
          .setRequired(true)
          .addChoices(
            { name: 'run', value: 'run' },
            { name: 'list', value: 'list' },
            { name: 'status', value: 'status' },
            { name: 'cancel', value: 'cancel' }
          )
      )
      .addStringOption((o) =>
        o.setName('value').setDescription('Goal or ID').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('Manage profiles')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Action')
          .setRequired(true)
          .addChoices(
            { name: 'current', value: 'current' },
            { name: 'list', value: 'list' },
            { name: 'use', value: 'use' }
          )
      )
      .addStringOption((o) =>
        o.setName('name').setDescription('Profile name').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('gateway')
      .setDescription('Gateway status and channels')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Action')
          .setRequired(false)
          .addChoices(
            { name: 'status', value: 'status' },
            { name: 'channels', value: 'channels' }
          )
      ),
    new SlashCommandBuilder()
      .setName('start')
      .setDescription('Welcome message'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Show gateway and session status'),
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Ping the gateway'),
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all commands'),
    new SlashCommandBuilder()
      .setName('draftskill')
      .setDescription('Draft a skill from this conversation')
      .addStringOption((o) =>
        o.setName('name').setDescription('Skill name').setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Skill description')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('drafts')
      .setDescription('List pending skill drafts'),
    new SlashCommandBuilder()
      .setName('approveskill')
      .setDescription('Approve a pending draft')
      .addStringOption((o) =>
        o.setName('name').setDescription('Skill name').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('discardskill')
      .setDescription('Discard a pending draft')
      .addStringOption((o) =>
        o.setName('name').setDescription('Skill name').setRequired(true)
      ),
  ];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createDiscordAdapter(
  token: string,
  options: DiscordAdapterOptions = {}
): DiscordAdapter {
  return new DiscordAdapterImpl(token, options);
}
// ---------------------------------------------------------------------------
// Outbound helpers
// ---------------------------------------------------------------------------

export function buildApprovalActionRow(
  approvals: Approval[]
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  approvals.forEach((approval) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`approval:approve:${approval.id}`)
        .setLabel(`✅ ${approval.label ?? 'Approve'}`)
        .setStyle(ButtonStyle.Success)
    );
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`approval:deny:${approval.id}`)
        .setLabel('❌ Deny')
        .setStyle(ButtonStyle.Danger)
    );
  });
  return row;
}
