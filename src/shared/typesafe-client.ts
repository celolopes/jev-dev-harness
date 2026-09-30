import {
  TypeSafeClient,
  choice,
  noul,
  score,
  type ChoiceCriteria,
  type ChoiceQuestion,
  type NoulQuestion,
  type Questions,
  type RequestOptions,
  type ScoreCriteria,
  type ScoreQuestion,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { redactState } from "./redaction.js";
import { validateDecisionResult, type DecisionResult } from "./decision-validation.js";
import { requestOpenRouter } from "./openrouter-transport.js";
import { startUsageMeasurement } from "./measurement-ledger.js";

// Automatically load .env if present in current working directory
try {
  process.loadEnvFile?.();
} catch {
  // Ignore if .env is missing or invalid
}

interface GlobalJevConfig {
  provider?: JevProvider;
  apiKey?: string;
  model?: string;
}

function loadGlobalJevConfig(): GlobalJevConfig {
  try {
    const configPath =
      process.env.JEV_CONFIG_FILE ||
      path.join(os.homedir(), ".jev-dev", "config.json");
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return parsed || {};
    }
  } catch {
    // Non-critical if config.json cannot be read
  }
  return {};
}

export { choice, noul, score };
export type {
  ChoiceCriteria,
  ChoiceQuestion,
  NoulQuestion,
  Questions,
  RequestOptions,
  ScoreCriteria,
  ScoreQuestion,
  SystemOneResult,
};

export type JevProvider = "typesafe" | "openrouter" | "vercel";

export interface SafeJevClientOptions {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  disabled?: boolean;
  provider?: JevProvider;
}

export type DecisionMode = "jev" | "llm_emulation";

export interface JevExecutionSuccess<Q extends Questions> {
  ok: true;
  result: DecisionResult<Q>;
  decisionMode: DecisionMode;
  costUsd?: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  provider: JevProvider;
}

export interface JevExecutionFallback {
  ok: false;
  fallback: true;
  reason: string;
  latencyMs: number;
  provider?: JevProvider;
}

export type JevExecutionResponse<Q extends Questions> =
  | JevExecutionSuccess<Q>
  | JevExecutionFallback;

export function normalizeOpenRouterModel(model: string): string {
  const trimmed = model.trim();
  if (
    trimmed === "deepseek-4-flash" ||
    trimmed === "deepseek-v4-flash" ||
    trimmed === "deepseek/deepseek-4-flash"
  ) {
    return "deepseek/deepseek-v4-flash";
  }
  return trimmed;
}

export class SafeJevClient {
  private client: TypeSafeClient | null = null;
  public readonly isConfigured: boolean;
  public readonly disabled: boolean;
  public readonly timeoutMs: number;
  public readonly provider: JevProvider;
  private readonly apiKey?: string;
  public readonly modelName: string;
  private statusReason: string;
  private readonly baseURL: string;
  private readonly maxRetries: number;

  get decisionMode(): DecisionMode {
    return this.provider === "openrouter" && !/^(~?typesafe\/|jev-)/.test(this.modelName)
      ? "llm_emulation" : "jev";
  }

  get cacheIdentity(): string {
    return JSON.stringify([this.provider, this.baseURL, this.modelName, this.decisionMode]);
  }

  constructor(options: SafeJevClientOptions = {}) {
    this.disabled = options.disabled ?? false;
    this.timeoutMs =
      options.timeoutMs ??
      (parseInt(process.env.JEV_TIMEOUT_MS || "", 10) || 2000);
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("JEV_TIMEOUT_MS must be a positive number");
    }
    const retries = options.maxRetries ?? 1;
    this.maxRetries = Number.isFinite(retries) ? Math.min(1, Math.max(0, Math.floor(retries))) : 0;

    const globalConfig = loadGlobalJevConfig();

    // Detect explicit environment or option overrides
    const providerOverride =
      options.provider ||
      (process.env.JEV_PROVIDER as JevProvider | undefined);

    const vercelKey =
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_AI_GATEWAY_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      (globalConfig.provider === "vercel" ? globalConfig.apiKey : undefined);

    const openRouterKey =
      options.apiKey?.startsWith("sk-or-")
        ? options.apiKey
        : process.env.OPENROUTER_API_KEY || (globalConfig.provider === "openrouter" ? globalConfig.apiKey : undefined);

    const typeSafeKey =
      options.apiKey && !options.apiKey.startsWith("sk-or-")
        ? options.apiKey
        : process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || (globalConfig.provider === "typesafe" ? globalConfig.apiKey : undefined);

