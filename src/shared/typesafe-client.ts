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

  constructor(options: SafeJevClientOptions = {}) {
    this.disabled = options.disabled ?? false;
    this.timeoutMs =
      options.timeoutMs ??
      (parseInt(process.env.JEV_TIMEOUT_MS || "", 10) || 15000);

    const globalConfig = loadGlobalJevConfig();

    // Detect explicit environment or option overrides
    const providerOverride =
      options.provider ||
      (process.env.JEV_PROVIDER as JevProvider | undefined);

    const openRouterKey =
      options.apiKey?.startsWith("sk-or-")
        ? options.apiKey
        : process.env.OPENROUTER_API_KEY || (globalConfig.provider === "openrouter" ? globalConfig.apiKey : undefined);

    const typeSafeKey =
      options.apiKey && !options.apiKey.startsWith("sk-or-")
        ? options.apiKey
        : process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || (globalConfig.provider !== "openrouter" ? globalConfig.apiKey : undefined);

    // Detect provider:
    // 1. Explicit options.provider
    // 2. Explicit options.apiKey starting with sk-or- -> openrouter
    // 3. Explicit options.apiKey -> typesafe
    // 4. Ambient JEV_PROVIDER env override
    // 5. Ambient TYPESAFE_API_KEY / OPENROUTER_API_KEY
    // 6. Global config from ~/.jev-dev/config.json
    if (options.provider) {
      this.provider = options.provider;
    } else if (
      options.apiKey?.startsWith("sk-or-") ||
      options.baseURL?.includes("openrouter.ai")
    ) {
      this.provider = "openrouter";
    } else if (options.apiKey) {
      this.provider = "typesafe";
    } else if (providerOverride) {
      this.provider = providerOverride;
    } else if (process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY) {
      this.provider = "typesafe";
    } else if (process.env.OPENROUTER_API_KEY) {
      this.provider = "openrouter";
    } else if (globalConfig.provider) {
      this.provider = globalConfig.provider;
    } else {
      this.provider = "typesafe";
    }

    const effectiveKey =
      this.provider === "openrouter"
        ? (options.apiKey?.startsWith("sk-or-") ? options.apiKey : process.env.OPENROUTER_API_KEY || options.apiKey || (globalConfig.provider === "openrouter" ? globalConfig.apiKey : undefined))
        : (options.apiKey || process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || globalConfig.apiKey);
    this.apiKey = effectiveKey;

    if (this.provider === "openrouter") {
      const rawModel =
        options.defaultModel ||
        process.env.OPENROUTER_MODEL ||
        process.env.TYPESAFE_DEFAULT_MODEL ||
        globalConfig.model ||
        "deepseek/deepseek-v4-flash";

      // Normalize user-friendly DeepSeek slugs (e.g. deepseek-4-flash -> deepseek/deepseek-v4-flash)
      this.modelName = normalizeOpenRouterModel(rawModel);
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
  private async executeOpenRouterDecisions<const Q extends Questions>(
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
   * Emulates Jev's System One decision engine via OpenRouter Chat Completions.
   * Enables structured Noul, Score and Choice decisions using any fast model (e.g. gpt-4o-mini).
   */
  private async executeOpenRouterChat<const Q extends Questions>(
    sanitizedState: unknown,
    questions: Q,
    model: string,
    timeoutMs: number
  ): Promise<SystemOneResult<Q>> {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const systemPrompt = [
      "You are a calibrated System One decision engine conforming to the TypeSafe Jev API contract.",
      "Evaluate the provided state against the typed questions.",
      "Do NOT output conversational text, explanations, markdown, or chat.",
      "Return ONLY a valid JSON object matching this structure:",
      "{",
      '  "answers": {',
      '    "<question_name>": {',
      '      // If question type is "noul":',
      '      "type": "noul",',
      '      "noul": <float between 0.0 and 1.0 indicating probability of yes>',
      "    },",
      '    "<question_name>": {',
      '      // If question type is "score":',
      '      "type": "score",',
      '      "score": <float between 0.0 and N based on criteria index>,',
      '      "confidence": <float between 0.0 and 1.0>',
      "    },",
      '    "<question_name>": {',
      '      // If question type is "choice":',
      '      "type": "choice",',
      '      "choice": "<selected option key from criteria>",',
      '      "confidence": <float between 0.0 and 1.0>',
      "    }",
      "  }",
      "}",
    ].join("\n");

    try {
        const effort = process.env.OPENROUTER_EFFORT || "low";
        const requestPayload: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                state: sanitizedState,
                questions,
              }),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        };

        if (
          model.includes("astra") ||
          model.includes("gpt-6") ||
          model.includes("o1") ||
          model.includes("o3")
        ) {
          requestPayload.reasoning = { effort };
          requestPayload.reasoning_effort = effort;
        }

        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/marcelo/jev-dev-harness",
            "X-OpenRouter-Title": "Jev Developer Harness",
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenRouter HTTP ${res.status}: ${errorText}`);
      }

      const json = (await res.json()) as any;
      const rawContent = json.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(rawContent);

      return {
        model: `${json.model || model}`,
        answers: parsed.answers || parsed,
        usage: {
          input_tokens: json.usage?.prompt_tokens ?? 0,
          output_tokens: json.usage?.completion_tokens ?? 0,
        },
      } as SystemOneResult<Q>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Router for OpenRouter calls: attempts Decisions API if requested, otherwise uses structured chat completions.
   */
  private async executeOpenRouter<const Q extends Questions>(
    sanitizedState: unknown,
    questions: Q,
    timeoutMs: number
  ): Promise<SystemOneResult<Q>> {
    if (
      this.modelName.startsWith("typesafe/") ||
      this.modelName.startsWith("~typesafe/")
    ) {
      try {
        return await this.executeOpenRouterDecisions(
          sanitizedState,
          questions,
          timeoutMs
        );
      } catch (err) {
        const msg = (err as Error).message;
        // If OpenRouter rejects the typesafe model slug, fall back to fast deepseek-4-flash emulator
        if (msg.includes("does not exist") || msg.includes("400")) {
          const fallbackModel = normalizeOpenRouterModel(
            process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash"
          );
          return await this.executeOpenRouterChat(
            sanitizedState,
            questions,
            fallbackModel,
            timeoutMs
          );
        }
        throw err;
      }
    }

    return await this.executeOpenRouterChat(
      sanitizedState,
      questions,
      this.modelName,
      timeoutMs
    );
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
