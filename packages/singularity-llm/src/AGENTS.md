# singularity-llm

Provider-neutral LLM client layer. Phase 20 of the singularity fork — full provider implementations with SSE streaming.

## What this package does

- Defines the canonical `LLMRequest` / `Message` / `ContentPart` / `LLMEvent` type surface for the singularity harness
- Ships an async-iterable `llm*` streaming interface consumed by the agent engine
- Ships `ProviderError`, `ContextOverflowError`, and `ToolFailure` error classes
- Ships `ToolDefinition` / `ToolResultValue` / `ToolChoice` shapes
- Ships `Model`, `ProviderConfig`, `Usage`, `FinishReason`, `GenerationOptions`, `ProviderOptions`, and `CachePolicy` types

## What this package does NOT do (yet)

- No live HTTP calls — plain `fetch` only, no SDK imports
- No OpenAI / Anthropic / Ollama adapter implementations — those land in sibling packages
- No Effect dependency — pure TypeScript only
- No `@opencode-ai/llm` imports

## Design notes

- All public types are exported from `src/index.ts` via re-exports from `src/types.ts` and `src/errors.ts`
- `LLMEvent` is a closed discriminated union — every variant has a `type` field
- `ContentPart` is a closed union: `TextPart`, `ToolCallPart`, `ToolResultPart`, `ReasoningPart`
- `ToolResultValue` is a closed union: `json`, `text`, `error`, `content`
- `CachePolicy` supports both string shorthand (`"auto" | "none"`) and structured object form
- No `bin` field — CLI entry points land in later phases