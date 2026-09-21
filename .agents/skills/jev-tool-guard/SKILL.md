---
name: jev-tool-guard
description: >-
  Pre-execution safety gate for shell commands and tool calls.
  Classifies commands into read-only, modify-local, destructive-local, network,
  and production-sensitive categories, intercepting risky commands before execution.
---

# Jev Tool Call Guard

The **Jev Tool Call Guard** acts as an interceptor and safety verifier for shell commands and external tool invocations.
It ensures that coding agents do not execute destructive commands (e.g. `rm -rf`, `git reset --hard`, `DROP TABLE`) or interact with cloud/production environments without explicit authorization.

## When to Use

Use this skill whenever:
* You are about to execute a shell command via `run_command` that might modify state, delete files, or interact with external networks.
* The command is complex, involves chained commands, pipes, or shell scripts.
* You need to verify if an action requires user consent under safety guidelines.

> **Agent Prompt Rule**:
> *"Antes de executar comandos com potencial destrutivo ou de infraestrutura, use o Jev Tool Call Guard para verificar permissões e risco."*

## How to Call

Invoke the tool guard via CLI using your command execution tool:

```bash
# Check safety of a git reset command
npx jev-dev guard check --command "git reset --hard HEAD~1" --json

# Check command with task context
npx jev-dev guard check --command "npm test" --task "Run integration test suite" --json

# Check a command that requires network access
npx jev-dev guard check --command "git push origin main" --allow-network --json
```

### Options

| Flag | Type | Description |
| :--- | :--- | :--- |
| `-c, --command <string>` | Required | Shell command string to evaluate |
| `-t, --task <string>` | Optional | Contextual task description |
| `--allow-network` | Flag | Authorize network communications (git push, curl) |
| `--allow-production` | Flag | Authorize cloud / production commands |
| `--json` | Flag | Output machine-readable JSON format |
| `--no-jev` | Flag | Force deterministic rule-based evaluation (offline) |

## Consuming the Output

When called with `--json`, the guard outputs:

```json
{
  "command": "git reset --hard HEAD~1",
  "allowed": false,
  "requiresConfirmation": true,
  "category": "destructive-local",
  "riskLevel": "high",
  "reason": "Potentially destructive local command (git-destructive). Requires explicit human confirmation.",
  "matchedRule": "git-destructive",
  "fallbackUsed": false,
  "latencyMs": 1
}
```

### Command Categories and Handling

| Category | Risk | Default Action | Agent Behavior |
| :--- | :--- | :--- | :--- |
| `read-only` | Low | Allowed | Execute immediately without friction |
| `modify-local` | Low | Allowed | Execute safely within workspace |
| `destructive-local` | High | Confirmation Required | **Ask user confirmation** before running |
| `network` | Medium | Confirmation Required | Ask user or pass `--allow-network` if intended |
| `production-sensitive` | Critical | **Blocked** | Do NOT run without explicit user request and flag |
| `unknown` | Medium/High | Evaluated by Jev | Follow Jev's risk recommendation |
