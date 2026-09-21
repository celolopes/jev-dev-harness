import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { extractDiff } from "../../src/patch-reviewer/diff-extractor.js";

describe("Patch Reviewer: diff-extractor", () => {
  const mockApiKey = ["sk", "live", "1234567890abcdef1234567890abcdef"].join("-");
  const sampleDiff = `
diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
index 1234567..89abcdef 100644
--- a/src/auth/jwt.ts
+++ b/src/auth/jwt.ts
@@ -10,4 +10,6 @@ export function verifyToken(token: string) {
+  const secretKey = "${mockApiKey}";
+  return jwt.verify(token, secretKey);
 }
diff --git a/package-lock.json b/package-lock.json
index aaaaaaa..bbbbbbb 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,5 +1,6 @@
+{ "name": "dummy", "version": "1.0.0" }
diff --git a/tests/auth/jwt.test.ts b/tests/auth/jwt.test.ts
index ccccccc..ddddddd 100644
--- a/tests/auth/jwt.test.ts
+++ b/tests/auth/jwt.test.ts
@@ -5,2 +5,4 @@ describe("JWT", () => {
+  it("validates token", () => {});
 });
`;

  it("extracts diff, calculates changes, and filters out lockfiles", async () => {
    const data = await extractDiff({
      task: "Add JWT token verification",
      diff: sampleDiff,
    });

    expect(data.filesChanged).toContain("src/auth/jwt.ts");
    expect(data.filesChanged).toContain("tests/auth/jwt.test.ts");
    expect(data.filesChanged).not.toContain("package-lock.json");

    expect(data.additions).toBeGreaterThan(0);
    expect(data.sanitizedDiff).not.toContain("package-lock.json");
  });

  it("redacts credentials and secrets inside the diff", async () => {
    const data = await extractDiff({
      task: "Add JWT token verification",
      diff: sampleDiff,
    });

    // The raw diff has mock key
    expect(data.rawDiff).toContain(mockApiKey);

    // The sanitized diff must have it redacted
    expect(data.sanitizedDiff).not.toContain(mockApiKey);
    expect(data.sanitizedDiff).toContain("[REDACTED_API_KEY]");
  });

  it("reads diff from a file path", async () => {
    const tempFile = path.resolve("tests/fixtures/test-patch.diff");
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, sampleDiff, "utf-8");

    try {
      const data = await extractDiff({
        task: "Test patch file read",
        diffPath: tempFile,
      });

      expect(data.filesChanged.length).toBeGreaterThan(0);
      expect(data.sanitizedDiff).toContain("[REDACTED_API_KEY]");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("truncates extremely large diffs", async () => {
    // Generate large diff string > 10,000 characters
    const largeContent = "+ const data = 'some large test data string that repeats';\n".repeat(300);
    const largeDiff = `
diff --git a/src/huge.ts b/src/huge.ts
--- a/src/huge.ts
+++ b/src/huge.ts
@@ -1,1 +1,300 @@
${largeContent}
`;

    const data = await extractDiff({
      task: "Handle large diff",
      diff: largeDiff,
    });

    expect(data.sanitizedDiff).toContain("[DIFF TRUNCATED: Exceeded 8000 characters limit");
    expect(data.sanitizedDiff.length).toBeLessThan(8500);
  });
});
