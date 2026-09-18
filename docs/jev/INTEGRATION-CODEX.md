# Integrating Jev Context Ranker with OpenAI Codex

This guide describes how to configure and invoke the **Jev Context Ranker** within an **OpenAI Codex** environment (CLI, Desktop, or extension).

---

## 1. Discovery and Compatibility

* **Universal Skill**: The Vercel `skills` CLI installed the TypeSafe and Context Ranker skills under `.agents/skills/`.
* Codex automatically reads project guidelines from `AGENTS.md` at the project root or in parent directories.

---

## 2. Configuring Codex via `AGENTS.md`

Add the following section to your project's `AGENTS.md` (or your user-level `~/.codex/AGENTS.md`):

```markdown
## Context Management with Jev Context Ranker

Antes de carregar grande quantidade de contexto ou inspecionar dezenas de arquivos no workspace:
1. Execute o comando do Jev Context Ranker para identificar a lista calibrada de arquivos relevantes:
   `node dist/cli/index.js context rank --task "<sua tarefa>" --path . --json`
2. Utilize os arquivos retornados no array `selected` para focar sua análise.
3. Observe o campo `role` de cada arquivo (`implementation`, `test`, `database`, `configuration`) para guiar a leitura e escrita do código.
4. Se o retorno indicar `fallbackUsed: true`, confie na ordem heurística sem tentar reconfigurar credenciais.
```

---

## 3. Practical Example Prompt for Codex

When issuing tasks to Codex, prefix the request with the directive:

```text
Antes de carregar grande quantidade de contexto, use o Jev Context Ranker para selecionar os arquivos mais relevantes.

Tarefa: Implementar rate limiter no endpoint de login e adicionar testes unitários correspondentes.
```

Codex will:
1. Execute `node dist/cli/index.js context rank --task "Implementar rate limiter no endpoint de login" --path . --json`.
2. Inspect the returned JSON payload.
3. Open only the 2–3 relevant auth and route files.
4. Apply the required changes without blowing its token budget.

---

## 4. MCP Alternative vs CLI

While an MCP server can be configured, running the **CLI interface** (`node dist/cli/index.js context rank ... --json`) provides significant advantages in Codex:
* **Zero background daemon overhead**: No risk of port collisions or orphan processes.
* **Instant auditing**: The command and its JSON output are logged in Codex's turn transcript.
* **Universal portability**: Runs seamlessly across local development, Docker containers, and CI environments.
