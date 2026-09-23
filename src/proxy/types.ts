export type ProxyAgentTarget = "codex" | "claude" | "opencode" | "gemini" | "generic";

export interface ProxyOptions {
  port?: number;
  target?: ProxyAgentTarget;
  upstreamBaseUrl?: string;
  timeoutMs?: number;
  routing?: boolean;
  quiet?: boolean;
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
