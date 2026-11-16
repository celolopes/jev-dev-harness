import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SafeJevClient, type JevProvider } from "../../src/shared/typesafe-client.js";

// Constructor-only contract tests. No real config, credentials, SDK request or network.
const providers: JevProvider[] = ["typesafe", "openrouter", "vercel"];
const defaults = { typesafe: "jev-1.14.0", openrouter: "typesafe/jev-1.14", vercel: "typesafe-ai/jev-1.14.0" };
const pins = { typesafe: "jev-1.13.0", openrouter: "typesafe/jev-1.13", vercel: "typesafe-ai/jev-1.13.0" };
let dir: string;
let configFile: string;
let deniedFetch: ReturnType<typeof vi.fn>;
const config = (value: object) => writeFileSync(configFile, JSON.stringify(value));
const client = (provider: JevProvider, options = {}) => new SafeJevClient({ provider, disabled: true, ...options });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jev-model-defaults-"));
  configFile = join(dir, "config.json");
  config({});
  for (const key of ["JEV_PROVIDER", "TYPESAFE_DEFAULT_MODEL", "OPENROUTER_MODEL", "VERCEL_MODEL", "TYPESAFE_API_KEY", "JEV_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_KEY", "VERCEL_OIDC_TOKEN", "TYPESAFE_BASE_URL", "VERCEL_AI_GATEWAY_URL", "JEV_TIMEOUT_MS"]) vi.stubEnv(key, "");
  vi.stubEnv("JEV_CONFIG_FILE", configFile);
  deniedFetch = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN_IN_OFFLINE_TEST"); });
  vi.stubGlobal("fetch", deniedFetch);
});
afterEach(() => {
  try { expect(deniedFetch).not.toHaveBeenCalled(); }
  finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    unlinkSync(configFile); rmdirSync(dir);
  }
});

describe("0.2.16 model selection and cache isolation (offline)", () => {
  it.each(providers)("pins the new %s default to 1.14", provider => {
    const c = client(provider);
    expect(c.modelName).toBe(defaults[provider]);
    expect(c.decisionMode).toBe("jev");
    expect(c.disabled).toBe(true);
  });
  it.each(providers)("preserves explicit %s 1.13 instead of upgrading it", provider => {
    config({ provider, model: defaults[provider] });
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", defaults[provider]);
    expect(client(provider, { defaultModel: pins[provider] }).modelName).toBe(pins[provider]);
  });
  it.each(providers)("honors the %s config pin when no model override exists", provider => {
    config({ provider, model: pins[provider] });
    expect(client(provider).modelName).toBe(pins[provider]);
  });
  it.each(providers)("environment model takes precedence over %s config", provider => {
    config({ provider, model: pins[provider] });
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", defaults[provider]);
    expect(client(provider).modelName).toBe(defaults[provider]);
  });
  it.each(["openrouter", "vercel"] as const)("%s dedicated env wins over shared model env", provider => {
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", defaults[provider]);
    vi.stubEnv(provider === "openrouter" ? "OPENROUTER_MODEL" : "VERCEL_MODEL", pins[provider]);
    expect(client(provider).modelName).toBe(pins[provider]);
    expect(client(provider, { defaultModel: defaults[provider] }).modelName).toBe(defaults[provider]);
  });
  it.each(providers)("does not inherit an unrelated provider's model for %s", provider => {
    config({ provider: provider === "openrouter" ? "vercel" : "openrouter", model: "unrelated/provider-model" });
    expect(client(provider).modelName).toBe(defaults[provider]);
  });
  it("preserves the legacy native config pin through provider normalization", () => {
    config({ provider: "typesafe", model: "typesafe/jev-1.13" });
    const c = client("typesafe");
    expect(c.modelName).toBe("jev-1.13.0");
    expect(c.cacheIdentity).toBe(client("typesafe", { defaultModel: "jev-1.13.0" }).cacheIdentity);
  });
  it.each(providers)("separates %s cache identity across explicit model versions and endpoints", provider => {
    const old = client(provider, { defaultModel: pins[provider] });
    const current = client(provider);
    expect(old.cacheIdentity).not.toBe(current.cacheIdentity);
    expect(client(provider, { baseURL: "https://offline.invalid" }).cacheIdentity).not.toBe(current.cacheIdentity);
    expect(current.cacheIdentity).toBe(client(provider).cacheIdentity);
  });
  it("separates provider cache identities even with identical explicit model and endpoint", () => {
    const identities = providers.map(provider => client(provider, { defaultModel: "custom-model", baseURL: "https://offline.invalid" }).cacheIdentity);
    expect(new Set(identities).size).toBe(3);
  });
  it("keeps the existing explicit DeepSeek emulation alias independent of Jev defaults", () => {
    const c = client("openrouter", { defaultModel: "deepseek-4-flash" });
    expect(c.modelName).toBe("deepseek/deepseek-v4-flash");
    expect(c.decisionMode).toBe("llm_emulation");
  });
});

describe("legacy model spellings and explicit aliases", () => {
  it.each(["jev-1.13", "jev-1.13.0", "typesafe/jev-1.13", "typesafe/jev-1.13.0"])("normalizes native pin %s without promoting version", model => {
    expect(client("typesafe", { defaultModel: model }).modelName).toBe("jev-1.13.0");
  });
  it.each(["jev-1.14", "jev-1.14.0", "typesafe/jev-1.14", "typesafe/jev-1.14.0"])("normalizes native version %s", model => {
    expect(client("typesafe", { defaultModel: model }).modelName).toBe("jev-1.14.0");
  });
  it.each(["jev-latest", "jev-preview", "custom-model"])("retains explicitly requested native alias %s", model => {
    expect(client("typesafe", { defaultModel: model }).modelName).toBe(model);
  });
  it.each(["typesafe/jev-1.13-20260917", "~typesafe/jev-latest", "jev-latest"])("preserves explicitly selected OpenRouter model/alias %s", model => {
    const c = client("openrouter", { defaultModel: model });
    expect(c.modelName).toBe(model);
    expect(c.decisionMode).toBe("jev");
  });
  it("retains an explicitly configured Vercel floating alias", () => {
    config({ provider: "vercel", model: "typesafe-ai/jev" });
    expect(client("vercel").modelName).toBe("typesafe-ai/jev");
  });
  it("does not inherit another provider's dedicated environment model", () => {
    vi.stubEnv("OPENROUTER_MODEL", "unrelated/openrouter-model");
    vi.stubEnv("VERCEL_MODEL", "unrelated/vercel-model");
    expect(client("typesafe").modelName).toBe(defaults.typesafe);
  });
});

describe("provider credential isolation", () => {
  it("does not adopt an OpenRouter config key/model for an explicit native provider", () => {
    config({ provider: "openrouter", apiKey: "sk-or-synthetic-not-a-real-key", model: "typesafe/jev-1.13" });
    const c = new SafeJevClient({ provider: "typesafe" });
    expect(c.provider).toBe("typesafe");
    expect(c.modelName).toBe(defaults.typesafe);
    expect(c.isConfigured).toBe(false);
    expect(c.getReason()).toBe("NO_API_KEY");
  });
});
