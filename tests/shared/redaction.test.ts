import { describe, it, expect } from "vitest";
import {
  containsSecrets,
  isSecretFile,
  redactSecrets,
  redactState,
} from "../../src/shared/redaction.js";

describe("Redaction Module", () => {
  it("detects secret files by name and extension", () => {
    expect(isSecretFile(".env")).toBe(true);
    expect(isSecretFile(".env.local")).toBe(true);
    expect(isSecretFile(".env.production")).toBe(true);
    expect(isSecretFile("certs/server.pem")).toBe(true);
    expect(isSecretFile("id_rsa")).toBe(true);
    expect(isSecretFile("my_secret_token.txt")).toBe(true);
    expect(isSecretFile("src/auth/jwt.ts")).toBe(false);
    expect(isSecretFile("README.md")).toBe(false);
  });

  it("redacts API keys and tokens", () => {
    const mockApiKey = ["sk", "abcdef123456789012345678"].join("-");
    const mockGhToken = ["ghp", "111122223333444455556666777788889999"].join("_");
    const text = `OpenAI key: ${mockApiKey} and GitHub: ${mockGhToken}`;
    const result = redactSecrets(text);
    expect(result.secretsCount).toBe(2);
    expect(result.redactedText).toContain("[REDACTED_API_KEY]");
    expect(result.redactedText).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(result.redactedText).not.toContain(mockApiKey);
    expect(result.redactedText).not.toContain(mockGhToken);
  });

  it("redacts connection string passwords", () => {
    const mockPass = ["Super", "Secret", "Pass123"].join("");
    const text = `postgres://admin:${mockPass}@db.example.com:5432/production`;
    const result = redactSecrets(text);
    expect(result.redactedText).toBe("postgres://admin:[REDACTED_PASSWORD]@db.example.com:5432/production");
  });

  it("redacts private keys", () => {
    const text = `
      Some text
      -----BEGIN RSA PRIVATE KEY-----
      MIIEowIBAAKCAQEA0m...
      -----END RSA PRIVATE KEY-----
      End text
    `;
    const result = redactSecrets(text);
    expect(result.redactedText).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.redactedText).not.toContain("MIIEow");
  });

  it("recursively sanitizes arbitrary objects with redactState", () => {
    const mockKey = ["sk", "1234567890123456789012"].join("-");
    const mockPass = ["secret", "123"].join("");
    const mockJwt = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "dozjgN_p_w",
    ].join(".");

    const state = {
      task: "Fix auth",
      config: {
        apiKey: mockKey,
        databaseUrl: `postgres://user:${mockPass}@localhost/db`,
      },
      headers: [`Bearer ${mockJwt}`],
    };

    const sanitized = redactState(state) as typeof state;
    expect(sanitized.task).toBe("Fix auth");
    expect(sanitized.config.apiKey).toContain("[REDACTED_API_KEY]");
    expect(sanitized.config.databaseUrl).toContain("[REDACTED_PASSWORD]");
    expect(sanitized.headers[0]).toContain("[REDACTED_JWT]");
  });
});
