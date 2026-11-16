# Harness 0.2.16 model defaults

## Selection and compatibility

Unpinned client defaults are TypeSafe `jev-1.14.0`, OpenRouter `typesafe/jev-1.14`,
and Vercel `typesafe-ai/jev-1.14.0`. Selection preserves explicit options first,
then provider model environment variables, the legacy shared
`TYPESAFE_DEFAULT_MODEL` environment fallback, and a saved model only when its
saved provider matches the selected provider. An existing explicit 1.13 pin is
not upgraded. Provider selection itself is unchanged.

TypeSafe accepts the known legacy `typesafe/jev-1.13` and `typesafe/jev-1.14`
slugs by converting them to native `jev-1.13.0` and `jev-1.14.0`; optional `.0`
and bare two-component Jev aliases normalize equivalently. This preserves the
pinned version rather than switching it. Explicit Vercel floating alias
`typesafe-ai/jev` and other existing custom model choices remain explicit choices.
The decision cache identity still includes provider, base URL, effective model
and decision mode. Changing any of these cannot reuse another model's cache.

Setup now carries TypeSafe/Vercel model choices through its generated settings,
just as it already did for OpenRouter. Running setup is an explicit action; merely
installing this package does not rewrite existing configuration files. Do not run
setup just to inspect defaults: instantiate the client with `disabled: true` for
an offline inspection, or inspect existing configuration locally without exposing
credentials. A model default change alone does not prove remote availability.

## Deliberate upgrade or rollback

For a separately authorized provider configuration, set exactly one appropriate
model variable to select 1.14 explicitly:

- TypeSafe: `TYPESAFE_DEFAULT_MODEL=jev-1.14.0`.
- OpenRouter: `OPENROUTER_MODEL=typesafe/jev-1.14`.
- Vercel: `VERCEL_MODEL=typesafe-ai/jev-1.14.0`.

To retain or roll back a model pin, use the corresponding explicitly supported
1.13 model identifier in that same configuration. A process inherits environment
at launch; a newly changed setting may require restarting that process. Do not
remove unrelated credentials, settings or existing user changes. A package rollback
is separate from a model pin rollback; retain the previous trusted package version.

Safety Pro Engine RC3 has an exact harness allowlist of 0.2.14 and 0.2.15. Harness
0.2.16 is intentionally rejected by that unchanged gate. Keep Engine RC3 pointing
at a separately preserved trusted 0.2.15 package until a dedicated compatibility
update is reviewed. Agensi Native is a separate product and is not changed here.

## Evidence and limits

This default was selected by the owner despite the limited prior benchmark; no
claim is made that 1.14 is more accurate, universally faster or less expensive.
Historical evaluation scripts, JSON receipts and `JEV-1.14-EVALUATION.md` retain
their original 1.13 production-default decision. They describe that earlier
checkpoint, not this later owner-directed default. Offline mocked tests verify
selection, payloads, pins and cache separation, not live provider quality/cost.
Setup regression tests use an in-memory filesystem and a mocked healthcheck; no real setup configuration or provider healthcheck is executed by those tests. No automatic hook, interception or global MCP/skill registration is implied.

Official model identifier references:
- https://docs.typesafe.ai/models
- https://openrouter.ai/typesafe/jev-1.14
- https://vercel.com/ai-gateway/models/jev-1.14.0
