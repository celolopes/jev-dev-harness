import { getHarnessPackageInfo } from "../shared/version.js";
import { checkForUpdates, compareSemver } from "../shared/update-checker.js";
import { printJevBanner } from "./banner.js";

export interface VersionOptions {
  json?: boolean;
}

export interface VersionInfo {
  version: string;
  latestVersion: string;
  isLatest: boolean;
  location: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export async function runVersionCommand(options: VersionOptions = {}): Promise<VersionInfo> {
  const { version, location } = getHarnessPackageInfo();
  let latestVersion = version;

  try {
    const updateInfo = await checkForUpdates(version, true);
    latestVersion = updateInfo.latestVersion;
  } catch {
    // Non-critical fallback
  }

  const comparison = compareSemver(version, latestVersion);
  const isUpdateAvailable = comparison > 0;
  const isUpToDate = comparison === 0;
  const isLatest = !isUpdateAvailable;

  const info: VersionInfo = {
    version,
    latestVersion,
    isLatest,
    location,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return info;
  }

  printJevBanner(`VERSION INFO: v${version}`);

  const statusLabel = isUpToDate
    ? "(latest ✓)"
    : isUpdateAvailable
    ? `(update available: v${latestVersion} 🔔)`
    : "(latest dev build 🚀)";

  console.log(`  • Installed Version: v${version} ${statusLabel}`);
  console.log(`  • Latest on npm:     v${latestVersion}`);
  console.log(`  • Package Location:  ${location}`);
  console.log(`  • Node.js:           ${process.version} (${process.platform} ${process.arch})`);

  const isGlobal =
    location.includes("npm") ||
    location.includes("pnpm") ||
    location.includes("yarn") ||
    location.includes("AppData") ||
    location.includes("/usr/") ||
    location.includes("/opt/") ||
    location.includes("DevCache");

  console.log(`  • Installation Type: ${isGlobal ? "Global CLI" : "Local Workspace"}\n`);

  if (isUpdateAvailable) {
    console.log(`💡 A newer version (v${latestVersion}) is available on npm! Run:`);
    console.log("   jev-dev update\n");
  }

  return info;
}
