# SDK 0.7 migration and Jev 1.14 evaluation

## Release policy

Harness 0.2.12 requires Node.js 22+ and pins `@typesafe-ai/sdk` to 0.7.0.
The native TypeSafe default is `jev-1.13.0`, not `jev-latest`. Explicit constructor
or `TYPESAFE_DEFAULT_MODEL` overrides still work for controlled experiments.
Existing deployments must restart their MCP process to load new configuration.

OpenRouter retains `typesafe/jev-1.13`. Vercel retains its supported
`typesafe-ai/jev` ID; that is a floating gateway identifier, not a verified version
pin. Do not assume a native versioned ID is supported by a gateway. The experiment
below uses only the native TypeSafe endpoint and does not certify either gateway.
Use native TypeSafe with an exact versioned ID when a strict pin is required.

Images, Box and long-context modes remain disabled by default. The wrapper
supports only Noul/Choice/Score and rejects unsupported question types before
transport. SDK compression is explicitly disabled for both SDK-backed transports
to preserve existing wire behavior; OpenRouter's custom transport is unchanged.
SDK 0.7's new experimental capabilities are not enabled by updating the package.

## Nullable usage contract

A valid decision may have `usage.input_tokens` or `output_tokens` set to null.
The wrapper preserves it as a successful decision, keeps null on the corresponding
`inputTokens`/`outputTokens`, and continues to validate actual decision fields.
Malformed, missing, negative, fractional and string counters remain invalid.
Missing/null cost is unknown; an explicit numeric zero remains a reported cost.

`TelemetryMetrics.tokensSent` / `tokensReceived` and dashboard summary totals are
now nullable. A null in any validated response keeps that direction's aggregate
unknown. `inputTokenRequests` / `outputTokenRequests` count validated responses
with each counter present. MCP efficiency schemaVersion 2 keeps the same fields
and adds `tokenCoverage`; `newTokens.input` / `output` may be null. CLI and
dashboard render those as not informed. Consumers must not use `?? 0` to report a
complete total. Old numeric telemetry remains readable; old records do not gain
invented coverage counts.

Jev measurement ledgers preserve partial token counts and independently reported
cost. A request with either unknown token count increments `missingUsage` when
imported. Known subtotals remain reported subtotals; net pipeline token differences
stay null. Cached decisions still create no new calls or duplicated usage/cost.

## Live evidence: 2026-10-15

The [machine-readable evidence](evaluation-jev-1.14-2026-10-15.json) records actual
requests using the upgraded SDK/wrapper. Inputs were synthetic fixtures only;
no project source, private prompts or credentials are included in the artifact.

- 14 labeled fixtures: 7 English and 7 Portuguese, covering relevant/unrelated
  context, file roles, read-only/destructive commands and safe/unsafe auth diffs.
- Each fixture repeated 3 times per model: 42 calls per version, 84 total.
- Identical state/question construction for both versions, expected labels omitted
  from requests, alternating pair order, no cache, no retries, 5-second deadline.
- Exact requested and returned models recorded; no model mismatch or fallback.

| Observed result | Jev 1.13.0 | Jev 1.14.0 |
| --- | --- | --- |
| Fixture checks passed | 42/42 | 42/42 |
| Portuguese checks | 21/21 | 21/21 |
| English checks | 21/21 | 21/21 |
| Fallbacks | 0 | 0 |
| Mean response latency | 252.2 ms | 238.6 ms |
| p95 response latency | 315 ms | 257 ms |
| Reported input tokens | 18,546 | 18,546 |
| Reported output tokens | 2,826 | 2,826 |
| Reported cost | Not informed (0/42 calls) | Not informed (0/42 calls) |

These are 14 distinct simple cases, not 42 independent scenarios. This is a small
compatibility smoke evaluation, not a production acceptance test or statistically
established improvement. It does not cover the complete ranking pipeline, large
repositories, provider outages, all guard/lint rules or ambiguous real-world tasks.
Language results do not establish a general multilingual gain. Latency is specific
to this run's network/server conditions. Equal token counts are not token savings;
no monetary comparison is possible without reported costs/billing evidence.

**Decision: keep Jev 1.13.0 as the native production default.** Jev 1.14 completed
the smoke comparison successfully but was not promoted. Before promotion, evaluate
representative task fixtures, full ranking Precision/Recall@K, confidence thresholds,
security false negatives, deadline failures and repeated latency/cost observations.

## Reproduce (explicit paid API calls)

From the repository with native TypeSafe credentials configured:

```sh
npm ci
npm run eval:jev -- --live --repetitions 3 --output new-evaluation.json
```

The command refuses to overwrite evidence and does not change default model or
global configuration. It uses the exact 1.13/1.14 model IDs and TypeSafe endpoint.
Output contains fixture IDs, observed judgments, model IDs, counters and timings.
Missing credentials or transport failures must not be reported as successful tests.
Synthetic scoring tests run offline in the normal test suite; live calls require
`--live` and are never made by `npm test` or release checks.

Sources: [SDK migration changelog](https://docs.typesafe.ai/sdk/javascript/changelog),
[models and aliases](https://docs.typesafe.ai/models).
