# Phase 2 — Intelligent Context Selection and Ranking

The **Context Ranker** module provides a high-throughput, low-latency, hybrid pipeline to identify the most relevant files for any coding task before an AI agent loads them into its prompt.

---

## 1. Problem Statement

When an AI coding agent (like Codex or Antigravity) receives a prompt such as:
> *"Fix JWT token expiration validation and refresh token handling in auth endpoints"*

Naive approaches either:
1. Scan the whole repository and feed dozens of files into the model (costly, slow, risks attention dilution).
2. Ask the generative model to "think and list the files" (slow, non-deterministic, hallucinates paths).

The Context Ranker solves this with a **4-Stage Hybrid Architecture**:
Code filters out the noise cheaply, Jev provides calibrated probabilistic judgments for a small candidate shortlist, and the harness algorithm combines all signals into a finalized ranking.

---

## 2. Pipeline Stages

### Stage A: Deterministic Filtering (`stage-a-filter.ts`)
* Filters out paths matching `.gitignore` and `.jevignore`.
* Drops build directories (`node_modules`, `dist`, `target`, `build`, `bin`, `.venv`).
* Drops secret files (`.env`, `*.pem`, `*.key`, `id_rsa`).
* Sniffs file headers for null bytes to immediately eliminate binaries (`.png`, `.exe`, `.wasm`, `.zip`).
* Enforces a maximum file size limit (default: 100 KB).

### Stage B: Heuristic Fast-Search (`stage-b-candidates.ts`)
* Tokenizes the task objective into meaningful terms, preserving sub-tokens from `camelCase`, `kebab-case`, and `snake_case`.
* Evaluates filename and directory structure matches (basename matches receive $2.5\times$ weight).
* Inspects the file header and snippet (up to 1,600 characters):
  * Matches task tokens against exported code symbols (`function`, `class`, `interface`, `type`, `def`).
  * Counts keyword frequencies.
* Weights by language extension (`.ts`, `.py`, `.sql` vs `.json`, `.md`).
* Formula:
  $$\text{HeuristicScore} = \min\left(1.0, (0.45 \cdot \text{PathScore} + 0.35 \cdot \text{SymbolScore} + 0.20 \cdot \text{KeywordScore}) \cdot \text{ExtWeight}\right)$$
* Selects the Top $K$ candidates (default: 15) to evaluate in Stage C.

### Stage C: Jev Semantic Evaluation (`stage-c-jev.ts`)
* Uses SHA-256 caching to bypass re-evaluation if the task, file path, and snippet content hash match an earlier evaluation.
* Automatically runs secret redaction on snippets before sending state to Jev.
* Submits batched questions against the candidate state:
  * `relevant_to_task` (**Noul**): Probability that the file is directly relevant to implementing, testing, or understanding the task.
  * `relevance` (**Score**): Ordered rubric position from `Irrelevant` (0) to `Crucial` (4).
  * `role` (**Choice**): Categorical classification into:
    * `implementation`
    * `test`
    * `configuration`
    * `database`
    * `documentation`
    * `generated`
    * `unrelated`
    * `other`

### Stage D: Harness Ranking Algorithm (`stage-d-ranker.ts`)
* The ranking algorithm is strictly owned by the harness code:
  $$\text{RoleWeight} \in \{ \text{impl: } 1.0, \text{db: } 0.95, \text{test: } 0.85, \text{config: } 0.75, \text{docs: } 0.6, \text{other: } 0.5, \text{gen: } 0.15, \text{unrelated: } 0.0 \}$$
  $$\text{JevComposite} = \left(0.45 \cdot \text{Noul} + 0.40 \cdot \frac{\text{RelevanceScore}}{4.0} + 0.15 \cdot \text{RoleWeight}\right) \cdot \text{Confidence}$$
  $$\text{FinalScore} = 0.30 \cdot \text{HeuristicScore} + 0.70 \cdot \text{JevComposite}$$
* Filters candidates below the threshold (default: $0.15$).
* Slices to the requested top items (default: 10).

---

## 3. Fallback & Fault Tolerance

If Jev:
* Has no API key set (`TYPESAFE_API_KEY` is missing),
* Has `useJev: false` specified,
* Reaches network timeout (> 3500ms),
* Encounters a 500 error or connection failure,

The harness executes the **Deterministic Fallback**:
* Uses `HeuristicScore` directly as `FinalScore`.
* Infers file roles from extensions and path naming patterns.
* Sets `fallbackUsed: true` and notes `fallbackReason` in telemetry.
* **The agent receives a valid, sorted context list without crashing.**

---

## 4. Benchmark Results

Evaluated on the synthetic test suite (`tests/benchmark/context-ranker.bench.ts`):

| Task Domain | Precision@3 | Recall@3 | File Reduction | Token Reduction | Latency (Fallback) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth / JWT** | 66.7% | 100.0% | 88.2% | 88.2% | 20ms |
| **Database / SQL** | 66.7% | 100.0% | 88.2% | 88.2% | 8ms |
| **Billing / Stripe** | 33.3% | 50.0% | 94.1% | 94.1% | 8ms |

* Average token savings: **> 88%**.
* Candidate reduction: **> 88%**.
