export type ProxyAgentTarget = "codex" | "claude" | "opencode" | "gemini" | "generic";

export interface ProxyOptions {
  port?: number;
  target?: ProxyAgentTarget;
  upstreamBaseUrl?: string;
  timeoutMs?: number;
  routing?: boolean;
  quiet?: boolean;
  /** Opt-in bridge metadata. The owner must declare complete/partial task coverage. */
  usageMetadata?: Record<string, unknown>;
  usageOutputPath?: string;
  measurementRunId?: string;
}

export type RoutingMode = "forced" | "hint" | "direct" | "none" | "passthrough";

export interface RoutingDecision {
  mode: RoutingMode;
  tool?: string;
  args?: Record<string, any>;
  confidence?: number;
  reason?: string;
  latencyMs?: number;
  provider?: string;
}

export interface ProxyServerInstance {
  port: number;
  target: ProxyAgentTarget;
  upstreamBaseUrl: string;
  close: () => Promise<void>;
}
