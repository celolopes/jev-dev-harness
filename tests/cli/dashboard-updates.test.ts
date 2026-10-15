import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

// Exercise the actual inline dashboard code without introducing a DOM dependency.
function dashboard(storage = new Map<string, string>()) {
  const elements = new Map<string, any>();
  const document = { getElementById(id: string) {
    if (!elements.has(id)) {
      const hidden = new Set(["hidden"]);
      elements.set(id, { textContent: "", href: "", hidden,
        classList: { add: (c: string) => hidden.add(c), toggle: (c: string, on: boolean) => on ? hidden.add(c) : hidden.delete(c) },
        addEventListener(_event: string, fn: () => void) { this.click = fn; }, click() {},
        set innerHTML(_html: string) { throw new Error("Untrusted markup rendered"); } });
    }
    return elements.get(id);
  } };
  const context = vm.createContext({ document, localStorage: { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v) }, fetch: vi.fn() });
  const html = fs.readFileSync(new URL("../../dashboard/index.html", import.meta.url), "utf8");
  const start = html.indexOf("    let updateNoticeKey");
  const end = html.indexOf("    // Init & Language Auto-detection", start);
  if (start < 0 || end < 0) throw new Error("Dashboard update script missing");
  vm.runInContext(html.slice(start, end), context);
  return { context, elements, storage, run: (code: string) => vm.runInContext(code, context) };
}
describe("Dashboard update notice", () => {
  it("renders shared text safely, persists dismissal and shows a different release", () => {
    const ui = dashboard();
    const info = { currentVersion: "0.2.12", latestVersion: "0.2.13", status: "update_available",
      notice: "Why: <img onerror=alert(1)>\nRequirements: Node.js >=22\nRestart required", releaseUrl: "https://github.com/celolopes/jev-dev-harness/releases/tag/v0.2.13" };
    ui.context.info = info; ui.run("renderUpdate(info)");
    expect(ui.elements.get("updateNotice").textContent).toBe(info.notice);
    expect(ui.elements.get("updateBanner").hidden.has("hidden")).toBe(false);
    ui.elements.get("dismissUpdate").click(); ui.run("renderUpdate(info)");
    expect(ui.elements.get("updateBanner").hidden.has("hidden")).toBe(true);
    const reload = dashboard(ui.storage); reload.context.info = info; reload.run("renderUpdate(info)");
    expect(reload.elements.get("updateBanner").hidden.has("hidden")).toBe(true);
    reload.context.info = { ...info, latestVersion: "0.2.14" }; reload.run("renderUpdate(info)");
    expect(reload.elements.get("updateBanner").hidden.has("hidden")).toBe(false);
  });
  it("shows unavailable on HTTP/network failure and hides the notice when current", async () => {
    const ui = dashboard();
    ui.context.fetch.mockResolvedValueOnce({ ok: false });
    await ui.run("checkUpdates()");
    expect(ui.elements.get("updateNotice").textContent).toContain("status is unknown");
    expect(ui.elements.get("updateRelease").hidden.has("hidden")).toBe(true);
    ui.context.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ currentVersion: "0.2.13", latestVersion: "0.2.13", status: "up_to_date", notice: null }) });
    await ui.run("checkUpdates()");
    expect(ui.elements.get("updateBanner").hidden.has("hidden")).toBe(true);
  });
});
