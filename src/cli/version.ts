import { getHarnessPackageInfo } from "../shared/version.js";
import { checkForUpdates } from "../shared/update-checker.js";
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
  let isLatest = true;

  try {
    const updateInfo = await checkForUpdates(version, true);
    latestVersion = updateInfo.latestVersion;
    isLatest = !updateInfo.updateAvailable && latestVersion === version;
  } catch {
    // Non-critical fallback
  }

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

  console.log(`  • Installed Version: v${version} ${isLatest ? "(latest ✓)" : `(update available: v${latestVersion} 🔔)`}`);
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

  if (!isLatest) {
    console.log(`💡 A newer version (v${latestVersion}) is available on npm! Run:`);
    console.log("   jev-dev update\n");
  }

  return info;
}
