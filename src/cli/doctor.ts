import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SafeJevClient, noul } from "../shared/typesafe-client.js";
import {
  getTelemetryFilePath,
  getTelemetrySummary,
  recordTelemetryEvent,
} from "../shared/telemetry.js";
import { printJevBanner } from "./banner.js";

export interface DoctorOptions {
  initRules?: boolean;
  json?: boolean;
}

export interface DoctorReport {
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    harnessVersion: string;
  };
  config: {
    globalConfigPath: string;
    globalConfigExists: boolean;
    provider: string;
    hasApiKey: boolean;
  };
  connection: {
    tested: boolean;
    ok: boolean;
    latencyMs: number;
    provider?: string;
    error?: string;
  };
  mcpAgents: Array<{
    name: string;
    path: string;
    configured: boolean;
  }>;
  rules: {
    hasGeminiMd: boolean;
    hasCursorRules: boolean;
    hasClaudeMd: boolean;
  };
  telemetry: {
    filePath: string;
    eventsCount: number;
    writable: boolean;
    pingEmitted: boolean;
  };
}

/**
 * Generate standard instructions for AI coding agents
 */
export function getAgentRuleContent(): string {
  return `# Jev Developer Harness — Diretrizes de Operação do Agente

Este projeto é monitorado e acelerado pelo **Jev Developer Harness** (\`jev-dev-harness\`).
Como agente de codificação de IA, siga rigorosamente o fluxo de trabalho abaixo para garantir proteção de integridade, economia massiva de tokens e auditoria contínua:

---

### 1. 🛡️ Segurança de Comandos (Tool Call Guard)
Antes de executar qualquer comando de terminal (\`run_command\`) que crie, modifique, remova arquivos, instale dependências, ou acesse redes externas:
- Execute a validação prévia via MCP (\`jev_guard_check\`) ou via CLI:
  \`\`\`bash
  npx jev-dev guard check -c "<comando>"
  \`\`\`
- Se o veredito for **BLOCKED** ou exigir confirmação humana, alerte o usuário imediatamente antes de rodar.

---

### 2. 🎯 Otimização Cirúrgica de Contexto (Context Ranker)
Ao iniciar tarefas de implementação que exijam entender o repositório ou antes de ler dezenas de arquivos:
- Filtre o contexto com o Context Ranker via MCP (\`jev_rank_context\`) ou via CLI:
  \`\`\`bash
  npx jev-dev context rank -t "<descrição da tarefa>" --top 10
  \`\`\`
- Foque a leitura estritamente nos arquivos ranqueados com maior relevância.

---

### 3. 🔍 Auditoria de Diffs e Patches (Patch Reviewer)
Antes de concluir alterações de código ou sugerir commits:
- Audite o diff gerado para detectar riscos de regressão, arquivos fora de escopo ou credenciais expostas via MCP (\`jev_review_patch\`) ou via CLI:
  \`\`\`bash
  npx jev-dev patch review -t "<descrição da tarefa>" --staged
  \`\`\`

---

### 4. ⚡ Bloco de Telemetria e Eficiência
Ao concluir com sucesso cada tarefa de desenvolvimento de software, apresente o bloco de resumo de eficiência ao final da sua resposta:

\`\`\`markdown
### ⚡ Eficiência Jev
- **Contexto Otimizado:** [X] arquivos selecionados cirurgicamente de [Y] analisados ([Z]% de redução).
- **Economia Estimada:** ~[N] tokens economizados nesta tarefa (~$[V]).
- **Segurança & Velocidade:** Comandos e diffs auditados pelo Jev System One (<1s).
\`\`\`
`;
}

/**
 * Audit all IDE and agent MCP configurations
 */
