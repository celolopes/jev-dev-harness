import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import {
  installGitHook,
  uninstallGitHook,
  generatePreCommitScript,
  resolveHooksDirectory,
  isJevInstalledHook,
  JEV_HOOK_SIGNATURE,
} from "../../src/hooks/index.js";

function safeRmDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // Windows file locking fallback
  }
}

function findSh(): string | null {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\sh.exe",
    "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
    "C:\\Program Files (x86)\\Git\\bin\\sh.exe",
    "sh",
    "bash",
  ];
  const paths = (process.env.PATH || "").split(path.delimiter);
  const exts = process.platform === "win32" ? [".exe", ""] : [""];

  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate)) {
        if (fs.existsSync(candidate)) return candidate;
      } else {
        for (const p of paths) {
          for (const ext of exts) {
            const full = path.join(p, candidate + ext);
            if (fs.existsSync(full)) return full;
          }
        }
      }
    } catch {
      // continue searching
    }
  }
  return null;
}

describe("Hooks Automation & Reliability", () => {
  let tempRepo: string;
  let gitDir: string;
  const shExecutable = findSh();

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "jev-hook-test-"));
    gitDir = path.join(tempRepo, ".git");
  });

  afterEach(() => {
    safeRmDir(tempRepo);
  });

  it("1. installs and uninstalls pre-commit hook in a git repo with default policy (fail-open)", () => {
    fs.mkdirSync(gitDir, { recursive: true });

    const installRes = installGitHook(tempRepo);
    expect(installRes.installed).toBe(true);
    expect(installRes.policy).toBe("fail-open");
    expect(fs.existsSync(installRes.hookPath)).toBe(true);

    const hookContent = fs.readFileSync(installRes.hookPath, "utf-8");
    expect(hookContent).toContain(JEV_HOOK_SIGNATURE);
    expect(hookContent).toContain('POLICY="${JEV_HOOK_FAILURE_POLICY:-fail-open}"');
    expect(isJevInstalledHook(installRes.hookPath)).toBe(true);

    const uninstallRes = uninstallGitHook(tempRepo);
    expect(uninstallRes.installed).toBe(false);
    expect(fs.existsSync(installRes.hookPath)).toBe(false);
  });

  it("2. installs pre-commit hook with explicit fail-closed policy", () => {
    fs.mkdirSync(gitDir, { recursive: true });

    const installRes = installGitHook(tempRepo, { policy: "fail-closed" });
    expect(installRes.installed).toBe(true);
    expect(installRes.policy).toBe("fail-closed");

    const hookContent = fs.readFileSync(installRes.hookPath, "utf-8");
    expect(hookContent).toContain('POLICY="${JEV_HOOK_FAILURE_POLICY:-fail-closed}"');
  });

  it("3. repeated installation updates existing Jev hook safely", () => {
    fs.mkdirSync(gitDir, { recursive: true });

    const first = installGitHook(tempRepo, { policy: "fail-open" });
    expect(first.installed).toBe(true);

    const second = installGitHook(tempRepo, { policy: "fail-closed" });
    expect(second.installed).toBe(true);
    expect(second.policy).toBe("fail-closed");

    const hookContent = fs.readFileSync(second.hookPath, "utf-8");
    expect(hookContent).toContain('POLICY="${JEV_HOOK_FAILURE_POLICY:-fail-closed}"');
  });

  it("4. existing non-Jev user hook is preserved: installation refuses to overwrite without force", () => {
    const hooksDir = path.join(gitDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookFile = path.join(hooksDir, "pre-commit");
    const userScript = "#!/bin/sh\necho 'custom user hook'\nexit 0\n";
    fs.writeFileSync(hookFile, userScript, "utf-8");

    expect(() => installGitHook(tempRepo)).toThrow(/Refusing to overwrite user hook/);

    // Verify existing content was not touched
    expect(fs.readFileSync(hookFile, "utf-8")).toBe(userScript);
  });

  it("5. existing non-Jev user hook can be overwritten when force is true", () => {
    const hooksDir = path.join(gitDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookFile = path.join(hooksDir, "pre-commit");
    fs.writeFileSync(hookFile, "#!/bin/sh\necho 'user hook'\n", "utf-8");

    const installRes = installGitHook(tempRepo, { force: true, policy: "fail-closed" });
    expect(installRes.installed).toBe(true);
    expect(fs.readFileSync(hookFile, "utf-8")).toContain(JEV_HOOK_SIGNATURE);
  });

  it("6. uninstall preserves non-Jev user hooks unless force is true", () => {
    const hooksDir = path.join(gitDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookFile = path.join(hooksDir, "pre-commit");
    const userScript = "#!/bin/sh\necho 'important user hook'\n";
    fs.writeFileSync(hookFile, userScript, "utf-8");

    const res = uninstallGitHook(tempRepo);
    expect(res.installed).toBe(false);
    expect(res.preservedExisting).toBe(true);
    expect(fs.existsSync(hookFile)).toBe(true);
    expect(fs.readFileSync(hookFile, "utf-8")).toBe(userScript);

    const forceRes = uninstallGitHook(tempRepo, { force: true });
    expect(forceRes.installed).toBe(false);
    expect(fs.existsSync(hookFile)).toBe(false);
  });

  it("7. uninstall returns clean message when no hook exists", () => {
    fs.mkdirSync(gitDir, { recursive: true });
    const res = uninstallGitHook(tempRepo);
    expect(res.installed).toBe(false);
    expect(res.message).toContain("No pre-commit hook found");
  });

  it("8. throws an error when target is not a git repository", () => {
    // No .git folder
    expect(() => installGitHook(tempRepo)).toThrow(/Not a git repository/);
  });

  it("9. resolves hooks directory in Git worktrees where .git is a file", () => {
    const mainRepo = fs.mkdtempSync(path.join(os.tmpdir(), "jev-main-repo-"));
    try {
      const mainGitDir = path.join(mainRepo, ".git");
      const mainHooks = path.join(mainGitDir, "hooks");
      fs.mkdirSync(mainHooks, { recursive: true });

      // Simulate a git worktree: .git file pointing to gitdir
      const worktreeGitDir = path.join(mainGitDir, "worktrees", "wt-1");
      fs.mkdirSync(worktreeGitDir, { recursive: true });
      fs.writeFileSync(path.join(worktreeGitDir, "commondir"), "../..\n", "utf-8");

      fs.writeFileSync(path.join(tempRepo, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf-8");

      const resolved = resolveHooksDirectory(tempRepo);
      expect(path.normalize(resolved)).toBe(path.normalize(mainHooks));

      const installRes = installGitHook(tempRepo);
      expect(installRes.installed).toBe(true);
      expect(fs.existsSync(path.join(mainHooks, "pre-commit"))).toBe(true);
    } finally {
      safeRmDir(mainRepo);
    }
  });

  it("10. supports paths containing spaces", () => {
    const spaceRepo = fs.mkdtempSync(path.join(os.tmpdir(), "jev repo with spaces "));
    try {
      fs.mkdirSync(path.join(spaceRepo, ".git"), { recursive: true });
      const res = installGitHook(spaceRepo, { policy: "fail-closed" });
      expect(res.installed).toBe(true);
      expect(fs.existsSync(res.hookPath)).toBe(true);

      const unres = uninstallGitHook(spaceRepo);
      expect(unres.installed).toBe(false);
      expect(fs.existsSync(res.hookPath)).toBe(false);
    } finally {
      safeRmDir(spaceRepo);
    }
  });

  describe("Pre-commit hook script execution simulation", () => {
    it.skipIf(!shExecutable)("evaluates fail-open when CLI is missing", () => {
      const script = generatePreCommitScript("fail-open");
      const scriptFile = path.join(tempRepo, "test-hook.sh");
      fs.writeFileSync(scriptFile, script, "utf-8");

      // Execute with an environment where jev-dev is not in PATH or dist
      const run = spawnSync(shExecutable!, [scriptFile], {
        cwd: tempRepo,
        env: {
          ...process.env,
          PATH: path.dirname(shExecutable!),
          JEV_HOOK_FAILURE_POLICY: "",
        },
        encoding: "utf8",
      });

      expect(run.status).toBe(0); // Allowed under fail-open
      expect(run.stderr).toContain("[Jev Hook] Warning: jev-dev CLI not found");
      expect(run.stderr).toContain("fail-open policy active");
    });

    it.skipIf(!shExecutable)("evaluates fail-closed when CLI is missing", () => {
      const script = generatePreCommitScript("fail-closed");
      const scriptFile = path.join(tempRepo, "test-hook.sh");
      fs.writeFileSync(scriptFile, script, "utf-8");

      const run = spawnSync(shExecutable!, [scriptFile], {
        cwd: tempRepo,
        env: {
          ...process.env,
          PATH: path.dirname(shExecutable!),
          JEV_HOOK_FAILURE_POLICY: "",
        },
        encoding: "utf8",
      });

      expect(run.status).toBe(1); // Rejected under fail-closed
      expect(run.stderr).toContain("[ERROR] Commit rejected: jev-dev CLI not found");
      expect(run.stderr).toContain("fail-closed policy active");
    });

    it.skipIf(!shExecutable)("respects JEV_HOOK_FAILURE_POLICY runtime override", () => {
      // Installed as fail-open, but overridden at runtime to fail-closed
      const script = generatePreCommitScript("fail-open");
      const scriptFile = path.join(tempRepo, "test-hook.sh");
      fs.writeFileSync(scriptFile, script, "utf-8");

      const run = spawnSync(shExecutable!, [scriptFile], {
        cwd: tempRepo,
        env: {
          ...process.env,
          PATH: path.dirname(shExecutable!),
          JEV_HOOK_FAILURE_POLICY: "fail-closed",
        },
        encoding: "utf8",
      });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("fail-closed policy active");
    });

    it("verifies script exit-code branch logic consistency in template", () => {
      const failOpen = generatePreCommitScript("fail-open");
      expect(failOpen).toContain("if [ $STATUS -eq 2 ]; then");
      expect(failOpen).toContain("exit 1");
      expect(failOpen).toContain("if [ $STATUS -ne 0 ]; then");
      expect(failOpen).toContain('POLICY="${JEV_HOOK_FAILURE_POLICY:-fail-open}"');

      const failClosed = generatePreCommitScript("fail-closed");
      expect(failClosed).toContain("if [ $STATUS -eq 2 ]; then");
      expect(failClosed).toContain("exit 1");
      expect(failClosed).toContain('POLICY="${JEV_HOOK_FAILURE_POLICY:-fail-closed}"');
    });
  });
});
