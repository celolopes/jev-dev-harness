# Phase 8 Architecture Plan — Semantic Linting in CI

> **Notice**: This document defines the architectural plan for Phase 8. Implementation is reserved for future milestones.

---

## 1. Concept: Beyond Static Linting

Traditional linters (ESLint, Prettier, Ruff) enforce syntactic and stylistic rules. Compilers (TypeScript `tsc`, Rust `rustc`) enforce type safety.
However, CI pipelines currently lack an automated mechanism to detect **semantic and architectural drift**:
* Did a pull request mix domain logic directly into React UI components?
* Was an auto-generated migration file modified by hand?
* Did a change silently alter Row Level Security (RLS) policies without review?
* Were critical authorization checks bypassed in a newly added controller endpoint?
* Does a feature PR lack corresponding automated tests?

**Semantic Linting with Jev** fills this gap by turning architectural conventions and security guidelines into fast, calibrated, probabilistic checks executed during CI.

---

## 2. CI Pipeline Architecture

```
                 Pull Request Created / Updated
                                │
                                ▼
         ┌─────────────────────────────────────────────┐
         │         Traditional Linters & Types         │
         │           ESLint + TypeScript + Tests       │
         └──────────────────────┬──────────────────────┘
                                │ Passes
                                ▼
         ┌─────────────────────────────────────────────┐
         │         Jev Semantic Linter Engine          │
         │         (Diff extraction + Sanitization)    │
         └──────────────────────┬──────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
[Code Rules]                                   [Security Rules]
• Domain/UI mixing                            • Secret handling
• Missing tests for new logic                 • Auth bypass
• Manual edit of generated files              • RLS / policy drift
• Out-of-scope changes                        • Dangerous migrations
        │                                               │
        └───────────────────────┬───────────────────────┘
                                │
                                ▼
         ┌─────────────────────────────────────────────┐
         │    Advisory Summary Report & PR Comment     │
         │    (Non-blocking during initial rollout)    │
         └─────────────────────────────────────────────┘
```

---

## 3. Semantic Rule Catalog

### 3.1 Scope & Architecture Checks
1. **`out_of_scope_creep`**:
   * *Question*: `noul("Does this PR introduce changes unrelated to the linked issue description?")`
   * *Outcome*: Flags drive-by refactoring or accidental commits of debug code.
2. **`ui_domain_mixing`**:
   * *Question*: `noul("Does this UI component file contain direct database, SQL, or raw business domain mutation logic?")`
   * *Outcome*: Enforces clean architecture separation between presentation and business layers.
3. **`manual_generated_edit`**:
   * *Question*: `noul("Does this PR manually modify files marked as automatically generated, compiled, or schema-derived?")`
   * *Outcome*: Prevents drift between source generators (e.g. Prisma, OpenAPI) and generated outputs.

### 3.2 Security & Data Governance Checks
4. **`insecure_secret_handling`**:
   * *Question*: `noul("Does this change appear to commit secrets, log credentials, or bypass standard secret managers?")`
   * *Outcome*: Pre-empts credential leakage before deployment.
5. **`auth_boundary_change`**:
   * *Question*: `noul("Does this modification alter authorization guards, roles, permissions, or session validation?")`
   * *Outcome*: Automatically adds security team reviewers to the PR.
6. **`dangerous_migration`**:
   * *Question*: `score("Evaluate the downtime or data loss hazard of this database migration", ["Safe: Additive only", "Low: Table creation", "Moderate: Index change on large table", "High: Column drop or table rename", "Destructive: DROP TABLE or TRUNCATE"])`
   * *Outcome*: Warns against locking or destructive database changes.
7. **`rls_policy_alteration`**:
   * *Question*: `noul("Does this SQL change relax or alter Row Level Security policies or grant public database permissions?")`

---

## 4. Rollout Strategy: Advisory-First

To prevent developer friction and avoid false-positive merge blocks, the semantic linter will follow a 3-tier rollout:

* **Tier 1 (Advisory / Report-Only)**:
  * Runs as a GitHub Check that **always passes** (`exit 0`).
  * Posts a clean, collapsed Markdown comment on the PR summarizing findings with confidence scores.
* **Tier 2 (Warning Badges)**:
  * Displays findings in PR reviews as informational annotations.
  * Collects team feedback to calibrate thresholds and refine question rubrics.
* **Tier 3 (Policy Enforcing — Opt-in)**:
  * Only specific high-confidence rules (e.g., `dangerous_migration >= 4` or `insecure_secret_handling > 0.8`) block PR merging.

---

## 5. Sample GitHub Actions Workflow

```yaml
name: Jev Semantic Linter

on:
  pull_request:
    branches: [main, master]

jobs:
  semantic-lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Run Jev Semantic Linter (Advisory)
        env:
          TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx jev-dev lint semantic --base origin/main --head HEAD --advisory --comment-pr
```
