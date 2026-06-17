/**
 * Telegram Adapter for Singularity Messaging Gateway
 *
 * Transport layer over singularity-core session system.
 * Does NOT fork a separate agent loop.
 *
 * Supports extensive slash commands:
 * /chat, /plan, /cancel, /sessions — agent & session
 * /skills [list|enable|disable] — skills
 * /memory [facts|sessions] — memory
 * /loops [run|list|status|cancel] — loop engine
 * /profile [current|list|use] — profiles
 * /gateway [status|channels] — gateway
 * /start, /status, /ping, /help — utility
 */

import { limit } from '@grammyjs/ratelimiter';
import { Bot, type Context, type SessionFlavor, session } from 'grammy';
import {
  buildCommands,
  type CommandContextExt,
  type LoopRun,
  parseCommand,
  type Skill,
} from './commands.js';
import { type EngineRunner, GatewaySessionBridge } from './engine-bridge.js';
import type { Platform, PlatformAdapter } from './platform.js';
import type { SkillAuthoringService } from './skill-authoring.js';

export const PLATFORM: Platform = 'telegram';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TelegramMessage {
  chatId: number;
  threadId: number | null;
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
  messageId: number;
  emoji: string;
  userId: number;
}

export interface TelegramAdapterOptions {
  allowedChats?: number[];
  onMessage?: (msg: TelegramMessage) => void;
  onApprovalAction?: (action: ApprovalAction) => void;
  onTyping?: () => void;
  onReaction?: (event: ReactionEvent) => void;
  rateLimitTokens?: number;
  rateLimitWindow?: number;
  // Command context providers
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

interface TelegramSession {
  source: Platform;
  sessionId: string | null;
  threadId: number | null;
  pendingApprovalId: string | null;
}

function initialSession(): TelegramSession {
  return {
    source: PLATFORM,
    sessionId: null,
    threadId: null,
    pendingApprovalId: null,
  };
}

type MyContext = Context & SessionFlavor<TelegramSession>;

// ---------------------------------------------------------------------------
// Inline keyboard button callback data prefixes
// ---------------------------------------------------------------------------

const APPROVE_CALLBACK_DATA = 'approval:approve:';
const DENY_CALLBACK_DATA = 'approval:deny:';

// ---------------------------------------------------------------------------
// TelegramAdapter
// ---------------------------------------------------------------------------

export class TelegramAdapter implements PlatformAdapter {
  readonly platform: Platform = 'telegram';
  readonly platformDisplayName = 'Telegram';

  private readonly bot: Bot<MyContext>;
  private readonly sessionsByChat = new Map<number, string>();
  private readonly chatIdBySession = new Map<string, number>();
  private readonly pendingApprovalIds = new Set<string>();

  constructor(botToken: string, options: TelegramAdapterOptions = {}) {
    this.bot = this.createBot(botToken, options);
  }

