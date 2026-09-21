---
name: jev-patch-reviewer
description: >-
  Audits git diffs and generated patches before commit or pull request submission.
  Uses TypeSafe AI / Jev to evaluate regression risk, scope creep, auth/db changes,
  missing tests, and exposed credentials.
---

# Jev Patch Reviewer

The **Jev Patch Reviewer** provides automated semantic audit and risk triage of code changes before they are committed or submitted as pull requests.
It evaluates git diffs against the user's stated task to detect out-of-scope modifications, regression risks, security changes, and credential exposure.

## When to Use

Use this skill whenever:
* You have completed code edits and are about to create a git commit or pull request.
* You need to verify that your changes did not inadvertently modify unrelated files.
* You modified authentication, authorization, or database schemas and need a safety sanity check.
* You want to confirm that new business logic includes corresponding test coverage.

> **Agent Prompt Rule**:
> *"Antes de submeter um commit ou finalizar uma tarefa de alteração de código, execute o Jev Patch Reviewer para validar o diff."*

## How to Call

Invoke the patch reviewer via the CLI using your command execution tool:

```bash
# Audit uncommitted working tree changes
npx jev-dev patch review --task "<task description>" --json

# Audit staged changes
npx jev-dev patch review --task "Implement JWT validation" --staged --json

# Audit a commit range
npx jev-dev patch review --task "Refactor billing module" --commit-range HEAD~1 --json

# Audit a specific diff file
npx jev-dev patch review --task "Bug fix" --diff-file ./changes.patch --json
```

### Options

| Flag | Type | Description |
| :--- | :--- | :--- |
| `-t, --task <string>` | Required | Description of the task or user request |
| `-p, --path <string>` | Optional | Repository path (defaults to `.`) |
| `--staged` | Flag | Audits staged changes (`git diff --staged`) |
| `--commit-range <range>` | Optional | Evaluates commits in range (e.g. `HEAD~1` or `main..feature`) |
| `--diff <string>` | Optional | Direct unified diff string |
| `--diff-file <path>` | Optional | Path to a patch or diff file |
| `--json` | Flag | Output machine-readable JSON |
| `--no-jev` | Flag | Forces deterministic heuristic mode (offline) |

## Consuming the Output

When called with `--json`, the patch reviewer outputs:

```json
{
  "task": "Implement JWT validation",
  "status": "APPROVED",
  "riskScore": 12.5,
  "warnings": [],
  "judgments": {
    "isOutOfScope": 0.05,
    "regressionRisk": 1.0,
    "modifiesAuth": 0.85,
    "modifiesDatabase": 0.05,
    "missingTests": 0.10,
    "exposesSecrets": 0.0,
    "confidence": 0.92
  },
  "filesChanged": ["src/auth/jwt.ts", "tests/auth/jwt.test.ts"],
  "additions": 45,
  "deletions": 5,
  "diffSnippet": "...",
  "fallbackUsed": false,
  "latencyMs": 420
}
```

### Status Decisions

1. **`APPROVED`** (Fast Path):
   - Low regression risk and changes align with the task. Safe to proceed with commit or PR.
2. **`ESCALATE_REVIEWER`**:
   - Out-of-scope changes, high auth/database modifications without tests, or elevated risk.
   - Action: Review the `warnings` array, explain the changes to the user, and request confirmation.
3. **`BLOCK_HUMAN_REQUIRED`**:
   - Credentials detected or high regression risk.
   - Action: **STOP**. Do NOT commit. Fix the credential leak or investigate the breaking changes.
