import { Command } from "commander";
import path from "node:path";
import { rankContext } from "../context-ranker/index.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("jev-dev")
    .description("Developer Harness with TypeSafe AI / Jev for AI Coding Agents")
    .version("0.1.0");

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

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Human-readable formatted output
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
