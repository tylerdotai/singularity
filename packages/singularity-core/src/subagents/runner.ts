/**
 * SubagentRunner — Phase 10. Executes subagent tasks with work isolation.
 * Integrates with WorktreeRunner when workIsolation.kind='worktree'.
 */

import { WorktreeRunner } from '../workspace/worktree.js';
import type {
  CreateSubagentTaskContractInput,
  SubagentTaskContract,
  SubagentTaskResult,
} from './contract.js';

// Local copy of ToolDefinition to avoid circular dependency
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

export interface SubagentRunnerDeps {
  llmAdapter?: {
    provider: 'openai' | 'anthropic' | 'minimax';
    model: string;
    chat(
      messages: ReadonlyArray<{
        role: string;
        content: ReadonlyArray<unknown>;
      }>,
      options?: {
        tools?: ReadonlyArray<ToolDefinition>;
        generation?: { maxTokens?: number; temperature?: number };
      }
    ): AsyncGenerator<{ type: string; text?: string; [key: string]: unknown }>;
  };
  tools?: ToolDefinition[];
  eventHub?: {
    emit: (event: { type: string; [key: string]: unknown }) => void;
  };
}

export class SubagentRuntimeError extends Error {
  readonly name = 'SubagentRuntimeError';
  constructor(
    public readonly taskId: string,
    public readonly cause: string
  ) {
    super(`Subagent task ${taskId} failed: ${cause}`);
  }
}

export class SubagentRunner {
  private deps: SubagentRunnerDeps;
  private activeTasks: Map<string, SubagentTaskContract> = new Map();

  constructor(deps: SubagentRunnerDeps = {}) {
    this.deps = deps;
  }

  async run(
    input: CreateSubagentTaskContractInput
  ): Promise<SubagentTaskResult> {
    const contract = normalizeInput(input);
    this.activeTasks.set(contract.id, contract);

    this.deps.eventHub?.emit({
      type: 'loop.started',
      loopId: contract.id,
      goal: contract.goal,
    });

    try {
      const result = await this.executeWithIsolation(contract);
      this.activeTasks.delete(contract.id);

      this.deps.eventHub?.emit({
        type: 'loop.completed',
        loopId: contract.id,
        goal: contract.goal,
        success: result.status === 'completed',
      });

      return result;
    } catch (err) {
      this.activeTasks.delete(contract.id);
      throw err;
    }
  }

  private async executeWithIsolation(
    contract: SubagentTaskContract
  ): Promise<SubagentTaskResult> {
    if (contract.workIsolation.kind === 'none') {
      return this.executeInline(contract);
    }

    if (contract.workIsolation.kind === 'worktree') {
      return this.executeInWorktree(contract);
    }

    // sandbox kind - stub for Phase 10.1
    return this.executeInline(contract);
  }

  private async executeInline(
    contract: SubagentTaskContract
  ): Promise<SubagentTaskResult> {
    if (!this.deps.llmAdapter) {
      throw new SubagentRuntimeError(
        contract.id,
        'No LLM adapter configured. SubagentRunner requires an llmAdapter to be provided at construction. Stub mode is not available in production.'
      );
    }

    const messages: ReadonlyArray<{
      role: string;
      content: ReadonlyArray<unknown>;
    }> = [
      {
        role: 'user',
        content: [{ type: 'text' as const, text: contract.goal }],
      },
    ];

    let fullText = '';
    for await (const event of this.deps.llmAdapter.chat(messages, {
      tools: this.deps.tools?.filter((t) =>
        contract.allowedTools?.includes(t.name)
      ),
      generation: {
        maxTokens: 2000,
        temperature: contract.modelPolicy.temperature,
      },
    })) {
      if (event.type === 'text-delta' && event.text) {
        fullText += event.text;
      }
    }

    return {
      contractId: contract.id,
      status: 'completed',
      summary: fullText.slice(0, 200),
      artifacts: [],
    };
  }

  private async executeInWorktree(
    contract: SubagentTaskContract
  ): Promise<SubagentTaskResult> {
    const isolation = contract.workIsolation;
    const worktreePath =
      isolation.kind === 'worktree' && isolation.basePath
        ? isolation.basePath
        : process.cwd();
    const runner = new WorktreeRunner(worktreePath, contract.id);

    const actionResult = await runner.run({
      attempt: 0,
      goal: contract.goal,
      maxIterations: contract.maxTurns,
      context: { summary: contract.context.summary },
      previousFeedback: '',
      history: [],
    });

    return {
      contractId: contract.id,
      status: 'completed',
      summary: actionResult.output.slice(0, 200),
      artifacts: Array.isArray(actionResult.metadata?.artifacts)
        ? actionResult.metadata.artifacts.map((a: unknown) => ({
            kind: 'summary' as const,
            value: String(a),
          }))
        : [],
    };
  }

  getActiveTask(taskId: string): SubagentTaskContract | undefined {
    return this.activeTasks.get(taskId);
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }
}

function normalizeInput(
  input: CreateSubagentTaskContractInput
): SubagentTaskContract {
  return {
    id: input.id ?? `subtask_${Date.now().toString(36)}`,
    goal: input.goal,
    context:
      typeof input.context === 'string'
        ? { summary: input.context }
        : { ...input.context },
    allowedTools: [...(input.allowedTools ?? [])],
    modelPolicy: { ...(input.modelPolicy ?? {}) },
    workIsolation: { ...(input.workIsolation ?? { kind: 'none' }) },
    resultSchema: { ...(input.resultSchema ?? { kind: 'text' }) },
    maxTurns: input.maxTurns ?? 20,
    profileId: input.profileId,
    parentSessionId: input.parentSessionId,
    agentId: input.agentId,
    reviewerRole: input.reviewerRole,
    metadata: input.metadata,
  };
}
