import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../shared/redaction.js";
import type { PatchReviewOptions } from "./types.js";

export interface DiffData {
  rawDiff: string;
  sanitizedDiff: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
}

const IGNORED_DIFF_PATTERNS = [
  /package-lock\.json/i,
  /pnpm-lock\.yaml/i,
  /yarn\.lock/i,
  /\.min\.js$/i,
  /\.min\.css$/i,
  /\.map$/i,
];

/**
 * Filter out hunks for lockfiles, minified files, or sourcemaps from raw diff.
 */
function filterDiff(rawDiff: string): { filteredDiff: string; filesChanged: string[]; additions: number; deletions: number } {
  const fileHunkRegex = /^diff --git a\/(.+?) b\/(.+?)(?=\n(?:diff --git|$))/gms;
  const filesChanged: string[] = [];
  let additions = 0;
  let deletions = 0;
  const keptHunks: string[] = [];

  // Match file-level diff blocks
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  // We can also split by "diff --git "
  const rawHunks = rawDiff.split(/(?=^diff --git )/m);

  for (const hunk of rawHunks) {
    if (!hunk.trim()) continue;

    const fileMatch = hunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    const fileName = fileMatch ? fileMatch[2] || fileMatch[1] : undefined;

    if (fileName) {
      const isIgnored = IGNORED_DIFF_PATTERNS.some((pattern) => pattern.test(fileName));
      if (isIgnored) {
        continue;
      }
      filesChanged.push(fileName);
    }

    // Count additions and deletions
    const lines = hunk.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }

    keptHunks.push(hunk);
  }

  // If there were no "diff --git" headers (e.g. custom or simple diff), fallback
  if (keptHunks.length === 0 && rawDiff.trim().length > 0) {
    const lines = rawDiff.split("\n");
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        filesChanged.push(line.replace("+++ b/", "").trim());
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
    return {
      filteredDiff: rawDiff,
      filesChanged: filesChanged.length > 0 ? filesChanged : ["unknown-patch"],
      additions,
      deletions,
    };
  }

  return {
    filteredDiff: keptHunks.join(""),
    filesChanged,
    additions,
    deletions,
  };
}

/**
 * Extracts and sanitizes git diff from options (direct string, file, or git command).
 */
export async function extractDiff(options: PatchReviewOptions): Promise<DiffData> {
  const repoPath = path.resolve(options.repoPath || ".");
  let rawDiff = "";

  if (typeof options.diff === "string") {
    rawDiff = options.diff;
  } else if (options.diffPath) {
    const fullPath = path.isAbsolute(options.diffPath)
      ? options.diffPath
      : path.join(repoPath, options.diffPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Diff file not found: ${fullPath}`);
    }
    rawDiff = fs.readFileSync(fullPath, "utf-8");
  } else {
    // Run git diff command
    let gitArgs = "diff";
    if (options.staged) {
      gitArgs = "diff --staged";
    } else if (options.commitRange) {
      gitArgs = `diff ${options.commitRange}`;
    }

    try {
      rawDiff = execSync(`git ${gitArgs}`, {
        cwd: repoPath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      throw new Error(`Failed to execute 'git ${gitArgs}' in ${repoPath}: ${(err as Error).message}`);
    }
  }

  const { filteredDiff, filesChanged, additions, deletions } = filterDiff(rawDiff);

  // Redact secrets, keys, and tokens
  const redaction = redactSecrets(filteredDiff);

  // Truncate to maximum characters for token and cost efficiency
  const MAX_DIFF_LENGTH = 8000;
  let sanitizedDiff = redaction.redactedText;
  if (sanitizedDiff.length > MAX_DIFF_LENGTH) {
    sanitizedDiff =
      sanitizedDiff.substring(0, MAX_DIFF_LENGTH) +
      `\n\n[DIFF TRUNCATED: Exceeded ${MAX_DIFF_LENGTH} characters limit for review]`;
  }

  return {
    rawDiff,
    sanitizedDiff,
    filesChanged,
    additions,
    deletions,
  };
}
