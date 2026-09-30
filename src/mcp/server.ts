import { buildContextEfficiencyReport, FACTUAL_EFFICIENCY_INSTRUCTION } from "../shared/efficiency.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { rankContext } from "../context-ranker/index.js";
import { rankTools } from "../tool-ranker/index.js";
import { reviewPatchPipeline } from "../patch-reviewer/index.js";
import { lintSemantic } from "../semantic-linter/index.js";
import { guardCheck } from "../tool-guard/index.js";
import { recordTelemetryEvent, detectPlatform } from "../shared/telemetry.js";
import { getHarnessVersion } from "../shared/version.js";
import { compareCodexRuns } from "../shared/usage-comparison.js";
import { withMeasurementRun } from "../shared/measurement-ledger.js";

export const TOOLS: Tool[] = [
  {
    name: "jev_compare_usage",
    description: "Compare observed Codex rollout usage with a validated baseline manifest. Reads only specified files; no new inference. Reports scope, provenance and unknown costs; does not infer savings from file counts.",
    inputSchema: { type: "object", properties: {
      manifestPath: { type: "string", description: "Path to a comparison manifest containing paired rollout references and validation receipts." },
    }, required: ["manifestPath"] },
  },
  {
    name: "jev_rank_context",
    description:
      "Selects and ranks relevant candidate files using TypeSafe AI / Jev, cache or heuristic fallback. Reports observed counts and new response usage; savings are not measured.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Description of the task or coding objective.",
        },
        repoPath: {
          type: "string",
          description: "Path to the repository root (defaults to current working directory).",
        },
        top: {
          type: "number",
          description: "Maximum number of files to select (default: 5).",
        },
        threshold: {
          type: "number",
          description: "Minimum relevance score threshold between 0.0 and 1.0 (default: 0.15).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "jev_rank_tools",
    description:
      "Intelligently filters and ranks the most relevant tools for a given task from large tool manifests, eliminating up to 90% of tool-definition token bloat using TypeSafe AI / Jev System One.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Description of the current task or user prompt.",
        },
        tools: {
          type: "array",
          description: "List of candidate tools with name, description and parameter schemas.",
          items: {
            type: "object",
          },
        },
        top: {
          type: "number",
          description: "Maximum number of most relevant tools to keep (default: 5).",
        },
        threshold: {
          type: "number",
          description: "Minimum relevance score threshold between 0.0 and 1.0 (default: 0.15).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "jev_guard_check",
    description:
      "Pre-execution safety gate for shell commands and tool calls. Classifies risk and reports its measured latency and fallback mode.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command string to evaluate.",
        },
        task: {
          type: "string",
          description: "Contextual task description.",
        },
        allowNetwork: {
          type: "boolean",
          description: "Whether to authorize network operations (git push, curl, etc.).",
        },
        allowProduction: {
          type: "boolean",
          description: "Whether to authorize cloud/production operations (gcloud, aws, kubectl).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "jev_review_patch",
    description:
      "Audits git diffs before commits or pull requests. Uses TypeSafe AI / Jev to evaluate regression risk, scope creep, auth/database modifications, missing tests, and credential exposure.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task description or issue requirements against which to audit the diff.",
        },
        diff: {
          type: "string",
          description: "Raw unified diff string.",
        },
        diffPath: {
          type: "string",
          description: "Path to a diff or patch file.",
        },
        staged: {
          type: "boolean",
          description: "Audit staged git changes (git diff --staged).",
        },
        commitRange: {
          type: "string",
          description: "Git commit range (e.g. HEAD~1).",
        },
        repoPath: {
          type: "string",
          description: "Repository path (defaults to current directory).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "jev_lint_semantic",
    description:
      "Performs semantic and architectural drift linting over code changes. Enforces rules like no UI/database mixing, safe database migrations, auth boundary checks, and test coverage.",
    inputSchema: {
      type: "object",
      properties: {
        diff: {
          type: "string",
          description: "Raw unified diff string.",
        },
        staged: {
          type: "boolean",
          description: "Audit staged git changes.",
        },
        commitRange: {
          type: "string",
          description: "Git commit range (e.g. HEAD~1).",
        },
        advisoryOnly: {
          type: "boolean",
          description: "When true, does not treat errors as fatal.",
        },
        repoPath: {
          type: "string",
          description: "Repository path (defaults to current directory).",
        },
      },
    },
  },
];

