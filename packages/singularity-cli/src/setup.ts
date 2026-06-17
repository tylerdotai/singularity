// Singularity CLI — interactive onboarding wizard
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { CliResult } from './index.js';

const SINGULARITY_DIR = path.join(process.env.HOME ?? '~', '.singularity');
const PROVIDERS_PATH = path.join(SINGULARITY_DIR, 'providers.json');

// ─── Available models per provider ───────────────────────────────────────────

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini', 'o3-mini', 'o4-mini'] as const;
const ANTHROPIC_MODELS = ['claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] as const;
const MINIMAX_MODELS = ['MiniMax-Text-01', 'MiniMax-Text-01-Mini', 'MiniMax-M3', 'MiniMax-M3-mini'] as const;
const OPENROUTER_MODELS = ['openrouter/auto', 'openrouter/google/gemini-pro-1.5', 'openrouter/anthropic/claude-3.5-sonnet', 'openrouter/meta-llama/llama-3-8b', 'openrouter/mistralai/mistral-7b'] as const;
const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-coder', 'deepseek-chat-v2', 'deepseek-chat-v3'] as const;
const OLLAMA_MODELS = ['llama3.1', 'llama3', 'llama2', 'mistral', 'codellama'] as const;
const XAI_MODELS = ['xai/grok-2', 'xai/grok-2-mini', 'xai/grok-beta'] as const;
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro', 'gemini-pro', 'gemini-pro-vision'] as const;
const KIMI_MODELS = ['kimi-chat', 'kimi-chat-alpha', 'kimi-pro', 'kimi-vl'] as const;
const QWEN_MODELS = ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long', 'qwen-vl-max', 'qwen-vl-plus'] as const;

// ─── Available providers ───────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    keyLabel: 'OpenAI API key',
    keyEnvVar: 'OPENAI_API_KEY',
    models: OPENAI_MODELS as readonly string[],
    defaultModel: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    keyLabel: 'MiniMax API key',
    keyEnvVar: 'MINIMAX_API_KEY',
    models: MINIMAX_MODELS as readonly string[],
    defaultModel: 'MiniMax-Text-01',
    baseURL: 'https://api.minimax.io/v1',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    keyLabel: 'Anthropic API key',
    keyEnvVar: 'ANTHROPIC_API_KEY',
    models: ANTHROPIC_MODELS as readonly string[],
    defaultModel: 'claude-3-5-sonnet',
    baseURL: 'https://api.anthropic.com/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyEnvVar: 'OPENROUTER_API_KEY',
    models: OPENROUTER_MODELS as readonly string[],
    defaultModel: 'openrouter/anthropic/claude-3.5-sonnet',
    baseURL: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    keyLabel: 'DeepSeek API key',
    keyEnvVar: 'DEEPSEEK_API_KEY',
    models: DEEPSEEK_MODELS as readonly string[],
    defaultModel: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    keyLabel: 'Ollama base URL',
    keyEnvVar: 'OLLAMA_BASE_URL',
    models: OLLAMA_MODELS as readonly string[],
    defaultModel: 'llama3.1',
    baseURL: 'http://localhost:11434/v1',
  },
] as const;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function heading(text: string): void {
  process.stdout.write(`\n${CYAN}${BOLD}${text}${RESET}\n`);
}
function section(text: string): void {
  process.stdout.write(`\n${BOLD}${text}${RESET}\n`);
}
function info(text: string): void {
  process.stdout.write(`${DIM}${text}${RESET}\n`);
}
function ok(text: string): void {
  process.stdout.write(`${GREEN}✓${RESET} ${text}\n`);
}
function warn(text: string): void {
  process.stdout.write(`${YELLOW}⚠${RESET} ${text}\n`);
}
function err(text: string): void {
  process.stdout.write(`${RED}✗${RESET} ${text}\n`);
}
function prompt(text: string): string {
  process.stdout.write(`${BOLD}?${RESET} ${text} `);
  return '';
}

