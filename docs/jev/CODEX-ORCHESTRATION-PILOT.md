# Experimental Antigravity → Codex handoff

This is an opt-in Linux-only pilot, not a native Orchestrator model, a general
delegation API, or a change to the existing JEV MCP server. Use a disposable
Linux VM without host mounts, production credentials, or real repositories.
The pilot uses one generated, synthetic fixture; arbitrary projects, prompts,
commands, environment variables, and executor selection are not supported.

1. In the VM, use Node 22+, the pinned repository dependencies and a trusted
   installation of the official Codex CLI. The CLI must support the flags in
   the pilot (including `--ignore-user-config`). Create a private, dedicated
   Codex home (mode 0700) and sign in directly with the official CLI using that
   home and an eligible test account. Never send credentials through MCP or
   copy your everyday Codex profile into the VM.
2. Run `node bin/jev-codex-pilot.mjs init`. It prints the absolute path of a
   new private session directory. In the VM's **test** Antigravity profile,
   register a local stdio MCP server with the following shape:

   ```json
   {
     "mcpServers": {
       "jev-codex-pilot": {
         "command": "/absolute/path/to/node",
         "args": ["/absolute/path/to/bin/jev-codex-pilot.mjs", "serve", "--session", "/absolute/path/to/session"]
       }
     }
   }
   ```

3. In Antigravity, explicitly ask Gemini to call `jev_codex_pilot_propose`,
   state the fixed change, and wait for a human operator. The tool does not
   write a file or start Codex.
4. In a separate operator-controlled terminal (not in the agent), run:

   ```sh
   node bin/jev-codex-pilot.mjs run --session /absolute/path/to/session \
     --codex-bin /absolute/path/to/official/codex --auth-home /absolute/path/to/dedicated-codex-home
   ```

   Read the prompt and type `RUN SYNTHETIC PILOT` only if you consent to one
   live model request on the synthetic fixture. The worker runs at most once
   per session. The request can use the test account's Codex quota.
5. Ask Gemini to call `jev_codex_pilot_result` and review the diff. The receipt
   verifies the exact fixture change from disk; it does **not** claim the model
   ran a test suite, prove model identity, or attest to sandbox enforcement.
   Disable the MCP entry and dispose of the VM after review.

The human runner uses Codex's workspace-write sandbox with command network
access disabled, no approval escalation, an ephemeral run, a minimal
environment, and dedicated authentication. The official CLI itself still
needs network access for model inference. This wrapper is not an OS sandbox;
the VM is the isolation boundary. It does not read credential files itself,
forward tool output or model logs, execute generated code to verify the
result, touch a real repository, apply patches, merge, push or publish.

Automated tests use a fake Codex executable: they check the real MCP stdio
contract, human-terminal requirement, fixture verification, negative cases and
timeout behavior. A successful mock run is not an authenticated end-to-end
test. Before expanding beyond the fixed fixture, verify the actual Gemini →
Codex → Gemini sequence in the VM; design approval for a specific task and
repository, safe context sharing, and independent test evidence separately.
