import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { IgnoreFilter } from "../../src/shared/ignore.js";

describe("IgnoreFilter Module", () => {
  const dummyRepo = path.resolve("tests/fixtures/dummy-ignore-repo");

  beforeAll(() => {
    if (!fs.existsSync(dummyRepo)) {
      fs.mkdirSync(dummyRepo, { recursive: true });
      fs.writeFileSync(path.join(dummyRepo, ".gitignore"), "ignored-dir/\n*.custom-ignore\n");
      fs.writeFileSync(path.join(dummyRepo, ".jevignore"), "jev-only/\n");
    }
  });

  afterAll(() => {
    if (fs.existsSync(dummyRepo)) {
      fs.rmSync(dummyRepo, { recursive: true, force: true });
    }
  });

  it("ignores default patterns (node_modules, dist, .git)", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("node_modules/express/index.js")).toBe(true);
    expect(filter.shouldIgnore("dist/bundle.js")).toBe(true);
    expect(filter.shouldIgnore(".git/config")).toBe(true);
    expect(filter.shouldIgnore("package-lock.json")).toBe(true);
    expect(filter.shouldIgnore(".env")).toBe(true);
    expect(filter.shouldIgnore(".env.local")).toBe(true);
  });

  it("respects .gitignore and .jevignore", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("ignored-dir/file.txt")).toBe(true);
    expect(filter.shouldIgnore("foo.custom-ignore")).toBe(true);
    expect(filter.shouldIgnore("jev-only/sub.ts")).toBe(true);
    expect(filter.shouldIgnore("src/index.ts")).toBe(false);
  });

  it("identifies binary extensions", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("images/logo.png")).toBe(true);
    expect(filter.shouldIgnore("app.exe")).toBe(true);
    expect(filter.shouldIgnore("archive.zip")).toBe(true);
    expect(filter.shouldIgnore("src/logo.svg")).toBe(false); // SVGs are text XML
  });

  it("normalizes Windows backslashes properly", () => {
    const filter = new IgnoreFilter(dummyRepo);

    expect(filter.shouldIgnore("node_modules\\pkg\\index.js")).toBe(true);
    expect(filter.shouldIgnore("src\\components\\Button.tsx")).toBe(false);
  });
});
