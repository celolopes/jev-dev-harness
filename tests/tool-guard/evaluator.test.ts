import { describe, it, expect, vi } from "vitest";
import { checkCommand } from "../../src/tool-guard/guard.js";
import { guardCheck } from "../../src/tool-guard/index.js";
import { SafeJevClient } from "../../src/shared/typesafe-client.js";
import type { ClassifierResult } from "../../src/tool-guard/classifier.js";
import type { EvaluatorResult } from "../../src/tool-guard/evaluator.js";

describe("Tool Call Guard: evaluator and decision engine", () => {
  describe("checkCommand decisions", () => {
    it("1. allows known safe read-only commands without confirmation", () => {
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

    it("2. allows known safe local modification without confirmation", () => {
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

    it("3. requires confirmation for known destructive-local commands", () => {
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

    it("4. blocks known production-sensitive commands as critical", () => {
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

    it("5. unknown command with successful benign evaluation is allowed", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const benignEval: EvaluatorResult = {
        category: "read-only",
        requiresHumanConfirmation: 0.05,
        destructivePotential: 0.2,
        confidence: 0.9,
        fallbackUsed: false,
        latencyMs: 100,
      };

      const res = checkCommand(classifier, benignEval, {
        command: "custom-status-check.sh",
      });
      expect(res.allowed).toBe(true);
      expect(res.requiresConfirmation).toBe(false);
      expect(res.riskLevel).toBe("low");
      expect(res.fallbackUsed).toBe(false);
    });

    it("6. unknown command with successful high-risk evaluation is blocked", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const dangerousEval: EvaluatorResult = {
        category: "destructive-local",
        requiresHumanConfirmation: 0.85,
        destructivePotential: 3.5,
        confidence: 0.9,
        fallbackUsed: false,
        latencyMs: 120,
      };

      const res = checkCommand(classifier, dangerousEval, {
        command: "custom-wipe-script.sh",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("critical");
      expect(res.fallbackUsed).toBe(false);
    });

    it("7. unknown command with missing provider credentials rejects with fallbackUsed=true", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const missingCredsEval: EvaluatorResult = {
        category: "unknown",
        requiresHumanConfirmation: 0.5,
        destructivePotential: 2.0,
        confidence: 0.5,
        fallbackUsed: true,
        fallbackReason: "NO_API_KEY",
        latencyMs: 5,
      };

      const res = checkCommand(classifier, missingCredsEval, {
        command: "obscure-tool run",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.category).toBe("unknown");
      expect(res.riskLevel).toBe("medium");
      expect(res.fallbackUsed).toBe(true);
      expect(res.fallbackReason).toBe("NO_API_KEY");
      expect(res.reason).toContain("NO_API_KEY");
    });

    it("8. unknown command with provider timeout rejects with fallbackUsed=true", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const timeoutEval: EvaluatorResult = {
        category: "unknown",
        requiresHumanConfirmation: 0.5,
        destructivePotential: 2.0,
        confidence: 0.5,
        fallbackUsed: true,
        fallbackReason: "Error: DECISION_TIMEOUT",
        latencyMs: 2005,
      };

      const res = checkCommand(classifier, timeoutEval, {
        command: "slow-obscure-tool execute",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.fallbackUsed).toBe(true);
      expect(res.fallbackReason).toBe("Error: DECISION_TIMEOUT");
    });

    it("9. unknown command with provider network failure rejects with fallbackUsed=true", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const networkEval: EvaluatorResult = {
        category: "unknown",
        requiresHumanConfirmation: 0.5,
        destructivePotential: 2.0,
        confidence: 0.5,
        fallbackUsed: true,
        fallbackReason: "FetchError: ENOTFOUND api.typesafe.ai",
        latencyMs: 50,
      };

      const res = checkCommand(classifier, networkEval, {
        command: "network-obscure-tool",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("medium");
      expect(res.fallbackUsed).toBe(true);
      expect(res.fallbackReason).toBe("FetchError: ENOTFOUND api.typesafe.ai");
    });

    it("10. unknown command with evaluator fallbackUsed=true does not silently allow execution", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      // Simulates standard fallback from SafeJevClient
      const genericFallback: EvaluatorResult = {
        category: "unknown",
        requiresHumanConfirmation: 0.5,
        destructivePotential: 2.0,
        confidence: 0.5,
        fallbackUsed: true,
        fallbackReason: "PROVIDER_OFFLINE",
        latencyMs: 10,
      };

      const res = checkCommand(classifier, genericFallback, {
        command: "ambiguous-command-xyz",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("medium");
      expect(res.category).toBe("unknown");
      expect(res.fallbackUsed).toBe(true);
    });

    it("11. unknown command with useJev=false defaults to conservative confirmation", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const res = checkCommand(classifier, null, {
        command: "offline-unknown-command",
        useJev: false,
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("medium");
      expect(res.fallbackUsed).toBe(false);
    });

    it("12. unknown command with malformed evaluator response defaults to safe confirmation", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const malformedEval = {
        category: "unknown",
        requiresHumanConfirmation: NaN,
        destructivePotential: undefined as any,
        confidence: 0.5,
        fallbackUsed: false,
        latencyMs: 15,
      } as EvaluatorResult;

      const res = checkCommand(classifier, malformedEval, {
        command: "malformed-eval-command",
      });
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("medium");
    });

    it("13. preserves meaningful fallbackReason and redacts secrets", () => {
      const classifier: ClassifierResult = {
        category: "unknown",
        confidence: 0,
        matchedRule: "none",
      };

      const leakyEval: EvaluatorResult = {
        category: "unknown",
        requiresHumanConfirmation: 0.5,
        destructivePotential: 2.0,
        confidence: 0.5,
        fallbackUsed: true,
        fallbackReason: "Auth failed for sk-test_12345678901234567890 at gateway",
        latencyMs: 12,
      };

      const res = checkCommand(classifier, leakyEval, {
        command: "some-command",
      });
      expect(res.allowed).toBe(false);
      expect(res.fallbackUsed).toBe(true);
      expect(res.fallbackReason).not.toContain("sk-test_12345678901234567890");
      expect(res.fallbackReason).toContain("[REDACTED_API_KEY]");
      expect(res.reason).not.toContain("sk-test_12345678901234567890");
    });

    it("14. known deterministic safe commands do NOT become blocked when external provider fallback occurs", () => {
      const classifierReadOnly: ClassifierResult = {
        category: "read-only",
        confidence: 0.95,
        matchedRule: "git-read",
      };

      const fallbackEval: EvaluatorResult = {
        category: "unknown",
        requiresHumanConfirmation: 0.5,
        destructivePotential: 2.0,
        confidence: 0.5,
        fallbackUsed: true,
        fallbackReason: "NO_API_KEY",
        latencyMs: 1,
      };

      const resReadOnly = checkCommand(classifierReadOnly, fallbackEval, {
        command: "git status",
      });
      expect(resReadOnly.allowed).toBe(true);
      expect(resReadOnly.requiresConfirmation).toBe(false);
      expect(resReadOnly.category).toBe("read-only");
      expect(resReadOnly.riskLevel).toBe("low");

      const classifierModify: ClassifierResult = {
        category: "modify-local",
        confidence: 0.95,
        matchedRule: "build-and-test",
      };

      const resModify = checkCommand(classifierModify, fallbackEval, {
        command: "npm run build",
      });
      expect(resModify.allowed).toBe(true);
      expect(resModify.requiresConfirmation).toBe(false);
      expect(resModify.category).toBe("modify-local");
      expect(resModify.riskLevel).toBe("low");
    });

    it("15. blocks network commands by default, allows when allowNetwork is true", () => {
      const classifier: ClassifierResult = {
        category: "network",
        confidence: 0.95,
        matchedRule: "git-remote",
      };

      const resBlocked = checkCommand(classifier, null, { command: "git push origin main" });
      expect(resBlocked.allowed).toBe(false);
      expect(resBlocked.requiresConfirmation).toBe(true);

      const resAllowed = checkCommand(classifier, null, {
        command: "git push origin main",
        allowNetwork: true,
      });
      expect(resAllowed.allowed).toBe(true);
      expect(resAllowed.requiresConfirmation).toBe(false);
    });
  });

  describe("guardCheck pipeline", () => {
    it("runs instant deterministic classification on known commands without calling Jev", async () => {
      const res = await guardCheck({
        command: "git status",
      });

      expect(res.allowed).toBe(true);
      expect(res.category).toBe("read-only");
      expect(res.latencyMs).toBeLessThan(50);
    });

    it("runs guardCheck with useJev: false for unknown commands", async () => {
      const res = await guardCheck({
        command: "some-obscure-binary --flag",
        useJev: false,
      });

      expect(res.category).toBe("unknown");
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("medium");
    });

    it("runs guardCheck with default useJev when provider fails: safe fallback", async () => {
      const spy = vi.spyOn(SafeJevClient.prototype, "systemOne").mockResolvedValueOnce({
        ok: false,
        fallback: true,
        reason: "PROVIDER_UNAVAILABLE_MOCK",
        latencyMs: 15,
        provider: "typesafe",
      } as any);

      const res = await guardCheck({
        command: "some-unrecognized-binary-abc123xyz",
      });

      expect(spy).toHaveBeenCalled();
      expect(res.category).toBe("unknown");
      expect(res.allowed).toBe(false);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.riskLevel).toBe("medium");
      expect(res.fallbackUsed).toBe(true);
      expect(res.fallbackReason).toBe("PROVIDER_UNAVAILABLE_MOCK");

      spy.mockRestore();
    });
  });
});
