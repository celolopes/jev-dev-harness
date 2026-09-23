import { describe, it, expect } from "vitest";
import { createMcpServer, TOOLS } from "../../src/mcp/server.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

describe("MCP Server", () => {
  it("exposes all 5 core tools in TOOLS list", () => {
    const toolNames = TOOLS.map((t) => t.name);
    expect(toolNames).toContain("jev_rank_context");
    expect(toolNames).toContain("jev_rank_tools");
    expect(toolNames).toContain("jev_guard_check");
    expect(toolNames).toContain("jev_review_patch");
    expect(toolNames).toContain("jev_lint_semantic");
  });

  it("handles ListTools request correctly", async () => {
    const server = createMcpServer();
    // @ts-expect-error accessing internal request handler for testing
    const handler = server._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    expect(handler).toBeDefined();

    const result = await handler({ method: "tools/list", params: {} });
    expect(result.tools.length).toBe(5);
  });

  it("handles CallTool request for jev_guard_check", async () => {
    const server = createMcpServer();
    // @ts-expect-error accessing internal request handler for testing
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    expect(handler).toBeDefined();

    const responseSafe = await handler({
      method: "tools/call",
      params: {
        name: "jev_guard_check",
        arguments: { command: "git status" },
      },
    });

    expect(responseSafe.content).toBeDefined();
    expect(responseSafe.content[0].type).toBe("text");
    const parsedSafe = JSON.parse(responseSafe.content[0].text);
    expect(parsedSafe.allowed).toBe(true);
    expect(parsedSafe.category).toBe("read-only");

    const responseDestructive = await handler({
      method: "tools/call",
      params: {
        name: "jev_guard_check",
        arguments: { command: "rm -rf /" },
      },
    });

    const parsedDestructive = JSON.parse(responseDestructive.content[0].text);
    expect(parsedDestructive.allowed).toBe(false);
    expect(parsedDestructive.requiresConfirmation).toBe(true);
  });

  it("handles CallTool request for jev_rank_tools", async () => {
    const server = createMcpServer();
    // @ts-expect-error accessing internal request handler for testing
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    expect(handler).toBeDefined();

    const response = await handler({
      method: "tools/call",
      params: {
        name: "jev_rank_tools",
        arguments: {
          task: "Search for files in repository",
          tools: [
            { name: "find_files", description: "Search for files by path pattern" },
            { name: "send_payment", description: "Process a stripe payment charge" },
            { name: "create_database", description: "Provision a new Postgres database" },
          ],
          top: 1,
        },
      },
    });

    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.selected.length).toBe(1);
    expect(parsed.selected[0].name).toBe("find_files");
    expect(parsed.pruned).toContain("send_payment");
  });
});
