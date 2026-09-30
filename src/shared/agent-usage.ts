import fs from "node:fs";
import { createHash } from "node:crypto";

export type AgentUsageFormat = "normalized" | "openai-chat" | "openai-responses" | "anthropic" | "gemini" | "cursor-event";
export interface AgentTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  reasoningOutputTokens: number | null;
}
type ObjectValue = Record<string, unknown>;
function obj(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid usage object");
  return value as ObjectValue;
}
function label(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error(`Invalid ${name}`);
  return value;
}
function counter(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid usage counter");
  return value as number;
}
function sum(values: Array<number | null>): number | null {
  if (values.some(value => value === null)) return null;
  const total = values.reduce<number>((acc, value) => acc + value!, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Usage counter overflow");
  return total;
}
export function unknownAgentUsage(): AgentTokenUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null,
    cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null };
}
export function addAgentUsage(a: AgentTokenUsage, b: AgentTokenUsage): AgentTokenUsage {
  const result = unknownAgentUsage();
  for (const key of Object.keys(result) as Array<keyof AgentTokenUsage>) result[key] = sum([a[key], b[key]]);
  return result;
}
export function zeroAgentUsage(): AgentTokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0,
    cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0 };
}

/** Normalize reported usage, never count text or infer a bill from model prices. */
export function normalizeAgentUsage(format: AgentUsageFormat, value: unknown): AgentTokenUsage {
  if (!["normalized", "openai-chat", "openai-responses", "anthropic", "gemini", "cursor-event"].includes(format)) throw new Error("Unsupported usage format");
  if (value === null) return unknownAgentUsage();
  const raw = obj(value);
  const result = unknownAgentUsage();
  switch (format) {
    case "normalized":
      for (const key of Object.keys(result) as Array<keyof AgentTokenUsage>) result[key] = counter(raw[key]);
      break;
    case "openai-chat":
    case "openai-responses": {
      const chat = format === "openai-chat";
      result.inputTokens = counter(raw[chat ? "prompt_tokens" : "input_tokens"]);
      result.outputTokens = counter(raw[chat ? "completion_tokens" : "output_tokens"]);
      result.totalTokens = counter(raw.total_tokens);
      const inputDetails = raw[chat ? "prompt_tokens_details" : "input_tokens_details"];
      const outputDetails = raw[chat ? "completion_tokens_details" : "output_tokens_details"];
      result.cachedInputTokens = inputDetails === undefined ? null : counter(obj(inputDetails).cached_tokens);
      result.reasoningOutputTokens = outputDetails === undefined ? null : counter(obj(outputDetails).reasoning_tokens);
      break;
    }
    case "anthropic":
      result.cachedInputTokens = counter(raw.cache_read_input_tokens);
      result.cacheWriteInputTokens = counter(raw.cache_creation_input_tokens);
      result.inputTokens = sum([counter(raw.input_tokens), result.cachedInputTokens, result.cacheWriteInputTokens]);
      result.outputTokens = counter(raw.output_tokens);
      break;
    case "gemini":
      result.inputTokens = counter(raw.promptTokenCount);
      result.totalTokens = counter(raw.totalTokenCount);
      // The provider total includes thinking. Preserve an unknown breakdown.
      result.outputTokens = result.inputTokens === null || result.totalTokens === null
        ? null : result.totalTokens - result.inputTokens;
      result.cachedInputTokens = counter(raw.cachedContentTokenCount);
      result.reasoningOutputTokens = counter(raw.thoughtsTokenCount);
      if (raw.toolUsePromptTokenCount !== undefined && counter(raw.toolUsePromptTokenCount)! > 0) {
        throw new Error("Gemini tool-use input accounting requires an explicit normalized breakdown");
      }
      if (raw.candidatesTokenCount !== undefined && result.outputTokens !== null) {
        const candidates = counter(raw.candidatesTokenCount)!;
        if (candidates > result.outputTokens || (result.reasoningOutputTokens !== null
          && candidates + result.reasoningOutputTokens !== result.outputTokens)) throw new Error("Inconsistent Gemini usage");
      }
      break;
    case "cursor-event": {
      if (raw.isTokenBasedCall === false || raw.tokenUsage === undefined) return result;
      const tokens = obj(raw.tokenUsage);
      result.cachedInputTokens = counter(tokens.cacheReadTokens);
      result.cacheWriteInputTokens = counter(tokens.cacheWriteTokens);
      result.inputTokens = sum([counter(tokens.inputTokens), result.cachedInputTokens, result.cacheWriteInputTokens]);
      result.outputTokens = counter(tokens.outputTokens);
      break;
    }
    default: throw new Error("Unsupported usage format");
  }
  const computed = sum([result.inputTokens, result.outputTokens]);
  if (result.totalTokens === null && computed !== null) result.totalTokens = computed;
  if (computed !== null && result.totalTokens !== computed) throw new Error("Inconsistent total token usage");
  for (const value of Object.values(result)) counter(value);
  if (result.inputTokens !== null && ((result.cachedInputTokens ?? 0) + (result.cacheWriteInputTokens ?? 0) > result.inputTokens)) {
    throw new Error("Cache usage exceeds input tokens");
  }
  if (result.outputTokens !== null && (result.reasoningOutputTokens ?? 0) > result.outputTokens) throw new Error("Reasoning exceeds output tokens");
  return result;
}

