import { describe, it, expect } from "vitest";
import { resolveClosedParam, planTool } from "../../src/tool-ranker/param-resolver.js";
import { sanitizeTools, shardTools } from "../../src/tool-ranker/sharder.js";
import { rankTools } from "../../src/tool-ranker/ranker.js";

describe("Tool Ranker & Pruner", () => {
  describe("Param Resolver (ClosedParam)", () => {
    it("extracts boolean parameter", () => {
      const param = resolveClosedParam("staged", { type: "boolean", description: "Stage diff" }, true);
      expect(param).toBeDefined();
      expect(param?.kind).toBe("boolean");
      expect(param?.required).toBe(true);
    });

    it("extracts enum parameter", () => {
      const param = resolveClosedParam(
        "status",
        { enum: ["open", "closed", "draft"], description: "Issue status" },
        false
      );
      expect(param).toBeDefined();
      expect(param?.kind).toBe("enum");
      expect(param?.values).toEqual(["open", "closed", "draft"]);
    });

    it("extracts const parameter", () => {
      const param = resolveClosedParam("action", { const: "list" }, true);
      expect(param).toBeDefined();
      expect(param?.kind).toBe("const");
      expect(param?.value).toBe("list");
    });

    it("builds a planTool with closed params", () => {
      const plan = planTool({
        name: "filter_issues",
        description: "Filter issues by status and include comments",
        parameters: {
          properties: {
            state: { enum: ["open", "closed"] },
            includeComments: { type: "boolean" },
            query: { type: "string" },
          },
          required: ["state"],
        },
      });

      expect(plan.name).toBe("filter_issues");
      expect(plan.closedParams?.length).toBe(2);
      expect(plan.closedParams?.[0].name).toBe("state");
      expect(plan.closedParams?.[1].name).toBe("includeComments");
    });
  });

  describe("Sharder & Sanitizer", () => {
    it("rejects tools with unsafe names containing whitespace or injection chars", () => {
      const { valid, rejected } = sanitizeTools([
        { name: "safe_tool_1", description: "Valid tool" },
        { name: "unsafe tool with spaces", description: "Invalid tool" },
        { name: "tool<script>", description: "Injection attempt" },
      ]);

      expect(valid.length).toBe(1);
      expect(valid[0].name).toBe("safe_tool_1");
      expect(rejected).toContain("unsafe tool with spaces");
      expect(rejected).toContain("tool<script>");
    });

    it("shards lists of tools exceeding MAX_TOOLS_PER_SHARD", () => {
      const tools = Array.from({ length: 170 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Description for tool number ${i}`,
      }));

      const shards = shardTools(tools);
      expect(shards.length).toBeGreaterThanOrEqual(2);
      expect(shards[0].tools.length).toBeLessThanOrEqual(80);
    });
  });

  describe("Ranker Pipeline", () => {
    it("ranks tools and prunes irrelevant ones using deterministic fallback", async () => {
      const tools = [
        { name: "read_file", description: "Read contents of a file from disk" },
        { name: "write_file", description: "Write contents to a file on disk" },
        { name: "run_sql_migration", description: "Execute SQL migration on PostgreSQL" },
        { name: "stripe_charge", description: "Process a credit card payment via Stripe" },
      ];

      const result = await rankTools({
        task: "Read the configuration file from disk and inspect contents",
        tools,
        top: 2,
        useJev: false, // Force deterministic test
      });

      expect(result.selected.length).toBeLessThanOrEqual(2);
      expect(result.selected[0].name).toBe("read_file");
      expect(result.pruned).toContain("stripe_charge");
      expect(result.metrics.tokensSaved).toBeGreaterThan(0);
      expect(result.metrics.reductionPct).toBeGreaterThanOrEqual(50);
    });
  });
});
