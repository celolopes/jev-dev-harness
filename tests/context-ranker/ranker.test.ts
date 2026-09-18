import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { setupSyntheticRepo } from "../fixtures/setup-synthetic-repo.js";
import { rankContext } from "../../src/context-ranker/index.js";

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
