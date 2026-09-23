import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { SafeJevClient, noul } from "../shared/typesafe-client.js";
import { getAgentRuleContent } from "./doctor.js";

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

function configureJsonMcpServer(
  configPath: string,
  agentName: string,
  envVars: Record<string, string>,
  platformName?: string
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
      env: {
        ...envVars,
        ...(platformName ? { JEV_CLIENT_PLATFORM: platformName } : {}),
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    console.log(`  ✓ Configured ${agentName} at ${configPath}`);
    return true;
  } catch {
    return false;
  }
}

export interface SetupOptions {
  provider?: "typesafe" | "vercel" | "openrouter" | "offline";
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
      console.log("      🔗 Generate key: https://typesafe.ai (Dashboard: https://typesafe.ai/dashboard)");
      console.log("  [2] Vercel AI Gateway (Free Tier credits — access TypeSafe Jev via Vercel)");
      console.log("      🔗 Generate key: https://vercel.com/d/ai-gateway (Dashboard: https://vercel.com/dashboard)");
      console.log("  [3] OpenRouter / OpenCode (Community — DeepSeek V4, Claude 3.5, GPT-4o-mini)");
      console.log("      🔗 Generate key: https://openrouter.ai/keys (or https://openrouter.ai)");
      console.log("  [4] Offline / Deterministic Only (Heuristics & regex — no API key needed)\n");

