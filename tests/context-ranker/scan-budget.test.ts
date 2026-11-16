import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { executeStageA } from "../../src/context-ranker/stage-a-filter.js";
import { IgnoreFilter } from "../../src/shared/ignore.js";
import { TelemetryCollector } from "../../src/shared/telemetry.js";

const repoPath = path.resolve("offline-scan-fixture");
const options = { task: "test", repoPath, candidates: ["src/example.ts"] };

function mockNoIgnoreFiles() {
  vi.spyOn(fs, "existsSync").mockReturnValue(false);
}

function entry(name: string, directory: boolean): fs.Dirent {
  return { name, isDirectory: () => directory, isFile: () => !directory } as fs.Dirent;
}

describe("Stage A cooperative scan budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stops inside a child directory and does not visit later siblings", () => {
    mockNoIgnoreFiles();
    const read = vi.spyOn(fs, "readdirSync").mockImplementation((directory) => {
      if (String(directory) === repoPath) return [entry("a", true), entry("b", true)] as any;
      if (String(directory) === path.join(repoPath, "a")) return [entry("first.ts", false), entry("later.ts", false)] as any;
      throw new Error(`Unexpected traversal: ${directory}`);
    });
    vi.spyOn(IgnoreFilter.prototype, "isIgnoredOnDisk").mockReturnValue({ ignored: false });
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 4 } as fs.Stats);
    const telemetry = new TelemetryCollector();
    let time = 0;
    vi.spyOn(Date, "now").mockImplementation(() => time++);

    const files = executeStageA({ task: "test", repoPath, scanBudgetMs: 3 }, telemetry);

    expect(files.map(file => file.relativePath)).toEqual(["a/first.ts"]);
    expect(read.mock.calls.map(call => String(call[0]))).toEqual([repoPath, path.join(repoPath, "a")]);
    expect(telemetry.initialCandidates).toBe(1);
    expect(telemetry.filteredCandidates).toBe(1);
    expect(telemetry.scanPartial).toBe(true);
    expect(telemetry.scanBudgetMs).toBe(3);
    expect(telemetry.scanElapsedMs).toBe(4);
  });

  it("uses the documented default when no override exists", () => {
    mockNoIgnoreFiles();
    vi.stubEnv("JEV_SCAN_BUDGET_MS", undefined);
    const telemetry = new TelemetryCollector();
    executeStageA(options, telemetry);
    expect(telemetry.scanBudgetMs).toBe(3000);
    expect(telemetry.scanPartial).toBe(false);
  });

  it("uses the environment override", () => {
    mockNoIgnoreFiles();
    vi.stubEnv("JEV_SCAN_BUDGET_MS", "125");
    const telemetry = new TelemetryCollector();
    executeStageA(options, telemetry);
    expect(telemetry.scanBudgetMs).toBe(125);
  });

  it("gives an explicit option precedence over even an invalid environment value", () => {
    mockNoIgnoreFiles();
    vi.stubEnv("JEV_SCAN_BUDGET_MS", "invalid");
    const telemetry = new TelemetryCollector();
    executeStageA({ ...options, scanBudgetMs: 250 }, telemetry);
    expect(telemetry.scanBudgetMs).toBe(250);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid explicit budget %s", scanBudgetMs => {
    expect(() => executeStageA({ ...options, scanBudgetMs }, new TelemetryCollector()))
      .toThrow("scanBudgetMs must be a positive number");
  });

  it.each(["", "0", "-1", "NaN", "Infinity", "not-a-number"])("rejects invalid environment budget %j", value => {
    vi.stubEnv("JEV_SCAN_BUDGET_MS", value);
    expect(() => executeStageA(options, new TelemetryCollector()))
      .toThrow("scanBudgetMs must be a positive number");
  });
});