import { describe, it, expect, vi } from "vitest";
import { runProviderCommand } from "../../src/cli/provider.js";

describe("Provider CLI Command", () => {
  it("displays provider status without throwing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runProviderCommand();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("handles unknown provider target gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const origCode = process.exitCode;
    try {
      await runProviderCommand("unknown-provider-xyz");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown provider"));
    } finally {
      process.exitCode = origCode;
      errorSpy.mockRestore();
    }
  });
});
