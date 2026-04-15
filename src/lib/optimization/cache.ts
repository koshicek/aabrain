// ---------------------------------------------------------------------------
// Server-side in-memory cache with configurable TTL
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  accessedAt: number;
}

const MAX_ENTRIES = 50;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const store = new Map<string, CacheEntry<unknown>>();
let accessCounter = 0;

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  entry.accessedAt = ++accessCounter;
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs?: number): void {
  // Evict least recently accessed entry if at capacity
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [k, v] of store) {
      if (v.accessedAt < oldestAccess) {
        oldestAccess = v.accessedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }

  store.set(key, {
    data,
    expiresAt: Date.now() + (ttlMs ?? DEFAULT_TTL_MS),
    accessedAt: ++accessCounter,
  });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheClear(): void {
  store.clear();
}

// Increment when data shape changes to invalidate old cached entries
const CACHE_VERSION = 2;

/** Build a cache key for optimization data */
export function optCacheKey(
  teamId: string,
  action: string,
  date: string,
): string {
  return `v${CACHE_VERSION}:opt:${teamId}:${action}:${date}`;
}