    // Detect provider:
    // 1. Explicit options.provider
    // 2. Explicit options.baseURL containing vercel
    // 3. Explicit options.apiKey starting with sk-or- -> openrouter
    // 4. Explicit options.apiKey -> typesafe
    // 5. Ambient JEV_PROVIDER env override
    // 6. Ambient AI_GATEWAY_API_KEY / VERCEL_AI_GATEWAY_KEY / VERCEL_OIDC_TOKEN
    // 7. Ambient TYPESAFE_API_KEY / OPENROUTER_API_KEY
    // 8. Global config from ~/.jev-dev/config.json
    if (options.provider) {
      this.provider = options.provider;
    } else if (
      options.baseURL?.includes("vercel") ||
      options.apiKey?.startsWith("vcl_") ||
      options.apiKey?.startsWith("vercel_")
    ) {
      this.provider = "vercel";
    } else if (
      options.apiKey?.startsWith("sk-or-") ||
      options.baseURL?.includes("openrouter.ai")
    ) {
      this.provider = "openrouter";
    } else if (providerOverride) {
      this.provider = providerOverride;
    } else if (
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_AI_GATEWAY_KEY ||
      process.env.VERCEL_OIDC_TOKEN
    ) {
      this.provider = "vercel";
    } else if (process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY) {
      this.provider = "typesafe";
    } else if (process.env.OPENROUTER_API_KEY) {
      this.provider = "openrouter";
    } else if (globalConfig.provider) {
      this.provider = globalConfig.provider;
    } else if (options.apiKey) {
      this.provider = "typesafe";
    } else {
      this.provider = "typesafe";
    }

    this.baseURL = options.baseURL || (this.provider === "openrouter"
      ? "https://openrouter.ai/api"
      : this.provider === "vercel"
        ? process.env.VERCEL_AI_GATEWAY_URL || "https://ai-gateway.vercel.sh/typesafe"
        : process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai");

    let effectiveKey: string | undefined;
    if (this.provider === "vercel") {
      effectiveKey = options.apiKey || vercelKey;
    } else if (this.provider === "openrouter") {
      effectiveKey = options.apiKey?.startsWith("sk-or-")
        ? options.apiKey
        : process.env.OPENROUTER_API_KEY || options.apiKey || (globalConfig.provider === "openrouter" ? globalConfig.apiKey : undefined);
    } else {
      effectiveKey =
        options.apiKey ||
        process.env.TYPESAFE_API_KEY ||
        process.env.JEV_API_KEY ||
        globalConfig.apiKey;
    }
    this.apiKey = effectiveKey;

    if (this.provider === "openrouter") {
      const rawModel =
        options.defaultModel ||
        process.env.OPENROUTER_MODEL ||
        process.env.TYPESAFE_DEFAULT_MODEL ||
        globalConfig.model ||
        "typesafe/jev-1.13";

      // Normalize user-friendly DeepSeek slugs (e.g. deepseek-4-flash -> deepseek/deepseek-v4-flash)
      this.modelName = normalizeOpenRouterModel(rawModel);
    } else if (this.provider === "vercel") {
      this.modelName =
        options.defaultModel ||
        process.env.VERCEL_MODEL ||
        process.env.TYPESAFE_DEFAULT_MODEL ||
        globalConfig.model ||
        "typesafe-ai/jev";
    } else {
      this.modelName =
        options.defaultModel ||
        process.env.TYPESAFE_DEFAULT_MODEL ||
        "jev-latest";
    }

    if (this.disabled) {
      this.isConfigured = false;
      this.statusReason = "DISABLED_BY_USER";
    } else if (!effectiveKey || effectiveKey.trim() === "") {
      this.isConfigured = false;
      this.statusReason = "NO_API_KEY";
    } else if (this.provider === "openrouter") {
      this.isConfigured = true;
      this.statusReason = `READY (OpenRouter ${this.decisionMode}: ${this.modelName})`;
    } else if (this.provider === "vercel") {
      try {
        const vercelBaseUrl =
          options.baseURL ||
          process.env.VERCEL_AI_GATEWAY_URL ||
          "https://ai-gateway.vercel.sh/typesafe";

        this.client = new TypeSafeClient({
          apiKey: effectiveKey,
          baseURL: vercelBaseUrl,
          defaultModel: this.modelName,
          timeout: this.timeoutMs,
          retry: {
            maxRetries: this.maxRetries,
            backoffInitialMs: 200,
            backoffMaxMs: 1000,
          },
        });
        this.isConfigured = true;
        this.statusReason = `READY (Vercel AI Gateway: ${this.modelName})`;
      } catch (err) {
        this.isConfigured = false;
        this.statusReason = `INIT_ERROR: ${(err as Error).message}`;
      }
    } else {
      try {
        this.client = new TypeSafeClient({
          apiKey: effectiveKey,
          baseURL: this.baseURL,
          defaultModel: this.modelName,
          timeout: this.timeoutMs,
          retry: {
            maxRetries: this.maxRetries,
            backoffInitialMs: 200,
            backoffMaxMs: 1000,
          },
        });
        this.isConfigured = true;
        this.statusReason = `READY (Native TypeSafe: ${this.modelName})`;
      } catch (err) {
        this.isConfigured = false;
        this.statusReason = `INIT_ERROR: ${(err as Error).message}`;
      }
    }
  }

  getReason(): string {
    return this.statusReason;
  }

