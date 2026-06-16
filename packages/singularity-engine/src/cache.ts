/**
 * singularity-engine — PromptCacheManager.
 *
 * Session-level caching of tool results and summarization outcomes to reduce
 * redundant LLM calls within a session.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

export interface CacheOptions {
  toolCache?: boolean;
  summaryCache?: boolean;
  maxToolCacheEntries?: number;
  summaryCacheTTL?: number;
}

export interface CachedToolResult {
  value: unknown;
  cachedAt: number;
  hitCount: number;
}

export interface CachedSummary {
  summary: string;
  originalMessageCount: number;
  cachedAt: number;
}

export interface CachedHTTPResponse {
  body: string;
  headers: Record<string, string>;
  cachedAt: number;
  expiresAt: number;
}

export interface CacheStats {
  toolHits: number;
  toolMisses: number;
  summaryHits: number;
  summaryMisses: number;
  toolCacheSize: number;
}

// ─── Hash Functions ───────────────────────────────────────────────────────────

function cyrb53Hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce6c;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822506);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822506);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = (h2 >>> 0) * 4294967296 + (h1 >>> 0);
  return combined.toString(16);
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

// ─── PromptCacheManager ────────────────────────────────────────────────────────

export class PromptCacheManager {
  private readonly toolCacheEnabled: boolean;
  private readonly summaryCacheEnabled: boolean;
  private readonly maxToolCacheEntries: number;
  private readonly summaryCacheTTL: number;

  private toolCache = new Map<string, CachedToolResult>();
  private toolCacheOrder: string[] = [];
  private summaryCache = new Map<string, CachedSummary>();
  private httpCache = new Map<string, CachedHTTPResponse>();

  private toolHits = 0;
  private toolMisses = 0;
  private summaryHits = 0;
  private summaryMisses = 0;
  private accessCounter = 0;

  constructor(options?: CacheOptions) {
    this.toolCacheEnabled = options?.toolCache ?? true;
    this.summaryCacheEnabled = options?.summaryCache ?? true;
    this.maxToolCacheEntries = options?.maxToolCacheEntries ?? 100;
    this.summaryCacheTTL = options?.summaryCacheTTL ?? 0;
  }

  // ─── Tool Caching ─────────────────────────────────────────────────────────

  getCachedToolResult(
    toolName: string,
    inputHash: string
  ): CachedToolResult | undefined {
    if (!this.toolCacheEnabled) return undefined;

    const key = this.buildToolCacheKey(toolName, inputHash);
    const entry = this.toolCache.get(key);

    if (!entry) {
      this.toolMisses++;
      return undefined;
    }

    this.updateLRUOrder(key);
    entry.hitCount++;
    this.toolHits++;

    return entry;
  }

  setCachedToolResult(
    toolName: string,
    inputHash: string,
    result: unknown
  ): void {
    if (!this.toolCacheEnabled) return;

    const key = this.buildToolCacheKey(toolName, inputHash);
    const now = Date.now();

    if (
      this.toolCache.size >= this.maxToolCacheEntries &&
      !this.toolCache.has(key)
    ) {
      this.evictOldestToolCacheEntry();
    }

    this.toolCache.set(key, {
      value: result,
      cachedAt: now,
      hitCount: 0,
    });

    this.updateLRUOrder(key);
  }

  private buildToolCacheKey(toolName: string, inputHash: string): string {
    return `${toolName}:${inputHash}`;
  }

  private updateLRUOrder(key: string): void {
    this.accessCounter++;
    this.toolCacheOrder.push(key);
    if (this.toolCacheOrder.length > this.maxToolCacheEntries * 2) {
      this.toolCacheOrder = this.toolCacheOrder.slice(
        -this.maxToolCacheEntries
      );
    }
  }

  private evictOldestToolCacheEntry(): void {
    for (const key of this.toolCache.keys()) {
      const entry = this.toolCache.get(key);
      if (entry) {
        let oldestKey = key;
        let oldestTime = entry.cachedAt;
        for (const k of this.toolCache.keys()) {
          const e = this.toolCache.get(k);
          if (e && e.cachedAt < oldestTime) {
            oldestTime = e.cachedAt;
            oldestKey = k;
          }
        }
        this.toolCache.delete(oldestKey);
        return;
      }
    }
  }

  // ─── Summary Caching ──────────────────────────────────────────────────────

  getCachedSummary(messagesHash: string): CachedSummary | undefined {
    if (!this.summaryCacheEnabled) return undefined;

    const entry = this.summaryCache.get(messagesHash);
    if (!entry) {
      this.summaryMisses++;
      return undefined;
    }

    if (this.summaryCacheTTL > 0) {
      const now = Date.now();
      if (now - entry.cachedAt > this.summaryCacheTTL) {
        this.summaryCache.delete(messagesHash);
        this.summaryMisses++;
        return undefined;
      }
    }

    this.summaryHits++;
    return entry;
  }

  setCachedSummary(
    messagesHash: string,
    summary: string,
    originalMessageCount: number
  ): void {
    if (!this.summaryCacheEnabled) return;

    const now = Date.now();
    this.summaryCache.set(messagesHash, {
      summary,
      originalMessageCount,
      cachedAt: now,
    });
  }

  // ─── Hash Utilities ───────────────────────────────────────────────────────

  computeMessagesHash(
    messages: Array<{ role: string; content: string }>
  ): string {
    const normalized = messages
      .map((m) => `${m.role}:${m.content}`)
      .sort()
      .join('|');
    return cyrb53Hash(normalized);
  }

  computeInputHash(input: unknown): string {
    if (typeof input === 'string') {
      return cyrb53Hash(input);
    }
    const sorted = sortObjectKeys(input);
    return cyrb53Hash(JSON.stringify(sorted));
  }

  // ─── Cache-Control HTTP Caching ──────────────────────────────────────────

  getCacheKey(messages: Array<{ role: string; content: string }>): string {
    return this.computeMessagesHash(messages);
  }

  shouldUseCachedResponse(headers: Record<string, string>): boolean {
    let cacheControl: string | undefined;
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'cache-control') {
        cacheControl = value;
        break;
      }
    }
    if (!cacheControl) return false;

    if (/\bno-store\b/i.test(cacheControl)) {
      return false;
    }

    const maxAgeMatch = cacheControl.match(/\bmax-age=(\d+)\b/i);
    if (maxAgeMatch) {
      const maxAge = Number.parseInt(maxAgeMatch[1], 10);
      return maxAge > 0;
    }

    return false;
  }

  storeResponseForCache(
    key: string,
    body: string,
    headers: Record<string, string>
  ): void {
    let cacheControl: string | undefined;
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'cache-control') {
        cacheControl = v;
        break;
      }
    }
    let expiresAt = Number.MAX_SAFE_INTEGER;

    if (cacheControl) {
      const maxAgeMatch = cacheControl.match(/\bmax-age=(\d+)\b/i);
      if (maxAgeMatch) {
        const maxAge = Number.parseInt(maxAgeMatch[1], 10);
        expiresAt = Date.now() + maxAge * 1000;
      }
    }

    this.httpCache.set(key, {
      body,
      headers,
      cachedAt: Date.now(),
      expiresAt,
    });
  }

  getStoredResponse(key: string): CachedHTTPResponse | undefined {
    const entry = this.httpCache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.httpCache.delete(key);
      return undefined;
    }

    return entry;
  }

  evictExpiredResponses(): void {
    const now = Date.now();
    for (const [key, entry] of this.httpCache.entries()) {
      if (now > entry.expiresAt) {
        this.httpCache.delete(key);
      }
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): CacheStats {
    return {
      toolHits: this.toolHits,
      toolMisses: this.toolMisses,
      summaryHits: this.summaryHits,
      summaryMisses: this.summaryMisses,
      toolCacheSize: this.toolCache.size,
    };
  }

  reset(): void {
    this.toolCache.clear();
    this.toolCacheOrder = [];
    this.summaryCache.clear();
    this.httpCache.clear();
    this.toolHits = 0;
    this.toolMisses = 0;
    this.summaryHits = 0;
    this.summaryMisses = 0;
    this.accessCounter = 0;
  }
}
