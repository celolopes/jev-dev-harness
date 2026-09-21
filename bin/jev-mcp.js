#!/usr/bin/env node

import { startMcpServer } from "../dist/mcp/index.js";

startMcpServer().catch((err) => {
  console.error("Fatal error starting Jev MCP Server:", err);
  process.exit(1);
});
