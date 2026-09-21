import type { GuardCategory } from "./types.js";

export interface ClassifierResult {
  category: GuardCategory;
  confidence: number;  // 0-1
  matchedRule: string; // Name of the rule that matched
}

interface RuleDefinition {
  category: GuardCategory;
  ruleName: string;
  patterns: RegExp[];
}

const RULES: RuleDefinition[] = [
  // 1. PRODUCTION-SENSITIVE (Highest Priority)
  {
    category: "production-sensitive",
    ruleName: "cloud-gcp",
    patterns: [
      /\b(gcloud|gsutil|bq)\b/i,
      /\bfirebase\s+(deploy|delete)\b/i,
    ],
  },
  {
    category: "production-sensitive",
    ruleName: "cloud-aws",
    patterns: [
      /\b(aws|cdk\s+deploy|sam\s+deploy)\b/i,
    ],
  },
  {
    category: "production-sensitive",
    ruleName: "cloud-azure",
    patterns: [
      /\b(az\b|func\s+deploy\b)/i,
    ],
  },
  {
    category: "production-sensitive",
    ruleName: "k8s",
    patterns: [
      /\b(kubectl|helm|skaffold)\b/i,
    ],
  },
  {
    category: "production-sensitive",
    ruleName: "iac-apply-destroy",
    patterns: [
      /\b(terraform|pulumi)\s+(apply|destroy|up)\b/i,
    ],
  },
  {
    category: "production-sensitive",
    ruleName: "docker-registry",
    patterns: [
      /\bdocker\s+(push|login)\b/i,
    ],
  },

  // 2. DESTRUCTIVE-LOCAL
  {
    category: "destructive-local",
    ruleName: "delete-files-recursive",
    patterns: [
      /\brm\s+(-[a-z]*r[a-z]*f?|--recursive)\b/i,
      /\brmdir\s+.*\/s\b/i,
      /\bdel\s+.*\/s\b/i,
      /\bRemove-Item\b.*(-Recurse|-r\b)/i,
      /\bshred\b/i,
    ],
  },
  {
    category: "destructive-local",
    ruleName: "git-destructive",
    patterns: [
      /\bgit\s+reset\s+--hard\b/i,
      /\bgit\s+clean\s+(-[a-z]*f[a-z]*|--force)\b/i,
      /\bgit\s+checkout\s+--\s+\./i,
      /\bgit\s+restore\s+(\.|\/|$|\s)/i,
      /\bgit\s+stash\s+drop\b/i,
      /\bgit\s+branch\s+-D\b/i,
    ],
  },
  {
    category: "destructive-local",
    ruleName: "sql-destructive",
    patterns: [
      /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE|TRUNCATE)\b/i,
      /\bDELETE\s+FROM\s+\w+\s*$/i, // DELETE FROM table without WHERE
    ],
  },
  {
    category: "destructive-local",
    ruleName: "format-disk",
    patterns: [
      /\b(format\s+[a-z]:|mkfs|diskpart)\b/i,
    ],
  },

  // 3. NETWORK
  {
    category: "network",
    ruleName: "git-remote",
    patterns: [
      /\bgit\s+(push|fetch|pull|clone)\b/i,
    ],
  },
  {
    category: "network",
    ruleName: "http-client",
    patterns: [
      /\b(curl|wget|fetch)\b/i,
      /\b(Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b/i,
    ],
  },
  {
    category: "network",
    ruleName: "remote-shell-transfer",
    patterns: [
      /\b(ssh|scp|sftp|rsync)\b/i,
    ],
  },
  {
    category: "network",
    ruleName: "npm-publish-auth",
    patterns: [
      /\b(npm|pnpm|yarn)\s+(publish|login|adduser)\b/i,
    ],
  },

  // 4. MODIFY-LOCAL
  {
    category: "modify-local",
    ruleName: "build-and-test",
    patterns: [
      /\b(npm|pnpm|yarn|bun)\s+(run|test|build|compile|lint|exec)\b/i,
      /\b(npx|tsx)\b/i,
      /\b(tsc|vitest|jest|eslint|prettier|make)\b/i,
      /\b(cargo\s+build|go\s+build|cargo\s+test|go\s+test)\b/i,
    ],
  },
  {
    category: "modify-local",
    ruleName: "git-local-safe",
    patterns: [
      /\bgit\s+(add|commit|checkout|switch|merge|stash|rebase)\b/i,
    ],
  },
  {
    category: "modify-local",
    ruleName: "fs-modify",
    patterns: [
      /\b(touch|mkdir|New-Item|cp|copy|mv|move|Rename-Item)\b/i,
    ],
  },
  {
    category: "modify-local",
    ruleName: "package-install",
    patterns: [
      /\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b/i,
      /\bpip\s+install\b/i,
    ],
  },

  // 5. READ-ONLY (Lowest modification risk)
  {
    category: "read-only",
    ruleName: "git-read",
    patterns: [
      /\bgit\s+(status|log|diff|branch|show|blame|rev-parse|stash\s+list)\b/i,
    ],
  },
  {
    category: "read-only",
    ruleName: "fs-read",
    patterns: [
      /\b(ls|dir|cat|type|head|tail|less|more|find|fd|rg|grep|wc|file|stat)\b/i,
      /\b(Get-Content|gc|Get-ChildItem|gci|Select-String|sls)\b/i,
    ],
  },
  {
    category: "read-only",
    ruleName: "env-and-info",
    patterns: [
      /\b(which|where|echo|pwd|hostname|env|set|printenv|whoami)\b/i,
      /\b(node|npm|python|python3|git|tsc)\s+--version\b/i,
    ],
  },
];

const CATEGORY_SEVERITY: Record<GuardCategory, number> = {
  "production-sensitive": 5,
  "destructive-local": 4,
  "network": 3,
  "modify-local": 2,
  "read-only": 1,
  "unknown": 0,
};

/**
 * Split a complex command line (e.g. pipes, semicolons, &&, ||) into segments.
 */
function splitCommandSegments(command: string): string[] {
  // Simple delimiter split on ;, &&, ||, |
  return command
    .split(/(?:&&|\|\||;|\|)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Classifies a single command segment against static rules.
 */
function classifySingleSegment(segment: string): ClassifierResult {
  const trimmed = segment.trim();

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return {
          category: rule.category,
          confidence: 0.95,
          matchedRule: rule.ruleName,
        };
      }
    }
  }

  return {
    category: "unknown",
    confidence: 0,
    matchedRule: "none",
  };
}

/**
 * Fast deterministic classifier (< 1ms). Evaluates command strings,
 * including piped or chained commands, returning the highest risk category found.
 */
export function classifyCommand(command: string): ClassifierResult {
  const segments = splitCommandSegments(command);

  if (segments.length === 0) {
    return {
      category: "read-only",
      confidence: 1.0,
      matchedRule: "empty-command",
    };
  }

  let highestResult: ClassifierResult = {
    category: "unknown",
    confidence: 0,
    matchedRule: "none",
  };
  let highestSeverity = -1;

  for (const seg of segments) {
    const res = classifySingleSegment(seg);
    const severity = CATEGORY_SEVERITY[res.category];

    if (severity > highestSeverity) {
      highestSeverity = severity;
      highestResult = res;
    }
  }

  return highestResult;
}
