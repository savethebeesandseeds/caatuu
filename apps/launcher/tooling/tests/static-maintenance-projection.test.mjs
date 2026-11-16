import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformStaticMaintenance } from "../build-static-site.mjs";
import { restorePagesMaintenance } from "../build-pages-site.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const publicPath = "language-runtime/static/source/maintenance-ui.js";
const canonical = readFileSync(join(workspaceRoot, "apps", publicPath), "utf8").replaceAll("\r\n", "\n");

async function renderAndRefreshSettings(source) {
  let requests = 0;
  let statusChecks = 0;
  const version = { textContent: "", isConnected: true };
  const button = { dataset: {}, addEventListener() {}, setAttribute() {},
    querySelector() { return null; }, closest() { return null; } };
  const runtime = { env: "browser", maintenance: {
    async updateStatus() { statusChecks += 1; return { updateAvailable: false }; },
  } };
  const navigator = { onLine: true };
  const window = { CaatuuRuntime: runtime, navigator,
    location: { href: "https://example.test/es/" }, addEventListener() {} };
  const document = { readyState: "loading", visibilityState: "visible", addEventListener() {},
    querySelector(selector) { return selector === "#settingsVersion" ? version : null; },
    querySelectorAll(selector) {
      if (selector === "script[src]") return [{ getAttribute() {
        return "/language-runtime/static/source/app-bootstrap.mjs?v=app-777";
      } }];
      if (selector === "#updateApp, [data-app-update-control]") return [button];
      return [];
    },
  };
  runInNewContext(source, { window, navigator, document, URL,
    CaatuuI18n: { t: (key, parameters = {}) => key + JSON.stringify(parameters) },
    fetch: async (url, options) => {
      requests += 1;
      assert.equal(url, "/android/caatuu.json");
      assert.equal(options.cache, "no-store");
      return { ok: true, json: async () => ({ version_name: "test-version", version_code: 204 }) };
    },
  });
  // Evaluate the entire emitted script, then exercise both synchronous Settings
  // rendering and the async refresh. No lexical bindings are supplied by the test.
  const controller = window.CaatuuMaintenanceUi.createUpdateController(runtime);
  assert.ok(controller);
  controller.render();
  await controller.refresh({ force: true, announce: false });
  await new Promise(setImmediate);
  assert.equal(statusChecks, 1);
  return { requests, version: version.textContent };
}

test("standalone Settings works without an APK request; Pages preserves the published version display", async () => {
  const projected = transformStaticMaintenance(canonical);
  assert.doesNotMatch(projected, /\/android\//u);
  const standalone = await renderAndRefreshSettings(projected);
  assert.equal(standalone.requests, 0);
  assert.match(standalone.version, /777/u);
  assert.doesNotMatch(standalone.version, /test-version/u);
  const siteDir = mkdtempSync(join(tmpdir(), "caatuu-maintenance-projection-"));
  try {
    const destination = join(siteDir, publicPath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, projected);
    restorePagesMaintenance({ workspaceRoot, siteDir });
    const restored = readFileSync(destination, "utf8");
    assert.equal(restored, canonical);
    const pages = await renderAndRefreshSettings(restored);
    assert.equal(pages.requests, 1);
    assert.match(pages.version, /test-version/u);
    writeFileSync(destination, projected + "\n// unexpected output mutation\n");
    assert.throws(() => restorePagesMaintenance({ workspaceRoot, siteDir }),
      /reviewed standalone static projection/u);
  } finally {
    rmSync(siteDir, { recursive: true, force: true });
  }
});
