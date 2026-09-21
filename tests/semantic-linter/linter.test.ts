import { describe, it, expect } from "vitest";
import { lintSemantic } from "../../src/semantic-linter/index.js";

describe("Semantic Linter (Phase 8)", () => {
  it("passes cleanly on safe additive changes with tests", async () => {
    const safeDiff = `
diff --git a/src/math.ts b/src/math.ts
+ export function add(a: number, b: number) { return a + b; }
diff --git a/tests/math.test.ts b/tests/math.test.ts
+ it('adds', () => expect(add(1, 2)).toBe(3));
`;

    const result = await lintSemantic({
      diff: safeDiff,
      useJev: false,
    });

    expect(result.passed).toBe(true);
    expect(result.failedRules).toBe(0);
    expect(result.markdownReport).toContain("Report");
  });

  it("detects destructive database migrations (e.g. DROP TABLE)", async () => {
    const dangerousSqlDiff = `
diff --git a/migrations/20260921_cleanup.sql b/migrations/20260921_cleanup.sql
+ DROP TABLE legacy_users;
`;

    const result = await lintSemantic({
      diff: dangerousSqlDiff,
      useJev: false,
    });

    expect(result.passed).toBe(false);
    const migrationRule = result.evaluations.find((e) => e.ruleId === "dangerous_migration");
    expect(migrationRule).toBeDefined();
    expect(migrationRule?.passed).toBe(false);
    expect(migrationRule?.severity).toBe("error");
  });

  it("flags UI component directly executing database queries", async () => {
    const uiDomainMixingDiff = `
diff --git a/src/ui/UserProfile.tsx b/src/ui/UserProfile.tsx
+ const data = await db.query("SELECT * FROM users WHERE id = ?", [id]);
`;

    const result = await lintSemantic({
      diff: uiDomainMixingDiff,
      useJev: false,
    });

    const uiRule = result.evaluations.find((e) => e.ruleId === "ui_domain_mixing");
    expect(uiRule).toBeDefined();
    expect(uiRule?.passed).toBe(false);
    expect(uiRule?.severity).toBe("warning");
  });

  it("respects advisory-only mode even when rule violations are present", async () => {
    const dangerousSqlDiff = `
diff --git a/migrations/001.sql b/migrations/001.sql
+ DROP TABLE sensitive_records;
`;

    const result = await lintSemantic({
      diff: dangerousSqlDiff,
      advisoryOnly: true,
      useJev: false,
    });

    // In advisory mode, overall result is considered passed for CI exit code
    expect(result.passed).toBe(true);
    expect(result.failedRules).toBeGreaterThan(0);
  });
});
