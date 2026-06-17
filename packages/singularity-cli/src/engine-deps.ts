import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GrantVault } from 'singularity-approvals';
import { ApprovalStore, SqliteGrantVault } from 'singularity-approvals';
import { FactStore, SessionStore } from 'singularity-core';
import { type ProfilePath, ProfileResolver } from 'singularity-core/profiles';
import type {
  ApprovalGuardAdapter,
  EngineDeps,
  LLMRunner,
} from 'singularity-engine';
import type { LLMEvent, Model } from 'singularity-llm';
import { createLLM, type LLMAdapter } from 'singularity-llm';
import type {
  ToolContext,
  ToolDefinition,
  ToolRegistryInterface,
  ToolResult,
  ToolRiskScore,
} from 'singularity-tools';
import { makeTool, ToolRegistry } from 'singularity-tools';

const SINGULARITY_DIR = path.join(process.env.HOME ?? '~', '.singularity');
const PROVIDERS_PATH = path.join(SINGULARITY_DIR, 'providers.json');

interface ProvidersConfig {
  openai?: string;
  minimax?: string;
  anthropic?: string;
}

function loadProviders(): ProvidersConfig {
  try {
    if (fs.existsSync(PROVIDERS_PATH)) {
      return JSON.parse(
        fs.readFileSync(PROVIDERS_PATH, 'utf-8')
      ) as ProvidersConfig;
    }
  } catch {
    // ignore
  }
  return {};
}

interface AgentConfig {
  agentName?: string;
  [key: string]: unknown;
}

function loadAgentConfig(): AgentConfig {
  try {
    const configPath = path.join(SINGULARITY_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AgentConfig;
    }
  } catch {
    // ignore
  }
  return {};
}

