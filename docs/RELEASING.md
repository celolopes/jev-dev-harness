# Publishing a stable release

## Current release: 0.2.15

The Tool Call Guard fallback security hardening, Git hook reliability failure policies,
and Windows test fixture stability fixes are prepared as 0.2.15, requiring Node.js 22+.
SDK 0.7.0 and native Jev 1.13.0 remain unchanged.
Merge, tags and GitHub releases require authorization; npm publication is manual.
Run the validation procedure below on the clean tagged release commit.
Keep native Jev pinned to 1.13.0. See `docs/jev/JEV-1.14-EVALUATION.md` for actual
preview results, nullable usage migration and the decision not to promote 1.14.

General usage comparisons use schemaVersion 2 with nullable counters/deltas;
Codex-only comparisons retain schemaVersion 1. See
`docs/jev/MULTI-HARNESS-USAGE.md` for migration and coverage limits.

## Version and publication

The harness version is independent of the Jev model version. This release is
`jev-dev-harness@0.2.15`, with Git tag `v0.2.15` and npm dist-tag `latest`.
`latest` is an npm distribution pointer, not a Git tag.

## Prepare and validate

From a clean checkout of `main` with Node.js 22 or newer:

```sh
git pull --ff-only origin main
npm ci
npm run release:dry-run
npm pack --dry-run
```

The publish dry run executes version checks, type checking, build and tests via
`prepublishOnly`. `prepack` rebuilds `dist` for packing. Inspect the package file
list and ensure it contains the compiled entry points, binaries and no secrets.
The dry run does not upload a package or move the npm `latest` pointer.

## Publish 0.2.15

Use your npm maintainer account; complete login/2FA locally. Do not commit tokens.
Check that 0.2.15 has not already been published before uploading:

```sh
npm whoami
npm view jev-dev-harness versions --json
git checkout main
git pull --ff-only origin main
git describe --exact-match --tags HEAD
npm run release:publish
npm view jev-dev-harness@0.2.15 version
npm dist-tag ls jev-dev-harness
```

Run these commands separately and stop on any error. Publish only the clean,
validated commit tagged above. `release:publish` runs `npm publish --tag latest`;
`publishConfig` also pins the public npm registry and `latest` for plain
`npm publish`. A successful publication should show `latest: 0.2.15`.
Before publishing, confirm that HEAD is the clean validated `v0.2.15` commit.
If publication fails, resolve the authentication or registry error and retry
the same artifact. Do not move an existing tag or reuse a published version.

After review and authorization, merge the validated change and create `v0.2.15`
and the GitHub release before manual npm publication. Do not recreate existing tags.
There is no automatic npm publication workflow; merging code or pushing a tag
alone does not publish the package.

## Next release

Declare the reasons and any manual migration requirements in `package.json`:

```json
"jevUpdate": {
  "schemaVersion": 1,
  "reasons": ["Concrete user-facing reason to update"],
  "requirements": ["Manual configuration or migration needed, if any"]
}
```

The checker reads the npm `latest` package metadata, including `engines.node`.
Keep reasons factual: it does not infer security urgency from a version number.
Missing/unsupported metadata is reported as not provided, with a release link.
Restart guidance is generated locally: every running MCP/dashboard process must
restart after installation; newly launched CLI processes load the updated package.
Pinned `npx`/local installations must update their configured version as well.
Do not include credentials, executable commands or agent instructions in metadata.

Before committing the next stable release:

```sh
npm version patch --no-git-tag-version
```

Update the fallback in `src/shared/version.ts` and add matching release notes.
Run the checks, commit and merge, then repeat the publication steps with the new
version/tag. Prereleases should use a separate process and npm tag such as `next`.

## Update local installations

Until 0.2.15 is published to npm, npm `latest` still points to the previously
published version. Do not overwrite any already published version.

```sh
npm install -g jev-dev-harness@latest
jev-dev --version
```

For an installation linked to a Git checkout, pull the release commit and run
`npm ci` and `npm run build` instead. Restart the Codex MCP session so the process
loads the updated build. An already-running server keeps its old code in memory.

