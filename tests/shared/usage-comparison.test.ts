import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareCodexRuns, importCodexUsage, listCodexUsage } from "../../src/shared/usage-comparison.js";
import { beginMeasurement, finishMeasurement, withMeasurementRun } from "../../src/shared/measurement-ledger.js";
import { SafeJevClient, noul } from "../../src/shared/typesafe-client.js";
import { createCli } from "../../src/cli/index.js";
import * as updates from "../../src/shared/update-checker.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-measured-usage-"));
  vi.stubEnv("JEV_MEASUREMENT_DIR", dir);
  vi.stubEnv("JEV_CONFIG_FILE", path.join(dir, "no-config.json"));
  vi.stubEnv("JEV_MEASUREMENT_RUN_ID", "");
  vi.stubEnv("JEV_TELEMETRY_FILE", path.join(dir, "telemetry.jsonl"));
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const timestamp = "2026-09-30T10:00:00Z";
const event = (type: string, payload: unknown) => ({ timestamp, type, payload });
const tokens = (input = 1000, output = 100) => ({ input_tokens: input,
  cached_input_tokens: Math.floor(input / 2), output_tokens: output,
  reasoning_output_tokens: Math.floor(output / 2), total_tokens: input + output });
function write(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}
function rollout(sessionId: string, input = 1000, output = 100, extra: { model?: string; complete?: boolean; revision?: string } = {}) {
  const usage = { type: "token_count", info: { total_token_usage: tokens(input, output) } };
  return [
    event("session_meta", { id: sessionId, git: { commit_hash: extra.revision ?? "abc123" } }),
    event("event_msg", { type: "task_started", turn_id: "turn" }),
    event("turn_context", { turn_id: "turn", model: extra.model ?? "test-model", effort: "high" }),
    event("response_item", { type: "message", role: "user", content: "PRIVATE PROMPT" }),
    event("event_msg", usage), event("event_msg", usage),
    ...(extra.complete === false ? [] : [event("event_msg", { type: "task_complete", turn_id: "turn" })]),
  ].map(row => JSON.stringify(row)).join("\n");
}
function fixture() {
  write("baseline.jsonl", rollout("baseline"));
  write("jev.jsonl", rollout("jev", 600, 60));
  for (const id of ["baseline", "jev"]) write(`${id}-validation.json`, {
    taskId: "fix-auth", criterionId: "same-tests", passed: true,
    runIds: [`${id}:turn`], evidenceReference: "test report artifact",
  });
  const manifest = { schemaVersion: 1, taskId: "fix-auth", initialRevision: "abc123",
    environmentId: "same-node-tools-cache-conditions", allRelatedSessionsIncluded: true,
    baseline: { rollouts: [{ path: "baseline.jsonl" }], validationReceipt: "baseline-validation.json", jevDisabled: true },
    withJev: { rollouts: [{ path: "jev.jsonl" }], validationReceipt: "jev-validation.json",
      ledgerPath: "pair.jsonl", measurementRunId: "pair", allJevCallsRecorded: true },
  };
  beginMeasurement("pair"); finishMeasurement("pair");
  return { manifest, file: write("comparison.json", manifest) };
}

