import type { Interface as ReadlineInterface } from 'node:readline';
import { validateStartup } from 'singularity-config';
import type { Activity } from 'singularity-engine';
import { SessionRunner } from 'singularity-engine';
import { createEngineDeps } from './engine-deps.js';
import { openDefaultProfile } from './profile-context.js';
// Singularity CLI — argument parser and command runner
import { runInteractiveSetup } from './setup.js';

// ─── In-process session and loop registries ───────────────────────────────────

interface CliSession {
  id: string;
  label: string;
  startedAt: number;
  abort: AbortController;
}

class SessionRegistry {
  private readonly byId = new Map<string, CliSession>();
  private counter = 0;

  add(label: string, abort: AbortController): CliSession {
    this.counter++;
    const id = `cli:session:${this.counter}:${Date.now()}`;
    const s: CliSession = { id, label, startedAt: Date.now(), abort };
    this.byId.set(id, s);
    return s;
  }
  get(id: string): CliSession | undefined {
    return this.byId.get(id);
  }
  remove(id: string): void {
    this.byId.delete(id);
  }
  list(): CliSession[] {
    return Array.from(this.byId.values());
  }
  get lastActive(): CliSession | undefined {
    const all = this.list();
    return all.length > 0 ? all[all.length - 1] : undefined;
  }
}

interface LoopRecord {
  id: string;
  goal: string;
  startedAt: number;
  abort: AbortController;
  status: string;
}

const sessionRegistry = new SessionRegistry();
const loopRegistry = new Map<string, LoopRecord>();

const HELP_TEXT = `singularity - Singularity agent harness

Usage: singularity [command]

Commands:
  singularity                   Show this help message
  singularity chat [message]   Chat with the agent (interactive if no message given)
  singularity plan <goal>       Plan mode (steer activity)
  singularity subagent <goal>   Spawn a subagent task
  singularity server [port]      Start production dashboard server
  singularity open [port]         Open dashboard in browser
  singularity cancel [id]       Cancel a session
  singularity sessions          List active sessions
  singularity memory facts      Memory facts status
  singularity skills list       List available skills
  singularity profile list      List profiles
  singularity gateway status    Show gateway config status
  singularity gateway start     Launch Telegram/Discord gateway
  singularity tui               Launch interactive TUI shell
  singularity doctor memory     Run memory audit
  singularity doctor install    Run install audit
  singularity setup             Interactive onboarding setup

Run singularity --help for this message.
`;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function launchTui(): Promise<CliResult> {
  if (!process.stdout.isTTY) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'singularity tui: no TTY available; run from a real terminal.\n',
    };
  }
  const { render } = await import('@opentui/solid');
  const { App, loadTuiSnapshot } = await import('./tui/App.js');
  const snapshot = await loadTuiSnapshot();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await render(() => App({ snapshot }), {
    exitOnCtrlC: true,
    onDestroy: finish,
  });
  await finished;
  return { exitCode: 0, stdout: '', stderr: '' };
}

