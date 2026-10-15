import { describe, expect, it } from "vitest";
// @ts-expect-error standalone Node evaluation script intentionally has no declaration file
import { assess, evaluate, summarize } from "../../scripts/eval-jev-models.mjs";

const testCase = { id: "guard", kind: "guard", language: "pt", expected: { unsafe: true, category: "destructive" } };
const response = (model = "jev-1.13.0") => ({ ok: true, result: { model,
  answers: { unsafe: { noul: 0.95 }, category: { choice: "destructive", confidence: 0.9 } } },
  latencyMs: 100, inputTokens: 100, outputTokens: 10, costUsd: undefined });
describe("Model evaluation evidence", () => {
  it("distinguishes model errors from transport fallbacks", () => {
    expect(assess(testCase, response()).passed).toBe(true);
    const wrong = response(); wrong.result.answers.unsafe.noul = 0.1;
    expect(assess(testCase, wrong)).toMatchObject({ passed: false, fallback: false });
    expect(assess(testCase, { ok: false, reason: "timeout" })).toMatchObject({ passed: false, fallback: true });
  });
  it("alternates models, excludes expected answers from state and rejects resolved-model mismatch", async () => {
    const order: string[] = [];
    const rows = await evaluate({ cases: [testCase], repetitions: 2, models: ["jev-1.13.0", "jev-1.14.0"],
      createClient: (model: string) => ({ systemOne: async (state: Record<string, unknown>) => {
        expect(state.expected).toBeUndefined(); order.push(model); return response();
      } }) });
    expect(order).toEqual(["jev-1.13.0", "jev-1.14.0", "jev-1.14.0", "jev-1.13.0"]);
    expect(rows.filter((row: any) => row.requestedModel === "jev-1.14.0").every((row: any) => !row.passed)).toBe(true);
    expect(summarize(rows).reportedCostUsd).toBeNull();
  });
  it("never substitutes missing tokens/cost for zero or invents savings", () => {
    const summary = summarize([{ ...response(), language: "pt", passed: true, fallback: false,
      resolvedModel: "jev-1.13.0", requestedModel: "jev-1.13.0", inputTokens: null, outputTokens: 10, costUsd: null }]);
    expect(summary).toMatchObject({ reportedInputTokens: null, reportedOutputTokens: 10, reportedCostUsd: null, costedRequests: 0 });
    expect(summary).not.toHaveProperty("tokenSavings");
  });
});
