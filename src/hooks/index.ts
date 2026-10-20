import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";

export type HookFailurePolicy = "fail-open" | "fail-closed";

export interface HookInstallOptions {
  policy?: HookFailurePolicy;
  force?: boolean;
}

export interface HookUninstallOptions {
  force?: boolean;
}

export interface HookInstallResult {
  installed: boolean;
  hookPath: string;
  message: string;
  policy?: HookFailurePolicy;
  preservedExisting?: boolean;
}

export const JEV_HOOK_SIGNATURE = "# Jev Developer Harness - Pre-commit safety gate";

/**
 * Generates the shell script content for the pre-commit hook.
 */
export function generatePreCommitScript(policy: HookFailurePolicy = "fail-open"): string {
  const normalizedPolicy = policy === "fail-closed" ? "fail-closed" : "fail-open";

  return `#!/bin/sh
${JEV_HOOK_SIGNATURE} (Phase 3)
# Automatically audits staged changes for leaked credentials and high regression risk.

# Failure policy: fail-open allows commits when verification cannot execute (default).
# fail-closed rejects commits when verification cannot execute.
# Can be overridden dynamically via JEV_HOOK_FAILURE_POLICY environment variable.
POLICY="\${JEV_HOOK_FAILURE_POLICY:-${normalizedPolicy}}"

echo "Running Jev Patch Reviewer pre-commit audit..."

# Check if jev-dev is available in dist or node_modules or PATH
CLI_PATH=""
if [ -f "./dist/cli/index.js" ]; then
  CLI_PATH="./dist/cli/index.js"
elif [ -f "./node_modules/jev-dev-harness/dist/cli/index.js" ]; then
  CLI_PATH="./node_modules/jev-dev-harness/dist/cli/index.js"
elif command -v jev-dev >/dev/null 2>&1; then
  CLI_PATH="jev-dev"
fi

if [ -z "$CLI_PATH" ]; then
  if [ "$POLICY" = "fail-closed" ]; then
    echo "" >&2
    echo "=======================================================" >&2
    echo " [ERROR] Commit rejected: jev-dev CLI not found." >&2
    echo " Verification could not be performed (fail-closed policy active)." >&2
    echo " Install jev-dev or use 'git commit --no-verify' to bypass." >&2
    echo "=======================================================" >&2
    echo "" >&2
    exit 1
  else
    echo "[Jev Hook] Warning: jev-dev CLI not found. Pre-commit verification skipped (fail-open policy active)." >&2
    exit 0
  fi
fi

if [ "$CLI_PATH" = "jev-dev" ]; then
  jev-dev patch review --staged --task "Pre-commit code quality and security verification"
else
  node "$CLI_PATH" patch review --staged --task "Pre-commit code quality and security verification"
fi

STATUS=$?

if [ $STATUS -eq 2 ]; then
  echo "" >&2
  echo "=======================================================" >&2
  echo " [BLOCKED] Commit rejected by Jev Patch Reviewer!" >&2
  echo " Critical credentials leak or high regression risk detected." >&2
  echo " Fix the issues or bypass with 'git commit --no-verify'." >&2
  echo "=======================================================" >&2
  echo "" >&2
  exit 1
fi

if [ $STATUS -ne 0 ]; then
  if [ "$POLICY" = "fail-closed" ]; then
    echo "" >&2
    echo "=======================================================" >&2
    echo " [ERROR] Commit rejected: Jev Patch Reviewer failed with execution error (exit code $STATUS)." >&2
    echo " Verification was incomplete (fail-closed policy active)." >&2
    echo " Fix the reviewer error or bypass with 'git commit --no-verify'." >&2
    echo "=======================================================" >&2
    echo "" >&2
    exit 1
  else
    echo "[Jev Hook] Warning: Jev Patch Reviewer failed with execution error (exit code $STATUS). Commit permitted (fail-open policy active)." >&2
    exit 0
  fi
fi

exit 0
`;
}

/**
 * Resolves the actual hooks directory for a given repository path,
 * correctly handling core.hooksPath, git worktrees, submodules, and standard repos.
 */
