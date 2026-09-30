# Native Jev through OpenRouter

The OpenRouter adapter defaults to `typesafe/jev-1.13` and sends typed questions to
`POST https://openrouter.ai/api/v1/systemone`. It no longer automatically turns
a rejected Jev request into a chat completion. Explicitly configured chat models
are still supported and reported as `llm_emulation`.

## Configuration

Configure the key through your existing secret mechanism. Do not commit it.

```dotenv
JEV_PROVIDER=openrouter
OPENROUTER_MODEL=typesafe/jev-1.13
JEV_TIMEOUT_MS=2000
JEV_STAGE_C_TIMEOUT_MS=2000
JEV_CONCURRENCY=4
```

Existing `OPENROUTER_MODEL` settings and saved OpenRouter models are preserved.
If your installation explicitly selected DeepSeek, change that model setting to
`typesafe/jev-1.13` to use native decisions. Provider status prints both the target
and decision mode. A custom `SafeJevClient.baseURL` uses the `/api` base, without
`/v1`; the adapter appends `/v1/systemone` or `/v1/chat/completions`.

Native TypeSafe and Vercel transports remain available. Pin a native TypeSafe
model with `TYPESAFE_DEFAULT_MODEL=jev-1.13.0` for reproducible comparisons.

## Failure and validation contract

- `noul` must be finite and within 0–1. Choice labels must belong to the submitted
  options. Scores must be within the submitted rubric. All requested answers and
  their matching type tags must be present.
- Choice/score confidence must be present and within 0–1. Missing confidence no
  longer becomes `0.8`. Native probability distributions must include all allowed
  labels, contain finite probabilities, and sum to one within rounding tolerance.
- Invalid responses are not cached. The context ranker uses its deterministic
  heuristic for candidates whose request fails. No paid secondary model is
  selected automatically.
- HTTP 400/401/402/403/404/413/422 are not retried. OpenRouter 429 and 5xx responses
  get at most one retry, respecting `Retry-After` and the remaining time budget.
  Network/JSON failures return fallback immediately.
- The client deadline covers retries and body parsing, with caller cancellation
  propagated. Stage C additionally bounds the complete candidate evaluation,
  including queue time. Its default is the client timeout, with at most four
  in-flight calls. Queued work falls back when the deadline expires.
- Both OpenRouter paths disable provider fallback and request
  `data_collection: "deny"`. This is not a claim of ZDR eligibility or a
  replacement for application-specific data minimization. Existing redaction
  covers known secret patterns, not all personal information.

## Cache and observability

Cache keys include provider, base URL, requested model, decision mode, question
contract and all candidate fields used in the request. Legacy cache entries are
not reused. Known floating aliases (`latest`, `preview`, `~` and the Vercel Jev
alias) bypass caching. When changing other aliases or downstream behavior,
disable/clear the cache for the comparison.

Ranked results distinguish `jev`, `llm_emulation`, and `deterministic_fallback`
and expose the returned model. Metrics and context telemetry retain actual model
IDs, LLM/native counts, tokens, fallback reasons, and reported cost. Cache hits do
not add billed tokens or cost again. `reportedCostUsd` sums only responses with
reported prices; `costedRequests` gives its coverage. An absent price is unknown,
not free. These metrics do not replace the provider's billing ledger, which can
include failed attempts, other requests, taxes and credit purchase fees.

LLM confidence is self-reported and must not be treated as calibrated Jev
probability. Native confidence itself also needs task-specific evaluation before
it is used to authorize actions. The ranker's composite is a relevance heuristic,
not a probability of correctness.

## Evaluation before rollout

1. In an isolated checkout, collect 30–50 real tasks and their required files.
2. Run deterministic-only, pinned native TypeSafe and pinned OpenRouter Jev
   against the same snapshot. Disable cache for cold measurements and report
   warm measurements separately. Keep the same candidate shortlist and budget.
3. Compare recall@K, downstream task success, input tokens, p50/p95 latency,
   fallback rate and actual cost. Separate partial fallback and LLM emulation.
4. Inspect missed files before changing thresholds. Synthetic repository tests
   verify mechanics; they do not establish production accuracy or advertised
   latency. Live calls require separately supplied credentials and cost money.

The Finainteli classification experiment remains a separate change: backend-only,
shadow mode, reviewed anonymized transactions and a fixed permitted category set.
No Finainteli deployment, npm release or live paid benchmark is part of this PR.

References checked for the September 29 announcement:
- https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request
- https://openrouter.ai/docs/guides/community/typesafe-sdk
- https://docs.typesafe.ai/confidence
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
