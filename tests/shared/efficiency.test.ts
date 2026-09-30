import { describe, expect, it } from "vitest";
import { buildContextEfficiencyReport } from "../../src/shared/efficiency.js";
import { TelemetryCollector } from "../../src/shared/telemetry.js";
import { getAgentRuleContent } from "../../src/cli/doctor.js";

describe("Factual efficiency reports", () => {
  it("reports full cache without new calls, charges, savings or audits", () => {
    const collector = new TelemetryCollector();
    Object.assign(collector, { initialCandidates: 5086, filteredCandidates: 116,
      evaluatedCandidates: 15, evaluatedByJev: 15, selectedCount: 5, cacheHits: 15 });
    const report = buildContextEfficiencyReport({ ...collector.getMetrics(), latencyMs: 103 });
    expect(report).toMatchObject({ entriesFound: 5086, candidatesAfterFilters: 116,
      candidatesEvaluated: 15, selectedFiles: 5, cachedDecisions: 15, newModelCalls: 0,
      newTokens: { input: 0, output: 0 }, reportedCostUsd: null,
      costCoverage: { costedRequests: 0, newModelCalls: 0 }, tokenSavings: null,
      moneySavings: null, savingsStatus: "not_measured", commandAudit: "not_executed", diffAudit: "not_executed" });
    expect(report.summaryMessage).toContain("nenhuma chamada nova ao modelo");
    expect(report.summaryMessage).toContain("custo não informado");
    expect(report.summaryMessage).not.toMatch(/6[.,]098[.,]700|economizados|auditados|<1s/);
  });
  it("distinguishes absent cost from partially reported zero", () => {
    const collector = new TelemetryCollector();
    collector.newModelCalls = 2;
    collector.validatedResponses = 2;
    collector.addTokens(720, 95);
    expect(buildContextEfficiencyReport(collector.getMetrics()).reportedCostUsd).toBeNull();
    collector.costedRequests = 1;
    expect(buildContextEfficiencyReport(collector.getMetrics())).toMatchObject({
      reportedCostUsd: 0, costCoverage: { costedRequests: 1, newModelCalls: 2 },
      newTokens: { input: 720, output: 95 } });
  });
  it("does not infer new calls from old metrics or cache misses", () => {
    const { newModelCalls, ...legacy } = new TelemetryCollector().getMetrics();
    legacy.cacheMisses = 15;
    expect(buildContextEfficiencyReport(legacy).newModelCalls).toBeNull();
  });
  it("installs factual agent rules", () => {
    expect(getAgentRuleContent()).toContain("não medida sem comparação válida");
    expect(getAgentRuleContent()).not.toMatch(/Economia Estimada|Comandos e diffs auditados|<1s/);
  });
});
