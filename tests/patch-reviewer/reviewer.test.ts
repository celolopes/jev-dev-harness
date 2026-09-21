import { describe, it, expect } from "vitest";
import { reviewPatchPipeline } from "../../src/patch-reviewer/index.js";
import { triagePatch } from "../../src/patch-reviewer/triage.js";
import { computeFallbackJudgments } from "../../src/patch-reviewer/reviewer.js";

describe("Patch Reviewer: reviewer and triage", () => {
  it("approves clean and low-risk changes under deterministic triage", () => {
    const cleanJudgments = {
      isOutOfScope: 0.05,
      regressionRisk: 1.0,
      modifiesAuth: 0.0,
      modifiesDatabase: 0.0,
      missingTests: 0.0,
      exposesSecrets: 0.0,
      confidence: 0.9,
    };

    const decision = triagePatch(cleanJudgments);
    expect(decision.status).toBe("APPROVED");
    expect(decision.riskScore).toBeLessThan(20);
    expect(decision.warnings.length).toBe(0);
  });

  it("blocks changes that expose secrets or credentials", () => {
    const leakedSecretsJudgments = {
      isOutOfScope: 0.05,
      regressionRisk: 1.0,
      modifiesAuth: 0.1,
      modifiesDatabase: 0.0,
      missingTests: 0.0,
      exposesSecrets: 0.95,
      confidence: 0.95,
    };

    const decision = triagePatch(leakedSecretsJudgments);
    expect(decision.status).toBe("BLOCK_HUMAN_REQUIRED");
    expect(decision.warnings.some((w) => w.includes("CRITICAL: Diff contains or exposes credentials"))).toBe(true);
  });

  it("blocks changes with high regression risk (>= 3.5)", () => {
    const highRiskJudgments = {
      isOutOfScope: 0.2,
      regressionRisk: 3.8,
      modifiesAuth: 0.1,
      modifiesDatabase: 0.1,
      missingTests: 0.5,
      exposesSecrets: 0.0,
      confidence: 0.9,
    };

    const decision = triagePatch(highRiskJudgments);
    expect(decision.status).toBe("BLOCK_HUMAN_REQUIRED");
    expect(decision.warnings.some((w) => w.includes("CRITICAL: High estimated regression risk"))).toBe(true);
  });

  it("escalates when changes are out of scope", () => {
    const outOfScopeJudgments = {
      isOutOfScope: 0.85,
      regressionRisk: 1.5,
      modifiesAuth: 0.0,
      modifiesDatabase: 0.0,
      missingTests: 0.0,
      exposesSecrets: 0.0,
      confidence: 0.85,
    };

    const decision = triagePatch(outOfScopeJudgments);
    expect(decision.status).toBe("ESCALATE_REVIEWER");
    expect(decision.warnings.some((w) => w.includes("Out of scope"))).toBe(true);
  });

  it("escalates when authentication or authorization is modified", () => {
    const authJudgments = {
      isOutOfScope: 0.1,
      regressionRisk: 1.8,
      modifiesAuth: 0.80,
      modifiesDatabase: 0.0,
      missingTests: 0.1,
      exposesSecrets: 0.0,
      confidence: 0.9,
    };

    const decision = triagePatch(authJudgments);
    expect(decision.status).toBe("ESCALATE_REVIEWER");
    expect(decision.warnings.some((w) => w.includes("Authentication or authorization logic modified"))).toBe(true);
  });

  it("escalates when database schemas or migrations are modified", () => {
    const dbJudgments = {
      isOutOfScope: 0.1,
      regressionRisk: 1.8,
      modifiesAuth: 0.0,
      modifiesDatabase: 0.75,
      missingTests: 0.1,
      exposesSecrets: 0.0,
      confidence: 0.9,
    };

    const decision = triagePatch(dbJudgments);
    expect(decision.status).toBe("ESCALATE_REVIEWER");
    expect(decision.warnings.some((w) => w.includes("Database schemas, migrations"))).toBe(true);
  });

  it("computes fallback judgments heuristically when offline", () => {
    const diffData = {
      rawDiff: "",
      sanitizedDiff: `
diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
+ export function verifyJwtToken(token: string) {}
      `,
      filesChanged: ["src/auth/jwt.ts"],
      additions: 10,
      deletions: 0,
    };

    const fallback = computeFallbackJudgments("Implement JWT token auth", diffData);
    expect(fallback.modifiesAuth).toBeGreaterThan(0.5);
    expect(fallback.missingTests).toBeGreaterThan(0.5); // No tests in filesChanged
  });

  it("runs the full review pipeline with fallback when useJev is false", async () => {
    const testDiff = `
diff --git a/src/billing/invoice.ts b/src/billing/invoice.ts
--- a/src/billing/invoice.ts
+++ b/src/billing/invoice.ts
@@ -1,2 +1,3 @@
+export function calculateTax(amount: number) { return amount * 0.1; }
`;

    const result = await reviewPatchPipeline({
      task: "Add calculateTax to invoice billing module",
      diff: testDiff,
      useJev: false,
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.filesChanged).toContain("src/billing/invoice.ts");
    expect(result.additions).toBe(1);
    expect(result.status).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });
});
