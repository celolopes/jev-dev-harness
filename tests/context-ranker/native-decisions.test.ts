import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeJevClient } from "../../src/shared/typesafe-client.js";
import { JevCache } from "../../src/shared/cache.js";
import { TelemetryCollector } from "../../src/shared/telemetry.js";
import { executeStageC } from "../../src/context-ranker/stage-c-jev.js";
import { executeStageD } from "../../src/context-ranker/stage-d-ranker.js";
import type { HeuristicCandidate } from "../../src/context-ranker/types.js";

const candidate: HeuristicCandidate = {
  relativePath: "src/auth.ts", absolutePath: "/repo/src/auth.ts", size: 100,
  extension: ".ts", heuristicScore: 0.9, snippet: "export function login() {}",
  matchedSymbols: ["login"], matchedTokens: ["auth"],
};
const options = { task: "Fix auth", repoPath: "/repo" };
const makeClient = (model = "typesafe/jev-1.13", provider: "openrouter" | "typesafe" = "openrouter") =>
  new SafeJevClient({ apiKey: "sk-test", provider, defaultModel: model });
const result = (model = "typesafe/jev-1.13", mode: "jev" | "llm_emulation" = "jev") => ({
  ok: true as const, provider: "openrouter" as const, decisionMode: mode, costUsd: 0.001,
  latencyMs: 10, inputTokens: 100, outputTokens: 30,
  result: {
    model,
    answers: {
      relevant_to_task: { type: "noul", noul: 0.9 },
      role: { type: "choice", choice: "implementation", confidence: 0.9 },
      relevance: { type: "score", score: 4, confidence: 0.9 },
    },
    usage: { input_tokens: 100, output_tokens: 30 },
  },
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Context decision cache and budget", () => {
  it("reuses only matching model/provider/question contracts and does not double-count cost", async () => {
    const cache = new JevCache();
    const client = makeClient();
    const call = vi.spyOn(client, "systemOne").mockResolvedValue(result() as any);
    const first = new TelemetryCollector();
    await executeStageC(options.task, [candidate], client, cache, first, options);
    const second = new TelemetryCollector();
    const cached = await executeStageC(options.task, [candidate], client, cache, second, options);
    expect(call).toHaveBeenCalledTimes(1);
    expect(cached[0]?.fromCache).toBe(true);
    expect(first.toMetrics().reportedCostUsd).toBe(0.001);
    expect(second.toMetrics().reportedCostUsd).toBeUndefined();
    expect(second.toMetrics().tokensSent).toBe(0);
    expect(second.toMetrics().decisionModels).toEqual(["typesafe/jev-1.13"]);

    for (const other of [makeClient("typesafe/jev-1.14"), makeClient("typesafe/jev-1.13", "typesafe")]) {
      const otherCall = vi.spyOn(other, "systemOne").mockResolvedValue(result(other.modelName) as any);
      const evaluations = await executeStageC(options.task, [candidate], other, cache, new TelemetryCollector(), options);
      expect(evaluations[0]?.fromCache).toBe(false);
      expect(otherCall).toHaveBeenCalledTimes(1);
    }
    // Changes in metadata sent to the model must invalidate the cached judgment too.
    await executeStageC(options.task, [{ ...candidate, matchedSymbols: ["logout"] }], client, cache, new TelemetryCollector(), options);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not consume legacy cache entries or cache floating aliases", async () => {
    const cache = new JevCache();
    cache.set(JevCache.createKey(options.task, candidate.relativePath, candidate.snippet!), { confidence: 1 });
    const client = makeClient("typesafe/jev-latest");
    const call = vi.spyOn(client, "systemOne").mockResolvedValue(result() as any);
    for (let i = 0; i < 2; i++) {
      const evaluations = await executeStageC(options.task, [candidate], client, cache, new TelemetryCollector(), options);
      expect(evaluations[0]?.fromCache).toBe(false);
    }
    expect(call).toHaveBeenCalledTimes(2);
    expect(cache.stats().size).toBe(1);
  });

  it("falls back instead of inventing confidence and never caches the invalid answer", async () => {
    const client = makeClient();
    const bad = result();
    delete (bad.result.answers.role as any).confidence;
    vi.spyOn(client, "systemOne").mockResolvedValue(bad as any);
    const telemetry = new TelemetryCollector();
    const cache = new JevCache();
    const evaluations = await executeStageC(options.task, [candidate], client, cache, telemetry, options);
    expect(cache.stats().size).toBe(0);
    expect(evaluations[0]?.jevJudgments).toBeUndefined();
    expect(telemetry.fallbackReason).toBe("INVALID_RANKING_RESPONSE");
    expect(executeStageD(evaluations, telemetry, options)[0]?.source).toBe("deterministic_fallback");
  });

  it("reports explicit LLM emulation separately from native Jev", async () => {
    const client = makeClient("test/llm");
    vi.spyOn(client, "systemOne").mockResolvedValue(result("test/llm", "llm_emulation") as any);
    const telemetry = new TelemetryCollector();
    const evaluations = await executeStageC(options.task, [candidate], client, new JevCache(), telemetry, options);
    expect(telemetry.evaluatedByJev).toBe(0);
    expect(telemetry.evaluatedByLlm).toBe(1);
    const ranked = executeStageD(evaluations, telemetry, options);
    expect(ranked[0]?.source).toBe("llm_emulation");
    expect(ranked[0]?.model).toBe("test/llm");
  });

  it("bounds concurrent requests and falls back for queued candidates after one total deadline", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const candidates = Array.from({ length: 7 }, (_, i) => ({ ...candidate, relativePath: `src/file${i}.ts` }));
    const telemetry = new TelemetryCollector();
    const pending = executeStageC(options.task, candidates, makeClient(), new JevCache(), telemetry, {
      ...options, decisionBudgetMs: 100, decisionConcurrency: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    const evaluations = await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(evaluations).toHaveLength(7);
    expect(evaluations.every(e => !e.jevJudgments)).toBe(true);
    expect(telemetry.fallbackUsed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back on invalid concurrency instead of silently skipping candidates", async () => {
    const client = makeClient();
    const call = vi.spyOn(client, "systemOne");
    const telemetry = new TelemetryCollector();
    const evaluations = await executeStageC(options.task, [candidate], client, new JevCache(), telemetry, {
      ...options, decisionConcurrency: 0,
    });
    expect(evaluations).toHaveLength(1);
    expect(call).not.toHaveBeenCalled();
    expect(telemetry.fallbackReason).toBe("INVALID_STAGE_C_LIMITS");
  });
});
