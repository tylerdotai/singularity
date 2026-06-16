/**
 * singularity-engine — PromptCacheManager tests.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PromptCacheManager } from './cache.js';

describe('PromptCacheManager', () => {
  let cache: PromptCacheManager;

  beforeEach(() => {
    cache = new PromptCacheManager();
  });

  // ─── Tool Result Cache Tests ─────────────────────────────────────────────

  describe('tool result cache', () => {
    it('should return undefined on miss initially', () => {
      const result = cache.getCachedToolResult('myTool', 'abc123');
      expect(result).toBeUndefined();
    });

    it('should return cached result after set', () => {
      cache.setCachedToolResult('myTool', 'abc123', { output: 'test' });
      const result = cache.getCachedToolResult('myTool', 'abc123');
      expect(result).toBeDefined();
      expect(result?.value).toEqual({ output: 'test' });
    });

    it('should increment hitCount on reuse', () => {
      cache.setCachedToolResult('myTool', 'abc123', { output: 'test' });
      cache.getCachedToolResult('myTool', 'abc123');
      cache.getCachedToolResult('myTool', 'abc123');
      const result = cache.getCachedToolResult('myTool', 'abc123');
      expect(result?.hitCount).toBe(3);
    });

    it('should return different results for different tool names', () => {
      cache.setCachedToolResult('toolA', 'abc123', { output: 'A' });
      cache.setCachedToolResult('toolB', 'abc123', { output: 'B' });
      const resultA = cache.getCachedToolResult('toolA', 'abc123');
      const resultB = cache.getCachedToolResult('toolB', 'abc123');
      expect(resultA?.value).toEqual({ output: 'A' });
      expect(resultB?.value).toEqual({ output: 'B' });
    });

    it('should return different results for different input hashes', () => {
      cache.setCachedToolResult('myTool', 'inputA', { output: 'A' });
      cache.setCachedToolResult('myTool', 'inputB', { output: 'B' });
      const resultA = cache.getCachedToolResult('myTool', 'inputA');
      const resultB = cache.getCachedToolResult('myTool', 'inputB');
      expect(resultA?.value).toEqual({ output: 'A' });
      expect(resultB?.value).toEqual({ output: 'B' });
    });

    it('should track miss after reset', () => {
      cache.setCachedToolResult('myTool', 'abc123', { output: 'test' });
      cache.reset();
      const result = cache.getCachedToolResult('myTool', 'abc123');
      expect(result).toBeUndefined();
    });

    it('should enforce max entries by evicting oldest', () => {
      const smallCache = new PromptCacheManager({ maxToolCacheEntries: 3 });

      smallCache.setCachedToolResult('tool1', 'in1', { n: 1 });
      smallCache.setCachedToolResult('tool2', 'in2', { n: 2 });
      smallCache.setCachedToolResult('tool3', 'in3', { n: 3 });

      // This should trigger eviction since we're at capacity
      smallCache.setCachedToolResult('tool4', 'in4', { n: 4 });

      // tool1 should be evicted (oldest)
      const result1 = smallCache.getCachedToolResult('tool1', 'in1');
      expect(result1).toBeUndefined();

      // Others should still be accessible
      const result2 = smallCache.getCachedToolResult('tool2', 'in2');
      expect(result2?.value).toEqual({ n: 2 });
    });
  });

  // ─── Summary Cache Tests ─────────────────────────────────────────────────

  describe('summary cache', () => {
    it('should return undefined on miss initially', () => {
      const result = cache.getCachedSummary('hash123');
      expect(result).toBeUndefined();
    });

    it('should return cached summary after set', () => {
      cache.setCachedSummary('hash123', 'This is a summary', 5);
      const result = cache.getCachedSummary('hash123');
      expect(result).toBeDefined();
      expect(result?.summary).toBe('This is a summary');
      expect(result?.originalMessageCount).toBe(5);
    });

    it('should track stats correctly for summary hits', () => {
      cache.setCachedSummary('hash123', 'Summary', 5);
      cache.getCachedSummary('hash123');
      cache.getCachedSummary('hash123');

      const stats = cache.getStats();
      expect(stats.summaryHits).toBe(2);
      expect(stats.summaryMisses).toBe(0);
    });

    it('should respect TTL and expire entries', async () => {
      const shortTTLCache = new PromptCacheManager({ summaryCacheTTL: 50 });

      shortTTLCache.setCachedSummary('hash123', 'Summary', 5);

      // Should be available immediately
      const result1 = shortTTLCache.getCachedSummary('hash123');
      expect(result1).toBeDefined();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be expired now
      const result2 = shortTTLCache.getCachedSummary('hash123');
      expect(result2).toBeUndefined();
    });

    it('should not expire when TTL is 0 (session lifetime)', () => {
      const noExpiryCache = new PromptCacheManager({ summaryCacheTTL: 0 });

      noExpiryCache.setCachedSummary('hash123', 'Summary', 5);

      // Wait a bit
      new Promise((resolve) => setTimeout(resolve, 10));

      // Should still be available
      const result = noExpiryCache.getCachedSummary('hash123');
      expect(result).toBeDefined();
    });
  });

  // ─── Hash Computation Tests ──────────────────────────────────────────────

  describe('computeMessagesHash', () => {
    it('should produce same hash for same messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const hash1 = cache.computeMessagesHash(messages);
      const hash2 = cache.computeMessagesHash(messages);
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of message order', () => {
      const messages1 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const messages2 = [
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Hello' },
      ];
      const hash1 = cache.computeMessagesHash(messages1);
      const hash2 = cache.computeMessagesHash(messages2);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different messages', () => {
      const messages1 = [{ role: 'user', content: 'Hello' }];
      const messages2 = [{ role: 'user', content: 'Goodbye' }];
      const hash1 = cache.computeMessagesHash(messages1);
      const hash2 = cache.computeMessagesHash(messages2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeInputHash', () => {
    it('should produce same hash for same input', () => {
      const input = { foo: 'bar', num: 42 };
      const hash1 = cache.computeInputHash(input);
      const hash2 = cache.computeInputHash(input);
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash for string input', () => {
      const hash1 = cache.computeInputHash('hello world');
      const hash2 = cache.computeInputHash('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different input', () => {
      const hash1 = cache.computeInputHash({ a: 1 });
      const hash2 = cache.computeInputHash({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash regardless of key order in objects', () => {
      const hash1 = cache.computeInputHash({ a: 1, b: 2 });
      const hash2 = cache.computeInputHash({ b: 2, a: 1 });
      expect(hash1).toBe(hash2);
    });
  });

  // ─── Stats Tests ─────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should track tool hits and misses correctly', () => {
      // Miss
      cache.getCachedToolResult('tool', 'input');

      // Set and hit
      cache.setCachedToolResult('tool', 'input', { result: 'ok' });
      cache.getCachedToolResult('tool', 'input');
      cache.getCachedToolResult('tool', 'input');

      const stats = cache.getStats();
      expect(stats.toolMisses).toBe(1);
      expect(stats.toolHits).toBe(2);
      expect(stats.toolCacheSize).toBe(1);
    });

    it('should track summary hits and misses correctly', () => {
      // Miss
      cache.getCachedSummary('hash1');

      // Set and hit
      cache.setCachedSummary('hash2', 'Summary', 5);
      cache.getCachedSummary('hash2');

      const stats = cache.getStats();
      expect(stats.summaryMisses).toBe(1);
      expect(stats.summaryHits).toBe(1);
    });

    it('should return zeros after reset', () => {
      cache.setCachedToolResult('tool', 'input', { result: 'ok' });
      cache.getCachedToolResult('tool', 'input');
      cache.reset();

      const stats = cache.getStats();
      expect(stats.toolHits).toBe(0);
      expect(stats.toolMisses).toBe(0);
      expect(stats.summaryHits).toBe(0);
      expect(stats.summaryMisses).toBe(0);
      expect(stats.toolCacheSize).toBe(0);
    });
  });

  // ─── Reset Tests ────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all caches', () => {
      cache.setCachedToolResult('tool', 'input', { result: 'ok' });
      cache.setCachedSummary('hash', 'Summary', 5);
      cache.storeResponseForCache('http-key', 'body', {
        'Cache-Control': 'max-age=3600',
      });

      cache.reset();

      expect(cache.getCachedToolResult('tool', 'input')).toBeUndefined();
      expect(cache.getCachedSummary('hash')).toBeUndefined();
      expect(cache.getStoredResponse('http-key')).toBeUndefined();
    });

    it('should reset stats to zero', () => {
      cache.getCachedToolResult('tool', 'input');
      cache.setCachedToolResult('tool', 'input', { result: 'ok' });
      cache.getCachedToolResult('tool', 'input');
      cache.reset();

      const stats = cache.getStats();
      expect(stats.toolHits).toBe(0);
      expect(stats.toolMisses).toBe(0);
    });
  });

  // ─── Cache-Control Tests ─────────────────────────────────────────────────

  describe('Cache-Control parsing', () => {
    it('should parse max-age correctly', () => {
      const headers = { 'Cache-Control': 'max-age=3600' };
      const canCache = cache.shouldUseCachedResponse(headers);
      expect(canCache).toBe(true);
    });

    it('should prevent caching with no-store', () => {
      const headers = { 'Cache-Control': 'no-store' };
      const canCache = cache.shouldUseCachedResponse(headers);
      expect(canCache).toBe(false);
    });

    it('should prevent caching with no-store and max-age', () => {
      const headers = { 'Cache-Control': 'no-store, max-age=3600' };
      const canCache = cache.shouldUseCachedResponse(headers);
      expect(canCache).toBe(false);
    });

    it('should return false for missing Cache-Control header', () => {
      const headers = {};
      const canCache = cache.shouldUseCachedResponse(headers);
      expect(canCache).toBe(false);
    });

    it('should handle cache-control case-insensitively', () => {
      const headers1 = { 'cache-control': 'max-age=3600' };
      const headers2 = { 'CACHE-CONTROL': 'max-age=3600' };
      expect(cache.shouldUseCachedResponse(headers1)).toBe(true);
      expect(cache.shouldUseCachedResponse(headers2)).toBe(true);
    });
  });

  describe('HTTP response caching', () => {
    it('should store and retrieve HTTP response', () => {
      cache.storeResponseForCache('my-key', '{"data":"test"}', {
        'Cache-Control': 'max-age=3600',
      });

      const stored = cache.getStoredResponse('my-key');
      expect(stored).toBeDefined();
      expect(stored?.body).toBe('{"data":"test"}');
    });

    it('should return undefined for non-existent key', () => {
      const stored = cache.getStoredResponse('non-existent');
      expect(stored).toBeUndefined();
    });

    it('should respect max-age for expiry', async () => {
      const shortCache = new PromptCacheManager();
      shortCache.storeResponseForCache('short-key', 'body', {
        'Cache-Control': 'max-age=1',
      });

      // Should be available immediately
      const result1 = shortCache.getStoredResponse('short-key');
      expect(result1).toBeDefined();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired
      const result2 = shortCache.getStoredResponse('short-key');
      expect(result2).toBeUndefined();
    });
  });

  describe('evictExpiredResponses', () => {
    it('should remove expired entries', async () => {
      const evictCache = new PromptCacheManager();
      evictCache.storeResponseForCache('expired-key', 'body', {
        'Cache-Control': 'max-age=1',
      });

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      evictCache.evictExpiredResponses();

      const result = evictCache.getStoredResponse('expired-key');
      expect(result).toBeUndefined();
    });

    it('should not remove non-expired entries', () => {
      const validCache = new PromptCacheManager();
      validCache.storeResponseForCache('valid-key', 'body', {
        'Cache-Control': 'max-age=3600',
      });

      validCache.evictExpiredResponses();

      const result = validCache.getStoredResponse('valid-key');
      expect(result).toBeDefined();
    });
  });

  // ─── Cache Key Utility Tests ──────────────────────────────────────────────

  describe('getCacheKey', () => {
    it('should return same as computeMessagesHash', () => {
      const messages = [{ role: 'user', content: 'test' }];
      const cacheKey = cache.getCacheKey(messages);
      const messagesHash = cache.computeMessagesHash(messages);
      expect(cacheKey).toBe(messagesHash);
    });
  });

  // ─── Disabled Cache Tests ─────────────────────────────────────────────────

  describe('disabled caches', () => {
    it('should not cache when toolCache is disabled', () => {
      const disabledCache = new PromptCacheManager({ toolCache: false });
      disabledCache.setCachedToolResult('tool', 'input', { result: 'ok' });
      const result = disabledCache.getCachedToolResult('tool', 'input');
      expect(result).toBeUndefined();
    });

    it('should not cache when summaryCache is disabled', () => {
      const disabledCache = new PromptCacheManager({ summaryCache: false });
      disabledCache.setCachedSummary('hash', 'Summary', 5);
      const result = disabledCache.getCachedSummary('hash');
      expect(result).toBeUndefined();
    });
  });
});
