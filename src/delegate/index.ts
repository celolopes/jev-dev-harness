import { createHash } from "node:crypto";
import { guardCheck } from "../tool-guard/index.js";
import type { GuardCategory } from "../tool-guard/types.js";
import { getHarnessVersion } from "../shared/version.js";

export const MAX_DELEGATE_INPUT_BYTES = 65536;
const MAX_FIELD_BYTES = 4096;
export type DelegateErrorCode = "INVALID_INPUT" | "INPUT_TOO_LARGE" | "INPUT_UNAVAILABLE" | "REVIEW_FAILED";
export interface DelegateEnvelope {
  schemaVersion: 1;
  correlationId: string;
  task: string;
  repo: string;
  operation: { kind: "command"; command: string };
}
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const errors: Record<DelegateErrorCode, string> = {
  INVALID_INPUT: "Expected a valid command-review envelope with the supported schema and bounded fields.",
  INPUT_TOO_LARGE: "The supplied review input exceeds the supported byte limit.",
  INPUT_UNAVAILABLE: "Cannot read the explicitly supplied regular input file or stdin.",
  REVIEW_FAILED: "Offline command assessment could not be completed; no authorization is granted.",
};
const baseReceipt = () => ({
  schemaVersion: 1 as const, harnessVersion: getHarnessVersion(),
  mode: "offline" as const, provider: null, model: null, remoteUsed: false,
  enforcement: "advisory" as const, approvalGranted: false, authorizesExecution: false,
  repoScopeVerified: false, executed: false,
});
export function incompleteDelegateReceipt(code: DelegateErrorCode) {
  return { ...baseReceipt(), correlationId: null, decision: "incomplete" as const,
    error: { code, message: errors[code] }, exitCode: 1 as const };
}
function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && Buffer.byteLength(value, "utf8") <= MAX_FIELD_BYTES && !/[\x00-\x1f\x7f]/.test(value);
}
function validateEnvelope(value: unknown): DelegateEnvelope | null {
  if (!exactObject(value, ["schemaVersion", "correlationId", "task", "repo", "operation"])) return null;
  if (value.schemaVersion !== 1 || typeof value.correlationId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.correlationId)
    || !boundedText(value.task) || !boundedText(value.repo)
    || !exactObject(value.operation, ["kind", "command"])
    || value.operation.kind !== "command" || !boundedText(value.operation.command)) return null;
  return { schemaVersion: 1, correlationId: value.correlationId, task: value.task,
    repo: value.repo, operation: { kind: "command", command: value.operation.command } };
}
const reasons: Record<GuardCategory, string> = {
  "read-only": "The existing offline guard classified the supplied text as read-only; this is not execution approval.",
  "modify-local": "The existing offline guard classified a local modification; side effects and user authorization remain unverified.",
  "destructive-local": "The existing offline guard identified a potentially destructive local operation.",
  network: "The existing offline guard identified an external communication requiring separate review.",
  "production-sensitive": "The existing offline guard identified a production-sensitive operation.",
  unknown: "The existing offline guard could not classify the operation; semantic evaluation is disabled.",
};
/** Review caller-supplied text only. Never execute it, open repo, authorize, or enable remote evaluation. */
export async function reviewDelegateEnvelope(value: unknown) {
  const input = validateEnvelope(value);
  if (!input) return incompleteDelegateReceipt("INVALID_INPUT");
  try {
    const result = await guardCheck({ command: input.operation.command, task: input.task,
      useJev: false, allowNetwork: false, allowProduction: false });
    const decision = result.category === "destructive-local" || result.category === "production-sensitive"
      ? "deny" : result.requiresConfirmation || !result.allowed ? "review" : "no-findings";
    return { ...baseReceipt(), correlationId: input.correlationId, operation: "command" as const,
      inputSha256: hash(JSON.stringify(input)),
      scope: { repoSha256: hash(input.repo), taskSha256: hash(input.task), verified: false },
      decision, category: result.category, riskLevel: result.riskLevel,
      requiresHumanReview: decision !== "no-findings", reasons: [reasons[result.category]],
      limitations: [
        "Lexical classification is not a shell parser, sandbox, authorization system or guarantee of safety.",
        "Repository and task are caller-declared metadata, not verified execution scope; no repository was inspected.",
        "Only command text is supported. No remote Jev model was invoked; patch/context review is outside this contract.",
        "No-findings never grants permission. Platform policy and user authorization must be checked independently.",
      ], exitCode: decision === "no-findings" ? 0 as const : 2 as const };
  } catch { return incompleteDelegateReceipt("REVIEW_FAILED"); }
}
export async function reviewDelegateJson(text: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_DELEGATE_INPUT_BYTES) return incompleteDelegateReceipt("INPUT_TOO_LARGE");
  try { return await reviewDelegateEnvelope(JSON.parse(text)); }
  catch { return incompleteDelegateReceipt("INVALID_INPUT"); }
}
