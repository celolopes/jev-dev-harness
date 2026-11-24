import type { TelemetryMetrics } from "./telemetry.js";

export const FACTUAL_EFFICIENCY_INSTRUCTION = "Apresente um bloco '### ⚡ Eficiência Jev' conciso e pertinente à tarefa, usando somente resultados observados. Para ranking concluído, informe entradas, candidatos filtrados e avaliados, arquivos selecionados, uso reportado e latência; entradas não são necessariamente arquivos. Se scanPartial for true, informe que a varredura foi parcial e arquivos relevantes podem não ter sido visitados; complemente a busca quando necessário. Se a chamada falhar ou expirar, informe o ocorrido sem inventar contagens ou causa. Indique fallback e motivo quando retornados. Tokens e custos cobrem somente respostas validadas; informe cobertura e dados ausentes. Economia de tokens/dinheiro: não medida sem comparação válida com baseline. Cache e heurística não são chamadas novas ao modelo. Só afirme verificação de comandos, auditoria de diff ou lint quando executada; informe escopo e resultado.";

/** Normalize IEEE-754 decimal drift in USD sums and differences without fabricating precision. */
export function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.abs(value) < 1e12 ? Number(value.toFixed(10)) : value;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Usage covers validated responses, not unreported retries or failed requests. */
export function buildContextEfficiencyReport(metrics: TelemetryMetrics) {
  const newModelCalls = metrics.newModelCalls ?? null;
  const costedRequests = metrics.costedRequests ?? 0;
  const reportedCostUsd = costedRequests > 0 && metrics.reportedCostUsd !== undefined ? roundUsd(metrics.reportedCostUsd) : null;
  const summaryMessage = [
    "### ⚡ Eficiência Jev",
    `- Contexto: ${metrics.initialCandidates} entradas visitadas (sem conteúdo de diretórios ignorados); ${metrics.filteredCandidates} após filtros; ${metrics.evaluatedCandidates ?? "não informado"} candidatos avaliados; ${metrics.selectedCount} arquivos selecionados.`,
    ...(metrics.scanPartial ? [`- Varredura parcial: limite de ${metrics.scanBudgetMs} ms atingido após ${metrics.scanElapsedMs} ms; arquivos relevantes podem não ter sido visitados.`] : []),
    `- Modelo: ${metrics.provider ?? "não informado"}; ${(metrics.decisionModels ?? []).join(", ") || "não informado"}; cache ${metrics.cacheHits} hits / ${metrics.cacheMisses} misses; ${newModelCalls === 0 ? "nenhuma chamada nova ao modelo" : `${newModelCalls ?? "não informado"} chamadas novas ao modelo`}.`,
    `- Uso reportado nas respostas validadas: ${metrics.tokensSent ?? "não informado"}/${metrics.tokensReceived ?? "não informado"} tokens de entrada/saída (cobertura ${metrics.inputTokenRequests ?? "?"}/${metrics.outputTokenRequests ?? "?"} de ${metrics.validatedResponses ?? "?"} respostas); custo ${reportedCostUsd === null ? "não informado" : `US$ ${reportedCostUsd}`} (${costedRequests}/${newModelCalls ?? "?"} chamadas com custo informado). Retries e falhas sem uso reportado não estão incluídos.`,
    `- Execução: ${metrics.latencyMs} ms; fallback: ${metrics.fallbackUsed ? "sim" : "não"}${metrics.fallbackReason ? ` (${metrics.fallbackReason})` : ""}; erros: ${metrics.errors}. Este ranking não audita comandos ou diffs.`,
    "- Economia de tokens/dinheiro: não medida.",
  ].join("\n");
  return {
    schemaVersion: 2,
    entriesFound: metrics.initialCandidates,
    candidatesAfterFilters: metrics.filteredCandidates,
    candidatesEvaluated: metrics.evaluatedCandidates ?? null,
    selectedFiles: metrics.selectedCount,
    scanPartial: metrics.scanPartial ?? null,
    scanBudgetMs: metrics.scanBudgetMs ?? null,
    scanElapsedMs: metrics.scanElapsedMs ?? null,
    cachedDecisions: metrics.cacheHits,
    newModelCalls,
    validatedResponses: metrics.validatedResponses ?? null,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
    provider: metrics.provider ?? null,
    decisionModels: metrics.decisionModels ?? [],
    newTokens: { input: metrics.tokensSent, output: metrics.tokensReceived },
    tokenCoverage: { inputTokenRequests: metrics.inputTokenRequests ?? null,
      outputTokenRequests: metrics.outputTokenRequests ?? null, validatedResponses: metrics.validatedResponses ?? null },
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