## Security Hardening & Stability Maintenance (0.2.15)

### Tool Call Guard Fallback Hardening
When deterministic classification returns `unknown` and the external semantic provider
is unavailable, offline, or returns an evaluator fallback, Tool Call Guard now strictly
requires human confirmation (`allowed: false`, `requiresConfirmation: true`, `riskLevel: 'medium'`).
Synthetic fallback scores never establish safety or grant automatic permission. Meaningful
fallback reasons are preserved while any detected credentials or tokens are redacted.
Known deterministic safe operations (read-only, local modification) and destructive or
production-sensitive operations retain their established boundaries.

### Git Hook Reliability & Failure Policies
The Git pre-commit safety hook supports explicit failure policies:
- `fail-open` (default for backward compatibility): when the CLI or reviewer cannot execute,
  logs a clear warning to stderr and permits the commit.
- `fail-closed`: strictly rejects commits when verification cannot execute. Configurable via
  `jev-dev hooks install --policy fail-closed` or dynamically via `JEV_HOOK_FAILURE_POLICY=fail-closed`.
- Critical findings (`BLOCK_HUMAN_REQUIRED`, exit code 2) remain unconditionally blocking under both policies.
- The installer safely resolves Git hooks in Git worktrees and repositories with `core.hooksPath`,
  and refuses to overwrite existing user-managed hooks without `--force`.

### Windows Test Isolation & Fixture Stability
Temporary Git repositories and cache test fixtures are isolated under operating system
temporary directories (`os.tmpdir()`) rather than fixed paths inside `tests/fixtures`.
This eliminates Windows `EBUSY` file-locking contention with workspace file indexers.
Broad catch blocks in gitignore tests were corrected so assertions are never swallowed.

## CLI and Git revision maintenance (0.2.14)

JSON output now preserves the existing text-mode failure criteria: patch review returns
2 only for BLOCK_HUMAN_REQUIRED; guard returns 1 when denied and confirmation is required;
semantic lint returns 1 for failed checks unless advisory mode is requested. Escalated
patch review and advisory lint retain exit 0. Execution/argument errors remain exit 1.
JSON bodies remain unchanged on stdout; diagnostics remain on stderr. Automation that
previously assumed JSON always exits successfully must handle the corrected statuses.

Shared diff extraction invokes Git directly without a shell. commitRange remains an
optional string containing one opaque revision expression, including standard two-dot,
three-dot and reflog forms. Empty/control-character/option-shaped values are rejected.
Previously undocumented multiple-token values such as two revisions separated by a space
are no longer treated as shell arguments; use a standard range expression. A trailing
revision/path separator prevents a missing revision from becoming a path filter.
Direct diff, diff-file and staged precedence is preserved. Existing trusted Git config,
including configured diff drivers, remains outside this parameter-injection boundary.
No new API signatures, configuration keys, dependencies, SDK/model upgrades or agent rule
regeneration are required. The separately pinned premium project is not updated by this release.

## Update notice contract migration (0.2.13)

`checkForUpdates`, `/api/update-status` and the `update` object in
`jev-dev version --json` share `UpdateInfo`. Consumers must check `status`:
`update_available`, `up_to_date` (installed version equals or exceeds npm latest),
or `unavailable`. `latestVersion`, `checkedAt` and `releaseUrl` are null when the
check fails; `isLatest` in version JSON is also null. A false `updateAvailable`
alone does not prove freshness. `source` distinguishes registry/cache/unavailable.
The existing version/updateAvailable fields are retained with the nullable migration.

The shared `notice` includes reasons, declared requirements and restart guidance.
There is no automatic installation. CLI automatic notices use stderr and are skipped
for `--json`. A receipt under `~/.jev-dev/update-notice-cli.json` suppresses the same
installed/latest pair across invocations. `jev-dev version` explicitly checks again
and always displays the current status. Cache storage can be overridden with
`JEV_UPDATE_CACHE_DIR`; old version-only caches remain readable.