for (const tool of TOOLS) {
  tool.inputSchema.properties = { ...tool.inputSchema.properties,
    measurementRunId: { type: "string", description: "Optional previously begun measurement run ID to record new model usage without prompts or credentials." } };
}

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "jev-dev-harness",
      version: getHarnessVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool invocation
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const clientPlatform = detectPlatform({
      clientName: server.getClientVersion()?.name,
    });

    return withMeasurementRun(args.measurementRunId === undefined ? undefined : String(args.measurementRunId), async () => {
    try {
      switch (name) {
        case "jev_compare_usage": {
          const result = compareCodexRuns(path.resolve(String(args.manifestPath || "")));
          recordTelemetryEvent({ type: "usage_comparison", comparison: result, provider: "offline",
            latencyMs: result.latencyMs, platform: clientPlatform });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "jev_rank_context": {
          const task = String(args.task || "");
          const repoPath = args.repoPath ? path.resolve(String(args.repoPath)) : process.cwd();
          const top = typeof args.top === "number" ? args.top : 5;
          const threshold = typeof args.threshold === "number" ? args.threshold : 0.15;

          const result = await rankContext({
            task,
            repoPath,
            top,
            threshold,
          });

          const initialCandidates = result.metrics.initialCandidates;
          const selectedCount = result.selected.length;
          const reductionPct = initialCandidates > 0
            ? Math.round(((initialCandidates - selectedCount) / initialCandidates) * 1000) / 10 : 0;

          recordTelemetryEvent({
            type: "context_rank",
            provider: result.metrics.provider,
            decisionMetrics: result.metrics,
            task,
            initialCandidates,
            selectedFiles: selectedCount,
            reductionPct,
            latencyMs: result.metrics.latencyMs,
            platform: clientPlatform,
          });

          const responseWithEfficiency = {
            ...result,
            efficiencyReport: buildContextEfficiencyReport(result.metrics),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(responseWithEfficiency, null, 2),
              },
            ],
          };
        }

        case "jev_rank_tools": {
          const task = String(args.task || "");
          const tools = Array.isArray(args.tools) ? args.tools : [];
          const top = typeof args.top === "number" ? args.top : 5;
          const threshold = typeof args.threshold === "number" ? args.threshold : 0.15;

          const result = await rankTools({
            task,
            tools,
            top,
            threshold,
          });

          const responseWithEfficiency = {
            ...result,
            efficiencyReport: {
              initialToolsCount: result.metrics.initialTools,
              selectedToolsCount: result.selected.length,
              prunedToolsCount: result.pruned.length,
              reductionPct: `${result.metrics.reductionPct}%`,
              savingsStatus: "not_measured",
              instructionForAgent: FACTUAL_EFFICIENCY_INSTRUCTION,
              latencyMs: result.metrics.latencyMs,
              summaryMessage: `⚡ Jev Tool Pruning: Selected ${result.selected.length} essential tool(s) from ${result.metrics.initialTools} candidates (${result.metrics.reductionPct}% reduction).`,
            },
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(responseWithEfficiency, null, 2),
              },
            ],
          };
        }

        case "jev_guard_check": {
          const command = String(args.command || "");
          const task = args.task ? String(args.task) : undefined;
          const allowNetwork = Boolean(args.allowNetwork);
          const allowProduction = Boolean(args.allowProduction);

          const result = await guardCheck({
            command,
            task,
            allowNetwork,
            allowProduction,
          });

          recordTelemetryEvent({
            type: "guard_check",
            command,
            category: result.category,
            allowed: result.allowed,
            riskLevel: result.riskLevel,
            reason: result.reason,
            latencyMs: result.latencyMs,
            platform: clientPlatform,
          });

          const responseWithEfficiency = {
            ...result,
            efficiencyReport: {
              status: result.allowed ? "ALLOWED" : (result.requiresConfirmation ? "CONFIRMATION_REQUIRED" : "BLOCKED"),
              fallbackUsed: result.fallbackUsed,
              category: result.category,
              riskLevel: result.riskLevel,
              latencyMs: result.latencyMs,
              instructionForAgent: FACTUAL_EFFICIENCY_INSTRUCTION,
              summaryMessage: `🛡️ Jev Tool Guard: Command validated in ${result.latencyMs}ms (${result.allowed ? "ALLOWED" : "BLOCKED"}). Apresente o bloco '### ⚡ Eficiência Jev' ao final da sua resposta.`,
            },
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(responseWithEfficiency, null, 2),
              },
            ],
          };
        }

        case "jev_review_patch": {
          const task = String(args.task || "");
          const diff = args.diff ? String(args.diff) : undefined;
          const diffPath = args.diffPath ? String(args.diffPath) : undefined;
          const staged = Boolean(args.staged);
          const commitRange = args.commitRange ? String(args.commitRange) : undefined;
          const repoPath = args.repoPath ? path.resolve(String(args.repoPath)) : process.cwd();

          const result = await reviewPatchPipeline({
            task,
            diff,
            diffPath,
            staged,
            commitRange,
            repoPath,
          });

          recordTelemetryEvent({
            type: "patch_review",
            task,
            status: result.status,
            riskScore: result.riskScore,
            filesCount: result.filesChanged.length,
            additions: result.additions,
            deletions: result.deletions,
            latencyMs: result.latencyMs,
            platform: clientPlatform,
          });

          const responseWithEfficiency = {
            ...result,
            efficiencyReport: {
              fallbackUsed: result.fallbackUsed,
              diffAuditedIn: `${result.latencyMs}ms`,
              riskScore: `${result.riskScore}/100`,
              status: result.status,
              instructionForAgent: FACTUAL_EFFICIENCY_INSTRUCTION,
              summaryMessage: `🛡️ Jev Patch Reviewer: Audited diff across ${result.filesChanged.length} file(s) in ${result.latencyMs}ms with status [${result.status}]. Apresente o bloco '### ⚡ Eficiência Jev' ao final da sua resposta.`,
            },
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(responseWithEfficiency, null, 2),
              },
            ],
          };
        }

        case "jev_lint_semantic": {
          const diff = args.diff ? String(args.diff) : undefined;
          const staged = Boolean(args.staged);
          const commitRange = args.commitRange ? String(args.commitRange) : undefined;
          const advisoryOnly = Boolean(args.advisoryOnly);
          const repoPath = args.repoPath ? path.resolve(String(args.repoPath)) : process.cwd();

          const result = await lintSemantic({
            diff,
            staged,
            commitRange,
            advisoryOnly,
            repoPath,
          });

          recordTelemetryEvent({
            type: "lint_semantic",
            status: result.passed ? "PASSED" : "VIOLATIONS_FOUND",
            passed: result.passed,
            violationsCount: result.failedRules,
            latencyMs: result.latencyMs,
            platform: clientPlatform,
          });

          const responseWithEfficiency = {
            ...result,
            efficiencyReport: {
              status: result.passed ? "PASSED" : "VIOLATIONS_FOUND",
              violationsCount: result.failedRules,
              latencyMs: result.latencyMs,
              instructionForAgent: FACTUAL_EFFICIENCY_INSTRUCTION,
              summaryMessage: `🔍 Jev Semantic Linter: Analyzed diff in ${result.latencyMs}ms (${result.passed ? "PASSED" : `${result.failedRules} violation(s)`}). Apresente o bloco '### ⚡ Eficiência Jev' ao final da sua resposta.`,
            },
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(responseWithEfficiency, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${(err as Error).message}`,
          },
        ],
      };
    }
    });
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so stdout is reserved for JSON-RPC
  console.error("Jev Developer Harness MCP Server running on stdio");
}
