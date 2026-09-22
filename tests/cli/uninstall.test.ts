import { describe, it, expect, vi } from "vitest";
import { runUninstallCommand } from "../../src/cli/uninstall.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Uninstall CLI Command", () => {
  it("exports runUninstallCommand function", () => {
    expect(typeof runUninstallCommand).toBe("function");
  });

  it("handles execution safely without touching real filesystem", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => {});
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {});

    await runUninstallCommand({ yes: true, global: false, rules: false });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("JEV DEVELOPER HARNESS"));
    consoleSpy.mockRestore();
    writeSpy.mockRestore();
    rmSpy.mockRestore();
    unlinkSpy.mockRestore();
  });
});
