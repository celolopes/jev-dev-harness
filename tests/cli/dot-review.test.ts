import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Requires npm run build: exercise the packaged CLI without tsx IPC sockets.
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const correlationId = "7d58a34e-928b-4c19-9159-d91421a6e857";
let temp: string;
let env: NodeJS.ProcessEnv;
let preload: string;
let networkMarker: string;
const envelope = (command = "git status") => ({ schemaVersion: 1, correlationId, task: "Inspect the synthetic repository", repo: "metadata-only/not-a-real-repository", operation: { kind: "command", command } });
function run(input: string, args: string[] = ["--input", "-"]) {
  if (fs.existsSync(networkMarker)) fs.unlinkSync(networkMarker);
  const result = spawnSync(process.execPath, ["--import", preload, path.join(root, "bin/jev-dev.js"), "delegate", "review", ...args], {
    cwd: temp, env, input, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(fs.existsSync(networkMarker) ? fs.readFileSync(networkMarker, "utf8") : "").toBe("");
  return result;
}
function receipt(input: object = envelope()) {
  const r = run(JSON.stringify(input));
  expect(r.stderr).toBe("");
  const body = JSON.parse(r.stdout);
  expect(body.exitCode).toBe(r.status);
  expect(body).toMatchObject({ schemaVersion: 1, harnessVersion: version, mode: "offline", provider: null, model: null, remoteUsed: false, enforcement: "advisory", approvalGranted: false, authorizesExecution: false, repoScopeVerified: false, executed: false });
  return { r, body };
}

describe("Dot delegated review: real CLI subprocess, offline only", () => {
  beforeAll(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev dot review "));
    networkMarker = path.join(temp, "network-attempted");
    const preloadPath = path.join(temp, "deny-network.mjs");
    fs.writeFileSync(preloadPath, `import fs from 'node:fs'; import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{fs.writeFileSync(${JSON.stringify(networkMarker)},new Error('NETWORK_ATTEMPT').stack); throw new Error('OFFLINE_TEST_NETWORK_DENIED')}; globalThis.fetch=deny; http.request=deny;http.get=deny;https.request=deny;https.get=deny;net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;tls.connect=deny;syncBuiltinESMExports();`);
    preload = pathToFileURL(preloadPath).href;
    fs.writeFileSync(path.join(temp, "config.json"), "{}");
    env = { ...process.env, NODE_OPTIONS: "", HOME: temp, USERPROFILE: temp, APPDATA: temp,
      JEV_CONFIG_FILE: path.join(temp, "config.json"), JEV_UPDATE_CACHE_DIR: path.join(temp, "updates"),
      JEV_TELEMETRY_FILE: path.join(temp, "telemetry.jsonl"), JEV_PROVIDER: "typesafe",
      TYPESAFE_API_KEY: "synthetic-never-send", JEV_API_KEY: "", OPENROUTER_API_KEY: "", AI_GATEWAY_API_KEY: "", VERCEL_AI_GATEWAY_KEY: "", VERCEL_OIDC_TOKEN: "",
      TYPESAFE_DEFAULT_MODEL: "", OPENROUTER_MODEL: "", VERCEL_MODEL: "", TYPESAFE_BASE_URL: "", VERCEL_AI_GATEWAY_URL: "" };
  });
  afterAll(() => {
    // Only delete our fresh unique test directory, never a repository or user config.
    if (temp && path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith("jev dot review ")) fs.rmSync(temp, { recursive: true, force: true });
  });
  it("returns a versioned advisory receipt without granting approval or calling a provider", () => {
    const { r, body } = receipt();
    expect(r.status).toBe(0);
    expect(body).toMatchObject({ correlationId, operation: "command", decision: "no-findings", scope: { verified: false } });
    expect(body.scope.repoSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.scope.taskSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(r.stdout).not.toContain(envelope().repo);
    expect(r.stdout).not.toContain(envelope().task);
    expect(fs.existsSync(path.join(temp, "updates"))).toBe(false);
  });
  it("uses stdin when --input is omitted", () => {
    const r = run(JSON.stringify(envelope()), []);
    expect(r.status).toBe(0); expect(JSON.parse(r.stdout).decision).toBe("no-findings");
  });
  it("reads a bounded JSON input file without modifying it", () => {
    const file = path.join(temp, "request.json");
    const input = JSON.stringify(envelope()); fs.writeFileSync(file, input);
    const r = run("", ["--input", file]);
    expect(r.status).toBe(0); expect(JSON.parse(r.stdout).correlationId).toBe(correlationId);
    expect(fs.readFileSync(file, "utf8")).toBe(input);
  });
  it("marks an unknown command for review instead of claiming safety", () => {
    const { r, body } = receipt(envelope("unknown-synthetic-operation"));
    expect(r.status).toBe(2); expect(body.decision).toBe("review");
  });
  it("never executes a supplied command", () => {
    const marker = path.join(temp, "MUST_NOT_EXIST");
    const command = `node -e "require('fs').writeFileSync(${JSON.stringify(marker)},'executed')"`;
    receipt(envelope(command));
    expect(fs.existsSync(marker)).toBe(false);
  });
  it("does not echo secrets or raw command/task/repository data", () => {
    const secret = "sk-synthetic-" + "z".repeat(32);
    const input = { ...envelope(`echo ${secret}`), task: `Review ${secret}`, repo: `private/${secret}` };
    const { r } = receipt(input);
    expect(r.stdout + r.stderr).not.toContain(secret);
    expect(r.stdout).not.toContain(input.operation.command);
  });
  it("hashes the input scope without opening a supplied repo path", () => {
    const input = { ...envelope(), repo: "../../outside/nonexistent/repo" };
    const { body } = receipt(input);
    expect(body.scope.verified).toBe(false);
  });
  it.each([
    { ...envelope(), schemaVersion: 2 },
    { ...envelope(), correlationId: "not-a-uuid" },
    { ...envelope(), unexpected: "rejected" },
    { ...envelope(), operation: { kind: "command", command: "git status", unexpected: true } },
    { ...envelope(), operation: { kind: "patch", command: "git status" } },
    { ...envelope(), operation: { kind: "command", command: "git status\necho second" } },
    { ...envelope(), task: "x".repeat(4097) },
    { ...envelope(), task: "é".repeat(2049) },
    { ...envelope(), operation: { kind: "command", command: "git status\u0000" } },
  ])("rejects malformed or unsupported schema %#", input => {
    const { r, body } = receipt(input);
    expect(r.status).toBe(1); expect(body.decision).toBe("incomplete"); expect(body.error.code).toBe("INVALID_INPUT");
  });
  it("returns structured failure for invalid JSON without reflecting input", () => {
    const r = run("not-json-private-synthetic");
    expect(r.status).toBe(1); expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout).error.code).toBe("INVALID_INPUT");
    expect(r.stdout).not.toContain("not-json-private-synthetic");
  });
  it("rejects an oversized stdin payload", () => {
    const r = run(" ".repeat(65537));
    expect(r.status).toBe(1); expect(JSON.parse(r.stdout).error.code).toBe("INPUT_TOO_LARGE");
  });
  it("reports a missing input file without echoing its path", () => {
    const missing = path.join(temp, "private-nonexistent.json");
    const r = run("", ["--input", missing]);
    expect(r.status).toBe(1); expect(JSON.parse(r.stdout).error.code).toBe("INPUT_UNAVAILABLE");
    expect(r.stdout + r.stderr).not.toContain(missing);
  });
  it("rejects directories as input files", () => {
    const r = run("", ["--input", temp]);
    expect(r.status).toBe(1); expect(JSON.parse(r.stdout).error.code).toBe("INPUT_UNAVAILABLE");
  });
  it("rejects oversized input files before processing", () => {
    const file = path.join(temp, "oversized.json"); fs.writeFileSync(file, " ".repeat(65537));
    const r = run("", ["--input", file]);
    expect(r.status).toBe(1); expect(JSON.parse(r.stdout).error.code).toBe("INPUT_TOO_LARGE");
  });
  it.each([
    ["destructive-local", "git reset --hard HEAD"],
    ["production-sensitive", "terraform apply --help"],
  ])("returns deny/2 for %s without executing the supplied text", (category, command) => {
    const marker = path.join(temp, `MUST_NOT_EXECUTE_${category}`);
    // Even this sentinel is only text in a JSON envelope, never a spawned command.
    const sentinel = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}','executed')"`;
    const { r, body } = receipt(envelope(`${command}; ${sentinel}`));
    expect(r.status).toBe(2);
    expect(body).toMatchObject({ decision: "deny", category, exitCode: 2,
      authorizesExecution: false, approvalGranted: false, executed: false, requiresHumanReview: true });
    expect(fs.existsSync(marker)).toBe(false);
  });
});





