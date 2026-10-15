import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SafeJevClient, noul } from "../../src/shared/typesafe-client.js";
import { TelemetryCollector } from "../../src/shared/telemetry.js";
import { buildContextEfficiencyReport } from "../../src/shared/efficiency.js";
import { beginMeasurement, finishMeasurement, withMeasurementRun } from "../../src/shared/measurement-ledger.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-sdk-compat-"));
  vi.stubEnv("JEV_CONFIG_FILE", path.join(dir, "missing.json"));
  vi.stubEnv("JEV_MEASUREMENT_DIR", dir);
  for (const name of ["TYPESAFE_DEFAULT_MODEL", "OPENROUTER_MODEL", "VERCEL_MODEL", "JEV_MEASUREMENT_RUN_ID"]) vi.stubEnv(name, "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const body = (input: unknown, output: unknown, cost?: unknown) => ({ model: "jev-1.13.0",
  answers: { relevant: { type: "noul", noul: 0.95 } }, usage: { input_tokens: input, output_tokens: output, cost } });

describe("SDK 0.7 text decision compatibility", () => {
  it.each(["typesafe", "openrouter"] as const)("retains valid %s decisions with unknown tokens and records the unknown ledger", async provider => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body(null, null)), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = new SafeJevClient({ provider, apiKey: "test-key", defaultModel: "jev-1.13.0" });
    beginMeasurement("null-usage");
    const response = await withMeasurementRun("null-usage", () => client.systemOne({ task: "test" }, { relevant: noul("Relevant?") }));
    finishMeasurement("null-usage");
    expect(response).toMatchObject({ ok: true, inputTokens: null, outputTokens: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const rows = fs.readFileSync(path.join(dir, "null-usage.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(rows[2].usage).toEqual({ inputTokens: null, outputTokens: null });
  });
  it("keeps partial token counts and a reported cost independently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body(100, null, 0.001)), { status: 200 })));
    const result = await new SafeJevClient({ provider: "openrouter", apiKey: "test-key" }).systemOne({}, { relevant: noul("Relevant?") });
    expect(result).toMatchObject({ ok: true, inputTokens: 100, outputTokens: null, costUsd: 0.001 });
  });
  it("treats a null provider cost as unknown without discarding the decision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body(100, 20, null)), { status: 200 })));
    const result = await new SafeJevClient({ provider: "openrouter", apiKey: "test-key" }).systemOne({}, { relevant: noul("Relevant?") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.costUsd).toBeUndefined();
  });
  it.each([-1, 1.2, "100", undefined])("still rejects malformed token usage: %s", async invalid => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body(invalid, 20)), { status: 200 })));
    const result = await new SafeJevClient({ provider: "openrouter", apiKey: "test-key" }).systemOne({}, { relevant: noul("Relevant?") });
    expect(result.ok).toBe(false);
  });
  it("does not enable Box", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = new SafeJevClient({ provider: "typesafe", apiKey: "test-key" });
    const result = await client.systemOne({}, { locate: { type: "box", instructions: "Locate button" } });
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends the pinned native model without experimental headers or compression", async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(body(100, 20)), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await new SafeJevClient({ provider: "typesafe", apiKey: "test-key" }).systemOne({}, { relevant: noul("Relevant?") });
    const init = fetch.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string).model).toBe("jev-1.13.0");
    const headers = new Headers(init.headers);
    expect([...headers.keys()].some(key => key.toLowerCase().includes("danger-zone"))).toBe(false);
    expect(headers.has("content-encoding")).toBe(false);
  });
  it("pins the native default while retaining explicit evaluation and provider configuration", () => {
    expect(new SafeJevClient({ provider: "typesafe", apiKey: "test-key" }).modelName).toBe("jev-1.13.0");
    expect(new SafeJevClient({ provider: "typesafe", apiKey: "test-key", defaultModel: "jev-1.14.0" }).modelName).toBe("jev-1.14.0");
    expect(new SafeJevClient({ provider: "openrouter", apiKey: "test-key" }).modelName).toBe("typesafe/jev-1.13");
    expect(new SafeJevClient({ provider: "vercel", apiKey: "test-key" }).modelName).toBe("typesafe-ai/jev");
  });
  it("keeps mixed unknown totals unknown and reports per-direction coverage", () => {
    const collector = new TelemetryCollector();
    collector.newModelCalls = 2; collector.validatedResponses = 2;
    collector.addTokens(100, null); collector.addTokens(null, 20);
    const report = buildContextEfficiencyReport(collector.getMetrics());
    expect(report).toMatchObject({ newTokens: { input: null, output: null },
      tokenCoverage: { inputTokenRequests: 1, outputTokenRequests: 1, validatedResponses: 2 },
      reportedCostUsd: null, savingsStatus: "not_measured", fallbackUsed: false });
    expect(report.summaryMessage).toContain("não informado/não informado");
  });
});
