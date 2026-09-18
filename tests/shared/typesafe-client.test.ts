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
    delete process.env.TYPESAFE_API_KEY;

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
});
