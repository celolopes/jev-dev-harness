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

export interface SafeJevClientOptions {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  disabled?: boolean;
}

export interface JevExecutionSuccess<Q extends Questions> {
  ok: true;
  result: SystemOneResult<Q>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface JevExecutionFallback {
  ok: false;
  fallback: true;
  reason: string;
  latencyMs: number;
}

export type JevExecutionResponse<Q extends Questions> =
  | JevExecutionSuccess<Q>
  | JevExecutionFallback;

export class SafeJevClient {
  private client: TypeSafeClient | null = null;
  public readonly isConfigured: boolean;
  public readonly disabled: boolean;
  public readonly timeoutMs: number;
  private statusReason: string;

  constructor(options: SafeJevClientOptions = {}) {
    this.disabled = options.disabled ?? false;
    this.timeoutMs = options.timeoutMs ?? 3500;

    const key = options.apiKey || process.env.TYPESAFE_API_KEY;

    if (this.disabled) {
      this.isConfigured = false;
      this.statusReason = "DISABLED_BY_USER";
    } else if (!key || key.trim() === "") {
      this.isConfigured = false;
      this.statusReason = "NO_API_KEY";
    } else {
      try {
        this.client = new TypeSafeClient({
          apiKey: key,
          baseURL: options.baseURL,
          defaultModel: options.defaultModel || "jev-latest",
          timeout: this.timeoutMs,
          retry: {
            maxRetries: options.maxRetries ?? 1,
            backoffInitialMs: 200,
            backoffMaxMs: 1000,
          },
        });
        this.isConfigured = true;
        this.statusReason = "READY";
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
   * Executes batched questions against a state with safety, redaction, timeout and fallback guarantees.
   */
  async systemOne<const Q extends Questions>(
    state: unknown,
    questions: Q,
    callOptions?: RequestOptions
  ): Promise<JevExecutionResponse<Q>> {
    const start = Date.now();

    if (!this.isConfigured || !this.client) {
      return {
        ok: false,
        fallback: true,
        reason: this.statusReason,
        latencyMs: Date.now() - start,
      };
    }

    try {
      // Automatic privacy redaction before transmitting state over the network
      const sanitizedState = redactState(state) as string | Record<string, unknown> | unknown[];

      const response = await this.client.systemOne(
        {
          state: sanitizedState as any,
          questions,
        },
        {
          timeout: callOptions?.timeout ?? this.timeoutMs,
          ...callOptions,
        }
      );

      const latencyMs = Date.now() - start;

      return {
        ok: true,
        result: response,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        latencyMs,
      };
    } catch (err: unknown) {
      const error = err as Error;
      const latencyMs = Date.now() - start;

      return {
        ok: false,
        fallback: true,
        reason: `${error.name || "Error"}: ${error.message || "Unknown API error"}`,
        latencyMs,
      };
    }
  }
}
