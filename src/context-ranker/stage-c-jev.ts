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
  telemetry.evaluatedCandidates = candidates.length;
  const evaluations: StageCEvaluation[] = new Array(candidates.length);

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

  const budgetMs = options.decisionBudgetMs
    ?? Number(process.env.JEV_STAGE_C_TIMEOUT_MS || client.timeoutMs);
  const concurrency = options.decisionConcurrency
    ?? Number(process.env.JEV_CONCURRENCY || 4);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0
      || !Number.isInteger(concurrency) || concurrency < 1) {
    telemetry.recordFallback("INVALID_STAGE_C_LIMITS");
    return candidates.map(candidate => ({ candidate, fromCache: false }));
  }
  const deadline = Date.now() + budgetMs;
  // Floating aliases can change weights without changing the request's model ID.
  const cacheable = !/latest|preview|^~|^typesafe-ai\/jev$/.test(client.modelName);
  const cacheVersion = JSON.stringify(["context-v2", client.cacheIdentity, questions]);
  const trackJudgment = (judgment: JevJudgments) => {
    if (judgment.decisionMode === "llm_emulation") telemetry.evaluatedByLlm++;
    else telemetry.evaluatedByJev++;
    if (judgment.model) telemetry.decisionModels.add(judgment.model);
    telemetry.addConfidence(judgment.confidence);
  };

  // Bound concurrency and share one budget across all candidates.
  const evaluateCandidate = async (candidate: HeuristicCandidate): Promise<StageCEvaluation> => {
    const cacheKey = JevCache.createKey(
      task,
      candidate.relativePath,
      JSON.stringify([candidate.snippet || "", candidate.extension, candidate.size, candidate.matchedSymbols]),
      cacheVersion,
    );

    // 1. Check cache first
    const cached = cacheable ? cache.get<JevJudgments>(cacheKey) : null;
    if (cached) {
      telemetry.cacheHits++;
      trackJudgment(cached);
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
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      telemetry.recordFallback("STAGE_C_DEADLINE");
      return { candidate, fromCache: false };
    }
    telemetry.newModelCalls++;
    const response = await client.systemOne(state, questions, {
      timeout: Math.min(client.timeoutMs, remainingMs),
    });

    if (response.ok) {
      telemetry.validatedResponses++;
      telemetry.addTokens(response.inputTokens, response.outputTokens);
      if (response.costUsd !== undefined) {
        telemetry.reportedCostUsd += response.costUsd;
        telemetry.costedRequests++;
      }

      const answers = response.result.answers;
      const relevantNoul = answers.relevant_to_task?.noul;
      const relevanceScore = answers.relevance?.score;
      const roleChoice = answers.role?.choice as CandidateRole;
      const roleConf = answers.role?.confidence;
      const scoreConf = answers.relevance?.confidence;
      const validNumber = (n: unknown, max: number): n is number =>
        typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
      if (answers.relevant_to_task?.type !== "noul" || answers.relevance?.type !== "score"
          || answers.role?.type !== "choice" || !validNumber(relevantNoul, 1)
          || !validNumber(relevanceScore, RELEVANCE_RUBRIC.length - 1)
          || !validNumber(roleConf, 1) || !validNumber(scoreConf, 1)
          || !Object.hasOwn(ROLE_OPTIONS, roleChoice)) {
        telemetry.recordFallback("INVALID_RANKING_RESPONSE");
        telemetry.errors++;
        return { candidate, fromCache: false };
      }
      const avgConf = Number(((roleConf + scoreConf) / 2).toFixed(4));

      const rubricIdx = Math.min(
        RELEVANCE_RUBRIC.length - 1,
        Math.max(0, Math.round(relevanceScore))
      );
      const relevanceLabel = RELEVANCE_RUBRIC[rubricIdx]!.split(":")[0]!;

      const judgments: JevJudgments = {
        decisionMode: response.decisionMode ?? client.decisionMode,
        model: response.result.model,
        relevantToTask: Number(relevantNoul.toFixed(4)),
        relevanceScore: Number(relevanceScore.toFixed(2)),
        relevanceLabel,
        role: roleChoice,
        confidence: avgConf,
      };

      // Cache judgment
      if (cacheable) cache.set(cacheKey, judgments);
      trackJudgment(judgments);

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

  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      evaluations[index] = await evaluateCandidate(candidates[index]!);
    }
  }));

  cache.save();
  return evaluations;
}
