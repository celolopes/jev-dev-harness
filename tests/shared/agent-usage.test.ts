import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAgentUsage, importAgentUsage, exportAgentUsage, parseAgentUsage } from "../../src/shared/agent-usage.js";
import { compareUsageRuns } from "../../src/shared/usage-comparison.js";
import { createCli } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as updates from "../../src/shared/update-checker.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-agent-usage-")); vi.stubEnv("JEV_TELEMETRY_FILE", path.join(dir, "telemetry")); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const write = (name: string, value: unknown) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
const run = (sessionId = "base", harness = "cursor", input = 100) => ({
  schemaVersion: 1, kind: "agent_usage", status: "completed", coverage: "complete", includesJevUsage: false,
  sessionId, turnId: "task", harness, initialRevision: "abc123", model: "same-model", effort: "high",
  startedAt: "2026-09-30T10:00:00Z", endedAt: "2026-09-30T10:01:00Z", jevCallsObserved: sessionId !== "base",
  secret: "PRIVATE KEY", events: [{ requestId: sessionId, provider: "actual-provider", format: "openai-chat",
    usage: { prompt_tokens: input, completion_tokens: 20, total_tokens: input + 20, secret: "PRIVATE PROMPT" } }],
});
function pair(harness: string) {
  for (const id of ["base", "jev"]) {
    write(`${id}.json`, run(id, harness, id === "base" ? 100 : 60));
    write(`${id}-validation.json`, { taskId: "task", criterionId: "same-tests", passed: true,
      runIds: [`${id}:task`], evidenceReference: "validation-log" });
  }
  const manifest = { schemaVersion: 1, taskId: "task", initialRevision: "abc123", environmentId: "same-environment",
    allRelatedSessionsIncluded: true,
    baseline: { rollouts: [{ path: "base.json", format: "agent_usage_v1" }], jevDisabled: true, validationReceipt: "base-validation.json" },
    withJev: { rollouts: [{ path: "jev.json", format: "agent_usage_v1" }], validationReceipt: "jev-validation.json" },
  };
  return { manifest, file: write("comparison.json", manifest) };
}
describe("Provider usage normalization", () => {
  it("keeps OpenAI cache and reasoning inside primary counters", () => {
    expect(normalizeAgentUsage("openai-responses", { input_tokens: 100, output_tokens: 20, total_tokens: 120,
      input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 10 } })).toMatchObject({ totalTokens: 120, cachedInputTokens: 80, reasoningOutputTokens: 10 });
  });
  it("adds Anthropic exclusive cache read/write counters exactly once", () => {
    expect(normalizeAgentUsage("anthropic", { input_tokens: 10, output_tokens: 20,
      cache_read_input_tokens: 70, cache_creation_input_tokens: 30 })).toMatchObject({ inputTokens: 110, totalTokens: 130 });
    expect(normalizeAgentUsage("anthropic", { input_tokens: 10, output_tokens: 20 }).totalTokens).toBeNull();
  });
  it("uses Gemini reported total including thinking and supports total-only SDK observations", () => {
    expect(normalizeAgentUsage("gemini", { promptTokenCount: 100, candidatesTokenCount: 20,
      thoughtsTokenCount: 30, totalTokenCount: 150, cachedContentTokenCount: 70 })).toMatchObject({ totalTokens: 150, outputTokens: 50 });
    expect(normalizeAgentUsage("normalized", { totalTokens: 150 }).inputTokens).toBeNull();
    expect(() => normalizeAgentUsage("gemini", { promptTokenCount: 10, totalTokenCount: 20, toolUsePromptTokenCount: 3 })).toThrow("tool-use");
  });
  it("uses Cursor charged cents, not nominal model price or request credits", () => {
    const raw = run();
    raw.events[0] = { ...raw.events[0]!, format: "cursor-event", usage: {
      isTokenBasedCall: true, tokenUsage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 70, cacheWriteTokens: 30, totalCents: 10 }, chargedCents: 12,
    } as any };
    expect(parseAgentUsage(raw)).toMatchObject({ usage: { totalTokens: 130 }, reportedCostUsd: 0.12 });
    expect(normalizeAgentUsage("cursor-event", { isTokenBasedCall: false, chargedCents: 2 }).totalTokens).toBeNull();
  });
  it("rejects negative, fractional, overflowing, contradictory and unsupported counters", () => {
    for (const amount of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => normalizeAgentUsage("normalized", { totalTokens: amount })).toThrow();
    expect(() => normalizeAgentUsage("openai-chat", { prompt_tokens: 10, completion_tokens: 20, total_tokens: 31 })).toThrow();
    expect(() => normalizeAgentUsage("unsupported" as any, null)).toThrow();
  });
});
describe("Cross-harness import and comparison", () => {
  it.each(["antigravity", "trae", "cursor", "vscode-extension", "custom-cli"])("compares %s reported exports without inference", harness => {
    const report = compareUsageRuns(pair(harness).file);
    expect(report.agentTokenDelta).toBe(40);
    expect(report.pipelineTokenDelta).toBeNull();
    expect(report.moneyDeltaUsd).toBeNull();
    expect(report.baseline.runs[0]?.harness).toBe(harness);
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
  it("keeps unknown breakdowns/costs and incomplete coverage unknown", () => {
    const { file } = pair("trae");
    const raw = { ...run("jev", "trae"), coverage: "partial" };
    write("jev.json", raw);
    expect(compareUsageRuns(file)).toMatchObject({ agentTokenDelta: null, pipelineTokenDelta: null, savingsStatus: "not_measured" });
    raw.coverage = "complete"; raw.events[0]!.usage = null as any;
    write("jev.json", raw);
    expect(compareUsageRuns(file).agentTokenDelta).toBeNull();
  });
  it("does not add missing cache/reasoning or cost as zero", () => {
    const result = parseAgentUsage(run());
    expect(result.usage.cachedInputTokens).toBeNull();
    expect(result.usage.reasoningOutputTokens).toBeNull();
    expect(result.reportedCostUsd).toBeNull();
  });
  it("rejects duplicate streamed snapshots and reuse of provider requests", () => {
    const raw = run(); raw.events.push(raw.events[0]!);
    expect(() => parseAgentUsage(raw)).toThrow("Duplicate");
    const { file } = pair("cursor");
    const other = run("jev"); other.events[0]!.requestId = "base"; write("jev.json", other);
    expect(() => compareUsageRuns(file)).toThrow("same provider request");
  });
  it("rejects incomplete runs and overlap with Jev accounting", () => {
    expect(() => parseAgentUsage({ ...run(), status: "running" })).toThrow("incomplete");
    expect(() => parseAgentUsage({ ...run(), includesJevUsage: true })).toThrow("exclude");
    expect(() => parseAgentUsage({ ...run(), events: [] })).toThrow("not zero");
  });
  it("sanitizes exports, retains numeric provenance and refuses overwrite", () => {
    const file = path.join(dir, "clean.json"); exportAgentUsage(file, run());
    expect(fs.readFileSync(file, "utf8")).not.toContain("PRIVATE");
    expect(importAgentUsage(file).usage.totalTokens).toBe(120);
    expect(importAgentUsage(file).source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => exportAgentUsage(file, run())).toThrow();
  });
  it("exposes imports through CLI and MCP without prompt content", async () => {
    const file = write("input.json", run("base", "vscode-extension"));
    vi.spyOn(updates, "checkForUpdates").mockResolvedValue({ currentVersion: "test", latestVersion: "test", updateAvailable: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await createCli().parseAsync(["efficiency", "import", "--input", file], { from: "user" });
    expect(JSON.parse(log.mock.calls[0]![0]).usage.totalTokens).toBe(120);
    const server = createMcpServer();
    // @ts-expect-error internal MCP handler used to exercise the public tool
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const response = await handler({ method: "tools/call", params: { name: "jev_import_usage", arguments: { inputPath: file } } });
    expect(response.isError).not.toBe(true);
    expect(JSON.parse(response.content[0].text).usage.totalTokens).toBe(120);
    expect(response.content[0].text).not.toContain("PRIVATE");
  });
});
