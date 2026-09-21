export type GuardCategory =
  | 'read-only'
  | 'modify-local'
  | 'destructive-local'
  | 'network'
  | 'production-sensitive'
  | 'unknown';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface GuardCheckOptions {
  command: string;          // The shell command to evaluate
  task?: string;            // Context: what task is the agent working on?
  allowNetwork?: boolean;   // Default: false. Allow network commands?
  allowProduction?: boolean;// Default: false. Allow production commands?
  useJev?: boolean;         // Default: true. Enable Jev for unknown commands?
  apiKey?: string;          // Optional API key override
  timeoutMs?: number;       // Timeout for Jev calls
}

export interface GuardResult {
  command: string;
  allowed: boolean;
  requiresConfirmation: boolean;
  category: GuardCategory;
  riskLevel: RiskLevel;
  reason: string;
  matchedRule?: string;     // Which classifier rule matched
  fallbackUsed: boolean;
  fallbackReason?: string;
  latencyMs: number;
  provider?: string;
}
