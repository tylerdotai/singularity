import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalSingularityHome: string | undefined;
let originalJwtSecret: string | undefined;
let originalEncryptionKey: string | undefined;

// Path to the CLI entrypoint
const CLI_ENTRYPOINT = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'src',
  'main.ts'
);

function runServerSubprocess(
  env: Record<string, string | undefined>
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', [CLI_ENTRYPOINT, 'server'], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stderr });
    });
    proc.on('error', (err) => {
      resolve({ exitCode: -1, stderr: err.message });
    });
    // Timeout after 5 seconds to prevent hanging
    setTimeout(() => {
      proc.kill();
      resolve({ exitCode: -1, stderr: 'timeout' });
    }, 5000);
  });
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'singularity-cli-test-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalSingularityHome = process.env.SINGULARITY_HOME;
  originalJwtSecret = process.env.SINGULARITY_JWT_SECRET;
  originalEncryptionKey = process.env.SINGULARITY_ENCRYPTION_KEY;
  process.env.SINGULARITY_HOME = tmpHome;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.SINGULARITY_HOME = originalSingularityHome;
  if (originalJwtSecret !== undefined) {
    process.env.SINGULARITY_JWT_SECRET = originalJwtSecret;
  } else {
    delete process.env.SINGULARITY_JWT_SECRET;
  }
  if (originalEncryptionKey !== undefined) {
    process.env.SINGULARITY_ENCRYPTION_KEY = originalEncryptionKey;
  } else {
    delete process.env.SINGULARITY_ENCRYPTION_KEY;
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe('server command secrets validation', () => {
  test('server exits 1 when SINGULARITY_JWT_SECRET is missing', async () => {
    // Run in subprocess to isolate process.exit
    const result = await runServerSubprocess({
      SINGULARITY_HOME: tmpHome,
      SINGULARITY_ENCRYPTION_KEY: 'test-encryption-key',
      // SINGULARITY_JWT_SECRET intentionally omitted
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SINGULARITY_JWT_SECRET');
    expect(result.stderr).toContain('required');
  });

  test('server exits 1 when SINGULARITY_ENCRYPTION_KEY is missing', async () => {
    // Run in subprocess to isolate process.exit
    const result = await runServerSubprocess({
      SINGULARITY_HOME: tmpHome,
      SINGULARITY_JWT_SECRET: 'test-jwt-secret',
      // SINGULARITY_ENCRYPTION_KEY intentionally omitted
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SINGULARITY_ENCRYPTION_KEY');
    expect(result.stderr).toContain('required');
  });

  test('server exits 1 when both secrets are missing', async () => {
    // Run in subprocess to isolate process.exit
    const result = await runServerSubprocess({
      SINGULARITY_HOME: tmpHome,
      // Both secrets intentionally omitted
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SINGULARITY_JWT_SECRET');
    expect(result.stderr).toContain('required');
  });
});

describe('secrets-required: no dev-secret fallbacks', () => {
  test('index.ts contains no dev-secret fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const indexPath = join(import.meta.dir, 'index.ts');
    const content = readFileSync(indexPath, 'utf-8');
    // Should not contain the old dev-secret fallback
    expect(content).not.toContain('dev-secret-change-in-production');
    expect(content).not.toContain('dev-encryption-key-change');
    // Should contain the validation
    expect(content).toContain('SINGULARITY_JWT_SECRET');
    expect(content).toContain('SINGULARITY_ENCRYPTION_KEY');
  });
});