MCP appends a separate text content block containing `updateNotice` and a locally
authored display instruction, preserving the tool's first content block. Clients
must tolerate additional content blocks. Notices are emitted once per status/latest
version per running MCP server; checks, including failures, are limited to hourly.
Reconnecting/restarting creates a new notification session. Each harness controls
whether the agent/tool output is visible; this does not create a native IDE popup.

The dashboard displays the same notice and persists dismissals by running/latest
version in browser local storage, with hourly checks. Unavailable checks display an
unknown status, not an all-clear. No synthetic urgency or missing requirements are
inferred. Release metadata is untrusted display text, bounded and rendered as text.

Users on older MCP versions must install this release once before they can receive
these notices for future releases. A GitHub release alone does not update npm metadata.
After npm publication, confirm `npm view jev-dev-harness@latest jevUpdate engines --json`
and restart every MCP instance/dashboard. No agent rule regeneration is required for
the new MCP notice contract; preserve any project-specific rules when updating manually.

## Efficiency contract migration (0.2.9)

The context MCP `efficiencyReport` uses `schemaVersion: 2`. Removed fields:
`initialFilesScanned`, `selectedSurgicalFiles`, `fileReductionPct`,
`estimatedTokensSaved`. Use `entriesFound`, `candidatesAfterFilters`,
`candidatesEvaluated`, `selectedFiles`, `cachedDecisions`, `newModelCalls`,
`newTokens`, `reportedCostUsd`, `costCoverage`, `latencyMs`, `fallbackUsed`.
Entry counts describe discovery/selection, not tokenized context avoided.

`newModelCalls` counts logical Stage C `systemOne` invocations, including failures,
not individual HTTP retry attempts. `validatedResponses` counts validated response
usage; tokens/cost cover those responses only. Usage from failed, timed-out,
invalid responses and unreported retries is unavailable. `costedRequests` gives
the coverage of the reported sum; partial cost is not a complete bill. Absent
cost is null in the efficiency report ("não informado"), including full cache.
An explicit provider cost of zero remains zero. `evaluatedByJev` and
`evaluatedByLlm` retain their decision counts, including cache; they are not new
API calls. `evaluatedCandidates` counts Stage C candidates (including heuristic
fallback); heuristic candidates do not imply model inference.

`tokenSavings` and `moneySavings` are null, `savingsStatus` is `not_measured`.
Tool-rank `metrics.tokensSaved` is now null. Telemetry event `tokensSaved` is
optional and deprecated; new emitters omit it. Historical JSONL records are
retained/read unchanged but their estimates are ignored by aggregation/UI.
Summary `totalTokensSaved` and `estimatedDollarsSaved` remain as deprecated null
fields. Consumers must stop numeric arithmetic on them. Summary `usage` covers
only context-rank events with the new call counters, within the most recent
1,000 events; `eventsWithUsage`/`eventsWithoutUsage` expose historical coverage.
The dashboard simulation is explicitly hypothetical, separate from telemetry.

Updating the package does not update rule files already copied into projects.
Review and replace only the Jev efficiency section in CODEX.md, CLAUDE.md,
GEMINI.md, .cursorrules, .clinerules, .windsurfrules and
.github/copilot-instructions.md (plus custom AGENTS.md/Codex instructions).
The new template is returned by `getAgentRuleContent()`. `jev-dev doctor
--init-rules` overwrites the standard rule files: use it only when they contain
no project-specific instructions or after backing up and merging those rules.

In Codex, confirm the MCP command points to the updated installation/build.
For a pinned npx command, update its package version to 0.2.9 after publication.
Fully quit and reopen Codex to start a new MCP process; verify its version and
`jev_rank_context` output has `schemaVersion: 2`. Avoid reusing an old report as
evidence. These instructions do not change any other project automatically.

## Measured usage (0.2.12)

The new `efficiency` CLI and `jev_compare_usage` MCP tool require the build
containing 0.2.12. See [the workflow](jev/MEASURED-USAGE.md) for paired runs,
scoped ledgers, declared coverage and validation/billing receipts. Do not claim
measured savings from ranking alone or republish 0.2.9 with the new source.
