# Integrating Jev Context Ranker with Antigravity

This guide describes how **Google Antigravity** discovers, activates, and consumes the **Jev Context Ranker**.

---

## 1. Discovery Mechanism

Antigravity uses hierarchical discovery to locate skills and rules:
* Workspace skills placed in `.agents/skills/<skill-name>/SKILL.md` are automatically discovered when opening the project workspace.
* The skill is registered locally under:
  ```
  .agents/skills/jev-context-ranker/SKILL.md
  ```
* Antigravity uses **progressive disclosure**: the skill's name and description are visible in the agent's available skills catalog, while its detailed instructions are loaded only when relevant to the current user task.

---

## 2. Recommended Agent Directive

To ensure Antigravity uses the context ranker before reading files, add the following instruction to your project's `GEMINI.md` or `.agents/rules/context.md`:

```markdown
Antes de carregar grande quantidade de contexto ou inspecionar dezenas de arquivos, use o Jev Context Ranker para selecionar os arquivos mais relevantes para a tarefa:
`node <path-to-harness>/dist/cli/index.js context rank --task "<descrição da tarefa>" --path . --json`
```

---

## 3. Invocation from Antigravity

When an Antigravity agent works on a feature or bug, it executes:

```powershell
# Via run_command
node dist/cli/index.js context rank --task "Adicionar suporte a refresh tokens no módulo auth" --path . --json
```

The agent parses the JSON response:
1. It reads the top-scoring files in `selected`.
2. It prioritizes files where `role: "implementation"` for code changes.
3. It inspects files where `role: "test"` to update test suites.
4. It avoids opening files that were filtered out during Stage A or Stage B.

---

## 4. Troubleshooting in Antigravity

* **No API Key**: If `TYPESAFE_API_KEY` is not exported in the terminal environment, the harness transparently runs in **deterministic fallback mode**. The agent still receives the top files ranked by path, symbol, and keyword matches.
* **Large Repositories**: You can restrict the search space by passing `--top 5` or specifying candidates.
