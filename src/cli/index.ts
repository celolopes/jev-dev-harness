import { Command } from "commander";
import path from "node:path";
import { execSync } from "node:child_process";
import { rankContext } from "../context-ranker/index.js";
import { installGitHook, uninstallGitHook } from "../hooks/index.js";
import { reviewPatchPipeline } from "../patch-reviewer/index.js";
import { lintSemantic } from "../semantic-linter/index.js";
import { guardCheck } from "../tool-guard/index.js";
import { rankTools } from "../tool-ranker/index.js";
import { startProxyServer } from "../proxy/index.js";
import { startMcpServer } from "../mcp/index.js";
import { printTerminalComparison } from "./compare.js";
import { runSetupWizard } from "./setup.js";
import { runProviderCommand } from "./provider.js";
import { startDashboardServer } from "./dashboard.js";
import { runDoctorCommand } from "./doctor.js";
import { runUninstallCommand } from "./uninstall.js";
import { checkForUpdates, printUpdateNotification } from "../shared/update-checker.js";
import { recordTelemetryEvent } from "../shared/telemetry.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("jev-dev")
    .description("Developer Harness with TypeSafe AI / Jev for AI Coding Agents")
    .version("0.2.3");

  // ==========================================
  // COMMAND: context rank (Phase 2)
  // ==========================================
  const contextCommand = program
    .command("context")
    .description("Context management and intelligent selection");

  contextCommand
    .command("rank")
    .description("Rank candidate files and snippets for a given coding task")
    .requiredOption("-t, --task <task>", "Task description or objective")
    .option("-p, --path <path>", "Repository path", ".")
    .option("--top <number>", "Maximum number of files to select", (val) => parseInt(val, 10), 10)
    .option("--threshold <number>", "Minimum score threshold", (val) => parseFloat(val), 0.15)
    .option("--json", "Output machine-readable stable JSON format", false)
    .option("--no-cache", "Disable caching")
    .option("--no-jev", "Disable Jev semantic evaluation (force deterministic fallback)")
    .option("--platform <platform>", "Originating agent platform (e.g. Codex, Claude, Trae, Antigravity)")
    .action(async (options) => {
      try {
        const repoPath = path.resolve(options.path);

        const result = await rankContext({
          task: options.task,
          repoPath,
          top: options.top,
          threshold: options.threshold,
          useCache: options.cache !== false,
          useJev: options.jev !== false,
        });

        recordTelemetryEvent({
          type: "context_rank",
          task: result.task,
          initialCandidates: result.metrics.initialCandidates,
          selectedFiles: result.selected.length,
          tokensSaved: Math.round((result.metrics.initialCandidates - result.selected.length) * 800),
          reductionPct:
            result.metrics.initialCandidates > 0
              ? Math.round(
                  ((result.metrics.initialCandidates - result.selected.length) /
                    result.metrics.initialCandidates) *
                    100
                )
              : 0,
          latencyMs: result.metrics.latencyMs,
          platform: options.platform,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n=======================================================");
        console.log("             JEV CONTEXT RANKER (PHASE 2)             ");
        console.log("=======================================================\n");
        console.log(`Task:        ${result.task}`);
        console.log(`Repository:  ${result.repoPath}`);
        console.log(
          `Mode:        ${
            result.fallbackUsed
              ? `[FALLBACK] Deterministic (${result.metrics.fallbackReason || "Active"})`
              : `[ACTIVE] ${result.metrics.provider === "openrouter" ? "OpenRouter (typesafe/jev-latest)" : "TypeSafe Jev System One"}`
          }`
        );
        console.log(`Selected:    ${result.selected.length} file(s)\n`);

        if (result.selected.length === 0) {
          console.log("  No matching files exceeded the relevance threshold.\n");
        } else {
          console.log("--- RANKED CONTEXT FILES ---");
          result.selected.forEach((item, index) => {
            const pctScore = (item.score * 100).toFixed(1);
            const pctConf = (item.confidence * 100).toFixed(0);
            console.log(
              `#${index + 1} [${pctScore}% | conf: ${pctConf}% | ${item.role}] ${item.path}`
            );
            console.log(`    Reason: ${item.reason}`);
          });
          console.log("");
        }

        console.log("--- METRICS & TELEMETRY ---");
        console.log(`  Initial files:     ${result.metrics.initialCandidates}`);
        console.log(`  Filtered files:    ${result.metrics.filteredCandidates}`);
        console.log(`  Evaluated by Jev:  ${result.metrics.evaluatedByJev}`);
        console.log(`  Tokens (in/out):   ${result.metrics.tokensSent} / ${result.metrics.tokensReceived}`);
        console.log(`  Cache hits/misses: ${result.metrics.cacheHits} / ${result.metrics.cacheMisses}`);
        console.log(`  Total latency:     ${result.metrics.latencyMs}ms`);
        console.log("=======================================================\n");
      } catch (err) {
        console.error("Error executing context ranker:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: patch review (Phase 3)
  // ==========================================
  const patchCommand = program
    .command("patch")
    .description("Patch and diff audit before commits or pull requests");

  patchCommand
    .command("review")
    .description("Audit a git diff against a task description for scope, regression risk, and secrets")
    .requiredOption("-t, --task <task>", "Task description or objective")
    .option("-p, --path <path>", "Repository path", ".")
    .option("--diff <string>", "Raw unified diff string")
    .option("--diff-file <path>", "Path to diff file")
    .option("--staged", "Audit staged changes (git diff --staged)", false)
    .option("--commit-range <range>", "Git commit range (e.g. HEAD~1)")
    .option("--json", "Output machine-readable stable JSON format", false)
    .option("--no-jev", "Disable Jev semantic evaluation (force deterministic fallback)")
    .option("--platform <platform>", "Originating agent platform (e.g. Codex, Claude, Trae, Antigravity)")
    .action(async (options) => {
      try {
        const repoPath = path.resolve(options.path);

        const result = await reviewPatchPipeline({
          task: options.task,
          repoPath,
          diff: options.diff,
          diffPath: options.diffFile,
          staged: options.staged,
          commitRange: options.commitRange,
          useJev: options.jev !== false,
        });

        recordTelemetryEvent({
          type: "patch_review",
          task: result.task,
          status: result.status,
          riskScore: result.riskScore,
          filesCount: result.filesChanged.length,
          additions: result.additions,
          deletions: result.deletions,
          latencyMs: result.latencyMs,
          platform: options.platform,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n=======================================================");
        console.log("             JEV PATCH REVIEWER (PHASE 3)             ");
        console.log("=======================================================\n");
        console.log(`Task:        ${result.task}`);
        console.log(`Status:      [${result.status}] (Risk Score: ${result.riskScore.toFixed(1)}/100)`);
        console.log(
          `Mode:        ${
            result.fallbackUsed
              ? `[FALLBACK] Deterministic (${result.fallbackReason || "Offline"})`
              : `[ACTIVE] ${result.provider === "openrouter" ? "OpenRouter" : "TypeSafe Jev System One"}`
          }`
        );
        console.log(
          `Diff Stats:  ${result.filesChanged.length} file(s), +${result.additions} / -${result.deletions} lines\n`
        );

        console.log("--- JUDGMENTS BREAKDOWN ---");
        const j = result.judgments;
        console.log(`  Regression Risk:   ${j.regressionRisk.toFixed(1)} / 4.0`);
        console.log(`  Out Of Scope:      ${(j.isOutOfScope * 100).toFixed(0)}%`);
        console.log(`  Modifies Auth:     ${(j.modifiesAuth * 100).toFixed(0)}%`);
        console.log(`  Modifies Database: ${(j.modifiesDatabase * 100).toFixed(0)}%`);
        console.log(`  Missing Tests:     ${(j.missingTests * 100).toFixed(0)}%`);
        console.log(`  Exposes Secrets:   ${(j.exposesSecrets * 100).toFixed(0)}%`);
        console.log(`  Confidence:        ${(j.confidence * 100).toFixed(0)}%\n`);

        if (result.warnings.length > 0) {
          console.log("--- WARNINGS & ADVISORIES ---");
          for (const w of result.warnings) {
            console.log(`  [!] ${w}`);
          }
          console.log("");
        }

        if (result.filesChanged.length > 0) {
          console.log("--- FILES EVALUATED ---");
          for (const f of result.filesChanged) {
            console.log(`  * ${f}`);
          }
          console.log("");
        }

        console.log(`Total Latency: ${result.latencyMs}ms`);
        console.log("=======================================================\n");

        if (result.status === "BLOCK_HUMAN_REQUIRED") {
          process.exit(2);
        }
      } catch (err) {
        console.error("Error executing patch reviewer:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: guard check (Phase 3)
  // ==========================================
  const guardCommand = program
    .command("guard")
    .description("Tool call and command security interceptor");

  guardCommand
    .command("check")
    .description("Verify safety of a shell command before executing")
    .requiredOption("-c, --command <command>", "The command string to evaluate")
    .option("-t, --task <task>", "Task context")
    .option("--allow-network", "Authorize network commands", false)
    .option("--allow-production", "Authorize production/cloud commands", false)
    .option("--json", "Output machine-readable stable JSON format", false)
    .option("--no-jev", "Disable Jev semantic evaluation (force deterministic fallback)")
    .option("--platform <platform>", "Originating agent platform (e.g. Codex, Claude, Trae, Antigravity)")
    .action(async (options) => {
      try {
        const result = await guardCheck({
          command: options.command,
          task: options.task,
          allowNetwork: options.allowNetwork,
          allowProduction: options.allowProduction,
          useJev: options.jev !== false,
        });

        recordTelemetryEvent({
          type: "guard_check",
          command: result.command,
          category: result.category,
          allowed: result.allowed,
          riskLevel: result.riskLevel,
          reason: result.reason,
          latencyMs: result.latencyMs,
          platform: options.platform,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n=======================================================");
        console.log("             JEV TOOL CALL GUARD (PHASE 3)            ");
        console.log("=======================================================\n");
        console.log(`Command:     ${result.command}`);
        console.log(
          `Decision:    ${result.allowed ? "[ALLOWED]" : "[BLOCKED / CONFIRMATION REQUIRED]"}`
        );
        console.log(`Category:    ${result.category}`);
        console.log(`Risk Level:  ${result.riskLevel.toUpperCase()}`);
        console.log(`Requires Confirmation: ${result.requiresConfirmation ? "YES" : "NO"}`);
        console.log(`Reason:      ${result.reason}`);
        if (result.matchedRule) {
          console.log(`Rule:        ${result.matchedRule}`);
        }
        console.log(
          `Mode:        ${
            result.fallbackUsed
              ? `[FALLBACK] (${result.fallbackReason || "Offline"})`
              : result.provider
              ? `[ACTIVE] ${result.provider}`
              : "[DETERMINISTIC RULE]"
          }`
        );
        console.log(`Latency:     ${result.latencyMs}ms`);
        console.log("=======================================================\n");

        if (!result.allowed && result.requiresConfirmation) {
          process.exit(1);
        }
      } catch (err) {
        console.error("Error executing tool guard:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: lint semantic (Phase 8)
  // ==========================================
  const lintCommand = program
    .command("lint")
    .description("Semantic linting against architectural and security drift (Phase 8)");

  lintCommand
    .command("semantic")
    .description("Run semantic checks over git diff or commit range")
    .option("-p, --path <path>", "Repository path", ".")
    .option("--diff <string>", "Raw unified diff string")
    .option("--diff-file <path>", "Path to diff file")
    .option("--staged", "Lint staged changes (git diff --staged)", false)
    .option("--commit-range <range>", "Git commit range (e.g. HEAD~1)")
    .option("--advisory", "Advisory mode (does not fail CI process exit code)", false)
    .option("--json", "Output machine-readable stable JSON format", false)
    .option("--no-jev", "Disable Jev semantic evaluation (force deterministic fallback)")
    .option("--platform <platform>", "Originating agent platform (e.g. Codex, Claude, Trae, Antigravity)")
    .action(async (options) => {
      try {
        const repoPath = path.resolve(options.path);

        const result = await lintSemantic({
          repoPath,
          diff: options.diff,
          diffPath: options.diffFile,
          staged: options.staged,
          commitRange: options.commitRange,
          advisoryOnly: options.advisory,
          useJev: options.jev !== false,
        });

        recordTelemetryEvent({
          type: "lint_semantic",
          status: result.passed ? "PASSED" : "FAILED",
          passed: result.passed,
          violationsCount: result.failedRules,
          latencyMs: result.latencyMs,
          platform: options.platform,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n=======================================================");
        console.log("             JEV SEMANTIC LINTER (PHASE 8)            ");
        console.log("=======================================================\n");
        console.log(`Status:      ${result.passed ? "[PASSED]" : "[FAILED]"}`);
        console.log(`Summary:     ${result.passedRules}/${result.totalRules} passed (${result.failedRules} violations, ${result.advisoriesCount} advisories)`);
        console.log(`Evaluated:   ${result.filesEvaluated.length} file(s)`);
        console.log(
          `Mode:        ${
            result.fallbackUsed
              ? "[FALLBACK] Deterministic"
              : `[ACTIVE] ${result.provider || "TypeSafe Jev"}`
          }`
        );
        console.log(`Latency:     ${result.latencyMs}ms\n`);

        console.log("--- EVALUATED SEMANTIC RULES ---");
        for (const ev of result.evaluations) {
          const icon = ev.passed ? "✓ PASS" : `✗ ${ev.severity.toUpperCase()}`;
          console.log(`  [${icon}] ${ev.ruleName}`);
          console.log(`      ${ev.message}`);
        }
        console.log("\n=======================================================\n");

        if (!result.passed && !options.advisory) {
          process.exit(1);
        }
      } catch (err) {
        console.error("Error executing semantic linter:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: hooks (Automation)
  // ==========================================
  const hooksCommand = program
    .command("hooks")
    .description("Manage git hooks automation");

  hooksCommand
    .command("install")
    .description("Install pre-commit safety hook in target repository")
    .option("-p, --path <path>", "Repository path", ".")
    .action((options) => {
      try {
        const res = installGitHook(options.path);
        console.log(`[Jev Hook] ${res.message}`);
      } catch (err) {
        console.error("[Jev Hook Error]:", (err as Error).message);
        process.exit(1);
      }
    });

  hooksCommand
    .command("uninstall")
    .description("Remove pre-commit safety hook from target repository")
    .option("-p, --path <path>", "Repository path", ".")
    .action((options) => {
      try {
        const res = uninstallGitHook(options.path);
        console.log(`[Jev Hook] ${res.message}`);
      } catch (err) {
        console.error("[Jev Hook Error]:", (err as Error).message);
        process.exit(1);
      }
    });
  // ==========================================
  // COMMAND: mcp (Model Context Protocol Server)
  // ==========================================
  program
    .command("mcp")
    .description("Start the Model Context Protocol (MCP) server over stdio")
    .action(async () => {
      try {
        await startMcpServer();
      } catch (err) {
        console.error("Failed to start MCP server:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: compare (Benchmark & ROI Showcase)
  // ==========================================
  program
    .command("compare")
    .description("Showcase benchmark and cost/token comparison with vs without Jev")
    .option("--json", "Output machine-readable stable JSON format", false)
    .action((options) => {
      printTerminalComparison(options.json);
    });

  // ==========================================
  // COMMAND: setup / init (Interactive Wizard)
  // ==========================================
  program
    .command("setup")
    .alias("init")
    .description("Interactive setup wizard to configure AI providers (TypeSafe/Vercel/OpenRouter) and agent integrations")
    .option("--provider <provider>", "Preset provider (typesafe, vercel, openrouter, offline)")
    .option("--key <key>", "Preset API key")
    .option("--model <model>", "Preset model")
    .option("-y, --yes", "Run in non-interactive mode", false)
    .action(async (options) => {
      await runSetupWizard({
        provider: options.provider,
        key: options.key,
        model: options.model,
        nonInteractive: options.yes,
      });
    });

  // ==========================================
  // COMMAND: provider (Inspect or Switch Active AI Provider)
  // ==========================================
  program
    .command("provider [target]")
    .description("Inspect or switch active AI provider (typesafe, vercel, openrouter, offline)")
    .action(async (target) => {
      await runProviderCommand(target);
    });

  // ==========================================
  // COMMAND: dashboard (Live Telemetry Monitor)
  // ==========================================
  program
    .command("dashboard")
    .description("Start the Live Telemetry web dashboard to monitor token savings and agent operations")
    .option("-p, --port <port>", "Port to bind HTTP server", (val) => parseInt(val, 10), 3741)
    .option("--no-open", "Do not automatically open the browser")
    .option("--clear", "Clear recorded telemetry history and exit")
    .option("--json", "Output telemetry summary as JSON and exit")
    .action(async (options) => {
      await startDashboardServer({
        port: options.port,
        open: options.open,
        clear: options.clear,
        json: options.json,
      });
    });

  // ==========================================
  // COMMAND: update (Upgrade to latest npm version)
  // ==========================================
  program
    .command("update")
    .description("Update jev-dev-harness to the latest version published on npm")
    .action(() => {
      console.log("\n📦 Checking and updating jev-dev-harness to latest version...\n");
      try {
        execSync("npm install -g jev-dev-harness@latest", { stdio: "inherit" });
        console.log("\n🎉 Successfully updated jev-dev-harness to latest version!\n");
      } catch (err) {
        console.error("\n❌ Failed to update automatically. Try running: npm install -g jev-dev-harness@latest\n");
      }
    });

  // ==========================================
  // COMMAND: tools rank (Tool Pruning & Ranking)
  // ==========================================
  const toolsCommand = program
    .command("tools")
    .description("Tool pruning and intelligent tool calling ranking");

  toolsCommand
    .command("rank")
    .description("Rank and filter tools for a given task, eliminating token bloat")
    .requiredOption("-t, --task <task>", "Task description or objective")
    .option("--tools <path>", "Path to a JSON file containing tool definitions")
    .option("--top <number>", "Maximum number of tools to select", (val) => parseInt(val, 10), 5)
    .option("--threshold <number>", "Minimum score threshold", (val) => parseFloat(val), 0.15)
    .option("--json", "Output machine-readable JSON format", false)
    .option("--no-jev", "Disable Jev semantic evaluation (force deterministic fallback)")
    .option("--platform <platform>", "Originating agent platform (e.g. Codex, Claude, Trae, Antigravity)")
    .action(async (options) => {
      try {
        const result = await rankTools({
          task: options.task,
          toolsJsonPath: options.tools ? path.resolve(options.tools) : undefined,
          top: options.top,
          threshold: options.threshold,
          useJev: options.jev !== false,
          platform: options.platform,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n=======================================================");
        console.log("             JEV TOOL PRUNING & RANKER                ");
        console.log("=======================================================\n");
        console.log(`Task:        ${result.task}`);
        console.log(`Provider:    ${result.metrics.provider || "TypeSafe Jev System One"}`);
        console.log(`Selected:    ${result.selected.length} / ${result.metrics.initialTools} tools (-${result.metrics.reductionPct}%)`);
        console.log(`Saved:       ~${result.metrics.tokensSaved.toLocaleString()} tokens/turn\n`);

        if (result.selected.length === 0) {
          console.log("  No tools matched the required criteria.\n");
        } else {
          console.log("--- SELECTED TOOLS ---");
          result.selected.forEach((t, i) => {
            const pct = (t.relevanceScore * 100).toFixed(1);
            console.log(`#${i + 1} [${pct}% score] ${t.name}`);
            console.log(`    Reason: ${t.reason}`);
            if (t.closedParams && t.closedParams.length > 0) {
              const cpDesc = t.closedParams.map((cp) => `${cp.name} (${cp.kind})`).join(", ");
              console.log(`    Closed params: [${cpDesc}]`);
            }
          });
          console.log("");
        }

        if (result.pruned.length > 0) {
          console.log(`--- PRUNED TOOLS (${result.pruned.length}) ---`);
          console.log(`  ${result.pruned.slice(0, 10).join(", ")}${result.pruned.length > 10 ? ` ...and ${result.pruned.length - 10} more` : ""}`);
          console.log("");
        }

        console.log("--- METRICS ---");
        console.log(`  Latency: ${result.metrics.latencyMs}ms | Mode: ${result.fallbackUsed ? "Fallback" : "Jev Active"}`);
        console.log("=======================================================\n");
      } catch (err) {
        console.error("Error executing tool ranker:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: proxy (Local Reverse Proxy Gateway)
  // ==========================================
  program
    .command("proxy [target]")
    .description("Start local LLM reverse proxy gateway (codex, claude, opencode, gemini, generic)")
    .option("-p, --port <number>", "Port to listen on", (val) => parseInt(val, 10))
    .option("-u, --upstream <url>", "Upstream base URL")
    .option("--no-routing", "Passthrough only mode (baseline)")
    .action(async (target, options) => {
      try {
        await startProxyServer({
          target: target || "generic",
          port: options.port,
          upstreamBaseUrl: options.upstream,
          routing: options.routing !== false,
        });
      } catch (err) {
        console.error("Error starting proxy gateway:", (err as Error).message);
        process.exit(1);
      }
    });

  // ==========================================
  // COMMAND: doctor (Diagnostics & Health Check)
  // ==========================================
  program
    .command("doctor")
    .description("Verify that Jev is active, test AI connectivity, check MCP configurations and agent rules")
    .option("--init-rules", "Automatically create GEMINI.md, CLAUDE.md, and .cursorrules in current workspace")
    .option("--json", "Output diagnostics as JSON")
    .action(async (options) => {
      await runDoctorCommand({
        initRules: options.initRules,
        json: options.json,
      });
    });

  // ==========================================
  // COMMAND: uninstall / teardown (Clean Removal)
  // ==========================================
  program
    .command("uninstall")
    .alias("teardown")
    .description("Completely remove Jev MCP registrations, git hooks, and ~/.jev-dev configuration")
    .option("--purge", "Purge all configs without confirmation prompt")
    .option("--global", "Also uninstall global npm package")
    .option("--rules", "Also delete agent rule files in current workspace")
    .option("-y, --yes", "Skip interactive confirmation")
    .action(async (options) => {
      await runUninstallCommand({
        purge: options.purge,
        global: options.global,
        rules: options.rules,
        yes: options.yes || options.purge,
      });
    });

  // Non-blocking update notifier on CLI completion (excluding stdio mcp)
  program.hook("postAction", async (_thisCommand, actionCommand) => {
    if (actionCommand.name() !== "mcp") {
      try {
        const update = await checkForUpdates("0.2.3");
        printUpdateNotification(update);
      } catch {
        // Silently ignore
      }
    }
  });

  return program;
}

// When run directly as a script
const normalizedScript = (process.argv[1] || "").replace(/\\/g, "/");
if (
  normalizedScript.endsWith("cli/index.js") ||
  normalizedScript.endsWith("cli/index.ts") ||
  normalizedScript.endsWith("bin/jev-dev.js") ||
  normalizedScript.endsWith("jev-dev.js")
) {
  const cli = createCli();
  cli.parse(process.argv);
}
