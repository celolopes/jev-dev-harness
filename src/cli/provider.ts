import { runSetupWizard } from "./setup.js";
import { SafeJevClient, noul, type JevProvider } from "../shared/typesafe-client.js";

/**
 * CLI command to inspect or switch active AI providers on the fly.
 * Examples:
 *   npx jev-dev provider
 *   npx jev-dev provider vercel
 *   npx jev-dev provider typesafe
 *   npx jev-dev provider openrouter
 *   npx jev-dev provider offline
 */
export async function runProviderCommand(target?: string): Promise<void> {
  const validProviders: Array<JevProvider | "offline"> = [
    "typesafe",
    "vercel",
    "openrouter",
    "offline",
  ];

  if (target) {
    const normalized = target.toLowerCase().trim() as JevProvider | "offline";
    if (!validProviders.includes(normalized)) {
      console.error(`\n❌ Unknown provider: "${target}".`);
      console.log(`Available options: ${validProviders.join(", ")}\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n🔄 Switching active provider to: [${normalized}]...\n`);
    await runSetupWizard({
      provider: normalized,
      nonInteractive: true,
    });
    return;
  }

  // Display current provider status
  const client = new SafeJevClient({ timeoutMs: 3000 });
  console.log("\n" + "=".repeat(74));
  console.log("       🔮 JEV DEVELOPER HARNESS — ACTIVE AI PROVIDER STATUS     ");
  console.log("=".repeat(74) + "\n");
  console.log(`  Active Provider:  ${client.provider.toUpperCase()}`);
  console.log(`  Model / Target:   ${client.modelName}`);
  console.log(`  Reason / Status:  ${client.getReason()}`);

  const start = Date.now();
  try {
    const testRes = await client.systemOne(
      { check: "provider-status" },
      { ready: noul("Is provider active?") }
    );
    const latency = Date.now() - start;

    if (testRes.ok) {
      console.log(`  Live Health Ping: ✓ CONNECTED (${latency}ms) via ${testRes.provider}`);
    } else {
      console.log(`  Live Health Ping: ℹ Fallback active (${testRes.reason})`);
    }
  } catch (err) {
    console.log(`  Live Health Ping: ⚠️ Fallback (${(err as Error).message})`);
  }

  console.log("\n💡 Available Providers:");
  console.log("  • typesafe    👉 Native TypeSafe AI (https://typesafe.ai)");
  console.log("  • vercel      👉 Vercel AI Gateway Free Tier (https://vercel.com/d/ai-gateway)");
  console.log("  • openrouter  👉 OpenRouter Multi-Model (https://openrouter.ai)");
  console.log("  • offline     👉 Deterministic regex & heuristics\n");
  console.log("To switch instantly, run:");
  console.log("  npx jev-dev provider <typesafe | vercel | openrouter | offline>");
  console.log("  Or run interactive setup: npx jev-dev setup\n");
  console.log("=".repeat(74) + "\n");
}
