import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCli } from "../../src/cli/index.js";
import * as reviewer from "../../src/patch-reviewer/index.js";
import * as updates from "../../src/shared/update-checker.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const loader = pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href;
let temp: string;
let env: NodeJS.ProcessEnv;
function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", loader, path.join(root, "src/cli/index.ts"), ...args], {
    cwd: temp, env, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
  });
}
function patch(file: string, line: string): string {
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`;
}

describe("CLI JSON and text exit-code parity", () => {
  beforeAll(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev cli status "));
    const state = path.join(temp, ".jev-dev");
    fs.mkdirSync(state);
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    fs.writeFileSync(path.join(state, "update-check.json"), JSON.stringify({ lastChecked: Date.now(), latestVersion: version }));
    fs.writeFileSync(path.join(temp, "config.json"), "{}");
    const fixtureKey = ["sk", "test", "x".repeat(32)].join("_");
    fs.writeFileSync(path.join(temp, "blocked.diff"), patch("src/config.ts", `const api_key = "${fixtureKey}";`));
    fs.writeFileSync(path.join(temp, "safe.diff"), patch("README.md", "Update documentation"));
    env = { ...process.env, NODE_OPTIONS: "", HOME: temp, USERPROFILE: temp, APPDATA: temp,
      JEV_CONFIG_FILE: path.join(temp, "config.json"), JEV_UPDATE_CACHE_DIR: state,
      JEV_TELEMETRY_FILE: path.join(state, "telemetry.jsonl"), JEV_PROVIDER: "typesafe",
      TYPESAFE_API_KEY: "", JEV_API_KEY: "", OPENROUTER_API_KEY: "", AI_GATEWAY_API_KEY: "",
      VERCEL_AI_GATEWAY_KEY: "", VERCEL_OIDC_TOKEN: "" };
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });
  afterAll(() => { if (temp) fs.rmSync(temp, { recursive: true, force: true }); });

  for (const json of [false, true]) {
    const mode = json ? ["--json"] : [];
    it(`returns zero for safe guard (${json ? "JSON" : "text"})`, () => {
      const r = cli(["guard", "check", "--command", "git status", "--no-jev", ...mode]);
      expect(r.error).toBeUndefined(); expect(r.status).toBe(0); expect(r.stderr).toBe("");
      if (json) expect(JSON.parse(r.stdout).allowed).toBe(true); else expect(r.stdout).toContain("[ALLOWED]");
    });
    it(`returns one for denied guard (${json ? "JSON" : "text"}) without executing input`, () => {
      const r = cli(["guard", "check", "--command", "git reset --hard HEAD", "--no-jev", ...mode]);
      expect(r.status).toBe(1); expect(r.stderr).toBe("");
      if (json) expect(JSON.parse(r.stdout).allowed).toBe(false); else expect(r.stdout).toContain("CONFIRMATION REQUIRED");
    });
    it(`retains zero for nonblocking patch (${json ? "JSON" : "text"})`, () => {
      const r = cli(["patch", "review", "--task", "Update documentation", "--diff-file", "safe.diff", "--no-jev", ...mode]);
      expect(r.status).toBe(0); expect(r.stderr).toBe("");
      if (json) expect(JSON.parse(r.stdout).status).not.toBe("BLOCK_HUMAN_REQUIRED");
    });
    it(`returns two for blocked patch (${json ? "JSON" : "text"})`, () => {
      const r = cli(["patch", "review", "--task", "Review configuration", "--diff-file", "blocked.diff", "--no-jev", ...mode]);
      expect(r.status).toBe(2); expect(r.stderr).toBe("");
      if (json) expect(JSON.parse(r.stdout).status).toBe("BLOCK_HUMAN_REQUIRED"); else expect(r.stdout).toContain("BLOCK_HUMAN_REQUIRED");
    });
    it(`returns one for failed semantic lint (${json ? "JSON" : "text"})`, () => {
      const r = cli(["lint", "semantic", "--diff-file", "blocked.diff", "--no-jev", ...mode]);
      expect(r.status).toBe(1); expect(r.stderr).toBe("");
      if (json) expect(JSON.parse(r.stdout).passed).toBe(false); else expect(r.stdout).toContain("[FAILED]");
    });
    it(`keeps advisory lint nonblocking (${json ? "JSON" : "text"})`, () => {
      const r = cli(["lint", "semantic", "--diff-file", "blocked.diff", "--advisory", "--no-jev", ...mode]);
      expect(r.status).toBe(0); expect(r.stderr).toBe("");
      if (json) expect(JSON.parse(r.stdout).passed).toBe(true);
    });
    it(`separates execution errors from stdout (${json ? "JSON" : "text"})`, () => {
      const r = cli(["patch", "review", "--task", "Review", "--diff-file", "missing.diff", "--no-jev", ...mode]);
      expect(r.status).toBe(1); expect(r.stdout).toBe(""); expect(r.stderr).toContain("Diff file not found");
    });
  }
  it("preserves escalation as exit zero rather than imposing a new review contract", () => {
    fs.writeFileSync(path.join(temp, "review.diff"), patch("src/auth/login.ts", "export const login = true;"));
    const r = cli(["patch", "review", "--task", "Change login", "--diff-file", "review.diff", "--no-jev", "--json"]);
    expect(r.status).toBe(0); expect(JSON.parse(r.stdout).status).toBe("ESCALATE_REVIEWER");
  });
  it("invalid arguments fail on stderr without contaminating stdout", () => {
    const r = cli(["guard", "check", "--json"]);
    expect(r.status).toBe(1); expect(r.stdout).toBe(""); expect(r.stderr).toContain("required option");
  });
  it("missing provider credentials enforce conservative fallback policy requiring confirmation", () => {
    const r = cli(["guard", "check", "--command", "unknown-fixture-operation", "--json"]);
    expect(r.status).toBe(1); expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toMatchObject({ allowed: false, requiresConfirmation: true, category: "unknown", riskLevel: "medium", fallbackUsed: true });
  });
  it("unexpected internal errors stay on stderr with failure status", async () => {
    vi.spyOn(reviewer, "reviewPatchPipeline").mockRejectedValue(new Error("Synthetic internal failure"));
    vi.spyOn(updates, "checkForUpdates").mockResolvedValue(updates.unavailableUpdate("0.2.13"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await createCli().parseAsync(["node", "jev-dev", "patch", "review", "--task", "Review", "--json"]);
    expect(log).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith("Error executing patch reviewer:", "Synthetic internal failure");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
