import { describe, it, expect } from "vitest";
import { compareSemver } from "../../src/shared/update-checker.js";

describe("compareSemver", () => {
  it("compares stable major, minor, patch and optional v prefixes", () => {
    for (const latest of ["0.1.4", "0.2.0", "1.0.0", "v0.1.4"]) expect(compareSemver("0.1.3", latest)).toBe(1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.2.0", "0.1.9")).toBe(-1);
  });
});
