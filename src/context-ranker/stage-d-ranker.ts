import type { TelemetryCollector } from "../shared/telemetry.js";
import type { StageCEvaluation } from "./stage-c-jev.js";
import type {
  CandidateRole,
  RankContextOptions,
  RankedCandidate,
} from "./types.js";

const ROLE_WEIGHTS: Record<CandidateRole, number> = {
  implementation: 1.0,
  database: 0.95,
  test: 0.85,
  configuration: 0.75,
  documentation: 0.6,
  other: 0.5,
  generated: 0.15,
  unrelated: 0.0,
};

/**
 * Fallback role heuristic based on path patterns and file extensions.
 */
export function inferRoleFallback(filePath: string): CandidateRole {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();

  if (
    norm.includes("test") ||
    norm.includes("spec") ||
    norm.includes("__tests__")
  ) {
    return "test";
  }

  if (
    norm.includes("migration") ||
    norm.includes("schema") ||
    norm.includes("database") ||
    norm.endsWith(".sql")
  ) {
    return "database";
  }

  if (
    norm.endsWith(".json") ||
    norm.endsWith(".yaml") ||
    norm.endsWith(".yml") ||
    norm.endsWith(".toml") ||
    norm.includes("config")
  ) {
    return "configuration";
  }

  if (norm.endsWith(".md") || norm.includes("docs/") || norm.includes("doc/")) {
    return "documentation";
  }

  if (
    norm.includes("generated") ||
    norm.includes("dist/") ||
    norm.includes("build/")
  ) {
    return "generated";
  }

  if (
    norm.endsWith(".ts") ||
    norm.endsWith(".tsx") ||
    norm.endsWith(".js") ||
    norm.endsWith(".jsx") ||
    norm.endsWith(".py") ||
    norm.endsWith(".rs") ||
    norm.endsWith(".go") ||
    norm.endsWith(".java")
  ) {
    return "implementation";
  }

  return "other";
}

/**
 * Stage D: Final ranking algorithm belonging to the harness code.
 * Combines Jev signals with deterministic heuristics and applies thresholding.
 */
export function executeStageD(
  evaluations: StageCEvaluation[],
  telemetry: TelemetryCollector,
  options: RankContextOptions
): RankedCandidate[] {
  const topLimit = options.top ?? 10;
  const threshold = options.threshold ?? 0.15;
  const ranked: RankedCandidate[] = [];

  for (const item of evaluations) {
    const { candidate, jevJudgments } = item;

    if (jevJudgments) {
      // Jev signals available
      const roleWeight = ROLE_WEIGHTS[jevJudgments.role] ?? 0.5;
      const normalizedScore = Math.min(1.0, jevJudgments.relevanceScore / 4.0);
      const noulProb = jevJudgments.relevantToTask;

      // Jev composite signal
      const jevComposite =
        (noulProb * 0.45 + normalizedScore * 0.4 + roleWeight * 0.15) *
        Math.max(0.4, jevJudgments.confidence);

      // Final harness formula: 30% heuristic + 70% Jev composite
      const finalScore = Number(
        (0.3 * candidate.heuristicScore + 0.7 * jevComposite).toFixed(4)
      );

      if (finalScore >= threshold) {
        ranked.push({
          path: candidate.relativePath,
          score: finalScore,
          confidence: jevJudgments.confidence,
          role: jevJudgments.role,
          relevance: jevJudgments.relevanceLabel,
          reason: `Jev: ${jevJudgments.relevanceLabel} (${(noulProb * 100).toFixed(0)}% match, role: ${jevJudgments.role}) + heuristic: ${(candidate.heuristicScore * 100).toFixed(0)}%`,
          source: "jev",
        });
      }
    } else {
      // Deterministic fallback
      const finalScore = candidate.heuristicScore;
      const role = inferRoleFallback(candidate.relativePath);

      if (finalScore >= threshold) {
        ranked.push({
          path: candidate.relativePath,
          score: finalScore,
          confidence: finalScore > 0.4 ? 0.75 : 0.5,
          role,
          relevance: finalScore > 0.6 ? "High (Heuristic)" : "Medium (Heuristic)",
          reason: `Deterministic fallback: path/symbol match score ${(finalScore * 100).toFixed(0)}%`,
          source: "deterministic_fallback",
        });
      }
    }
  }

  // Sort descending by final score
  ranked.sort((a, b) => b.score - a.score);

  const selected = ranked.slice(0, topLimit);
  telemetry.selectedCount = selected.length;

  return selected;
}
