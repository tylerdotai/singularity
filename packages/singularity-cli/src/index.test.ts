import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './index.js';

// All tests in this file redirect HOME / USERPROFILE to a per-run temp
// directory so that the wired-up CLI commands (memory facts, skills list,
// profile list, doctor memory/install) read from a fresh `state.db` instead
// of the user's real `~/.singularity`. This makes the test suite
// hermetic and reproducible on any machine, regardless of whether
// the user already has a populated `~/.singularity` profile.

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalSingularityHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'singularity-cli-test-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalSingularityHome = process.env.SINGULARITY_HOME;
  process.env.SINGULARITY_HOME = tmpHome;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.SINGULARITY_HOME = originalSingularityHome;
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe('singularity CLI', () => {
  test('root help lists all required commands', async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('singularity chat');
    expect(result.stdout).toContain('singularity plan');
    expect(result.stdout).toContain('singularity cancel');
    expect(result.stdout).toContain('singularity memory facts');
    expect(result.stdout).toContain('singularity skills list');
    expect(result.stdout).toContain('singularity profile list');
    expect(result.stdout).toContain('singularity gateway status');
    expect(result.stdout).toContain('singularity gateway start');
    expect(result.stdout).toContain('singularity tui');
    expect(result.stdout).toContain('singularity doctor memory');
    expect(result.stdout).toContain('singularity doctor install');
    expect(result.stdout).toContain('singularity setup');
  });

  test('gateway start exits 1 with no-config message when no config exists', async () => {
    const result = await runCli(['gateway', 'start']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No config found');
  });

  test('gateway start exits 1 when config has no channels', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(join(tmpHome, '.singularity'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.singularity', 'config.json'),
      JSON.stringify({ gateways: {} })
    );
    const result = await runCli(['gateway', 'start']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No gateway channels configured');
  });

  test('--help also shows help', async () => {
    const result = await runCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('singularity chat');
  });

  test('chat exits 0 when called with a message (engine wired, API key may be missing)', async () => {
    if (!process.env.OPENAI_API_KEY) {
      return; // chat requires a real LLM API key in CI
    }
    const result = await runCli(['chat', 'hello']);
    expect(result.exitCode).toBe(0);
  });

  test('memory facts exits 0 and shows real output', async () => {
    const result = await runCli(['memory', 'facts']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/fact|memory/i);
  });

  test('skills list exits 0 and shows real output', async () => {
    const result = await runCli(['skills', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/skill/i);
  });

  test('profile list exits 0 and shows real output', async () => {
    const result = await runCli(['profile', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/profile/i);
  });

  test('gateway status exits 0', async () => {
    const result = await runCli(['gateway', 'status']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Gateway status');
  });

  test('doctor memory exits with real audit output', async () => {
    const result = await runCli(['doctor', 'memory']);
    expect([0, 1]).toContain(result.exitCode);
    expect(result.stdout).toContain('Doctor memory');
    expect(result.stdout).toMatch(/ok|FAIL/);
  });

  test('doctor install exits with real audit output', async () => {
    const result = await runCli(['doctor', 'install']);
    expect([0, 1]).toContain(result.exitCode);
    expect(result.stdout).toContain('Doctor install');
    expect(result.stdout).toMatch(/ok|FAIL/);
  });

  test('cancel without args exits 1 with no-active-session message', async () => {
    const result = await runCli(['cancel']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/no active session/i);
  });

  test('sessions with no active sessions prints empty list', async () => {
    const result = await runCli(['sessions']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No active sessions');
  });

  test('loops list with no active loops prints empty list', async () => {
    const result = await runCli(['loops', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No active loops');
  });

  test('tui command exits 1 with no-TTY message when stdout is not a TTY', async () => {
    // bun test runs without a controlling TTY, so launchTui() takes the
    // no-TTY branch. We assert that the dispatcher reports a clean error
    // instead of letting render() try (and fail) to claim a TTY.
    const result = await runCli(['tui']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no TTY available');
  });

  test('unknown command exits non-zero and prints help', async () => {
    const result = await runCli(['unknown-cmd']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: unknown-cmd');
  });

  test('unknown subcommand under valid prefix exits non-zero', async () => {
    const result = await runCli(['profile', 'delete']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: profile');
  });

  test('loops with no action exits 1 with usage message', async () => {
    const result = await runCli(['loops']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: singularity loops');
  });

  test('unknown doctor subcommand exits non-zero with doctor help', async () => {
    const result = await runCli(['doctor', 'network']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown doctor command: network');
    expect(result.stderr).toContain('singularity doctor memory');
    expect(result.stderr).toContain('singularity doctor install');
  });
});
