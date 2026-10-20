import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractDiff } from "../../src/patch-reviewer/diff-extractor.js";

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
}));
const gitProcess = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).execFileSync;
let repo: string;
let firstCommit: string;
function git(...args: string[]): string {
  return gitProcess("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("Git revision extraction boundary", () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "jev revision fixtures "));
    git("init", "--quiet");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("config", "user.name", "Jev Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    const hooks = path.join(repo, "empty-hooks");
    fs.mkdirSync(hooks);
    git("config", "core.hooksPath", hooks);
    fs.writeFileSync(path.join(repo, "file with spaces.txt"), "first\n");
    git("add", "--", "file with spaces.txt");
    git("commit", "--quiet", "-m", "first");
    firstCommit = git("rev-parse", "HEAD").trim();
    git("branch", "baseline");
    git("branch", "literal;branch");
    fs.writeFileSync(path.join(repo, "file with spaces.txt"), "second\n");
    git("add", "--", "file with spaces.txt");
    git("commit", "--quiet", "-m", "second");
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => { if (repo) fs.rmSync(repo, { recursive: true, force: true }); });

  it.each(["HEAD~1", "baseline", "baseline..HEAD", "baseline...HEAD", "HEAD@{1}", "HEAD@{0 seconds ago}", "literal;branch"])("preserves legitimate opaque revision %s", async revision => {
    const result = await extractDiff({ task: "Inspect revision", repoPath: repo, commitRange: revision });
    expect(result.rawDiff).toBe(git("diff", revision, "--"));
    if (!revision.includes(" ")) expect(result.rawDiff).toContain("+second");
  });
  it("supports commit hashes and repository/file paths with spaces", async () => {
    expect(repo).toContain(" ");
    const result = await extractDiff({ task: "Inspect hash", repoPath: repo, commitRange: firstCommit });
    expect(result.filesChanged).toContain("file with spaces.txt");
  });
  it.each(["", " ", "--stat", "--output=unexpected.txt", " -R", "HEAD\u0000", "HEAD\n--stat", "HEAD\r", 7, null])("rejects invalid or option-shaped range %j without invoking Git", async revision => {
    const shell = vi.spyOn(childProcess, "execSync").mockReturnValue("");
    const direct = vi.spyOn(childProcess, "execFileSync").mockReturnValue("");
    await expect(extractDiff({ task: "Reject invalid input", repoPath: repo, commitRange: revision as string })).rejects.toThrow(/commit range/i);
    expect(shell).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(repo, "unexpected.txt"))).toBe(false);
  });
  it.each(["HEAD; INERT_PAYLOAD", "HEAD && INERT_PAYLOAD", "$(INERT_PAYLOAD)", "`INERT_PAYLOAD`", "%INERT_PAYLOAD%", "HEAD --output=unexpected.txt"])("never invokes a shell or splits revision data %s", async revision => {
    const shell = vi.spyOn(childProcess, "execSync").mockReturnValue("");
    const direct = vi.spyOn(childProcess, "execFileSync").mockReturnValue("");
    await extractDiff({ task: "Inspect inert argument", repoPath: repo, commitRange: revision });
    expect(shell).not.toHaveBeenCalled();
    expect(direct).toHaveBeenCalledWith("git", ["diff", revision, "--"], expect.objectContaining({ cwd: repo, encoding: "utf-8" }));
    expect(direct.mock.calls[0]?.[2]).not.toHaveProperty("shell", true);
  });
  it("rejects nonexistent revisions instead of treating a file as a path filter", async () => {
    fs.writeFileSync(path.join(repo, "not-a-revision"), "fixture\n");
    await expect(extractDiff({ task: "Inspect invalid ref", repoPath: repo, commitRange: "not-a-revision" })).rejects.toThrow(/Failed to execute/);
  });
  it("preserves direct diff and staged precedence", async () => {
    const result = await extractDiff({ task: "Direct empty input", repoPath: repo, diff: "", commitRange: "--stat" });
    expect(result.rawDiff).toBe("");
    const staged = await extractDiff({ task: "Staged input", repoPath: repo, staged: true, commitRange: "--stat" });
    expect(staged.rawDiff).toBe(git("diff", "--staged", "--"));
  });
});
