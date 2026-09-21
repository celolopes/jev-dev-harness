import { describe, it, expect } from "vitest";
import { classifyCommand } from "../../src/tool-guard/classifier.js";

describe("Tool Call Guard: classifier", () => {
  describe("read-only commands", () => {
    it.each([
      ["git status", "git-read"],
      ["git log -n 5", "git-read"],
      ["git diff", "git-read"],
      ["git branch -a", "git-read"],
      ["ls -la", "fs-read"],
      ["dir", "fs-read"],
      ["cat package.json", "fs-read"],
      ["Get-Content src/index.ts", "fs-read"],
      ["node --version", "env-and-info"],
      ["echo 'Hello World'", "env-and-info"],
      ["pwd", "env-and-info"],
    ])("classifies '%s' as read-only", (cmd, expectedRule) => {
      const res = classifyCommand(cmd);
      expect(res.category).toBe("read-only");
      expect(res.matchedRule).toBe(expectedRule);
      expect(res.confidence).toBeGreaterThan(0.9);
    });
  });

  describe("modify-local commands", () => {
    it.each([
      ["npm test", "build-and-test"],
      ["npm run build", "build-and-test"],
      ["npx tsc --noEmit", "build-and-test"],
      ["vitest run", "build-and-test"],
      ["git add .", "git-local-safe"],
      ["git commit -m 'feat: initial'", "git-local-safe"],
      ["git checkout -b feature/test", "git-local-safe"],
      ["mkdir src/new-folder", "fs-modify"],
      ["touch src/new-file.ts", "fs-modify"],
      ["npm install @types/node", "package-install"],
    ])("classifies '%s' as modify-local", (cmd, expectedRule) => {
      const res = classifyCommand(cmd);
      expect(res.category).toBe("modify-local");
      expect(res.matchedRule).toBe(expectedRule);
    });
  });

  describe("destructive-local commands", () => {
    it.each([
      ["rm -rf node_modules", "delete-files-recursive"],
      ["rm -r build", "delete-files-recursive"],
      ["del /s /q dist", "delete-files-recursive"],
      ["Remove-Item -Recurse ./temp", "delete-files-recursive"],
      ["git reset --hard HEAD~1", "git-destructive"],
      ["git clean -fd", "git-destructive"],
      ["git checkout -- .", "git-destructive"],
      ["git restore .", "git-destructive"],
      ["DROP TABLE users", "sql-destructive"],
      ["TRUNCATE TABLE logs", "sql-destructive"],
    ])("classifies '%s' as destructive-local", (cmd, expectedRule) => {
      const res = classifyCommand(cmd);
      expect(res.category).toBe("destructive-local");
      expect(res.matchedRule).toBe(expectedRule);
    });
  });

  describe("network commands", () => {
    it.each([
      ["git push origin main", "git-remote"],
      ["git pull", "git-remote"],
      ["git fetch", "git-remote"],
      ["git clone https://github.com/org/repo.git", "git-remote"],
      ["curl https://api.github.com", "http-client"],
      ["wget http://example.com/file.zip", "http-client"],
      ["Invoke-WebRequest -Uri https://example.com", "http-client"],
      ["ssh root@remote.server.com", "remote-shell-transfer"],
      ["npm publish", "npm-publish-auth"],
    ])("classifies '%s' as network", (cmd, expectedRule) => {
      const res = classifyCommand(cmd);
      expect(res.category).toBe("network");
      expect(res.matchedRule).toBe(expectedRule);
    });
  });

  describe("production-sensitive commands", () => {
    it.each([
      ["gcloud compute instances list", "cloud-gcp"],
      ["gsutil rm gs://prod-bucket/file", "cloud-gcp"],
      ["bq query --use_legacy_sql=false 'SELECT 1'", "cloud-gcp"],
      ["aws s3 ls", "cloud-aws"],
      ["az login", "cloud-azure"],
      ["kubectl get pods -n production", "k8s"],
      ["terraform apply -auto-approve", "iac-apply-destroy"],
      ["pulumi up", "iac-apply-destroy"],
      ["docker push myregistry/image:latest", "docker-registry"],
    ])("classifies '%s' as production-sensitive", (cmd, expectedRule) => {
      const res = classifyCommand(cmd);
      expect(res.category).toBe("production-sensitive");
      expect(res.matchedRule).toBe(expectedRule);
    });
  });

  describe("piped and chained commands", () => {
    it("selects the highest risk category when chaining commands", () => {
      // read-only + destructive-local -> destructive-local
      const res1 = classifyCommand("cat package.json && rm -rf dist");
      expect(res1.category).toBe("destructive-local");

      // modify-local + production-sensitive -> production-sensitive
      const res2 = classifyCommand("npm run build && gcloud app deploy");
      expect(res2.category).toBe("production-sensitive");

      // read-only + read-only -> read-only
      const res3 = classifyCommand("cat file.txt | grep error");
      expect(res3.category).toBe("read-only");
    });
  });
});
