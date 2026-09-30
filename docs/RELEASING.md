# Publishing a stable release

## Current release: 0.2.11

The multi-harness bridge is prepared as 0.2.11. Run `npm run release:dry-run`
on its clean commit before publication. Merge/tag/GitHub release are prepared release
actions; npm publication remains manual. Use `v0.2.11` and npm version 0.2.11
in the procedure below; do not move/reuse existing release tags.
General usage comparisons use schemaVersion 2 with nullable counters/deltas;
Codex-only comparisons retain schemaVersion 1. See
`docs/jev/MULTI-HARNESS-USAGE.md` for migration and coverage limits.

## Version and publication

The harness version is independent of the Jev model version. This release is
`jev-dev-harness@0.2.11`, with Git tag `v0.2.11` and npm dist-tag `latest`.
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

## Publish 0.2.11

Use your npm maintainer account; complete login/2FA locally. Do not commit tokens.
Check that 0.2.11 has not already been published before uploading:

```sh
npm whoami
npm view jev-dev-harness versions --json
git checkout main
git pull --ff-only origin main
git describe --exact-match --tags HEAD
npm run release:publish
npm view jev-dev-harness@0.2.11 version
npm dist-tag ls jev-dev-harness
```

Run these commands separately and stop on any error. Publish only the clean,
validated commit tagged above. `release:publish` runs `npm publish --tag latest`;
`publishConfig` also pins the public npm registry and `latest` for plain
`npm publish`. A successful publication should show `latest: 0.2.11`.
Before publishing, confirm that HEAD is the clean validated `v0.2.11` commit.
If publication fails, resolve the authentication or registry error and retry
the same artifact. Do not move an existing tag or reuse a published version.

For this release, the merge, `v0.2.11` tag and GitHub Latest release are prepared
before the manual npm publication. Do not recreate the tag or release.
There is no automatic npm publication workflow; merging code or pushing a tag
alone does not publish the package.

## Next release

Before committing the next stable release:

```sh
npm version patch --no-git-tag-version
```

Update the fallback in `src/shared/version.ts` and add matching release notes.
Run the checks, commit and merge, then repeat the publication steps with the new
version/tag. Prereleases should use a separate process and npm tag such as `next`.

## Update local installations

The 0.2.11 GitHub release is prepared for manual npm publication. Until that
publication succeeds, npm `latest` still points to the previously published
version. 0.2.9 is already published and must not be overwritten.

```sh
npm install -g jev-dev-harness@latest
jev-dev --version
```

For an installation linked to a Git checkout, pull the release commit and run
`npm ci` and `npm run build` instead. Restart the Codex MCP session so the process
loads the updated build. An already-running server keeps its old code in memory.

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

## Measured usage (0.2.11)

The new `efficiency` CLI and `jev_compare_usage` MCP tool require the build
containing 0.2.11. See [the workflow](jev/MEASURED-USAGE.md) for paired runs,
scoped ledgers, declared coverage and validation/billing receipts. Do not claim
measured savings from ranking alone or republish 0.2.9 with the new source.