// ─── Readline helpers ──────────────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: undefined,
  });
}

async function questionRl(rl: readline.Interface, promptText: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => resolve(answer.trim()));
  });
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  question: string,
  choices: readonly T[],
  displayFn: (t: T) => string = (t) => t
): Promise<T | null> {
  process.stdout.write(`\n${BOLD}${question}${RESET}\n`);
  for (let i = 0; i < choices.length; i++) {
    process.stdout.write(`  ${MAGENTA}${i + 1}${RESET}. ${displayFn(choices[i] as T)}\n`);
  }
  process.stdout.write(`  ${DIM}Enter to skip${DIM}\n\n`);

  while (true) {
    const raw = await questionRl(rl, `Pick a number (1–${choices.length}) or press Enter: `);
    if (raw === '') return null;
    const n = Number.parseInt(raw, 10);
    if (n >= 1 && n <= choices.length) return choices[n - 1];
    process.stdout.write(`${RED}Invalid choice. Try again: ${RESET}`);
  }
}

async function askYesNo(rl: readline.Interface, question: string, default_?: boolean): Promise<boolean> {
  const suffix = default_ === true ? ' [Y/n]: '
    : default_ === false ? ' [y/N]: '
    : ' [y/n]: ';
  const raw = await questionRl(rl, question + suffix);
  if (raw === '') return default_ ?? false;
  return raw.toLowerCase() === 'y';
}

async function askNumber(
  rl: readline.Interface,
  question: string,
  default_?: number,
  min?: number,
  max?: number
): Promise<number | null> {
  const rangeStr = min !== undefined && max !== undefined ? ` (${min}–${max})` :
                   min !== undefined ? ` (min ${min})` :
                   max !== undefined ? ` (max ${max})` : '';
  const defStr = default_ !== undefined ? ` [${default_}]` : '';
  const raw = await questionRl(rl, `${question}${rangeStr}${defStr}: `);
  if (raw === '') return default_ ?? null;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) {
    process.stdout.write(`${RED}Not a number. Skipping.${RESET}\n`);
    return null;
  }
  if (min !== undefined && n < min) {
    process.stdout.write(`${RED}Below minimum (${min}). Skipping.${RESET}\n`);
    return null;
  }
  if (max !== undefined && n > max) {
    process.stdout.write(`${RED}Above maximum (${max}). Skipping.${RESET}\n`);
    return null;
  }
  return n;
}

async function askText(
  rl: readline.Interface,
  question: string,
  default_?: string,
  secret = false
): Promise<string | null> {
  const suffix = secret ? ': ' : ': ';
  const defStr = default_ !== undefined ? ` [${default_}]` : '';
  const raw = await questionRl(rl, `${question}${defStr}${suffix}`);
  if (raw === '') return default_ ?? null;
  return raw;
}

async function askApiKey(rl: readline.Interface, keyLabel: string, envVar?: string): Promise<string | null> {
  // Check env var first
  if (envVar && process.env[envVar]) {
    info(`${keyLabel} already set in environment (${envVar}). Skipping.`);
    return null;
  }

  const raw = await questionRl(rl, `${keyLabel} (press Enter to skip): `);
  if (raw === '') return null;
  return raw.trim();
}

// ─── Token validation ─────────────────────────────────────────────────────────