      const choice = (await ask(rl, "Enter choice [1-4] (default: 1): ")).trim();
      if (choice === "2") {
        provider = "vercel";
      } else if (choice === "3") {
        provider = "openrouter";
      } else if (choice === "4") {
        provider = "offline";
      } else {
        provider = "typesafe";
      }
    } else if (!provider) {
      provider = "typesafe";
    }

    // Detect existing keys across global config, current .env, and process.env
    const globalConfigFile = path.join(os.homedir(), ".jev-dev", "config.json");
    let existingGlobal: any = {};
    if (fs.existsSync(globalConfigFile)) {
      try {
        existingGlobal = JSON.parse(fs.readFileSync(globalConfigFile, "utf8")) || {};
      } catch {}
    }

    const envPath = path.resolve(".env");
    const existingEnvVars: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
      try {
        const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^([A-Z_]+)=(.*)$/);
          if (match && match[1] && match[2] !== undefined) {
            existingEnvVars[match[1]] = match[2].trim();
          }
        }
      } catch {}
    }

    const existingTypeSafeKey =
      existingGlobal.keys?.typesafe ||
      (existingGlobal.provider === "typesafe" ? existingGlobal.apiKey : undefined) ||
      existingEnvVars["TYPESAFE_API_KEY"] ||
      existingEnvVars["JEV_API_KEY"] ||
      process.env.TYPESAFE_API_KEY ||
      process.env.JEV_API_KEY;

    const existingVercelKey =
      existingGlobal.keys?.vercel ||
      (existingGlobal.provider === "vercel" ? existingGlobal.apiKey : undefined) ||
      existingEnvVars["AI_GATEWAY_API_KEY"] ||
      existingEnvVars["VERCEL_AI_GATEWAY_KEY"] ||
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_AI_GATEWAY_KEY;

    const existingOpenRouterKey =
      existingGlobal.keys?.openrouter ||
      (existingGlobal.provider === "openrouter" ? existingGlobal.apiKey : undefined) ||
      existingEnvVars["OPENROUTER_API_KEY"] ||
      process.env.OPENROUTER_API_KEY;

    let apiKey = options.key;
    let model = options.model;

    if (provider === "typesafe") {
      if (!apiKey && !options.nonInteractive) {
        console.log("\n🔑 TypeSafe AI Configuration:");
        console.log("  📌 How to generate your API key:");
        console.log("     1. Visit:     👉 https://typesafe.ai");
        console.log("     2. Dashboard: 👉 https://typesafe.ai/dashboard");
        if (existingTypeSafeKey) {
          const masked = existingTypeSafeKey.slice(0, 4) + "..." + existingTypeSafeKey.slice(-4);
          const input = (await ask(rl, `     (Existing key: ${masked}) - Press Enter to keep or paste new: `)).trim();
          apiKey = input || existingTypeSafeKey;
        } else {
          console.log("     3. Copy your key and paste it below:\n");
          apiKey = (await ask(rl, "Paste your TYPESAFE_API_KEY (or press Enter to skip): ")).trim();
        }
      } else if (!apiKey && existingTypeSafeKey) {
        apiKey = existingTypeSafeKey;
      }
    } else if (provider === "vercel") {
      if (!apiKey && !options.nonInteractive) {
        console.log("\n🔑 Vercel AI Gateway Configuration (Free Tier Credits):");
        console.log("  📌 How to generate your API key:");
        console.log("     1. Visit:     👉 https://vercel.com/d/ai-gateway");
        console.log("     2. Dashboard: 👉 https://vercel.com/dashboard (AI Gateway → API Keys)");
        if (existingVercelKey) {
          const masked = existingVercelKey.slice(0, 4) + "..." + existingVercelKey.slice(-4);
          const input = (await ask(rl, `     (Existing key: ${masked}) - Press Enter to keep or paste new: `)).trim();
          apiKey = input || existingVercelKey;
        } else {
          console.log("     3. Copy your key and paste it below:\n");
          apiKey = (await ask(rl, "Paste your AI_GATEWAY_API_KEY (or press Enter to skip): ")).trim();
        }
      } else if (!apiKey && existingVercelKey) {
        apiKey = existingVercelKey;
      }
    } else if (provider === "openrouter") {
      if (!apiKey && !options.nonInteractive) {
        console.log("\n🔑 OpenRouter / OpenCode Configuration:");
        console.log("  📌 How to generate your API key:");
        console.log("     1. Visit:     👉 https://openrouter.ai/keys");
        console.log("     2. Website:   👉 https://openrouter.ai");
        if (existingOpenRouterKey) {
          const masked = existingOpenRouterKey.slice(0, 4) + "..." + existingOpenRouterKey.slice(-4);
          const input = (await ask(rl, `     (Existing key: ${masked}) - Press Enter to keep or paste new: `)).trim();
          apiKey = input || existingOpenRouterKey;
        } else {
          console.log("     3. Click 'Create Key' and paste it below:\n");
          apiKey = (await ask(rl, "Paste your OPENROUTER_API_KEY (or press Enter to skip): ")).trim();
        }
      } else if (!apiKey && existingOpenRouterKey) {
        apiKey = existingOpenRouterKey;
      }

      if (!model && !options.nonInteractive) {
        const defaultModel = existingGlobal.model || "deepseek/deepseek-v4-flash";
        console.log(`\n🤖 Target Model for System One judgments (default: ${defaultModel})`);
        console.log("   Popular choices: deepseek/deepseek-v4-flash, anthropic/claude-3.5-haiku, openai/gpt-4o-mini");
        const modelInput = (
          await ask(rl, `Enter model slug (default: ${defaultModel}): `)
        ).trim();
        model = modelInput || defaultModel;
      } else if (!model && existingGlobal.model) {
        model = existingGlobal.model;
      }
    }

    // Save configurations
    console.log("\n💾 Saving Configurations...");

    // 1. Save to local .env in current directory (preserving existing keys of other providers)
    existingEnvVars["JEV_PROVIDER"] = provider;
    if (provider === "vercel" && apiKey) {
      existingEnvVars["AI_GATEWAY_API_KEY"] = apiKey;
    } else if (provider === "typesafe" && apiKey) {
      existingEnvVars["TYPESAFE_API_KEY"] = apiKey;
    } else if (provider === "openrouter" && apiKey) {
      existingEnvVars["OPENROUTER_API_KEY"] = apiKey;
      if (model) existingEnvVars["OPENROUTER_MODEL"] = model;
    }

    const envLines: string[] = [];
    for (const [k, v] of Object.entries(existingEnvVars)) {
      envLines.push(`${k}=${v}`);
    }
    fs.writeFileSync(envPath, envLines.join("\n") + "\n", "utf8");
    console.log(`  ✓ Updated local .env at ${envPath} (JEV_PROVIDER=${provider})`);

    // 2. Save to global config directory (~/.jev-dev/config.json)
    const globalConfigDir = path.join(os.homedir(), ".jev-dev");
    if (!fs.existsSync(globalConfigDir)) {
      fs.mkdirSync(globalConfigDir, { recursive: true });
    }
    const keysMap = existingGlobal.keys || {};
    if (existingTypeSafeKey) keysMap.typesafe = existingTypeSafeKey;
    if (existingVercelKey) keysMap.vercel = existingVercelKey;
    if (existingOpenRouterKey) keysMap.openrouter = existingOpenRouterKey;
    if (apiKey) keysMap[provider] = apiKey;

    const globalData = {
      provider,
      apiKey: apiKey || keysMap[provider] || undefined,
      model: model || existingGlobal.model || undefined,
      keys: keysMap,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(globalConfigFile, JSON.stringify(globalData, null, 2), "utf8");
    console.log(`  ✓ Saved global config at ${globalConfigFile}`);

    // 3. Detect and automatically configure Coding Agents (Codex, Claude, Antigravity, Cursor, Windsurf, Trae)
    console.log("\n🤖 Detecting and Configuring AI Coding Agents...");
    let configuredAgentsCount = 0;

    const mcpEnv: Record<string, string> = {
      JEV_PROVIDER: provider,
    };
    if (provider === "vercel" && apiKey) {
      mcpEnv["AI_GATEWAY_API_KEY"] = apiKey;
    } else if (provider === "openrouter" && apiKey) {
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
          const tomlSnippet = `\n[mcp_servers.jev_dev]\ncommand = "npx"\nargs = ["-y", "jev-dev-harness"]\nstartup_timeout_sec = 60.0\n\n[mcp_servers.jev_dev.env]\nJEV_CLIENT_PLATFORM = "Codex"\n${
            provider === "vercel"
              ? `JEV_PROVIDER = "vercel"\nAI_GATEWAY_API_KEY = "${apiKey || ""}"`
              : provider === "openrouter"
              ? `JEV_PROVIDER = "openrouter"\nOPENROUTER_API_KEY = "${apiKey || ""}"\nOPENROUTER_MODEL = "${model || "deepseek/deepseek-v4-flash"}"`
              : `JEV_PROVIDER = "typesafe"\nTYPESAFE_API_KEY = "${apiKey || ""}"`
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

    if (configureJsonMcpServer(claudePath, "Claude Desktop", mcpEnv, "Claude")) {
      configuredAgentsCount++;
    }

    // Agent C: Antigravity IDE / Desktop
    const antigravityPath = path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json");
    if (configureJsonMcpServer(antigravityPath, "Antigravity IDE", mcpEnv, "Antigravity")) {
      configuredAgentsCount++;
    }

    // Agent D: Cursor
    const cursorPath = path.join(os.homedir(), ".cursor", "mcp.json");
    if (configureJsonMcpServer(cursorPath, "Cursor", mcpEnv, "Cursor")) {
      configuredAgentsCount++;
    }

    // Agent E: Windsurf (Codeium)
    const windsurfPath = path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
    if (configureJsonMcpServer(windsurfPath, "Windsurf", mcpEnv, "Windsurf")) {
      configuredAgentsCount++;
    }

    // Agent F: Trae
    const traePath = path.join(os.homedir(), ".trae", "mcp.json");
    if (configureJsonMcpServer(traePath, "Trae", mcpEnv, "Trae")) {
      configuredAgentsCount++;
    }

    // Agent G: VSCode (Cline)
    const clinePath =
      process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
        : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    if (configureJsonMcpServer(clinePath, "VSCode (Cline)", mcpEnv, "Cline")) {
      configuredAgentsCount++;
    }

    // Agent H: VSCode (Roo Code)
    const rooPath =
      process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json")
        : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json")
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
    if (configureJsonMcpServer(rooPath, "VSCode (Roo Code)", mcpEnv, "Roo Code")) {
      configuredAgentsCount++;
    }

    // Agent I: VSCode (Continue)
    const continuePath = path.join(os.homedir(), ".continue", "config.json");
    if (configureJsonMcpServer(continuePath, "VSCode (Continue)", mcpEnv, "Continue")) {
      configuredAgentsCount++;
    }

    if (configuredAgentsCount === 0) {
      console.log("  ℹ No existing agent MCP configs detected. You can easily connect any agent using the instructions in README.md");
    } else {
      console.log(`  🎉 ${configuredAgentsCount} AI coding agent(s) ready with Jev MCP!`);
    }

    // 4. Initialize agent instruction rules in current workspace
    console.log("\n📝 Ensuring AI agent rule files in current workspace...");
    const ruleContent = getAgentRuleContent();
    const githubDir = path.join(process.cwd(), ".github");
    if (!fs.existsSync(githubDir)) {
      try { fs.mkdirSync(githubDir, { recursive: true }); } catch {}
    }
    const ruleTargets = [
      { name: "CODEX.md (Codex / VS Code)", file: path.join(process.cwd(), "CODEX.md") },
      { name: "CLAUDE.md (Claude Code)", file: path.join(process.cwd(), "CLAUDE.md") },
      { name: "GEMINI.md (Antigravity)", file: path.join(process.cwd(), "GEMINI.md") },
      { name: ".clinerules (VS Code Cline & Roo Code)", file: path.join(process.cwd(), ".clinerules") },
      { name: ".cursorrules (Cursor)", file: path.join(process.cwd(), ".cursorrules") },
      { name: ".windsurfrules (Windsurf)", file: path.join(process.cwd(), ".windsurfrules") },
      { name: "copilot-instructions.md (GitHub Copilot / VS Code)", file: path.join(githubDir, "copilot-instructions.md") },
    ];
    for (const t of ruleTargets) {
      if (!fs.existsSync(t.file)) {
        try {
          fs.writeFileSync(t.file, ruleContent, "utf8");
          console.log(`  ✓ Created ${t.name}`);
        } catch {}
      } else {
        console.log(`  ✓ Found ${t.name}`);
      }
    }

    // 5. Test connection live if key provided
    if (apiKey && provider !== "offline") {
      console.log("\n🧪 Testing Live API Connection...");
      try {
        const testClient = new SafeJevClient({
          provider: provider as any,
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

    if (!apiKey && provider !== "offline") {
      console.log("\n💡 Skipped entering an API key for now? You can generate one anytime at:");
      console.log("  • TypeSafe AI:       👉 https://typesafe.ai (Dashboard: https://typesafe.ai/dashboard)");
      console.log("  • Vercel AI Gateway: 👉 https://vercel.com/d/ai-gateway (Free Tier credits)");
      console.log("  • OpenRouter:        👉 https://openrouter.ai/keys (Website: https://openrouter.ai)");
      console.log("  Then simply re-run: 'npx jev-dev setup' or edit ~/.jev-dev/config.json");
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
