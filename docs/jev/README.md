# Jev Developer Harness (`jev-dev-harness`)

> **Experimental Developer Harness using TypeSafe AI / Jev to enhance coding agent workflows (Codex, Antigravity, and similar tools).**

---

## Overview

The **Jev Developer Harness** is an external companion toolkit designed to enhance AI coding agents without modifying their proprietary internals. 

Traditional Large Language Models (LLMs) excel at generative reasoning, but using them for high-volume context filtering, routing, and guardrails is slow, expensive, and prone to context window dilution. **TypeSafe AI's Jev** is a "System One" decision model: it evaluates application state and natural language against typed questions, returning calibrated probabilities and discrete choices without generating chat or reasoning tokens.

The harness acts as a bridge:
1. **Determinism First**: Discards irrelevant files, binaries, build outputs, and credentials using fast code rules.
2. **Jev Semantic Signals**: Uses Jev for fast, focused, batched judgments (`noul`, `score`, `choice`).
3. **Calibrated Ranking**: Code in the harness calculates the final ranking and confidence.
4. **Resilient Fallback**: If Jev is offline, times out, or lacks an API key, the harness transparently falls back to deterministic heuristic ranking, ensuring coding agents are never blocked.

---

## Architecture

```
Hundreds of repository files
       │
       ▼ [Stage A: Deterministic Filter]
   .gitignore, .jevignore, binary sniffing, oversized file limits
       │
       ▼ [Stage B: Heuristic Fast Search]
   Path matching, symbol extraction, keyword frequency, snippet extraction
       │
       ▼ [Top ~15 Candidates]
       ▼ [Stage C: Jev Evaluation]
   Batch questions per file:
     • relevant_to_task (Noul)
     • relevance (Score)
     • role (Choice)
       │
       ▼ [Stage D: Harness Ranking Algorithm]
   Harness code combines Jev confidence, role weight & heuristic signals
       │
       ▼
   Top-K calibrated shortlist -> AI Coding Agent (Codex / Antigravity)
```

---

## Available Interfaces

* **CLI**: `npx jev-dev context rank --task "<task>" --path . [--json]`
* **Agent Skill**: `.agents/skills/jev-context-ranker/SKILL.md` (natively discovered by Antigravity and Codex)
* **TypeScript / Node API**: `import { rankContext } from 'jev-dev-harness'`

---

## Quickstart

### 1. Installation

```bash
npm install
npm run build
```

### 2. Running via CLI

```bash
# Human-readable report
node dist/cli/index.js context rank --task "Implement JWT authentication in user routes" --path .

# Machine-readable JSON for agents
node dist/cli/index.js context rank --task "Implement JWT authentication in user routes" --path . --json
```

### 3. Environment Variables

* `TYPESAFE_API_KEY`: Optional TypeSafe API key. If absent, the harness operates in deterministic fallback mode automatically without failing.

---

## Roadmap

* **FASE 2** — Seleção e ranking inteligente de contexto (**Implemented**)
* **FASE 3** — Auditoria de diffs e tool calls (**Planned / Documented**)
* **FASE 8** — Semantic linting em CI (**Planned / Documented**)
