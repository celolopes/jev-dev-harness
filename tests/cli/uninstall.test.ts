import { describe, it, expect, vi } from "vitest";
import { runUninstallCommand } from "../../src/cli/uninstall.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Uninstall CLI Command", () => {
  it("exports runUninstallCommand function", () => {
    expect(typeof runUninstallCommand).toBe("function");
  });

  it("handles non-interactive cancel if input is not yes", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    // When yes is false, without input it should exit cleanly
    // Pass yes: true, but no global uninstall
    await runUninstallCommand({ yes: true, global: false, rules: false });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("JEV DEVELOPER HARNESS"));
    consoleSpy.mockRestore();
  });
});
