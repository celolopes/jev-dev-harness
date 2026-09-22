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
import { printJevBanner } from "./banner.js";

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

  // Cross-Process Live File Synchronizer
  const telemetryFilePath = getTelemetryFilePath();
  let lastKnownSize = 0;
  const processedEventIds = new Set<string>();

  try {
    if (fs.existsSync(telemetryFilePath)) {
      lastKnownSize = fs.statSync(telemetryFilePath).size;
      const initialEvents = getTelemetryEvents(200);
      for (const ev of initialEvents) {
        if (ev && ev.id) processedEventIds.add(ev.id);
      }
    }
  } catch {}

  const broadcastEvent = (event: TelemetryEvent) => {
    if (!event || !event.id) return;
    if (processedEventIds.has(event.id)) return;
    processedEventIds.add(event.id);
    if (processedEventIds.size > 2000) {
      const first = processedEventIds.values().next().value;
      if (first) processedEventIds.delete(first);
    }
    telemetryEmitter.emit("event", event);
  };

  const fileWatcher = setInterval(() => {
    try {
      if (!fs.existsSync(telemetryFilePath)) return;
      const stat = fs.statSync(telemetryFilePath);
      if (stat.size > lastKnownSize) {
        lastKnownSize = stat.size;
        const recent = getTelemetryEvents(25);
        for (let i = recent.length - 1; i >= 0; i--) {
          const ev = recent[i];
          if (ev && ev.id && !processedEventIds.has(ev.id)) {
            broadcastEvent(ev);
          }
        }
      } else if (stat.size < lastKnownSize) {
        lastKnownSize = stat.size;
        telemetryEmitter.emit("cleared");
      }
    } catch {}
  }, 500);

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

    // Prevent caching for all API routes
    if (pathname.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }

    // API: Summary
    if (pathname === "/api/summary" && req.method === "GET") {
      const summary = getTelemetrySummary();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // API: Update Status
    if (pathname === "/api/update-status" && req.method === "GET") {
      checkForUpdates("0.2.0")
        .then((info) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(info));
        })
        .catch(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              currentVersion: "0.2.0",
              latestVersion: "0.2.0",
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
      lastKnownSize = 0;
      processedEventIds.clear();
      telemetryEmitter.emit("cleared");
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
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }

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

      const onCleared = () => {
        try {
          const payload = JSON.stringify({
            type: "init",
            summary: getTelemetrySummary(),
            events: [],
          });
          res.write(`data: ${payload}\n\n`);
        } catch {}
      };

      telemetryEmitter.on("event", onEvent);
      telemetryEmitter.on("cleared", onCleared);

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
        telemetryEmitter.off("cleared", onCleared);
        clearInterval(interval);
      });
      return;
    }

    // Serve Static Logo / Favicon
    if (pathname === "/assets/logo.png" || pathname === "/logo.png" || pathname === "/favicon.ico") {
      try {
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const logoCandidates = [
          path.resolve(currentDir, "../../assets/logo.png"),
          path.resolve(currentDir, "../assets/logo.png"),
          path.resolve(process.cwd(), "assets/logo.png"),
        ];
        for (const cand of logoCandidates) {
          if (fs.existsSync(cand)) {
            res.writeHead(200, { "Content-Type": "image/png" });
            fs.createReadStream(cand).pipe(res);
            return;
          }
        }
      } catch {}
    }

    // Serve HTML Dashboard
    if (pathname === "/" || pathname === "/index.html") {
      if (htmlPath && fs.existsSync(htmlPath)) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
        });
        fs.createReadStream(htmlPath).pipe(res);
        return;
      }

      // Basic fallback if HTML file is missing
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      });
      res.end(`<!DOCTYPE html><html><body><h1>Jev Live Dashboard</h1><p>Telemetry recorded in ${getTelemetryFilePath()}</p></body></html>`);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${port} is already in use by a previous dashboard server.`);
      console.error(`💡 Tip: Stop the previous dashboard process (Ctrl+C in its terminal) or run with a different port:\n   jev-dev dashboard -p 3742\n`);
      process.exit(1);
    } else {
      console.error("Dashboard server error:", err);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    printJevBanner("🌐 LIVE TELEMETRY WEB DASHBOARD");
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
    clearInterval(fileWatcher);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
