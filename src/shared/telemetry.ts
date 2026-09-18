export interface TelemetryMetrics {
  initialCandidates: number;
  filteredCandidates: number;
  evaluatedByJev: number;
  tokensSent: number;
  tokensReceived: number;
  latencyMs: number;
  selectedCount: number;
  confidence: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export class TelemetryCollector {
  private startTime: number = Date.now();
  private endTime?: number;

  initialCandidates = 0;
  filteredCandidates = 0;
  evaluatedByJev = 0;
  tokensSent = 0;
  tokensReceived = 0;
  selectedCount = 0;
  confidences: number[] = [];
  cacheHits = 0;
  cacheMisses = 0;
  errors = 0;
  fallbackUsed = false;
  fallbackReason?: string;

  start(): void {
    this.startTime = Date.now();
    this.endTime = undefined;
  }

  stop(): void {
    this.endTime = Date.now();
  }

  addConfidence(val: number): void {
    if (typeof val === "number" && !isNaN(val)) {
      this.confidences.push(val);
    }
  }

  addTokens(inputTokens = 0, outputTokens = 0): void {
    this.tokensSent += inputTokens;
    this.tokensReceived += outputTokens;
  }

  recordFallback(reason: string): void {
    this.fallbackUsed = true;
    this.fallbackReason = reason;
  }

  toMetrics(): TelemetryMetrics {
    const elapsed = this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime;
    const avgConfidence =
      this.confidences.length > 0
        ? this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length
        : 0;

    return {
      initialCandidates: this.initialCandidates,
      filteredCandidates: this.filteredCandidates,
      evaluatedByJev: this.evaluatedByJev,
      tokensSent: this.tokensSent,
      tokensReceived: this.tokensReceived,
      latencyMs: elapsed,
      selectedCount: this.selectedCount,
      confidence: Number(avgConfidence.toFixed(4)),
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      errors: this.errors,
      fallbackUsed: this.fallbackUsed,
      fallbackReason: this.fallbackReason,
    };
  }

  toFormattedString(): string {
    const m = this.toMetrics();
    return [
      `Telemetry Summary:`,
      `  • Initial candidates:   ${m.initialCandidates}`,
      `  • Filtered candidates:  ${m.filteredCandidates}`,
      `  • Evaluated by Jev:     ${m.evaluatedByJev}`,
      `  • Tokens (in/out):      ${m.tokensSent} / ${m.tokensReceived}`,
      `  • Selected count:       ${m.selectedCount}`,
      `  • Avg confidence:       ${(m.confidence * 100).toFixed(1)}%`,
      `  • Cache hits / misses:  ${m.cacheHits} / ${m.cacheMisses}`,
      `  • Latency:              ${m.latencyMs}ms`,
      `  • Fallback used:        ${m.fallbackUsed ? `YES (${m.fallbackReason})` : "NO (Jev Active)"}`,
    ].join("\n");
  }
}
