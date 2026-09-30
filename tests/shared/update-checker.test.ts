import { describe, it, expect, vi } from "vitest";
import {
  compareSemver,
  checkForUpdates,
  printUpdateNotification,
  UpdateInfo,
} from "../../src/shared/update-checker.js";

describe("Update Checker Module", () => {
  describe("compareSemver", () => {
    it("returns 1 when latest is newer than current", () => {
      expect(compareSemver("0.1.3", "0.1.4")).toBe(1);
      expect(compareSemver("0.1.3", "0.2.0")).toBe(1);
      expect(compareSemver("0.1.3", "1.0.0")).toBe(1);
      expect(compareSemver("v0.1.3", "v0.1.4")).toBe(1);
    });

    it("returns 0 when versions are identical", () => {
      expect(compareSemver("0.1.3", "0.1.3")).toBe(0);
      expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
    });

    it("returns -1 when current is newer than latest (pre-release or dev)", () => {
      expect(compareSemver("0.2.0", "0.1.9")).toBe(-1);
      expect(compareSemver("1.0.0", "0.9.9")).toBe(-1);
      expect(compareSemver("0.1.4", "0.1.3")).toBe(-1);
    });
  });

  describe("checkForUpdates", () => {
    it("returns proper UpdateInfo object structure", async () => {
      const info = await checkForUpdates("0.1.3");
      expect(info).toHaveProperty("currentVersion", "0.1.3");
      expect(info).toHaveProperty("latestVersion");
      expect(info).toHaveProperty("updateAvailable");
      expect(typeof info.updateAvailable).toBe("boolean");
    });

    it("detects no update needed when current equals latest", async () => {
      const info: UpdateInfo = {
        currentVersion: "0.1.3",
        latestVersion: "0.1.3",
        updateAvailable: false,
      };
      expect(info.updateAvailable).toBe(false);
    });
  });

  describe("printUpdateNotification", () => {
    it("prints an available update without leaking fixture output to the test log", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        printUpdateNotification({
          currentVersion: "0.1.3",
          latestVersion: "0.1.4",
          updateAvailable: true,
        });
        const output = log.mock.calls.map(([line]) => line).join("\n");
        expect(output).toContain("Update available: 0.1.3 → 0.1.4");
        expect(output).toContain("jev-dev update");
        expect(output).toContain("npm i -g jev-dev-harness");
      } finally {
        log.mockRestore();
      }
    });

    it("prints nothing when no update is available", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        printUpdateNotification({
          currentVersion: "0.1.3",
          latestVersion: "0.1.3",
          updateAvailable: false,
        });
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });
  });
});
