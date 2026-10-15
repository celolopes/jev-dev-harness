import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  status: "update_available" | "up_to_date" | "unavailable";
  source: "registry" | "cache" | "unavailable";
  checkedAt: string | null;
  reasons: string[];
  requirements: string[];
  restartRequired: boolean;
  releaseUrl: string | null;
  notice: string | null;
}
interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
  reasons?: string[];
  requirements?: string[];
}
interface RegistryRelease {
  version?: unknown;
  engines?: { node?: unknown };
  jevUpdate?: { schemaVersion?: unknown; reasons?: unknown; requirements?: unknown };
}
const CACHE_TTL_MS = 60 * 60 * 1000;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
let pending: Promise<UpdateCache> | undefined;

/** Returns 1 when latest > current, -1 when current > latest, otherwise 0. */
export function compareSemver(current: string, latest: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const a = parse(current), b = parse(latest);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) > (a[i] ?? 0) ? 1 : -1;
  }
  return 0;
}
function cachePath(): string {
  return path.join(process.env.JEV_UPDATE_CACHE_DIR || path.join(os.homedir(), ".jev-dev"), "update-check.json");
}
function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function saveJson(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch { /* Update notices must not prevent normal operations. */ }
}
function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim();
  return text ? text.slice(0, 400) : null;
}
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 8).map(cleanText).filter((s): s is string => s !== null) : [];
}
function readCache(): UpdateCache | null {
  const data = readJson(cachePath()) as Partial<UpdateCache> | null;
  if (!data || typeof data.latestVersion !== "string" || !VERSION.test(data.latestVersion) ||
      typeof data.lastChecked !== "number" || !Number.isFinite(data.lastChecked)) return null;
  return { latestVersion: data.latestVersion, lastChecked: data.lastChecked,
    reasons: textList(data.reasons), requirements: textList(data.requirements) };
}
export function unavailableUpdate(currentVersion: string): UpdateInfo {
  return { currentVersion, latestVersion: null, updateAvailable: false, status: "unavailable",
    source: "unavailable", checkedAt: null, reasons: [], requirements: [], restartRequired: false,
    releaseUrl: null, notice: "Jev update check unavailable. Run 'jev-dev version' to retry; update status is unknown." };
}
function fromCache(currentVersion: string, data: UpdateCache, source: "cache" | "registry"): UpdateInfo {
  const updateAvailable = compareSemver(currentVersion, data.latestVersion) > 0;
  const info: UpdateInfo = { currentVersion, latestVersion: data.latestVersion, updateAvailable,
    status: updateAvailable ? "update_available" : "up_to_date", source,
    checkedAt: new Date(data.lastChecked).toISOString(), reasons: data.reasons || [],
    requirements: data.requirements || [], restartRequired: updateAvailable,
    releaseUrl: `https://github.com/celolopes/jev-dev-harness/releases/tag/v${data.latestVersion}`, notice: null };
  if (updateAvailable) {
    info.notice = [
      `Jev update available: ${currentVersion} → ${info.latestVersion}`,
      `Why: ${info.reasons.join("; ") || "not provided; see release notes"}.`,
      `Requirements: ${info.requirements.join("; ") || "not provided; check release notes before updating"}.`,
      "Update: jev-dev update (global installation), or update the package/version configured by your harness.",
      "Restart required: restart the Jev MCP server in each connected harness and the dashboard after updating. New CLI processes load the new version.",
      `Release notes: ${info.releaseUrl}`,
    ].join("\n");
  }
  return info;
}
async function fetchRelease(): Promise<UpdateCache> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch("https://registry.npmjs.org/jev-dev-harness/latest", {
      signal: controller.signal, headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Registry unavailable");
    const data = await res.json() as RegistryRelease | null;
    if (!data || typeof data.version !== "string" || !VERSION.test(data.version)) throw new Error("Invalid registry version");
    // Remote metadata is display data, never executable commands or agent instructions.
    const metadata = data.jevUpdate?.schemaVersion === 1 ? data.jevUpdate : {};
    const node = cleanText(data.engines?.node);
    const cache: UpdateCache = { latestVersion: data.version, lastChecked: Date.now(),
      reasons: textList(metadata.reasons),
      requirements: [...(node ? [`Node.js ${node}`] : []), ...textList(metadata.requirements)] };
    saveJson(cachePath(), cache);
    return cache;
  } finally { clearTimeout(timeout); }
}
/** One-hour cache; a failed registry check never implies that the installed version is latest. */
export async function checkForUpdates(currentVersion: string, force = false): Promise<UpdateInfo> {
  const cached = readCache();
  const age = cached ? Date.now() - cached.lastChecked : Infinity;
  if (!force && cached && age >= 0 && age < CACHE_TTL_MS && compareSemver(currentVersion, cached.latestVersion) >= 0) {
    return fromCache(currentVersion, cached, "cache");
  }
  try {
    pending ??= fetchRelease().finally(() => { pending = undefined; });
    return fromCache(currentVersion, await pending, "registry");
  } catch { return unavailableUpdate(currentVersion); }
}
export function clearUpdateCache(): void {
  try { fs.unlinkSync(cachePath()); } catch { /* Missing/read-only cache is harmless. */ }
}
/** CLI receipts persist across invocations. MCP receipts belong to one running server. */
export function printUpdateNotification(update: UpdateInfo): void {
  if (!update.updateAvailable || !update.notice) return;
  const file = path.join(path.dirname(cachePath()), "update-notice-cli.json");
  const key = `${update.currentVersion}:${update.latestVersion}`;
  const receipt = readJson(file) as { key?: string } | null;
  if (receipt?.key === key) return;
  console.error(`\n${update.notice}\n`);
  saveJson(file, { key });
}
/** Checks at most hourly (including failures), emitting each version/status once per MCP connection. */
export function createUpdateNotifier(currentVersion: string): () => Promise<UpdateInfo | null> {
  const seen = new Set<string>();
  let checkedAt = -Infinity;
  let last: UpdateInfo | undefined;
  let inFlight: Promise<UpdateInfo> | undefined;
  return async () => {
    if (!last || Date.now() - checkedAt >= CACHE_TTL_MS) {
      inFlight ??= checkForUpdates(currentVersion).catch(() => unavailableUpdate(currentVersion));
      last = await inFlight;
      checkedAt = Date.now();
      inFlight = undefined;
    }
    const key = `${last.status}:${last.latestVersion}`;
    if (!last.notice || seen.has(key)) return null;
    seen.add(key);
    return last;
  };
}
