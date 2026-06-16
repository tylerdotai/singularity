/**
 * singularity-engine — context compaction.
 *
 * Triggers LLM summarization when token buffer approaches context window.
 * Keeps newest messages up to keepTokens, summarizes older ones.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

import type { LLMEvent } from 'singularity-llm';
import type { CompactionConfig } from './types.js';

// ─── CompactionMessage ────────────────────────────────────────────────────────

export interface CompactionMessage {
  type: 'compaction';
  summary: string;
  originalMessageCount: number;
  summarizedAt: number;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Estimate token count using a character-based heuristic.
 * Approximation: 1 token ≈ 4 characters for English text.
 */
function estimateTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    // Role overhead (approximate)
    total += msg.role.length + 4;
    // Content
    total += msg.content.length;
  }
  return Math.ceil(total / 4);
}

// ─── CompactionManager ────────────────────────────────────────────────────────

export class CompactionManager {
  private readonly config: CompactionConfig;

  constructor(config: CompactionConfig) {
    this.config = config;
  }

  /**
   * Check if compaction is needed based on current token count.
   */
  check(tokenCount: number): boolean {
    const { bufferSize, contextWindow } = this.config;
    return tokenCount > contextWindow - bufferSize;
  }

  /**
   * Compact messages: keep newest up to keepTokens, summarize older via LLM.
   *
   * Returns { compactedMessages, summary } where compactedMessages includes
   * an injected CompactionMessage at the boundary.
   */
  async compact(
    messages: Array<{ role: string; content: string }>,
    llm: {
      chat(
        model: string,
        messages: Array<{ role: string; content: string }>,
        tools?: ReadonlyArray<unknown>
      ): AsyncGenerator<LLMEvent>;
      model?: string;
    },
    model?: string
  ): Promise<{
    compactedMessages: Array<{ role: string; content: string }>;
    summary: string;
  }> {
    const { keepTokens, summaryTokens } = this.config;

    const tokenCount = estimateTokens(messages);
    if (!this.check(tokenCount)) {
      return { compactedMessages: messages, summary: '' };
    }

    // Separate messages to keep vs summarize
    // Strategy: keep newest messages, summarize oldest
    const toSummarize: Array<{ role: string; content: string }> = [];
    const toKeep: Array<{ role: string; content: string }> = [];

    let runningTokens = 0;
    // Iterate newest-first to find the keep boundary
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = estimateTokens([msg]);
      if (runningTokens + msgTokens <= keepTokens) {
        toKeep.unshift(msg);
        runningTokens += msgTokens;
      } else {
        toSummarize.unshift(...messages.slice(0, i + 1));
        break;
      }
    }

    if (toSummarize.length === 0) {
      return { compactedMessages: messages, summary: '' };
    }

    // Build summarization prompt
    const summaryPrompt = `Summarize the following conversation concisely, preserving key facts, decisions, and context. Aim for about ${summaryTokens} tokens:\n\n${toSummarize.map((m) => `${m.role}: ${m.content}`).join('\n')}`;

    // Call LLM for summary
    let summary = '[summary unavailable]';
    try {
      const chatModel = model ?? llm.model ?? 'gpt-4o';
      const stream = llm.chat(chatModel, [
        { role: 'user', content: summaryPrompt },
      ]);

      let summaryDelta = '';
      for await (const event of stream) {
        if (event.type === 'text-delta') {
          summaryDelta += event.text;
        } else if (event.type === 'finish') {
          break;
        }
      }
      summary = summaryDelta.trim() || '[empty summary]';
    } catch {
      summary = '[summary unavailable due to LLM error]';
    }

    // Build compacted message list
    const compactionMessage: CompactionMessage = {
      type: 'compaction',
      summary,
      originalMessageCount: toSummarize.length,
      summarizedAt: Date.now(),
    };

    const compactedMessages = [
      ...toSummarize.map((m) => ({ ...m, _compacted: true as const })),
      {
        role: 'system' as const,
        content: JSON.stringify(compactionMessage),
        _compacted: true as const,
      },
      ...toKeep,
    ];

    return {
      compactedMessages: compactedMessages as Array<{
        role: string;
        content: string;
      }>,
      summary,
    };
  }

  /**
   * Get the effective config.
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  /**
   * Get summary token limit.
   */
  getSummaryTokenLimit(): number {
    return this.config.summaryTokens;
  }
}
