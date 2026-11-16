import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import path from "node:path";

const state = vi.hoisted(() => ({ files: new Map<string, string>(), constructors: vi.fn(), request: vi.fn() }));
vi.mock("node:fs", () => ({ default: {
  existsSync: (name: string) => state.files.has(String(name)),
  readFileSync: (name: string) => { if (!state.files.has(String(name))) throw new Error("Missing mocked file"); return state.files.get(String(name))!; },
  writeFileSync: (name: string, value: string) => state.files.set(String(name), value),
  appendFileSync: (name: string, value: string) => state.files.set(String(name), (state.files.get(String(name)) || "") + value),
  mkdirSync: vi.fn(),
} }));
vi.mock("node:os", () => ({ default: { homedir: () => "/jev-setup-memory-home" } }));
vi.mock("node:readline", () => ({ default: { createInterface: () => ({ close: vi.fn(), question: () => { throw new Error("Unexpected interactive prompt"); } }) } }));
vi.mock("../../src/cli/doctor.js", () => ({ getAgentRuleContent: () => "synthetic rules" }));
vi.mock("../../src/shared/ignore.js", () => ({ ensureGitignoreJevCache: () => ({ ignored: true }) }));
vi.mock("../../src/shared/typesafe-client.js", () => ({
  DEFAULT_JEV_MODELS: { typesafe: "jev-1.14.0", openrouter: "typesafe/jev-1.14", vercel: "typesafe-ai/jev-1.14.0" },
  normalizeTypeSafeModel: (model: string) => model === "typesafe/jev-1.13" ? "jev-1.13.0" : model,
  noul: () => ({}),
  SafeJevClient: class { constructor(options: unknown) { state.constructors(options); } systemOne = state.request; },
}));
import { runSetupWizard } from "../../src/cli/setup.js";
const globalFile = path.join("/jev-setup-memory-home", ".jev-dev", "config.json");
const codexFile = path.join("/jev-setup-memory-home", ".codex", "config.toml");
beforeEach(() => {
  state.files.clear(); state.constructors.mockClear(); state.request.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  for (const name of ["TYPESAFE_API_KEY", "JEV_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_KEY", "VERCEL_OIDC_TOKEN", "TYPESAFE_DEFAULT_MODEL", "OPENROUTER_MODEL", "VERCEL_MODEL"]) vi.stubEnv(name, "");
  state.files.set(codexFile, "# existing unrelated config\n");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("setup model persistence without real filesystem or network", () => {
  it.each([
    ["typesafe", "jev-1.13.0", "TYPESAFE_DEFAULT_MODEL"],
    ["vercel", "typesafe-ai/jev", "VERCEL_MODEL"],
    ["openrouter", "typesafe/jev-1.13", "OPENROUTER_MODEL"],
  ])("persists explicit %s pin and healthchecks that exact selected model", async (provider, model, variable) => {
    vi.stubEnv(variable, "ambient-old-model");
    state.files.set(globalFile, JSON.stringify({ provider: "unrelated", model: "foreign-provider-model" }));
    await runSetupWizard({ provider, model, key: "synthetic-test-key", nonInteractive: true });
    expect(JSON.parse(state.files.get(globalFile)!)).toMatchObject({ provider, model });
    expect(state.files.get(path.resolve(".env"))).toContain(`${variable}=${model}`);
    expect(state.files.get(codexFile)).toContain(`${variable} = "${model}"`);
    expect(state.files.get(codexFile)).toContain("# existing unrelated config");
    expect(state.constructors).toHaveBeenCalledWith(expect.objectContaining({ provider, defaultModel: model, apiKey: "synthetic-test-key" }));
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not transplant another provider model when configuring TypeSafe", async () => {
    state.files.set(globalFile, JSON.stringify({ provider: "openrouter", model: "another-provider-model" }));
    await runSetupWizard({ provider: "typesafe", key: "synthetic-test-key", nonInteractive: true });
    expect(JSON.parse(state.files.get(globalFile)!)).toMatchObject({ provider: "typesafe", model: "jev-1.14.0" });
  });
  it("preserves a saved TypeSafe legacy version pin with native normalization", async () => {
    state.files.set(globalFile, JSON.stringify({ provider: "typesafe", model: "typesafe/jev-1.13" }));
    await runSetupWizard({ provider: "typesafe", key: "synthetic-test-key", nonInteractive: true });
    expect(JSON.parse(state.files.get(globalFile)!)).toMatchObject({ model: "jev-1.13.0" });
    expect(state.constructors).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "jev-1.13.0" }));
  });
});
