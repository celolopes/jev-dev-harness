import { normalizeAgentUsage, unknownAgentUsage, type AgentTokenUsage, type AgentUsageFormat } from "../shared/agent-usage.js";

/** Observe final provider usage without modifying response bytes or retaining text. */
export class ResponseUsageObserver {
  private decoder = new TextDecoder();
  private buffer = "";
  private raw: Record<string, unknown> = {};
  private format: AgentUsageFormat | undefined;
  private valid = true;
  private reportedCostUsd: number | undefined;
  private models = new Set<string>();
  constructor(private streaming: boolean) {}
  push(bytes: Uint8Array): void {
    if (!this.valid) return;
    this.buffer += this.decoder.decode(bytes, { stream: true });
    if (this.buffer.length > 1024 * 1024) { this.valid = false; this.buffer = ""; return; }
    if (this.streaming) {
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end).trimEnd();
        this.buffer = this.buffer.slice(end + 1);
        this.line(line);
      }
    }
  }
  private line(line: string): void {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try { this.observe(JSON.parse(data)); } catch { this.valid = false; }
  }
  private observe(event: Record<string, any>): void {
    const model = event.model ?? event.message?.model ?? event.response?.model ?? event.modelVersion;
    if (typeof model === "string") this.models.add(model);
    let usage: Record<string, unknown> | undefined;
    if (event.usageMetadata) { usage = event.usageMetadata; this.format = "gemini"; }
    else if (event.type === "message_start") { usage = event.message?.usage; this.format = "anthropic"; }
    else if (event.type === "message_delta") { usage = event.usage; this.format = "anthropic"; }
    else if (event.type === "response.completed") { usage = event.response?.usage; this.format = "openai-responses"; }
    else if (event.usage && event.type === "message") { usage = event.usage; this.format = "anthropic"; }
    else if (event.usage && event.object === "response") { usage = event.usage; this.format = "openai-responses"; }
    else if (event.usage && typeof event.usage.prompt_tokens === "number") { usage = event.usage; this.format = "openai-chat"; }
    if (usage) {
      // Stream usage snapshots update the same request; they are never summed.
      this.raw = { ...this.raw, ...usage };
      if (typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) this.reportedCostUsd = usage.cost;
    }
  }
  finish(): { usage: AgentTokenUsage; costUsd?: number; model?: string } {
    this.buffer += this.decoder.decode();
    if (!this.valid) return { usage: unknownAgentUsage() };
    try {
      if (this.streaming) this.line(this.buffer.trimEnd());
      else if (this.buffer.trim()) this.observe(JSON.parse(this.buffer));
      this.buffer = "";
      if (!this.valid || !this.format || this.models.size > 1) return { usage: unknownAgentUsage() };
      return { usage: normalizeAgentUsage(this.format, this.raw), costUsd: this.reportedCostUsd,
        model: [...this.models][0] };
    } catch { return { usage: unknownAgentUsage() }; }
  }
}
