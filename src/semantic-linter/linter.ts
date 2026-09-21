import { extractDiff } from "../patch-reviewer/diff-extractor.js";
import {
  SafeJevClient,
  noul,
  score,
  type Questions,
} from "../shared/typesafe-client.js";
import { BUILTIN_SEMANTIC_RULES } from "./catalog.js";
import type {
  RuleEvaluationResult,
  SemanticLintOptions,
  SemanticLintResult,
  SemanticRule,
} from "./types.js";

/**
 * Executes semantic linting over a code diff using Jev System One judgments.
 */
export async function lintSemantic(
  options: SemanticLintOptions
): Promise<SemanticLintResult> {
  const start = Date.now();

  const diffData = await extractDiff({
    task: "Semantic linting",
    diff: options.diff,
    diffPath: options.diffPath,
    commitRange: options.commitRange,
    staged: options.staged,
    repoPath: options.repoPath,
  });

  const allRules: SemanticRule[] = options.customRules || BUILTIN_SEMANTIC_RULES;

  // Filter rules whose targetPattern matches at least one changed file
  const activeRules = allRules.filter((rule) => {
    if (!rule.targetPattern) return true;
    return diffData.filesChanged.some((f) => rule.targetPattern!.test(f));
  });

  if (activeRules.length === 0 || diffData.filesChanged.length === 0) {
    return {
      passed: true,
      totalRules: 0,
      passedRules: 0,
      failedRules: 0,
      advisoriesCount: 0,
      evaluations: [],
      markdownReport: "### Jev Semantic Linter\n\nNo matching files or rules to evaluate.",
      filesEvaluated: diffData.filesChanged,
      fallbackUsed: false,
      latencyMs: Date.now() - start,
    };
  }

  // Build dynamic Jev questions
  const questions: Questions = {};
  for (const rule of activeRules) {
    if (rule.type === "noul") {
      questions[rule.id] = noul(rule.question);
    } else if (rule.type === "score" && rule.rubric && rule.rubric.length >= 2) {
      questions[rule.id] = score(rule.question, rule.rubric as [string, string, ...string[]]);
    }
  }

  const client = new SafeJevClient({
    apiKey: options.apiKey,
    disabled: options.useJev === false,
    timeoutMs: options.timeoutMs,
  });

  const state = {
    summary: {
      files_changed: diffData.filesChanged,
      additions: diffData.additions,
      deletions: diffData.deletions,
    },
    diff: diffData.sanitizedDiff,
  };

  const response = await client.systemOne(state, questions);
  const evaluations: RuleEvaluationResult[] = [];

  for (const rule of activeRules) {
    let rawScore = 0;
    let confidence = 0.85;

    if (response.ok) {
      const ans = (response.result.answers as any)?.[rule.id];
      if (rule.type === "noul") {
        rawScore = typeof ans?.noul === "number" ? ans.noul : 0;
      } else if (rule.type === "score") {
        rawScore = typeof ans?.score === "number" ? ans.score : 0;
      }
      if (typeof ans?.confidence === "number") {
        confidence = ans.confidence;
      }
    } else {
      // Heuristic fallback
      rawScore = computeRuleFallback(rule, diffData.sanitizedDiff, diffData.filesChanged);
      confidence = 0.60;
    }

    const passed = rawScore <= rule.threshold;
    const scoreFormatted =
      rule.type === "noul"
        ? `${(rawScore * 100).toFixed(0)}%`
        : `${rawScore.toFixed(1)}/4.0`;
    const thresholdFormatted =
      rule.type === "noul"
        ? `${(rule.threshold * 100).toFixed(0)}%`
        : `${rule.threshold.toFixed(1)}/4.0`;

    const message = passed
      ? `PASSED: Evaluated at ${scoreFormatted} (under threshold ${thresholdFormatted}).`
      : `VIOLATION: Evaluated at ${scoreFormatted} (exceeds threshold ${thresholdFormatted}). ${rule.description}`;

    evaluations.push({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      passed,
      score: rawScore,
      threshold: rule.threshold,
      confidence,
      message,
    });
  }

  const passedRules = evaluations.filter((e) => e.passed).length;
  const failedErrors = evaluations.filter((e) => !e.passed && e.severity === "error").length;
  const failedWarnings = evaluations.filter((e) => !e.passed && e.severity === "warning").length;
  const advisoriesCount = evaluations.filter((e) => !e.passed && e.severity === "advisory").length;
  const failedRules = evaluations.filter((e) => !e.passed).length;

  // If advisoryOnly is set, never fail overall
  const overallPassed = options.advisoryOnly ? true : failedErrors === 0;

  const markdownReport = generateMarkdownReport(
    evaluations,
    overallPassed,
    diffData.filesChanged,
    response.ok ? response.provider : "Deterministic Heuristic"
  );

  return {
    passed: overallPassed,
    totalRules: evaluations.length,
    passedRules,
    failedRules,
    advisoriesCount,
    evaluations,
    markdownReport,
    filesEvaluated: diffData.filesChanged,
    fallbackUsed: !response.ok,
    latencyMs: Date.now() - start,
    provider: response.provider,
  };
}

function computeRuleFallback(
  rule: SemanticRule,
  diff: string,
  files: string[]
): number {
  const diffLower = diff.toLowerCase();

  switch (rule.id) {
    case "insecure_secret_handling":
      return diff.includes("[REDACTED_") ? 0.90 : 0.05;

    case "dangerous_migration":
      if (diffLower.includes("drop table") || diffLower.includes("truncate")) {
        return 4.0;
      }
      if (diffLower.includes("alter table") && diffLower.includes("drop column")) {
        return 3.5;
      }
      return 1.0;

    case "ui_domain_mixing":
      if (files.some((f) => /\.(tsx|jsx)$/i.test(f))) {
        if (diffLower.includes("query(") || diffLower.includes("select ") || diffLower.includes("insert into")) {
          return 0.85;
        }
      }
      return 0.10;

    case "auth_boundary_change":
      if (diffLower.includes("auth") || diffLower.includes("jwt") || diffLower.includes("role")) {
        return 0.75;
      }
      return 0.05;

    case "manual_generated_edit":
      return files.some((f) => /generated|\.g\.ts/i.test(f)) ? 0.85 : 0.05;

    case "missing_tests":
      const hasTests = files.some((f) => /test|spec/i.test(f));
      return hasTests ? 0.10 : 0.80;

    default:
      return 0.10;
  }
}

function generateMarkdownReport(
  evaluations: RuleEvaluationResult[],
  overallPassed: boolean,
  files: string[],
  engine: string
): string {
  const statusEmoji = overallPassed ? "Passed" : "Action Required";
  const lines: string[] = [
    `### Jev Semantic Linter Report — ${statusEmoji}`,
    "",
    `> **Evaluated by:** ${engine} | **Files:** ${files.length}`,
    "",
    "| Rule | Severity | Result | Value | Details |",
    "| :--- | :--- | :--- | :--- | :--- |",
  ];

  for (const ev of evaluations) {
    const icon = ev.passed ? "PASS" : ev.severity.toUpperCase();
    lines.push(
      `| **${ev.ruleName}** | \`${ev.severity}\` | **${icon}** | ${(ev.score * 100).toFixed(0)}% | ${ev.message} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}
