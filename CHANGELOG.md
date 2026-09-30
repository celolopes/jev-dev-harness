# Changelog

## 0.2.8 — 2026-09-30

- Default new OpenRouter configurations to native `typesafe/jev-1.13` decisions.
- Validate Noul, Choice and Score responses before use or caching; reject missing confidence.
- Bound request and context-ranking deadlines, concurrency and retry behavior; use deterministic fallback on failures.
- Isolate decision caches by provider, model, question contract and candidate metadata.
- Report actual models, native/emulation modes and provider-reported cost coverage.
- Synchronize package and lockfile versions; advertise the package version in MCP.
- Add release checks, rebuild before packing, and document Git tags and npm `latest` publication.

Live cost/latency benchmarks and the Finainteli integration are separate work.
