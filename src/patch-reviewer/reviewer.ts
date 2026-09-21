import {
  SafeJevClient,
  noul,
  score,
} from "../shared/typesafe-client.js";
import type { DiffData } from "./diff-extractor.js";
import type { PatchReviewJudgments, PatchReviewOptions } from "./types.js";

export interface ReviewOutcome {
  judgments: PatchReviewJudgments;
  fallbackUsed: boolean;
  fallbackReason?: string;
  latencyMs: number;
  provider?: string;
}

/**
 * Executes Jev System One questions against a git diff state,
 * or applies deterministic heuristics if offline/fallback is triggered.
 */
export async function reviewPatch(
  task: string,
  diffData: DiffData,
  client: SafeJevClient,
  options?: PatchReviewOptions
): Promise<ReviewOutcome> {
  const start = Date.now();

  const questions = {
    is_out_of_scope: noul(
      "Does this git diff include modifications that appear out of scope for the stated task?"
    ),
    regression_risk: score(
      "What is the estimated risk of regression introduced by these changes?",
      [
        "Negligible: Purely formatting, documentation, or trivial additions",
        "Low: Isolated changes with clear tests",
        "Moderate: Modifications to shared utilities or non-critical state",
        "High: Core business logic or broad refactoring without full test coverage",
        "Critical: Breaking interface, data loss, or high security risk",
      ]
    ),
    modifies_auth: noul(
      "Does this diff modify authentication, authorization, session, or token logic?"
    ),
    modifies_database: noul(
      "Does this diff modify database schemas, migrations, or persistent models?"
    ),
    missing_tests: noul(
      "Does this diff introduce new feature logic without corresponding test modifications?"
    ),
    exposes_secrets: noul(
      "Does this diff appear to introduce or expose credentials, secrets, or hardcoded sensitive keys?"
    ),
  };

  const state = {
    task,
    diff_summary: {
      files_changed: diffData.filesChanged,
      total_files: diffData.filesChanged.length,
      additions: diffData.additions,
      deletions: diffData.deletions,
    },
    diff_content: diffData.sanitizedDiff,
  };

  const response = await client.systemOne(state, questions, {
    timeout: options?.timeoutMs,
  });

  if (response.ok) {
    const answers = response.result.answers as any;

    const isOutOfScope = typeof answers?.is_out_of_scope?.noul === "number"
      ? answers.is_out_of_scope.noul
      : 0;

    const regressionRisk = typeof answers?.regression_risk?.score === "number"
      ? answers.regression_risk.score
      : 1.0;

    const modifiesAuth = typeof answers?.modifies_auth?.noul === "number"
      ? answers.modifies_auth.noul
      : 0;

    const modifiesDatabase = typeof answers?.modifies_database?.noul === "number"
      ? answers.modifies_database.noul
      : 0;

    const missingTests = typeof answers?.missing_tests?.noul === "number"
      ? answers.missing_tests.noul
      : 0;

    const exposesSecrets = typeof answers?.exposes_secrets?.noul === "number"
      ? answers.exposes_secrets.noul
      : 0;

    // Calculate average confidence from available answers
    const confidences: number[] = [];
    for (const key of Object.keys(answers || {})) {
      if (typeof answers[key]?.confidence === "number") {
        confidences.push(answers[key].confidence);
      }
    }
    const confidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0.9;

    return {
      judgments: {
        isOutOfScope,
        regressionRisk,
        modifiesAuth,
        modifiesDatabase,
        missingTests,
        exposesSecrets,
        confidence,
      },
      fallbackUsed: false,
      latencyMs: response.latencyMs,
      provider: response.provider,
    };
  }

  // Deterministic fallback heuristics
  const fallbackJudgments = computeFallbackJudgments(task, diffData);

  return {
    judgments: fallbackJudgments,
    fallbackUsed: true,
    fallbackReason: response.reason,
    latencyMs: Date.now() - start,
    provider: response.provider,
  };
}

/**
 * Deterministic heuristic evaluation for offline operation.
 */
export function computeFallbackJudgments(
  task: string,
  diffData: DiffData
): PatchReviewJudgments {
  const diffLower = diffData.sanitizedDiff.toLowerCase();
  const taskLower = task.toLowerCase();

  // 1. Modifies Auth heuristic
  const authKeywords = ["auth", "jwt", "token", "session", "password", "oauth", "bearer", "login"];
  const modifiesAuthMatches = authKeywords.some(
    (kw) =>
      diffData.filesChanged.some((f) => f.toLowerCase().includes(kw)) ||
      diffLower.includes(kw)
  );
  const modifiesAuth = modifiesAuthMatches ? 0.75 : 0.05;

  // 2. Modifies Database heuristic
  const dbKeywords = ["migration", "schema", "create table", "drop table", "alter table", "database", "repository"];
  const modifiesDbMatches = dbKeywords.some(
    (kw) =>
      diffData.filesChanged.some((f) => f.toLowerCase().includes(kw) || f.endsWith(".sql")) ||
      diffLower.includes(kw)
  );
  const modifiesDatabase = modifiesDbMatches ? 0.70 : 0.05;

  // 3. Missing tests heuristic
  const hasTests = diffData.filesChanged.some((f) =>
    /test|spec|__tests__/i.test(f)
  );
  const hasSourceChanges = diffData.filesChanged.some((f) =>
    /\.(ts|js|py|go|rs|java|cpp|c|cs)$/i.test(f) && !/test|spec/i.test(f)
  );
  const missingTests = hasSourceChanges && !hasTests ? 0.80 : 0.10;

  // 4. Exposes secrets heuristic (check for redaction markers or raw secret assignments)
  const hasRedactionMarker = diffData.sanitizedDiff.includes("[REDACTED_");
  const exposesSecrets = hasRedactionMarker ? 0.85 : 0.05;

  // 5. Out of scope heuristic
  // Tokenize task words and check overlap with files and additions
  const taskWords = taskLower.split(/\W+/).filter((w) => w.length > 3);
  let matchingWords = 0;
  for (const word of taskWords) {
    if (diffLower.includes(word)) matchingWords++;
  }
  const overlapRatio = taskWords.length > 0 ? matchingWords / taskWords.length : 1;
  const isOutOfScope = overlapRatio < 0.2 ? 0.65 : 0.15;

  // 6. Regression risk heuristic
  let regressionRisk = 1.0;
  const totalLines = diffData.additions + diffData.deletions;
  if (totalLines > 200 || diffData.filesChanged.length > 8) {
    regressionRisk = 3.2;
  } else if (totalLines > 50 || diffData.filesChanged.length > 3) {
    regressionRisk = 2.2;
  } else if (modifiesAuthMatches || modifiesDbMatches) {
    regressionRisk = 2.5;
  }

  return {
    isOutOfScope,
    regressionRisk,
    modifiesAuth,
    modifiesDatabase,
    missingTests,
    exposesSecrets,
    confidence: 0.65,
  };
}
