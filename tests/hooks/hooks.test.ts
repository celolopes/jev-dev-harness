import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { installGitHook, uninstallGitHook } from "../../src/hooks/index.js";

describe("Hooks Automation", () => {
  const tempRepo = path.resolve("tests/fixtures/test-hook-repo");
  const gitDir = path.join(tempRepo, ".git");

  afterEach(() => {
    if (fs.existsSync(tempRepo)) {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it("installs and uninstalls pre-commit hook in a git repo", () => {
    fs.mkdirSync(gitDir, { recursive: true });

    const installRes = installGitHook(tempRepo);
    expect(installRes.installed).toBe(true);
    expect(fs.existsSync(installRes.hookPath)).toBe(true);

    const hookContent = fs.readFileSync(installRes.hookPath, "utf-8");
    expect(hookContent).toContain("Jev Patch Reviewer pre-commit audit");

    const uninstallRes = uninstallGitHook(tempRepo);
    expect(uninstallRes.installed).toBe(false);
    expect(fs.existsSync(installRes.hookPath)).toBe(false);
  });

  it("throws an error when target is not a git repository", () => {
    fs.mkdirSync(tempRepo, { recursive: true }); // No .git folder

    expect(() => installGitHook(tempRepo)).toThrow(/Not a git repository/);
  });
});
