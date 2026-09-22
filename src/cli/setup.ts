import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { SafeJevClient, noul } from "../shared/typesafe-client.js";

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

function configureJsonMcpServer(
  configPath: string,
  agentName: string,
  envVars: Record<string, string>
): boolean {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      return false; // Directory doesn't exist, app is not installed
    }

    let config: any = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      } catch {
        config = {};
      }
    }

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }

    config.mcpServers["jev-dev"] = {
      command: "npx",
      args: ["-y", "jev-dev-harness"],
      env: envVars,
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    console.log(`  ✓ Configured ${agentName} at ${configPath}`);
    return true;
  } catch {
    return false;
  }
}

export interface SetupOptions {
  provider?: "typesafe" | "openrouter" | "offline";
  key?: string;
  model?: string;
  nonInteractive?: boolean;
}

export async function runSetupWizard(options: SetupOptions = {}): Promise<void> {
  console.log("\n" + "=".repeat(78));
  console.log("       🔮 JEV DEVELOPER HARNESS — INTERACTIVE SETUP & CONFIGURATION WIZARD     ");
  console.log("=".repeat(78) + "\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let provider = options.provider;

    if (!provider && !options.nonInteractive) {
      console.log("Select your primary AI Provider for Jev System One:");
      console.log("  [1] Native TypeSafe AI (Recommended — ultra-fast native System One models)");
      console.log("  [2] OpenRouter (Community — DeepSeek V4 Flash, Claude 3.5 Haiku, GPT-4o-mini)");
      console.log("  [3] Offline / Deterministic Only (Heuristics & regex — no API key needed)\n");

      const choice = (await ask(rl, "Enter choice [1-3] (default: 1): ")).trim();
      if (choice === "2") {
        provider = "openrouter";
      } else if (choice === "3") {
        provider = "offline";
      } else {
        provider = "typesafe";
      }
    } else if (!provider) {
      provider = "typesafe";
    }

    let apiKey = options.key;
    let model = options.model;

    if (provider === "typesafe") {
      if (!apiKey && !options.nonInteractive) {
        console.log("\n🔑 TypeSafe AI Configuration:");
        console.log("Get your key at: https://typesafe.ai");
        apiKey = (await ask(rl, "Paste your TYPESAFE_API_KEY (or press Enter to skip): ")).trim();
      }
    } else if (provider === "openrouter") {
      if (!apiKey && !options.nonInteractive) {
        console.log("\n🔑 OpenRouter Configuration:");
        console.log("Get your key at: https://openrouter.ai/keys");
        apiKey = (await ask(rl, "Paste your OPENROUTER_API_KEY (or press Enter to skip): ")).trim();
      }

      if (!model && !options.nonInteractive) {
        const defaultModel = "deepseek/deepseek-v4-flash";
        const modelInput = (
          await ask(rl, `Enter model slug (default: ${defaultModel}): `)
        ).trim();
        model = modelInput || defaultModel;
      }
    }

    // Save configurations
    console.log("\n💾 Saving Configurations...");

    // 1. Save to local .env in current directory
    const envPath = path.resolve(".env");
    const envLines: string[] = [];

    if (fs.existsSync(envPath)) {
      const existingEnv = fs.readFileSync(envPath, "utf8");
      for (const line of existingEnv.split(/\r?\n/)) {
        if (
          !line.startsWith("TYPESAFE_API_KEY=") &&
          !line.startsWith("OPENROUTER_API_KEY=") &&
          !line.startsWith("OPENROUTER_MODEL=") &&
          !line.startsWith("JEV_PROVIDER=")
        ) {
          if (line.trim()) envLines.push(line);
        }
      }
    }

    envLines.push(`JEV_PROVIDER=${provider}`);
    if (provider === "typesafe" && apiKey) {
      envLines.push(`TYPESAFE_API_KEY=${apiKey}`);
    } else if (provider === "openrouter" && apiKey) {
      envLines.push(`OPENROUTER_API_KEY=${apiKey}`);
      if (model) envLines.push(`OPENROUTER_MODEL=${model}`);
    }

    fs.writeFileSync(envPath, envLines.join("\n") + "\n", "utf8");
    console.log(`  ✓ Updated local .env at ${envPath}`);

    // 2. Save to global config directory (~/.jev-dev/config.json)
    const globalConfigDir = path.join(os.homedir(), ".jev-dev");
    if (!fs.existsSync(globalConfigDir)) {
      fs.mkdirSync(globalConfigDir, { recursive: true });
    }
    const globalConfigFile = path.join(globalConfigDir, "config.json");
    const globalData = {
      provider,
      apiKey: apiKey || undefined,
      model: model || undefined,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(globalConfigFile, JSON.stringify(globalData, null, 2), "utf8");
    console.log(`  ✓ Saved global config at ${globalConfigFile}`);

    // 3. Detect and automatically configure Coding Agents (Codex, Claude, Antigravity, Cursor, Windsurf, Trae)
    console.log("\n🤖 Detecting and Configuring AI Coding Agents...");
    let configuredAgentsCount = 0;

    const mcpEnv: Record<string, string> = {};
    if (provider === "openrouter" && apiKey) {
      mcpEnv["OPENROUTER_API_KEY"] = apiKey;
      if (model) mcpEnv["OPENROUTER_MODEL"] = model;
    } else if (apiKey) {
      mcpEnv["TYPESAFE_API_KEY"] = apiKey;
    }

    // Agent A: Codex Desktop (~/.codex/config.toml)
    const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
    if (fs.existsSync(codexConfigPath)) {
      try {
        const codexContent = fs.readFileSync(codexConfigPath, "utf8");
        if (!codexContent.includes("[mcp_servers.jev_dev]")) {
          const tomlSnippet = `\n[mcp_servers.jev_dev]\ncommand = "npx"\nargs = ["-y", "jev-dev-harness"]\nstartup_timeout_sec = 60.0\n\n[mcp_servers.jev_dev.env]\n${
            provider === "openrouter"
              ? `OPENROUTER_API_KEY = "${apiKey || ""}"\nOPENROUTER_MODEL = "${model || "deepseek/deepseek-v4-flash"}"`
              : `TYPESAFE_API_KEY = "${apiKey || ""}"`
          }\n\n[mcp_servers.jev_dev.tools.jev_rank_context]\napproval_mode = "approve"\n\n[mcp_servers.jev_dev.tools.jev_guard_check]\napproval_mode = "approve"\n\n[mcp_servers.jev_dev.tools.jev_review_patch]\napproval_mode = "approve"\n\n[mcp_servers.jev_dev.tools.jev_lint_semantic]\napproval_mode = "approve"\n`;
          fs.appendFileSync(codexConfigPath, tomlSnippet, "utf8");
          console.log(`  ✓ Configured Codex Desktop at ${codexConfigPath}`);
        } else {
          console.log(`  ✓ Codex Desktop already configured at ${codexConfigPath}`);
        }
        configuredAgentsCount++;
      } catch (err) {
        // Non-critical
      }
    }

    // Agent B: Claude Desktop
    const claudePath =
      process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
        : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");

    if (configureJsonMcpServer(claudePath, "Claude Desktop", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent C: Antigravity IDE / Desktop
    const antigravityPath = path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json");
    if (configureJsonMcpServer(antigravityPath, "Antigravity IDE", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent D: Cursor
    const cursorPath = path.join(os.homedir(), ".cursor", "mcp.json");
    if (configureJsonMcpServer(cursorPath, "Cursor", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent E: Windsurf (Codeium)
    const windsurfPath = path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
    if (configureJsonMcpServer(windsurfPath, "Windsurf", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent F: Trae
    const traePath = path.join(os.homedir(), ".trae", "mcp.json");
    if (configureJsonMcpServer(traePath, "Trae", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent G: VSCode (Cline)
    const clinePath =
      process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
        : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    if (configureJsonMcpServer(clinePath, "VSCode (Cline)", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent H: VSCode (Roo Code)
    const rooPath =
      process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json")
        : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json")
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
    if (configureJsonMcpServer(rooPath, "VSCode (Roo Code)", mcpEnv)) {
      configuredAgentsCount++;
    }

    // Agent I: VSCode (Continue)
    const continuePath = path.join(os.homedir(), ".continue", "config.json");
    if (configureJsonMcpServer(continuePath, "VSCode (Continue)", mcpEnv)) {
      configuredAgentsCount++;
    }

    if (configuredAgentsCount === 0) {
      console.log("  ℹ No existing agent MCP configs detected. You can easily connect any agent using the instructions in README.md");
    } else {
      console.log(`  🎉 ${configuredAgentsCount} AI coding agent(s) ready with Jev MCP!`);
    }

    // 4. Test connection live if key provided
    if (apiKey && provider !== "offline") {
      console.log("\n🧪 Testing Live API Connection...");
      try {
        const testClient = new SafeJevClient({
          apiKey,
          timeoutMs: 5000,
        });

        const testRes = await testClient.systemOne(
          { test: "connection-check" },
          { is_ready: noul("Is the service ready?") }
        );

        if (testRes.ok) {
          console.log(`  ✓ Connection SUCCESSFUL! Provider active: ${testRes.provider || provider}`);
        } else {
          console.log(`  ℹ Note: Test call returned fallback (${testRes.reason}). The harness will safely use deterministic heuristics when needed.`);
        }
      } catch (err) {
        console.log(`  ℹ Note: Could not complete live test (${(err as Error).message}). Fallback heuristics remain active.`);
      }
    }

    console.log("\n" + "=".repeat(78));
    console.log("🎉 Setup complete! Next steps:");
    console.log("  • Run live benchmark comparison: npx -y jev-dev compare");
    console.log("  • Rank context for a task:       npx -y jev-dev context rank --task \"your task\"");
    console.log("  • Check command safety:          npx -y jev-dev guard check --command \"git status\"");
    console.log("  • Start stdio MCP server:        npx -y jev-dev-harness");
    console.log("=".repeat(78) + "\n");
  } finally {
    rl.close();
  }
}
