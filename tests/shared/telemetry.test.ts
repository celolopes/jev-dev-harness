import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recordTelemetryEvent,
  getTelemetryEvents,
  getTelemetrySummary,
  clearTelemetryEvents,
  getTelemetryFilePath,
  telemetryEmitter,
  TelemetryEvent,
} from "../../src/shared/telemetry.js";

describe("Telemetry Module", () => {
  const tempTelemetryFile = path.join(os.tmpdir(), `jev-test-telemetry-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const previousEnv = process.env.JEV_TELEMETRY_FILE;

  beforeAll(() => {
    process.env.JEV_TELEMETRY_FILE = tempTelemetryFile;
  });

  afterAll(() => {
    if (previousEnv) {
      process.env.JEV_TELEMETRY_FILE = previousEnv;
    } else {
      delete process.env.JEV_TELEMETRY_FILE;
    }
    if (fs.existsSync(tempTelemetryFile)) {
      try { fs.unlinkSync(tempTelemetryFile); } catch {}
    }
  });

  beforeEach(() => {
    clearTelemetryEvents();
  });

  afterEach(() => {
    clearTelemetryEvents();
  });

  it("records context_rank events with proper fields", () => {
    const event = recordTelemetryEvent({
      type: "context_rank",
      task: "Optimize auth middleware",
      initialCandidates: 25,
      selectedFiles: 3,
      tokensSaved: 22000,
      reductionPct: 88.0,
      latencyMs: 140,
    });

    expect(event).not.toBeNull();
    expect(event?.id).toMatch(/^jev_/);
    expect(event?.type).toBe("context_rank");
    expect(event?.timestamp).toBeDefined();

    const events = getTelemetryEvents();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("context_rank");
    expect((events[0] as any).tokensSaved).toBe(22000);
  });

  it("records guard_check events for allowed and blocked commands", () => {
    recordTelemetryEvent({
      type: "guard_check",
      command: "git status",
      category: "read-only",
      allowed: true,
      riskLevel: "low",
      latencyMs: 1,
    });

    recordTelemetryEvent({
      type: "guard_check",
      command: "rm -rf /",
      category: "destructive-local",
      allowed: false,
      riskLevel: "critical",
      reason: "Dangerous root deletion",
      latencyMs: 2,
    });

    const events = getTelemetryEvents();
    expect(events.length).toBe(2);
    // Newest first
    expect(events[0].type).toBe("guard_check");
    expect((events[0] as any).allowed).toBe(false);
    expect(events[1].type).toBe("guard_check");
    expect((events[1] as any).allowed).toBe(true);
  });

  it("calculates comprehensive telemetry summary and dollar savings", () => {
    // Event 1: Context rank
    recordTelemetryEvent({
      type: "context_rank",
      task: "Refactor database queries",
      initialCandidates: 40,
      selectedFiles: 4,
      tokensSaved: 50000,
      reductionPct: 90.0,
      latencyMs: 150,
    });

    // Event 2: Guard check (allowed)
    recordTelemetryEvent({
      type: "guard_check",
      command: "npm test",
      category: "read-only",
      allowed: true,
      riskLevel: "low",
      latencyMs: 1,
    });

    // Event 3: Guard check (blocked)
    recordTelemetryEvent({
      type: "guard_check",
      command: "DROP DATABASE prod;",
      category: "destructive-local",
      allowed: false,
      riskLevel: "critical",
      latencyMs: 2,
    });

    // Event 4: Patch review
    recordTelemetryEvent({
      type: "patch_review",
      task: "Add auth checks",
      status: "APPROVED",
      riskScore: 15,
      filesCount: 2,
      additions: 30,
      deletions: 5,
      latencyMs: 200,
    });

    const summary = getTelemetrySummary();

    expect(summary.totalEvents).toBe(4);
    expect(summary.totalTokensSaved).toBe(50000);
    // 50k tokens at $3.00/M is $0.15
    expect(summary.estimatedDollarsSaved).toBe(0.15);
    expect(summary.byType.context_rank).toBe(1);
    expect(summary.byType.guard_check).toBe(2);
    expect(summary.byType.patch_review).toBe(1);

    expect(summary.guardStats.totalChecked).toBe(2);
    expect(summary.guardStats.allowed).toBe(1);
    expect(summary.guardStats.blocked).toBe(1);

    expect(summary.patchStats.totalAudited).toBe(1);
    expect(summary.patchStats.approved).toBe(1);
    expect(summary.patchStats.avgRiskScore).toBe(15);

    expect(summary.contextStats.totalRankings).toBe(1);
    expect(summary.contextStats.avgReductionPct).toBe(90);
  });

  it("emits events in real time to telemetryEmitter", () => {
    let receivedEvent: TelemetryEvent | null = null;
    const listener = (event: TelemetryEvent) => {
      receivedEvent = event;
    };

    telemetryEmitter.on("event", listener);

    recordTelemetryEvent({
      type: "context_rank",
      task: "SSE Test",
      initialCandidates: 10,
      selectedFiles: 2,
      tokensSaved: 10000,
      reductionPct: 80,
      latencyMs: 50,
    });

    telemetryEmitter.off("event", listener);

    expect(receivedEvent).not.toBeNull();
    expect((receivedEvent as any)?.task).toBe("SSE Test");
  });

  it("clears telemetry history cleanly", () => {
    recordTelemetryEvent({
      type: "guard_check",
      command: "echo test",
      category: "read-only",
      allowed: true,
      riskLevel: "low",
      latencyMs: 1,
    });

    expect(getTelemetryEvents().length).toBeGreaterThan(0);
    clearTelemetryEvents();
    expect(getTelemetryEvents().length).toBe(0);
  });
});