  private createBot(
    botToken: string,
    options: TelegramAdapterOptions
  ): Bot<MyContext> {
    const {
      allowedChats = [],
      onMessage,
      onApprovalAction,
      onTyping,
      rateLimitTokens = 20,
      rateLimitWindow = 60_000,
      getSkillsList = async (): Promise<Skill[]> => [],
      enableSkill = async (n) => `Skill ${n} enabled`,
      disableSkill = async (n) => `Skill ${n} disabled`,
      getFacts = async () => [],
      getSessions = async () => [],
      runLoop = async (g) => `Loop started: ${g.slice(0, 20)}`,
      listLoops = async (): Promise<LoopRun[]> => [],
      getLoopStatus = async (): Promise<LoopRun | null> => null,
      cancelLoop = async (id) => `Loop ${id} cancelled`,
      getCurrentProfile = async () => ({
        id: 'default',
        name: 'default',
        rootPath: '~/.singularity',
        isDefault: true,
      }),
      listProfiles = async () => [],
      useProfile = async (n) => `Switched to profile ${n}`,
      getGatewayStatus = async () => ({
        platform: PLATFORM,
        activeSessions: 0,
        uptime: '0s',
        version: '0.1.0',
      }),
      listChannels = async () => [],
      getCurrentSession = () => undefined,
      cancelSession = async (id) => `Session ${id ?? 'active'} cancelled`,
      listSessions = async () => [],
      agentChat,
      agentPlan,
      engineRunner,
    } = options;

    let bridge: GatewaySessionBridge | undefined;
    if (engineRunner) {
      bridge = new GatewaySessionBridge({ engineRunner });
    }

    function resolveApprovalViaBridge(action: ApprovalAction) {
      bridge?.resolveApproval(action.approvalId, action.type === 'approve');
      onApprovalAction?.(action);
    }

    const bot = new Bot<MyContext>(botToken);

    function buildCmdCtx(ctx: MyContext): CommandContextExt {
      const chatId = ctx.chat?.id ?? 0;
      const threadId = ctx.message?.message_thread_id ?? null;
      return {
        platform: PLATFORM,
        chatId,
        threadId,
        skills: {
          list: getSkillsList as unknown as () => Promise<Skill[]>,
          enable: enableSkill,
          disable: disableSkill,
        },
        memory: {
          facts: getFacts,
          sessions: getSessions,
        },
        loops: {
          run: runLoop,
          list: listLoops as unknown as () => Promise<LoopRun[]>,
          status: getLoopStatus as unknown as (
            id: string
          ) => Promise<LoopRun | null>,
          cancel: cancelLoop,
        },
        profile: {
          current: getCurrentProfile,
          list: listProfiles,
          use: useProfile,
        },
        gateway: {
          status: getGatewayStatus,
          channels: listChannels,
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
          await ctx.reply(text);
        },
        replyMarkdown: async (text: string) => {
          await ctx.reply(text, { parse_mode: 'Markdown' });
        },
      };
    }

    const commands = buildCommands(buildCmdCtx({} as unknown as MyContext));
    const cmdMap = new Map<string, (typeof commands)[0]>();
    for (const cmd of commands) {
      cmdMap.set(cmd.name, cmd);
      for (const alias of cmd.aliases ?? []) {
        cmdMap.set(alias, cmd);
      }
    }
    const commandsWithHelp = buildCommands(
      buildCmdCtx({} as unknown as MyContext)
    );

    bot.use(
      limit({
        limit: rateLimitTokens,
        timeFrame: rateLimitWindow,
      })
    );

    bot.use(
      session({
        initial: initialSession,
        getSessionKey: (ctx: Context) => {
          const chat = ctx.chat?.id;
          const thread = ctx.message?.message_thread_id ?? null;
          if (!chat) return undefined;
          return `telegram:${chat}:${thread}`;
        },
      })
    );

    bot.use(async (ctx, next) => {
      if (
        allowedChats.length > 0 &&
        ctx.chat &&
        !allowedChats.includes(ctx.chat.id)
      ) {
        await ctx.reply('⛔ Unauthorized chat.');
        return;
      }
      await next();
    });

    for (const cmd of commandsWithHelp) {
      bot.command(cmd.name, async (ctx) => {
        const text = ctx.message?.text ?? '';
        const { args } = parseCommand(text);
        const extCtx = buildCmdCtx(ctx);
        const allCmds = buildCommands(extCtx);
        await (
          cmd.handler as (
            ctx: typeof extCtx,
            args: string[],
            cmds: typeof allCmds
          ) => void
        )(extCtx, args, allCmds);
      });
      for (const alias of cmd.aliases ?? []) {
        bot.command(alias, async (ctx) => {
          const text = ctx.message?.text ?? '';
          const { args } = parseCommand(text);
          const extCtx = buildCmdCtx(ctx);
          await (cmd.handler as (ctx: typeof extCtx, args: string[]) => void)(
            extCtx,
            args
          );
        });
      }
    }

    bot.command('chat', async (ctx) => {
      if (!ctx.message) return;
      const text = ctx.message.text;
      const args = text.split(' ').slice(1).join(' ');
      if (!args) {
        await ctx.reply('Usage: /chat <message>');
        return;
      }
      const chatId = ctx.chat?.id ?? 0;
      const threadId = ctx.message.message_thread_id ?? null;
      onTyping?.();
      await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

      if (bridge) {
        let sessionId = this.sessionsByChat.get(chatId);
        if (!sessionId) {
          sessionId = `telegram:${chatId}:${Date.now()}`;
          this.sessionsByChat.set(chatId, sessionId);
          this.chatIdBySession.set(sessionId, chatId);
        }
        let streamed = false;
        for await (const msg of bridge.receive(
          PLATFORM,
          chatId,
          threadId,
          args,
          sessionId
        )) {
          streamed = true;
          if (msg.approval) {
            const keyboard = buildApprovalKeyboard([
              { id: msg.approval.id, label: msg.approval.tool },
            ]);
            await ctx.reply(msg.text, { reply_markup: keyboard });
          } else if (msg.text) {
            await ctx.reply(msg.text);
          }
        }
        if (!streamed) await ctx.reply('(no response)');
      } else if (agentChat) {
        let response = '';
        for await (const chunk of agentChat(args)) {
          response += chunk;
        }
        if (response) await ctx.reply(response);
      } else {
        onMessage?.({ chatId, threadId, text: args, source: PLATFORM });
        await ctx.reply('[Session forwarded to engine]');
      }
    });

    bot.command('plan', async (ctx) => {
      if (!ctx.message) return;
      const text = ctx.message.text;
      const args = text.split(' ').slice(1).join(' ');
      if (!args) {
        await ctx.reply('Usage: /plan <goal>');
        return;
      }
      const chatId = ctx.chat?.id ?? 0;
      const threadId = ctx.message.message_thread_id ?? null;
      onTyping?.();
      await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

      if (bridge) {
        let sessionId = this.sessionsByChat.get(chatId);
        if (!sessionId) {
          sessionId = `telegram:${chatId}:${Date.now()}`;
          this.sessionsByChat.set(chatId, sessionId);
          this.chatIdBySession.set(sessionId, chatId);
        }
        let streamed = false;
        for await (const msg of bridge.receive(
          PLATFORM,
          chatId,
          threadId,
          `/steer ${args}`,
          sessionId
        )) {
          streamed = true;
          if (msg.approval) {
            const keyboard = buildApprovalKeyboard([
              { id: msg.approval.id, label: msg.approval.tool },
            ]);
            await ctx.reply(msg.text, { reply_markup: keyboard });
          } else if (msg.text) {
            await ctx.reply(msg.text);
          }
        }
        if (!streamed) await ctx.reply('(no response)');
      } else if (agentPlan) {
        let response = '';
        for await (const chunk of agentPlan(args)) {
          response += chunk;
        }
        if (response) await ctx.reply(response);
      } else {
        onMessage?.({
          chatId,
          threadId,
          text: `/steer ${args}`,
          source: PLATFORM,
        });
        await ctx.reply('[Plan mode forwarded to engine]');
      }
    });

    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text ?? '';
      const chatId = ctx.chat?.id ?? 0;
      const threadId = ctx.message.message_thread_id ?? null;

      if (!text || !chatId) return;
      if (text.startsWith('/')) return;

      ctx.session.threadId = threadId;

      onTyping?.();
      await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

      onMessage?.({ chatId, threadId, text, source: PLATFORM });

      if (bridge) {
        let sessionId = this.sessionsByChat.get(chatId);
        if (!sessionId) {
          sessionId = `telegram:${chatId}:${Date.now()}`;
          this.sessionsByChat.set(chatId, sessionId);
          this.chatIdBySession.set(sessionId, chatId);
          await Bun.write('/tmp/sing-debug.log', `[${new Date().toISOString()}] NEW SESSION: ${sessionId} for chat ${chatId}\n`, { append: true });
        } else {
          await Bun.write('/tmp/sing-debug.log', `[${new Date().toISOString()}] EXISTING SESSION: ${sessionId} for chat ${chatId}\n`, { append: true });
        }
        let streamed = false;
        let msgCount = 0;
        try {
          await Bun.write('/tmp/sing-debug.log', `[${new Date().toISOString()}] Calling bridge.receive with text: "${text.slice(0, 50)}"\n`, { append: true });
          for await (const msg of bridge.receive(
            PLATFORM,
            chatId,
            threadId,
            text,
            sessionId
          )) {
            msgCount++;
            await Bun.write('/tmp/sing-debug.log', `[${new Date().toISOString()}] MSG[${msgCount}] text="${msg.text?.slice(0,80)}" approval=${!!msg.approval} result=${!!(msg as any).result}\n`, { append: true });
            streamed = true;
            if (msg.approval) {
              const keyboard = buildApprovalKeyboard([
                { id: msg.approval.id, label: msg.approval.tool },
              ]);
              await ctx.reply(msg.text, { reply_markup: keyboard });
            } else if (msg.text) {
              await ctx.reply(msg.text);
            }
          }
          await Bun.write('/tmp/sing-debug.log', `[${new Date().toISOString()}] bridge.receive done, ${msgCount} messages, streamed=${streamed}\n`, { append: true });
        } catch (e: any) {
          await Bun.write('/tmp/sing-debug.log', `[${new Date().toISOString()}] ERROR: ${e?.message}\n`, { append: true });
          await ctx.reply(
            `[Singularity] error: ${e?.message ?? 'engine failure'}`,
          );
        }
        if (!streamed) await ctx.reply('(no response)');
      } else {
        await ctx.reply(
          `[Singularity] Received: ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}\n` +
            `Use /chat <message> for a full response.`
        );
      }
    });

