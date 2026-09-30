import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));

assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "latest requires a stable version");
assert.equal(lock.version, pkg.version, "lockfile version differs from package.json");
assert.equal(lock.packages[""].version, pkg.version, "lockfile root version differs");
assert.equal(lock.name, pkg.name, "lockfile package name differs");
assert.equal(pkg.publishConfig.tag, "latest");
assert.equal(pkg.publishConfig.registry, "https://registry.npmjs.org/");
assert.ok(read("src/shared/version.ts").includes(`cachedVersion || "${pkg.version}"`), "update the version resolver fallback");
assert.ok(read("CHANGELOG.md").includes(`## ${pkg.version}`), "add release notes before publishing");
console.log(`Release metadata valid: ${pkg.name}@${pkg.version} (npm latest; git v${pkg.version})`);
