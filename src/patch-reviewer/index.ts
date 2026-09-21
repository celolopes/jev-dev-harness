import { SafeJevClient } from "../shared/typesafe-client.js";
import { extractDiff } from "./diff-extractor.js";
import { reviewPatch } from "./reviewer.js";
import { triagePatch } from "./triage.js";
import type {
  PatchReviewOptions,
  PatchReviewResult,
} from "./types.js";

export * from "./types.js";
export { extractDiff, type DiffData } from "./diff-extractor.js";
export { reviewPatch, computeFallbackJudgments, type ReviewOutcome } from "./reviewer.js";
export { triagePatch, type TriageDecision } from "./triage.js";

/**
 * Main entry point for the Patch Reviewer pipeline.
 *
 * Steps:
 * 1. Extract and sanitize git diff (or read from options/file).
 * 2. Evaluate semantic risk using Jev System One batched questions (or fallback).
 * 3. Triage results into APPROVED, ESCALATE_REVIEWER, or BLOCK_HUMAN_REQUIRED.
 */
export async function reviewPatchPipeline(
  options: PatchReviewOptions
): Promise<PatchReviewResult> {
  const diffData = await extractDiff(options);

  const client = new SafeJevClient({
    apiKey: options.apiKey,
    disabled: options.useJev === false,
    timeoutMs: options.timeoutMs,
  });

  const outcome = await reviewPatch(options.task, diffData, client, options);
  const triage = triagePatch(outcome.judgments);

  // Generate snippet for display/reporting (first 1000 chars)
  const diffSnippet =
    diffData.sanitizedDiff.length > 1000
      ? diffData.sanitizedDiff.substring(0, 1000) + "\n... [remaining diff omitted]"
      : diffData.sanitizedDiff;

  return {
    task: options.task,
    status: triage.status,
    riskScore: triage.riskScore,
    warnings: triage.warnings,
    judgments: outcome.judgments,
    filesChanged: diffData.filesChanged,
    additions: diffData.additions,
    deletions: diffData.deletions,
    diffSnippet,
    fallbackUsed: outcome.fallbackUsed,
    fallbackReason: outcome.fallbackReason,
    latencyMs: outcome.latencyMs,
    provider: outcome.provider,
  };
}
