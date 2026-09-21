import type { PatchReviewJudgments, PatchReviewStatus } from "./types.js";

export interface TriageDecision {
  status: PatchReviewStatus;
  riskScore: number; // 0-100
  warnings: string[];
}

/**
 * Triages patch review judgments into actionable decisions:
 * - BLOCK_HUMAN_REQUIRED: Severe security issues (secrets exposed) or critical regression risk.
 * - ESCALATE_REVIEWER: Out of scope changes, auth/db modifications, or missing test coverage.
 * - APPROVED: Low regression risk, within scope, safe fast path.
 */
export function triagePatch(judgments: PatchReviewJudgments): TriageDecision {
  const warnings: string[] = [];
  let isBlock = false;
  let isEscalate = false;

  // 1. Critical blockers
  if (judgments.exposesSecrets > 0.20) {
    isBlock = true;
    warnings.push(
      `CRITICAL: Diff contains or exposes credentials, secrets, or redacted tokens (prob: ${(judgments.exposesSecrets * 100).toFixed(0)}%). Immediate human inspection required.`
    );
  }

  if (judgments.regressionRisk >= 3.5) {
    isBlock = true;
    warnings.push(
      `CRITICAL: High estimated regression risk (${judgments.regressionRisk.toFixed(1)}/4.0). Critical interfaces or unverified core paths affected.`
    );
  }

  // 2. Escalation triggers (require senior/expensive reviewer or specialized check)
  if (judgments.isOutOfScope > 0.50) {
    isEscalate = true;
    warnings.push(
      `Out of scope: Diff appears to include changes unrelated to stated task (prob: ${(judgments.isOutOfScope * 100).toFixed(0)}%).`
    );
  }

  if (judgments.modifiesAuth > 0.60) {
    isEscalate = true;
    warnings.push(
      `Security: Authentication or authorization logic modified (prob: ${(judgments.modifiesAuth * 100).toFixed(0)}%). Security review advised.`
    );
  }

  if (judgments.modifiesDatabase > 0.60) {
    isEscalate = true;
    warnings.push(
      `Persistence: Database schemas, migrations, or persistent models modified (prob: ${(judgments.modifiesDatabase * 100).toFixed(0)}%). Data layer review advised.`
    );
  }

  if (judgments.missingTests > 0.70) {
    isEscalate = true;
    warnings.push(
      `Quality: New feature logic added without corresponding tests (prob: ${(judgments.missingTests * 100).toFixed(0)}%).`
    );
  }

  // Calculate composite risk score (0-100)
  // Weights:
  // - exposesSecrets: 30%
  // - regressionRisk (0-4 mapped to 0-1): 25%
  // - isOutOfScope: 15%
  // - modifiesAuth: 10%
  // - modifiesDatabase: 10%
  // - missingTests: 10%
  const normalizedRegression = Math.min(1, judgments.regressionRisk / 4);
  const rawScore =
    judgments.exposesSecrets * 30 +
    normalizedRegression * 25 +
    judgments.isOutOfScope * 15 +
    judgments.modifiesAuth * 10 +
    judgments.modifiesDatabase * 10 +
    judgments.missingTests * 10;

  const riskScore = Math.min(100, Math.max(0, Math.round(rawScore * 10) / 10));

  let status: PatchReviewStatus = "APPROVED";
  if (isBlock) {
    status = "BLOCK_HUMAN_REQUIRED";
  } else if (isEscalate) {
    status = "ESCALATE_REVIEWER";
  }

  return {
    status,
    riskScore,
    warnings,
  };
}
