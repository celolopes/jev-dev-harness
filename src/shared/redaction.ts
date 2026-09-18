/**
 * Secret and PII redaction engine.
 * Ensures credentials, tokens, private keys, and sensitive environment variables
 * are never transmitted to Jev or external APIs.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // Private keys
  {
    name: "PrivateKey",
    pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  // JWT tokens
  {
    name: "JWT",
    pattern: /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.]+\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // GitHub tokens (classic and fine-grained)
  {
    name: "GitHubToken",
    pattern: /\b(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // OpenAI / Anthropic / TypeSafe / General sk_ API keys
  {
    name: "ApiKey",
    pattern: /\b(sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9_-]{20,}|sk_test_[A-Za-z0-9_-]{20,})\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  // TypeSafe / Context7 / Supabase token prefixes
  {
    name: "PlatformKey",
    pattern: /\b(ctx7sk-[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9_-]{20,})\b/g,
    replacement: "[REDACTED_PLATFORM_KEY]",
  },
  // Slack tokens
  {
    name: "SlackToken",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED_SLACK_TOKEN]",
  },
  // Generic Authorization Header / Bearer token
  {
    name: "BearerToken",
    pattern: /(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9\-_.~+/=]{16,}/gi,
    replacement: "$1[REDACTED_BEARER_TOKEN]",
  },
  // Connection strings with embedded passwords (postgresql, mysql, redis, mongodb)
  {
    name: "ConnectionStringPassword",
    pattern: /((?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^:\s\/]+:)[^@\s\/]+(@)/gi,
    replacement: "$1[REDACTED_PASSWORD]$2",
  },
  // Key-value pairs matching secret-like variables (e.g. API_KEY="xyz", secret = 'abc')
  {
    name: "SecretAssignment",
    pattern: /((?:api[_-]?key|secret|password|passwd|token|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*["']?)[A-Za-z0-9_~.!\-@#%^&*+=]{8,}(["']?)/gi,
    replacement: "$1[REDACTED_SECRET]$2",
  },
];

const SECRET_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|keystore|pfx|p12|cer|crt)$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /.*secret.*/i,
  /.*credential.*/i,
];

/**
 * Checks if a file path represents a credential or secret file.
 */
export function isSecretFile(filePathOrName: string): boolean {
  const normalized = filePathOrName.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() || "";
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}

/**
 * Scans text to check whether it contains any known secret pattern.
 */
export function containsSecrets(text: string): boolean {
  return SECRET_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export interface RedactionResult {
  redactedText: string;
  secretsCount: number;
  matchedTypes: string[];
}

/**
 * Scans text and replaces any detected secrets with safe redaction markers.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text || typeof text !== "string") {
    return { redactedText: text, secretsCount: 0, matchedTypes: [] };
  }

  let result = text;
  let count = 0;
  const matched = new Set<string>();

  for (const { name, pattern, replacement } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = result.match(pattern);
    if (matches) {
      count += matches.length;
      matched.add(name);
      result = result.replace(pattern, replacement);
    }
  }

  return {
    redactedText: result,
    secretsCount: count,
    matchedTypes: Array.from(matched),
  };
}

/**
 * Recursively redacts secrets in any arbitrary JavaScript object/array before serializing or passing to Jev.
 */
export function redactState<T>(state: T): T {
  if (state === null || state === undefined) {
    return state;
  }

  if (typeof state === "string") {
    return redactSecrets(state).redactedText as unknown as T;
  }

  if (Array.isArray(state)) {
    return state.map((item) => redactState(item)) as unknown as T;
  }

  if (typeof state === "object") {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state as Record<string, unknown>)) {
      copy[k] = redactState(v);
    }
    return copy as T;
  }

  return state;
}
