# Measured usage across harnesses (0.2.11)

Jev measures its own calls in every MCP/CLI integration. Main-agent consumption
requires usage reported by the agent/provider: MCP cannot observe private client
inference. This feature provides shared import, comparison and optional proxy
collection, not automatic access to every editor's internal sessions.

## Supported data routes

| Client | Implemented route | External setup required |
| --- | --- | --- |
| Codex | Existing local rollout discovery/import | Equivalent completed runs and validation receipts |
| Antigravity | Common SDK/export bridge; Gemini adapter; configurable endpoint proxy | SDK hook/export wiring; IDE history is not automatically read |
| Cursor | Exported `cursor-event` adapter; common bridge/proxy | API access, stable request IDs, conversation/task filtering and all pages; no undocumented CSV parser |
| TRAE | Common export bridge/provider proxy | Actual reported usage source or configurable BYOK endpoint; no private log parser |
| VS Code/extensions | Library/MCP/CLI bridge and provider proxy | Wire provider completion hook; text-only APIs cannot supply measured usage |
| Other CLIs | OpenAI Chat/Responses, Anthropic and Gemini adapters | Export each real request, including workers/retries; or configure endpoint |

Native editor smoke tests were not run. Tests cover exports, normalization,
CLI/MCP entry points and local HTTP JSON/SSE forwarding. Closed services without
exports/configurable endpoints remain unknown. Quota percentages, tokenizers and
nominal price tables are not converted into measured tokens or bills.

## Common export contract

Illustrative structure; numbers below are not measurements of your task:

```json
{
  "schemaVersion": 1, "kind": "agent_usage", "harness": "vscode-extension",
  "sessionId": "independent-chat-id", "turnId": "task-interval-id",
  "initialRevision": "exact-starting-commit", "model": "actual-model",
  "effort": "actual-reasoning-configuration",
  "startedAt": "2026-09-30T10:00:00Z", "endedAt": "2026-09-30T10:01:00Z",
  "status": "completed", "coverage": "partial",
  "includesJevUsage": false, "jevCallsObserved": true,
  "events": [{
    "requestId": "actual-provider-request-id", "provider": "actual-provider",
    "format": "openai-responses",
    "usage": { "input_tokens": 100, "output_tokens": 20, "total_tokens": 120 }
  }]
}
```

Record **one final usage per actual request**, never per stream chunk. Preserve
stable IDs on reimport. Convert cumulative session snapshots to interval
differences at the source, not sums. Record each retry with its own ID; attempts
with no usage must use `usage: null`. Split intervals using different models.

`coverage: complete` declares that all agent/worker/retry requests are included.
Partial coverage or missing totals blocks a task token difference. Reported
subtotals remain separately labeled. Missing cache, reasoning or cost stays null.
`includesJevUsage` must be false: Jev overhead is collected separately. Keep
harness, model, effort, initial commit, environment and validation equivalent.

Usage formats:

- `openai-chat` / `openai-responses`: the reported `usage` object; cache/reasoning
  are subsets of primary input/output, never added again.
- `anthropic`: reported `usage`; total input adds uncached input, cache reads and
  writes. Absent cache counters leave total input unknown.
- `gemini`: REST `usageMetadata` in camelCase. Total includes thinking;
  contradictory totals or nonzero tool-use prompt counters require an explicit
  normalized breakdown. Map SDK snake_case fields explicitly.
- `cursor-event`: one exported usage event; input adds uncached/read/write
  counters. `chargedCents` is the reported USD charge; nominal `totalCents` and
  request credits are not substituted. Missing token usage is unknown.
- `normalized`: `inputTokens`, `outputTokens`, `totalTokens`,
  `cachedInputTokens`, `cacheWriteInputTokens`, `reasoningOutputTokens`.
  Cache/reasoning are included in primary totals; fields may be null.