export async function runCli(args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const print_ = (text: string) => stdout.push(text);
  const printErr_ = (text: string) => stderr.push(text);

  // Parse command first to determine if we need config validation
  const [cmd, ...rest] = args;

  // Commands that only print info / manage in-memory state — skip config validation
  // since validateStartup() requires a full config store to exist.
  const noConfigCommands = new Set([
    'server', // has its own secrets check + startup path
    'loops', // no action: just prints usage
    'doctor', // runs diagnostics that don't require config
    'gateway', // 'status' subcommand prints config state; 'start' has its own checks
    'sessions', // purely in-memory registry
    'cancel', // purely in-memory registry
    'help', // prints help text
    'ping', // profile health check
    'profile', // subcommands access profile store
    'skill', // skill draft/approve don't need config
    'memory', // memory facts don't need config validation
    'tui', // TUI launch
    'plan', // plan command
    'chat', // chat command (engine handles missing API key)
    'subagent', // subagent command
    'open', // open command
    'start', // start command
    'skills', // skills list accesses profile store
    '--help', // help flag
    '-h', // short help flag
  ]);

  // Secrets must be checked BEFORE config validation for the server command
  if (cmd === 'server') {
    if (!process.env.SINGULARITY_JWT_SECRET) {
      console.error('ERROR: SINGULARITY_JWT_SECRET env var is required');
      process.exitCode = 1;
      return { exitCode: 1, stdout: '', stderr: '' };
    }
    if (!process.env.SINGULARITY_ENCRYPTION_KEY) {
      console.error('ERROR: SINGULARITY_ENCRYPTION_KEY env var is required');
      process.exitCode = 1;
      return { exitCode: 1, stdout: '', stderr: '' };
    }
  } else if (!noConfigCommands.has(cmd)) {
    const validation = validateStartup();
    if (!validation.valid) {
      for (const err of validation.errors) {
        console.error(`ERROR: ${err}`);
      }
    }
  }

  if (args.length === 0) {
    print_(HELP_TEXT);
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  if (cmd === '--help' || cmd === '-h') {
    print_(HELP_TEXT);
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── chat REPL helper ──────────────────────────────────────────────────────
  async function runChatRepl(
    rl: ReadlineInterface,
    session: CliSession,
    deps: ReturnType<typeof createEngineDeps>
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const abort = session.abort;

      // Handle Ctrl+C — end REPL gracefully
      const sigintHandler = () => {
        rl.close();
        resolve();
      };
      process.on('SIGINT', sigintHandler);

      rl.prompt();

      rl.on('line', async (line: string) => {
        const trimmed = line.trim();

        // Exit / quit ends the session
        if (trimmed === 'exit' || trimmed === 'quit') {
          rl.close();
          return;
        }

        if (!trimmed) {
          rl.prompt();
          return;
        }

        const runner = new SessionRunner(
          { maxSteps: 25, contextWindow: 128000 },
          deps
        );
        const activity: Activity = { type: 'queue', input: trimmed };

        try {
          for await (const turn of runner.run(
            [activity],
            session.id,
            abort.signal
          )) {
            if (turn.textBuffer) {
              process.stdout.write(turn.textBuffer);
            }
          }
        } catch {
          // abort errors are expected on Ctrl+C / exit
        }

        process.stdout.write('\n');
        rl.prompt();
      });

      rl.on('close', () => {
        process.removeListener('SIGINT', sigintHandler);
        resolve();
      });
    });
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  if (cmd === 'chat') {
    const message = rest.join(' ');

    // No message → interactive REPL mode
    if (!message) {
      const { createInterface } = await import('node:readline');
      const abort = new AbortController();
      const session = sessionRegistry.add('chat: <repl>', abort);
      const deps = createEngineDeps();
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
      });
      try {
        await runChatRepl(rl, session, deps);
      } finally {
        sessionRegistry.remove(session.id);
      }
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }

    // Single-shot mode
    const abort = new AbortController();
    const session = sessionRegistry.add(`chat: ${message.slice(0, 40)}`, abort);
    process.on('SIGINT', () => abort.abort());
    const deps = createEngineDeps();
    const runner = new SessionRunner(
      { maxSteps: 25, contextWindow: 128000 },
      deps
    );
    const activity: Activity = { type: 'queue', input: message };
    let response = '';
    try {
      for await (const turn of runner.run(
        [activity],
        session.id,
        abort.signal
      )) {
        if (turn.textBuffer) {
          response += turn.textBuffer;
          process.stdout.write(turn.textBuffer);
        }
      }
    } finally {
      sessionRegistry.remove(session.id);
    }
    if (!response) print_('(no response)');
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── plan ─────────────────────────────────────────────────────────────────
  if (cmd === 'plan') {
    const goal = rest.join(' ');
    if (!goal) {
      printErr_('Usage: singularity plan <goal>');
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    const abort = new AbortController();
    const session = sessionRegistry.add(`plan: ${goal.slice(0, 40)}`, abort);
    process.on('SIGINT', () => abort.abort());
    const deps = createEngineDeps();
    const runner = new SessionRunner(
      { maxSteps: 25, contextWindow: 128000 },
      deps
    );
    const activity: Activity = { type: 'steer', input: goal };
    let response = '';
    try {
      for await (const turn of runner.run(
        [activity],
        session.id,
        abort.signal
      )) {
        if (turn.textBuffer) {
          response += turn.textBuffer;
          process.stdout.write(turn.textBuffer);
        }
      }
    } finally {
      sessionRegistry.remove(session.id);
    }
    if (!response) print_('(no response)');
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── subagent ─────────────────────────────────────────────────────────────
  if (cmd === 'subagent') {
    const goal = rest.join(' ');
    if (!goal) {
      printErr_('Usage: singularity subagent <goal>');
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    const { SubagentRunner } = await import('singularity-core');
    const { createLLM } = await import('singularity-llm');
    const llm = createLLM();
    const runner = new SubagentRunner({
      llmAdapter: llm,
      eventHub: undefined, // Could wire to EventHub in future
    });
    print_(`Spawning subagent: ${goal}`);
    const result = await runner.run({ goal, context: 'CLI spawned' });
    print_(result.summary);
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── server ─────────────────────────────────────────────────────────────
  if (cmd === 'server') {
    if (!process.env.SINGULARITY_JWT_SECRET) {
      console.error('ERROR: SINGULARITY_JWT_SECRET env var is required');
      process.exit(1);
    }
    if (!process.env.SINGULARITY_ENCRYPTION_KEY) {
      console.error('ERROR: SINGULARITY_ENCRYPTION_KEY env var is required');
      process.exit(1);
    }
    const port = Number.parseInt(rest[0] ?? '18678', 10);
    const jwtSecret = process.env.SINGULARITY_JWT_SECRET;
    const encryptionKey = process.env.SINGULARITY_ENCRYPTION_KEY;
    const { ProductionServer } = await import('singularity-dashboard');
    const server = new ProductionServer(port, jwtSecret, encryptionKey);
    const { port: actualPort, stop } = server.start();
    print_(`Production server running on port ${actualPort}`);
    print_(`  Health: http://localhost:${actualPort}/health`);
    print_(`  Metrics: http://localhost:${actualPort}/metrics`);
    print_(`  WebSocket: ws://localhost:${actualPort}/api/events`);
    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      stop();
      process.exit(0);
    });
    await new Promise(() => {});
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // ── open ─────────────────────────────────────────────────────────────────
  if (cmd === 'open') {
    if (!process.env.SINGULARITY_JWT_SECRET) {
      console.error('ERROR: SINGULARITY_JWT_SECRET env var is required');
      process.exit(1);
    }
    if (!process.env.SINGULARITY_ENCRYPTION_KEY) {
      console.error('ERROR: SINGULARITY_ENCRYPTION_KEY env var is required');
      process.exit(1);
    }
    const port = Number.parseInt(rest[0] ?? '18678', 10);
    const jwtSecret = process.env.SINGULARITY_JWT_SECRET;
    const encryptionKey = process.env.SINGULARITY_ENCRYPTION_KEY;
    const { ProductionServer } = await import('singularity-dashboard');
    const server = new ProductionServer(port, jwtSecret, encryptionKey);
    const { port: actualPort, stop } = server.start();
    const url = `http://localhost:${actualPort}`;
    print_(`Server running at ${url}`);
    // node:open is only available in Bun 1.3+; skip browser auto-open on older versions
    try {
      // @ts-expect-error node:open types not yet in @types/node
      const { open } = await import('node:open');
      await open(url);
    } catch {
      print_('(browser open skipped - upgrade to Bun 1.3+ for auto-open)');
    }
    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      stop();
      process.exit(0);
    });
    await new Promise(() => {});
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // ── cancel ───────────────────────────────────────────────────────────────
  if (cmd === 'cancel') {
    const sessionId = rest[0];
    const target = sessionId
      ? sessionRegistry.get(sessionId)
      : sessionRegistry.lastActive;
    if (!target) {
      printErr_(
        sessionId
          ? `Session ${sessionId} not found.`
          : 'No active session to cancel.'
      );
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    target.abort.abort();
    sessionRegistry.remove(target.id);
    print_(`Cancelled session ${target.id} (${target.label})`);
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── sessions ─────────────────────────────────────────────────────────────
  if (cmd === 'sessions') {
    const active = sessionRegistry.list();
    if (active.length === 0) {
      print_('No active sessions.');
    } else {
      print_(
        `${active.length} active session${active.length === 1 ? '' : 's'}:`
      );
      for (const s of active) {
        const ageSec = Math.round((Date.now() - s.startedAt) / 1000);
        print_(`  ${s.id}  ${s.label}  age=${ageSec}s`);
      }
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── skills ───────────────────────────────────────────────────────────────
  if (cmd === 'skills' && rest[0] === 'list') {
    try {
      const ctx = await openDefaultProfile();
      try {
        const all = ctx.skillRegistry.list();
        const visible = all.filter((s) => s.status !== 'pending');
        if (visible.length === 0) {
          print_('No skills registered yet.');
          print_('  Skills are auto-drafted from successful session patterns.');
        } else {
          print_(`${visible.length} skill${visible.length === 1 ? '' : 's'}:`);
          for (const s of visible) {
            print_(`  ${s.name}  [${s.status}]  ${s.description.slice(0, 60)}`);
          }
        }
      } finally {
        ctx.close();
      }
    } catch (e: any) {
      printErr_(`Skills list failed: ${e?.message ?? e}`);
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── skill draft ────────────────────────────────────────────────────────
  if (cmd === 'skill' && rest[0] === 'draft') {
    const name = rest[1];
    const summary = rest.slice(2).join(' ');
    if (!name) {
      printErr_(
        'Usage: singularity skill draft <name> <summary> [--session <sessionId>]'
      );
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    try {
      const { SkillDraftCreator, SkillRegistry } = await import(
        'singularity-core'
      );
      const { SkillAuthoringService } = await import('singularity-gateway');
      const registry = new SkillRegistry();
      const draftCreator = new SkillDraftCreator();
      const service = new SkillAuthoringService(registry, draftCreator);
      const sessionId = rest.includes('--session')
        ? rest[rest.indexOf('--session') + 1]
        : `cli:${Date.now()}`;
      const result = await service.draftSkillFromChat(
        { platform: 'telegram' as const, chatId: 'cli', sessionId },
        {
          skillName: name,
          sessionSummary: summary || 'Skill drafted from CLI',
          toolCallSummary: 'User described the skill via CLI',
          failuresAndFixes: 'N/A',
          verificationCommands: "echo 'Verify the skill works'",
        }
      );
      print_(`Skill draft created: ${result.skill.name}`);
      print_('');
      print_(result.markdown);
      print_('');
      print_(
        `Use 'singularity skill approve ${result.skill.name}' to register it.`
      );
    } catch (e: any) {
      printErr_(`Skill draft failed: ${e?.message ?? e}`);
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── skill approve ─────────────────────────────────────────────────────────
  if (cmd === 'skill' && rest[0] === 'approve') {
    const name = rest[1];
    if (!name) {
      printErr_('Usage: singularity skill approve <name>');
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    printErr_(
      'Note: skill approval via CLI is not yet implemented - use the gateway commands'
    );
    return {
      exitCode: 1,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── memory ───────────────────────────────────────────────────────────────
  if (cmd === 'memory' && rest[0] === 'facts') {
    try {
      const ctx = await openDefaultProfile();
      try {
        const query = rest[1];
        const facts = query
          ? ctx.factStore.recall(query, undefined, { limit: 100 })
          : ctx.factStore.recall(undefined, undefined, { limit: 100 });
        if (facts.length === 0) {
          print_(
            query ? `No facts matching "${query}".` : 'No facts stored yet.'
          );
        } else {
          print_(`${facts.length} fact${facts.length === 1 ? '' : 's'}:`);
          for (const f of facts.slice(0, 50)) {
            const conf = Math.round(f.confidence * 100);
            print_(`  [${conf}%] ${f.subject}: ${f.predicate} = ${f.value}`);
          }
          if (facts.length > 50) print_(`  ... and ${facts.length - 50} more`);
        }
      } finally {
        ctx.close();
      }
    } catch (e: any) {
      printErr_(`Memory facts failed: ${e?.message ?? e}`);
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── loops ────────────────────────────────────────────────────────────────
  if (cmd === 'loops') {
    const [action, value] = rest;
    if (!action) {
      printErr_(
        'Usage: singularity loops [run <goal> | list | status <id> | cancel <id>]'
      );
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    if (action === 'run' && value) {
      const loopId = `loop:${Date.now()}`;
      const abort = new AbortController();
      loopRegistry.set(loopId, {
        id: loopId,
        goal: value,
        startedAt: Date.now(),
        abort,
        status: 'running',
      });
      print_(`Loop ${loopId} started: ${value.slice(0, 60)}`);
      void (async () => {
        try {
          const { runLoop, createWorktreeWorker, createDefaultEvaluator } =
            await import('singularity-loop');
          const { homedir } = await import('node:os');
          const { join } = await import('node:path');
          const report = await runLoop(
            { goal: value, maxIterations: 5, context: { source: 'cli' } },
            createWorktreeWorker({
              command: 'pwd',
              worktreeRoot: join(homedir(), '.singularity', 'loop-base'),
            }),
            createDefaultEvaluator(),
            abort.signal
          );
          loopRegistry.set(loopId, {
            id: loopId,
            goal: value,
            startedAt: Date.now(),
            abort,
            status: report.stopReason,
          });
        } catch (e: any) {
          loopRegistry.set(loopId, {
            id: loopId,
            goal: value,
            startedAt: Date.now(),
            abort,
            status: `error: ${e?.message ?? e}`,
          });
        }
      })();
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    if (action === 'list') {
      const all = Array.from(loopRegistry.values());
      if (all.length === 0) {
        print_('No active loops.');
      } else {
        for (const l of all) {
          const ageSec = Math.round((Date.now() - l.startedAt) / 1000);
          print_(
            `  ${l.id}  [${l.status}]  age=${ageSec}s  ${l.goal.slice(0, 50)}`
          );
        }
      }
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    if (action === 'status' && value) {
      const loop = loopRegistry.get(value);
      if (!loop) {
        printErr_(`Loop ${value} not found.`);
        return {
          exitCode: 1,
          stdout: stdout.join('\n'),
          stderr: stderr.join('\n'),
        };
      }
      const ageSec = Math.round((Date.now() - loop.startedAt) / 1000);
      print_(`Loop ${loop.id}  [${loop.status}]  age=${ageSec}s`);
      print_(`  Goal: ${loop.goal}`);
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    if (action === 'cancel' && value) {
      const loop = loopRegistry.get(value);
      if (!loop) {
        printErr_(`Loop ${value} not found.`);
        return {
          exitCode: 1,
          stdout: stdout.join('\n'),
          stderr: stderr.join('\n'),
        };
      }
      loop.abort.abort();
      loopRegistry.delete(value);
      print_(`Loop ${value} cancelled`);
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    printErr_(
      'Usage: singularity loops [run <goal> | list | status <id> | cancel <id>]'
    );
    return {
      exitCode: 1,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── profile ─────────────────────────────────────────────────────────────
  if (cmd === 'profile' && rest[0] === 'list') {
    try {
      const { ProfileResolver } = await import('singularity-core');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const { existsSync, readdirSync } = await import('node:fs');
      const profileRoot = join(homedir(), '.singularity', 'profiles');
      if (!existsSync(profileRoot)) {
        print_("No profiles directory. Run 'singularity setup' to create one.");
        return {
          exitCode: 0,
          stdout: stdout.join('\n'),
          stderr: stderr.join('\n'),
        };
      }
      const entries = readdirSync(profileRoot, { withFileTypes: true });
      const profileDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      if (profileDirs.length === 0) {
        print_('No profiles found.');
      } else {
        print_(
          `${profileDirs.length} profile${profileDirs.length === 1 ? '' : 's'}:`
        );
        for (const name of profileDirs) {
          const dbPath = join(profileRoot, name, 'state.db');
          const marker = existsSync(dbPath) ? '[active]' : '[empty]';
          print_(`  ${name}  ${marker}  ${dbPath}`);
        }
      }
    } catch (e: any) {
      printErr_(`Profile list failed: ${e?.message ?? e}`);
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── gateway ──────────────────────────────────────────────────────────────
  if (cmd === 'gateway' && rest[0] === 'status') {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const configPath = join(
      process.env.HOME ?? '~',
      '.singularity',
      'config.json'
    );
    const channels: string[] = [];
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config?.gateways?.telegram?.botToken) channels.push('telegram');
        if (config?.gateways?.discord?.botToken) channels.push('discord');
      } catch {
        // intentional no-op — if config unreadable, treat as not configured
      }
    }
    if (channels.length > 0) {
      print_(`Gateway status: configured (${channels.join(', ')})`);
      print_(`  Config: ${configPath}`);
      print_(`  Run 'singularity gateway start' to launch the gateway.`);
    } else {
      print_('Gateway status: not configured.');
      print_("  Run 'singularity setup' to configure Telegram/Discord.");
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── gateway start ──────────────────────────────────────────────────────
  if (cmd === 'gateway' && rest[0] === 'start') {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const configPath = join(
      process.env.HOME ?? '~',
      '.singularity',
      'config.json'
    );
    if (!existsSync(configPath)) {
      printErr_("No config found. Run 'singularity setup' first.");
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    let config: any;
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (e: any) {
      printErr_(`Failed to read config: ${e.message}`);
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    const telegramToken = config?.gateways?.telegram?.botToken;
    const discordToken = config?.gateways?.discord?.botToken;
    if (!telegramToken && !discordToken) {
      printErr_(
        "No gateway channels configured. Run 'singularity setup' first."
      );
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    const deps = createEngineDeps();
    const { SessionRunner } = await import('singularity-engine');
    const { createTelegramAdapter, createDiscordAdapter } = await import(
      'singularity-gateway'
    );

    // Create engine runner for the gateway
    async function* runEngine(
      sessionID: string,
      input: string,
      abortSignal?: AbortSignal
    ) {
      const runner = new SessionRunner(
        { maxSteps: 25, contextWindow: 128000 },
        deps
      );
      for await (const turn of runner.run(
        [{ type: 'queue', input }],
        sessionID,
        abortSignal
      )) {
        if (turn.textBuffer) yield turn.textBuffer;
      }
    }

    // Wire agent functions for telegram/discord
    async function* agentChat(msg: string): AsyncGenerator<string> {
      const sessionId = `telegram:${Date.now()}`;
      for await (const chunk of runEngine(sessionId, msg)) {
        yield chunk;
      }
    }

    async function* agentPlan(goal: string): AsyncGenerator<string> {
      const sessionId = `telegram:${Date.now()}`;
      for await (const chunk of runEngine(sessionId, goal)) {
        yield chunk;
      }
    }

    const startedChannels: string[] = [];
    if (telegramToken) {
      const bot = createTelegramAdapter(telegramToken, {
        agentChat,
        agentPlan,
      });
      void bot.start();
      startedChannels.push('telegram');
    }
    if (discordToken) {
      const adapter = createDiscordAdapter(discordToken, {
        agentChat,
        agentPlan,
      });
      void adapter.start();
      startedChannels.push('discord');
    }
    print_(`Gateway started: ${startedChannels.join(', ')}`);
    print_('  Press Ctrl+C to stop.');
    process.stdout.write(`${stdout.join('\n')}\n`);
    await new Promise(() => {});
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // ── start ───────────────────────────────────────────────────────────────
  if (cmd === 'start') {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const dbPath = join(
      homedir(),
      '.singularity',
      'profiles',
      'default',
      'state.db'
    );
    print_('Singularity status:');
    print_(
      `  Profile DB: ${existsSync(dbPath) ? 'ok' : 'missing'} (${dbPath})`
    );
    print_(`  Active sessions: ${sessionRegistry.list().length}`);
    print_(`  Active loops: ${loopRegistry.size}`);
    print_('  Version: 0.1.0');
    print_('');
    print_('Next steps:');
    print_('  singularity chat <message>     — Talk to the agent');
    print_('  singularity gateway start      — Launch Telegram/Discord');
    print_('  singularity tui                — Open interactive TUI');
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── ping ─────────────────────────────────────────────────────────────────
  if (cmd === 'ping') {
    const started = Date.now();
    try {
      const ctx = await openDefaultProfile();
      ctx.close();
      const elapsed = Date.now() - started;
      print_(`Pong! Profile DB reachable (${elapsed}ms). Version: 0.1.0`);
    } catch (e: any) {
      printErr_(`Ping failed: ${e?.message ?? e}`);
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── help ─────────────────────────────────────────────────────────────────
  if (cmd === 'help') {
    print_(HELP_TEXT);
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── tui ─────────────────────────────────────────────────────────────────
  if (cmd === 'tui') {
    const tuiResult = await launchTui();
    if (tuiResult.stdout) stdout.push(tuiResult.stdout);
    if (tuiResult.stderr) stderr.push(tuiResult.stderr);
    return {
      exitCode: tuiResult.exitCode,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── doctor ──────────────────────────────────────────────────────────────
  if (cmd === 'doctor' && rest[0] === 'memory') {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    try {
      const ctx = await openDefaultProfile();
      try {
        const tables = (
          ctx.db
            .query("SELECT name FROM sqlite_master WHERE type='table'")
            .all() as { name: string }[]
        ).map((r) => r.name);
        const required = ['sessions', 'session_edges', 'facts', 'profiles'];
        const optional = [
          'session_facts',
          'approvals',
          'audit_log',
          'scheduler_jobs',
        ];
        const missing = required.filter((t) => !tables.includes(t));
        const missingOptional = optional.filter((t) => !tables.includes(t));
        checks.push({
          name: 'Profile DB open',
          ok: true,
          detail: ctx.path.stateDbPath,
        });
        checks.push({
          name: 'Required migrations',
          ok: missing.length === 0,
          detail:
            missing.length === 0
              ? `${required.length} required tables present (${tables.length} total)`
              : `missing: ${missing.join(', ')}`,
        });
        if (missingOptional.length > 0) {
          checks.push({
            name: 'Optional migrations',
            ok: true,
            detail: `${optional.length - missingOptional.length}/${optional.length} optional tables present (missing: ${missingOptional.join(', ') || 'none'})`,
          });
        }
        const factCount = ctx.factStore.recall(undefined, undefined, {
          limit: 10000,
        }).length;
        checks.push({
          name: 'FactStore readable',
          ok: true,
          detail: `${factCount} fact(s) stored`,
        });
        const sessionCount = ctx.sessionStore.searchByRuntime(
          'any',
          10000
        ).length;
        checks.push({
          name: 'SessionStore readable',
          ok: true,
          detail: `${sessionCount} session(s) indexed`,
        });
      } finally {
        ctx.close();
      }
    } catch (e: any) {
      checks.push({
        name: 'Profile DB open',
        ok: false,
        detail: e?.message ?? String(e),
      });
    }
    print_('Doctor memory:');
    for (const c of checks) {
      print_(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name} — ${c.detail}`);
    }
    const failed = checks.filter((c) => !c.ok).length;
    if (failed > 0)
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  if (cmd === 'doctor' && rest[0] === 'install') {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const { existsSync, statSync } = await import('node:fs');
    const { homedir, userInfo, arch, cpus } = await import('node:os');
    const { join } = await import('node:path');
    const home = homedir();
    checks.push({
      name: 'Bun runtime',
      ok: typeof Bun !== 'undefined',
      detail:
        typeof Bun !== 'undefined'
          ? `v${(Bun as any).version ?? '?'}`
          : 'Bun not detected',
    });
    checks.push({
      name: 'Platform',
      ok: true,
      detail: `${process.platform}/${arch()}`,
    });
    checks.push({
      name: 'CPU cores',
      ok: (cpus().length ?? 0) > 0,
      detail: `${cpus().length} cores`,
    });
    checks.push({ name: 'HOME set', ok: !!home, detail: home });
    checks.push({
      name: 'Singularity home',
      ok: true,
      detail: join(home, '.singularity'),
    });
    const providerPath = join(home, '.singularity', 'providers.json');
    checks.push({
      name: 'providers.json',
      ok: existsSync(providerPath),
      detail: existsSync(providerPath)
        ? 'present'
        : "missing — run 'singularity setup'",
    });
    const configPath = join(home, '.singularity', 'config.json');
    checks.push({
      name: 'config.json',
      ok: existsSync(configPath),
      detail: existsSync(configPath)
        ? 'present'
        : "missing — run 'singularity setup'",
    });
    try {
      const cliPath = join(home, '.local', 'bin', 'singularity');
      if (existsSync(cliPath)) {
        const st = statSync(cliPath);
        checks.push({
          name: 'singularity binary',
          ok: st.isFile(),
          detail: cliPath,
        });
      } else {
        checks.push({
          name: 'singularity binary',
          ok: false,
          detail: 'not installed at ~/.local/bin/singularity',
        });
      }
    } catch (e: any) {
      checks.push({
        name: 'singularity binary',
        ok: false,
        detail: e?.message ?? String(e),
      });
    }
    print_('Doctor install:');
    for (const c of checks) {
      print_(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name} — ${c.detail}`);
    }
    const failed = checks.filter((c) => !c.ok).length;
    if (failed > 0)
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  if (cmd === 'doctor') {
    const unknown = rest[0] ?? '<missing>';
    printErr_(`Unknown doctor command: ${unknown}`);
    printErr_('');
    printErr_('Available doctor commands:');
    printErr_('  singularity doctor memory');
    printErr_('  singularity doctor install');
    return {
      exitCode: 1,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  // ── setup ────────────────────────────────────────────────────────────────
  if (cmd === 'setup') {
    const setupResult = await runInteractiveSetup();
    if (setupResult.stdout) stdout.push(setupResult.stdout);
    if (setupResult.stderr) stderr.push(setupResult.stderr);
    return {
      exitCode: setupResult.exitCode,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  }

  printErr_(`Unknown command: ${cmd}`);
  printErr_(HELP_TEXT);
  return { exitCode: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
