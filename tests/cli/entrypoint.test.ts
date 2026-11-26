import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
let temp: string;

function run(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: temp,
    env: { ...process.env, NODE_OPTIONS: "", HOME: temp, USERPROFILE: temp },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("CLI entry points", () => {
  beforeAll(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev cli entry "));
    fs.copyFileSync(path.join(root, "package.json"), path.join(temp, "package.json"));
    fs.mkdirSync(path.join(temp, "bin"));
    fs.copyFileSync(path.join(root, "bin/jev-dev.js"), path.join(temp, "bin/jev-dev.js"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(temp, "node_modules"), "junction");
    const build = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--project", path.join(root, "tsconfig.json"),
      "--outDir", path.join(temp, "dist"),
    ], { encoding: "utf8", timeout: 30_000 });
    expect(build.status, build.error?.message ?? build.stdout + build.stderr).toBe(0);
  }, 35_000);

  afterAll(() => { if (temp) fs.rmSync(temp, { recursive: true, force: true }); });

  function expectHelp(args: string[]) {
    const result = run([...args, "--help"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.match(/^Usage: jev-dev\b/gm) ?? []).toHaveLength(1);
  }

  it("prints help once through the package binary and the compiled entry", () => {
    expectHelp(["bin/jev-dev.js"]);
    expectHelp(["dist/cli/index.js"]);
  });

  it.skipIf(process.platform === "win32")("prints help through an npm-style symlink without a .js extension", () => {
    fs.symlinkSync("bin/jev-dev.js", path.join(temp, "jev-dev"));
    expectHelp(["./jev-dev"]);
  });

  it("does not start the CLI when imported from a similarly named script", () => {
    fs.writeFileSync(path.join(temp, "jev-dev.js"), 'import "./dist/cli/index.js";\nconsole.log("imported");\n');
    const result = run(["jev-dev.js"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("imported");
  });
});
