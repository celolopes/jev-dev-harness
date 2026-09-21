export type RuleSeverity = "advisory" | "warning" | "error";

export interface SemanticRule {
  id: string;
  name: string;
  description: string;
  question: string;
  severity: RuleSeverity;
  type: "noul" | "score";
  rubric?: string[]; // Criteria list if type is 'score'
  threshold: number; // e.g. 0.60 for noul, 3.0 for score
  targetPattern?: RegExp; // Optional regex to match file paths
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  passed: boolean;
  score: number;       // raw answer (noul probability or score)
  threshold: number;
  confidence: number;
  message: string;
}

export interface SemanticLintOptions {
  diff?: string;
  diffPath?: string;
  commitRange?: string;
  staged?: boolean;
  repoPath?: string;
  customRules?: SemanticRule[];
  advisoryOnly?: boolean; // When true, does not fail CI exit code
  useJev?: boolean;
  apiKey?: string;
  timeoutMs?: number;
}

export interface SemanticLintResult {
  passed: boolean;
  totalRules: number;
  passedRules: number;
  failedRules: number;
  advisoriesCount: number;
  evaluations: RuleEvaluationResult[];
  markdownReport: string;
  filesEvaluated: string[];
  fallbackUsed: boolean;
  latencyMs: number;
  provider?: string;
}