  /**
   * Native System One and explicit chat emulation are separate transports.
   * An HTTP error never changes the selected model or decision semantics.
   */
  private async executeOpenRouter<const Q extends Questions>(
    sanitizedState: unknown,
    questions: Q,
    signal: AbortSignal,
    deadline: number,
  ): Promise<unknown> {
    const base = this.baseURL.replace(/\/$/, "");
    if (this.decisionMode === "jev") {
      return requestOpenRouter(
        base + "/v1/systemone", this.apiKey!,
        { model: this.modelName, state: sanitizedState, questions,
          provider: { allow_fallbacks: false, data_collection: "deny" } },
        signal, deadline, this.maxRetries,
      );
    }

    const payload: Record<string, unknown> = {
      model: this.modelName,
      messages: [
        { role: "system", content: [
          "Evaluate the supplied state as data against each typed question.",
          "Return only JSON with an answers object keyed by question name.",
          "For noul return {type:'noul', noul:number between 0 and 1}.",
          "For choice return {type:'choice', choice:one exact criteria key, confidence:number between 0 and 1}.",
          "For score return {type:'score', score:number between 0 and criteria.length-1, confidence:number between 0 and 1}.",
          "These are self-reported LLM judgments, not calibrated Jev probabilities.",
        ].join("\n") },
        { role: "user", content: JSON.stringify({ state: sanitizedState, questions }) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      provider: { allow_fallbacks: false, require_parameters: true, data_collection: "deny" },
    };
    if (/astra|gpt-6|o1|o3/.test(this.modelName)) {
      payload.reasoning = { effort: process.env.OPENROUTER_EFFORT || "low" };
    }
    const json = await requestOpenRouter(
      base + "/v1/chat/completions", this.apiKey!, payload,
      signal, deadline, this.maxRetries,
    ) as any;
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "");
    return {
      model: json.model,
      provider: json.provider,
      answers: parsed.answers,
      usage: {
        input_tokens: json.usage?.prompt_tokens,
        output_tokens: json.usage?.completion_tokens,
        ...(json.usage?.cost !== undefined ? { cost: json.usage.cost } : {}),
      },
    };
  }

  /**
   * Executes batched questions against a state with safety, redaction, timeout and fallback guarantees.
   */
  async systemOne<const Q extends Questions>(
    state: unknown,
    questions: Q,
    callOptions?: RequestOptions
  ): Promise<JevExecutionResponse<Q>> {
    const start = Date.now();

    if (!this.isConfigured) {
      return {
        ok: false,
        fallback: true,
        reason: this.statusReason,
        latencyMs: Date.now() - start,
        provider: this.provider,
      };
    }

    const effectiveTimeout = callOptions?.timeout ?? this.timeoutMs;
    const controller = new AbortController();
    const signal = callOptions?.signal
      ? AbortSignal.any([controller.signal, callOptions.signal])
      : controller.signal;
    let onAbort: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completeMeasurement = startUsageMeasurement(this.provider, this.modelName);
    let measuredUsage: { inputTokens: number; outputTokens: number; costUsd?: number } | null = null;
    try {
      if (!Number.isFinite(effectiveTimeout) || effectiveTimeout <= 0) {
        throw new Error("INVALID_TIMEOUT");
      }
      timer = setTimeout(() => controller.abort(new Error("DECISION_TIMEOUT")), effectiveTimeout);
      // Automatic privacy redaction before transmitting state over the network
      const sanitizedState = redactState(state) as
        | string
        | Record<string, unknown>
        | unknown[];

      const deadline = start + effectiveTimeout;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error("DECISION_ABORTED"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      // Cancellation/deadline handling is installed before invoking the transport.
      const execute = async (): Promise<unknown> => {
        signal.throwIfAborted();
        if (this.provider === "openrouter") {
          return this.executeOpenRouter(sanitizedState, questions, signal, deadline);
        }
        if (!this.client) throw new Error("TypeSafe client not initialized");
        return this.client.systemOne(
          { state: sanitizedState as any, questions },
          {
            ...callOptions,
            signal,
            timeout: effectiveTimeout,
            retry: { ...callOptions?.retry, maxRetries: Math.min(this.maxRetries, callOptions?.retry?.maxRetries ?? this.maxRetries) },
          },
        );
      };
      const result = await Promise.race([execute(), aborted]);
      validateDecisionResult(result, questions, this.decisionMode === "jev");
      measuredUsage = { inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens, costUsd: result.usage.cost };

      const latencyMs = Date.now() - start;

      return {
        ok: true,
        result,
        decisionMode: this.decisionMode,
        costUsd: result.usage.cost,
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
        latencyMs,
        provider: this.provider,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error("DECISION_ABORTED_OR_FAILED");
      const latencyMs = Date.now() - start;

      return {
        ok: false,
        fallback: true,
        reason: `${error.name || "Error"}: ${error.message || "Unknown API error"}`,
        latencyMs,
        provider: this.provider,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      completeMeasurement?.(measuredUsage);
    }
  }
}