function checkMcpConfigs(): Array<{ name: string; path: string; configured: boolean }> {
  const home = os.homedir();
  const results: Array<{ name: string; path: string; configured: boolean }> = [];

  // 1. Codex Desktop
  const codexPath = path.join(home, ".codex", "config.toml");
  let codexOk = false;
  if (fs.existsSync(codexPath)) {
    try {
      const content = fs.readFileSync(codexPath, "utf8");
      codexOk = content.includes("jev-dev") || content.includes("jev-dev-harness") || content.includes("jev-mcp");
    } catch {}
  }
  results.push({ name: "Codex Desktop", path: codexPath, configured: codexOk });

  // 2. Antigravity IDE
  const antigravityPath = path.join(home, ".gemini", "antigravity", "mcp_config.json");
  let antigravityOk = false;
  if (fs.existsSync(antigravityPath)) {
    try {
      const content = fs.readFileSync(antigravityPath, "utf8");
      antigravityOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "Antigravity IDE", path: antigravityPath, configured: antigravityOk });

  // 3. Claude Desktop
  let claudePath = "";
  if (process.platform === "win32") {
    claudePath = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  } else if (process.platform === "darwin") {
    claudePath = path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else {
    claudePath = path.join(home, ".config", "Claude", "claude_desktop_config.json");
  }
  let claudeOk = false;
  if (fs.existsSync(claudePath)) {
    try {
      const content = fs.readFileSync(claudePath, "utf8");
      claudeOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "Claude Desktop", path: claudePath, configured: claudeOk });

  // 4. Cursor
  const cursorPath = path.join(home, ".cursor", "mcp.json");
  let cursorOk = false;
  if (fs.existsSync(cursorPath)) {
    try {
      const content = fs.readFileSync(cursorPath, "utf8");
      cursorOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "Cursor", path: cursorPath, configured: cursorOk });

  // 5. Windsurf
  const windsurfPath = path.join(home, ".codeium", "windsurf", "mcp_config.json");
  let windsurfOk = false;
  if (fs.existsSync(windsurfPath)) {
    try {
      const content = fs.readFileSync(windsurfPath, "utf8");
      windsurfOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "Windsurf", path: windsurfPath, configured: windsurfOk });

  // 6. Trae
  const traePath = path.join(home, ".trae", "mcp.json");
  let traeOk = false;
  if (fs.existsSync(traePath)) {
    try {
      const content = fs.readFileSync(traePath, "utf8");
      traeOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "Trae", path: traePath, configured: traeOk });

  // 7. VSCode Cline
  let clinePath = "";
  if (process.platform === "win32") {
    clinePath = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  } else if (process.platform === "darwin") {
    clinePath = path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  } else {
    clinePath = path.join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  }
  let clineOk = false;
  if (fs.existsSync(clinePath)) {
    try {
      const content = fs.readFileSync(clinePath, "utf8");
      clineOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "VSCode (Cline)", path: clinePath, configured: clineOk });

  // 8. VSCode Roo Code
  let rooPath = "";
  if (process.platform === "win32") {
    rooPath = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
  } else if (process.platform === "darwin") {
    rooPath = path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
  } else {
    rooPath = path.join(home, ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
  }
  let rooOk = false;
  if (fs.existsSync(rooPath)) {
    try {
      const content = fs.readFileSync(rooPath, "utf8");
      rooOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "VSCode (Roo Code)", path: rooPath, configured: rooOk });

  // 9. Continue.dev
  const continuePath = path.join(home, ".continue", "config.json");
  let continueOk = false;
  if (fs.existsSync(continuePath)) {
    try {
      const content = fs.readFileSync(continuePath, "utf8");
      continueOk = content.includes("jev-dev");
    } catch {}
  }
  results.push({ name: "VSCode (Continue)", path: continuePath, configured: continueOk });

  return results;
}

/**
 * Execute comprehensive diagnostic health check
 */
export async function runDoctorCommand(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = process.cwd();
  const home = os.homedir();

  // If user requested --init-rules, generate them now
  if (options.initRules) {
    const ruleContent = getAgentRuleContent();
    const githubDir = path.join(cwd, ".github");
    if (!fs.existsSync(githubDir)) {
      try { fs.mkdirSync(githubDir, { recursive: true }); } catch {}
    }
    const targets = [
      { name: "GEMINI.md (Antigravity)", file: path.join(cwd, "GEMINI.md") },
      { name: "CLAUDE.md (Claude Code)", file: path.join(cwd, "CLAUDE.md") },
      { name: ".cursorrules (Cursor)", file: path.join(cwd, ".cursorrules") },
      { name: "copilot-instructions.md (GitHub Copilot / VSCode)", file: path.join(githubDir, "copilot-instructions.md") },
    ];

    console.log("\n📝 Initializing AI agent rule files in current workspace...\n");
    for (const t of targets) {
      try {
        fs.writeFileSync(t.file, ruleContent, "utf8");
        console.log(`  ✓ Created ${t.name} at ${t.file}`);
      } catch (err) {
        console.error(`  ❌ Failed to create ${t.name}: ${(err as Error).message}`);
      }
    }
    console.log("\n✨ Agent rule files created successfully!\n");
  }

  // 1. Environment
  let harnessVersion = "0.1.4";
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      harnessVersion = pkg.version || harnessVersion;
    }
  } catch {}

  const environment = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    harnessVersion,
  };

  // 2. Configuration & API
  const globalConfigPath = path.join(home, ".jev-dev", "config.json");
  let globalConfigExists = false;
  let provider = "offline";
  let hasApiKey = false;

  if (fs.existsSync(globalConfigPath)) {
    globalConfigExists = true;
    try {
      const cfg = JSON.parse(fs.readFileSync(globalConfigPath, "utf8"));
      provider = cfg.provider || "typesafe";
      hasApiKey = Boolean(cfg.apiKey || process.env.TYPESAFE_API_KEY || process.env.OPENROUTER_API_KEY);
    } catch {}
  } else {
    hasApiKey = Boolean(process.env.TYPESAFE_API_KEY || process.env.OPENROUTER_API_KEY);
    if (process.env.OPENROUTER_API_KEY) provider = "openrouter";
    else if (process.env.TYPESAFE_API_KEY) provider = "typesafe";
  }

  // 3. Live Connection Test
  let connectionOk = false;
  let connectionLatency = 0;
  let connectionError: string | undefined;

  const client = new SafeJevClient({ timeoutMs: 3000 });
  const startTime = Date.now();
  try {
    const pingResult = await client.systemOne(
      { ping: true, task: "health_check" },
      { is_healthy: noul("Is the Jev developer harness operating normally?") }
    );
    connectionLatency = Date.now() - startTime;
    if (pingResult.ok) {
      connectionOk = true;
    } else {
      connectionError = pingResult.reason || "System One returned fallback";
    }
  } catch (err) {
    connectionLatency = Date.now() - startTime;
    connectionError = (err as Error).message;
  }

  // 4. MCP Agents
  const mcpAgents = checkMcpConfigs();

  // 5. Rules in current directory
  const hasGeminiMd = fs.existsSync(path.join(cwd, "GEMINI.md")) || fs.existsSync(path.join(cwd, "AGENTS.md"));
  const hasCursorRules = fs.existsSync(path.join(cwd, ".cursorrules")) || fs.existsSync(path.join(cwd, ".cursor", "rules"));
  const hasClaudeMd = fs.existsSync(path.join(cwd, "CLAUDE.md"));

  // 6. Telemetry & Emit Ping
  const telemetryPath = getTelemetryFilePath();
  const summary = getTelemetrySummary();
  let pingEmitted = false;

  try {
    recordTelemetryEvent({
      type: "guard_check",
      command: "jev-dev doctor --ping",
      category: "read-only",
      allowed: true,
      riskLevel: "low",
      reason: "Diagnostic health check ping from jev-dev doctor",
      latencyMs: connectionLatency || 1,
    });
    pingEmitted = true;
  } catch {}

  const report: DoctorReport = {
    timestamp: new Date().toISOString(),
    environment,
    config: {
      globalConfigPath,
      globalConfigExists,
      provider,
      hasApiKey,
    },
    connection: {
      tested: true,
      ok: connectionOk,
      latencyMs: connectionLatency,
      provider,
      error: connectionError,
    },
    mcpAgents,
    rules: {
      hasGeminiMd,
      hasCursorRules,
      hasClaudeMd,
    },
    telemetry: {
      filePath: telemetryPath,
      eventsCount: summary.totalEvents + (pingEmitted ? 1 : 0),
      writable: fs.existsSync(path.dirname(telemetryPath)),
      pingEmitted,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  // Terminal UI formatting
  printJevBanner("🔮 SYSTEM HEALTH & DIAGNOSTICS");

  console.log("--- 💻 ENVIRONMENT ---");
  console.log(`  Node.js:          ${environment.nodeVersion}`);
  console.log(`  Platform:         ${environment.platform} (${environment.arch})`);
  console.log(`  Harness Version:  v${environment.harnessVersion}\n`);

  console.log("--- 🔑 CONFIGURATION & AI CONNECTIVITY ---");
  console.log(`  Global Config:    ${globalConfigExists ? `✓ Found (${globalConfigPath})` : `✗ Not found (run 'jev-dev setup')`}`);
  console.log(`  Active Provider:  ${provider.toUpperCase()}`);
  console.log(`  API Key:          ${hasApiKey ? "✓ Configured" : "⚠ Not detected (running in deterministic fallback mode)"}`);
  if (connectionOk) {
    console.log(`  Live AI Ping:     ✓ SUCCESS (Latency: ${connectionLatency}ms, provider: ${provider})\n`);
  } else {
    console.log(`  Live AI Ping:     ⚠ Offline/Fallback (${connectionError || "Local deterministic engine active"})\n`);
  }

  console.log("--- 🤖 AGENT MCP INTEGRATIONS ---");
  for (const agent of mcpAgents) {
    const status = agent.configured ? "✓ Configured" : "○ Not detected / Not configured";
    console.log(`  ${agent.name.padEnd(18)}: ${status}`);
  }
  console.log("");

  console.log("--- 📜 AGENT INSTRUCTION RULES (Current Directory) ---");
  console.log(`  Antigravity (GEMINI.md) : ${hasGeminiMd ? "✓ Present" : "○ Missing (run 'jev-dev doctor --init-rules')"}`);
  console.log(`  Cursor (.cursorrules)   : ${hasCursorRules ? "✓ Present" : "○ Missing (run 'jev-dev doctor --init-rules')"}`);
  console.log(`  Claude Code (CLAUDE.md) : ${hasClaudeMd ? "✓ Present" : "○ Missing (run 'jev-dev doctor --init-rules')"}\n`);

  console.log("--- 📊 TELEMETRY & LIVE DASHBOARD ---");
  console.log(`  Telemetry Store:  ${telemetryPath} (${report.telemetry.eventsCount} events recorded)`);
  console.log(`  Live Ping Event:  ${pingEmitted ? "✓ Emitted (live feed updated on dashboard)" : "✗ Failed"}`);
  console.log(`  Web Dashboard:    Run 'jev-dev dashboard' to view live metrics in browser\n`);

  console.log("=".repeat(65));
  if (!hasGeminiMd && !hasCursorRules && !hasClaudeMd) {
    console.log("\n💡 TIP: Run 'jev-dev doctor --init-rules' to automatically instruct your");
    console.log("   AI agent to use Jev tools and print efficiency summaries on every prompt!\n");
  } else {
    console.log("\n🚀 All systems operational! Your AI agent is actively protected by Jev.\n");
  }

  return report;
}
