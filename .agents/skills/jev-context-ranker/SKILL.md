---
name: jev-context-ranker
description: >-
  Intelligent context selector and ranker powered by TypeSafe AI / Jev.
  Use before loading large amounts of files or context into the conversation.
  Narrows down hundreds of candidates to the most relevant shortlist using a hybrid
  pipeline (deterministic filter -> heuristic search -> Jev semantic judgment -> calibrated ranking).
---

# Jev Context Ranker

The **Jev Context Ranker** provides intelligent, calibrated context selection for AI coding agents.
It prevents context window dilution, reduces token expenditure, and ensures the agent focuses on the exact files needed to solve a specific task.

## When to Use

Use this skill whenever:
* You are starting a new task and need to identify which files to read or inspect.
* You need to locate core implementation, test, configuration, or database files for a specific feature or bug.
* The workspace is medium or large, and inspecting everything would exceed or pollute the context window.

> **Agent Prompt Rule**:
> *"Antes de carregar grande quantidade de contexto, use o Jev Context Ranker para selecionar os arquivos mais relevantes."*

## How to Call

You can invoke the context ranker via the CLI using your command execution tool:

```bash
# Output formatted for machine consumption (JSON)
npx jev-dev context rank --task "<task description>" --path "<repository root>" --json

# Or with top-K limit
npx jev-dev context rank --task "Implement JWT authentication in user routes" --path . --top 5 --json
```

### Options

| Flag | Type | Description |
| :--- | :--- | :--- |
| `-t, --task <string>` | Required | Detailed description of the task or objective |
| `-p, --path <string>` | Optional | Path to the repository root (defaults to `.`) |
| `--top <number>` | Optional | Maximum number of candidates to select (default: `10`) |
| `--threshold <number>` | Optional | Minimum relevance score threshold between 0.0 and 1.0 (default: `0.15`) |
| `--json` | Flag | Produces machine-readable JSON output |
| `--no-cache` | Flag | Bypasses SHA-256 evaluation cache |
| `--no-jev` | Flag | Forces deterministic/heuristic fallback mode without remote API calls |

## Consuming the Output

When called with `--json`, the ranker outputs a stable JSON schema:

```json
{
  "task": "Implement JWT authentication in user routes",
  "repoPath": "/path/to/repo",
  "selected": [
    {
      "path": "src/auth/jwt.ts",
      "score": 0.942,
      "confidence": 0.91,
      "role": "implementation",
      "relevance": "Crucial",
      "reason": "Jev: Crucial (95% match, role: implementation) + heuristic: 92%",
      "source": "jev"
    },
    {
      "path": "tests/auth/jwt.test.ts",
      "score": 0.825,
      "confidence": 0.88,
      "role": "test",
      "relevance": "Highly Relevant",
      "reason": "Jev: Highly Relevant (85% match, role: test) + heuristic: 80%",
      "source": "jev"
    }
  ],
  "metrics": {
    "initialCandidates": 240,
    "filteredCandidates": 18,
    "evaluatedByJev": 8,
    "tokensSent": 950,
    "latencyMs": 320,
    "fallbackUsed": false
  }
}
```

### Decision Workflow for Agents
1. Read the `selected` array in order of descending `score`.
2. Prioritize files where `role` is `implementation` or `database` for understanding and writing changes.
3. Consult files where `role` is `test` to inspect existing assertions or add new test cases.
4. If `fallbackUsed` is `true`, the ranking was computed purely using deterministic heuristics (path & symbol search). The files remain valid and safe to proceed with.
