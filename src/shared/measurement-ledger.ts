import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const context = new AsyncLocalStorage<string>();

export function measurementPath(runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) throw new Error("Invalid measurement run ID");
  const dir = process.env.JEV_MEASUREMENT_DIR || path.join(os.homedir(), ".jev-dev", "measurements");
  return path.join(dir, `${runId}.jsonl`);
}

function append(runId: string, record: Record<string, unknown>): void {
  const file = measurementPath(runId);
  if (!fs.existsSync(file)) throw new Error("Begin the measurement run before collecting usage");
  const last = fs.readFileSync(file, "utf8").trim().split("\n").at(-1);
  if (last && JSON.parse(last).kind === "run_finished") throw new Error("Measurement run already finished");
  fs.appendFileSync(file, JSON.stringify({ ...record, runId, timestamp: new Date().toISOString() }) + "\n");
}

export function beginMeasurement(runId: string): string {
  const file = measurementPath(runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: "run_started", runId,
    timestamp: new Date().toISOString() }) + "\n", { flag: "wx" });
  return file;
}

export function finishMeasurement(runId: string): string {
  const rows = fs.readFileSync(measurementPath(runId), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const pending = new Set<string>();
  for (const row of rows) {
    if (row.kind === "request_started") pending.add(row.requestId);
    if (row.kind === "request_completed") pending.delete(row.requestId);
  }
  if (pending.size) throw new Error("Wait for pending model calls before finishing measurement");
  append(runId, { kind: "run_finished" });
  return measurementPath(runId);
}

export function withMeasurementRun<T>(runId: string | undefined, action: () => Promise<T>): Promise<T> {
  if (runId) measurementPath(runId);
  return context.run(runId ?? "", action);
}

/** Opt-in collection. A start without an end exposes missing/failed usage. */
export function startUsageMeasurement(provider: string, model: string) {
  const runId = context.getStore() || process.env.JEV_MEASUREMENT_RUN_ID;
  if (!runId) return undefined;
  const requestId = randomUUID();
  append(runId, { kind: "request_started", requestId, provider, model });
  return (usage: { inputTokens: number; outputTokens: number; costUsd?: number } | null) => {
    append(runId, { kind: "request_completed", requestId, provider, model,
      usage, coverage: "validated_response_only; unreported retries excluded" });
  };
}