async function testApiKey(providerId: string, apiKey: string, baseURL?: string): Promise<boolean> {
  try {
    const urls: Record<string, string> = {
      openai: 'https://api.openai.com/v1/models',
      anthropic: 'https://api.anthropic.com/v1/messages',
      minimax: 'https://api.minimax.io/v1/t2a_v2',
      openrouter: 'https://openrouter.ai/api/v1/models',
      deepseek: 'https://api.deepseek.com/v1/models',
    };
    const url = baseURL ?? urls[providerId];
    if (!url) return true;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    if (providerId === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      // Give up after 5 seconds
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testTelegramToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testDiscordToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

async function spin<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let idx = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  const write = (suffix: string) => process.stdout.write(`\r${label}${suffix}`);

  if (process.stdout.isTTY) {
    interval = setInterval(() => {
      write(` ${frames[idx % frames.length]}`);
      idx++;
    }, 80);
  } else {
    write('...');
  }

  try {
    const result = await fn();
    if (interval) clearInterval(interval);
    process.stdout.write(`\r${' '.repeat(label.length + 4)}\r`);
    return result;
  } catch (e) {
    if (interval) clearInterval(interval);
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`\r${RED}✗${RESET} ${label} — ${msg}\n`);
    throw e;
  }
}

// ─── Config builder ───────────────────────────────────────────────────────────

interface BuiltConfig {
  core: {
    provider: string;
    model: string;
    apiKey: string;
    baseURL: string;
  };
  providers: Record<string, { apiKey: string; model?: string; baseURL?: string }>;
  memory: {
    contextTokenBudget: number;
    compressionThreshold: number;
    sessionRetentionDays: number;
    maxFactAgeDays: number;
  };
  engine: {
    maxSteps: number;
    bufferSize: number;
    keepTokens: number;
    summaryTokens: number;
    contextWindow: number;
    model: string;
  };
  risk: {
    approvalThreshold: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    criticalTools: string[];
  };
  platform: {
    telegram: { botToken?: string; allowedChats: string[] };
    discord: { botToken?: string; allowedChats: string[] };
  };
  tools: {
    browser: { enabled: boolean };
    homeAssistant: { enabled: boolean };
    kanban: { enabled: boolean };
    computerUse: { enabled: boolean };
    defaultToolsets: string[];
  };
}

function defaultBuiltConfig(): BuiltConfig {
  return {
    core: { provider: '', model: '', apiKey: '', baseURL: '' },
    providers: {},
    memory: {
      contextTokenBudget: 100000,
      compressionThreshold: 0.85,
      sessionRetentionDays: 30,
      maxFactAgeDays: 90,
    },
    engine: {
      maxSteps: 25,
      bufferSize: 20000,
      keepTokens: 8000,
      summaryTokens: 4096,
      contextWindow: 128000,
      model: '',
    },
    risk: {
      approvalThreshold: 'LOW',
      criticalTools: ['Bash'],
    },
    platform: {
      telegram: { botToken: undefined, allowedChats: [] },
      discord: { botToken: undefined, allowedChats: [] },
    },
    tools: {
      browser: { enabled: false },
      homeAssistant: { enabled: false },
      kanban: { enabled: false },
      computerUse: { enabled: false },
      defaultToolsets: [],
    },
  };
}

// ─── Wizard steps ─────────────────────────────────────────────────────────────

async function runWizard(): Promise<{ config: BuiltConfig; providerKeys: Record<string, string> }> {
  const rl = createRl();
  const config = defaultBuiltConfig();
  const providerKeys: Record<string, string> = {};

  // Handle Ctrl+C
  rl.on('SIGINT', () => {
    process.stdout.write('\n\nSetup cancelled.\n');
    rl.close();
    process.exit(0);
  });

  try {
    // ── Welcome ─────────────────────────────────────────────────────────────
    process.stdout.write(`
${CYAN}${BOLD}
╔══════════════════════════════════════════════╗
║         Singularity Setup Wizard            ║
╚══════════════════════════════════════════════╝
${RESET}
${DIM}Your local-first AI agent harness.${RESET}
`);

    const continuePrompt = await questionRl(rl, `${BOLD}Press Enter to begin${RESET}: `);
    if (continuePrompt === 'q' || continuePrompt === 'quit') {
      process.stdout.write('\nExiting. Run `singularity setup` to restart.\n');
      rl.close();
      process.exit(0);
    }

    // ── Agent name ───────────────────────────────────────────────────────────
    heading('Agent identity');
    info('Give your agent a name — how should Tyler address it?\n');
    const agentName = await askText(rl, `Agent name${DIM} (press Enter to skip and name later)${RESET}: `);
    const trimmedName = agentName?.trim() ?? '';
    if (trimmedName) {
      (config as any).agentName = trimmedName;
      ok(`Agent will be known as "${trimmedName}"`);
    } else {
      info('Skipped — you can name your agent by re-running setup or editing config.json.');
    }

    // ── Step 1: Provider ───────────────────────────────────────────────────
    heading('Step 1 — Choose your AI provider');

    const chosenProvider = await askChoice(
      rl,
      'Which provider do you want to use?',
      PROVIDERS.map((p) => p.id),
      (id) => {
        const p = PROVIDERS.find((x) => x.id === id)!;
        const envSet = p.keyEnvVar && process.env[p.keyEnvVar] ? ` ${GREEN}(env set)${RESET}` : '';
        return `${BOLD}${p.name}${RESET} — ${p.defaultModel}${envSet}`;
      }
    );

    if (!chosenProvider) {
      warn('No provider selected. Core provider fields will be left empty.');
      process.stdout.write(`${DIM}You can re-run setup or edit ~/.singularity/config.json directly.${RESET}\n`);
    } else {
      const provider = PROVIDERS.find((p) => p.id === chosenProvider)!;
      config.core.provider = chosenProvider;

      // ── Step 2: Model ─────────────────────────────────────────────────────
      heading(`Step 2 — Choose a model for ${provider.name}`);
      const modelChoices = provider.models;
      const chosenModel = await askChoice(
        rl,
        `Which model?`,
        modelChoices,
        (m) => m
      );
      config.core.model = chosenModel ?? provider.defaultModel;
      config.engine.model = config.core.model;

      // ── Step 3: API key ───────────────────────────────────────────────────
      heading('Step 3 — API key');

      if (provider.keyEnvVar && process.env[provider.keyEnvVar]) {
        const envKey = process.env[provider.keyEnvVar]!;
        // Skip redaction placeholders — they are not real keys
        if (envKey === '' || envKey === '***' || envKey.startsWith('***')) {
          info(`Environment ${provider.keyEnvVar} has a placeholder — will use providers.json instead.`);
        } else {
          ok(`${provider.name} API key found in environment (${provider.keyEnvVar}).`);
          config.core.apiKey = envKey;
        }
      } else {
        const keyPrompt = provider.id === 'ollama'
          ? `Enter your ${provider.name} base URL`
          : `Enter your ${provider.name} API key (or press Enter to enter manually later)`;

        const raw = await questionRl(rl, `${keyPrompt}: `);

        if (raw.trim() === '') {
          warn('No key entered — add it to your environment or edit config later.');
          config.core.apiKey = '';
        } else {
          // Validate the key
          const isOllama = provider.id === 'ollama';
          const displayKey = isOllama ? raw.trim() : raw.trim().slice(0, 8) + '***';

          const valid = await spin(
            `Testing ${provider.name} connection`,
            () => testApiKey(provider.id, raw.trim(), isOllama ? raw.trim() : undefined)
          );

          if (valid) {
            ok(`${provider.name} key verified!`);
            config.core.apiKey = raw.trim();
            providerKeys[chosenProvider] = raw.trim();
          } else {
            warn(`${provider.name} key validation failed — saving anyway (check your key).`);
            config.core.apiKey = raw.trim();
            providerKeys[chosenProvider] = raw.trim();
          }
        }
      }

      // ── Step 4: Base URL ─────────────────────────────────────────────────
      if (provider.id === 'ollama') {
        config.core.baseURL = config.core.apiKey || 'http://localhost:11434/v1';
      } else {
        const customBaseURL = await askText(
          rl,
          `Custom base URL for ${provider.name}?`,
          provider.baseURL
        );
        if (customBaseURL) config.core.baseURL = customBaseURL;
        else config.core.baseURL = provider.baseURL;
      }
    }

    // ── Step 5: Memory settings ────────────────────────────────────────────
    heading('Step 5 — Memory settings');

    info('These control how Singularity manages conversation history and fact memory.');
    info('Defaults are sane for most use cases — press Enter to accept.\n');

    const budget = await askNumber(rl, 'Context token budget', 100000, 10000, 500000);
    if (budget !== null) config.memory.contextTokenBudget = budget;

    const compression = await askNumber(rl, 'Compression threshold (0.5–0.99)', 0.85, 0.5, 0.99);
    if (compression !== null) config.memory.compressionThreshold = compression;

    const retention = await askNumber(rl, 'Session retention days', 30, 1, 365);
    if (retention !== null) config.memory.sessionRetentionDays = retention;

    const factAge = await askNumber(rl, 'Max fact age (days)', 90, 7, 365);
    if (factAge !== null) config.memory.maxFactAgeDays = factAge;

    // ── Step 6: Engine settings ────────────────────────────────────────────
    heading('Step 6 — Engine settings');

    const maxSteps = await askNumber(rl, 'Max steps per session', 25, 1, 200);
    if (maxSteps !== null) config.engine.maxSteps = maxSteps;

    const ctxWindow = await askNumber(rl, 'Context window (tokens)', 128000, 4096, 1000000);
    if (ctxWindow !== null) config.engine.contextWindow = ctxWindow;

    const bufferSize = await askNumber(rl, 'Buffer size (tokens)', 20000, 1000, 100000);
    if (bufferSize !== null) config.engine.bufferSize = bufferSize;

    const keepTokens = await askNumber(rl, 'Keep tokens (for compaction)', 8000, 1000, 50000);
    if (keepTokens !== null) config.engine.keepTokens = keepTokens;

    const summaryTokens = await askNumber(rl, 'Summary tokens (per compaction)', 4096, 500, 16000);
    if (summaryTokens !== null) config.engine.summaryTokens = summaryTokens;

    // ── Step 7: Risk thresholds ─────────────────────────────────────────────
    heading('Step 7 — Risk & approvals');

    const riskChoice = await askChoice(
      rl,
      'Approval threshold (tools at or above this risk level require approval)',
      ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const,
      (r) => r
    );
    if (riskChoice) config.risk.approvalThreshold = riskChoice;

    const addCritical = await askYesNo(rl, 'Add critical tools that always require approval?', false);
    if (addCritical) {
      const toolName = await askText(rl, 'Tool name (e.g. Bash, Edit, Read): ');
      if (toolName) {
        config.risk.criticalTools = [toolName];
        ok(`Critical tool added: ${toolName}`);
      }
    }

    // ── Step 8: Gateway tokens ─────────────────────────────────────────────
    heading('Step 8 — Messaging gateways (optional)');

    const configureTelegram = await askYesNo(rl, 'Configure Telegram gateway?', false);
    if (configureTelegram) {
      const token = await questionRl(rl, 'Telegram bot token: ');
      if (token.trim()) {
        const valid = await spin('Verifying Telegram bot token', () =>
          testTelegramToken(token.trim())
        );
        if (valid) {
          config.platform.telegram.botToken = token.trim();
          ok('Telegram bot verified!');
        } else {
          warn('Telegram token could not be verified — double-check it.');
          config.platform.telegram.botToken = token.trim();
        }
      }
    }

    const configureDiscord = await askYesNo(rl, 'Configure Discord gateway?', false);
    if (configureDiscord) {
      const token = await questionRl(rl, 'Discord bot token: ');
      if (token.trim()) {
        const valid = await spin('Verifying Discord bot token', () =>
          testDiscordToken(token.trim())
        );
        if (valid) {
          config.platform.discord.botToken = token.trim();
          ok('Discord bot verified!');
        } else {
          warn('Discord token could not be verified — double-check it.');
          config.platform.discord.botToken = token.trim();
        }
      }
    }

    // ── Step 9: Summary ───────────────────────────────────────────────────
    heading('Step 9 — Summary');

    process.stdout.write(`
${BOLD}Provider:${RESET}   ${config.core.provider || DIM}(none)${RESET}
${BOLD}Model:${RESET}     ${config.core.model || DIM}(none)${RESET}
${BOLD}API key:${RESET}   ${config.core.apiKey ? config.core.apiKey.slice(0, 6) + '***' : DIM}(none)${RESET}
${BOLD}Memory:${RESET}    budget=${config.memory.contextTokenBudget}, compress=${config.memory.compressionThreshold}, retention=${config.memory.sessionRetentionDays}d
${BOLD}Engine:${RESET}     maxSteps=${config.engine.maxSteps}, ctxWindow=${config.engine.contextWindow}
${BOLD}Risk:${RESET}      approvalThreshold=${config.risk.approvalThreshold}
${BOLD}Critical:${RESET}  ${config.risk.criticalTools.join(', ') || DIM}(none)${RESET}
${BOLD}Telegram:${RESET}   ${config.platform.telegram.botToken ? '✓ configured' : DIM}(not configured)${RESET}
${BOLD}Discord:${RESET}   ${config.platform.discord.botToken ? '✓ configured' : DIM}(not configured)${RESET}
`);

    const confirm = await askYesNo(rl, 'Save this configuration?', true);
    if (!confirm) {
      process.stdout.write('\nConfiguration discarded. Run `singularity setup` to try again.\n');
      rl.close();
      process.exit(0);
    }

    rl.close();
    return { config, providerKeys };
  } finally {
    try { rl.close(); } catch { /* already closed */ }
  }
}

// ─── Config writer ────────────────────────────────────────────────────────────

function saveConfig(config: BuiltConfig, providerKeys: Record<string, string>): void {
  fs.mkdirSync(SINGULARITY_DIR, { recursive: true });

  // Write providers.json (stores raw API keys for the engine-deps loader)
  if (Object.keys(providerKeys).length > 0) {
    fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(providerKeys, null, 2));
    ok(`Provider keys saved to ${PROVIDERS_PATH}`);
  }

  // Build the schema-compatible config object
  // Note: gateway reads from config.gateways; setup writes to config.platform
  const schemaConfig = {
    core: {
      provider: config.core.provider,
      model: config.core.model,
      apiKey: config.core.apiKey,
      baseURL: config.core.baseURL,
    },
    providers: config.providers,
    tools: config.tools,
    platform: config.platform,
    gateways: config.platform, // mirror for gateway compat
    memory: config.memory,
    risk: config.risk,
    engine: config.engine,
    agentName: (config as any).agentName ?? null,
  };

  // Atomic write via temp file + rename
  const CONFIG_PATH = path.join(SINGULARITY_DIR, 'config.json');
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(schemaConfig, null, 2), 'utf-8');
  fs.readFileSync(tmp); // verify write succeeded
  fs.writeFileSync(CONFIG_PATH, fs.readFileSync(tmp));
  ok(`Configuration saved to ${CONFIG_PATH}`);
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export async function runInteractiveSetup(): Promise<CliResult> {
  try {
    const { config, providerKeys } = await runWizard();
    saveConfig(config, providerKeys);

    process.stdout.write(`
${GREEN}${BOLD}
╔══════════════════════════════════════════════╗
║         Singularity Setup Complete          ║
╚══════════════════════════════════════════════╝
${RESET}
${DIM}Next steps:${RESET}
  singularity chat              Start chatting
  singularity doctor install   Verify installation
  ${BOLD}singularity profile list${RESET}      View profiles

Config: ${SINGULARITY_DIR}/config.json
Keys:   ${PROVIDERS_PATH}
`);

    return { exitCode: 0, stdout: '', stderr: '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { exitCode: 1, stdout: '', stderr: `Setup error: ${msg}\n` };
  }
}
