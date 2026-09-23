/**
 * Types for Tool Pruning and Ranking (jev_rank_tools)
 */

export interface ToolParameterSchema {
  type?: string;
  description?: string;
  enum?: any[];
  const?: any;
  items?: any;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: {
    type?: string;
    properties?: Record<string, ToolParameterSchema>;
    required?: string[];
    [key: string]: any;
  } | Record<string, any>;
  [key: string]: any;
}

export interface ClosedParam {
  name: string;
  required: boolean;
  kind: "const" | "boolean" | "enum";
  value?: any;
  values?: string[];
  description?: string;
}

export interface ToolPlan {
  name: string;
  description: string;
  closedParams?: ClosedParam[];
}

export interface RankedTool {
  name: string;
  relevanceScore: number; // 0.0 to 1.0
  confidence: number;     // 0.0 to 1.0
  reason: string;
  closedParams?: ClosedParam[];
  selected: boolean;
}

export interface ToolRankOptions {
  task: string;
  tools?: ToolDefinition[];
  toolsJsonPath?: string;
  top?: number;
  threshold?: number;
  useJev?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  platform?: string;
}

export interface ToolRankMetrics {
  initialTools: number;
  selectedTools: number;
  prunedTools: number;
  tokensSaved: number;
  reductionPct: number;
  latencyMs: number;
  shardsCount: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  provider?: string;
}

export interface ToolRankResult {
  task: string;
  selected: RankedTool[];
  pruned: string[];
  metrics: ToolRankMetrics;
  fallbackUsed: boolean;
  timestamp: string;
}

/**
 * Strict regex for safe tool names (preventing prompt breakout/injection)
 */
export const SAFE_TOOL_NAME = /^[\p{L}\p{N}_.:/-]{1,128}$/u;
