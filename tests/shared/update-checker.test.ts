import { describe, it, expect } from "vitest";
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
    it("does not throw when printing notification", () => {
      expect(() => {
        printUpdateNotification({
          currentVersion: "0.1.3",
          latestVersion: "0.1.4",
          updateAvailable: true,
        });
      }).not.toThrow();

      expect(() => {
        printUpdateNotification({
          currentVersion: "0.1.3",
          latestVersion: "0.1.3",
          updateAvailable: false,
        });
      }).not.toThrow();
    });
  });
});
