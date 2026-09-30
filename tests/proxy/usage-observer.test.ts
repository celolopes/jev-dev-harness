import { describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startProxyServer } from "../../src/proxy/server.js";
import { importAgentUsage } from "../../src/shared/agent-usage.js";
import { ResponseUsageObserver } from "../../src/proxy/usage-observer.js";

describe("Provider response observation", () => {
  it("merges Anthropic stream start/delta and ignores repeated cumulative snapshots", () => {
    const observer = new ResponseUsageObserver(true);
    const stream = [
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } } },
      { type: "message_delta", usage: { output_tokens: 5 } },
      { type: "message_delta", usage: { output_tokens: 10 } },
    ].map(value => `data: ${JSON.stringify(value)}\n\n`).join("");
    for (const byte of new TextEncoder().encode(stream)) observer.push(Uint8Array.of(byte));
    expect(observer.finish().usage).toMatchObject({ inputTokens: 60, outputTokens: 10, totalTokens: 70 });
  });
  it("uses OpenAI final usage and reported cost without retaining response text", () => {
    const observer = new ResponseUsageObserver(true);
    observer.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"PRIVATE"}}]}\n\ndata: {"usage":{"prompt_tokens":30,"completion_tokens":10,"total_tokens":40,"cost":0.004}}\n\ndata: [DONE]\n\n'));
    expect(observer.finish()).toMatchObject({ usage: { totalTokens: 40 }, costUsd: 0.004 });
  });
  it("supports Responses JSON and Gemini usageMetadata", () => {
    for (const payload of [
      { object: "response", usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } },
      { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 } },
    ]) {
      const observer = new ResponseUsageObserver(false);
      observer.push(new TextEncoder().encode(JSON.stringify(payload)));
      expect(observer.finish().usage.totalTokens).toBe(40);
    }
  });
  it("marks a stream that changes response model as ambiguous", () => {
    const observer = new ResponseUsageObserver(true);
    observer.push(new TextEncoder().encode('data: {"model":"first","usage":{"prompt_tokens":30,"completion_tokens":10,"total_tokens":40}}\n\ndata: {"model":"other","usage":{"prompt_tokens":30,"completion_tokens":10,"total_tokens":40}}\n\n'));
    expect(observer.finish().usage.totalTokens).toBeNull();
  });
  it("keeps missing, malformed, truncated and oversized usage unknown", () => {
    for (const payload of ['{}', '{"usage":', 'x'.repeat(1024 * 1024 + 1)]) {
      const observer = new ResponseUsageObserver(false);
      observer.push(new TextEncoder().encode(payload));
      expect(observer.finish().usage.totalTokens).toBeNull();
    }
  });
  it.each([false, true])("captures usage while preserving forwarded bytes (stream=%s)", async streaming => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-proxy-usage-"));
    const payload = streaming
      ? 'data: {"choices":[{"delta":{"content":"PRIVATE"}}]}\n\ndata: {"usage":{"prompt_tokens":30,"completion_tokens":10,"total_tokens":40}}\n\ndata: [DONE]\n\n'
      : '{"choices":[{"message":{"content":"PRIVATE"}}],"usage":{"prompt_tokens":30,"completion_tokens":10,"total_tokens":40}}';
    const upstream = http.createServer((req, res) => {
      req.resume(); res.writeHead(200, { "content-type": streaming ? "text/event-stream" : "application/json" });
      res.write(payload.slice(0, 22)); res.end(payload.slice(22));
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const output = path.join(dir, "export.json");
    let proxy: Awaited<ReturnType<typeof startProxyServer>> | undefined;
    try {
      proxy = await startProxyServer({ port: 0, quiet: true, routing: false,
        upstreamBaseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
        usageOutputPath: output, usageMetadata: { harness: "vscode-extension", sessionId: "base", turnId: "task",
          initialRevision: "abc123", model: "test-model", effort: "high", coverage: "complete",
          includesJevUsage: false, jevCallsObserved: false },
      });
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "PRIVATE REQUEST" }] }),
      });
      expect(await response.text()).toBe(payload);
      await proxy.close(); proxy = undefined;
      expect(importAgentUsage(output).usage.totalTokens).toBe(40);
      expect(importAgentUsage(output).reportedCostUsd).toBeNull();
      expect(fs.readFileSync(output, "utf8")).not.toContain("PRIVATE");
    } finally {
      if (proxy) await proxy.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects metadata claiming a baseline while Jev routing is enabled", async () => {
    await expect(startProxyServer({ usageOutputPath: "unused.json", usageMetadata: { jevCallsObserved: false } })).rejects.toThrow("--no-routing");
  });
});
