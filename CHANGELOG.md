# Changelog

## 0.2.11 — 2026-09-30

- Add shared agent usage imports/comparisons for Antigravity, TRAE, Cursor,
  VS Code extensions and CLI exporters, with explicit source/coverage.
- Normalize OpenAI, Anthropic cache, Gemini thinking and Cursor event usage;
  preserve unknown breakdowns/costs and reject duplicate or overlapping requests.
- Add MCP `jev_import_usage`, CLI `efficiency import`, public export APIs and
  optional proxy JSON/SSE capture without retaining prompts or changing response bytes.
- Preserve Codex manifest compatibility; document hook/export setup and native
  integration limits instead of claiming universal automatic capture.

## 0.2.10 — 2026-09-30

- Add offline Codex rollout discovery/import and paired usage comparisons with
  exact cumulative counters, cache/reasoning breakdowns, source fingerprints and
  validation receipts. Unknown overhead/cost stays unknown; negative deltas remain.
- Add opt-in run-scoped Jev usage ledgers across model calls, the CLI efficiency
  workflow and MCP `jev_compare_usage`. No prompts or credentials in ledgers.
- Show the latest comparison separately in the dashboard without accumulating
  comparisons as proven savings. See `docs/jev/MEASURED-USAGE.md` for coverage,
  declared conditions, billing receipts and baseline setup.

## 0.2.9 — 2026-09-30

- Replace synthetic token/dollar savings with factual context counts, cache reuse,
  new logical model calls, validated response usage, cost coverage and fallback.
- Stop accumulating heuristic estimates as savings in telemetry and dashboard.
  Legacy events remain readable; unknown savings/cost are not zero.
- Correct MCP agent instructions and installed rule templates: only report audits
  actually executed. Tool pruning and proxy routing no longer invent token savings.
- Preserve native transport, ranking, cache keys and fallback behavior. See
  `docs/RELEASING.md` for the v2 efficiency contract and installed-rule migration.

## 0.2.8 — 2026-09-30

- Default new OpenRouter configurations to native `typesafe/jev-1.13` decisions.
- Validate Noul, Choice and Score responses before use or caching; reject missing confidence.
- Bound request and context-ranking deadlines, concurrency and retry behavior; use deterministic fallback on failures.
- Isolate decision caches by provider, model, question contract and candidate metadata.
- Report actual models, native/emulation modes and provider-reported cost coverage.
- Synchronize package and lockfile versions; advertise the package version in MCP.
- Add release checks, rebuild before packing, and document Git tags and npm `latest` publication.

Live cost/latency benchmarks and the Finainteli integration are separate work.
