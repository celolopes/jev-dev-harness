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
    const fullPath = path.join(dir, entry.name);
    const relPath = ignoreFilter.normalizeRelativePath(fullPath);

    if (ignoreFilter.shouldIgnore(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      scanDirectory(
        fullPath,
        repoRoot,
        ignoreFilter,
        results,
        maxDepth,
        currentDepth + 1
      );
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
  const repoRoot = path.resolve(options.repoPath);
  const ignoreFilter = new IgnoreFilter(repoRoot, {
    customPatterns: options.customIgnorePatterns,
    maxFileSizeBytes: options.maxFileSizeBytes,
  });

  const candidates: CandidateFile[] = [];

  if (options.candidates && options.candidates.length > 0) {
    // Explicit list of candidates provided
    telemetry.initialCandidates = options.candidates.length;

    for (const rawCandidate of options.candidates) {
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
    // Scan repository on disk
    let rawTotal = 0;
    const countTotalFiles = (d: string, depth = 0) => {
      if (depth > 15) return;
      try {
        const list = fs.readdirSync(d, { withFileTypes: true });
        for (const item of list) {
          if (item.name === ".git") continue;
          if (item.isDirectory()) {
            countTotalFiles(path.join(d, item.name), depth + 1);
          } else {
            rawTotal++;
          }
        }
      } catch {
        // Skip
      }
    };

    countTotalFiles(repoRoot);
    telemetry.initialCandidates = rawTotal;

    scanDirectory(repoRoot, repoRoot, ignoreFilter, candidates);
  }

  telemetry.filteredCandidates = candidates.length;
  return candidates;
}