    bot.on('message:photo', async (ctx) => {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const caption = ctx.message.caption ?? '';
      if (caption) {
        await ctx.reply(
          `[Singularity] Photo + caption received. Caption: "${caption.slice(0, 100)}".\nSend a text message to chat about it.`
        );
      } else {
        await ctx.reply(
          `[Singularity] Photo received (file_id: ${largest.file_id}). Add a caption to ask about it.`
        );
      }
    });

    bot.on('message:document', async (ctx) => {
      const doc = ctx.message.document;
      const caption = ctx.message.caption ?? '';
      if (caption) {
        await ctx.reply(
          `[Singularity] Document "${doc.file_name ?? '?'}" + caption: "${caption.slice(0, 100)}".`
        );
      } else {
        await ctx.reply(
          `[Singularity] Document received (file_id: ${doc.file_id}, name: ${doc.file_name}). Add a caption to describe what to do with it.`
        );
      }
    });

    bot.on('message:voice', async (ctx) => {
      const voice = ctx.message.voice;
      const caption = ctx.message.caption ?? '';
      if (caption) {
        await ctx.reply(
          `[Singularity] Voice (${voice.duration}s) + caption: "${caption.slice(0, 100)}".`
        );
      } else {
        await ctx.reply(
          `[Singularity] Voice message received (duration: ${voice.duration}s). Add a caption describing what to do with it.`
        );
      }
    });

