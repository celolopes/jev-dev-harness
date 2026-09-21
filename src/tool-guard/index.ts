import { SafeJevClient } from "../shared/typesafe-client.js";
import { classifyCommand } from "./classifier.js";
import { evaluateCommand, type EvaluatorResult } from "./evaluator.js";
import { checkCommand } from "./guard.js";
import type { GuardCheckOptions, GuardResult } from "./types.js";

export * from "./types.js";
export { classifyCommand, type ClassifierResult } from "./classifier.js";
export { evaluateCommand, type EvaluatorResult } from "./evaluator.js";
export { checkCommand } from "./guard.js";

/**
 * Main entry point for the Tool Call Guard pipeline.
 *
 * Steps:
 * 1. Fast deterministic classification (< 1ms).
 * 2. If classified as "unknown" and useJev is not false, evaluate semantically with Jev System One.
 * 3. Formulate unified GuardResult with safety permission, risk level, and explanation.
 */
export async function guardCheck(
  options: GuardCheckOptions
): Promise<GuardResult> {
  const start = Date.now();

  // 1. Fast lexical classifier
  const classifierResult = classifyCommand(options.command);

  let evaluatorResult: EvaluatorResult | null = null;

  // 2. Semantic evaluation for unknown commands if enabled
  if (classifierResult.category === "unknown" && options.useJev !== false) {
    const client = new SafeJevClient({
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
    });
    evaluatorResult = await evaluateCommand(
      options.command,
      options.task,
      client,
      options
    );
  }

  // 3. Final guard decision
  const result = checkCommand(classifierResult, evaluatorResult, options);

  // If classifier was instant and no evaluator was called, set latency
  if (!evaluatorResult) {
    result.latencyMs = Date.now() - start;
  }

  return result;
}
