import fs from "node:fs";
import path from "node:path";

let cachedVersion: string | null = null;
let cachedLocation: string | null = null;

export interface HarnessPackageInfo {
  version: string;
  location: string;
}

/**
 * Dynamically resolves the root package.json for jev-dev-harness
 */
export function getHarnessPackageInfo(): HarnessPackageInfo {
  if (cachedVersion && cachedLocation) {
    return { version: cachedVersion, location: cachedLocation };
  }

  try {
    let currentDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
    );
    // Walk up up to 5 levels to find jev-dev-harness package.json
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(currentDir, "package.json");
      if (fs.existsSync(candidate)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (pkg.name === "jev-dev-harness") {
            cachedVersion = pkg.version;
            cachedLocation = path.dirname(candidate);
            return { version: cachedVersion!, location: cachedLocation! };
          }
        } catch {
          // Continue searching
        }
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  } catch {
    // Non-critical fallback
  }

  return {
    version: cachedVersion || "0.2.4",
    location: cachedLocation || process.cwd(),
  };
}

/**
 * Returns the current harness version string (e.g. "0.2.4")
 */
export function getHarnessVersion(): string {
  return getHarnessPackageInfo().version;
}
