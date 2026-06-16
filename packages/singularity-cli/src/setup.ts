// Singularity CLI — interactive onboarding setup
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { CliResult } from './index.js';

const SINGULARITY_DIR = path.join(process.env.HOME ?? '~', '.singularity');
const CONFIG_PATH = path.join(SINGULARITY_DIR, 'config.json');
const PROVIDERS_PATH = path.join(SINGULARITY_DIR, 'providers.json');
const PROFILES_DIR = path.join(SINGULARITY_DIR, 'profiles');
const DEFAULT_PROFILE_DIR = path.join(PROFILES_DIR, 'default');

export interface SingularityConfig {
  version: number;
  defaultProfile: string;
  gateways: {
    telegram?: { botToken: string };
    discord?: { botToken: string };
  };
}

export interface ProvidersConfig {
  openai?: string;
  minimax?: string;
  anthropic?: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function maskInput(input: string): string {
  if (!input) return '';
  return input.slice(0, 4) + '*'.repeat(Math.max(input.length - 4, 4));
}

async function questionRl(
  rl: readline.Interface,
  prompt: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function questionWithMask(
  rl: readline.Interface,
  prompt: string
): Promise<string> {
  return new Promise((resolve) => {
    // Mask input by replacing characters after first 4
    const secretInput = (readline as any).createSecretInput
      ? (readline as any).createSecretInput('*')
      : null;

    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function askYesNo(
  rl: readline.Interface,
  prompt: string
): Promise<boolean> {
  const answer = await questionRl(rl, prompt);
  return answer.toLowerCase() === 'y';
}

function spin<T>(promise: Promise<T>, message: string): Promise<T> {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  const spinPromise = promise.finally(() => {
    if (interval) {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(message.length + 2)}\r`);
    }
  });

  if (!process.stdout.isTTY) {
    process.stdout.write(`${message}... `);
    interval = setInterval(() => {
      process.stdout.write(`\r${message}... ${frames[frame % frames.length]}`);
      frame++;
    }, 80);
  }

  return spinPromise;
}

async function testTelegramToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function testDiscordToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readKey(rl: readline.Interface, label: string): Promise<string> {
  const prompt = `Enter your ${label} (press Enter to skip): `;
  const key = await questionRl(rl, prompt);
  return key.trim();
}

async function runSetup(): Promise<void> {
  // Ensure Singularity directory exists
  ensureDir(SINGULARITY_DIR);
  ensureDir(PROFILES_DIR);
  ensureDir(DEFAULT_PROFILE_DIR);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    process.stdout.write('\n\nSetup cancelled.\n');
    rl.close();
    process.exit(0);
  });

  try {
    // Welcome
    console.log('\n=== Singularity Setup ===\n');
    console.log("Let's get Singularity set up.");
    console.log('Press Enter to continue (or Ctrl+C to cancel at any time)\n');
    await questionRl(rl, '');

    // Provider keys
    console.log('\n--- Provider Keys ---\n');
    console.log('Provider keys allow Singularity to connect to AI models.');
    console.log('You can skip any and add them later.\n');

    const openaiKey = await readKey(rl, 'OpenAI API key (skippable)');
    const minimaxKey = await readKey(rl, 'MiniMax API key (skippable)');
    const anthropicKey = await readKey(rl, 'Anthropic API key (skippable)');

    if (openaiKey || minimaxKey || anthropicKey) {
      ensureDir(SINGULARITY_DIR);
      const providers: ProvidersConfig = {};
      if (openaiKey) providers.openai = openaiKey;
      if (minimaxKey) providers.minimax = minimaxKey;
      if (anthropicKey) providers.anthropic = anthropicKey;
      fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2));
      const saved = [];
      if (openaiKey) saved.push('OpenAI');
      if (minimaxKey) saved.push('MiniMax');
      if (anthropicKey) saved.push('Anthropic');
      console.log(
        `${saved.join(', ')} API key(s) saved to ~/.singularity/providers.json`
      );
    } else {
      console.log(
        'No provider keys supplied — you can set MINIMAX_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in your environment instead.'
      );
    }

    // First profile
    console.log('\n--- Default Profile ---\n');
    console.log('Creating default profile...');
    ensureDir(DEFAULT_PROFILE_DIR);

    // Create minimal profile structure
    const profileConfig = {
      name: 'default',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(DEFAULT_PROFILE_DIR, 'profile.json'),
      JSON.stringify(profileConfig, null, 2)
    );
    console.log('Default profile created at ~/.singularity/profiles/default/');

    // Telegram gateway setup
    console.log('\n--- Gateway Configuration ---\n');

    const configureTelegram = await askYesNo(rl, 'Configure Telegram? (y/N): ');

    if (configureTelegram) {
      const telegramToken = await readKey(rl, 'Telegram bot token');

      if (telegramToken) {
        console.log('\nTesting Telegram bot token...');
        const valid = await spin(
          testTelegramToken(telegramToken),
          'Testing Telegram'
        );

        if (valid) {
          console.log('Telegram bot token verified!');
          // Load existing config or create new
          const config = loadConfig();
          config.gateways = config.gateways ?? {};
          config.gateways.telegram = { botToken: telegramToken };
          saveConfig(config);
          console.log('Telegram gateway configured.');
        } else {
          console.log(
            'Invalid Telegram bot token. Skipping Telegram configuration.'
          );
        }
      }
    }

    // Discord gateway setup
    const configureDiscord = await askYesNo(rl, 'Configure Discord? (y/N): ');

    if (configureDiscord) {
      const discordToken = await readKey(rl, 'Discord bot token');

      if (discordToken) {
        console.log('\nTesting Discord bot token...');
        const valid = await spin(
          testDiscordToken(discordToken),
          'Testing Discord'
        );

        if (valid) {
          console.log('Discord bot token verified!');
          const config = loadConfig();
          config.gateways = config.gateways ?? {};
          config.gateways.discord = { botToken: discordToken };
          saveConfig(config);
          console.log('Discord gateway configured.');
        } else {
          console.log(
            'Invalid Discord bot token. Skipping Discord configuration.'
          );
        }
      }
    }

    // Done
    console.log('\n=== Setup Complete ===\n');
    console.log('Next steps:');
    console.log('  singularity chat    Start chatting');
    console.log('  singularity profile list    View profiles');
    console.log('');
    console.log('Config stored at ~/.singularity/config.json');
    console.log('Providers stored at ~/.singularity/providers.json');
    console.log('');
  } finally {
    rl.close();
  }
}

function loadConfig(): SingularityConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      // Invalid config, return default
    }
  }
  return {
    version: 1,
    defaultProfile: 'default',
    gateways: {},
  };
}

function saveConfig(config: SingularityConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function runInteractiveSetup(): Promise<CliResult> {
  try {
    await runSetup();
    return { exitCode: 0, stdout: '', stderr: '' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Setup failed: ${message}\n`,
    };
  }
}
