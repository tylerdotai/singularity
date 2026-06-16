export type SubagentMetadataValue = string | number | boolean | null;

export type SubagentContextReferenceKind =
  | 'file'
  | 'url'
  | 'session'
  | 'profile'
  | 'artifact';

export interface SubagentContextReference {
  readonly kind: SubagentContextReferenceKind;
  readonly value: string;
  readonly description?: string;
}

export interface SubagentContext {
  readonly summary: string;
  readonly references?: readonly SubagentContextReference[];
}

export interface SubagentModelPolicy {
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: 'low' | 'medium' | 'high';
  readonly temperature?: number;
}

export type SubagentWorkIsolation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'worktree';
      readonly basePath?: string;
      readonly branchName?: string;
      readonly reuseExisting?: boolean;
    }
  | { readonly kind: 'sandbox'; readonly rootPath?: string };

export type SubagentResultSchema =
  | { readonly kind: 'text' }
  | { readonly kind: 'json'; readonly requiredFields?: readonly string[] };

export interface SubagentTaskContract {
  readonly id: string;
  readonly goal: string;
  readonly context: SubagentContext;
  readonly allowedTools: readonly string[];
  readonly modelPolicy: SubagentModelPolicy;
  readonly workIsolation: SubagentWorkIsolation;
  readonly resultSchema: SubagentResultSchema;
  readonly maxTurns: number;
  readonly profileId?: string;
  readonly parentSessionId?: string;
  readonly agentId?: string;
  readonly reviewerRole?: string;
  readonly metadata?: Readonly<Record<string, SubagentMetadataValue>>;
}

export interface CreateSubagentTaskContractInput {
  readonly id?: string;
  readonly goal: string;
  readonly context: string | SubagentContext;
  readonly allowedTools?: readonly string[];
  readonly modelPolicy?: SubagentModelPolicy;
  readonly workIsolation?: SubagentWorkIsolation;
  readonly resultSchema?: SubagentResultSchema;
  readonly maxTurns?: number;
  readonly profileId?: string;
  readonly parentSessionId?: string;
  readonly agentId?: string;
  readonly reviewerRole?: string;
  readonly metadata?: Readonly<Record<string, SubagentMetadataValue>>;
}

export type SubagentTaskStatus = 'completed' | 'failed' | 'cancelled';

export interface SubagentTaskArtifact {
  readonly kind: 'file' | 'url' | 'log' | 'summary';
  readonly value: string;
  readonly description?: string;
}

export interface SubagentTaskResult {
  readonly contractId: string;
  readonly status: SubagentTaskStatus;
  readonly summary: string;
  readonly artifacts: readonly SubagentTaskArtifact[];
  readonly metadata?: Readonly<Record<string, SubagentMetadataValue>>;
  readonly error?: string;
}

export const DEFAULT_SUBAGENT_MAX_TURNS = 20;
export const MIN_SUBAGENT_MAX_TURNS = 1;
export const MAX_SUBAGENT_MAX_TURNS = 100;
export const MAX_SUBAGENT_GOAL_LENGTH = 2_000;
export const MAX_SUBAGENT_CONTEXT_LENGTH = 20_000;
