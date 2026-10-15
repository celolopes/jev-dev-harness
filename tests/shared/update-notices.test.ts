import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkForUpdates, createUpdateNotifier, printUpdateNotification, unavailableUpdate } from "../../src/shared/update-checker.js";

describe("Unified update notices", () => {
  let dir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  const release = (version = "0.2.13") => ({ version, engines: { node: ">=22" },
    jevUpdate: { schemaVersion: 1, reasons: ["Unified update notices"], requirements: ["Refresh installed rules if required by release notes"] } });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-update-"));
    vi.stubEnv("JEV_UPDATE_CACHE_DIR", dir);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => release() });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("shares real release reasons, requirements, restart and release URL across consumers", async () => {
    const info = await checkForUpdates("0.2.12");
    expect(info).toMatchObject({ status: "update_available", source: "registry", restartRequired: true,
      latestVersion: "0.2.13", reasons: ["Unified update notices"], requirements: ["Node.js >=22", "Refresh installed rules if required by release notes"] });
    expect(info.notice).toContain("Restart required");
    expect(info.notice).toContain("Why: Unified update notices");
    expect(info.releaseUrl).toMatch(/\/tag\/v0\.2\.13$/);
    expect(await checkForUpdates("0.2.12")).toMatchObject({ source: "cache", notice: info.notice });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reads legacy cache and labels absent metadata honestly", async () => {
    fs.writeFileSync(path.join(dir, "update-check.json"), JSON.stringify({ lastChecked: Date.now(), latestVersion: "0.2.13" }));
    const info = await checkForUpdates("0.2.12");
    expect(info.notice).toContain("Why: not provided");
    expect(info.notice).toContain("Requirements: not provided");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("confirms equal/ahead versions without prompting and supports an explicit forced refresh", async () => {
    expect(await checkForUpdates("0.2.13")).toMatchObject({ status: "up_to_date", notice: null, restartRequired: false });
    expect(await checkForUpdates("0.2.14")).toMatchObject({ status: "up_to_date", notice: null });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => release("0.2.15") });
    expect(await checkForUpdates("0.2.14", true)).toMatchObject({ status: "update_available", latestVersion: "0.2.15" });
  });
  it("does not equate offline, HTTP failures, or malformed registry versions with latest", async () => {
    for (const response of [null, { ok: false }, { ok: true, json: async () => ({ version: "1.0.0; malicious" }) }]) {
      if (response) fetchMock.mockResolvedValueOnce(response); else fetchMock.mockRejectedValueOnce(new Error("offline"));
      expect(await checkForUpdates("0.2.12", true)).toEqual(unavailableUpdate("0.2.12"));
    }
  });
  it("does not trust a stale cache when refresh fails or one older than the running version", async () => {
    fs.writeFileSync(path.join(dir, "update-check.json"), JSON.stringify({ lastChecked: Date.now() - 3600001, latestVersion: "0.2.12" }));
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await checkForUpdates("0.2.12")).status).toBe("unavailable");
    expect((await checkForUpdates("0.2.14")).source).toBe("registry");
  });
  it("keeps the timeout active until the response body has been read", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_url, options) => ({ ok: true,
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))) }));
    const result = checkForUpdates("0.2.12", true);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await result).status).toBe("unavailable");
  });
  it("deduplicates concurrent MCP calls and checks hourly, then reports a newly published version", async () => {
    vi.useFakeTimers();
    const next = createUpdateNotifier("0.2.12");
    const results = await Promise.all([next(), next(), next()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await next()).toBeNull();
    await vi.advanceTimersByTimeAsync(3600001);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => release("0.2.14") });
    expect(await next()).toMatchObject({ latestVersion: "0.2.14" });
    expect(await next()).toBeNull();
    expect(await createUpdateNotifier("0.2.12")()).not.toBeNull();
  });
  it("does not retry unavailable MCP checks on every tool invocation", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const next = createUpdateNotifier("0.2.12");
    expect(await next()).toMatchObject({ status: "unavailable" });
    expect(await next()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("persists CLI deduplication by installed/latest version, writes only stderr", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = await checkForUpdates("0.2.12");
    printUpdateNotification(info); printUpdateNotification(info);
    expect(error).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    printUpdateNotification({ ...info, currentVersion: "0.2.11" });
    expect(error).toHaveBeenCalledTimes(2);
    printUpdateNotification(unavailableUpdate("0.2.12"));
    expect(error).toHaveBeenCalledTimes(2);
  });
  it("treats metadata as bounded display text and ignores unsupported schemas", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: "0.2.13", jevUpdate: { schemaVersion: 2, reasons: ["UNSUPPORTED"] } }) });
    expect((await checkForUpdates("0.2.12", true)).reasons).toEqual([]);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: "0.2.13", jevUpdate: { schemaVersion: 1, reasons: ["\u001b[31m\nmessage", 42, "x".repeat(500)] } }) });
    const info = await checkForUpdates("0.2.12", true);
    expect(info.reasons).toHaveLength(2);
    expect(info.reasons[0]).not.toContain("\u001b");
    expect(info.reasons[1]).toHaveLength(400);
  });
});
