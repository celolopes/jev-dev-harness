import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import {
  getTelemetryEvents,
  getTelemetrySummary,
  clearTelemetryEvents,
  telemetryEmitter,
  getTelemetryFilePath,
  TelemetryEvent,
} from "../shared/telemetry.js";
import { checkForUpdates } from "../shared/update-checker.js";

export interface DashboardOptions {
  port?: number;
  open?: boolean;
  clear?: boolean;
  json?: boolean;
}

/**
 * Cross-platform open browser helper
 */
export function openBrowser(url: string): void {
  const start =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  try {
    exec(`${start} ${url}`);
  } catch {
    // Non-critical if browser open fails
  }
}

/**
 * Locate dashboard/index.html across local dev and packaged npm installs
 */
export function getDashboardHtmlPath(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(currentDir, "../../dashboard/index.html"),
      path.resolve(currentDir, "../dashboard/index.html"),
      path.resolve(currentDir, "dashboard/index.html"),
      path.resolve(process.cwd(), "dashboard/index.html"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fallback if URL resolution fails
  }
  return "";
}

/**
 * Start the local Live Telemetry Dashboard HTTP server
 */
export async function startDashboardServer(options: DashboardOptions = {}): Promise<void> {
  if (options.clear) {
    clearTelemetryEvents();
    console.log("Telemetry history cleared successfully.");
    return;
  }

  if (options.json) {
    const summary = getTelemetrySummary();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const port = options.port || 3741;
  const htmlPath = getDashboardHtmlPath();

  const server = http.createServer((req, res) => {
    // Enable CORS for API
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // API: Summary
    if (pathname === "/api/summary" && req.method === "GET") {
      const summary = getTelemetrySummary();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // API: Update Status
    if (pathname === "/api/update-status" && req.method === "GET") {
      checkForUpdates("0.1.4")
        .then((info) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(info));
        })
        .catch(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              currentVersion: "0.1.4",
              latestVersion: "0.1.4",
              updateAvailable: false,
            })
          );
        });
      return;
    }

    // API: Events List
    if (pathname === "/api/events" && req.method === "GET") {
      const limit = Number(parsedUrl.searchParams.get("limit")) || 100;
      const events = getTelemetryEvents(limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(events));
      return;
    }

    // API: Clear History
    if (pathname === "/api/clear" && req.method === "POST") {
      clearTelemetryEvents();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "History cleared" }));
      return;
    }

    // API: Live Server-Sent Events (SSE)
    if (pathname === "/api/live" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      // Send initial state
      const initialPayload = JSON.stringify({
        type: "init",
        summary: getTelemetrySummary(),
        events: getTelemetryEvents(50),
      });
      res.write(`data: ${initialPayload}\n\n`);

      // Stream new events as they arrive
      const onEvent = (event: TelemetryEvent) => {
        try {
          const payload = JSON.stringify({
            type: "event",
            event,
            summary: getTelemetrySummary(),
          });
          res.write(`data: ${payload}\n\n`);
        } catch {
          // Client disconnected
        }
      };

      telemetryEmitter.on("event", onEvent);

      // Heartbeat ping every 15s to keep connection open
      const interval = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(interval);
        }
      }, 15000);

      req.on("close", () => {
        telemetryEmitter.off("event", onEvent);
        clearInterval(interval);
      });
      return;
    }

    // Serve HTML Dashboard
    if (pathname === "/" || pathname === "/index.html") {
      if (htmlPath && fs.existsSync(htmlPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(htmlPath).pipe(res);
        return;
      }

      // Basic fallback if HTML file is missing
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body><h1>Jev Live Dashboard</h1><p>Telemetry recorded in ${getTelemetryFilePath()}</p></body></html>`);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log("\n=======================================================");
    console.log("       JEV DEVELOPER HARNESS — LIVE DASHBOARD          ");
    console.log("=======================================================\n");
    console.log(`🌐 Live Dashboard:  ${url}`);
    console.log(`📁 Telemetry File:  ${getTelemetryFilePath()}`);
    console.log(`⚡ Live Stream:     Connected via Server-Sent Events (SSE)`);
    console.log("\nPress Ctrl+C to stop the dashboard server.\n");

    if (options.open !== false) {
      openBrowser(url);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nStopping Jev Live Dashboard...");
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
