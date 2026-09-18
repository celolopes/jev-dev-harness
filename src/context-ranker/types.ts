import type { TelemetryMetrics } from "../shared/telemetry.js";

export type CandidateRole =
  | "implementation"
  | "test"
  | "configuration"
  | "database"
  | "documentation"
  | "generated"
  | "unrelated"
  | "other";

export interface CandidateFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  extension: string;
}

export interface HeuristicCandidate extends CandidateFile {
  heuristicScore: number;
  snippet?: string;
  matchedTokens: string[];
  matchedSymbols: string[];
}

export interface JevJudgments {
  relevantToTask: number; // Noul: 0 to 1
  relevanceScore: number; // Score: 0 to 4
  relevanceLabel: string;
  role: CandidateRole;
  confidence: number;
}

export interface RankedCandidate {
  path: string;
  score: number;
  confidence: number;
  role: CandidateRole;
  relevance?: string;
  reason: string;
  source: "jev" | "deterministic_fallback";
}

export interface RankContextOptions {
  task: string;
  repoPath: string;
  candidates?: string[]; // Optional specific candidates
  top?: number; // Maximum selected candidates in final output (default: 10)
  stageBCandidateLimit?: number; // Candidates forwarded to Jev (default: 15)
  threshold?: number; // Minimum score threshold (default: 0.15)
  useCache?: boolean; // Enable SHA-256 caching (default: true)
  useJev?: boolean; // Enable Jev semantic evaluation (default: true)
  apiKey?: string; // TypeSafe API key override
  customIgnorePatterns?: string[];
  maxFileSizeBytes?: number;
  cacheFilePath?: string;
}

export interface RankContextResult {
  task: string;
  repoPath: string;
  selected: RankedCandidate[];
  metrics: TelemetryMetrics;
  fallbackUsed: boolean;
  timestamp: string;
}
