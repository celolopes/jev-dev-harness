# Measured Codex task comparisons

This workflow compares observed usage, not file-count estimates. It runs locally,
does not upload rollout content and does not make new model requests. Codex
rollout JSONL is an observed local format, not a guaranteed public API. Unknown,
incomplete, reset or ambiguous counters are rejected rather than guessed.

## Developer workflow

1. Choose a small task with an objective validation (the same tests/checks on
   both results). Start both runs from the same commit, with the same agent model,
   reasoning effort, instructions and tool configuration, except the Jev change
   being evaluated. Keep cache conditions comparable and document them.
2. Run the baseline with Jev disabled. Use separate chats; reused history is a
   confounder. If a task uses several turns/subagents/reviewers, include every
   related interval in the manifest. The importer does not discover completeness
   or prove equivalence automatically.
3. Before the Jev run, start a unique ledger:

   ```sh
   jev-dev efficiency begin --run-id auth-jev-001
   ```

   Include `measurementRunId: "auth-jev-001"` on **every** Jev MCP call during
   that run. For CLI calls, set `JEV_MEASUREMENT_RUN_ID=auth-jev-001` in that
   process. All model-based harnesses use the same scoped collector. Concurrent
   MCP calls with different IDs stay isolated. Cache/heuristic calls do not
   create model-request records. No state, prompts, answers or keys enter the
   ledger. Missing/in-progress calls are not treated as zero usage.
4. Wait for all calls to complete, validate the task result, then close the ledger:

   ```sh
   jev-dev efficiency finish --run-id auth-jev-001
   jev-dev efficiency list --repo . --json
   ```

   `list` finds local logs by repository and gives session/turn IDs, timestamps,
   model, initial revision, counters and absolute rollout paths. It does not
   print messages or infer a baseline. It scans at most 200 recent files; use
   `--sessions-path` for a particular date or archived logs.
   Internal `codex-auto-review` intervals are excluded from this list by default;
   use `--include-internal` to locate them when reconciling task overhead.
5. Create the comparison manifest and validation receipts below. Your assistant
   can assemble them after you identify the two runs; you need not find JSONL
   files by hand. Run:

   ```sh
   jev-dev efficiency compare --manifest comparison.json --json
   ```

   Codex can also call `jev_compare_usage` with `manifestPath`. The comparison is
   recorded in local telemetry and shown as the latest paired task comparison in
   the dashboard. `--no-record` prevents telemetry writes. Reimporting a pair
   does not add its differences to a cumulative savings figure.

## Manifest and receipts

Illustrative manifest; replace the paths/IDs with actual records. Relative paths
are resolved against this manifest, not the caller's working directory.

```json
{
  "schemaVersion": 1,
  "taskId": "auth-validation",
  "initialRevision": "exact-starting-commit-hash",
  "environmentId": "same-model-tools-prompt-and-cache-conditions",
  "allRelatedSessionsIncluded": true,
  "baseline": {
    "rollouts": [{ "path": "baseline.jsonl", "turnId": "baseline-turn-id" }],
    "jevDisabled": true,
    "validationReceipt": "baseline-validation.json"
  },
  "withJev": {
    "rollouts": [{ "path": "with-jev.jsonl", "turnId": "jev-turn-id" }],
    "validationReceipt": "jev-validation.json",
    "measurementRunId": "auth-jev-001",
    "ledgerPath": "path-to-auth-jev-001.jsonl",
    "allJevCallsRecorded": true
  }
}
```

Each validation receipt is tied to its exact session/turn IDs:

```json
{
  "taskId": "auth-validation",
  "criterionId": "same-test-suite-and-functional-check",
  "passed": true,
  "runIds": ["actual-session-id:actual-turn-id"],
  "evidenceReference": "actual-test-report-artifact"
}
```

These are explicit user/evaluator attestations. The importer verifies matching
IDs and fields, hashes the source files and checks the counters, but does not
execute the validation command or independently verify the task quality, disabled
Jev, declared environment equivalence or completeness of related sessions. Do
not declare them true before those conditions are verified.

## What the report means

- `agentTokenDelta`: baseline agent total minus Jev-run agent total, within the
  imported intervals. Positive means lower observed consumption; negative means
  higher. Repeated cumulative snapshots count once; earlier session usage is
  subtracted. Forks without a prior baseline snapshot, counter resets, incomplete
  turns, duplicate intervals, model/effort/revision mismatches and failed quality
  receipts are rejected.
- Cached input is already included in input; reasoning is already included in
  output. They are reported as breakdowns, not added again. Missing cache-write
  details stay unknown. See [OpenAI usage definitions](https://developers.openai.com/api/docs/guides/agents-api/observability)
  and [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
- `pipelineTokenDelta`: agent delta minus **reported** Jev tokens. Available only
  with a finished ledger, no request with unknown usage, and declared full Jev
  coverage. Different tokenizers produce reported token units, not identical text
  lengths. Provider-unreported retries/failures remain outside this figure.
- `moneyDeltaUsd`: unknown by default. Codex local token counters are not a bill
  and do not establish how ChatGPT subscription limits are calculated. Full cost
  for both runs must come from billing receipts, not fixed tokens-per-file or an
  assumed rate. Jev's reported response cost remains separately visible with
  coverage; it is not automatically a complete task cost.

Optional billing receipts, referenced by `billingReceipt` on each run, use:

```json
{
  "runFingerprint": "fingerprint-returned-for-this-run-by-compare",
  "currency": "USD",
  "amount": 0.0123,
  "coverage": "all_agent_and_jev_costs",
  "sourceReference": "actual-provider-billing-export"
}
```

The amount above is an example only. Both receipts must include all agent,
subagent/reviewer, Jev and retry charges. Matching fingerprints prevent mixing
receipts with different logs/ledgers. Receipts are imported and explicitly marked
as not independently verified. Unknown cost is never zero; negative differences
are retained. A single pair describes that experiment, not causal proof or a
general savings claim. Repeat controlled pairs to evaluate consistency.

## Installation

The new importer is prepared for 0.2.10. Installing 0.2.9 fixes reporting but
does not add these commands. After installing the build containing this feature,
restart Codex's MCP process and confirm `jev_compare_usage` is listed. Do not
publish a changed artifact under the already published 0.2.9 version.

`JEV_MEASUREMENT_DIR` can redirect local ledgers; otherwise they live in
`~/.jev-dev/measurements`. Use a new run ID for each experiment. Collection is
opt-in and errors on invalid IDs, missing begun runs or closed ledgers. Check
local logs before sharing them: the original Codex rollout may contain private
prompts even though comparison results contain only selected metadata/usage.
