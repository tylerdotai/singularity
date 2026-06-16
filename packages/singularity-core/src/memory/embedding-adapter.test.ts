// Phase 2.3 — `NoopEmbeddingAdapter` + `LLMUnreachableError` unit tests.
//
// The seven `it(...)` blocks below cover the public surface of
// `embedding-adapter.ts`:
//   1. default `embed` shape (768-dim zero vector + model name)
//   2. `embed` is sync-resolved (returns an already-settled Promise)
//   3. `embed` is shape-stable across both `EmbeddingKind` values
//   4. custom `dimensions` constructor arg
//   5. custom `modelName` constructor arg
//   6. `isAvailable` always true (the noop never fails)
//   7. `LLMUnreachableError` with cause (bonus)
//   8. `LLMUnreachableError` without cause (bonus)
//
// Mirrors the structure and style of `facts.test.ts` (Phase 2.1): no
// fixtures, no `beforeEach`, no async setup. The noop adapter is
// pure and stateless, so each test can instantiate a fresh adapter
// inline.

import { describe, expect, it } from 'bun:test';

import {
  type EmbedResult,
  LLMUnreachableError,
  NOOP_DEFAULT_DIMENSIONS,
  NOOP_DEFAULT_MODEL,
  NoopEmbeddingAdapter,
} from './embedding-adapter.ts';

describe('NoopEmbeddingAdapter', () => {
  it('embed returns a 768-dim Float32Array of zeros with the default model name', async () => {
    const adapter = new NoopEmbeddingAdapter();
    const result = await adapter.embed('test input', 'query');
    expect(result.vector).toBeInstanceOf(Float32Array);
    expect(result.vector.length).toBe(768);
    expect(NOOP_DEFAULT_DIMENSIONS).toBe(768);
    // Every byte is 0.
    const allZero = Array.from(result.vector).every((v) => v === 0);
    expect(allZero).toBe(true);
    expect(result.model).toBe('noop://zero-vector-768');
    expect(NOOP_DEFAULT_MODEL).toBe('noop://zero-vector-768');
  });

  it('embed is synchronous (returns a Promise that resolves without awaiting)', async () => {
    const adapter = new NoopEmbeddingAdapter();
    const result = adapter.embed('test', 'document');
    // The result IS a Promise (the contract), but it's already resolved
    // because the noop implementation does no async work.
    expect(result).toBeInstanceOf(Promise);
    const awaited = await result;
    expect(awaited.model).toBe('noop://zero-vector-768');
  });

  it('embed returns the same shape for both EmbeddingKind values', async () => {
    const adapter = new NoopEmbeddingAdapter();
    const queryResult = await adapter.embed('test', 'query');
    const documentResult = await adapter.embed('test', 'document');
    // Same dimensions, same model name, same all-zero content.
    expect(queryResult.vector.length).toBe(documentResult.vector.length);
    expect(queryResult.model).toBe(documentResult.model);
    expect(Array.from(queryResult.vector).every((v) => v === 0)).toBe(true);
    expect(Array.from(documentResult.vector).every((v) => v === 0)).toBe(true);
  });

  it('accepts a custom dimensions constructor arg', async () => {
    const adapter = new NoopEmbeddingAdapter(384);
    const result = await adapter.embed('test', 'query');
    expect(result.vector.length).toBe(384);
    expect(NOOP_DEFAULT_DIMENSIONS).toBe(768); // default is unchanged
  });

  it('accepts a custom modelName constructor arg', async () => {
    const adapter = new NoopEmbeddingAdapter(768, 'custom://model-name');
    const result = await adapter.embed('test', 'query');
    expect(result.model).toBe('custom://model-name');
  });

  it('isAvailable returns true (the noop is always available)', async () => {
    const adapter = new NoopEmbeddingAdapter();
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  // BONUS: LLMUnreachableError class
  it('LLMUnreachableError is a class with provider + cause fields', () => {
    const innerErr = new Error('connection refused');
    const err = new LLMUnreachableError('test-provider', innerErr);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LLMUnreachableError);
    expect(err.name).toBe('LLMUnreachableError');
    expect(err.provider).toBe('test-provider');
    expect(err.cause).toBe(innerErr);
    expect(err.message).toBe('LLM unreachable: test-provider');
  });

  // BONUS: LLMUnreachableError without cause is OK
  it('LLMUnreachableError without cause is OK (cause is optional)', () => {
    const err = new LLMUnreachableError('test-provider');
    expect(err).toBeInstanceOf(LLMUnreachableError);
    expect(err.provider).toBe('test-provider');
    expect(err.cause).toBeUndefined();
    expect(err.message).toBe('LLM unreachable: test-provider');
  });
});
