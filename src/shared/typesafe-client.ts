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
import { redactState } from "./redaction.js";

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

export type JevProvider = "typesafe" | "openrouter";

export interface SafeJevClientOptions {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  disabled?: boolean;
  provider?: JevProvider;
}

export interface JevExecutionSuccess<Q extends Questions> {
  ok: true;
  result: SystemOneResult<Q>;
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

export class SafeJevClient {
  private client: TypeSafeClient | null = null;
  public readonly isConfigured: boolean;
  public readonly disabled: boolean;
  public readonly timeoutMs: number;
  public readonly provider: JevProvider;
  private readonly apiKey?: string;
  private readonly modelName: string;
  private statusReason: string;

  constructor(options: SafeJevClientOptions = {}) {
    this.disabled = options.disabled ?? false;
    this.timeoutMs = options.timeoutMs ?? 4500;

    // Detect keys: either native TYPESAFE_API_KEY, OPENROUTER_API_KEY, or explicit apiKey option
    const openRouterKey = options.apiKey?.startsWith("sk-or-")
      ? options.apiKey
      : process.env.OPENROUTER_API_KEY;
    const typeSafeKey = options.apiKey || process.env.TYPESAFE_API_KEY;

    // Detect provider
    if (options.provider) {
      this.provider = options.provider;
    } else if (
      openRouterKey ||
      typeSafeKey?.startsWith("sk-or-") ||
      options.baseURL?.includes("openrouter.ai")
    ) {
      this.provider = "openrouter";
    } else {
      this.provider = "typesafe";
    }

    const effectiveKey =
      this.provider === "openrouter" ? openRouterKey || typeSafeKey : typeSafeKey;
    this.apiKey = effectiveKey;

    if (this.provider === "openrouter") {
      this.modelName =
        options.defaultModel ||
        process.env.TYPESAFE_DEFAULT_MODEL ||
        "typesafe/jev-latest";
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
      this.statusReason = `READY (OpenRouter: ${this.modelName})`;
    } else {
      try {
        this.client = new TypeSafeClient({
          apiKey: effectiveKey,
          baseURL: options.baseURL,
          defaultModel: this.modelName,
          timeout: this.timeoutMs,
          retry: {
            maxRetries: options.maxRetries ?? 1,
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
   * Calls OpenRouter's Decisions API (POST /api/alpha/decisions).
   */
  private async executeOpenRouter<const Q extends Questions>(
    sanitizedState: unknown,
    questions: Q,
    timeoutMs: number
  ): Promise<SystemOneResult<Q>> {
    const url = "https://openrouter.ai/api/alpha/decisions";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/marcelo/jev-dev-harness",
          "X-OpenRouter-Title": "Jev Developer Harness",
        },
        body: JSON.stringify({
          model: this.modelName,
          state: sanitizedState,
          questions,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenRouter HTTP ${res.status}: ${errorText}`);
      }

      const json = (await res.json()) as any;

      return {
        model: json.model || this.modelName,
        answers: json.answers,
        usage: {
          input_tokens:
            json.usage?.input_tokens ?? json.usage?.prompt_tokens ?? 0,
          output_tokens:
            json.usage?.output_tokens ?? json.usage?.completion_tokens ?? 0,
        },
      } as SystemOneResult<Q>;
    } finally {
      clearTimeout(timeoutId);
    }
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

    try {
      // Automatic privacy redaction before transmitting state over the network
      const sanitizedState = redactState(state) as
        | string
        | Record<string, unknown>
        | unknown[];

      const effectiveTimeout = callOptions?.timeout ?? this.timeoutMs;
      let result: SystemOneResult<Q>;

      if (this.provider === "openrouter") {
        result = await this.executeOpenRouter(
          sanitizedState,
          questions,
          effectiveTimeout
        );
      } else {
        if (!this.client) {
          throw new Error("TypeSafe client not initialized");
        }
        result = await this.client.systemOne(
          {
            state: sanitizedState as any,
            questions,
          },
          {
            timeout: effectiveTimeout,
            ...callOptions,
          }
        );
      }

      const latencyMs = Date.now() - start;

      return {
        ok: true,
        result,
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
        latencyMs,
        provider: this.provider,
      };
    } catch (err: unknown) {
      const error = err as Error;
      const latencyMs = Date.now() - start;

      return {
        ok: false,
        fallback: true,
        reason: `${error.name || "Error"}: ${error.message || "Unknown API error"}`,
        latencyMs,
        provider: this.provider,
      };
    }
  }
}
