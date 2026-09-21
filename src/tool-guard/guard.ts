import type { ClassifierResult } from "./classifier.js";
import type { EvaluatorResult } from "./evaluator.js";
import type { GuardCategory, GuardCheckOptions, GuardResult, RiskLevel } from "./types.js";

/**
 * Merges deterministic classification with optional Jev semantic evaluation
 * to produce a safe runtime guard decision.
 */
export function checkCommand(
  classifierResult: ClassifierResult,
  evaluatorResult: EvaluatorResult | null,
  options: GuardCheckOptions
): GuardResult {
  // 1. Determine effective category
  let category: GuardCategory = classifierResult.category;
  if (category === "unknown" && evaluatorResult && evaluatorResult.category !== "unknown") {
    category = evaluatorResult.category;
  }

  // 2. Base risk level from category
  let riskLevel: RiskLevel = "low";
  switch (category) {
    case "read-only":
    case "modify-local":
      riskLevel = "low";
      break;
    case "network":
      riskLevel = options.allowNetwork ? "low" : "medium";
      break;
    case "destructive-local":
      riskLevel = "high";
      break;
    case "production-sensitive":
      riskLevel = "critical";
      break;
    case "unknown":
      riskLevel = "medium";
      break;
  }

  // 3. Determine permissions (allowed / requiresConfirmation)
  let allowed = false;
  let requiresConfirmation = false;
  let reason = "";

  switch (category) {
    case "read-only":
      allowed = true;
      requiresConfirmation = false;
      reason = `Safe read-only operation (${classifierResult.matchedRule || "inspection"}). Allowed immediately.`;
      break;

    case "modify-local":
      allowed = true;
      requiresConfirmation = false;
      reason = `Safe local workspace modification (${classifierResult.matchedRule || "build/edit"}). Allowed in repository.`;
      break;

    case "destructive-local":
      allowed = false;
      requiresConfirmation = true;
      riskLevel = "high";
      reason = `Potentially destructive local command (${classifierResult.matchedRule || "deletion/reset"}). Requires explicit human confirmation.`;
      break;

    case "network":
      if (options.allowNetwork) {
        allowed = true;
        requiresConfirmation = false;
        reason = `Network command allowed by configuration flag (--allow-network).`;
      } else {
        allowed = false;
        requiresConfirmation = true;
        reason = `Network command (${classifierResult.matchedRule || "external communication"}). Requires user confirmation or --allow-network flag.`;
      }
      break;

    case "production-sensitive":
      if (options.allowProduction) {
        allowed = true;
        requiresConfirmation = true;
        reason = `Production-sensitive command authorized with explicit flag (--allow-production). Still prompts confirmation for safety.`;
      } else {
        allowed = false;
        requiresConfirmation = true;
        riskLevel = "critical";
        reason = `BLOCKED: Cloud or production infrastructure command (${classifierResult.matchedRule || "cloud/iac"}). Blocked to prevent accidental damage.`;
      }
      break;

    case "unknown":
    default:
      if (evaluatorResult) {
        if (evaluatorResult.destructivePotential >= 3.0 || evaluatorResult.requiresHumanConfirmation > 0.6) {
          allowed = false;
          requiresConfirmation = true;
          riskLevel = evaluatorResult.destructivePotential >= 3.5 ? "critical" : "high";
          reason = `Jev flagged unknown command as high-risk (destructive score: ${evaluatorResult.destructivePotential.toFixed(1)}/4, human confirmation prob: ${(evaluatorResult.requiresHumanConfirmation * 100).toFixed(0)}%).`;
        } else {
          allowed = true;
          requiresConfirmation = false;
          riskLevel = "low";
          reason = `Jev classified unknown command as benign (destructive score: ${evaluatorResult.destructivePotential.toFixed(1)}/4).`;
        }
      } else {
        // No evaluator available, conservative default
        allowed = false;
        requiresConfirmation = true;
        riskLevel = "medium";
        reason = "Unrecognized command and semantic evaluation unavailable. Requires human confirmation before execution.";
      }
      break;
  }

  // 4. Overrides from semantic evaluator if available
  if (evaluatorResult && !evaluatorResult.fallbackUsed) {
    if (evaluatorResult.requiresHumanConfirmation > 0.75) {
      requiresConfirmation = true;
      if (!allowed) {
        reason += ` Semantic evaluator confirmed human confirmation is required (${(evaluatorResult.requiresHumanConfirmation * 100).toFixed(0)}% prob).`;
      }
    }
    if (evaluatorResult.destructivePotential >= 3.5) {
      allowed = false;
      riskLevel = "critical";
      reason = `CRITICAL: Semantic evaluator rated destructive potential as catastrophic (${evaluatorResult.destructivePotential.toFixed(1)}/4). Command blocked.`;
    }
  }

  return {
    command: options.command,
    allowed,
    requiresConfirmation,
    category,
    riskLevel,
    reason,
    matchedRule: classifierResult.matchedRule,
    fallbackUsed: evaluatorResult ? evaluatorResult.fallbackUsed : false,
    fallbackReason: evaluatorResult?.fallbackReason,
    latencyMs: evaluatorResult ? evaluatorResult.latencyMs : 0,
    provider: evaluatorResult?.provider,
  };
}
