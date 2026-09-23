import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
}

/**
 * Compare two semver strings: returns 1 if latest > current, -1 if current > latest, 0 if equal
 */
export function compareSemver(current: string, latest: string): number {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);

  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);

  if (lMaj > cMaj) return 1;
  if (lMaj < cMaj) return -1;
  if (lMin > cMin) return 1;
  if (lMin < cMin) return -1;
  if (lPat > cPat) return 1;
  if (lPat < cPat) return -1;
  return 0;
}

function getCachePath(): string {
  const dir = path.join(os.homedir(), ".jev-dev");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignored
    }
  }
  return path.join(dir, "update-check.json");
}

function readCache(): UpdateCache | null {
  try {
    const file = getCachePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (data && typeof data.lastChecked === "number" && typeof data.latestVersion === "string") {
        return data as UpdateCache;
      }
    }
  } catch {
    // Non-critical
  }
  return null;
}

function writeCache(latestVersion: string): void {
  try {
    const file = getCachePath();
    fs.writeFileSync(
      file,
      JSON.stringify({ lastChecked: Date.now(), latestVersion }, null, 2),
      "utf-8"
    );
  } catch {
    // Non-critical
  }
}

/**
 * Clear cached update info
 */
export function clearUpdateCache(): void {
  try {
    const file = getCachePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // Non-critical
  }
}

/**
 * Checks npm registry for latest version of jev-dev-harness (cached for 12 hours)
 */
export async function checkForUpdates(
  currentVersion: string,
  force = false
): Promise<UpdateInfo> {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const cached = readCache();

  let latestVersion = currentVersion;

  // Use cache only if fresh AND the cached version is at least as new as the currently installed version
  if (
    !force &&
    cached &&
    Date.now() - cached.lastChecked < ONE_HOUR_MS &&
    compareSemver(currentVersion, cached.latestVersion) <= 0
  ) {
    latestVersion = cached.latestVersion;
  } else {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);

      const res = await fetch("https://registry.npmjs.org/jev-dev-harness/latest", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const json = (await res.json()) as { version?: string };
        if (json && typeof json.version === "string") {
          latestVersion = json.version;
          writeCache(latestVersion);
        }
      }
    } catch {
      // If offline or network timeout, fall back to cached version or current version
      if (cached) {
        latestVersion = cached.latestVersion;
      }
    }
  }

  const updateAvailable = compareSemver(currentVersion, latestVersion) > 0;

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
  };
}

/**
 * Print friendly update notification banner if a newer version is available
 */
export function printUpdateNotification(update: UpdateInfo): void {
  if (!update.updateAvailable) return;

  const line1 = `  🔔 Update available: ${update.currentVersion} → ${update.latestVersion}`;
  const line2 = `  Run 'jev-dev update' or 'npm i -g jev-dev-harness' to upgrade`;
  const width = Math.max(line1.length, line2.length) + 4;

  console.log("\n" + "┌" + "─".repeat(width) + "┐");
  console.log("│" + line1.padEnd(width) + "│");
  console.log("│" + line2.padEnd(width) + "│");
  console.log("└" + "─".repeat(width) + "┘\n");
}
