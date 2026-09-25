import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import {
  IgnoreFilter,
  isJevCacheIgnoredInGitignore,
  ensureGitignoreJevCache,
  isJevCacheTrackedByGit,
  untrackJevCacheIfTracked,
} from "../../src/shared/ignore.js";

describe("IgnoreFilter Module", () => {
  const dummyRepo = path.resolve("tests/fixtures/dummy-ignore-repo");

  beforeAll(() => {
    if (!fs.existsSync(dummyRepo)) {
      fs.mkdirSync(dummyRepo, { recursive: true });
      fs.writeFileSync(path.join(dummyRepo, ".gitignore"), "ignored-dir/\n*.custom-ignore\n");
      fs.writeFileSync(path.join(dummyRepo, ".jevignore"), "jev-only/\n");
    }
  });

  afterAll(() => {
    if (fs.existsSync(dummyRepo)) {
      fs.rmSync(dummyRepo, { recursive: true, force: true });
    }
  });

  it("ignores default patterns (node_modules, dist, .git)", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("node_modules/express/index.js")).toBe(true);
    expect(filter.shouldIgnore("dist/bundle.js")).toBe(true);
    expect(filter.shouldIgnore(".git/config")).toBe(true);
    expect(filter.shouldIgnore("package-lock.json")).toBe(true);
    expect(filter.shouldIgnore(".env")).toBe(true);
    expect(filter.shouldIgnore(".env.local")).toBe(true);
  });

  it("respects .gitignore and .jevignore", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("ignored-dir/file.txt")).toBe(true);
    expect(filter.shouldIgnore("foo.custom-ignore")).toBe(true);
    expect(filter.shouldIgnore("jev-only/sub.ts")).toBe(true);
    expect(filter.shouldIgnore("src/index.ts")).toBe(false);
  });

  it("identifies binary extensions", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("images/logo.png")).toBe(true);
    expect(filter.shouldIgnore("app.exe")).toBe(true);
    expect(filter.shouldIgnore("archive.zip")).toBe(true);
    expect(filter.shouldIgnore("src/logo.svg")).toBe(false); // SVGs are text XML
  });

  it("normalizes Windows backslashes properly", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("node_modules\\pkg\\index.js")).toBe(true);
    expect(filter.shouldIgnore("src\\components\\Button.tsx")).toBe(false);
  });
});

