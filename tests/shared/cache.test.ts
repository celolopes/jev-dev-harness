import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { JevCache } from "../../src/shared/cache.js";

describe("JevCache Module", () => {
  const cacheFile = path.resolve("tests/fixtures/.test-cache.json");

  beforeEach(() => {
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  });

  it("computes deterministic SHA-256 keys", () => {
    const key1 = JevCache.createKey("task1", "src/file.ts", "const x = 1;");
    const key2 = JevCache.createKey("task1", "src/file.ts", "const x = 1;");
    const keyDiff = JevCache.createKey("task2", "src/file.ts", "const x = 1;");

    expect(key1).toBe(key2);
    expect(key1).not.toBe(keyDiff);
    expect(key1).toHaveLength(64); // SHA-256 hex
  });

  it("stores, retrieves and tracks hit/miss stats", () => {
    const cache = new JevCache({ cacheFilePath: cacheFile });

    const key = "test-key-1";
    expect(cache.get(key)).toBeNull();
    expect(cache.stats().misses).toBe(1);

    cache.set(key, { score: 0.95, role: "implementation" });
    const cached = cache.get<{ score: number; role: string }>(key);
    expect(cached).toEqual({ score: 0.95, role: "implementation" });
    expect(cache.stats().hits).toBe(1);

    cache.save();

    // Reload in fresh instance
    const cache2 = new JevCache({ cacheFilePath: cacheFile });
    const cached2 = cache2.get<{ score: number; role: string }>(key);
    expect(cached2).toEqual({ score: 0.95, role: "implementation" });
  });

  it("handles disabled state cleanly without storing", () => {
    const cache = new JevCache({ enabled: false });
    cache.set("key", "val");
    expect(cache.get("key")).toBeNull();
  });
});
