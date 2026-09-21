export interface PatchReviewOptions {
  task: string;
  diff?: string;        // Raw diff string
  diffPath?: string;    // Path to a diff file
  staged?: boolean;     // Use `git diff --staged`
  commitRange?: string; // e.g. 'HEAD~1' for `git diff HEAD~1`
  repoPath?: string;    // Repository path (default: cwd)
  useJev?: boolean;     // Enable/disable Jev evaluation (default: true)
  apiKey?: string;      // Optional API key override
  timeoutMs?: number;   // Timeout for Jev calls
}

export interface PatchReviewJudgments {
  isOutOfScope: number;     // Noul: 0-1
  regressionRisk: number;   // Score: 0-4 (5 criteria)
  modifiesAuth: number;     // Noul: 0-1
  modifiesDatabase: number; // Noul: 0-1
  missingTests: number;     // Noul: 0-1
  exposesSecrets: number;   // Noul: 0-1
  confidence: number;       // Average confidence
}

export type PatchReviewStatus = 'APPROVED' | 'ESCALATE_REVIEWER' | 'BLOCK_HUMAN_REQUIRED';

export interface PatchReviewResult {
  task: string;
  status: PatchReviewStatus;
  riskScore: number;      // 0-100 composite
  warnings: string[];
  judgments: PatchReviewJudgments;
  filesChanged: string[];
  additions: number;
  deletions: number;
  diffSnippet: string;    // Truncated diff for display
  fallbackUsed: boolean;
  fallbackReason?: string;
  latencyMs: number;
  provider?: string;
}