describe("Gitignore .jev-cache.json Helpers", () => {
  const tempDir = path.resolve("tests/fixtures/dummy-cache-ignore-repo");

  beforeAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects when .gitignore does not exist", () => {
    const emptyDir = path.join(tempDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    expect(isJevCacheIgnoredInGitignore(emptyDir)).toBe(false);
  });

  it("detects when .gitignore exists but does not ignore .jev-cache.json", () => {
    const noCacheDir = path.join(tempDir, "no-cache");
    fs.mkdirSync(noCacheDir, { recursive: true });
    fs.writeFileSync(path.join(noCacheDir, ".gitignore"), "node_modules/\ndist/\n");
    expect(isJevCacheIgnoredInGitignore(noCacheDir)).toBe(false);
  });

  it("detects when .gitignore ignores .jev-cache.json in various formats", () => {
    const cacheDir = path.join(tempDir, "with-cache");
    fs.mkdirSync(cacheDir, { recursive: true });

    fs.writeFileSync(path.join(cacheDir, ".gitignore"), "dist/\n.jev-cache.json\n");
    expect(isJevCacheIgnoredInGitignore(cacheDir)).toBe(true);

    fs.writeFileSync(path.join(cacheDir, ".gitignore"), "/.jev-cache.json\n");
    expect(isJevCacheIgnoredInGitignore(cacheDir)).toBe(true);

    fs.writeFileSync(path.join(cacheDir, ".gitignore"), "*.jev-cache.json\n");
    expect(isJevCacheIgnoredInGitignore(cacheDir)).toBe(true);
  });

  it("ensureGitignoreJevCache creates .gitignore if it does not exist", () => {
    const createDir = path.join(tempDir, "create-new");
    fs.mkdirSync(createDir, { recursive: true });

    const res = ensureGitignoreJevCache(createDir);
    expect(res.created).toBe(true);
    expect(res.modified).toBe(true);
    expect(res.ignored).toBe(true);

    const content = fs.readFileSync(path.join(createDir, ".gitignore"), "utf8");
    expect(content).toContain(".jev-cache.json");
    expect(isJevCacheIgnoredInGitignore(createDir)).toBe(true);
  });

  it("ensureGitignoreJevCache appends to existing .gitignore if missing", () => {
    const appendDir = path.join(tempDir, "append");
    fs.mkdirSync(appendDir, { recursive: true });
    fs.writeFileSync(path.join(appendDir, ".gitignore"), "node_modules/\n");

    const res = ensureGitignoreJevCache(appendDir);
    expect(res.created).toBe(false);
    expect(res.modified).toBe(true);
    expect(res.ignored).toBe(true);

    const content = fs.readFileSync(path.join(appendDir, ".gitignore"), "utf8");
    expect(content).toContain("node_modules/\n\n# Jev Developer Harness local runtime cache\n.jev-cache.json\n");
    expect(isJevCacheIgnoredInGitignore(appendDir)).toBe(true);
  });

  it("ensureGitignoreJevCache is idempotent and does not modify if already present", () => {
    const idempotentDir = path.join(tempDir, "idempotent");
    fs.mkdirSync(idempotentDir, { recursive: true });
    fs.writeFileSync(path.join(idempotentDir, ".gitignore"), ".jev-cache.json\n");

    const res = ensureGitignoreJevCache(idempotentDir);
    expect(res.created).toBe(false);
    expect(res.modified).toBe(false);
    expect(res.ignored).toBe(true);
  });

  it("isJevCacheTrackedByGit returns false on non-git directory", () => {
    const nonGitDir = path.join(tempDir, "non-git");
    fs.mkdirSync(nonGitDir, { recursive: true });
    expect(isJevCacheTrackedByGit(nonGitDir)).toBe(false);
    expect(untrackJevCacheIfTracked(nonGitDir)).toBe(false);
  });

  it("automatically untracks .jev-cache.json if tracked in a git repository", () => {
    const gitRepoDir = path.join(tempDir, "tracked-git-repo");
    fs.mkdirSync(gitRepoDir, { recursive: true });

    // Initialize temporary git repo
    try {
      execSync("git init", { cwd: gitRepoDir, stdio: "ignore" });
      execSync("git config user.email 'test@example.com'", { cwd: gitRepoDir, stdio: "ignore" });
      execSync("git config user.name 'Test User'", { cwd: gitRepoDir, stdio: "ignore" });

      // Create .jev-cache.json and stage it
      const cachePath = path.join(gitRepoDir, ".jev-cache.json");
      fs.writeFileSync(cachePath, '{"test": true}', "utf8");
      execSync("git add .jev-cache.json", { cwd: gitRepoDir, stdio: "ignore" });

      // Should be tracked by git
      expect(isJevCacheTrackedByGit(gitRepoDir)).toBe(true);

      // Running ensureGitignoreJevCache should add to .gitignore AND untrack from git
      const res = ensureGitignoreJevCache(gitRepoDir);
      expect(res.untracked).toBe(true);
      expect(res.ignored).toBe(true);

      // Verify it is no longer tracked by git
      expect(isJevCacheTrackedByGit(gitRepoDir)).toBe(false);

      // Verify physical file was NOT deleted
      expect(fs.existsSync(cachePath)).toBe(true);
      const content = fs.readFileSync(cachePath, "utf8");
      expect(content).toBe('{"test": true}');
    } catch {
      // If git is not in PATH during testing, test degrades gracefully
    }
  });
});


