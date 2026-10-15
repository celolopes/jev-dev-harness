import { getHarnessPackageInfo } from "../shared/version.js";
import { checkForUpdates, compareSemver, unavailableUpdate, type UpdateInfo } from "../shared/update-checker.js";
import { printJevBanner } from "./banner.js";

export interface VersionOptions {
  json?: boolean;
}

export interface VersionInfo {
  version: string;
  latestVersion: string | null;
  isLatest: boolean | null;
  update: UpdateInfo;
  location: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export async function runVersionCommand(options: VersionOptions = {}): Promise<VersionInfo> {
  const { version, location } = getHarnessPackageInfo();
  let updateInfo = unavailableUpdate(version);

  try {
    updateInfo = await checkForUpdates(version, true);
  } catch {
    // Non-critical fallback
  }

  const latestVersion = updateInfo.latestVersion;
  const comparison = latestVersion ? compareSemver(version, latestVersion) : null;
  const isUpdateAvailable = updateInfo.updateAvailable;
  const isUpToDate = comparison === 0;
  const isLatest = updateInfo.status === "unavailable" ? null : !isUpdateAvailable;

  const info: VersionInfo = {
    version,
    latestVersion,
    isLatest,
    update: updateInfo,
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

  const statusLabel = comparison === null ? "(update status unknown)" : isUpToDate
    ? "(latest ✓)"
    : isUpdateAvailable
    ? `(update available: v${latestVersion} 🔔)`
    : "(latest dev build 🚀)";

  console.log(`  • Installed Version: v${version} ${statusLabel}`);
  console.log(`  • Latest on npm:     ${latestVersion ? `v${latestVersion}` : "unknown (check unavailable)"}`);
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

  if (updateInfo.notice) console.log(updateInfo.notice);

  return info;
}
