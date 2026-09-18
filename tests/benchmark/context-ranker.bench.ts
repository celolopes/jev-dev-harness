import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { setupSyntheticRepo } from "../fixtures/setup-synthetic-repo.js";
import { rankContext } from "../../src/context-ranker/index.js";

interface BenchmarkCase {
  task: string;
  groundTruth: string[];
}

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    task: "Implement JWT authentication token generation and verification",
    groundTruth: ["src/auth/jwt.ts", "tests/auth/jwt.test.ts"],
  },
  {
    task: "Update database schema and relations for orders and users tables",
    groundTruth: ["src/database/schema.sql", "src/database/client.ts"],
  },
  {
    task: "Process customer billing and charge payments via Stripe gateway",
    groundTruth: ["src/billing/stripe.ts", "src/billing/invoice.ts"],
  },
];

function calculateMetricsAtK(
  selected: string[],
  groundTruth: string[],
  k: number
): { precision: number; recall: number } {
  const topK = selected.slice(0, k);
  const relevantInTopK = topK.filter((file) =>
    groundTruth.some((gt) => file.replace(/\\/g, "/").endsWith(gt))
  ).length;

  const precision = relevantInTopK / k;
  const recall = relevantInTopK / groundTruth.length;

  return { precision, recall };
}

describe("Context Ranker Benchmark Suite", () => {
  const repoPath = path.resolve("tests/fixtures/bench-repo-instance");

  beforeAll(() => {
    setupSyntheticRepo(repoPath);
  });

  afterAll(() => {
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it("evaluates Precision@K, Recall@K, file reduction and token savings", async () => {
    const k = 3;
    const results: Array<{
      task: string;
      precision: number;
      recall: number;
      fileReductionPct: number;
      tokenReductionPct: number;
      latencyMs: number;
    }> = [];

    for (const bCase of BENCHMARK_CASES) {
      const res = await rankContext({
        task: bCase.task,
        repoPath,
        top: k,
        useCache: false,
        useJev: false, // Deterministic baseline
      });

      const selectedPaths = res.selected.map((s) => s.path);
      const { precision, recall } = calculateMetricsAtK(
        selectedPaths,
        bCase.groundTruth,
        k
      );

      // Candidate reduction
      const totalFiles = res.metrics.initialCandidates;
      const selectedCount = res.selected.length;
      const fileReductionPct = Number(
        (((totalFiles - selectedCount) / totalFiles) * 100).toFixed(1)
      );

      // Estimated token savings:
      // Baseline: passing entire repo context (~350 tokens per file)
      // Harness: passing only top-K selected files
      const fullRepoTokens = totalFiles * 350;
      const selectedTokens = selectedCount * 350;
      const tokenReductionPct = Number(
        (((fullRepoTokens - selectedTokens) / fullRepoTokens) * 100).toFixed(1)
      );

      results.push({
        task: bCase.task.slice(0, 35) + "...",
        precision,
        recall,
        fileReductionPct,
        tokenReductionPct,
        latencyMs: res.metrics.latencyMs,
      });

      expect(precision).toBeGreaterThan(0.3);
      expect(recall).toBeGreaterThanOrEqual(0.5);
      expect(fileReductionPct).toBeGreaterThan(70);
      expect(tokenReductionPct).toBeGreaterThan(70);
    }

    console.log("\n=======================================================");
    console.log("            CONTEXT RANKER BENCHMARK REPORT           ");
    console.log("=======================================================");
    console.table(results);
    console.log("=======================================================\n");
  });
});
