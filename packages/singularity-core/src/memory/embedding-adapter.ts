// Phase 2.3 — Embedding adapter interface + NoopEmbeddingAdapter default.
//
// Provider-neutral embedding interface for the singularity-core memory
// subsystem. Mirrors nlm-memory's `LLMClient.embed` shape
// (nlm-memory/src/ports/llm-client.ts:65-77) so the Singularity MCP/HTTP
// stack can wrap any embedder (Ollama, OpenAI, Anthropic, etc.) without
// changing downstream code.
//
// Per IMPLEMENTATION_PLAN.md line 204: this module does NOT depend on
// `sqlite-memory` (license review pending). It also does NOT implement
// any live embedder (Ollama/OpenAI/Anthropic). Per Phase 2.0 follow-up #3,
// the wrap-vs-author decision is deferred to a future phase. Phase 2.3 ships:
//   - the interface contract
//   - a noop default that returns a 768-dim zero vector (matches nlm-memory's
//     nomic-embed-text default dimensionality)
//   - an LLMUnreachableError class for future live implementations to throw
//
// The recall layer is expected to detect all-zero embeddings and route to
// keyword-only search (LIKE or FTS5) as a fallback. The noop default is the
// baseline behavior; downstream callers can swap in a real embedder later.

export type EmbeddingKind = 'query' | 'document';

export interface EmbedResult {
  readonly vector: Float32Array;
  readonly model: string;
}

export class LLMUnreachableError extends Error {
  readonly provider: string;
  override readonly cause?: unknown;
  constructor(provider: string, cause?: unknown) {
    super(`LLM unreachable: ${provider}`);
    this.name = 'LLMUnreachableError';
    this.provider = provider;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export interface EmbeddingAdapter {
  embed(text: string, kind: EmbeddingKind): Promise<EmbedResult>;
  isAvailable(): Promise<boolean>;
}

export const NOOP_DEFAULT_DIMENSIONS = 768;
export const NOOP_DEFAULT_MODEL = 'noop://zero-vector-768';

export class NoopEmbeddingAdapter implements EmbeddingAdapter {
  private readonly dimensions: number;
  private readonly modelName: string;

  constructor(dimensions?: number, modelName?: string) {
    this.dimensions = dimensions ?? NOOP_DEFAULT_DIMENSIONS;
    this.modelName = modelName ?? NOOP_DEFAULT_MODEL;
  }

  embed(_text: string, _kind: EmbeddingKind): Promise<EmbedResult> {
    const vector = new Float32Array(this.dimensions);
    return Promise.resolve({ vector, model: this.modelName });
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model = 'text-embedding-3-small',
    baseUrl = 'https://api.openai.com/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async embed(text: string, _kind: EmbeddingKind): Promise<EmbedResult> {
    const response = (await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    })) as {
      ok: boolean;
      json: () => Promise<unknown>;
      text: () => Promise<string>;
    };

    if (!response.ok) {
      throw new LLMUnreachableError('openai', await response.text());
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    const embedding = data.data[0]?.embedding;
    if (!embedding) {
      throw new LLMUnreachableError('openai', 'No embedding returned');
    }

    return { vector: new Float32Array(embedding), model: this.model };
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
