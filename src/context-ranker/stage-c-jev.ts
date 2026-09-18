import {
  choice,
  noul,
  score,
  type SafeJevClient,
} from "../shared/typesafe-client.js";
import { JevCache } from "../shared/cache.js";
import type { TelemetryCollector } from "../shared/telemetry.js";
import type {
  CandidateRole,
  HeuristicCandidate,
  JevJudgments,
  RankContextOptions,
} from "./types.js";

const RELEVANCE_RUBRIC = [
  "Irrelevant: No relation to the task",
  "Marginally Relevant: Minor background reference or utility",
  "Moderately Relevant: Related module or auxiliary component",
  "Highly Relevant: Key dependency, direct caller, or core interface",
  "Crucial: Primary implementation or target file for the task",
] as const;

const ROLE_OPTIONS = {
  implementation: "Core implementation code, business logic, or services",
  test: "Unit, integration, or end-to-end test, mock, or fixture",
  configuration: "Build settings, package dependencies, or environment config",
  database: "Database schema, migrations, queries, or data models",
  documentation: "README, architecture guides, specifications, or docs",
  generated: "Automatically generated, compiled, or bundled artifacts",
  unrelated: "Completely unrelated or irrelevant to this task",
  other: "Other supporting context or utility code",
} as const;

export interface StageCEvaluation {
  candidate: HeuristicCandidate;
  jevJudgments?: JevJudgments;
  fromCache: boolean;
}

/**
 * Stage C: Batched semantic evaluation with Jev using Noul, Score, and Choice primitives.
 */
export async function executeStageC(
  task: string,
  candidates: HeuristicCandidate[],
  client: SafeJevClient,
  cache: JevCache,
  telemetry: TelemetryCollector,
  options: RankContextOptions
): Promise<StageCEvaluation[]> {
  const evaluations: StageCEvaluation[] = [];

  // If Jev is explicitly disabled or unconfigured, bypass immediately to fallback
  if (options.useJev === false || !client.isConfigured) {
    telemetry.recordFallback(client.getReason());
    return candidates.map((c) => ({
      candidate: c,
      fromCache: false,
    }));
  }

  const questions = {
    relevant_to_task: noul(
      "Is this file directly relevant to implementing, testing, configuring, or understanding the task?"
    ),
    relevance: score(
      "How relevant is this file to the described task?",
      RELEVANCE_RUBRIC
    ),
    role: choice(
      "What is the primary architectural role of this file in relation to the task?",
      ROLE_OPTIONS
    ),
  };

  // Evaluate candidates concurrently to reduce latency from 40s+ to <3s
  const evaluateCandidate = async (candidate: HeuristicCandidate): Promise<StageCEvaluation> => {
    const cacheKey = JevCache.createKey(
      task,
      candidate.relativePath,
      candidate.snippet || ""
    );

    // 1. Check cache first
    const cached = cache.get<JevJudgments>(cacheKey);
    if (cached) {
      telemetry.cacheHits++;
      telemetry.evaluatedByJev++;
      telemetry.addConfidence(cached.confidence);
      return {
        candidate,
        jevJudgments: cached,
        fromCache: true,
      };
    }

    telemetry.cacheMisses++;

    // 2. Prepare state
    const state = {
      task,
      file: {
        path: candidate.relativePath,
        extension: candidate.extension,
        size_bytes: candidate.size,
        matched_symbols: candidate.matchedSymbols,
        snippet: candidate.snippet ? candidate.snippet.slice(0, 1200) : null,
      },
    };

    // 3. Send batched questions to Jev
    const response = await client.systemOne(state, questions);

    if (response.ok) {
      telemetry.evaluatedByJev++;
      telemetry.addTokens(response.inputTokens, response.outputTokens);

      const answers = response.result.answers;
      const relevantNoul = answers.relevant_to_task?.noul ?? 0.5;
      const relevanceScore = answers.relevance?.score ?? 0;
      const roleChoice = (answers.role?.choice as CandidateRole) || "other";

      // Confidence from choice and score
      const roleConf = answers.role?.confidence ?? 0.8;
      const scoreConf = answers.relevance?.confidence ?? 0.8;
      const avgConf = Number(((roleConf + scoreConf) / 2).toFixed(4));

      telemetry.addConfidence(avgConf);

      const rubricIdx = Math.min(
        RELEVANCE_RUBRIC.length - 1,
        Math.max(0, Math.round(relevanceScore))
      );
      const relevanceLabel = RELEVANCE_RUBRIC[rubricIdx]!.split(":")[0]!;

      const judgments: JevJudgments = {
        relevantToTask: Number(relevantNoul.toFixed(4)),
        relevanceScore: Number(relevanceScore.toFixed(2)),
        relevanceLabel,
        role: roleChoice,
        confidence: avgConf,
      };

      // Cache judgment
      cache.set(cacheKey, judgments);

      return {
        candidate,
        jevJudgments: judgments,
        fromCache: false,
      };
    } else {
      // Fallback on failure
      telemetry.recordFallback(response.reason);
      telemetry.errors++;
      return {
        candidate,
        fromCache: false,
      };
    }
  };

  const results = await Promise.all(candidates.map(evaluateCandidate));
  evaluations.push(...results);

  cache.save();
  return evaluations;
}
