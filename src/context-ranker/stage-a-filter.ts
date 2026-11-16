import fs from "node:fs";
import path from "node:path";
import { IgnoreFilter } from "../shared/ignore.js";
import type { TelemetryCollector } from "../shared/telemetry.js";
import type { CandidateFile, RankContextOptions } from "./types.js";

/**
 * Recursively scans directory and collects candidate files adhering to Stage A rules.
 */
function scanDirectory(
  dir: string,
  repoRoot: string,
  ignoreFilter: IgnoreFilter,
  results: CandidateFile[],
  telemetry: TelemetryCollector,
  deadline: number,
  maxDepth = 15,
  currentDepth = 0
): void {
  if (currentDepth > maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (Date.now() >= deadline) {
      telemetry.scanPartial = true;
      return;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = ignoreFilter.normalizeRelativePath(fullPath);

    if (!entry.isDirectory()) telemetry.initialCandidates++;
    if (ignoreFilter.shouldIgnore(entry.isDirectory() ? `${relPath}/` : relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      scanDirectory(
        fullPath,
        repoRoot,
        ignoreFilter,
        results,
        telemetry,
        deadline,
        maxDepth,
        currentDepth + 1
      );
      if (telemetry.scanPartial) return;
    } else if (entry.isFile()) {
      const diskCheck = ignoreFilter.isIgnoredOnDisk(fullPath);
      if (!diskCheck.ignored) {
        try {
          const stats = fs.statSync(fullPath);
          results.push({
            relativePath: relPath,
            absolutePath: fullPath,
            size: stats.size,
            extension: path.extname(relPath).toLowerCase(),
          });
        } catch {
          // Ignore files that cannot be stated
        }
      }
    }
  }
}

/**
 * Stage A: Deterministic filter discarding build artifacts, dependencies,
 * binary files, secret files, oversized files, and ignored paths.
 */
export function executeStageA(
  options: RankContextOptions,
  telemetry: TelemetryCollector
): CandidateFile[] {
  const scanBudgetMs = options.scanBudgetMs ?? Number(process.env.JEV_SCAN_BUDGET_MS ?? 3000);
  if (!Number.isFinite(scanBudgetMs) || scanBudgetMs <= 0) {
    throw new Error("scanBudgetMs must be a positive number");
  }
  const started = Date.now();
  const deadline = started + scanBudgetMs;
  telemetry.scanBudgetMs = scanBudgetMs;
  const repoRoot = path.resolve(options.repoPath);
  const ignoreFilter = new IgnoreFilter(repoRoot, {
    customPatterns: options.customIgnorePatterns,
    maxFileSizeBytes: options.maxFileSizeBytes,
  });

  const candidates: CandidateFile[] = [];

  if (options.candidates && options.candidates.length > 0) {
    // Explicit list of candidates provided
    for (const rawCandidate of options.candidates) {
      if (Date.now() >= deadline) {
        telemetry.scanPartial = true;
        break;
      }
      telemetry.initialCandidates++;
      const absPath = path.isAbsolute(rawCandidate)
        ? rawCandidate
        : path.join(repoRoot, rawCandidate);
      const relPath = ignoreFilter.normalizeRelativePath(absPath);

      if (!ignoreFilter.shouldIgnore(relPath)) {
        if (fs.existsSync(absPath)) {
          const diskCheck = ignoreFilter.isIgnoredOnDisk(absPath);
          if (!diskCheck.ignored) {
            const stats = fs.statSync(absPath);
            if (!stats.isDirectory()) {
              candidates.push({
                relativePath: relPath,
                absolutePath: absPath,
                size: stats.size,
                extension: path.extname(relPath).toLowerCase(),
              });
            }
          }
        } else {
          // Virtual or non-disk file
          candidates.push({
            relativePath: relPath,
            absolutePath: absPath,
            size: 0,
            extension: path.extname(relPath).toLowerCase(),
          });
        }
      }
    }
  } else {
    // Count entries encountered while scanning; ignored directories are not traversed.
    scanDirectory(repoRoot, repoRoot, ignoreFilter, candidates, telemetry, deadline);
  }

  telemetry.filteredCandidates = candidates.length;
  telemetry.scanElapsedMs = Date.now() - started;
  return candidates;
}
