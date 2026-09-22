import { describe, it, expect } from "vitest";
import {
  SafeJevClient,
  noul,
  score,
  choice,
} from "../../src/shared/typesafe-client.js";

describe("SafeJevClient Module", () => {
  it("initializes in fallback mode when no API key is provided", async () => {
    // Ensure no env key
    const origKey = process.env.TYPESAFE_API_KEY;
    const origJevKey = process.env.JEV_API_KEY;
    const origOrKey = process.env.OPENROUTER_API_KEY;
    const origConfigFile = process.env.JEV_CONFIG_FILE;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.JEV_CONFIG_FILE = "non-existent-config.json";

    try {
      const client = new SafeJevClient();
      expect(client.isConfigured).toBe(false);
      expect(client.getReason()).toBe("NO_API_KEY");

      const response = await client.systemOne(
        { task: "test" },
        { is_relevant: noul("Is it relevant?") }
      );

      expect(response.ok).toBe(false);
      expect(response.fallback).toBe(true);
      if (!response.ok) {
        expect(response.reason).toBe("NO_API_KEY");
      }
    } finally {
      if (origKey) process.env.TYPESAFE_API_KEY = origKey;
      if (origJevKey) process.env.JEV_API_KEY = origJevKey;
      if (origOrKey) process.env.OPENROUTER_API_KEY = origOrKey;
      if (origConfigFile) process.env.JEV_CONFIG_FILE = origConfigFile;
      else delete process.env.JEV_CONFIG_FILE;
    }
  });

  it("loads global config fallback from ~/.jev-dev/config.json", async () => {
    const origKey = process.env.TYPESAFE_API_KEY;
    const origJevKey = process.env.JEV_API_KEY;
    const origOrKey = process.env.OPENROUTER_API_KEY;
    const origConfigFile = process.env.JEV_CONFIG_FILE;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    // Point to a mock config file
    const mockConfigPath = "tests/fixtures/.test-global-config.json";
    const fs = await import("node:fs");
    fs.writeFileSync(
      mockConfigPath,
      JSON.stringify({ provider: "typesafe", apiKey: "mock-global-key" }),
      "utf-8"
    );
    process.env.JEV_CONFIG_FILE = mockConfigPath;

    try {
      const client = new SafeJevClient();
      expect(client.isConfigured).toBe(true);
      expect(client.provider).toBe("typesafe");
    } finally {
      if (fs.existsSync(mockConfigPath)) fs.unlinkSync(mockConfigPath);
      if (origKey) process.env.TYPESAFE_API_KEY = origKey;
      if (origJevKey) process.env.JEV_API_KEY = origJevKey;
      if (origOrKey) process.env.OPENROUTER_API_KEY = origOrKey;
      if (origConfigFile) process.env.JEV_CONFIG_FILE = origConfigFile;
      else delete process.env.JEV_CONFIG_FILE;
    }
  });

  it("handles disabled flag explicitly", async () => {
    const client = new SafeJevClient({ apiKey: "sk-mock-key", disabled: true });
    expect(client.isConfigured).toBe(false);
    expect(client.getReason()).toBe("DISABLED_BY_USER");

    const response = await client.systemOne(
      { task: "test" },
      { is_relevant: noul("Is it relevant?") }
    );

    expect(response.ok).toBe(false);
    expect(response.fallback).toBe(true);
  });

  it("creates question primitives properly", () => {
    const n = noul("Does condition hold?");
    expect(n.type).toBe("noul");
    expect(n.instructions).toBe("Does condition hold?");

    const s = score("Score it", ["Low", "Medium", "High"]);
    expect(s.type).toBe("score");
    expect(s.criteria).toEqual(["Low", "Medium", "High"]);

    const c = choice("Pick one", { opt1: "Option 1", opt2: "Option 2" });
    expect(c.type).toBe("choice");
    expect(c.criteria.opt1).toBe("Option 1");
  });

  it("detects OpenRouter provider from sk-or- key and calls decisions API", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, init) => {
        expect(url.toString()).toBe("https://openrouter.ai/api/alpha/decisions");
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe("typesafe/jev-latest");
        expect(body.questions.auth_check).toBeDefined();

        return new Response(
          JSON.stringify({
            model: "typesafe/jev-latest",
            answers: {
              auth_check: { type: "noul", noul: 0.96 },
            },
            usage: { input_tokens: 42, output_tokens: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const client = new SafeJevClient({
        apiKey: "sk-or-v1-mock-openrouter-key",
        defaultModel: "typesafe/jev-latest",
      });
      expect(client.provider).toBe("openrouter");
      expect(client.isConfigured).toBe(true);

      const response = await client.systemOne(
        { task: "auth" },
        { auth_check: noul("Is it auth?") }
      );

      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.provider).toBe("openrouter");
        expect(response.result.answers.auth_check.noul).toBe(0.96);
        expect(response.inputTokens).toBe(42);
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("emulates Jev System One via OpenRouter chat completions (e.g. deepseek/deepseek-v4-flash)", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, init) => {
        expect(url.toString()).toBe("https://openrouter.ai/api/v1/chat/completions");
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe("deepseek/deepseek-v4-flash");

        return new Response(
          JSON.stringify({
            model: "deepseek/deepseek-v4-flash",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answers: {
                      auth_check: { type: "noul", noul: 0.93 },
                    },
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 65, completion_tokens: 15 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const client = new SafeJevClient({ apiKey: "sk-or-v1-mock-openrouter-key" });
      expect(client.provider).toBe("openrouter");
      expect(client.modelName).toBe("deepseek/deepseek-v4-flash");

      const response = await client.systemOne(
        { task: "auth" },
        { auth_check: noul("Is it auth?") }
      );

        expect(response.ok).toBe(true);
        if (response.ok) {
          expect(response.result.answers.auth_check.noul).toBe(0.93);
          expect(response.inputTokens).toBe(65);
        }
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("prioritizes native TypeSafe provider when TYPESAFE_API_KEY is configured", () => {
      const origTypeSafe = process.env.TYPESAFE_API_KEY;
      const origOr = process.env.OPENROUTER_API_KEY;
      try {
        process.env.TYPESAFE_API_KEY = "ts-test-key-12345";
        process.env.OPENROUTER_API_KEY = "sk-or-test-key";

        const client = new SafeJevClient();
        expect(client.provider).toBe("typesafe");
        expect(client.modelName).toBe("jev-latest");
      } finally {
        if (origTypeSafe) process.env.TYPESAFE_API_KEY = origTypeSafe;
        else delete process.env.TYPESAFE_API_KEY;
        if (origOr) process.env.OPENROUTER_API_KEY = origOr;
        else delete process.env.OPENROUTER_API_KEY;
      }
    });

    it("detects and configures Vercel AI Gateway provider via AI_GATEWAY_API_KEY", () => {
      const origVercel = process.env.AI_GATEWAY_API_KEY;
      const origTypeSafe = process.env.TYPESAFE_API_KEY;
      const origOr = process.env.OPENROUTER_API_KEY;
      const origProvider = process.env.JEV_PROVIDER;
      try {
        delete process.env.TYPESAFE_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.JEV_PROVIDER;
        process.env.AI_GATEWAY_API_KEY = "vcl_mock_ai_gateway_key_999";

        const client = new SafeJevClient();
        expect(client.provider).toBe("vercel");
        expect(client.isConfigured).toBe(true);
        expect(client.modelName).toBe("typesafe-ai/jev");
        expect(client.getReason()).toContain("Vercel AI Gateway");
      } finally {
        if (origVercel) process.env.AI_GATEWAY_API_KEY = origVercel;
        else delete process.env.AI_GATEWAY_API_KEY;
        if (origTypeSafe) process.env.TYPESAFE_API_KEY = origTypeSafe;
        if (origOr) process.env.OPENROUTER_API_KEY = origOr;
        if (origProvider) process.env.JEV_PROVIDER = origProvider;
        else delete process.env.JEV_PROVIDER;
      }
    });

    it("supports explicit provider: 'vercel' with custom options", () => {
      const client = new SafeJevClient({
        provider: "vercel",
        apiKey: "vcl_custom_key",
        defaultModel: "typesafe-ai/jev",
      });
      expect(client.provider).toBe("vercel");
      expect(client.isConfigured).toBe(true);
      expect(client.modelName).toBe("typesafe-ai/jev");
      expect(client.getReason()).toBe("READY (Vercel AI Gateway: typesafe-ai/jev)");
    });
  });


