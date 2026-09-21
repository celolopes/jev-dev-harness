# Jev Developer Harness (`jev-dev-harness`)

[![Tests](https://img.shields.io/badge/tests-102%20passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)]()
[![Node](https://img.shields.io/badge/Node.js-22+-green.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeSafe AI](https://img.shields.io/badge/Powered%20By-TypeSafe%20AI%20%2F%20Jev-purple.svg)](https://typesafe.ai)

> **An open-source developer harness and runtime safety toolkit for AI coding agents (Antigravity, Codex, Claude Code, Cursor, Aider) powered by TypeSafe AI / Jev.**

---

## 🚀 Why Jev Developer Harness?

Large Language Models (LLMs) are exceptional at generative synthesis and reasoning, but using them for high-volume context filtering, safety guardrails, and patch triage is **slow, expensive, and prone to context window dilution**.

**TypeSafe AI's Jev** is a specialized "System One" decision engine. Rather than generating chat text, it evaluates application state and natural language against typed, calibrated questions (`noul`, `score`, `choice`) with sub-second latency and consistent probabilities.

`jev-dev-harness` bridges the gap between coding agents and codebase safety:

```
                          AI Coding Agent (Codex, Antigravity, Claude Code)
                                              │
         ┌────────────────────────────────────┼────────────────────────────────────┐
         ▼                                    ▼                                    ▼
   [Context Ranker]                   [Tool Call Guard]                    [Patch Reviewer]
  Selects surgical 3-5               Intercepts shell commands            Audits git diffs before
  relevant files (<90% tokens)        in <1ms (blocks destructive)         commits (secrets, scope, auth)
         │                                    │                                    │
         └────────────────────────────────────┼────────────────────────────────────┘
                                              ▼
                                   [Semantic Linter in CI]
                                 Enforces architectural drift
                                 and safety rules in GitHub PRs
```

---

## ⚡ Key Modules

| Module | Command | Purpose |
| :--- | :--- | :--- |
| **Context Ranker** | `jev-dev context rank` | Selects the top 3-5 crucial files for a task, reducing token bloat by 88%–94%. |
| **Tool Call Guard** | `jev-dev guard check` | Intercepts agent commands in <1ms, categorizing operations into `read-only`, `modify-local`, `destructive-local`, `network`, or `production-sensitive`. |
| **Patch Reviewer** | `jev-dev patch review` | Fast triage of git diffs before commit/PR. Detects scope creep, credential exposure, database mutations, and missing tests. |
| **Semantic Linter** | `jev-dev lint semantic` | Automated architectural drift detection in GitHub Actions CI (prevents UI/database mixing, dangerous migrations, etc.). |
| **Git Hook Automation** | `jev-dev hooks install` | 1-click installer for git pre-commit safety gate. Blocks commits containing leaked credentials or critical regression risk. |

---

## 🔑 Dual-Provider Architecture: Native TypeSafe & OpenRouter

`jev-dev-harness` is designed to be accessible to everyone:

1. **Native TypeSafe AI (Recommended)**:
   * Direct integration with TypeSafe's Jev System One model.
   * Calibrated probabilities, native discrete choices, and extreme low-latency evaluation.
   * Automatically activated when `TYPESAFE_API_KEY` (or `JEV_API_KEY`) is set.
2. **OpenRouter Emulator (Community & Multi-Model)**:
   * Emulates Jev's structured System One contract (`noul`, `score`, `choice`) using fast reasoning models (e.g., `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`).
   * Automatically activated when `OPENROUTER_API_KEY` (or keys starting with `sk-or-`) is configured.
3. **Deterministic Offline Fallback**:
   * If offline or no API keys are provided, the harness automatically falls back to regex and heuristic analysis. **Your coding agents are never blocked by API downtime.**

---

## 📦 Installation

### Option 1: Global CLI (Recommended)

```bash
# Clone the repository
git clone https://github.com/celolopes/jev-dev-harness.git
cd jev-dev-harness

# Install dependencies and build
npm install
npm run build

# Link globally to use `jev-dev` anywhere
npm link
```

### Option 2: Run via npx / local script

```bash
node dist/cli/index.js --help
# Or if linked:
npx jev-dev --help
```

---

## 🛠️ Usage Guide

### 1. Context Ranker (`context rank`)
Narrow down an entire codebase to the exact files needed for a prompt:

```bash
# Formatted human output
jev-dev context rank --task "Implement JWT authentication token refresh and logout routes" --path .

# Machine-readable JSON (ideal for AI coding agents)
jev-dev context rank --task "Implement JWT authentication" --top 5 --json
```

Output example:
```json
{
  "task": "Implement JWT authentication",
  "selected": [
    {
      "path": "src/auth/jwt.ts",
      "score": 0.94,
      "confidence": 0.92,
      "role": "implementation",
      "reason": "Jev: Crucial (95% match, role: implementation) + heuristic: 92%"
    },
    {
      "path": "tests/auth/jwt.test.ts",
      "score": 0.84,
      "confidence": 0.90,
      "role": "test",
      "reason": "Jev: Highly Relevant (85% match, role: test) + heuristic: 82%"
    }
  ],
  "metrics": {
    "initialCandidates": 240,
    "filteredCandidates": 14,
    "tokensSent": 950,
    "latencyMs": 280
  }
}
```

---

### 2. Tool Call Guard (`guard check`)
Inspect shell commands before execution to prevent accidental file deletion or production outages:

```bash
# Safe read-only inspection -> ALLOWED immediately
jev-dev guard check --command "git status"

# Destructive command -> BLOCKED (Requires confirmation)
jev-dev guard check --command "git reset --hard HEAD~1"

# Production cloud command -> BLOCKED (Critical safety risk)
jev-dev guard check --command "gcloud compute instances delete prod-server"

# Authorize network operations explicitly if intended
jev-dev guard check --command "git push origin main" --allow-network
```

---

### 3. Patch Reviewer (`patch review`)
Audit a patch or git diff before committing:

```bash
# Review uncommitted working tree changes
jev-dev patch review --task "Refactor authentication session handling"

# Review staged changes
jev-dev patch review --staged --task "Fix invoice tax calculation"

# Review a specific commit range
jev-dev patch review --commit-range HEAD~1 --task "Database migration"
```

Output:
```
=======================================================
             JEV PATCH REVIEWER (PHASE 3)             
=======================================================

Task:        Fix invoice tax calculation
Status:      [APPROVED] (Risk Score: 12.0/100)
Diff Stats:  2 file(s), +24 / -3 lines

--- JUDGMENTS BREAKDOWN ---
  Regression Risk:   1.0 / 4.0
  Out Of Scope:      5%
  Modifies Auth:     0%
  Modifies Database: 0%
  Missing Tests:     10%
  Exposes Secrets:   0%
  Confidence:        92%
=======================================================
```

---

### 4. Git Pre-Commit Hook (`hooks install`)
Protect your repository automatically on every `git commit`:

```bash
jev-dev hooks install
```

Whenever you run `git commit`, the hook evaluates your staged diff:
* If secrets, private keys, or catastrophic regressions are detected, **the commit is aborted** (`exit 1`).
* If clean, the commit proceeds instantly.
* To uninstall: `jev-dev hooks uninstall`.

---

### 5. Semantic Linter in CI (`lint semantic`)
Prevent architectural drift in pull requests:

```bash
# Run locally over staged changes
jev-dev lint semantic --staged

# Run in advisory mode (report findings without breaking build)
jev-dev lint semantic --commit-range origin/main...HEAD --advisory
```

#### GitHub Actions Workflow
Add `.github/workflows/jev-lint.yml` to your repository:

```yaml
name: Jev Semantic Linter

on:
  pull_request:
    branches: [main, master]

jobs:
  semantic-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx jev-dev lint semantic --commit-range origin/main...HEAD --advisory
        env:
          TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Built-in rules:
* `insecure_secret_handling`: Detects hardcoded secrets, private keys, or leaked tokens.
* `dangerous_migration`: Blocks destructive database operations (`DROP TABLE`, `TRUNCATE`).
* `ui_domain_mixing`: Prevents raw SQL queries inside React / UI components.
* `auth_boundary_change`: Flags changes to authentication and permission guards.
* `manual_generated_edit`: Flags manual edits to auto-generated or compiled code.
* `missing_tests`: Requires automated test coverage for new business logic.

---

## 🤖 Integration with AI Coding Agents

`jev-dev-harness` ships with official agent skills located in `.agents/skills/`:
* `jev-context-ranker`: Instructs agents to rank context before loading files.
* `jev-tool-guard`: Instructs agents to verify shell commands before execution.
* `jev-patch-reviewer`: Instructs agents to audit git diffs before completing tasks.

These are natively discovered by **Antigravity**, **Codex**, and any agent adhering to standard skill conventions.

---

## ⚙️ Environment Variables

Create a `.env` file or export environment variables:

| Variable | Description |
| :--- | :--- |
| `TYPESAFE_API_KEY` or `JEV_API_KEY` | Official TypeSafe AI API key (enables native Jev System One). |
| `OPENROUTER_API_KEY` | OpenRouter API key (enables LLM emulation mode, e.g. `gpt-4o-mini`). |
| `JEV_PROVIDER` | Force provider: `typesafe` or `openrouter`. |
| `OPENROUTER_MODEL` | Custom OpenRouter model slug (default: `openai/gpt-4o-mini`). |
| `OPENROUTER_EFFORT` | Reasoning effort for supported models (`low`, `medium`, `high`). |

---

## 🧪 Testing

The repository features comprehensive integration and unit test suites:

```bash
# Run full Vitest test suite (102 tests)
npm test

# Run benchmark suite (precision, recall, token reduction)
npm run bench

# Run TypeScript typecheck
npm run typecheck
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
