import { describe, it, expect, vi } from "vitest";
import { SafeJevClient } from "../../src/shared/typesafe-client.js";
import { executeStageC } from "../../src/context-ranker/stage-c-jev.js";
import { executeStageD } from "../../src/context-ranker/stage-d-ranker.js";
import { JevCache } from "../../src/shared/cache.js";
import { TelemetryCollector } from "../../src/shared/telemetry.js";
import type { HeuristicCandidate } from "../../src/context-ranker/types.js";

describe("Fault Tolerance & Edge Cases (Jev)", () => {
  const dummyCandidate: HeuristicCandidate = {
    relativePath: "src/auth/jwt.ts",
    absolutePath: "/mock/src/auth/jwt.ts",
    size: 200,
    extension: ".ts",
    heuristicScore: 0.8,
    matchedTokens: ["auth", "jwt"],
    matchedSymbols: ["verifyAuthToken"],
  };

  it("handles timeout gracefully and falls back without crashing", async () => {
    const client = new SafeJevClient({ apiKey: "sk-mock-key" });
    const telemetry = new TelemetryCollector();
    const cache = new JevCache({ enabled: false });

    // Mock systemOne to simulate a timeout error
    vi.spyOn(client, "systemOne").mockResolvedValueOnce({
      ok: false,
      fallback: true,
      reason: "APITimeoutError: Request timed out after 3500ms",
      latencyMs: 3501,
    });

    const evaluations = await executeStageC(
      "Fix auth",
      [dummyCandidate],
      client,
      cache,
      telemetry,
      { task: "Fix auth", repoPath: "." }
    );

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.jevJudgments).toBeUndefined();
    expect(telemetry.fallbackUsed).toBe(true);
    expect(telemetry.fallbackReason).toContain("APITimeoutError");

    // Verify Stage D falls back to deterministic score
    const ranked = executeStageD(evaluations, telemetry, {
      task: "Fix auth",
      repoPath: ".",
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.source).toBe("deterministic_fallback");
    expect(ranked[0]?.score).toBe(0.8);
  });

  it("handles API failure / 500 error gracefully", async () => {
    const client = new SafeJevClient({ apiKey: "sk-mock-key" });
    const telemetry = new TelemetryCollector();
    const cache = new JevCache({ enabled: false });

    // Mock systemOne to simulate 500 internal server error
    vi.spyOn(client, "systemOne").mockResolvedValueOnce({
      ok: false,
      fallback: true,
      reason: "InternalServerError: HTTP 500 Service Unavailable",
      latencyMs: 120,
    });

    const evaluations = await executeStageC(
      "Fix auth",
      [dummyCandidate],
      client,
      cache,
      telemetry,
      { task: "Fix auth", repoPath: "." }
    );

    expect(evaluations[0]?.jevJudgments).toBeUndefined();
    expect(telemetry.errors).toBe(1);
  });

  it("handles low confidence without discarding candidates", async () => {
    const client = new SafeJevClient({ apiKey: "sk-mock-key" });
    const telemetry = new TelemetryCollector();
    const cache = new JevCache({ enabled: false });

    // Mock systemOne returning low confidence (0.15)
    vi.spyOn(client, "systemOne").mockResolvedValueOnce({
      ok: true,
      result: {
        model: "jev-latest",
        answers: {
          relevant_to_task: { type: "noul", noul: 0.4 },
          relevance: {
            type: "score",
            score: 1.0,
            confidence: 0.15,
            legend: {} as any,
            probabilities: {} as any,
          },
          role: {
            type: "choice",
            choice: "other",
            confidence: 0.15,
            probabilities: {} as any,
          },
        },
        usage: { input_tokens: 150, output_tokens: 20 },
      },
      inputTokens: 150,
      outputTokens: 20,
      latencyMs: 100,
    });

    const evaluations = await executeStageC(
      "Uncertain task",
      [dummyCandidate],
      client,
      cache,
      telemetry,
      { task: "Uncertain task", repoPath: "." }
    );

    expect(evaluations[0]?.jevJudgments).toBeDefined();
    expect(evaluations[0]?.jevJudgments?.confidence).toBe(0.15);

    const ranked = executeStageD(evaluations, telemetry, {
      task: "Uncertain task",
      repoPath: ".",
      threshold: 0.1,
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.confidence).toBe(0.15);
  });
});