function cost(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid reported cost");
  return value;
}

/** Bridge contract for hooks, IDE extensions, CLI exporters and BYOK clients. */
export function parseAgentUsage(value: unknown) {
  const raw = obj(value);
  if (raw.schemaVersion !== 1 || raw.kind !== "agent_usage" || raw.status !== "completed") throw new Error("Unsupported or incomplete agent usage run");
  if (raw.coverage !== "complete" && raw.coverage !== "partial") throw new Error("Declare agent usage coverage");
  if (raw.includesJevUsage !== false) throw new Error("Agent records must exclude separately recorded Jev calls");
  if (typeof raw.jevCallsObserved !== "boolean") throw new Error("Declare whether Jev was used");
  const startedAt = label(raw.startedAt, "start time"), endedAt = label(raw.endedAt, "end time");
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt)) || Date.parse(endedAt) < Date.parse(startedAt)) throw new Error("Invalid usage interval");
  if (!Array.isArray(raw.events) || !raw.events.length) throw new Error("Run requires request events; absence of data is not zero");
  const model = label(raw.model, "model");
  const seen = new Set<string>();
  let totals = zeroAgentUsage(), reportedTotals = zeroAgentUsage(), missingUsage = 0, costedRequests = 0;
  let reportedCostUsd: number | null = null;
  const events = raw.events.map(item => {
    const event = obj(item);
    const requestId = label(event.requestId, "request ID");
    if (seen.has(requestId)) throw new Error("Duplicate request ID; export one final usage record per request");
    seen.add(requestId);
    if (event.model !== undefined && event.model !== model) throw new Error("Split runs with different models into separate intervals");
    const provider = label(event.provider, "provider");
    const format = label(event.format, "usage format") as AgentUsageFormat;
    if (format === "cursor-event" && event.usage !== null && obj(event.usage).model !== undefined
        && obj(event.usage).model !== model) throw new Error("Cursor event model differs from interval model");
    const usage = normalizeAgentUsage(format, event.usage);
    totals = addAgentUsage(totals, usage);
    if (usage.totalTokens === null) missingUsage++;
    // Known reported totals are explicitly partial, never used as task totals.
    for (const key of Object.keys(reportedTotals) as Array<keyof AgentTokenUsage>) {
      reportedTotals[key] = sum([reportedTotals[key], usage[key] ?? 0]);
    }
    const reported = format === "cursor-event" && event.usage !== null && obj(event.usage).chargedCents !== undefined
      ? cost(obj(event.usage).chargedCents)! / 100 : cost(event.costUsd);
    if (reported !== null) {
      reportedCostUsd = (reportedCostUsd ?? 0) + reported;
      if (!Number.isFinite(reportedCostUsd)) throw new Error("Reported cost overflow");
      costedRequests++;
    }
    return { requestId, provider, format: "normalized" as const, usage, costUsd: reported };
  });
  const usage = raw.coverage === "complete" ? totals : unknownAgentUsage();
  return { schemaVersion: 1 as const, kind: "agent_usage" as const, status: "completed" as const,
    harness: label(raw.harness, "harness"), sessionId: label(raw.sessionId, "session ID"),
    turnId: label(raw.turnId, "turn ID"), initialRevision: label(raw.initialRevision, "initial revision"),
    model, effort: label(raw.effort, "reasoning configuration"), startedAt, endedAt,
    jevCallsObserved: raw.jevCallsObserved, includesJevUsage: false as const,
    coverage: raw.coverage, events, usage, reportedUsage: reportedTotals, missingUsage,
    costCoverage: { costedRequests, requests: events.length }, reportedCostUsd,
    verification: "reported_usage_not_independently_verified" };
}

export function importAgentUsage(file: string) {
  if (fs.statSync(file).size > 128 * 1024 * 1024) throw new Error("Measurement input exceeds 128 MiB");
  const content = fs.readFileSync(file, "utf8");
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw new Error("Invalid JSON in agent usage file"); }
  const run = parseAgentUsage(raw);
  return { ...run, source: { sha256: createHash("sha256").update(content).digest("hex"), format: "agent_usage_v1" } };
}

/** Only allowlisted metadata/counters reach the output; never overwrite an export. */
export function exportAgentUsage(file: string, run: unknown): void {
  const parsed = parseAgentUsage(run);
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
