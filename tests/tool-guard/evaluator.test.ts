import { describe, it, expect } from "vitest";
import { checkCommand } from "../../src/tool-guard/guard.js";
import { guardCheck } from "../../src/tool-guard/index.js";
import type { ClassifierResult } from "../../src/tool-guard/classifier.js";
import type { EvaluatorResult } from "../../src/tool-guard/evaluator.js";

describe("Tool Call Guard: evaluator and decision engine", () => {
  describe("checkCommand decisions", () => {
    it("allows read-only commands without confirmation", () => {
      const classifier: ClassifierResult = {
        category: "read-only",
        confidence: 0.95,
        matchedRule: "git-read",
      };

      const res = checkCommand(classifier, null, { command: "git status" });
      expect(res.allowed).toBe(true);
      expect(res.requiresConfirmation).toBe(false);
      expect(res.riskLevel).toBe("low");
    });

    it("allows modify-local commands without confirmation", () => {
      const classifier: ClassifierResult = {
        category: "modify-local",
        confidence: 0.95,
        matchedRule: "build-and-test",
      };

      const res = checkCommand(classifier, null, { command: "npm test" });
      expect(res.allowed).toBe(true);
      expect(res.requiresConfirmation).toBe(false);
      expect(res.riskLevel).toBe("low");
    });

    it("requires confirmation for destructive-local commands", () => {
      const classifier: ClassifierResult = {
        category: "destructive-local",
        confidence: 0.95,
        matchedRule: "git-destructive",
      };

      const res = checkCommand(classifier, null, { command: "git reset --hard HEAD~1" });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("high");
    });

    it("blocks network commands by default, allows when allowNetwork is true", () => {
      const classifier: ClassifierResult = {
        category: "network",
        confidence: 0.95,
        matchedRule: "git-remote",
      };

      // Default: blocked / confirmation required
      const resBlocked = checkCommand(classifier, null, { command: "git push origin main" });
      expect(resBlocked.allowed).toBe(false);
      expect(resBlocked.requiresConfirmation).toBe(true);

      // With flag: allowed
      const resAllowed = checkCommand(classifier, null, {
        command: "git push origin main",
        allowNetwork: true,
      });
      expect(resAllowed.allowed).toBe(true);
      expect(resAllowed.requiresConfirmation).toBe(false);
    });

    it("blocks production-sensitive commands as critical", () => {
      const classifier: ClassifierResult = {
        category: "production-sensitive",
        confidence: 0.95,
        matchedRule: "cloud-gcp",
      };

      const res = checkCommand(classifier, null, {
        command: "gcloud projects delete my-project",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("critical");
    });

    it("handles unknown commands with evaluator assessment", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      // Evaluator finds high destructive potential
      const dangerousEval: EvaluatorResult = {
        category: "destructive-local",
        requiresHumanConfirmation: 0.85,
        destructivePotential: 3.5,
        confidence: 0.9,
        fallbackUsed: false,
        latencyMs: 120,
      };

      const resDangerous = checkCommand(classifier, dangerousEval, {
        command: "custom-wipe-script.sh",
      });
      expect(resDangerous.allowed).toBe(false);
      expect(resDangerous.requiresConfirmation).toBe(true);
      expect(resDangerous.riskLevel).toBe("critical");

      // Evaluator finds benign operation
      const benignEval: EvaluatorResult = {
        category: "read-only",
        requiresHumanConfirmation: 0.05,
        destructivePotential: 0.2,
        confidence: 0.9,
        fallbackUsed: false,
        latencyMs: 100,
      };

      const resBenign = checkCommand(classifier, benignEval, {
        command: "custom-status-check.sh",
      });
      expect(resBenign.allowed).toBe(true);
      expect(resBenign.requiresConfirmation).toBe(false);
      expect(resBenign.riskLevel).toBe("low");
    });
  });

  describe("guardCheck pipeline", () => {
    it("runs instant deterministic classification on known commands without calling Jev", async () => {
      const res = await guardCheck({
        command: "git status",
      });

      expect(res.allowed).toBe(true);
      expect(res.category).toBe("read-only");
      expect(res.latencyMs).toBeLessThan(50); // Instant (<50ms)
    });

    it("runs guardCheck with useJev: false for unknown commands", async () => {
      const res = await guardCheck({
        command: "some-obscure-binary --flag",
        useJev: false,
      });

      expect(res.category).toBe("unknown");
      expect(res.requiresConfirmation).toBe(true);
    });
  });
});
