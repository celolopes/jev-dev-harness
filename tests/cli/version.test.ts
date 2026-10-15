import { afterEach, describe, it, expect, vi } from "vitest";
import * as updates from "../../src/shared/update-checker.js";
import { runVersionCommand } from "../../src/cli/version.js";
import { getHarnessVersion, getHarnessPackageInfo } from "../../src/shared/version.js";

describe("Version CLI Command & Utility", () => {
  afterEach(() => vi.restoreAllMocks());
  it("resolves the current package version and location accurately", () => {
    const version = getHarnessVersion();
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);

    const info = getHarnessPackageInfo();
    expect(info.version).toBe(version);
    expect(info.location).toBeDefined();
  });

  it("executes runVersionCommand in JSON mode and returns valid info", async () => {
    vi.spyOn(updates, "checkForUpdates").mockResolvedValue({ ...updates.unavailableUpdate(getHarnessVersion()),
      status: "up_to_date", latestVersion: getHarnessVersion(), notice: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = await runVersionCommand({ json: true });

    expect(info).toBeDefined();
    expect(info.version).toBe(getHarnessVersion());
    expect(info.latestVersion).toBeDefined();
    expect(typeof info.isLatest).toBe("boolean");
    expect(info.nodeVersion).toBe(process.version);
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual(info);
  });
  it("reports unknown latest version on failed checks instead of claiming latest", async () => {
    vi.spyOn(updates, "checkForUpdates").mockResolvedValue(updates.unavailableUpdate(getHarnessVersion()));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const info = await runVersionCommand({ json: true });
    expect(info.isLatest).toBeNull();
    expect(info.latestVersion).toBeNull();
    expect(info.update.status).toBe("unavailable");
  });
});
