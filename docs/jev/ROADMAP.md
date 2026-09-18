# Roadmap — Jev Developer Harness

This document outlines the strategic roadmap for the **TypeSafe AI / Jev Developer Harness**.

---

## Phases Overview

| Phase | Module | Status | Primary Interface | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Shared Foundation | **DONE** | TypeScript / Node | Shared TypeSafe client, redaction, telemetry, cache, ignore filters. |
| **Phase 2** | Context Ranker | **DONE** | CLI & Agent Skill | 4-stage hybrid context selection, benchmark, fallback and ranking. |
| **Phase 3** | Patch Reviewer & Tool Guard | **PLANNED** | CLI & Pre-tool Hook | Pre-execution safety guardrails and pull-request patch auditing. |
| **Phase 4** | Prompt Optimizations | *Backlog* | Library | Dynamic token budget allocator and snippet compressor. |
| **Phase 5** | Test Coverage Advisor | *Backlog* | CLI / Skill | Identifies untested branches and generates test specifications. |
| **Phase 6** | Agent Memory Compactor | *Backlog* | CLI / Hook | Summarizes multi-turn agent conversation state using Jev choices. |
| **Phase 7** | Multi-Agent Router | *Backlog* | API | Routes tasks between cheap and expensive agent models. |
| **Phase 8** | Semantic Linting in CI | **PLANNED** | GitHub Actions / CLI | Non-blocking advisory semantic checks combining linters and Jev. |

---

## Detailed Focus for Current Milestone

### FASE 2: Context Ranker (Current Milestone — Complete)
* **Goal**: Reduce hundreds of repository files to a high-precision, low-token shortlist for coding agents.
* **Deliverables**:
  * Shared infrastructure (`typesafe-client`, `redaction`, `telemetry`, `cache`, `ignore`).
  * 4-Stage hybrid pipeline (Deterministic -> Heuristic -> Jev -> Harness Ranking).
  * Robust fallback when API key is missing or service is offline.
  * CLI tool `jev-dev context rank` with human and JSON output formats.
  * Project-local Agent Skill `.agents/skills/jev-context-ranker/SKILL.md`.
  * Local benchmark suite measuring Precision@K, Recall@K, file and token reduction.

### FASE 3: Patch Reviewer & Tool Call Guard (Next Milestone)
* **Goal**: Guard agent executions against destructive actions and audit code diffs for regressions and scope creep.
* **Modules**:
  * `patch-reviewer`: Evaluates git diffs before submission; detects auth changes, missing tests, schema mutations.
  * `tool-call-guard`: Inspects bash/command calls before execution; classifies into safety categories (`read-only`, `destructive-local`, `production-sensitive`, etc.).

### FASE 8: Semantic Linting in CI (Future Milestone)
* **Goal**: Bring semantic validation into GitHub Actions without blocking merges.
* **Mechanism**:
  * Combines static linters (ESLint, TSC) with Jev semantic questions.
  * Generates advisory PR comments highlighting architectural drift, authorization discrepancies, or missing tests.
