import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
}

export interface CacheOptions {
  cacheFilePath?: string;
  enabled?: boolean;
  ttlMs?: number; // Optional TTL
}

export class JevCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly cacheFilePath?: string;
  private readonly enabled: boolean;
  private readonly ttlMs?: number;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.cacheFilePath = options.cacheFilePath;
    this.ttlMs = options.ttlMs;

    if (this.enabled && this.cacheFilePath) {
      this.load();
    }
  }

  static createKey(
    task: string,
    filePath: string,
    fileContent: string,
    configVersion = "v1"
  ): string {
    const contentHash = crypto
      .createHash("sha256")
      .update(fileContent)
      .digest("hex");
    const rawKey = `${task}:::${filePath}:::${contentHash}:::${configVersion}`;
    return crypto.createHash("sha256").update(rawKey).digest("hex");
  }

  get<T>(key: string): T | null {
    if (!this.enabled) {
      this.misses++;
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    if (!this.enabled) {
      return;
    }

    this.cache.set(key, {
      key,
      data,
      timestamp: Date.now(),
    });
  }

  save(): void {
    if (!this.enabled || !this.cacheFilePath) {
      return;
    }

    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const serialized: Record<string, CacheEntry> = {};
      for (const [k, v] of this.cache.entries()) {
        serialized[k] = v;
      }

      fs.writeFileSync(
        this.cacheFilePath,
        JSON.stringify(serialized, null, 2),
        "utf8"
      );
    } catch {
      // Non-critical persistence failure
    }
  }

  private load(): void {
    if (!this.cacheFilePath || !fs.existsSync(this.cacheFilePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.cacheFilePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
      for (const [k, v] of Object.entries(parsed)) {
        this.cache.set(k, v);
      }
    } catch {
      // Clear corrupt cache
      this.cache.clear();
    }
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    if (this.cacheFilePath && fs.existsSync(this.cacheFilePath)) {
      try {
        fs.unlinkSync(this.cacheFilePath);
      } catch {
        // Ignore
      }
    }
  }

  stats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }
}
