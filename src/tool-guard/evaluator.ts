import {
  SafeJevClient,
  choice,
  noul,
  score,
} from "../shared/typesafe-client.js";
import type { GuardCategory, GuardCheckOptions } from "./types.js";

export interface EvaluatorResult {
  category: GuardCategory;
  requiresHumanConfirmation: number; // Noul: 0-1
  destructivePotential: number;      // Score: 0-4
  confidence: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  latencyMs: number;
  provider?: string;
}

const CHOICE_TO_CATEGORY: Record<string, GuardCategory> = {
  read_only: "read-only",
  modify_local: "modify-local",
  destructive_local: "destructive-local",
  network: "network",
  production_sensitive: "production-sensitive",
  unknown: "unknown",
};

/**
 * Uses Jev System One to semantically evaluate ambiguous or unknown commands.
 */
export async function evaluateCommand(
  command: string,
  task: string | undefined,
  client: SafeJevClient,
  options?: GuardCheckOptions
): Promise<EvaluatorResult> {
  const start = Date.now();

  const questions = {
    category: choice("What is the primary operational category of this command?", {
      read_only: "Purely reads or inspects local files or system state",
      modify_local: "Builds, compiles, or modifies local project files safely",
      destructive_local: "Irreversibly deletes or destroys local files or git history",
      network: "Communicates over the network or uploads data externally",
      production_sensitive: "Interacts with or mutates remote cloud/production infrastructure",
      unknown: "Cannot determine safety profile",
    }),
    requires_human_confirmation: noul(
      "Does this command carry a risk of irreversible data loss, production outage, or security breach that requires human confirmation?"
    ),
    destructive_potential: score(
      "How destructive is this command if executed in an unexpected context?",
      [
        "None: Idempotent and safe",
        "Low: Can be easily undone via git or undo",
        "Moderate: Overwrites untracked files or alters local configuration",
        "Severe: Permanently deletes files, branches, or database tables",
        "Catastrophic: Destroys production resources, secrets, or system files",
      ]
    ),
  };

  const state = {
    command,
    task: task || "unknown",
    shell_platform: process.platform,
  };

  const response = await client.systemOne(state, questions, {
    timeout: options?.timeoutMs,
  });

  if (response.ok) {
    const answers = response.result.answers as any;

    const rawChoice = answers?.category?.choice || "unknown";
    const category = CHOICE_TO_CATEGORY[rawChoice] || "unknown";

    const requiresHumanConfirmation =
      typeof answers?.requires_human_confirmation?.noul === "number"
        ? answers.requires_human_confirmation.noul
        : 0.5;

    const destructivePotential =
      typeof answers?.destructive_potential?.score === "number"
        ? answers.destructive_potential.score
        : 2.0;

    const confidences: number[] = [];
    if (typeof answers?.category?.confidence === "number") {
      confidences.push(answers.category.confidence);
    }
    if (typeof answers?.destructive_potential?.confidence === "number") {
      confidences.push(answers.destructive_potential.confidence);
    }
    const confidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0.85;

    return {
      category,
      requiresHumanConfirmation,
      destructivePotential,
      confidence,
      fallbackUsed: false,
      latencyMs: response.latencyMs,
      provider: response.provider,
    };
  }

  // Fallback for offline mode or error
  return {
    category: "unknown",
    requiresHumanConfirmation: 0.5,
    destructivePotential: 2.0,
    confidence: 0.5,
    fallbackUsed: true,
    fallbackReason: response.reason,
    latencyMs: Date.now() - start,
    provider: response.provider,
  };
}
