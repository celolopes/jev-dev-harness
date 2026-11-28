import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSession, executeSynthetic, readResult } from "../../bin/jev-codex-pilot.mjs";

describe.skipIf(process.platform !== "linux")("synthetic Codex delegation pilot", () => {
  const roots: string[] = [];
  const cli = path.resolve("bin/jev-codex-pilot.mjs");

  async function setup(script: string) {
    const session = await createSession();
    const authHome = await fs.mkdtemp(path.join(os.tmpdir(), "jev-test-auth-"));
    roots.push(session, authHome);
    const binary = path.join(authHome, "mock-codex");
    await fs.writeFile(binary, "#!/bin/sh\n" + script, { mode: 0o700 });
    return { session, authHome, binary };
  }

  const fix = "printf '%s\\n' 'export const format = (name) => name.trim().toUpperCase();' > format.mjs\n";

  afterEach(async () => {
    while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true });
  });

  it("exposes proposal and result only through real stdio MCP", async () => {
    const { session, ...options } = await setup(fix);
    const client = new Client({ name: "pilot-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [cli, "serve", "--session", session],
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual([
        "jev_codex_pilot_propose", "jev_codex_pilot_result",
      ]);
      expect(JSON.stringify(await client.callTool({ name: "jev_codex_pilot_propose" }))).toContain("operator-terminal");
      await expect(client.callTool({ name: "jev_codex_pilot_propose", arguments: { command: "not permitted" } })).rejects.toThrow();
      expect(JSON.stringify(await client.callTool({ name: "jev_codex_pilot_result" }))).toContain("awaiting-result");
      expect(await fs.readdir(session)).toEqual(["session"]);
      await executeSynthetic(session, options);
      expect(JSON.stringify(await client.callTool({ name: "jev_codex_pilot_result" }))).toContain("exact-fixture-change");
    } finally {
      await client.close();
    }
  });

  it("refuses non-interactive execution before any worker side effect", async () => {
    const { session, binary, authHome } = await setup(fix);
    const result = spawnSync(process.execPath, [cli, "run", "--session", session,
      "--auth-home", authHome, "--codex-bin", binary], { input: "RUN SYNTHETIC PILOT\n" });
    expect(result.status).toBe(1);
    expect(await fs.readdir(session)).toEqual(["session"]);
  });

  it("uses a fixed prompt and arguments, excludes inherited secrets, and refuses a second run", async () => {
    const script = "set -eu\n" +
      "test \"$1 $2 $3 $4\" = '--ask-for-approval never exec --ephemeral'\n" +
      "test -z \"\${JEV_PILOT_TEST_SECRET:-}\"\n" +
      "test \"$(/bin/cat)\" != ''\n" + fix;
    const { session, ...options } = await setup(script);
    process.env.JEV_PILOT_TEST_SECRET = "synthetic-marker";
    try {
      expect(await executeSynthetic(session, options)).toMatchObject({ status: "verified" });
      expect(await readResult(session)).toMatchObject({ status: "verified", diff: expect.stringContaining("name.trim()") });
      await expect(executeSynthetic(session, options)).rejects.toThrow();
    } finally {
      delete process.env.JEV_PILOT_TEST_SECRET;
    }
  });

  it.each([
    ["exit 7\n", "worker-failed"],
    [":\n", "not-verified"],
    [fix + "touch unexpected.txt\n", "not-verified"],
    [fix + "mv format.mjs ../replacement; ln -s ../replacement format.mjs\n", "not-verified"],
  ])("fails closed for %s", async (script, status) => {
    const { session, ...options } = await setup(script);
    expect(await executeSynthetic(session, options)).toMatchObject({ status, diff: null });
  });

  it("ends a timed-out run and does not report success", async () => {
    const { session, ...options } = await setup("sleep 5\n" + fix);
    expect(await executeSynthetic(session, { ...options, timeout: 25 })).toMatchObject({ status: "worker-failed" });
  });

  it("rejects altered or symlinked receipts instead of echoing their content", async () => {
    const { session } = await setup(":\n");
    const result = path.join(session, "result.json");
    await fs.writeFile(result, '{"status":"verified","unexpected":"private marker"}');
    await expect(readResult(session)).rejects.toThrow();
    await fs.unlink(result);
    await fs.symlink(path.join(session, "session"), result);
    await expect(readResult(session)).rejects.toThrow();
  });
});
