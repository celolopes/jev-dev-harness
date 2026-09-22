import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";

export type TelemetryEventType =
  | "context_rank"
  | "guard_check"
  | "patch_review"
  | "lint_semantic";

export interface BaseTelemetryEvent {
  id: string;
  timestamp: string; // ISO 8601 string
  type: TelemetryEventType;
  latencyMs: number;
}

export interface ContextRankEvent extends BaseTelemetryEvent {
  type: "context_rank";
  task: string;
  initialCandidates: number;
  selectedFiles: number;
  tokensSaved: number;
  reductionPct: number;
}

export interface GuardCheckEvent extends BaseTelemetryEvent {
  type: "guard_check";
  command: string;
  category: string;
  allowed: boolean;
  riskLevel: string;
  reason?: string;
}

export interface PatchReviewEvent extends BaseTelemetryEvent {
  type: "patch_review";
  task: string;
  status: string; // 'APPROVED' | 'ESCALATE_REVIEWER' | 'BLOCK_HUMAN_REQUIRED'
  riskScore: number;
  filesCount: number;
  additions: number;
  deletions: number;
}

export interface LintSemanticEvent extends BaseTelemetryEvent {
  type: "lint_semantic";
  status: string;
  passed: boolean;
  violationsCount: number;
}

export type TelemetryEvent =
  | ContextRankEvent
  | GuardCheckEvent
  | PatchReviewEvent
  | LintSemanticEvent;

export interface TelemetrySummary {
  totalEvents: number;
  totalTokensSaved: number;
  estimatedDollarsSaved: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  byType: {
    context_rank: number;
    guard_check: number;
    patch_review: number;
    lint_semantic: number;
  };
  guardStats: {
    totalChecked: number;
    blocked: number;
    allowed: number;
  };
  patchStats: {
    totalAudited: number;
    approved: number;
    escalated: number;
    blocked: number;
    avgRiskScore: number;
  };
  contextStats: {
    totalRankings: number;
    avgReductionPct: number;
  };
}

export interface TelemetryMetrics {
  initialCandidates: number;
  filteredCandidates: number;
  evaluatedByJev: number;
  tokensSent: number;
  tokensReceived: number;
  latencyMs: number;
  selectedCount: number;
  confidence: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  provider?: string;
}

export class TelemetryCollector {
  private startTime: number = Date.now();
  private endTime?: number;

  initialCandidates = 0;
  filteredCandidates = 0;
  evaluatedByJev = 0;
  tokensSent = 0;
  tokensReceived = 0;
  selectedCount = 0;
  confidences: number[] = [];
  cacheHits = 0;
  cacheMisses = 0;
  errors = 0;
  fallbackUsed = false;
  fallbackReason?: string;
  provider?: string;

  start(): void {
    this.startTime = Date.now();
    this.endTime = undefined;
  }

  stop(): void {
    this.endTime = Date.now();
  }

  addConfidence(val: number): void {
    if (typeof val === "number" && !isNaN(val)) {
      this.confidences.push(val);
    }
  }

  addTokens(inputTokens = 0, outputTokens = 0): void {
    this.tokensSent += inputTokens;
    this.tokensReceived += outputTokens;
  }

  recordFallback(reason: string): void {
    this.fallbackUsed = true;
    this.fallbackReason = reason;
  }

  toMetrics(): TelemetryMetrics {
    const elapsed = this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime;
    const avgConfidence =
      this.confidences.length > 0
        ? this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length
        : 0;

    return {
      initialCandidates: this.initialCandidates,
      filteredCandidates: this.filteredCandidates,
      evaluatedByJev: this.evaluatedByJev,
      tokensSent: this.tokensSent,
      tokensReceived: this.tokensReceived,
      latencyMs: elapsed,
      selectedCount: this.selectedCount,
      confidence: Number(avgConfidence.toFixed(4)),
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      errors: this.errors,
      fallbackUsed: this.fallbackUsed,
      fallbackReason: this.fallbackReason,
      provider: this.provider,
    };
  }

  toFormattedString(): string {
    const m = this.toMetrics();
    return [
      `Telemetry Summary:`,
      `  • Initial candidates:   ${m.initialCandidates}`,
      `  • Filtered candidates:  ${m.filteredCandidates}`,
      `  • Evaluated by Jev:     ${m.evaluatedByJev}`,
      `  • Tokens (in/out):      ${m.tokensSent} / ${m.tokensReceived}`,
      `  • Selected count:       ${m.selectedCount}`,
      `  • Avg confidence:       ${(m.confidence * 100).toFixed(1)}%`,
      `  • Cache hits / misses:  ${m.cacheHits} / ${m.cacheMisses}`,
      `  • Latency:              ${m.latencyMs}ms`,
      `  • Fallback used:        ${m.fallbackUsed ? `YES (${m.fallbackReason})` : "NO (Jev Active)"}`,
    ].join("\n");
  }
}

export const telemetryEmitter = new EventEmitter();

/**
 * Get the path to the global telemetry file ~/.jev-dev/telemetry.jsonl
 */
export function getTelemetryFilePath(): string {
  const homeDir = os.homedir();
  const dir = path.join(homeDir, ".jev-dev");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignored if unable to create directory
    }
  }
  return path.join(dir, "telemetry.jsonl");
}

