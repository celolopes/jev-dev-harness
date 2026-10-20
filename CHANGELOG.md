# Changelog

## 0.2.15 — 2026-10-20

### Security

- Enforce conservative confirmation requirement for unknown commands when semantic
  evaluation is unavailable or returns an evaluator fallback. Synthetic fallback scores
  never silently allow unknown commands.
- Preserve meaningful, secret-redacted fallbackReason in guard responses and ensure
  offline evaluation (`useJev: false`) remains consistently protected.
- Known deterministic safe commands (read-only, local modification) and known destructive
  or production-sensitive commands retain their established protections regardless of
  remote provider availability.

### Fixed

- Support explicit failure policies (`fail-open` default for backward compatibility;
  `fail-closed` for strict security environments) in Git pre-commit hooks, with runtime
  override support via `JEV_HOOK_FAILURE_POLICY`.
- Ensure Git pre-commit hook rejects commits on reviewer execution errors under `fail-closed`
  while retaining blocking exit status 2 under all policies.
- Safeguard pre-commit hook installation and uninstallation: preserve existing user-managed
  hooks unless `--force` is specified, support Git worktrees, and resolve `core.hooksPath`
  safely.
- Isolate test fixtures across test suites to operating system temporary directories,
  resolving intermittent Windows `EBUSY` file-locking issues during Git directory cleanup.
- Prevent assertions from being swallowed in temporary repository gitignore tests.

## 0.2.14 — 2026-10-20

### Fixed

- Preserve the existing text-mode exit status in JSON patch review, guard checks
  and semantic lint. Successful and advisory results retain their existing codes.
- Preserve Git revision expressions, including reflog selectors with spaces, as
  a single argument and reject empty, control-character or option-shaped revisions.

### Security

- Remove shell interpolation from shared Git diff extraction used by patch review
  and semantic lint through CLI, MCP and public APIs. Git executes directly with
  argument arrays and an explicit revision/path boundary.
- Keep public API signatures, Node.js 22+, SDK/model dependencies and MIT licensing
  unchanged. See docs/RELEASING.md for JSON automation and revision-input guidance.

## 0.2.13 — 2026-10-15

- Share npm release reasons, declared requirements, release links and restart guidance
  across CLI, dashboard and MCP. Missing release metadata stays explicitly unknown.
- Deduplicate CLI notices across invocations, MCP notices per connection/version and
  dashboard dismissals per running/latest version. Long-lived surfaces check hourly.
- Correct the update cache comparison and keep the timeout active through body reads.
  Failed checks report unavailable, never a fabricated latest version.
- Preserve machine-readable CLI output and the MCP tool's first content block.
  `latestVersion` and version-command `isLatest` are nullable when verification fails.
- Keep SDK 0.7.0, Node.js 22+ and native Jev 1.13.0 unchanged. npm publication remains manual.

## 0.2.12 — 2026-10-15

- Upgrade TypeSafe SDK to 0.7.0 and require Node.js 22+. Preserve uncompressed
  transport during migration and keep images, Box and long-context features disabled.
- Pin the native default to jev-1.13.0; retain explicit model overrides and existing
  OpenRouter/Vercel IDs. Do not promote the Jev 1.14 preview automatically.
- Accept null token counters without discarding valid decisions. Preserve unknown
  totals and per-direction coverage in telemetry, reports, dashboard and ledgers;
  missing usage blocks net token comparisons while reported cost stays independent.
- Add an opt-in reproducible PT/EN model evaluation and its sanitized live evidence.
  Both models passed 42/42 synthetic checks; this is not a production acceptance
  test, cost comparison or measured task-savings baseline.

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
