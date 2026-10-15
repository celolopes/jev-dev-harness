import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli } from "../../src/cli/index.js";
import * as updates from "../../src/shared/update-checker.js";

describe("CLI update notice integration", () => {
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });
  it("keeps JSON command output parseable and skips automatic notification checks", async () => {
    const check = vi.spyOn(updates, "checkForUpdates");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await createCli().parseAsync(["node", "jev-dev", "dashboard", "--json"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(String(log.mock.calls[0][0]))).not.toThrow();
    expect(check).not.toHaveBeenCalled();
  });
  it("refuses to claim success or run an update with an unknown target", async () => {
    vi.spyOn(updates, "checkForUpdates").mockResolvedValue(updates.unavailableUpdate("0.2.12"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await createCli().parseAsync(["node", "jev-dev", "update", "--force"]);
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("status is unknown"));
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/Successfully updated|already on the latest/);
  });
});
