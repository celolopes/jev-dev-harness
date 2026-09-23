import { describe, it, expect } from "vitest";
import { extractTurnData, decideRoute } from "../../src/proxy/router.js";
import { SafeJevClient } from "../../src/shared/typesafe-client.js";
import { startProxyServer } from "../../src/proxy/server.js";

describe("Reverse Proxy Module", () => {
  describe("extractTurnData", () => {
    it("extracts OpenAI format tools and messages", () => {
      const payload = {
        messages: [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "Check git status" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "git_status",
              description: "View repository status",
            },
          },
        ],
      };

      const extracted = extractTurnData(payload);
      expect(extracted.messages.length).toBe(2);
      expect(extracted.tools.length).toBe(1);
      expect(extracted.tools[0].name).toBe("git_status");
    });

    it("extracts Claude format tools", () => {
      const payload = {
        messages: [{ role: "user", content: "Run tests" }],
        tools: [
          {
            name: "run_test",
            description: "Run vitest suite",
          },
        ],
      };

      const extracted = extractTurnData(payload);
      expect(extracted.messages.length).toBe(1);
      expect(extracted.tools.length).toBe(1);
      expect(extracted.tools[0].name).toBe("run_test");
    });
  });

  describe("decideRoute (Fail-open & routing)", () => {
    it("returns passthrough when routing is disabled", async () => {
      const client = new SafeJevClient({ disabled: true });
      const decision = await decideRoute({ messages: [], tools: [] }, "codex", client, false);
      expect(decision.mode).toBe("passthrough");
      expect(decision.reason).toBe("routing_disabled");
    });

    it("returns passthrough when no tools are present", async () => {
      const client = new SafeJevClient({ disabled: true });
      const decision = await decideRoute({ messages: [{ role: "user", content: "hi" }], tools: [] }, "codex", client, true);
      expect(decision.mode).toBe("passthrough");
      expect(decision.reason).toBe("no_tools_declared");
    });
  });

  describe("startProxyServer", () => {
    it("starts on a local port and responds to /health", async () => {
      const testPort = 18795;
      const proxy = await startProxyServer({
        port: testPort,
        target: "generic",
        quiet: true,
      });

      try {
        const res = await fetch(`http://127.0.0.1:${testPort}/health`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("ok");
        expect(data.target).toBe("generic");
      } finally {
        await proxy.close();
      }
    });
  });
});