/**
 * Safely record a telemetry event to ~/.jev-dev/telemetry.jsonl
 * Non-blocking, never throws or disrupts calling code.
 */
export function recordTelemetryEvent(
  eventData: Omit<ContextRankEvent, "id" | "timestamp"> |
    Omit<GuardCheckEvent, "id" | "timestamp"> |
    Omit<PatchReviewEvent, "id" | "timestamp"> |
    Omit<LintSemanticEvent, "id" | "timestamp">
): TelemetryEvent | null {
  try {
    const fullEvent: TelemetryEvent = {
      ...eventData,
      id: `jev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    } as TelemetryEvent;

    const filePath = getTelemetryFilePath();
    const line = JSON.stringify(fullEvent) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");

    // Emit in-process for any live SSE listener
    telemetryEmitter.emit("event", fullEvent);

    return fullEvent;
  } catch (err) {
    // Fail silently so MCP / CLI operations are never interrupted
    return null;
  }
}

/**
 * Read recent telemetry events (reverse chronological)
 */
export function getTelemetryEvents(limit = 100): TelemetryEvent[] {
  try {
    const filePath = getTelemetryFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.trim().length > 0);

    const events: TelemetryEvent[] = [];
    // Read from newest to oldest
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      try {
        const line = lines[i];
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (parsed && parsed.type && parsed.timestamp) {
          events.push(parsed as TelemetryEvent);
        }
      } catch {
        // Skip corrupted line
      }
    }

    return events;
  } catch {
    return [];
  }
}

/**
 * Compute aggregate metrics and summary stats from recorded telemetry
 */
export function getTelemetrySummary(): TelemetrySummary {
  const events = getTelemetryEvents(1000); // Sample up to 1000 recent events

  let totalTokensSaved = 0;
  let totalLatency = 0;
  const latencies: number[] = [];

  const byType = {
    context_rank: 0,
    guard_check: 0,
    patch_review: 0,
    lint_semantic: 0,
  };

  const guardStats = {
    totalChecked: 0,
    blocked: 0,
    allowed: 0,
  };

  const patchStats = {
    totalAudited: 0,
    approved: 0,
    escalated: 0,
    blocked: 0,
    totalRiskScore: 0,
    avgRiskScore: 0,
  };

  const contextStats = {
    totalRankings: 0,
    totalReductionPct: 0,
    avgReductionPct: 0,
  };

  for (const event of events) {
    totalLatency += event.latencyMs || 0;
    if (typeof event.latencyMs === "number") {
      latencies.push(event.latencyMs);
    }

    if (event.type === "context_rank") {
      byType.context_rank++;
      totalTokensSaved += event.tokensSaved || 0;
      contextStats.totalRankings++;
      contextStats.totalReductionPct += event.reductionPct || 0;
    } else if (event.type === "guard_check") {
      byType.guard_check++;
      guardStats.totalChecked++;
      if (event.allowed) {
        guardStats.allowed++;
      } else {
        guardStats.blocked++;
      }
    } else if (event.type === "patch_review") {
      byType.patch_review++;
      patchStats.totalAudited++;
      patchStats.totalRiskScore += event.riskScore || 0;
      if (event.status === "APPROVED") patchStats.approved++;
      else if (event.status === "BLOCK_HUMAN_REQUIRED") patchStats.blocked++;
      else patchStats.escalated++;
    } else if (event.type === "lint_semantic") {
      byType.lint_semantic++;
    }
  }

  // Calculate averages & percentiles
  const totalEvents = events.length;
  const avgLatencyMs = totalEvents > 0 ? Math.round(totalLatency / totalEvents) : 0;

  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95LatencyMs = latencies.length > 0 ? (latencies[Math.min(p95Index, latencies.length - 1)] ?? 0) : 0;

  if (patchStats.totalAudited > 0) {
    patchStats.avgRiskScore = Math.round((patchStats.totalRiskScore / patchStats.totalAudited) * 10) / 10;
  }

  if (contextStats.totalRankings > 0) {
    contextStats.avgReductionPct = Math.round((contextStats.totalReductionPct / contextStats.totalRankings) * 10) / 10;
  }

  // $3.00 per million input tokens (standard Claude 3.5 Sonnet / GPT-4o input cost)
  const estimatedDollarsSaved = Math.round((totalTokensSaved / 1_000_000) * 3.0 * 100) / 100;

  return {
    totalEvents,
    totalTokensSaved,
    estimatedDollarsSaved,
    avgLatencyMs,
    p95LatencyMs,
    byType,
    guardStats,
    patchStats: {
      totalAudited: patchStats.totalAudited,
      approved: patchStats.approved,
      escalated: patchStats.escalated,
      blocked: patchStats.blocked,
      avgRiskScore: patchStats.avgRiskScore,
    },
    contextStats: {
      totalRankings: contextStats.totalRankings,
      avgReductionPct: contextStats.avgReductionPct,
    },
  };
}

/**
 * Clear all recorded telemetry events
 */
export function clearTelemetryEvents(): void {
  try {
    const filePath = getTelemetryFilePath();
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "", "utf-8");
    }
  } catch {
    // Ignored
  }
}
