import path from "node:path";
import { JevCache } from "../shared/cache.js";
import { TelemetryCollector } from "../shared/telemetry.js";
import { SafeJevClient } from "../shared/typesafe-client.js";
import { executeStageA } from "./stage-a-filter.js";
import { executeStageB } from "./stage-b-candidates.js";
import { executeStageC } from "./stage-c-jev.js";
import { executeStageD } from "./stage-d-ranker.js";
import type { RankContextOptions, RankContextResult } from "./types.js";

export * from "./types.js";
export { executeStageA } from "./stage-a-filter.js";
export { executeStageB, extractTaskTokens } from "./stage-b-candidates.js";
export { executeStageC } from "./stage-c-jev.js";
export { executeStageD, inferRoleFallback } from "./stage-d-ranker.js";

/**
 * Main entry point for the Jev Context Ranker pipeline.
 *
 * Pipeline:
 *  1. Stage A: Deterministic filter (.gitignore, .jevignore, binary, oversized)
 *  2. Stage B: Fast heuristic search (path, extension, symbols, keywords)
 *  3. Stage C: Jev System One evaluation (batched Noul, Score, Choice) with cache
 *  4. Stage D: Harness ranking algorithm & calibrated sorting
 */
export async function rankContext(
  options: RankContextOptions
): Promise<RankContextResult> {
  const telemetry = new TelemetryCollector();
  telemetry.start();

  const repoPath = path.resolve(options.repoPath || ".");

  // Initialize Cache
  const cacheFilePath =
    options.cacheFilePath || path.join(repoPath, ".jev-cache.json");
  const cache = new JevCache({
    enabled: options.useCache !== false,
    cacheFilePath,
  });

  // Initialize Safe Jev Client
  const client = new SafeJevClient({
    apiKey: options.apiKey,
    disabled: options.useJev === false,
  });

  // Stage A: Deterministic Filter
  const candidateFiles = executeStageA(
    { ...options, repoPath },
    telemetry
  );

  // Stage B: Heuristic Fast-Search
  const stageBLimit = options.stageBCandidateLimit ?? 15;
  const heuristicCandidates = executeStageB(
    options.task,
    candidateFiles,
    stageBLimit
  );

  // Stage C: Jev Evaluation (or fallback)
  const evaluations = await executeStageC(
    options.task,
    heuristicCandidates,
    client,
    cache,
    telemetry,
    options
  );

  // Stage D: Harness Ranking Algorithm
  const selected = executeStageD(evaluations, telemetry, options);

  telemetry.stop();

  const metrics = telemetry.toMetrics();

  return {
    task: options.task,
    repoPath,
    selected,
    metrics,
    fallbackUsed: metrics.fallbackUsed,
    timestamp: new Date().toISOString(),
  };
}