function loadIdentityFile(name: string, fallback = ''): string {
  try {
    const filePath = path.join(SINGULARITY_DIR, 'identity', name);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return fallback;
}

function buildSystemPrompt(agentName: string): string {
  const soul = loadIdentityFile('SOUL.md');
  const identity = loadIdentityFile('IDENTITY.md')
    .replace(/AGENT_NAME/g, agentName)
    .replace(/CURRENT_DATE/g, new Date().toISOString().split('T')[0]);
  const user = loadIdentityFile('USER.md')
    .replace(/CURRENT_DATE/g, new Date().toISOString().split('T')[0]);

  const parts: string[] = [];

  if (soul) parts.push(soul);
  if (identity) parts.push(identity);
  if (user) parts.push('## Context\n' + user);

  if (parts.length === 0) {
    return `You are ${agentName}, a sharp and capable AI agent. You are direct, no-nonsense, and get things done.`;
  }

  return parts.join('\n\n');
}

let _cachedSystemPrompt: string | null = null;
let _cachedAgentName: string | null = null;

function getSystemPrompt(): string {
  const config = loadAgentConfig();
  const agentName = config.agentName?.trim() || 'Agent';
  if (_cachedSystemPrompt === null || _cachedAgentName !== agentName) {
    _cachedSystemPrompt = buildSystemPrompt(agentName);
    _cachedAgentName = agentName;
  }
  return _cachedSystemPrompt;
}

function isRedactedKey(key: string): boolean {
  return key === '' || key === '***' || key.startsWith('***');
}

function getProviderKey(
  provider: 'openai' | 'minimax' | 'anthropic'
): string | undefined {
  const envMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    minimax: process.env.MINIMAX_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  const envKey = envMap[provider];
  // Only use env var if it looks like a real key (not redaction placeholder)
  if (envKey && !isRedactedKey(envKey)) return envKey;
  // Fall back to providers.json
  const providers = loadProviders();
  if (provider === 'openai') return providers.openai;
  if (provider === 'minimax') return providers.minimax;
  if (provider === 'anthropic') return providers.anthropic;
  return undefined;
}

const SESSIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  runtime             TEXT NOT NULL,
  runtime_session_id  TEXT,
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  duration_min        INTEGER,
  label               TEXT NOT NULL,
  summary             TEXT NOT NULL,
  body                TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active', 'closed', 'superseded')),
  transcript_kind     TEXT,
  transcript_path     TEXT,
  transcript_offset   INTEGER,
  transcript_length   INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const SESSION_EDGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS session_edges (
  from_session  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_session    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('supersedes', 'continues', 'branched_from', 'merged_from')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_session, to_session, kind)
);
`;

let _db: Database | null = null;
let _factStore: FactStore | null = null;
let _sessionStore: SessionStore | null = null;
let _approvals: ApprovalGuardAdapter | null = null;
let _approvalStore: ApprovalStore | null = null;
let _tools: ToolRegistry | null = null;
let _llm: LLMRunner | null = null;

let _profileResolver: ProfileResolver | null = null;
let _profilePath: ProfilePath | null = null;

async function getProfilePath(): Promise<ProfilePath> {
  if (!_profilePath) {
    if (!_profileResolver) {
      _profileResolver = new ProfileResolver();
    }
    _profilePath = await _profileResolver.resolveDefault();
  }
  return _profilePath;
}

async function getDb(): Promise<Database> {
  if (!_db) {
    const profilePath = await getProfilePath();
    _db = new Database(profilePath.stateDbPath);
  }
  return _db;
}

async function getSessionStore(): Promise<SessionStore> {
  if (!_sessionStore) {
    const db = await getDb();
    _sessionStore = new SessionStore(db);
    db.exec(SESSIONS_TABLE_SQL);
    db.exec(SESSION_EDGES_TABLE_SQL);
  }
  return _sessionStore;
}

async function getFactStore(): Promise<FactStore> {
  if (!_factStore) {
    const db = await getDb();
    _factStore = new FactStore(db);
    _factStore.migrate();
  }
  return _factStore;
}

async function getApprovals(): Promise<ApprovalGuardAdapter> {
  if (!_approvals) {
    const db = await getDb();
    const vault = new SqliteGrantVault(db);
    _approvals = createApprovalGuardAdapter(vault);
  }
  return _approvals;
}

function createApprovalGuardAdapter(vault: GrantVault): ApprovalGuardAdapter {
  return {
    requiresApproval(toolName: string, approvalRequired: boolean): boolean {
      return approvalRequired;
    },
    async checkApproval(
      sessionID: string,
      toolName: string,
      input?: unknown
    ): Promise<{ approved: boolean; reason?: string }> {
      const resource =
        input !== undefined ? JSON.stringify(input).slice(0, 200) : undefined;
      const grant = await vault.check({
        sessionId: sessionID,
        action: toolName,
        resource,
        requestedAt: new Date(),
      });
      if (!grant) return { approved: false, reason: 'no_grant' };
      if (grant.effect === 'deny') return { approved: false, reason: 'denied' };
      if (grant.expiresAt !== undefined && grant.expiresAt < new Date())
        return { approved: false, reason: 'expired' };
      return { approved: true };
    },
  };
}

function getTools(): ToolRegistry {
  if (_tools) return _tools;
  _tools = new ToolRegistry();

  const readTool = makeTool({
    name: 'Read',
    description: 'Read a file from the filesystem',
    riskScore: 'LOW' as ToolRiskScore,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to file' },
        start: {
          type: 'number',
          optional: true,
          description: 'Line to start from (1-indexed)',
        },
        limit: {
          type: 'number',
          optional: true,
          description: 'Max lines to read',
        },
      },
      required: ['path'],
    },
    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const {
        path: filePath,
        start,
        limit,
      } = input as { path: string; start?: number; limit?: number };
      try {
        if (!fs.existsSync(filePath)) {
          return {
            result: { type: 'error', value: `File not found: ${filePath}` },
          };
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const from = Math.max(0, (start ?? 1) - 1);
        const to = limit ? from + limit : lines.length;
        const sliced = lines.slice(from, to);
        const selectedContent = sliced.join('\n');
        return {
          result: {
            type: 'json',
            value: {
              path: filePath,
              content: selectedContent,
              lineCount: lines.length,
              charCount: content.length,
              truncated: content.length > 1_000_000,
            },
          },
        };
      } catch (err) {
        return { result: { type: 'error', value: String(err) } };
      }
    },
  });

  const bashTool = makeTool({
    name: 'Bash',
    description: 'Execute a shell command',
    riskScore: 'CRITICAL' as ToolRiskScore,
    approvalRequired: false,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        workdir: {
          type: 'string',
          optional: true,
          description: 'Working directory',
        },
        timeout: {
          type: 'number',
          optional: true,
          description: 'Timeout in ms (default: 30000)',
        },
      },
      required: ['command'],
    },
    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const {
        command,
        workdir,
        timeout = 30000,
      } = input as { command: string; workdir?: string; timeout?: number };
      const start = Date.now();
      try {
        const proc = spawnSync('/bin/sh', ['-c', command], {
          cwd: workdir,
          stdio: 'pipe',
          timeout,
        });
        const rawOut = proc.stdout ? proc.stdout.toString() : '';
        const rawErr = proc.stderr ? proc.stderr.toString() : '';
        const output = rawOut + (rawErr ? (rawOut ? '\n' : '') + rawErr : '');
        const wallClockMs = Date.now() - start;
        const truncated = output.length > 1_000_000;
        return {
          result: {
            type: 'json',
            value: {
              command,
              cwd: workdir ?? '.',
              exitCode: proc.status,
              output: truncated ? output.slice(0, 1_000_000) : output,
              truncated,
              wallClockMs,
            },
          },
        };
      } catch (err) {
        return { result: { type: 'error', value: String(err) } };
      }
    },
  });

  _tools.register(readTool);
  _tools.register(bashTool);

  return _tools;
}

function createLLMRunner(): LLMRunner {
  const openAIKey = getProviderKey('openai');
  const minimaxKey = getProviderKey('minimax');
  const anthropicKey = getProviderKey('anthropic');
  const adapter: LLMAdapter = createLLM({
    openAIKey,
    minimaxKey,
    anthropicKey,
  });
  return {
    chat(
      model: Model,
      messages: unknown,
      tools?: ReadonlyArray<ToolDefinition>
    ): AsyncGenerator<LLMEvent> {
      const msgs = messages as Array<{ role: string; content: string }>;
      const adapted = [
        { role: 'system' as const, content: [{ type: 'text' as const, text: getSystemPrompt() }] },
        ...msgs.map((m) => ({
          role: m.role,
          content: [{ type: 'text' as const, text: m.content }],
        })),
      ];
      return adapter.chat(
        adapted,
        tools ? { tools } : undefined
      ) as AsyncGenerator<LLMEvent>;
    },
  };
}

function createToolRegistryInterface(
  registry: ToolRegistry
): ToolRegistryInterface {
  return {
    register(
      name: string,
      tool: {
        name: string;
        description: string;
        inputSchema: unknown;
        riskScore: ToolRiskScore;
        execute(input: unknown, context: unknown): Promise<unknown>;
      }
    ): void {
      registry.register({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as import('singularity-tools').JsonSchema,
        riskScore: tool.riskScore,
        execute:
          tool.execute as import('singularity-tools').ToolInstance['execute'],
        approvalRequired: false,
      });
    },
    materialize(permissions?: ReadonlyArray<string>) {
      return registry.materialize();
    },
    get(name: string) {
      return registry.get(name);
    },
  };
}

export async function createEngineDeps(): Promise<EngineDeps> {
  // Lazy-initialize singletons to avoid recreating them on every call
  if (!_llm) {
    _llm = createLLMRunner();
  }
  if (!_approvalStore) {
    _approvalStore = new ApprovalStore();
  }
  const [store, approvals, factStore] = await Promise.all([
    getSessionStore(),
    getApprovals(),
    getFactStore(),
  ]);
  return {
    llm: _llm,
    tools: createToolRegistryInterface(getTools()),
    store: store as unknown as EngineDeps['store'],
    approvalStore: {
      createRequest: (
        sessionId: string,
        callId: string,
        tool: string,
        args: unknown,
        riskScore: string
      ) =>
        _approvalStore?.createRequest(
          sessionId,
          callId,
          tool,
          args,
          riskScore as any
        ) ?? '',
      resolve: (id: string, approved: boolean) =>
        _approvalStore?.resolve(id, approved),
      waitForResolution: (id: string) =>
        _approvalStore?.waitForResolution(id) ?? Promise.resolve(false),
    },
    factStore: factStore as unknown as EngineDeps['factStore'],
  };
}
