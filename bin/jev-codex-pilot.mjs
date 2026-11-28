#!/usr/bin/env node

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { constants as F } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const TASK = 'synthetic-trim-v1';
const FILE = 'format.mjs';
const BEFORE = 'export const format = (name) => name.toUpperCase();\n';
const AFTER = 'export const format = (name) => name.trim().toUpperCase();\n';
const DIFF = '--- a/format.mjs\n+++ b/format.mjs\n@@ -1 +1 @@\n-' + BEFORE + '+' + AFTER;
const PROMPT = 'Synthetic JEV pilot. Edit only format.mjs: trim the input before uppercasing it. ' +
  'Use the exact line: ' + AFTER + 'Do not create other files or access anything outside the fixture.';
const MARKER = 'jev-codex-pilot-v1\n';

async function readSmall(file, limit) {
  // NOFOLLOW rejects symlinks; NONBLOCK prevents hanging on a FIFO before fstat.
  const handle = await fs.open(file, F.O_RDONLY | F.O_NOFOLLOW | F.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new Error('Invalid pilot file');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer);
    if (bytesRead > limit) throw new Error('Invalid pilot file');
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function privateDir(dir) {
  if (!dir || !path.isAbsolute(dir) || path.resolve(dir) !== await fs.realpath(dir)) {
    throw new Error('Use a canonical absolute directory');
  }
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error('Use a private directory owned by the current user');
  }
  return path.resolve(dir);
}

export async function createSession() {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'jev-codex-pilot-'));
  await fs.writeFile(path.join(dir, 'session'), MARKER, { flag: 'wx', mode: 0o600 });
  return dir;
}

async function sessionDir(dir) {
  dir = await privateDir(dir);
  if ((await readSmall(path.join(dir, 'session'), 64)).toString() !== MARKER) {
    throw new Error('Not a JEV pilot session');
  }
  return dir;
}

function receipt(status) {
  const verified = status === 'verified';
  return {
    schemaVersion: 1, task: TASK, status, syntheticOnly: true,
    verification: verified ? 'exact-fixture-change' : 'not-verified',
    diff: verified ? DIFF : null,
  };
}

export async function readResult(dir) {
  dir = await sessionDir(dir);
  try {
    const raw = (await readSmall(path.join(dir, 'result.json'), 1024)).toString();
    // Publish only our own exact bounded receipt, never text provided by the worker.
    for (const status of ['verified', 'not-verified', 'worker-failed']) {
      const candidate = receipt(status);
      if (raw === JSON.stringify(candidate)) return candidate;
    }
    throw new Error('Invalid pilot receipt');
  } catch (error) {
    if (error.code === 'ENOENT') return receipt('awaiting-result');
    throw error;
  }
}

function killGroup(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function runWorker({ binary, cwd, home, authHome, timeout }) {
  // No project, model, prompt, flags or executable can be supplied via MCP.
  const args = ['--ask-for-approval', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=false',
    '--skip-git-repo-check', '--cd', cwd, '-'];
  return new Promise(resolve => {
    const child = spawn(binary, args, {
      cwd, detached: true, shell: false, stdio: ['pipe', 'ignore', 'ignore'],
      env: { HOME: home, CODEX_HOME: authHome, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, timeout);
    child.stdin.on('error', () => {}); // Early exit must not cause an unhandled EPIPE.
    child.stdin.end(PROMPT);
    let failed = false;
    child.once('error', () => { failed = true; });
    child.once('close', code => {
      clearTimeout(timer);
      killGroup(child.pid);
      resolve(!failed && !timedOut && code === 0);
    });
  });
}

/** Internal runner. The executable is trusted operator input; not available via MCP. */
export async function executeSynthetic(dir, { binary, authHome, timeout = 120_000 }) {
  dir = await sessionDir(dir);
  authHome = await privateDir(authHome);
  if (!binary || !path.isAbsolute(binary)) throw new Error('Provide the absolute path to the official Codex CLI');
  binary = await fs.realpath(binary);
  if (!(await fs.stat(binary)).isFile()) throw new Error('Expected a regular executable');
  await fs.access(binary, F.X_OK);
  // One execution per session, including failure. Never retry silently.
  await fs.writeFile(path.join(dir, 'run.lock'), '', { flag: 'wx', mode: 0o600 });
  const home = path.join(dir, 'empty-home');
  const cwd = path.join(dir, 'fixture');
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(cwd, { mode: 0o700 });
  await fs.writeFile(path.join(cwd, FILE), BEFORE, { flag: 'wx', mode: 0o600 });

  let status = 'worker-failed';
  if (await runWorker({ binary, cwd, home, authHome, timeout })) {
    status = 'not-verified';
    try {
      const entries = await fs.readdir(cwd);
      if (entries.length === 1 && entries[0] === FILE &&
          (await readSmall(path.join(cwd, FILE), 128)).equals(Buffer.from(AFTER))) status = 'verified';
    } catch { /* Missing, special, or unreadable output is never a pass. */ }
  }
  const result = receipt(status);
  const staged = path.join(dir, 'result.tmp');
  await fs.writeFile(staged, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  // Atomic publication; a result already present must not be replaced.
  await fs.link(staged, path.join(dir, 'result.json'));
  await fs.unlink(staged);
  return result;
}

async function startServer(dir) {
  dir = await sessionDir(dir);
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } =
    await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'jev-codex-pilot', version: '1.0.0' }, { capabilities: { tools: {} } });
  const definitions = [
    ['jev_codex_pilot_propose', 'Describe the fixed synthetic Codex pilot. Requires a separate human terminal approval; does not execute.'],
    ['jev_codex_pilot_result', 'Read the verified synthetic pilot receipt. Does not execute or modify files.'],
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions.map(([name, description]) => ({
      name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (Object.keys(params.arguments ?? {}).length || !definitions.some(([name]) => name === params.name)) {
      throw new McpError(ErrorCode.InvalidParams, 'Unknown tool or unexpected arguments');
    }
    try {
      const value = params.name === 'jev_codex_pilot_propose'
        ? { task: TASK, summary: 'Trim a synthetic input before uppercasing', approval: 'operator-terminal', executed: false }
        : await readResult(dir);
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Pilot receipt unavailable or invalid' }] };
    }
  });
  await server.connect(new StdioServerTransport());
}

async function main() {
  if (process.platform !== 'linux') throw new Error('Pilot supports Linux only');
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { session: { type: 'string' }, 'codex-bin': { type: 'string' }, 'auth-home': { type: 'string' } },
  });
  if (positionals.length !== 1) throw new Error('Expected init, serve, or run');
  const [action] = positionals;
  if (action === 'init' && Object.keys(values).length === 0) {
    console.log(await createSession());
  } else if (action === 'serve' && Object.keys(values).length === 1 && values.session) {
    await startServer(values.session);
  } else if (action === 'run' && values.session && values['codex-bin'] && values['auth-home']) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Approval requires an interactive terminal');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try {
      answer = await rl.question('Allow one live Codex request on the synthetic fixture? Type RUN SYNTHETIC PILOT: ');
    } finally { rl.close(); }
    if (answer !== 'RUN SYNTHETIC PILOT') throw new Error('Pilot not approved');
    const result = await executeSynthetic(values.session, { binary: values['codex-bin'], authHome: values['auth-home'] });
    console.log(JSON.stringify(result));
    if (result.status !== 'verified') process.exitCode = 1;
  } else {
    throw new Error('Invalid arguments for init, serve, or run');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('JEV Codex pilot stopped. Check the action, private session, Codex path, auth directory, and terminal approval.');
    process.exitCode = 1;
  });
}
