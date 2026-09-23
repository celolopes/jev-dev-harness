import * as http from "node:http";
import { URL } from "node:url";
import { SafeJevClient } from "../shared/typesafe-client.js";
import { recordTelemetryEvent } from "../shared/telemetry.js";
import { decideRoute } from "./router.js";
import type { ProxyAgentTarget, ProxyOptions, ProxyServerInstance, RoutingDecision } from "./types.js";

const DEFAULT_PORTS: Record<ProxyAgentTarget, number> = {
  codex: 8790,
  claude: 8789,
  opencode: 8791,
  gemini: 8788,
  generic: 8790,
};

const DEFAULT_UPSTREAMS: Record<ProxyAgentTarget, string> = {
  codex: "https://api.openai.com",
  claude: "https://api.anthropic.com",
  opencode: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  generic: "https://api.openai.com",
};

/**
 * Start the local Reverse Proxy HTTP server
 */
export async function startProxyServer(options: ProxyOptions = {}): Promise<ProxyServerInstance> {
  const target: ProxyAgentTarget = options.target || "generic";
  const port = options.port || DEFAULT_PORTS[target] || 8790;
  const upstreamBaseUrl =
    options.upstreamBaseUrl ||
    process.env.JEV_UPSTREAM_BASE_URL ||
    DEFAULT_UPSTREAMS[target] ||
    "https://api.openai.com";
  const quiet = options.quiet ?? false;
  const routingEnabled = options.routing !== false;

  const jevClient = new SafeJevClient({
    timeoutMs: options.timeoutMs || 4000,
  });

  const server = http.createServer(async (req, res) => {
    // 1. Health / status check
    const reqUrl = req.url || "/";
    if (reqUrl === "/health" || reqUrl === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          target,
          upstream: upstreamBaseUrl,
          routing: routingEnabled,
          provider: jevClient.provider,
        })
      );
      return;
    }

    // 2. Read incoming body
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: any = null;
        let isJson = false;

        try {
          if (rawBody.trim().startsWith("{") || rawBody.trim().startsWith("[")) {
            parsedBody = JSON.parse(rawBody);
            isJson = true;
          }
        } catch {
          // Non-JSON or streaming input
        }

        let decision: RoutingDecision = { mode: "passthrough", latencyMs: 0, reason: "non_json" };
        let modifiedBody = rawBody;

        if (isJson && parsedBody) {
          // Ask Jev to decide
          decision = await decideRoute(parsedBody, target, jevClient, routingEnabled);

          if (decision.mode === "forced" && decision.tool) {
            if (target === "codex" && parsedBody.input) {
              parsedBody.tool_choice = { type: "function", name: decision.tool };
            } else {
              parsedBody.tool_choice = {
                type: "function",
                function: { name: decision.tool },
              };
            }
            modifiedBody = JSON.stringify(parsedBody);
          } else if (decision.mode === "none") {
            parsedBody.tool_choice = "none";
            modifiedBody = JSON.stringify(parsedBody);
          } else if (decision.mode === "hint" && decision.tool) {
            // Claude hint injection
            const hintText = `\n[Jev Router Hint: Tool '${decision.tool}' strongly matches this turn.]`;
            if (Array.isArray(parsedBody.messages) && parsedBody.messages.length > 0) {
              const lastMsg = parsedBody.messages[parsedBody.messages.length - 1];
              if (typeof lastMsg.content === "string") {
                lastMsg.content += hintText;
              }
            }
            modifiedBody = JSON.stringify(parsedBody);
          }

          const agentName =
            target === "codex" ? "Codex" :
            target === "claude" ? "Claude" :
            target === "gemini" ? "Gemini" :
            target === "opencode" ? "OpenCode" : "Proxy Gateway";

          // Record Telemetry Event
          recordTelemetryEvent({
            type: "proxy_turn",
            agent: target,
            mode: decision.mode,
            tool: (decision as any).tool,
            tokensSaved: decision.mode === "forced" || decision.mode === "hint" ? 450 : 0,
            confidence: (decision as any).confidence,
            latencyMs: decision.latencyMs || 0,
            harness: `Proxy (${target})`,
            provider: decision.provider || jevClient.provider || "typesafe",
            platform: agentName,
          });

          if (!quiet) {
            const timeStr = new Date().toLocaleTimeString();
            console.log(
              `[${timeStr}] [jev-proxy:${target}] ${req.method} ${reqUrl} -> mode: ${decision.mode.toUpperCase()}${
                (decision as any).tool ? ` (${(decision as any).tool})` : ""
              } [${decision.latencyMs}ms]`
            );
          }
        }

        // 3. Forward request to upstream
        const targetUrl = new URL(reqUrl, upstreamBaseUrl).toString();
        const forwardHeaders: Record<string, string> = {};

        for (const [key, value] of Object.entries(req.headers)) {
          if (!value || key === "host" || key === "content-length") continue;
          forwardHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
        }

        forwardHeaders["content-length"] = Buffer.byteLength(modifiedBody).toString();

        const upstreamRes = await fetch(targetUrl, {
          method: req.method || "POST",
          headers: forwardHeaders,
          body: req.method !== "GET" && req.method !== "HEAD" ? modifiedBody : undefined,
        });

        // 4. Pipe upstream response back to agent client
        const resHeaders: Record<string, string> = {};
        upstreamRes.headers.forEach((val, key) => {
          resHeaders[key] = val;
        });

        res.writeHead(upstreamRes.status, resHeaders);

        if (upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } catch (err) {
        if (!quiet) {
          console.error(`[jev-proxy error] ${(err as Error).message}`);
        }
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad Gateway", message: (err as Error).message }));
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      if (!quiet) {
        console.log(`\n======================================================`);
        console.log(`        🔮 JEV REVERSE PROXY GATEWAY ACTIVE           `);
        console.log(`======================================================`);
        console.log(`  Target Agent:    ${target.toUpperCase()}`);
        console.log(`  Local Gateway:   http://127.0.0.1:${port}`);
        console.log(`  Upstream Target: ${upstreamBaseUrl}`);
        console.log(`  AI Provider:     ${jevClient.provider.toUpperCase()} (${jevClient.modelName})`);
        console.log(`  Routing:         ${routingEnabled ? "ENABLED (Jev System One)" : "PASSTHROUGH ONLY"}`);
        console.log(`======================================================\n`);
      }

      resolve({
        port,
        target,
        upstreamBaseUrl,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });

    server.on("error", (err) => reject(err));
  });
}
