/**
 * Jev Developer Harness — Stylized Terminal Banner
 * Renders cross-platform ANSI cybernetic shield & branding for CLI commands.
 */
export function getJevBanner(subtitle?: string): string {
  const cyan = "\x1b[36m";
  const purple = "\x1b[35m";
  const bold = "\x1b[1m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";

  const lines = [
    `${cyan}${bold}     /\\       __ _____ _   _   ${purple}${bold}JEV DEVELOPER HARNESS ${reset}${dim}v0.1.9${reset}`,
    `${cyan}${bold}    /  \\      \\ V / __| | | |  ${reset}${bold}TypeSafe AI System One Engine${reset}`,
    `${cyan}${bold}   / /\\ \\    | \\ / _| | |_| |  ${purple}${dim}Runtime Safety • Token Reducer • Live Telemetry${reset}`,
    `${cyan}${bold}   \\ \\/ /     \\_/|___| \\___/   ${reset}${dim}https://typesafe.ai${reset}`,
    `${cyan}${bold}    \\  /     ${reset}`,
    `${cyan}${bold}     \\/      ${reset}`,
  ];

  if (subtitle) {
    lines.push(`${dim}─────────────────────────────────────────────────────────────────${reset}`);
    lines.push(`${bold}${subtitle}${reset}`);
    lines.push(`${dim}─────────────────────────────────────────────────────────────────${reset}`);
  }

  return lines.join("\n") + "\n";
}

export function printJevBanner(subtitle?: string): void {
  console.log("\n" + getJevBanner(subtitle));
}
