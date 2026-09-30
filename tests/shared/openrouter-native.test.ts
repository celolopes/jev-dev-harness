import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeJevClient, choice, noul, score } from "../../src/shared/typesafe-client.js";

const questions = {
  relevant: noul("Relevant to task?"),
  role: choice("Role?", { code: "Implementation", test: "Tests" }),
  relevance: score("Relevance?", ["Unrelated", "Related", "Essential"]),
};
const responseBody = () => ({
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: {
    relevant: { type: "noul", noul: 0.95 },
    role: { type: "choice", choice: "code", confidence: 0.8, probabilities: { code: 0.9, test: 0.1 } },
    relevance: { type: "score", score: 1.9, confidence: 0.9, probabilities: { 0: 0, 1: 0.1, 2: 0.9 } },
  },
  usage: { input_tokens: 500, output_tokens: 40, cost: 0.000021 },
});
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const client = (options = {}) => new SafeJevClient({
  apiKey: "sk-or-test-key", provider: "openrouter", ...options,
});

beforeEach(() => {
  vi.stubEnv("JEV_CONFIG_FILE", "missing-test-config.json");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("TYPESAFE_DEFAULT_MODEL", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Native OpenRouter decisions", () => {
  it("defaults to Jev, redacts state, uses the stable endpoint and retains reported usage", async () => {
    const fetch = vi.fn(async () => json(responseBody()));
    vi.stubGlobal("fetch", fetch);
    const c = client();
    expect(c.modelName).toBe("typesafe/jev-1.13");
    const secret = "Bearer " + "a".repeat(24);
    const result = await c.systemOne({ snippet: "Authorization: " + secret, task: "auth" }, questions);
    expect(result.ok).toBe(true);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/systemone");
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    const payload = JSON.parse(init.body as string);
    expect(payload.model).toBe("typesafe/jev-1.13");
    expect(payload.provider).toEqual({ allow_fallbacks: false, data_collection: "deny" });
    expect(init.body).not.toContain(secret);
    if (result.ok) {
      expect(result.decisionMode).toBe("jev");
      expect(result.costUsd).toBe(0.000021);
      expect(result.result.provider).toBe("TypeSafe");
      expect(result.result.model).toBe("typesafe/jev-1.13-20260917");
    }
  });

  it.each([400, 401, 402, 403, 404, 413, 422])("does not retry or emulate HTTP %s", async status => {
    const fetch = vi.fn(async () => json({ message: "private input: does not exist" }, status));
    vi.stubGlobal("fetch", fetch);
    const result = await client().systemOne({}, questions);
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.reason).toContain(`HTTP ${status}`);
      expect(result.reason).not.toContain("private input");
    }
  });

  it.each([429, 500, 503])("retries HTTP %s once against the same endpoint/model", async status => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, status, { "Retry-After": "0" }))
      .mockResolvedValueOnce(json(responseBody()));
    vi.stubGlobal("fetch", fetch);
    expect((await client().systemOne({}, questions)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("https://openrouter.ai/api/v1/systemone");
      expect(JSON.parse(init.body).model).toBe("typesafe/jev-1.13");
    }
  });

  it("caps retries and respects Retry-After beyond the deadline", async () => {
    const fetch = vi.fn(async () => json({}, 429, { "Retry-After": "30" }));
    vi.stubGlobal("fetch", fetch);
    expect((await client({ timeoutMs: 50, maxRetries: 99 }).systemOne({}, questions)).ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("has a total timeout even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const pending = client({ timeoutMs: 100 }).systemOne({}, questions);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DECISION_TIMEOUT");
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes response body parsing in the deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })));
    const pending = client({ timeoutMs: 80 }).systemOne({}, questions);
    await vi.advanceTimersByTimeAsync(80);
    expect((await pending).ok).toBe(false);
  });

  it("does not send a request when the caller already cancelled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await client().systemOne({}, questions, { signal: AbortSignal.abort() });
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing confidence", (r: any) => delete r.answers.role.confidence],
    ["unknown category", (r: any) => r.answers.role.choice = "admin"],
    ["wrong type", (r: any) => r.answers.relevant.type = "choice"],
    ["missing answer", (r: any) => delete r.answers.relevance],
    ["noul range", (r: any) => r.answers.relevant.noul = 1.1],
    ["score range", (r: any) => r.answers.relevance.score = 3],
    ["missing probabilities", (r: any) => delete r.answers.role.probabilities],
    ["bad distribution", (r: any) => r.answers.role.probabilities.code = 0.1],
    ["invalid usage", (r: any) => r.usage.input_tokens = -1],
    ["missing model", (r: any) => delete r.model],
  ])("falls back on %s without a second call", async (_, mutate) => {
    const body = responseBody();
    (mutate as (body: unknown) => void)(body);
    const fetch = vi.fn(async () => json(body));
    vi.stubGlobal("fetch", fetch);
    const result = await client().systemOne({}, questions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("INVALID_DECISION_RESPONSE");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps explicitly selected chat models separate and labels their output", async () => {
    const body = responseBody();
    const fetch = vi.fn(async () => json({
      model: "test/llm", choices: [{ message: { content: JSON.stringify({ answers: body.answers }) } }],
      usage: { prompt_tokens: 500, completion_tokens: 40, cost: 0.01 },
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await client({ defaultModel: "test/llm" }).systemOne({}, questions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decisionMode).toBe("llm_emulation");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("uses the requested base URL without duplicate version prefixes", async () => {
    const fetch = vi.fn(async () => json(responseBody()));
    vi.stubGlobal("fetch", fetch);
    await client({ baseURL: "https://example.test/api/" }).systemOne({}, questions);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/api/v1/systemone");
  });
});
