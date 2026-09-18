import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../shared/redaction.js";
import type { CandidateFile, HeuristicCandidate } from "./types.js";

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "and", "or", "not", "is", "are", "be", "this", "that", "it", "as", "do",
  "o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "em",
  "no", "na", "nos", "nas", "por", "para", "com", "e", "ou", "se", "como",
  "create", "update", "fix", "add", "implement", "make", "change",
]);

/**
 * Splits task string into meaningful search terms, preserving identifiers and sub-tokens.
 */
export function extractTaskTokens(task: string): string[] {
  const clean = task.toLowerCase().replace(/[^a-z0-9_\-\.\/]/gi, " ");
  const rawWords = clean.split(/\s+/).filter((w) => w.length > 1);

  const tokens = new Set<string>();

  for (const word of rawWords) {
    if (!STOP_WORDS.has(word)) {
      tokens.add(word);
    }
    // Decompose camelCase, kebab-case, snake_case
    const subParts = word.split(/[-_.]/).filter((p) => p.length > 2 && !STOP_WORDS.has(p));
    for (const sub of subParts) {
      tokens.add(sub);
    }
  }

  return Array.from(tokens);
}

const EXTENSION_PRIORITIES: Record<string, number> = {
  ".ts": 1.2,
  ".tsx": 1.2,
  ".js": 1.1,
  ".jsx": 1.1,
  ".py": 1.2,
  ".sql": 1.1,
  ".rs": 1.2,
  ".go": 1.2,
  ".java": 1.1,
  ".json": 0.9,
  ".yaml": 0.9,
  ".yml": 0.9,
  ".toml": 0.9,
  ".md": 0.8,
  ".txt": 0.6,
};

/**
 * Extracts exported functions, classes, interfaces, types, constants.
 */
function extractSymbolsFromSnippet(snippet: string): string[] {
  const symbols: string[] = [];
  const symbolRegex =
    /(?:export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var|enum)\s+([A-Za-z0-9_$]+)|(?:class|def)\s+([A-Za-z0-9_$]+))/g;

  let match: RegExpExecArray | null;
  while ((match = symbolRegex.exec(snippet)) !== null) {
    const sym = match[1] || match[2];
    if (sym && sym.length > 2) {
      symbols.push(sym.toLowerCase());
    }
  }

  return symbols;
}

/**
 * Stage B: Scores candidates using filename, path structure, symbols and snippets.
 * Produces a focused shortlist of candidates for Jev evaluation.
 */
export function executeStageB(
  task: string,
  candidates: CandidateFile[],
  limit = 15
): HeuristicCandidate[] {
  const taskTokens = extractTaskTokens(task);
  const scored: HeuristicCandidate[] = [];

  for (const file of candidates) {
    const normPath = file.relativePath.replace(/\\/g, "/").toLowerCase();
    const basename = path.basename(normPath);
    const pathParts = normPath.split("/");

    let pathMatches = 0;
    const matchedTokens: string[] = [];

    for (const token of taskTokens) {
      if (basename.includes(token)) {
        pathMatches += 2.5; // Basename match has high weight
        matchedTokens.push(token);
      } else if (pathParts.some((p) => p.includes(token))) {
        pathMatches += 1.0;
        matchedTokens.push(token);
      }
    }

    // Path score (0 to 1)
    const maxPossiblePathScore = Math.max(1, taskTokens.length * 2.5);
    const pathScore = Math.min(1.0, pathMatches / maxPossiblePathScore);

    // Read limited snippet (first ~1500 chars / ~35 lines)
    let snippet = "";
    let keywordMatches = 0;
    let symbolMatches = 0;
    const matchedSymbols: string[] = [];

    if (file.absolutePath && fs.existsSync(file.absolutePath)) {
      try {
        const rawContent = fs.readFileSync(file.absolutePath, "utf8");
        // Read only top portion for fast snippet analysis
        const rawSnippet = rawContent.slice(0, 1600);
        const redacted = redactSecrets(rawSnippet);
        snippet = redacted.redactedText;

        const lowerSnippet = snippet.toLowerCase();
        for (const token of taskTokens) {
          if (lowerSnippet.includes(token)) {
            keywordMatches++;
          }
        }

        const symbols = extractSymbolsFromSnippet(snippet);
        for (const sym of symbols) {
          for (const token of taskTokens) {
            if (sym.includes(token)) {
              symbolMatches++;
              matchedSymbols.push(sym);
            }
          }
        }
      } catch {
        // Snippet read error
      }
    }

    const keywordScore =
      taskTokens.length > 0 ? Math.min(1.0, keywordMatches / taskTokens.length) : 0;
    const symbolScore = Math.min(1.0, symbolMatches / 2);

    const extMultiplier = EXTENSION_PRIORITIES[file.extension] ?? 1.0;

    // Combined heuristic formula:
    // Path has 45%, Symbol has 35%, Content keyword has 20%
    let rawScore = pathScore * 0.45 + symbolScore * 0.35 + keywordScore * 0.2;
    rawScore = Math.min(1.0, rawScore * extMultiplier);

    scored.push({
      ...file,
      heuristicScore: Number(rawScore.toFixed(4)),
      snippet,
      matchedTokens: Array.from(new Set(matchedTokens)),
      matchedSymbols: Array.from(new Set(matchedSymbols)),
    });
  }

  // Sort descending by heuristic score
  scored.sort((a, b) => b.heuristicScore - a.heuristicScore);

  return scored.slice(0, limit);
}
