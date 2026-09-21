import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { rankContext } from "../context-ranker/index.js";
import { reviewPatchPipeline } from "../patch-reviewer/index.js";
import { lintSemantic } from "../semantic-linter/index.js";
import { guardCheck } from "../tool-guard/index.js";

export const TOOLS: Tool[] = [
  {
    name: "jev_rank_context",
    description:
      "Intelligently selects and ranks the most relevant candidate files and snippets for a given coding task using TypeSafe AI / Jev. Reduces token bloat by 88-94%.",
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
    name: "jev_guard_check",
    description:
      "Pre-execution safety gate for shell commands and tool calls. Classifies commands in <1ms into read-only, modify-local, destructive-local, network, or production-sensitive categories, blocking dangerous executions.",
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

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "jev-dev-harness",
      version: "0.1.0",
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

    try {
      switch (name) {
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

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
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

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
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

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
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

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
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

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so stdout is reserved for JSON-RPC
  console.error("Jev Developer Harness MCP Server running on stdio");
}