Optional `costUsd` must come from a reported charge. Cost coverage is returned as
costed/captured requests. A partial sum is not a full bill. Monetary comparisons
still require matching complete billing receipts, never prices inferred from tokens.

## Hooks and extensions

The package's existing public library exports `exportAgentUsage(path, run)`,
`importAgentUsage(path)` and `normalizeAgentUsage(format, usage)`:

```ts
import { exportAgentUsage } from "jev-dev-harness";
exportAgentUsage(outputPath, {
  ...completedTaskMetadata,
  schemaVersion: 1, kind: "agent_usage", status: "completed",
  includesJevUsage: false,
  events: collectedResponses.map(response => ({
    requestId: response.requestId, provider: response.provider,
    format: "openai-responses", usage: response.usage ?? null,
  })),
});
```

The export allowlists metadata/counters, strips response text/prompts/unknown
fields, rejects duplicate requests and refuses overwrite. Python/shell hooks can
write the same contract and sanitize it using:

```sh
jev-dev efficiency import --input agent-usage.json --output sanitized-usage.json
```

Antigravity SDK total-only observations can map reported
`response.usage_metadata.total_token_count` to normalized `totalTokens`; leave
unreported fields null. VS Code text-only responses must use `usage: null` unless
the provider reports usage separately. Counting text is not actual request usage.

MCP: `jev_import_usage({inputPath, format: "agent_usage_v1"})` reads only specified
files without inference/writes. Restart installed MCP servers to expose the tool.

## Optional automatic capture through the existing proxy

Only for clients with configurable API endpoints; it does not intercept closed
services/TLS. Use a metadata JSON with the common identity/coverage fields above
(omit events, timestamps, kind/status; the proxy supplies them):

```sh
jev-dev efficiency begin --run-id task-jev-001
jev-dev proxy generic --upstream https://your-provider.example \
  --usage-metadata task-metadata.json --usage-output agent-usage.json \
  --measurement-run-id task-jev-001
```

Configure the client to use the proxy's localhost endpoint. The router's Jev calls
use this ledger; all other Jev tools must use the same measurement ID. Baselines
require `--no-routing` and `jevCallsObserved: false`. Routing-enabled captures
must declare Jev enabled. Metadata must not contain credentials.

Request model must match metadata (Gemini reads it from the models URL).
If the provider reports a different resolved model, the capture stays unknown;
use an exact model ID rather than an alias for controlled comparisons.
Stop gracefully with Ctrl+C/SIGTERM after all requests finish, then close the Jev ledger
with `efficiency finish`. A forced kill can lose in-memory observations; no
complete export is claimed. Empty captures are rejected. Capture one task at a time.

JSON/SSE responses are forwarded unchanged. Anthropic start/delta fields merge;
OpenAI/Gemini usage snapshots replace previous ones. Missing, invalid, oversized,
HTTP-error or failed response usage stays unknown. Only requests routed through
the proxy are observed; bypassed/hidden retries and external workers are outside
coverage. Multi-line SSE and unsupported protocols remain unknown. No request is
modified to force usage reporting: enable it in the client itself.

## Comparison compatibility

Use the existing [paired validation workflow](MEASURED-USAGE.md) with references:

```json
{"path": "agent-usage.json", "format": "agent_usage_v1"}
```

Missing `format` still means Codex JSONL, preserving 0.2.10 manifests.
`compareUsageRuns` is the general library function; `compareCodexRuns` remains an
alias. CLI `efficiency compare`, MCP `jev_compare_usage` and dashboard support
both sources. Codex-only comparisons retain schemaVersion 1; general comparisons
use schemaVersion 2 because primary counters and `agentTokenDelta` may be null.
Consumers must preserve unknown values. Do not sum repeated paired comparisons.

## Provider references

- [Anthropic cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Gemini UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata)
- [Antigravity SDK usage](https://www.antigravity.google/docs/sdk/lifecycle/)
- [Cursor exported usage](https://cursor.com/docs/account/teams/admin-api)
- [VS Code model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