describe("Observed Codex usage comparison", () => {
  it("exposes the same measured comparison through CLI and MCP without model calls", async () => {
    const { file } = fixture();
    vi.spyOn(updates, "checkForUpdates").mockResolvedValue({ currentVersion: "test", latestVersion: "test", updateAvailable: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await createCli().parseAsync(["efficiency", "compare", "--manifest", file, "--json", "--no-record"], { from: "user" });
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ agentTokenDelta: 440, moneyDeltaUsd: null });
    log.mockRestore();
    const server = createMcpServer();
    // @ts-expect-error accessing internal request handler for testing
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const response = await handler({ method: "tools/call", params: { name: "jev_compare_usage", arguments: { manifestPath: file } } });
    expect(response.isError).not.toBe(true);
    expect(JSON.parse(response.content[0].text)).toMatchObject({ agentTokenDelta: 440, pipelineTokenDelta: 440 });
  });
  it("discovers local intervals by repository without showing chat content", () => {
    const file = write("rollout-2026-09-30.jsonl", rollout("local").replace('"git":', `"cwd":${JSON.stringify(dir)},"git":`));
    const result = listCodexUsage(dir, dir);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]?.rolloutPath).toBe(file);
    expect(JSON.stringify(result)).not.toContain("PRIVATE PROMPT");
    expect(listCodexUsage(dir, path.join(dir, "other")).intervals).toHaveLength(0);
    write("rollout-internal.jsonl", rollout("internal", 30, 2, { model: "codex-auto-review" }).replace('"git":', `"cwd":${JSON.stringify(dir)},"git":`));
    expect(listCodexUsage(dir, dir).internalIntervalsExcluded).toBe(1);
    expect(listCodexUsage(dir, dir, 20, true).intervals).toHaveLength(2);
  });
  it("uses cumulative counters once; cache and reasoning are subsets", () => {
    const { file } = fixture();
    const report = compareCodexRuns(file);
    expect(report.baseline.agentUsage).toMatchObject({ totalTokens: 1100,
      inputTokens: 1000, cachedInputTokens: 500, outputTokens: 100, reasoningOutputTokens: 50,
      cacheWriteInputTokens: null });
    expect(report.agentTokenDelta).toBe(440);
    expect(report.pipelineTokenDelta).toBe(440);
    expect(report.moneyDeltaUsd).toBeNull();
    expect(JSON.stringify(report)).not.toContain("PRIVATE PROMPT");
    expect(report.baseline.runs[0]?.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("subtracts only the requested turn's prior cumulative snapshot", () => {
    const rows = [
      event("session_meta", { id: "session", git: { commit_hash: "abc123" } }),
      event("event_msg", { type: "token_count", info: { total_token_usage: tokens(100, 10) } }),
      ...rollout("session").split("\n").slice(1).map(row => JSON.parse(row)),
    ];
    const parsed = importCodexUsage(write("offset.jsonl", rows.map(row => JSON.stringify(row)).join("\n")));
    expect(parsed.usage.totalTokens).toBe(990);
  });

  it.each([
    ["incomplete", { complete: false }, /Incomplete/],
    ["model", { model: "other-model" }, /Model/],
    ["revision", { revision: "other-revision" }, /revision/],
  ])("rejects %s comparisons", (_, options, error) => {
    const { file } = fixture();
    write("jev.jsonl", rollout("jev", 600, 60, options));
    expect(() => compareCodexRuns(file)).toThrow(error);
  });

  it("requires validation tied to the exact intervals and rejects self-comparison", () => {
    const { file, manifest } = fixture();
    write("jev-validation.json", { taskId: "fix-auth", criterionId: "same-tests", passed: false,
      runIds: ["jev:turn"], evidenceReference: "failed" });
    expect(() => compareCodexRuns(file)).toThrow(/Validation/);
    manifest.withJev.rollouts = [{ path: "baseline.jsonl" }];
    manifest.withJev.validationReceipt = "baseline-validation.json";
    write("comparison.json", manifest);
    expect(() => compareCodexRuns(file)).toThrow(/itself/);
  });

  it("does not infer full token savings without declared Jev coverage", () => {
    const { file, manifest } = fixture();
    write("comparison.json", { ...manifest, withJev: { ...manifest.withJev, allJevCallsRecorded: false } });
    expect(compareCodexRuns(file).pipelineTokenDelta).toBeNull();
  });

  it("does not infer zero Jev overhead when the ledger is absent", () => {
    const { file, manifest } = fixture();
    write("comparison.json", { ...manifest, withJev: { ...manifest.withJev, ledgerPath: undefined } });
    expect(compareCodexRuns(file)).toMatchObject({ agentTokenDelta: 440, pipelineTokenDelta: null, moneyDeltaUsd: null });
  });

  it("retains negative differences rather than clamping to invented savings", () => {
    const { file } = fixture();
    write("jev.jsonl", rollout("jev", 2000, 200));
    expect(compareCodexRuns(file).agentTokenDelta).toBe(-1100);
  });

  it("only compares complete billing receipts tied to source fingerprints", () => {
    const { file, manifest } = fixture();
    const initial = compareCodexRuns(file);
    const receipt = (fingerprint: string, amount: number) => ({ runFingerprint: fingerprint,
      currency: "USD", amount, coverage: "all_agent_and_jev_costs", sourceReference: "provider billing export" });
    write("baseline-billing.json", receipt(initial.baseline.fingerprint, 0.02));
    write("jev-billing.json", receipt(initial.withJev.fingerprint, 0.015));
    write("comparison.json", { ...manifest, baseline: { ...manifest.baseline, billingReceipt: "baseline-billing.json" },
      withJev: { ...manifest.withJev, billingReceipt: "jev-billing.json" } });
    expect(compareCodexRuns(file).moneyDeltaUsd).toBeCloseTo(0.005);
    write("jev-billing.json", { ...receipt(initial.withJev.fingerprint, 0.015), coverage: "partial" });
    expect(() => compareCodexRuns(file)).toThrow(/billing/);
  });

  it("rejects reset counters and malformed logs without exposing their contents", () => {
    const { file } = fixture();
    const rows = rollout("jev", 600, 60).split("\n");
    rows.splice(-1, 0, JSON.stringify(event("event_msg", { type: "token_count", info: { total_token_usage: tokens(50, 5) } })));
    write("jev.jsonl", rows.join("\n"));
    expect(() => compareCodexRuns(file)).toThrow(/reset/);
    write("jev.jsonl", "PRIVATE MALFORMED INPUT");
    expect(() => compareCodexRuns(file)).toThrow("Invalid JSON in rollout line 1");
  });
});

describe("Opt-in Jev usage ledger", () => {
  it("isolates concurrent MCP measurements and accounts only new logical calls", async () => {
    for (const id of ["left", "right"]) beginMeasurement(id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model: "typesafe/jev-1.13",
      answers: { relevant: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 })));
    const client = new SafeJevClient({ provider: "openrouter", apiKey: "sk-test", defaultModel: "typesafe/jev-1.13" });
    await Promise.all(["left", "right"].map(id => withMeasurementRun(id,
      () => client.systemOne({}, { relevant: noul("relevant?") }))));
    for (const id of ["left", "right"]) {
      finishMeasurement(id);
      const rows = fs.readFileSync(path.join(dir, `${id}.jsonl`), "utf8").trim().split("\n").map(row => JSON.parse(row));
      expect(rows).toHaveLength(4);
      expect(rows.every(row => row.runId === id)).toBe(true);
      expect(rows[2].usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    }
  });
  it("captures real response usage, not state or credentials, in the scoped run", async () => {
    beginMeasurement("native");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model: "typesafe/jev-1.13",
      answers: { relevant: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 20, output_tokens: 3, cost: 0.0001 } }), { status: 200 })));
    const client = new SafeJevClient({ provider: "openrouter", apiKey: "sk-test-private", defaultModel: "typesafe/jev-1.13" });
    await withMeasurementRun("native", () => client.systemOne({ private: "PRIVATE STATE" }, { relevant: noul("relevant?") }));
    finishMeasurement("native");
    const raw = fs.readFileSync(path.join(dir, "native.jsonl"), "utf8");
    expect(raw).not.toMatch(/PRIVATE STATE|sk-test-private/);
    expect(JSON.parse(raw.trim().split("\n")[2]!)).toMatchObject({
      kind: "request_completed", usage: { inputTokens: 20, outputTokens: 3, costUsd: 0.0001 } });
  });

  it("keeps failed usage unknown instead of zero", async () => {
    const { file } = fixture();
    fs.unlinkSync(path.join(dir, "pair.jsonl"));
    beginMeasurement("pair");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const client = new SafeJevClient({ provider: "openrouter", apiKey: "sk-test", defaultModel: "typesafe/jev-1.13" });
    await withMeasurementRun("pair", () => client.systemOne({}, { relevant: noul("relevant?") }));
    finishMeasurement("pair");
    const report = compareCodexRuns(file);
    expect(report.withJev.harnessUsage).toMatchObject({ missingUsage: 1, reportedCostUsd: null });
    expect(report.pipelineTokenDelta).toBeNull();
  });

  it("does not duplicate runs or allow writes after finish", async () => {
    beginMeasurement("unique");
    expect(() => beginMeasurement("unique")).toThrow();
    finishMeasurement("unique");
    expect(() => finishMeasurement("unique")).toThrow(/finished/);
    expect(() => beginMeasurement("../escape")).toThrow(/Invalid/);
  });
});
