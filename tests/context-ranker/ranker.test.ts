import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { setupSyntheticRepo } from "../fixtures/setup-synthetic-repo.js";
import { executeStageA, executeStageB, rankContext } from "../../src/context-ranker/index.js";
import { TelemetryCollector } from "../../src/shared/telemetry.js";

describe("Context Ranker Integration Tests", () => {
  const repoPath = path.resolve("tests/fixtures/test-repo-instance");

  beforeAll(() => {
    setupSyntheticRepo(repoPath);
  });

  afterAll(() => {
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it("ranks JWT authentication files at the top for JWT task", async () => {
    const result = await rankContext({
      task: "Implement JWT token generation and validation",
      repoPath,
      top: 5,
      useCache: false,
    });

    expect(result.task).toBe("Implement JWT token generation and validation");
    expect(result.selected.length).toBeGreaterThan(0);

    const paths = result.selected.map((s) => s.path.replace(/\\/g, "/"));
    expect(paths[0]).toContain("src/auth/jwt.ts");
    expect(paths).toContain("tests/auth/jwt.test.ts");

    // Verify secret, binary and oversized files are excluded
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain("secrets.key");
    expect(paths).not.toContain("assets/logo.png");
    expect(paths).not.toContain("data/large_dataset.csv");

    expect(result.metrics.initialCandidates).toBeGreaterThan(10);
    expect(result.metrics.filteredCandidates).toBeLessThan(result.metrics.initialCandidates);
  });

  it("ranks database schema for database/SQL task", async () => {
    const result = await rankContext({
      task: "Create orders table and user schema relation",
      repoPath,
      top: 5,
      useCache: false,
    });

    const paths = result.selected.map((s) => s.path.replace(/\\/g, "/"));
    expect(paths[0]).toContain("src/database/schema.sql");
    expect(result.selected[0]?.role).toBe("database");
  });

  it("handles filenames with spaces without errors", async () => {
    const result = await rankContext({
      task: "string helpers capitalize utility",
      repoPath,
      top: 5,
      useCache: false,
    });

    const paths = result.selected.map((s) => s.path.replace(/\\/g, "/"));
    expect(paths.some((p) => p.includes("string helpers.ts"))).toBe(true);
  });

  it("operates gracefully under deterministic fallback", async () => {
    const result = await rankContext({
      task: "Stripe gateway charge customer billing invoice",
      repoPath,
      useJev: false, // Explicit fallback
      top: 5,
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.metrics.fallbackReason).toBe("DISABLED_BY_USER");

    const paths = result.selected.map((s) => s.path.replace(/\\/g, "/"));
    expect(paths.some((p) => p.includes("billing/stripe.ts") || p.includes("billing/invoice.ts"))).toBe(true);

    for (const item of result.selected) {
      expect(item.source).toBe("deterministic_fallback");
    }
  });

  it("counts visited entries without traversing ignored directories", () => {
    const telemetry = new TelemetryCollector();
    const files = executeStageA({ task: "test", repoPath }, telemetry);
    expect(files.some(file => file.relativePath.startsWith("node_modules/"))).toBe(false);
    expect(telemetry.initialCandidates).toBeGreaterThanOrEqual(files.length);
    const withExtraIgnored = path.join(repoPath, "node_modules", "jev-count-test");
    fs.mkdirSync(withExtraIgnored, { recursive: true });
    fs.writeFileSync(path.join(withExtraIgnored, "ignored.ts"), "export const ignored = 1;");
    const next = new TelemetryCollector();
    executeStageA({ task: "test", repoPath }, next);
    expect(next.initialCandidates).toBe(telemetry.initialCandidates);
  });

  it("marks a deadline-limited scan and preserves only visited explicit candidates", () => {
    const clock = vi.spyOn(Date, "now");
    let time = 0;
    clock.mockImplementation(() => time++);
    try {
      const telemetry = new TelemetryCollector();
      const files = executeStageA({ task: "test", repoPath, scanBudgetMs: 2,
        candidates: ["src/auth/jwt.ts", "src/database/schema.sql"] }, telemetry);
      expect(files.map(file => file.relativePath)).toEqual(["src/auth/jwt.ts"]);
      expect(telemetry.scanPartial).toBe(true);
      expect(telemetry.initialCandidates).toBe(1);
      expect(telemetry.scanBudgetMs).toBe(2);
    } finally { clock.mockRestore(); }
  });

  it("rejects invalid scan budgets", () => {
    expect(() => executeStageA({ task: "test", repoPath, scanBudgetMs: 0 }, new TelemetryCollector()))
      .toThrow("scanBudgetMs must be a positive number");
  });

  it("shows that a partial scan can miss the highest-ranked relevant file", () => {
    const candidates = ["src/auth/jwt.ts", "src/database/schema.sql"];
    const options = { task: "database schema", repoPath, candidates };
    const full = executeStageA({ ...options, scanBudgetMs: 3000 }, new TelemetryCollector());
    expect(executeStageB(options.task, full, 1)[0]?.relativePath).toBe("src/database/schema.sql");
    const clock = vi.spyOn(Date, "now");
    let time = 0;
    clock.mockImplementation(() => time++);
    try {
      const telemetry = new TelemetryCollector();
      const partial = executeStageA({ ...options, scanBudgetMs: 2 }, telemetry);
      expect(telemetry.scanPartial).toBe(true);
      expect(executeStageB(options.task, partial, 1)[0]?.relativePath).toBe("src/auth/jwt.ts");
    } finally { clock.mockRestore(); }
  });

  it("accepts Windows backslashes and POSIX relative paths consistently", async () => {
    const winPath = repoPath.replace(/\//g, "\\");
    const result = await rankContext({
      task: "JWT token auth",
      repoPath: winPath,
      candidates: [
        "src\\auth\\jwt.ts",
        "src/auth/session.ts",
        "tests/auth/jwt.test.ts",
      ],
    });

    expect(result.selected.length).toBeGreaterThan(0);
    expect(result.selected[0]?.path.replace(/\\/g, "/")).toBe("src/auth/jwt.ts");
  });
});
