import { SAFE_TOOL_NAME, type ToolPlan } from "./types.js";

export const MAX_TOOLS_PER_SHARD = 80;
export const MAX_DESCRIPTION_CHARS = 300;
export const SHARD_CHAR_BUDGET = 32_000;

export interface ToolShard {
  shardIndex: number;
  tools: ToolPlan[];
  totalChars: number;
}

/**
 * Validates and sanitizes tool plans, rejecting unsafe tool names that could break JSON schemas or prompts.
 */
export function sanitizeTools(tools: ToolPlan[]): { valid: ToolPlan[]; rejected: string[] } {
  const valid: ToolPlan[] = [];
  const rejected: string[] = [];
  const seenNames = new Set<string>();

  for (const t of tools) {
    if (!t.name || typeof t.name !== "string" || !SAFE_TOOL_NAME.test(t.name)) {
      rejected.push(t.name || "unknown_tool");
      continue;
    }
    if (seenNames.has(t.name)) {
      rejected.push(t.name);
      continue;
    }
    seenNames.add(t.name);

    // Truncate descriptions to avoid exceeding token budgets
    const cleanDesc = (t.description || "").trim().slice(0, MAX_DESCRIPTION_CHARS);
    valid.push({
      ...t,
      description: cleanDesc,
    });
  }

  return { valid, rejected };
}

/**
 * Partitions tool plans into manageable shards.
 */
export function shardTools(tools: ToolPlan[]): ToolShard[] {
  if (tools.length === 0) return [];

  const shards: ToolShard[] = [];
  let currentShard: ToolPlan[] = [];
  let currentChars = 0;

  for (const tool of tools) {
    const toolCost = tool.name.length + (tool.description?.length || 0) + 50;

    if (
      currentShard.length >= MAX_TOOLS_PER_SHARD ||
      (currentChars + toolCost > SHARD_CHAR_BUDGET && currentShard.length > 0)
    ) {
      shards.push({
        shardIndex: shards.length,
        tools: currentShard,
        totalChars: currentChars,
      });
      currentShard = [];
      currentChars = 0;
    }

    currentShard.push(tool);
    currentChars += toolCost;
  }

  if (currentShard.length > 0) {
    shards.push({
      shardIndex: shards.length,
      tools: currentShard,
      totalChars: currentChars,
    });
  }

  return shards;
}
