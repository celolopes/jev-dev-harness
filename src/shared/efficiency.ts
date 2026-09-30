import type { TelemetryMetrics } from "./telemetry.js";

export const FACTUAL_EFFICIENCY_INSTRUCTION = "Apresente um bloco '### ⚡ Eficiência Jev' conciso com apenas métricas retornadas. Economia de tokens/dinheiro: não medida sem baseline válido. Custo ausente: não informado. Cache e heurística não são chamadas novas ao modelo. Só afirme verificação de comandos, auditoria de diff ou lint quando a ferramenta correspondente tiver sido executada; indique seu escopo, fallback e latência real.";

/** Usage covers validated responses, not unreported retries or failed requests. */
export function buildContextEfficiencyReport(metrics: TelemetryMetrics) {
  const newModelCalls = metrics.newModelCalls ?? null;
  const costedRequests = metrics.costedRequests ?? 0;
  const reportedCostUsd = costedRequests > 0 ? metrics.reportedCostUsd ?? null : null;
  const summaryMessage = [
    "### ⚡ Eficiência Jev",
    `- Contexto: ${metrics.initialCandidates} entradas encontradas; ${metrics.filteredCandidates} após filtros; ${metrics.evaluatedCandidates ?? "não informado"} candidatos avaliados; ${metrics.selectedCount} arquivos selecionados.`,
    `- Modelo: ${metrics.provider ?? "não informado"}; ${(metrics.decisionModels ?? []).join(", ") || "não informado"}; cache ${metrics.cacheHits} hits / ${metrics.cacheMisses} misses; ${newModelCalls === 0 ? "nenhuma chamada nova ao modelo" : `${newModelCalls ?? "não informado"} chamadas novas ao modelo`}.`,
    `- Uso novo reportado: ${metrics.tokensSent}/${metrics.tokensReceived} tokens de entrada/saída; custo ${reportedCostUsd === null ? "não informado" : `US$ ${reportedCostUsd}`} (${costedRequests}/${newModelCalls ?? "?"} chamadas com custo informado).`,
    `- Latência: ${metrics.latencyMs} ms; fallback: ${metrics.fallbackUsed}${metrics.fallbackReason ? ` (${metrics.fallbackReason})` : ""}. Auditoria de comandos/diffs: não executada por este ranking.`,
    "- Economia de tokens/dinheiro: não medida.",
  ].join("\n");
  return {
    schemaVersion: 2,
    entriesFound: metrics.initialCandidates,
    candidatesAfterFilters: metrics.filteredCandidates,
    candidatesEvaluated: metrics.evaluatedCandidates ?? null,
    selectedFiles: metrics.selectedCount,
    cachedDecisions: metrics.cacheHits,
    newModelCalls,
    validatedResponses: metrics.validatedResponses ?? null,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
    provider: metrics.provider ?? null,
    decisionModels: metrics.decisionModels ?? [],
    newTokens: { input: metrics.tokensSent, output: metrics.tokensReceived },
    reportedCostUsd,
    costCoverage: { costedRequests, newModelCalls, scope: "validated_responses_only; excludes unreported retries and failures" },
    latencyMs: metrics.latencyMs,
    fallbackUsed: metrics.fallbackUsed,
    fallbackReason: metrics.fallbackReason,
    tokenSavings: null,
    moneySavings: null,
    savingsStatus: "not_measured",
    commandAudit: "not_executed",
    diffAudit: "not_executed",
    instructionForAgent: FACTUAL_EFFICIENCY_INSTRUCTION,
    summaryMessage,
  };
}
