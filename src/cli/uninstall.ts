import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { uninstallGitHook } from "../hooks/index.js";
import { printJevBanner } from "./banner.js";

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

function removeKeyFromJsonMcp(configPath: string, serverKey = "jev-dev"): boolean {
  try {
    if (!fs.existsSync(configPath)) return false;
    const content = fs.readFileSync(configPath, "utf8");
    const json = JSON.parse(content);
    if (json.mcpServers && json.mcpServers[serverKey]) {
      delete json.mcpServers[serverKey];
      fs.writeFileSync(configPath, JSON.stringify(json, null, 2), "utf8");
      return true;
    }
  } catch {}
  return false;
}

export interface UninstallOptions {
  purge?: boolean;
  global?: boolean;
  rules?: boolean;
  yes?: boolean;
}

export async function runUninstallCommand(options: UninstallOptions = {}): Promise<void> {
  printJevBanner("🧹 CLEAN UNINSTALLATION & TEARDOWN");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!options.yes) {
      console.log("This will safely remove:");
      console.log("  • All MCP server registrations from detected IDEs (Codex, Antigravity, Claude, Cursor, Trae, VSCode)");
      console.log("  • Git pre-commit safety hooks in the current project");
      console.log("  • Global configurations and telemetry stored in ~/.jev-dev/");
      console.log("");
      const confirm = (await ask(rl, "Are you sure you want to proceed? [y/N]: ")).trim().toLowerCase();
      if (confirm !== "y" && confirm !== "yes") {
        console.log("\n❌ Uninstallation cancelled. No changes were made.\n");
        return;
      }
    }

    const home = os.homedir();
    let removedMcpCount = 0;

    console.log("\n1. 🔌 Removing MCP Server Configurations from AI Agents...");

    // 1. Codex Desktop (~/.codex/config.toml)
    const codexPath = path.join(home, ".codex", "config.toml");
    if (fs.existsSync(codexPath)) {
      try {
        let content = fs.readFileSync(codexPath, "utf8");
        if (content.includes("[mcp_servers.jev_dev")) {
          // Remove all jev_dev blocks (main server, env, tools, etc.)
          content = content.replace(/\n?\[mcp_servers\.jev_dev[^\]]*\][\s\S]*?(?=\n\[|\n*$)/g, "");
          fs.writeFileSync(codexPath, content, "utf8");
          console.log(`  ✓ Cleaned Codex Desktop config at ${codexPath}`);
          removedMcpCount++;
        }
      } catch {}
    }

    // 2. Antigravity IDE
    const antigravityPath = path.join(home, ".gemini", "antigravity", "mcp_config.json");
    if (removeKeyFromJsonMcp(antigravityPath)) {
      console.log(`  ✓ Cleaned Antigravity IDE config at ${antigravityPath}`);
      removedMcpCount++;
    }

    // 3. Claude Desktop
    let claudePath = "";
    if (process.platform === "win32") {
      claudePath = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    } else if (process.platform === "darwin") {
      claudePath = path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    } else {
      claudePath = path.join(home, ".config", "Claude", "claude_desktop_config.json");
    }
    if (removeKeyFromJsonMcp(claudePath)) {
      console.log(`  ✓ Cleaned Claude Desktop config at ${claudePath}`);
      removedMcpCount++;
    }

    // 4. Cursor
    const cursorPath = path.join(home, ".cursor", "mcp.json");
    if (removeKeyFromJsonMcp(cursorPath)) {
      console.log(`  ✓ Cleaned Cursor config at ${cursorPath}`);
      removedMcpCount++;
    }

    // 5. Windsurf
    const windsurfPath = path.join(home, ".codeium", "windsurf", "mcp_config.json");
    if (removeKeyFromJsonMcp(windsurfPath)) {
      console.log(`  ✓ Cleaned Windsurf config at ${windsurfPath}`);
      removedMcpCount++;
    }

    // 6. Trae
    const traePath = path.join(home, ".trae", "mcp.json");
    if (removeKeyFromJsonMcp(traePath)) {
      console.log(`  ✓ Cleaned Trae config at ${traePath}`);
      removedMcpCount++;
    }

    // 7. VSCode (Cline)
    const clinePath = process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
      : process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
      : path.join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    if (removeKeyFromJsonMcp(clinePath)) {
      console.log(`  ✓ Cleaned VSCode (Cline) config at ${clinePath}`);
      removedMcpCount++;
    }

    // 8. VSCode (Roo Code)
    const rooPath = process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json")
      : process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json")
      : path.join(home, ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
    if (removeKeyFromJsonMcp(rooPath)) {
      console.log(`  ✓ Cleaned VSCode (Roo Code) config at ${rooPath}`);
      removedMcpCount++;
    }

    // 9. Continue.dev
    const continuePath = path.join(home, ".continue", "config.json");
    if (removeKeyFromJsonMcp(continuePath)) {
      console.log(`  ✓ Cleaned VSCode (Continue) config at ${continuePath}`);
      removedMcpCount++;
    }

    if (removedMcpCount === 0) {
      console.log("  ○ No active MCP server registrations found.");
    } else {
      console.log(`  🎉 Successfully removed Jev MCP from ${removedMcpCount} agent configuration(s).`);
    }

    // 2. Remove git pre-commit hooks in current repository
    console.log("\n2. 🪝 Uninstalling Git Pre-commit Hooks...");
    try {
      const hookResult = uninstallGitHook(process.cwd());
      console.log(`  ✓ ${hookResult.message}`);
    } catch {
      console.log("  ○ No active git repository or hook found in current directory.");
    }

    // 3. Remove ~/.jev-dev global data
    console.log("\n3. 📁 Purging ~/.jev-dev Configuration & Telemetry Directory...");
    const globalDir = path.join(home, ".jev-dev");
    if (fs.existsSync(globalDir)) {
      try {
        fs.rmSync(globalDir, { recursive: true, force: true });
        console.log(`  ✓ Removed directory ${globalDir}`);
      } catch (err) {
        console.error(`  ⚠ Could not completely remove ${globalDir}: ${(err as Error).message}`);
      }
    } else {
      console.log(`  ○ ${globalDir} does not exist.`);
    }

    // 4. Optionally remove rule files in current directory
    if (options.rules) {
      console.log("\n4. 📜 Cleaning Agent Rule Files in Current Project...");
      const ruleFiles = [
        path.join(process.cwd(), "GEMINI.md"),
        path.join(process.cwd(), "CLAUDE.md"),
        path.join(process.cwd(), ".cursorrules"),
        path.join(process.cwd(), ".github", "copilot-instructions.md"),
      ];
      for (const rf of ruleFiles) {
        if (fs.existsSync(rf)) {
          try {
            fs.unlinkSync(rf);
            console.log(`  ✓ Removed ${rf}`);
          } catch {}
        }
      }
    }

    // 5. Global NPM uninstall
    let doGlobalUninstall = options.global;
    if (doGlobalUninstall === undefined && !options.yes) {
      console.log("");
      const askNpm = (await ask(rl, "Do you also want to uninstall the global npm package 'jev-dev-harness'? [y/N]: ")).trim().toLowerCase();
      doGlobalUninstall = askNpm === "y" || askNpm === "yes";
    }

    if (doGlobalUninstall) {
      console.log("\n5. 📦 Uninstalling Global NPM Package...");
      try {
        execSync("npm uninstall -g jev-dev-harness", { stdio: "inherit" });
        console.log("\n  ✓ Global npm package uninstalled successfully.");
      } catch {
        console.log("\n  ⚠ Could not run 'npm uninstall -g jev-dev-harness'. You can run it manually.");
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("✨ Jev Developer Harness uninstalled cleanly. No residual configs remain!");
    console.log("=".repeat(70) + "\n");
  } finally {
    rl.close();
  }
}
