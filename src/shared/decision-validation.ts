import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

export type DecisionResult<Q extends Questions> = SystemOneResult<Q> & {
  usage: SystemOneResult<Q>["usage"] & { cost?: number };
  provider?: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function between(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

/** Validate network data before it can affect ranking or populate the cache. */
export function validateDecisionResult<Q extends Questions>(
  value: unknown,
  questions: Q,
  requireProbabilities = true,
): asserts value is DecisionResult<Q> {
  const invalid = (field: string): never => {
    throw new Error(`INVALID_DECISION_RESPONSE: ${field}`);
  };
  if (!record(value)) invalid("response");
  const result = value as Record<string, unknown>;
  if (typeof result.model !== "string" || !result.model.trim()) invalid("model");
  if (!record(result.answers)) invalid("answers");
  const answers = result.answers as Record<string, unknown>;
  for (const [name, question] of Object.entries(questions)) {
    if (!Object.hasOwn(answers, name) || !record(answers[name])) invalid(`answers.${name}`);
    const answer = answers[name] as Record<string, unknown>;
    if (answer.type !== question.type) invalid(`${name}.type`);
    if (question.type === "noul") {
      if (!between(answer.noul, 1)) invalid(`${name}.noul`);
      continue;
    }
    if (!between(answer.confidence, 1)) invalid(`${name}.confidence`);
    const labels = Object.keys(question.criteria);
    if (question.type === "choice") {
      if (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice)) {
        invalid(`${name}.choice`);
      }
    } else if (!between(answer.score, question.criteria.length - 1)) {
      invalid(`${name}.score`);
    }
    if (requireProbabilities || answer.probabilities !== undefined) {
      if (!record(answer.probabilities)) invalid(`${name}.probabilities`);
      const probabilities = answer.probabilities as Record<string, unknown>;
      if (Object.keys(probabilities).length !== labels.length) invalid(`${name}.probabilities.labels`);
      let total = 0;
      for (const label of labels) {
        const p = probabilities[label];
        if (!Object.hasOwn(probabilities, label) || !between(p, 1)) invalid(`${name}.probabilities.value`);
        total += p as number;
      }
      if (Math.abs(total - 1) > 0.02) invalid(`${name}.probabilities.sum`);
    }
  }
  if (!record(result.usage)) invalid("usage");
  const usage = result.usage as Record<string, unknown>;
  for (const key of ["input_tokens", "output_tokens"]) {
    if (!Number.isSafeInteger(usage[key]) || (usage[key] as number) < 0) invalid(`usage.${key}`);
  }
  if (usage.cost !== undefined && !between(usage.cost, Number.MAX_VALUE)) invalid("usage.cost");
}
