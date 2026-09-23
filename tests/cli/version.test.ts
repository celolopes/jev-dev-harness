import { describe, it, expect } from "vitest";
import { runVersionCommand } from "../../src/cli/version.js";
import { getHarnessVersion, getHarnessPackageInfo } from "../../src/shared/version.js";

describe("Version CLI Command & Utility", () => {
  it("resolves the current package version and location accurately", () => {
    const version = getHarnessVersion();
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);

    const info = getHarnessPackageInfo();
    expect(info.version).toBe(version);
    expect(info.location).toBeDefined();
  });

  it("executes runVersionCommand in JSON mode and returns valid info", async () => {
    const info = await runVersionCommand({ json: true });

    expect(info).toBeDefined();
    expect(info.version).toBe(getHarnessVersion());
    expect(info.latestVersion).toBeDefined();
    expect(typeof info.isLatest).toBe("boolean");
    expect(info.nodeVersion).toBe(process.version);
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });
});