    bot.on('message:video', async (ctx) => {
      const video = ctx.message.video;
      const caption = ctx.message.caption ?? '';
      if (caption) {
        await ctx.reply(
          `[Singularity] Video (${video.duration}s) + caption: "${caption.slice(0, 100)}".`
        );
      } else {
        await ctx.reply(
          `[Singularity] Video received (file_id: ${video.file_id}). Add a caption to describe what to do with it.`
        );
      }
    });

    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!data) return;

      if (data.startsWith(APPROVE_CALLBACK_DATA)) {
        const approvalId = data.slice(APPROVE_CALLBACK_DATA.length);
        ctx.session.pendingApprovalId = approvalId;
        this.pendingApprovalIds.add(approvalId);
        resolveApprovalViaBridge({ type: 'approve', approvalId });
        await ctx.answerCallbackQuery({ text: `✅ Approved: ${approvalId}` });
        await ctx.reply(`✅ Approval granted for \`${approvalId}\``, {
          parse_mode: 'Markdown',
        });
      } else if (data.startsWith(DENY_CALLBACK_DATA)) {
        const approvalId = data.slice(DENY_CALLBACK_DATA.length);
        ctx.session.pendingApprovalId = approvalId;
        this.pendingApprovalIds.add(approvalId);
        resolveApprovalViaBridge({ type: 'deny', approvalId });
        await ctx.answerCallbackQuery({ text: `❌ Denied: ${approvalId}` });
        await ctx.reply(`❌ Approval denied for \`${approvalId}\``, {
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.answerCallbackQuery({ text: 'Unknown action.' });
      }
    });

    bot.command('approve', async (ctx) => {
      if (!ctx.message) return;
      const args = ctx.message.text.split(' ').slice(1);
      const approvalId = args[0];
      if (!approvalId) {
        await ctx.reply('Usage: /approve <approval-id>');
        return;
      }
      ctx.session.pendingApprovalId = approvalId;
      this.pendingApprovalIds.add(approvalId);
      resolveApprovalViaBridge({ type: 'approve', approvalId });
      await ctx.reply(`✅ Approval granted for \`${approvalId}\``, {
        parse_mode: 'Markdown',
      });
    });

    bot.command('deny', async (ctx) => {
      if (!ctx.message) return;
      const args = ctx.message.text.split(' ').slice(1);
      const approvalId = args[0];
      if (!approvalId) {
        await ctx.reply('Usage: /deny <approval-id>');
        return;
      }
      ctx.session.pendingApprovalId = approvalId;
      this.pendingApprovalIds.add(approvalId);
      resolveApprovalViaBridge({ type: 'deny', approvalId });
      await ctx.reply(`❌ Approval denied for \`${approvalId}\``, {
        parse_mode: 'Markdown',
      });
    });

    return bot;
  }

  async start(): Promise<void> {
    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  startSession(chatId: string, _source: Platform): string {
    const numericChatId = Number.parseInt(chatId, 10);
    if (Number.isNaN(numericChatId)) {
      throw new Error(`Invalid chatId: ${chatId}`);
    }
    const existingSessionId = this.sessionsByChat.get(numericChatId);
    if (existingSessionId) {
      return existingSessionId;
    }
    const sessionId = `telegram:${numericChatId}:${Date.now()}`;
    this.sessionsByChat.set(numericChatId, sessionId);
    this.chatIdBySession.set(sessionId, numericChatId);
    return sessionId;
  }

  endSession(sessionId: string): void {
    const chatId = this.chatIdBySession.get(sessionId);
    if (chatId !== undefined) {
      this.sessionsByChat.delete(chatId);
      this.chatIdBySession.delete(sessionId);
    }
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const chatId = this.chatIdBySession.get(sessionId);
    if (chatId === undefined) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    await this.bot.api.sendMessage(chatId, text);
  }

  async sendTypingIndicator(sessionId: string): Promise<void> {
    const chatId = this.chatIdBySession.get(sessionId);
    if (chatId === undefined) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    await this.bot.api.sendChatAction(chatId, 'typing');
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

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createTelegramAdapter(
  botToken: string,
  options: TelegramAdapterOptions = {}
): TelegramAdapter {
  const {
    allowedChats = [],
    onMessage,
    onApprovalAction,
    onTyping,
    rateLimitTokens = 20,
    rateLimitWindow = 60_000,
    getSkillsList = async (): Promise<Skill[]> => [],
    enableSkill = async (n) => `Skill ${n} enabled`,
    disableSkill = async (n) => `Skill ${n} disabled`,
    getFacts = async () => [],
    getSessions = async () => [],
    runLoop = async (g) => `Loop started: ${g.slice(0, 20)}`,
    listLoops = async (): Promise<LoopRun[]> => [],
    getLoopStatus = async (): Promise<LoopRun | null> => null,
    cancelLoop = async (id) => `Loop ${id} cancelled`,
    getCurrentProfile = async () => ({
      id: 'default',
      name: 'default',
      rootPath: '~/.singularity',
      isDefault: true,
    }),
    listProfiles = async () => [],
    useProfile = async (n) => `Switched to profile ${n}`,
    getGatewayStatus = async () => ({
      platform: PLATFORM,
      activeSessions: 0,
      uptime: '0s',
      version: '0.1.0',
    }),
    listChannels = async () => [],
    getCurrentSession = () => undefined,
    cancelSession = async (id) => `Session ${id ?? 'active'} cancelled`,
    listSessions = async () => [],
    agentChat,
    agentPlan,
    engineRunner,
    skillAuthoringService,
  } = options;

  // Session bridge — created when engineRunner is provided
  let bridge: GatewaySessionBridge | undefined;
  if (engineRunner) {
    bridge = new GatewaySessionBridge({ engineRunner });
  }

  // When platform resolves an approval, wake the suspended engine via bridge
  function resolveApprovalViaBridge(action: ApprovalAction) {
    bridge?.resolveApproval(action.approvalId, action.type === 'approve');
    onApprovalAction?.(action);
  }

  // Per-chatId session registry
  const sessionsByChat = new Map<number, string>();

  const bot = new Bot<MyContext>(botToken);

  // Build command context helper
  function buildCmdCtx(ctx: MyContext): CommandContextExt {
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message?.message_thread_id ?? null;
    return {
      platform: PLATFORM,
      chatId,
      threadId,
      skills: {
        list: getSkillsList as unknown as () => Promise<Skill[]>,
        enable: enableSkill,
        disable: disableSkill,
      },
      memory: {
        facts: getFacts,
        sessions: getSessions,
      },
      loops: {
        run: runLoop,
        list: listLoops as unknown as () => Promise<LoopRun[]>,
        status: getLoopStatus as unknown as (
          id: string
        ) => Promise<LoopRun | null>,
        cancel: cancelLoop,
      },
      profile: {
        current: getCurrentProfile,
        list: listProfiles,
        use: useProfile,
      },
      gateway: {
        status: getGatewayStatus,
        channels: listChannels,
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
        await ctx.reply(text);
      },
      replyMarkdown: async (text: string) => {
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    };
  }

  // Build all commands
  const commands = buildCommands(buildCmdCtx({} as unknown as MyContext));

  // Build command map for /help and lookup
  const cmdMap = new Map<string, (typeof commands)[0]>();
  for (const cmd of commands) {
    cmdMap.set(cmd.name, cmd);
    for (const alias of cmd.aliases ?? []) {
      cmdMap.set(alias, cmd);
    }
  }

  // Rebuild with proper closure for help command
  const commandsWithHelp = buildCommands(
    buildCmdCtx({} as unknown as MyContext)
  );

  // Rate limiting middleware
  bot.use(
    limit({
      limit: rateLimitTokens,
      timeFrame: rateLimitWindow,
    })
  );

  // Session middleware
  bot.use(
    session({
      initial: initialSession,
      getSessionKey: (ctx: Context) => {
        const chat = ctx.chat?.id;
        const thread = ctx.message?.message_thread_id ?? null;
        if (!chat) return undefined;
        return `telegram:${chat}:${thread}`;
      },
    })
  );

  // Channel authorization middleware
  bot.use(async (ctx, next) => {
    if (
      allowedChats.length > 0 &&
      ctx.chat &&
      !allowedChats.includes(ctx.chat.id)
    ) {
      await ctx.reply('⛔ Unauthorized chat.');
      return;
    }
    await next();
  });

  // -------------------------------------------------------------------------
  // Command registration (grammy auto-builds /commands menu from these)
  // -------------------------------------------------------------------------

  for (const cmd of commandsWithHelp) {
    bot.command(cmd.name, async (ctx) => {
      const text = ctx.message?.text ?? '';
      const { args } = parseCommand(text);
      const extCtx = buildCmdCtx(ctx);
      // Rebuild commands list with this ctx for /help
      const allCmds = buildCommands(extCtx);
      await (
        cmd.handler as (
          ctx: typeof extCtx,
          args: string[],
          cmds: typeof allCmds
        ) => void
      )(extCtx, args, allCmds);
    });
    for (const alias of cmd.aliases ?? []) {
      bot.command(alias, async (ctx) => {
        const text = ctx.message?.text ?? '';
        const { args } = parseCommand(text);
        const extCtx = buildCmdCtx(ctx);
        await (cmd.handler as (ctx: typeof extCtx, args: string[]) => void)(
          extCtx,
          args
        );
      });
    }
  }

  // -------------------------------------------------------------------------
  // Agent commands (/chat, /plan) — route to engine
  // -------------------------------------------------------------------------

  bot.command('chat', async (ctx) => {
    if (!ctx.message) return;
    const text = ctx.message.text;
    const args = text.split(' ').slice(1).join(' ');
    if (!args) {
      await ctx.reply('Usage: /chat <message>');
      return;
    }
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;
    onTyping?.();
    await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

    if (bridge) {
      // Use GatewaySessionBridge → SessionRunner
      let sessionId = sessionsByChat.get(chatId);
      if (!sessionId) {
        sessionId = `telegram:${chatId}:${Date.now()}`;
        sessionsByChat.set(chatId, sessionId);
      }
      let streamed = false;
      for await (const msg of bridge.receive(
        PLATFORM,
        chatId,
        threadId,
        args,
        sessionId
      )) {
        streamed = true;
        if (msg.approval) {
          const keyboard = buildApprovalKeyboard([
            { id: msg.approval.id, label: msg.approval.tool },
          ]);
          await ctx.reply(msg.text, { reply_markup: keyboard });
        } else if (msg.text) {
          await ctx.reply(msg.text);
        }
      }
      if (!streamed) await ctx.reply('(no response)');
    } else if (agentChat) {
      let response = '';
      for await (const chunk of agentChat(args)) {
        response += chunk;
      }
      if (response) await ctx.reply(response);
    } else {
      onMessage?.({ chatId, threadId, text: args, source: PLATFORM });
      await ctx.reply('[Session forwarded to engine]');
    }
  });

  bot.command('plan', async (ctx) => {
    if (!ctx.message) return;
    const text = ctx.message.text;
    const args = text.split(' ').slice(1).join(' ');
    if (!args) {
      await ctx.reply('Usage: /plan <goal>');
      return;
    }
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;
    onTyping?.();
    await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

    if (bridge) {
      let sessionId = sessionsByChat.get(chatId);
      if (!sessionId) {
        sessionId = `telegram:${chatId}:${Date.now()}`;
        sessionsByChat.set(chatId, sessionId);
      }
      let streamed = false;
      for await (const msg of bridge.receive(
        PLATFORM,
        chatId,
        threadId,
        `/steer ${args}`,
        sessionId
      )) {
        streamed = true;
        if (msg.approval) {
          const keyboard = buildApprovalKeyboard([
            { id: msg.approval.id, label: msg.approval.tool },
          ]);
          await ctx.reply(msg.text, { reply_markup: keyboard });
        } else if (msg.text) {
          await ctx.reply(msg.text);
        }
      }
      if (!streamed) await ctx.reply('(no response)');
    } else if (agentPlan) {
      let response = '';
      for await (const chunk of agentPlan(args)) {
        response += chunk;
      }
      if (response) await ctx.reply(response);
    } else {
      onMessage?.({
        chatId,
        threadId,
        text: `/steer ${args}`,
        source: PLATFORM,
      });
      await ctx.reply('[Plan mode forwarded to engine]');
    }
  });

  // -------------------------------------------------------------------------
  // Generic text → forward to agent (non-command messages)
  // -------------------------------------------------------------------------

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;

    if (!text || !chatId) return;

    // Skip if it was already handled by a command handler
    if (text.startsWith('/')) return;

    ctx.session.threadId = threadId;

    onTyping?.();
    await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});

    onMessage?.({ chatId, threadId, text, source: PLATFORM });

    if (bridge) {
      let sessionId = sessionsByChat.get(chatId);
      if (!sessionId) {
        sessionId = `telegram:${chatId}:${Date.now()}`;
        sessionsByChat.set(chatId, sessionId);
      }
      let streamed = false;
      try {
        for await (const msg of bridge.receive(
          PLATFORM,
          chatId,
          threadId,
          text,
          sessionId
        )) {
          streamed = true;
          if (msg.approval) {
            const keyboard = buildApprovalKeyboard([
              { id: msg.approval.id, label: msg.approval.tool },
            ]);
            await ctx.reply(msg.text, { reply_markup: keyboard });
          } else if (msg.text) {
            await ctx.reply(msg.text);
          }
        }
      } catch (e: any) {
        await ctx.reply(
          `[Singularity] error: ${e?.message ?? 'engine failure'}`
        );
      }
      if (!streamed) await ctx.reply('(no response)');
    } else {
      await ctx.reply(
        `[Singularity] Received: ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}\n` +
          `Use /chat <message> for a full response.`
      );
    }
  });

  // -------------------------------------------------------------------------
  // File/media attachment ingestion
  // -------------------------------------------------------------------------

  bot.on('message:photo', async (ctx) => {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const caption = ctx.message.caption ?? '';
    if (caption) {
      await ctx.reply(
        `[Singularity] Photo + caption received. Caption: "${caption.slice(0, 100)}".\nSend a text message to chat about it.`
      );
    } else {
      await ctx.reply(
        `[Singularity] Photo received (file_id: ${largest.file_id}). Add a caption to ask about it.`
      );
    }
  });

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const caption = ctx.message.caption ?? '';
    if (caption) {
      await ctx.reply(
        `[Singularity] Document "${doc.file_name ?? '?'}" + caption: "${caption.slice(0, 100)}".\nSend a text message to chat about it.`
      );
    } else {
      await ctx.reply(
        `[Singularity] Document received (file_id: ${doc.file_id}, name: ${doc.file_name}). Add a caption to describe what to do with it.`
      );
    }
  });

  bot.on('message:voice', async (ctx) => {
    const voice = ctx.message.voice;
    const caption = ctx.message.caption ?? '';
    if (caption) {
      await ctx.reply(
        `[Singularity] Voice (${voice.duration}s) + caption: "${caption.slice(0, 100)}".\nSend a text message to chat about it.`
      );
    } else {
      await ctx.reply(
        `[Singularity] Voice message received (duration: ${voice.duration}s). Add a caption describing what to do with it.`
      );
    }
  });

  bot.on('message:video', async (ctx) => {
    const video = ctx.message.video;
    const caption = ctx.message.caption ?? '';
    if (caption) {
      await ctx.reply(
        `[Singularity] Video (${video.duration}s) + caption: "${caption.slice(0, 100)}".\nSend a text message to chat about it.`
      );
    } else {
      await ctx.reply(
        `[Singularity] Video received (file_id: ${video.file_id}). Add a caption to describe what to do with it.`
      );
    }
  });

  // -------------------------------------------------------------------------
  // Approval button interactions
  // -------------------------------------------------------------------------

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;

    if (data.startsWith(APPROVE_CALLBACK_DATA)) {
      const approvalId = data.slice(APPROVE_CALLBACK_DATA.length);
      ctx.session.pendingApprovalId = approvalId;
      resolveApprovalViaBridge({ type: 'approve', approvalId });
      await ctx.answerCallbackQuery({ text: `✅ Approved: ${approvalId}` });
      await ctx.reply(`✅ Approval granted for \`${approvalId}\``, {
        parse_mode: 'Markdown',
      });
    } else if (data.startsWith(DENY_CALLBACK_DATA)) {
      const approvalId = data.slice(DENY_CALLBACK_DATA.length);
      ctx.session.pendingApprovalId = approvalId;
      resolveApprovalViaBridge({ type: 'deny', approvalId });
      await ctx.answerCallbackQuery({ text: `❌ Denied: ${approvalId}` });
      await ctx.reply(`❌ Approval denied for \`${approvalId}\``, {
        parse_mode: 'Markdown',
      });
    } else {
      await ctx.answerCallbackQuery({ text: 'Unknown action.' });
    }
  });

  bot.command('approve', async (ctx) => {
    if (!ctx.message) return;
    const args = ctx.message.text.split(' ').slice(1);
    const approvalId = args[0];
    if (!approvalId) {
      await ctx.reply('Usage: /approve <approval-id>');
      return;
    }
    ctx.session.pendingApprovalId = approvalId;
    resolveApprovalViaBridge({ type: 'approve', approvalId });
    await ctx.reply(`✅ Approval granted for \`${approvalId}\``, {
      parse_mode: 'Markdown',
    });
  });

  bot.command('deny', async (ctx) => {
    if (!ctx.message) return;
    const args = ctx.message.text.split(' ').slice(1);
    const approvalId = args[0];
    if (!approvalId) {
      await ctx.reply('Usage: /deny <approval-id>');
      return;
    }
    ctx.session.pendingApprovalId = approvalId;
    resolveApprovalViaBridge({ type: 'deny', approvalId });
    await ctx.reply(`❌ Approval denied for \`${approvalId}\``, {
      parse_mode: 'Markdown',
    });
  });

  // -------------------------------------------------------------------------
  // Skill authoring commands (/draftskill, /drafts, /approveskill, /discardskill)
  // -------------------------------------------------------------------------

  bot.command('draftskill', async (ctx) => {
    if (!ctx.message) return;
    const text = ctx.message.text;
    const parts = text.split(' ').slice(1);
    const name = parts[0];
    const description = parts.slice(1).join(' ');
    if (!name) {
      await ctx.reply('Usage: /draftskill <name> <description>');
      return;
    }
    if (!skillAuthoringService) {
      await ctx.reply('Skill authoring service not configured.');
      return;
    }
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;
    const sessionId = `telegram:${chatId}:${threadId ?? 'main'}`;
    try {
      const result = await skillAuthoringService.draftSkillFromChat(
        {
          platform: 'telegram',
          chatId: String(chatId),
          sessionId,
          userId: String(ctx.from?.id),
        },
        {
          skillName: name,
          sessionSummary:
            description || 'Skill drafted from Telegram conversation',
          toolCallSummary: 'User described the skill in chat',
          failuresAndFixes: 'N/A',
          verificationCommands: "echo 'Verify the skill works'",
        }
      );
      await ctx.reply(
        `✅ Skill draft created: *${result.skill.name}*

\`\`\`
${result.markdown}
\`\`\`

Use /approveskill ${result.skill.name} to register it.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e: any) {
      await ctx.reply(`❌ Draft failed: ${e?.message ?? 'unknown error'}`);
    }
  });

  bot.command('drafts', async (ctx) => {
    if (!ctx.message) return;
    if (!skillAuthoringService) {
      await ctx.reply('Skill authoring service not configured.');
      return;
    }
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;
    const sessionId = `telegram:${chatId}:${threadId ?? 'main'}`;
    const drafts = skillAuthoringService.listPendingDrafts(sessionId);
    if (drafts.length === 0) {
      await ctx.reply('No pending skill drafts.');
      return;
    }
    const lines = drafts.map(
      (d) =>
        `• *${d.skillName}* (drafted ${new Date(d.draftedAt).toLocaleString()})`
    );
    await ctx.reply(
      `Pending drafts:
${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('approveskill', async (ctx) => {
    if (!ctx.message) return;
    if (!skillAuthoringService) {
      await ctx.reply('Skill authoring service not configured.');
      return;
    }
    const args = ctx.message.text.split(' ').slice(1);
    const name = args[0];
    if (!name) {
      await ctx.reply('Usage: /approveskill <name>');
      return;
    }
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;
    const sessionId = `telegram:${chatId}:${threadId ?? 'main'}`;
    try {
      skillAuthoringService.approveDraft(sessionId, name);
      await ctx.reply(`✅ Skill *${name}* approved and registered.`, {
        parse_mode: 'Markdown',
      });
    } catch (e: any) {
      await ctx.reply(`❌ Approve failed: ${e?.message ?? 'unknown error'}`);
    }
  });

  bot.command('discardskill', async (ctx) => {
    if (!ctx.message) return;
    if (!skillAuthoringService) {
      await ctx.reply('Skill authoring service not configured.');
      return;
    }
    const args = ctx.message.text.split(' ').slice(1);
    const name = args[0];
    if (!name) {
      await ctx.reply('Usage: /discardskill <name>');
      return;
    }
    const chatId = ctx.chat?.id ?? 0;
    const threadId = ctx.message.message_thread_id ?? null;
    const sessionId = `telegram:${chatId}:${threadId ?? 'main'}`;
    skillAuthoringService.discardDraft(sessionId, name);
    await ctx.reply(`Discarded draft: *${name}*`, { parse_mode: 'Markdown' });
  });

  return new TelegramAdapter(botToken, options);
}

// ---------------------------------------------------------------------------
// Outbound message helpers
// ---------------------------------------------------------------------------

export function buildApprovalKeyboard(approvals: Approval[]): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  const rows = approvals.map((approval) => {
    const approveData = `${APPROVE_CALLBACK_DATA}${approval.id}`;
    const denyData = `${DENY_CALLBACK_DATA}${approval.id}`;
    return [
      { text: `✅ ${approval.label ?? 'Approve'}`, callback_data: approveData },
      { text: `❌ Deny`, callback_data: denyData },
    ];
  });
  return { inline_keyboard: rows };
}

// ---------------------------------------------------------------------------
// Telegram Bot API command list (for /setcommands)
// ---------------------------------------------------------------------------

export function telegramBotCommands(): Array<{
  command: string;
  description: string;
}> {
  return [
    { command: 'chat', description: 'Chat with the agent' },
    {
      command: 'plan',
      description: 'Run in plan mode (explain without executing)',
    },
    { command: 'cancel', description: 'Cancel the active session' },
    { command: 'sessions', description: 'List active sessions' },
    {
      command: 'skills',
      description: 'Manage skills: list | enable <name> | disable <name>',
    },
    {
      command: 'memory',
      description: 'Query memory: facts [query] | sessions [query]',
    },
    {
      command: 'loops',
      description:
        'Manage loops: run <goal> | list | status <id> | cancel <id>',
    },
    {
      command: 'profile',
      description: 'Manage profiles: current | list | use <name>',
    },
    { command: 'gateway', description: 'Gateway: status | channels' },
    { command: 'start', description: 'Welcome message' },
    { command: 'status', description: 'Show gateway and session status' },
    { command: 'ping', description: 'Ping the gateway' },
    { command: 'approve', description: 'Approve an action by ID' },
    { command: 'deny', description: 'Deny an action by ID' },
    { command: 'help', description: 'Show all commands' },
    {
      command: 'draftskill',
      description: 'Draft a skill: draftskill <name> <description>',
    },
    { command: 'drafts', description: 'List pending skill drafts' },
    {
      command: 'approveskill',
      description: 'Approve a pending draft: approveskill <name>',
    },
    {
      command: 'discardskill',
      description: 'Discard a draft: discardskill <name>',
    },
  ];
}
