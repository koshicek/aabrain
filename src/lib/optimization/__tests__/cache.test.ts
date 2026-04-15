import { describe, it, expect, beforeEach, vi } from "vitest";
import { cacheGet, cacheSet, cacheDelete, cacheClear, optCacheKey } from "../cache";

beforeEach(() => {
  cacheClear();
});

describe("cacheGet / cacheSet", () => {
  it("returns null for missing key", () => {
    expect(cacheGet("missing")).toBeNull();
  });

  it("stores and retrieves data", () => {
    cacheSet("key1", { hello: "world" });
    expect(cacheGet("key1")).toEqual({ hello: "world" });
  });

  it("returns null after TTL expires", () => {
    // Set with very short TTL
    cacheSet("expiring", "data", 1);

    // Advance time past TTL
    vi.useFakeTimers();
    vi.advanceTimersByTime(10);
    expect(cacheGet("expiring")).toBeNull();
    vi.useRealTimers();
  });

  it("returns data before TTL expires", () => {
    cacheSet("valid", "data", 60000);
    expect(cacheGet("valid")).toBe("data");
  });
});

describe("cacheDelete", () => {
  it("removes a specific entry", () => {
    cacheSet("a", 1);
    cacheSet("b", 2);
    cacheDelete("a");
    expect(cacheGet("a")).toBeNull();
    expect(cacheGet("b")).toBe(2);
  });
});

describe("cacheClear", () => {
  it("removes all entries", () => {
    cacheSet("a", 1);
    cacheSet("b", 2);
    cacheClear();
    expect(cacheGet("a")).toBeNull();
    expect(cacheGet("b")).toBeNull();
  });
});

describe("eviction at capacity", () => {
  it("evicts oldest entry when at max capacity", () => {
    // Fill cache to capacity (50 entries)
    for (let i = 0; i < 50; i++) {
      cacheSet(`entry-${i}`, i);
    }

    // Access entry-0 to make it recent
    cacheGet("entry-0");

    // Add one more — should evict the least recently accessed (entry-1)
    cacheSet("entry-new", "new");

    expect(cacheGet("entry-0")).toBe(0); // was accessed, should survive
    expect(cacheGet("entry-new")).toBe("new");

    // entry-1 should be evicted (oldest accessed that wasn't re-accessed)
    expect(cacheGet("entry-1")).toBeNull();
  });
});

describe("optCacheKey", () => {
  it("generates consistent cache keys", () => {
    const key = optCacheKey("team-123", "daily-report", "2026-04-14");
    expect(key).toContain("team-123");
    expect(key).toContain("daily-report");
    expect(key).toContain("2026-04-14");
  });

  it("generates different keys for different params", () => {
    const k1 = optCacheKey("team-1", "daily-report", "2026-04-14");
    const k2 = optCacheKey("team-2", "daily-report", "2026-04-14");
    const k3 = optCacheKey("team-1", "campaign-configs", "2026-04-14");
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
