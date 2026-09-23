import * as fs from "node:fs";
import { planTool } from "./param-resolver.js";
import { sanitizeTools, shardTools, type ToolShard } from "./sharder.js";
import type {
  RankedTool,
  ToolDefinition,
  ToolPlan,
  ToolRankOptions,
  ToolRankResult,
} from "./types.js";
import {
  SafeJevClient,
  choice,
  noul,
  score,
} from "../shared/typesafe-client.js";
import { recordTelemetryEvent } from "../shared/telemetry.js";

/**
 * Deterministic fast heuristic scoring (<1ms) based on lexical keyword matching.
 */
function scoreHeuristic(task: string, tool: ToolPlan): { score: number; reason: string } {
  const taskTokens = task
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const toolNameTokens = tool.name
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_-]+/);

  const descTokens = (tool.description || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  let matchPoints = 0;
  let matches: string[] = [];

  for (const token of taskTokens) {
    if (toolNameTokens.includes(token)) {
      matchPoints += 3;
      matches.push(`name:${token}`);
    } else if (descTokens.includes(token)) {
      matchPoints += 1;
      matches.push(`desc:${token}`);
    }
  }

  // Normalize score between 0.05 and 0.95
  const normalized = Math.min(0.95, Math.max(0.05, matchPoints * 0.15));
  const reason =
    matches.length > 0
      ? `Keyword match on [${matches.slice(0, 3).join(", ")}]`
      : "Low lexical relevance";

  return { score: Math.round(normalized * 1000) / 1000, reason };
}

/**
 * Main Tool Ranking Pipeline
 */
export async function rankTools(options: ToolRankOptions): Promise<ToolRankResult> {
  const startTime = Date.now();
  const task = options.task?.trim() || "";
  const top = options.top && options.top > 0 ? options.top : 5;
  const threshold = options.threshold !== undefined ? options.threshold : 0.15;
  const useJev = options.useJev !== false;

  // 1. Gather tools
  let rawTools: ToolDefinition[] = options.tools || [];
  if (rawTools.length === 0 && options.toolsJsonPath && fs.existsSync(options.toolsJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(options.toolsJsonPath, "utf-8"));
      rawTools = Array.isArray(parsed) ? parsed : parsed.tools || [];
    } catch {
      // Fallback to empty if parse fails
    }
  }

  const initialCount = rawTools.length;
  if (initialCount === 0) {
    return {
      task,
      selected: [],
      pruned: [],
      metrics: {
        initialTools: 0,
        selectedTools: 0,
        prunedTools: 0,
        tokensSaved: 0,
        reductionPct: 0,
        latencyMs: Date.now() - startTime,
        shardsCount: 0,
        fallbackUsed: false,
      },
      fallbackUsed: false,
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Plan and sanitize tools
  const planned = rawTools.map((t) => planTool(t));
  const { valid: sanitized, rejected } = sanitizeTools(planned);

  // 3. Shard if necessary
  const shards = shardTools(sanitized);

  // 4. Evaluate tools
  const client = new SafeJevClient({
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs || 8000,
    disabled: !useJev,
  });

  const rankedCandidates: RankedTool[] = [];
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  for (const shard of shards) {
    // Baseline heuristic for every tool in the shard
    const shardCandidates = shard.tools.map((tool) => {
      const h = scoreHeuristic(task, tool);
      return {
        name: tool.name,
        relevanceScore: h.score,
        confidence: 0.5,
        reason: h.reason,
        closedParams: tool.closedParams,
        selected: false,
      };
    });

    if (useJev && client.isConfigured && shard.tools.length > 0) {
      try {
        const toolOptions = shard.tools.map((t) => {
          const desc = t.description ? `: ${t.description.slice(0, 100)}` : "";
          return `${t.name}${desc}`;
        });

        // Add a "none" option
        const criteria: Record<string, string> = {};
        for (const t of shard.tools) {
          criteria[t.name] = (t.description || `Tool ${t.name}`).slice(0, 150);
        }
        criteria["none_of_these"] = "None of the tools in this group match";

        const state = {
          task,
          tools_roster: shard.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.closedParams ? t.closedParams.map((cp) => cp.name) : undefined,
          })),
        };

        const questions = {
          best_tool: choice(
            "Which tool from this group is the single most essential and relevant tool to execute the task?",
            criteria
          ),
          needs_tool: noul("Does the stated task require calling external tools or functions?"),
        };

        const jevRes = await client.systemOne(state, questions);

        if (jevRes.ok) {
          const answers = jevRes.result.answers;
          const pickedTool = (answers as any).best_tool?.choice;
          const pickedConf = (answers as any).best_tool?.confidence ?? 0.8;
          const needsToolVal = (answers as any).needs_tool?.noul ?? 0.8;

          for (const cand of shardCandidates) {
            if (cand.name === pickedTool && pickedTool !== "none_of_these") {
              cand.relevanceScore = Math.min(0.98, cand.relevanceScore * 0.3 + 0.7 * needsToolVal);
              cand.confidence = pickedConf;
              cand.reason = `Jev System One primary choice (${(pickedConf * 100).toFixed(0)}% conf)`;
            } else {
              cand.relevanceScore = Math.max(0.05, cand.relevanceScore * 0.7);
              cand.confidence = 0.6;
            }
          }
        } else {
          fallbackUsed = true;
          fallbackReason = jevRes.reason;
        }
      } catch (err) {
        fallbackUsed = true;
        fallbackReason = (err as Error).message;
      }
    } else {
      fallbackUsed = true;
      fallbackReason = client.disabled ? "Jev disabled" : client.getReason();
    }

    rankedCandidates.push(...shardCandidates);
  }

  // 5. Sort candidates descending by relevance score
  rankedCandidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // 6. Select top-N tools that exceed threshold
  const selected: RankedTool[] = [];
  const pruned: string[] = [...rejected];

  for (let i = 0; i < rankedCandidates.length; i++) {
    const cand = rankedCandidates[i];
    if (!cand) continue;
    if (i < top && cand.relevanceScore >= threshold) {
      cand.selected = true;
      selected.push(cand);
    } else {
      cand.selected = false;
      pruned.push(cand.name);
    }
  }

  // 7. Calculate savings (~350 tokens per tool schema pruned)
  const tokensSaved = pruned.length * 350;
  const reductionPct =
    initialCount > 0 ? Math.round(((initialCount - selected.length) / initialCount) * 100) : 0;
  const latencyMs = Date.now() - startTime;

  // 8. Record telemetry
  recordTelemetryEvent({
    type: "tool_rank",
    task,
    initialTools: initialCount,
    selectedTools: selected.length,
    tokensSaved,
    reductionPct,
    latencyMs,
    harness: "Tool Ranker",
    provider: client.provider || "typesafe",
  });

  return {
    task,
    selected,
    pruned,
    metrics: {
      initialTools: initialCount,
      selectedTools: selected.length,
      prunedTools: pruned.length,
      tokensSaved,
      reductionPct,
      latencyMs,
      shardsCount: shards.length,
      fallbackUsed,
      fallbackReason,
      provider: client.provider,
    },
    fallbackUsed,
    timestamp: new Date().toISOString(),
  };
}