export function resolveHooksDirectory(repoPath: string = "."): string {
  const resolvedRepo = path.resolve(repoPath);

  // 1. Try resolving using git rev-parse --git-path hooks
  try {
    const output = childProcess.execFileSync(
      "git",
      ["rev-parse", "--git-path", "hooks"],
      { cwd: resolvedRepo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
    ).trim();
    if (output) {
      return path.isAbsolute(output) ? output : path.resolve(resolvedRepo, output);
    }
  } catch {
    // git CLI not available or not a git repo, fall back to filesystem inspection
  }

  // 2. Direct filesystem fallback
  const gitEntry = path.join(resolvedRepo, ".git");
  if (!fs.existsSync(gitEntry)) {
    throw new Error(`Not a git repository (missing .git directory in ${resolvedRepo})`);
  }

  const stat = fs.statSync(gitEntry);
  if (stat.isDirectory()) {
    return path.join(gitEntry, "hooks");
  }

  if (stat.isFile()) {
    // Git worktree or submodule file
    const content = fs.readFileSync(gitEntry, "utf8");
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (match && match[1]) {
      const gitDir = path.resolve(resolvedRepo, match[1].trim());
      const commonDirFile = path.join(gitDir, "commondir");
      if (fs.existsSync(commonDirFile)) {
        const commonDirRel = fs.readFileSync(commonDirFile, "utf8").trim();
        const commonDir = path.resolve(gitDir, commonDirRel);
        return path.join(commonDir, "hooks");
      }
      return path.join(gitDir, "hooks");
    }
  }

  throw new Error(`Not a git repository (invalid .git in ${resolvedRepo})`);
}

/**
 * Checks if an existing file was installed by Jev Developer Harness.
 */
export function isJevInstalledHook(hookFilePath: string): boolean {
  if (!fs.existsSync(hookFilePath)) {
    return false;
  }
  try {
    const content = fs.readFileSync(hookFilePath, "utf8");
    return content.includes(JEV_HOOK_SIGNATURE);
  } catch {
    return false;
  }
}

/**
 * Installs the pre-commit hook in the target repository's hooks directory.
 * Refuses to overwrite non-Jev user hooks unless options.force is true.
 */
export function installGitHook(
  repoPath: string = ".",
  options?: HookInstallOptions
): HookInstallResult {
  const hooksDir = resolveHooksDirectory(repoPath);

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookFile = path.join(hooksDir, "pre-commit");
  const policy: HookFailurePolicy = options?.policy === "fail-closed" ? "fail-closed" : "fail-open";

  if (fs.existsSync(hookFile)) {
    const existingIsJev = isJevInstalledHook(hookFile);
    if (!existingIsJev && !options?.force) {
      throw new Error(
        `A pre-commit hook already exists at ${hookFile} (not installed by Jev). Refusing to overwrite user hook without force option. Re-run with force to overwrite.`
      );
    }
  }

  const scriptContent = generatePreCommitScript(policy);
  fs.writeFileSync(hookFile, scriptContent, { mode: 0o755, encoding: "utf-8" });

  try {
    fs.chmodSync(hookFile, 0o755);
  } catch {
    // ignore on platforms where chmod is unsupported
  }

  return {
    installed: true,
    hookPath: hookFile,
    policy,
    message: `Pre-commit hook successfully installed at ${hookFile} (policy: ${policy})`,
  };
}

/**
 * Uninstalls the pre-commit hook from the target repository.
 * Refuses to delete non-Jev user hooks unless options.force is true.
 */
export function uninstallGitHook(
  repoPath: string = ".",
  options?: HookUninstallOptions
): HookInstallResult {
  let hooksDir: string;
  try {
    hooksDir = resolveHooksDirectory(repoPath);
  } catch {
    const resolvedRepo = path.resolve(repoPath);
    hooksDir = path.join(resolvedRepo, ".git", "hooks");
  }

  const hookFile = path.join(hooksDir, "pre-commit");

  if (!fs.existsSync(hookFile)) {
    return {
      installed: false,
      hookPath: hookFile,
      message: "No pre-commit hook found to uninstall.",
    };
  }

  const isJev = isJevInstalledHook(hookFile);
  if (!isJev && !options?.force) {
    return {
      installed: false,
      hookPath: hookFile,
      preservedExisting: true,
      message: `Pre-commit hook at ${hookFile} was not installed by Jev. Leaving existing user hook untouched.`,
    };
  }

  fs.unlinkSync(hookFile);

  return {
    installed: false,
    hookPath: hookFile,
    message: `Pre-commit hook successfully removed from ${hookFile}`,
  };
}
