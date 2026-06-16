// Token accounting for singularity-llm
// SessionUsage tracks cumulative token usage across providers

import type { Usage } from './types.js';

export interface SessionUsage {
  openai?: Usage;
  anthropic?: Usage;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export class UsageTracker {
  private usage: SessionUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
  };

  record(usage: Usage, provider?: 'openai' | 'anthropic'): void {
    // Accumulate into provider-specific slot
    if (provider === 'openai' || provider === 'anthropic') {
      const existing = this.usage[provider];
      this.usage[provider] = {
        inputTokens: (existing?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
        outputTokens: (existing?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        totalTokens: (existing?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
        reasoningTokens: usage.reasoningTokens,
      };
    }

    // Also accumulate into totals
    this.usage.totalInputTokens += usage.inputTokens ?? 0;
    this.usage.totalOutputTokens += usage.outputTokens ?? 0;
    this.usage.totalTokens += usage.totalTokens ?? 0;
  }

  get(): SessionUsage {
    return { ...this.usage };
  }

  reset(): void {
    this.usage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    };
  }
}
