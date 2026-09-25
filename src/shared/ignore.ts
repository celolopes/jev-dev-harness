import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { isSecretFile } from "./redaction.js";

export const DEFAULT_IGNORE_PATTERNS = [
  // VCS and IDE
  ".git",
  ".git/**",
  ".worktrees/**",
  ".svn/**",
  ".hg/**",
  ".idea/**",
  ".vscode/**",
  ".gemini/**",

  // Node and package managers
  "node_modules/**",
  "vendor/**",
  ".pnpm-store/**",
  ".yarn/**",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "Cargo.lock",
  "Gemfile.lock",

  // Build and compiler output
  "dist/**",
  "build/**",
  "out/**",
  "target/**",
  "bin/**",
  "obj/**",
  "*.tsbuildinfo",

  // Python and caches
  "__pycache__/**",
  "*.pyc",
  ".venv/**",
  "env/**",
  ".pytest_cache/**",
  ".vitest/**",
  "coverage/**",
  ".jev-cache.json",

  // Secret files (also handled by redaction)
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.keystore",
  "*.pfx",
  "*.p12",
  "id_rsa",
  "id_ed25519",
];

export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svgz",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".iso",
  ".bin",
  ".wasm",
  ".pdf",
  ".parquet",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".sqlite-wal",
  ".sqlite-shm",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export interface IgnoreOptions {
  customPatterns?: string[];
  maxFileSizeBytes?: number;
  useGitIgnore?: boolean;
  useJevIgnore?: boolean;
}

export class IgnoreFilter {
  private readonly ig: Ignore;
  readonly repoRoot: string;
  readonly maxFileSizeBytes: number;

  constructor(repoRoot: string, options: IgnoreOptions = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 100 * 1024; // 100 KB default

    this.ig = ignore();
    this.ig.add(DEFAULT_IGNORE_PATTERNS);

    if (options.useGitIgnore !== false) {
      this.loadIgnoreFile(".gitignore");
    }

    if (options.useJevIgnore !== false) {
      this.loadIgnoreFile(".jevignore");
    }

    if (options.customPatterns && options.customPatterns.length > 0) {
      this.ig.add(options.customPatterns);
    }
  }

  private loadIgnoreFile(filename: string): void {
    const filePath = path.join(this.repoRoot, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#"));
        this.ig.add(lines);
      } catch {
        // Fallback silently if ignore file can't be read
      }
    }
  }

  /**
   * Normalizes relative path to forward slashes.
   */
  normalizeRelativePath(filePath: string): string {
    let rel = path.isAbsolute(filePath)
      ? path.relative(this.repoRoot, filePath)
      : filePath;
    rel = rel.replace(/\\/g, "/");
    if (rel.startsWith("./")) {
      rel = rel.slice(2);
    }
    return rel;
  }

  /**
   * Returns true if file should be deterministically ignored.
   */
  shouldIgnore(filePath: string): boolean {
    const rel = this.normalizeRelativePath(filePath);

    if (!rel || rel === "." || rel === "..") {
      return false;
    }

    // Always ignore secret files
    if (isSecretFile(rel)) {
      return true;
    }

    // Check binary extension
    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return true;
    }

    return this.ig.ignores(rel);
  }

  /**
   * Inspects physical file on disk for size and binary signatures.
   */
  isIgnoredOnDisk(absolutePath: string): { ignored: boolean; reason?: string } {
    const rel = this.normalizeRelativePath(absolutePath);
    if (this.shouldIgnore(rel)) {
      return { ignored: true, reason: "matched_ignore_rule" };
    }

    try {
      const stats = fs.statSync(absolutePath);
      if (stats.isDirectory()) {
        return { ignored: this.shouldIgnore(rel + "/"), reason: "directory" };
      }

      if (stats.size > this.maxFileSizeBytes) {
        return { ignored: true, reason: `oversized_${stats.size}_bytes` };
      }

      // Sniff for binary content in the first 512 bytes
      if (stats.size > 0) {
        const buffer = Buffer.alloc(Math.min(512, stats.size));
        const fd = fs.openSync(absolutePath, "r");
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        fs.closeSync(fd);

        for (let i = 0; i < buffer.length; i++) {
          // Check for null bytes which indicate non-text / binary files
          if (buffer[i] === 0) {
            return { ignored: true, reason: "binary_content_detected" };
          }
        }
      }
    } catch (err) {
      return { ignored: true, reason: `stat_error: ${(err as Error).message}` };
    }

    return { ignored: false };
  }
}

/**
 * Check whether a .gitignore file in targetDir already ignores .jev-cache.json
 */
export function isJevCacheIgnoredInGitignore(targetDir: string = process.cwd()): boolean {
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return false;
  }
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    const lines = content.split(/\r?\n/).map((l) => l.trim());
    return lines.some(
      (l) => l === ".jev-cache.json" || l === "/.jev-cache.json" || l === "*.jev-cache.json"
    );
  } catch {
    return false;
  }
}

export interface EnsureGitignoreResult {
  modified: boolean;
  created: boolean;
  ignored: boolean;
}

/**
 * Ensures .jev-cache.json is included in targetDir's .gitignore.
 * Appends it with a comment if missing, or creates .gitignore if it doesn't exist.
 */
export function ensureGitignoreJevCache(targetDir: string = process.cwd()): EnsureGitignoreResult {
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    try {
      fs.writeFileSync(
        gitignorePath,
        "# Jev Developer Harness local runtime cache\n.jev-cache.json\n",
        "utf8"
      );
      return { modified: true, created: true, ignored: true };
    } catch {
      return { modified: false, created: false, ignored: false };
    }
  }

  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    const lines = content.split(/\r?\n/).map((l) => l.trim());
    const alreadyIgnored = lines.some(
      (l) => l === ".jev-cache.json" || l === "/.jev-cache.json" || l === "*.jev-cache.json"
    );
    if (alreadyIgnored) {
      return { modified: false, created: false, ignored: true };
    }

    const needsNewline =
      content.length > 0 && !content.endsWith("\n") && !content.endsWith("\r");
    const toAppend = `${needsNewline ? "\n" : ""}\n# Jev Developer Harness local runtime cache\n.jev-cache.json\n`;
    fs.appendFileSync(gitignorePath, toAppend, "utf8");
    return { modified: true, created: false, ignored: true };
  } catch {
    return { modified: false, created: false, ignored: false };
  }
}
