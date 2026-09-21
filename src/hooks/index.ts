import fs from "node:fs";
import path from "node:path";

export interface HookInstallResult {
  installed: boolean;
  hookPath: string;
  message: string;
}

const PRE_COMMIT_SCRIPT = `#!/bin/sh
# Jev Developer Harness - Pre-commit safety gate (Phase 3)
# Automatically audits staged changes for leaked credentials and high regression risk.

echo "Running Jev Patch Reviewer pre-commit audit..."

# Check if jev-dev is available in dist or node_modules
if [ -f "./dist/cli/index.js" ]; then
  CLI_PATH="./dist/cli/index.js"
elif [ -f "./node_modules/jev-dev-harness/dist/cli/index.js" ]; then
  CLI_PATH="./node_modules/jev-dev-harness/dist/cli/index.js"
elif command -v jev-dev >/dev/null 2>&1; then
  CLI_PATH="jev-dev"
else
  echo "[Jev Hook] Warning: jev-dev CLI not found. Skipping pre-commit audit."
  exit 0
fi

if [ "$CLI_PATH" = "jev-dev" ]; then
  jev-dev patch review --staged --task "Pre-commit code quality and security verification"
else
  node "$CLI_PATH" patch review --staged --task "Pre-commit code quality and security verification"
fi

STATUS=$?

if [ $STATUS -eq 2 ]; then
  echo ""
  echo "======================================================="
  echo " [BLOCKED] Commit rejected by Jev Patch Reviewer!"
  echo " Critical credentials leak or high regression risk detected."
  echo " Fix the issues or bypass with 'git commit --no-verify'."
  echo "======================================================="
  echo ""
  exit 1
fi

exit 0
`;

/**
 * Installs the pre-commit hook in the target repository's .git/hooks directory.
 */
export function installGitHook(repoPath: string = "."): HookInstallResult {
  const resolvedRepo = path.resolve(repoPath);
  const gitDir = path.join(resolvedRepo, ".git");

  if (!fs.existsSync(gitDir)) {
    throw new Error(`Not a git repository (missing .git directory in ${resolvedRepo})`);
  }

  const hooksDir = path.join(gitDir, "hooks");
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookFile = path.join(hooksDir, "pre-commit");
  fs.writeFileSync(hookFile, PRE_COMMIT_SCRIPT, { mode: 0o755, encoding: "utf-8" });

  return {
    installed: true,
    hookPath: hookFile,
    message: `Pre-commit hook successfully installed at ${hookFile}`,
  };
}

/**
 * Uninstalls the pre-commit hook from the target repository.
 */
export function uninstallGitHook(repoPath: string = "."): HookInstallResult {
  const resolvedRepo = path.resolve(repoPath);
  const hookFile = path.join(resolvedRepo, ".git", "hooks", "pre-commit");

  if (!fs.existsSync(hookFile)) {
    return {
      installed: false,
      hookPath: hookFile,
      message: "No pre-commit hook found to uninstall.",
    };
  }

  fs.unlinkSync(hookFile);

  return {
    installed: false,
    hookPath: hookFile,
    message: `Pre-commit hook successfully removed from ${hookFile}`,
  };
}
