import { describe, it, expect } from "vitest";
import { runDoctorCommand, getAgentRuleContent } from "../../src/cli/doctor.js";

describe("Doctor CLI Command", () => {
  it("generates agent rule content with required directives", () => {
    const content = getAgentRuleContent();
    expect(content).toContain("Jev Developer Harness");
    expect(content).toContain("Tool Call Guard");
    expect(content).toContain("Context Ranker");
    expect(content).toContain("Patch Reviewer");
    expect(content).toContain("### ⚡ Eficiência Jev");
  });

  it("executes runDoctorCommand in JSON mode and returns valid report", async () => {
    const report = await runDoctorCommand({ json: true });

    expect(report).toBeDefined();
    expect(report.environment).toBeDefined();
    expect(report.environment.nodeVersion).toBe(process.version);
    expect(report.mcpAgents.length).toBeGreaterThan(0);
    expect(report.telemetry.filePath).toContain(".jev-dev");
    expect(report.telemetry.pingEmitted).toBe(true);
  });
});
