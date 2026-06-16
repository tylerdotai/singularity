/**
 * Multi-agent orchestrator for Phase 10
 * Coordinates multiple subagents for complex tasks
 */

import type {
  CreateSubagentTaskContractInput,
  SubagentTaskResult,
} from './contract.js';
import type { SubagentRunner } from './runner.js';

export interface OrchestratorConfig {
  maxConcurrent: number;
  failFast: boolean;
}

export interface OrchestratedTask {
  id: string;
  contract: CreateSubagentTaskContractInput;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: SubagentTaskResult;
  error?: string;
}

export class MultiAgentOrchestrator {
  private runner: SubagentRunner;
  private tasks: Map<string, OrchestratedTask> = new Map();
  private config: OrchestratorConfig;

  constructor(
    runner: SubagentRunner,
    config: OrchestratorConfig = { maxConcurrent: 3, failFast: false }
  ) {
    this.runner = runner;
    this.config = config;
  }

  async runTasks(
    contracts: CreateSubagentTaskContractInput[]
  ): Promise<SubagentTaskResult[]> {
    const results: SubagentTaskResult[] = [];
    const tasks: OrchestratedTask[] = contracts.map((c) => ({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      contract: c,
      status: 'pending',
    }));

    for (const t of tasks) {
      this.tasks.set(t.id, t);
    }

    const batches = Math.ceil(contracts.length / this.config.maxConcurrent);

    for (let i = 0; i < batches; i++) {
      const batch = tasks.slice(
        i * this.config.maxConcurrent,
        (i + 1) * this.config.maxConcurrent
      );
      const batchPromises = batch.map(async (task) => {
        task.status = 'running';
        try {
          const result = await this.runner.run(task.contract);
          task.status = 'completed';
          task.result = result;
          return result;
        } catch (err) {
          task.status = 'failed';
          task.error = err instanceof Error ? err.message : String(err);
          if (this.config.failFast) {
            throw err;
          }
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(
        ...batchResults.filter((r): r is SubagentTaskResult => r !== null)
      );

      if (this.config.failFast && results.length < batch.length) {
        break;
      }
    }

    return results;
  }

  getTaskStatus(taskId: string): OrchestratedTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): OrchestratedTask[] {
    return Array.from(this.tasks.values());
  }

  getCompletedCount(): number {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'completed'
    ).length;
  }

  getFailedCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'failed')
      .length;
  }
}
