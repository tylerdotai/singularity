// Fallback pool for singularity-llm
// callWithFallback: primary → fallback on retryable provider error

import { ProviderError } from './errors.js';
import type { LLMAdapter } from './router.js';
import type { LLMEvent, Message, ToolDefinition } from './types.js';

export interface FallbackConfig {
  primary: { adapter: LLMAdapter; model: string };
  fallback?: { adapter: LLMAdapter; model: string };
}

export async function* callWithFallback(
  config: FallbackConfig,
  messages: ReadonlyArray<Message>,
  tools?: ReadonlyArray<ToolDefinition>
): AsyncGenerator<LLMEvent> {
  let primaryIterator: AsyncIterator<LLMEvent, void, unknown>;
  try {
    primaryIterator = config.primary.adapter
      .chat(messages, { tools })
      [Symbol.asyncIterator]() as AsyncIterator<LLMEvent, void, unknown>;
    let primaryResult = await primaryIterator.next();
    while (!primaryResult.done) {
      yield primaryResult.value as LLMEvent;
      primaryResult = await primaryIterator.next();
    }
    return;
  } catch (primaryError: unknown) {
    if (
      primaryError instanceof ProviderError &&
      primaryError.retryable === true &&
      config.fallback
    ) {
      const fallbackIterator = config.fallback.adapter
        .chat(messages, { tools })
        [Symbol.asyncIterator]() as AsyncIterator<LLMEvent, void, unknown>;
      let fallbackResult = await fallbackIterator.next();
      while (!fallbackResult.done) {
        yield fallbackResult.value as LLMEvent;
        fallbackResult = await fallbackIterator.next();
      }
      return;
    }
    if (primaryError instanceof ProviderError) {
      throw primaryError;
    }
    throw new ProviderError(
      primaryError instanceof Error
        ? primaryError.message
        : String(primaryError),
      'primary_failed',
      false
    );
  }
}
