import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { importAgentUsage, addAgentUsage, zeroAgentUsage } from "./agent-usage.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as JsonObject;
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
};
const count = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid ${label}`);
  return value as number;
};
const hash = (content: string) => createHash("sha256").update(content).digest("hex");

function read(file: string): { content: string; sha256: string } {
  if (fs.statSync(file).size > 128 * 1024 * 1024) throw new Error("Measurement input exceeds 128 MiB");
  const content = fs.readFileSync(file, "utf8");
  return { content, sha256: hash(content) };
}

function json(content: string, label: string): JsonObject {
  try { return object(JSON.parse(content), label); }
  catch { throw new Error(`Invalid JSON in ${label}`); }
}

export interface CodexTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number | null;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

function usage(value: unknown): CodexTokenUsage {
  const raw = object(value, "Codex token usage");
  const result = {
    inputTokens: count(raw.input_tokens, "input_tokens"),
    cachedInputTokens: count(raw.cached_input_tokens, "cached_input_tokens"),
    cacheWriteInputTokens: raw.cache_write_input_tokens === undefined ? null : count(raw.cache_write_input_tokens, "cache_write_input_tokens"),
    outputTokens: count(raw.output_tokens, "output_tokens"),
    reasoningOutputTokens: count(raw.reasoning_output_tokens, "reasoning_output_tokens"),
    totalTokens: count(raw.total_tokens, "total_tokens"),
  };
  if (result.inputTokens + result.outputTokens !== result.totalTokens
      || result.cachedInputTokens > result.inputTokens || result.reasoningOutputTokens > result.outputTokens) {
    throw new Error("Inconsistent Codex token counters");
  }
  return result;
}

const zero = (): CodexTokenUsage => ({ inputTokens: 0, cachedInputTokens: 0,
  cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 });
const tokenKeys = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"] as const;

function difference(end: CodexTokenUsage, start: CodexTokenUsage): CodexTokenUsage {
  const result = zero();
  for (const key of tokenKeys) {
    result[key] = end[key] - start[key];
    if (result[key] < 0) throw new Error("Codex cumulative counters reset; interval cannot be compared");
  }
  result.cacheWriteInputTokens = end.cacheWriteInputTokens === null || start.cacheWriteInputTokens === null
    ? null : end.cacheWriteInputTokens - start.cacheWriteInputTokens;
  if (result.cacheWriteInputTokens !== null && result.cacheWriteInputTokens < 0) throw new Error("Codex cache-write counter reset");
  return result;
}

/** Use one cumulative difference; repeated token_count snapshots are not requests. */
function parseCodexRollout(file: string) {
  const source = read(file);
  let metadata: JsonObject | undefined;
  let latest = zero();
  let snapshotSeen = false;
  let active: string | undefined;
  const turns = new Map<string, { before: CodexTokenUsage; after?: CodexTokenUsage;
    snapshots: number; model?: string; effort?: string; complete: boolean; startedAt: string;
    endedAt?: string; invalid: boolean; jevCallsObserved: boolean }>();
  for (const [index, line] of source.content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const event = json(line, `rollout line ${index + 1}`);
    const payload = object(event.payload, `rollout payload at line ${index + 1}`);
    if (event.type === "session_meta") {
      if (metadata) throw new Error("Duplicate session metadata");
      metadata = payload;
    }
    if (event.type === "event_msg" && payload.type === "task_started") {
      const turnId = text(payload.turn_id, "turn_id");
      if (active || turns.has(turnId)) throw new Error("Overlapping or duplicate Codex turns");
      active = turnId;
      turns.set(turnId, { before: { ...latest }, snapshots: 0, complete: false,
        startedAt: text(event.timestamp, "task timestamp"),
        invalid: !snapshotSeen && Boolean(metadata?.parent_thread_id), jevCallsObserved: false });
    }
    if (event.type === "turn_context" && active) {
      const turn = turns.get(active)!;
      const model = text(payload.model, "Codex model");
      if (turn.model && turn.model !== model) turn.invalid = true;
      turn.model = model;
      const effort = typeof payload.effort === "string" ? payload.effort : "not_reported";
      if (turn.effort && turn.effort !== effort) turn.invalid = true;
      turn.effort = effort;
    }
    if (event.type === "response_item" && active && payload.type === "function_call"
        && typeof payload.name === "string" && /^(mcp__jev|jev_|tools\.mcp__jev)/.test(payload.name)) {
      turns.get(active)!.jevCallsObserved = true;
    }
    if (event.type === "event_msg" && payload.type === "token_count" && payload.info) {
      const next = usage(object(payload.info, "token info").total_token_usage);
      if (active) {
        const turn = turns.get(active)!;
        try { difference(next, latest); } catch { turn.invalid = true; }
        turn.after = next;
        turn.snapshots++;
      }
      latest = next;
      snapshotSeen = true;
    }
    if (event.type === "event_msg" && payload.type === "task_complete") {
      if (payload.turn_id !== active) throw new Error("Unmatched Codex task completion");
      const turn = turns.get(active!)!;
      turn.complete = true;
      turn.endedAt = text(event.timestamp, "completion timestamp");
      active = undefined;
    }
  }
  if (!metadata) throw new Error("Missing Codex session metadata");
  return { metadata, turns, source };
}

function selectCodexInterval(parsed: ReturnType<typeof parseCodexRollout>, requestedTurnId?: string) {
  const { metadata, turns, source } = parsed;
  if (!requestedTurnId && turns.size !== 1) throw new Error("Specify turnId for a rollout containing multiple turns");
  const turnId = requestedTurnId ?? [...turns.keys()][0]!;
  const turn = turns.get(turnId);
  if (!turn?.complete || !turn.after || !turn.snapshots || !turn.model || turn.invalid) {
    throw new Error("Incomplete, reset, forked or ambiguous Codex usage interval");
  }
  const git = object(metadata.git, "Codex initial Git revision");
  const sessionId = text(metadata.id, "session ID");
  return { harness: "codex", sessionId, turnId, initialRevision: text(git.commit_hash, "initial commit hash"),
    model: turn.model, effort: turn.effort, usage: difference(turn.after, turn.before),
    startedAt: turn.startedAt, endedAt: turn.endedAt!, jevCallsObserved: turn.jevCallsObserved,
    source: { sha256: source.sha256, format: "codex_rollout_jsonl", tokenSnapshots: turn.snapshots } };
}

export function importCodexUsage(file: string, requestedTurnId?: string) {
  return selectCodexInterval(parseCodexRollout(file), requestedTurnId);
}

/** Discover recent local intervals without displaying prompts or other chat content. */
export function listCodexUsage(sessionsPath: string, repoPath: string, limit = 20, includeInternal = false) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Usage list limit must be 1–100");
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) files.push(file);
    }
  };
  visit(sessionsPath);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const normalize = (file: string) => process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  const intervals: Array<ReturnType<typeof importCodexUsage> & { rolloutPath: string }> = [];
  let filesScanned = 0, unavailableIntervals = 0, internalIntervalsExcluded = 0;
  for (const file of files) {
    if (filesScanned >= 200) break;
    filesScanned++;
    let parsed: ReturnType<typeof parseCodexRollout>;
    try { parsed = parseCodexRollout(file); } catch { unavailableIntervals++; continue; }
    const meta = parsed.metadata;
    if (typeof meta.cwd !== "string" || normalize(meta.cwd) !== normalize(repoPath)) continue;
    const turnIds = [...parsed.turns.entries()].filter(([, turn]) => turn.complete).map(([id]) => id);
    for (const turnId of turnIds.reverse()) {
      try {
        const run = selectCodexInterval(parsed, turnId);
        if (!includeInternal && run.model === "codex-auto-review") { internalIntervalsExcluded++; continue; }
        intervals.push({ ...run, rolloutPath: file });
      }
      catch { unavailableIntervals++; }
    }
  }
  intervals.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { intervals: intervals.slice(0, limit), filesScanned, unavailableIntervals, internalIntervalsExcluded,
    coverage: "up_to_200_recent_rollout_files; repository cwd filter; unimportable intervals excluded",
    baselineStatus: "not_inferred; select equivalent validated runs" };
}

function importHarnessUsage(file: string, runId: string) {
  const source = read(file);
  const rows = source.content.split(/\r?\n/).filter(line => line.trim()).map((line, i) => json(line, `ledger line ${i + 1}`));
  if (rows[0]?.kind !== "run_started" || rows.at(-1)?.kind !== "run_finished"
      || rows.some(row => row.runId !== runId)) throw new Error("Incomplete or mismatched Jev measurement ledger");
  const pending = new Set<string>();
  const completed = new Set<string>();
  let inputTokens = 0, outputTokens = 0, missingUsage = 0, costedRequests = 0;
  let reportedCostUsd: number | null = null;
  for (const row of rows.slice(1, -1)) {
    const requestId = text(row.requestId, "ledger request ID");
    if (row.kind === "request_started") {
      if (pending.has(requestId) || completed.has(requestId)) throw new Error("Duplicate measurement request ID");
      pending.add(requestId);
    } else if (row.kind === "request_completed") {
      if (!pending.delete(requestId)) throw new Error("Unmatched measurement request completion");
      completed.add(requestId);
      if (row.usage === null) { missingUsage++; continue; }
      const value = object(row.usage, "Jev usage");
      inputTokens += count(value.inputTokens, "Jev input tokens");
      outputTokens += count(value.outputTokens, "Jev output tokens");
      if (value.costUsd !== undefined) {
        if (typeof value.costUsd !== "number" || !Number.isFinite(value.costUsd) || value.costUsd < 0) throw new Error("Invalid Jev reported cost");
        reportedCostUsd = (reportedCostUsd ?? 0) + value.costUsd;
        costedRequests++;
      }
    } else throw new Error("Unknown Jev ledger event");
  }
  if (pending.size) throw new Error("Jev measurement has unfinished requests");
  return { runId, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    missingUsage, requests: completed.size, costedRequests, reportedCostUsd,
    sourceSha256: source.sha256, coverage: "validated_responses_only" };
}

function billing(file: string | undefined, fingerprint: string) {
  if (!file) return null;
  const source = read(file);
  const receipt = json(source.content, "billing receipt");
  if (receipt.runFingerprint !== fingerprint || receipt.currency !== "USD"
      || receipt.coverage !== "all_agent_and_jev_costs" || typeof receipt.amount !== "number"
      || !Number.isFinite(receipt.amount) || receipt.amount < 0) throw new Error("Invalid or incomplete billing receipt");
  return { usd: receipt.amount, sourceReference: text(receipt.sourceReference, "billing source reference"),
    sourceSha256: source.sha256, verification: "imported_receipt_not_independently_verified" };
}

/** Comparison conditions and quality are explicit attestations, not inferred from tokens. */
export function compareUsageRuns(manifestFile: string) {
  const start = Date.now();
  const manifestSource = read(manifestFile);
  const manifest = json(manifestSource.content, "comparison manifest");
  if (manifest.schemaVersion !== 1 || manifest.allRelatedSessionsIncluded !== true) throw new Error("Declare schemaVersion 1 and allRelatedSessionsIncluded");
  const taskId = text(manifest.taskId, "task ID");
  const environmentId = text(manifest.environmentId, "controlled environment ID");
  const initialRevision = text(manifest.initialRevision, "initial Git revision");
  const resolve = (value: unknown) => path.resolve(path.dirname(manifestFile), text(value, "input path"));
  function importRun(raw: unknown, mode: "without_jev" | "with_jev") {
    const spec = object(raw, mode);
    if (!Array.isArray(spec.rollouts) || spec.rollouts.length === 0) throw new Error("Run requires at least one rollout");
    const runs = spec.rollouts.map(item => {
      const ref = object(item, "rollout reference");
      if (ref.format === "agent_usage_v1") {
        const run = importAgentUsage(resolve(ref.path));
        if (ref.turnId !== undefined && ref.turnId !== run.turnId) throw new Error("Agent interval ID differs from reference");
        return run;
      }
      if (ref.format !== undefined && ref.format !== "codex_rollout_jsonl") throw new Error("Unsupported agent import format");
      return importCodexUsage(resolve(ref.path), ref.turnId === undefined ? undefined : text(ref.turnId, "turn ID"));
    });
    if (runs.some(run => run.initialRevision !== initialRevision)) throw new Error("Initial Git revision differs from comparison baseline");
    if (mode === "without_jev" && (spec.jevDisabled !== true || runs.some(run => run.jevCallsObserved))) throw new Error("Baseline must have Jev disabled");
    const validationSource = read(resolve(spec.validationReceipt));
    const validation = json(validationSource.content, "validation receipt");
    const identities = runs.map(run => `${run.sessionId}:${run.turnId}`).sort();
    if (new Set(identities).size !== identities.length) throw new Error("Duplicate rollout interval");
    const validationRunIds = validation.runIds;
    if (validation.taskId !== taskId || validation.passed !== true || !Array.isArray(validationRunIds)
        || JSON.stringify([...validationRunIds].sort()) !== JSON.stringify(identities)) throw new Error("Validation receipt does not confirm this task/run");
    const criterionId = text(validation.criterionId, "quality criterion");
    const evidenceReference = text(validation.evidenceReference, "validation evidence reference");
    let totals = zeroAgentUsage();
    const requestIdentities = new Set<string>();
    for (const run of runs) {
      totals = addAgentUsage(totals, run.usage);
      if ("events" in run) for (const event of run.events) {
        const identity = `${event.provider}:${event.requestId}`;
        if (requestIdentities.has(identity)) throw new Error("Duplicate request across imported intervals");
        requestIdentities.add(identity);
      }
    }
    const harness = mode === "with_jev" && spec.ledgerPath
      ? importHarnessUsage(resolve(spec.ledgerPath), text(spec.measurementRunId, "measurement run ID")) : null;
    const fingerprint = hash(JSON.stringify({ identities, sources: runs.map(run => run.source.sha256),
      harnessSha256: harness?.sourceSha256 ?? null }));
    const cost = billing(spec.billingReceipt === undefined ? undefined : resolve(spec.billingReceipt), fingerprint);
    return { mode, fingerprint, runs, agentUsage: totals, harnessUsage: harness, cost,
      validation: { criterionId, evidenceReference, sourceSha256: validationSource.sha256,
        verification: "imported_receipt_not_independently_verified" },
      harnessCoverageDeclared: spec.allJevCallsRecorded === true };
  }
  const baseline = importRun(manifest.baseline, "without_jev");
  const withJev = importRun(manifest.withJev, "with_jev");
  const baselineIds = new Set(baseline.runs.map(run => `${run.sessionId}:${run.turnId}`));
  if (withJev.runs.some(run => baselineIds.has(`${run.sessionId}:${run.turnId}`))) throw new Error("Cannot compare a run to itself");
  if (withJev.runs.some(run => baseline.runs.some(other => other.sessionId === run.sessionId))) {
    throw new Error("Use independent Codex/agent sessions; reused chat history is not a controlled baseline");
  }
  const baselineRequests = new Set(baseline.runs.flatMap(run => "events" in run
    ? run.events.map(event => `${event.provider}:${event.requestId}`) : []));
  if (withJev.runs.some(run => "events" in run && run.events.some(event => baselineRequests.has(`${event.provider}:${event.requestId}`)))) {
    throw new Error("Cannot compare the same provider request across runs");
  }
  if (baseline.runs[0]!.harness !== withJev.runs[0]!.harness
      || baseline.runs[0]!.model !== withJev.runs[0]!.model || baseline.runs[0]!.effort !== withJev.runs[0]!.effort
      || baseline.validation.criterionId !== withJev.validation.criterionId) throw new Error("Model, reasoning effort or validation criteria differ");
  const agentTokenDelta = baseline.agentUsage.totalTokens === null || withJev.agentUsage.totalTokens === null
    ? null : baseline.agentUsage.totalTokens - withJev.agentUsage.totalTokens;
  const harness = withJev.harnessUsage;
  const pipelineTokenDelta = agentTokenDelta !== null && harness && harness.missingUsage === 0 && withJev.harnessCoverageDeclared
    ? agentTokenDelta - harness.totalTokens : null;
  const moneyDeltaUsd = baseline.cost && withJev.cost ? baseline.cost.usd - withJev.cost.usd : null;
  const comparisonId = hash(JSON.stringify([taskId, environmentId, baseline.fingerprint, withJev.fingerprint]));
  const summaryMessage = [
    "### ⚡ Eficiência Jev",
    `- Tarefa: ${taskId}; harness: ${baseline.runs[0]!.harness}; consumo do agente sem/com Jev: ${baseline.agentUsage.totalTokens ?? "não informado"}/${withJev.agentUsage.totalTokens ?? "não informado"} tokens; diferença: ${agentTokenDelta ?? "não medida"}.`,
    `- Cache de entrada sem/com Jev: ${baseline.agentUsage.cachedInputTokens ?? "não informado"}/${withJev.agentUsage.cachedInputTokens ?? "não informado"} tokens (já incluídos na entrada).`,
    `- Jev adicional: ${harness ? `${harness.totalTokens} tokens reportados; ${harness.missingUsage} chamadas sem uso` : "não informado"}; diferença líquida dos tokens reportados: ${pipelineTokenDelta ?? "não medida"}.`,
    `- Diferença de custo: ${moneyDeltaUsd === null ? "não medida; custo completo não informado para os dois lados" : `US$ ${moneyDeltaUsd} conforme recibos importados`}.`,
    "- Cobertura: intervalos importados; equivalência e validação declaradas no manifesto/recibos. Uma comparação não prova causalidade nem redução de cota da assinatura.",
  ].join("\n");
  const codexOnly = baseline.runs.concat(withJev.runs).every(run => run.source.format === "codex_rollout_jsonl");
  return { schemaVersion: codexOnly ? 1 : 2, comparisonId, taskId, environmentId, initialRevision,
    manifestSha256: manifestSource.sha256, baseline, withJev, agentTokenDelta, pipelineTokenDelta,
    moneyDeltaUsd, savingsStatus: agentTokenDelta === null ? "not_measured" : "measured_comparison_with_declared_conditions",
    scope: codexOnly
      ? "imported_codex_intervals_and_reported_jev_usage" : "imported_agent_intervals_and_reported_jev_usage",
    latencyMs: Date.now() - start, summaryMessage };
}

/** Backward-compatible entry point; accepts the new explicit agent formats too. */
export const compareCodexRuns = compareUsageRuns;
