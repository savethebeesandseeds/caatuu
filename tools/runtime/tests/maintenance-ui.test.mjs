import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(
  new URL("../../../apps/caatuu-czech/static/maintenance-ui.js", import.meta.url),
  "utf8"
);
const stored = new Map();
const sessionStored = new Map();
function storage(map) {
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key)
  };
}
const context = {
  window: {
    location: { href: "" },
    localStorage: storage(stored),
    sessionStorage: storage(sessionStored)
  }
};
runInNewContext(source, context, { filename: "maintenance-ui.js" });
const ui = context.window.CaatuuMaintenanceUi;

function control() {
  const copy = { textContent: "" };
  const rowClasses = new Set();
  const buttonClasses = new Set();
  const row = {
    hidden: true,
    querySelector: (selector) => selector === "[data-update-app-copy]" ? copy : null,
    classList: { toggle: (name, enabled) => enabled ? rowClasses.add(name) : rowClasses.delete(name) }
  };
  const attributes = new Map();
  return {
    row,
    copy,
    rowClasses,
    buttonClasses,
    button: {
      hidden: true,
      disabled: true,
      textContent: "",
      closest: () => row,
      classList: { toggle: (name, enabled) => enabled ? buttonClasses.add(name) : buttonClasses.delete(name) },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name)
    }
  };
}

test("native self-update control remains visible for a manual check", () => {
  const { button, row } = control();
  ui.setUpdateAppControl(button, { env: "android" }, {
    selfUpdateEnabled: true,
    updateAvailable: false
  });

  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Check for updates");
  assert.equal(button.getAttribute("aria-disabled"), "false");
  assert.equal(row.hidden, false);
});

test("checking state is visible in the control and accessible status", () => {
  const { button, copy, rowClasses, buttonClasses } = control();
  ui.setUpdateAppControl(button, { env: "android" }, {
    selfUpdateEnabled: true,
    currentVersionName: "0.1.91"
  }, { busy: true });

  assert.equal(button.textContent, "Checking for updates...");
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(copy.textContent, "Contacting the update server. This can take a few seconds.");
  assert.equal(rowClasses.has("is-busy"), true);
  assert.equal(buttonClasses.has("is-busy"), true);
});

test("native control becomes an Update action only for a newer version", () => {
  const { button } = control();
  ui.setUpdateAppControl(button, { env: "android" }, {
    selfUpdateEnabled: true,
    updateAvailable: true,
    currentVersionCode: 82,
    currentVersionName: "0.1.82",
    latestVersionCode: 83,
    latestVersionName: "0.1.83"
  });

  assert.equal(button.textContent, "Update 0.1.83");
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
});

test("a verified cached APK becomes an Install action without another download", () => {
  const { button, copy } = control();
  const status = {
    selfUpdateEnabled: true,
    serverReachable: false,
    updateAvailable: false,
    currentVersionCode: 94,
    currentVersionName: "0.1.93",
    latestVersionCode: 95,
    latestVersionName: "0.1.94",
    downloadedVersionCode: 95,
    downloadedVersionName: "0.1.94",
    downloadReady: true,
    downloadState: "ready"
  };

  ui.setUpdateAppControl(button, { env: "android" }, status);

  assert.equal(ui.updateDownloadState(status), "ready");
  assert.equal(ui.hasNativeAppUpdate(status), true);
  assert.equal(button.textContent, "Install 0.1.94");
  assert.match(copy.textContent, /already downloaded and verified/i);
  assert.match(ui.updateStatusLine(status), /ready to install/i);
});

test("a partial APK becomes a Resume action with saved progress", () => {
  const { button, copy } = control();
  const status = {
    selfUpdateEnabled: true,
    updateAvailable: true,
    currentVersionCode: 94,
    currentVersionName: "0.1.93",
    latestVersionCode: 95,
    latestVersionName: "0.1.94",
    downloadState: "partial",
    partialBytes: 30,
    latestBytes: 100,
    downloadProgress: 30
  };

  ui.setUpdateAppControl(button, { env: "android" }, status);

  assert.equal(ui.updateDownloadState(status), "partial");
  assert.equal(ui.updateDownloadPercent(status), 30);
  assert.equal(button.textContent, "Resume update");
  assert.match(copy.textContent, /30%/);
  assert.equal(ui.updateConfirmation(status).action, "Resume update");
});

test("an active system download is visible, disabled, and described as background work", () => {
  const { button, copy } = control();
  const status = {
    selfUpdateEnabled: true,
    updateAvailable: true,
    currentVersionCode: 94,
    currentVersionName: "0.1.93",
    latestVersionCode: 95,
    latestVersionName: "0.1.94",
    downloadActive: true,
    downloadState: "running",
    partialBytes: 45,
    latestBytes: 100,
    downloadProgress: 45
  };

  ui.setUpdateAppControl(button, { env: "android" }, status);

  assert.equal(ui.updateDownloadState(status), "active");
  assert.equal(button.textContent, "Downloading 45%");
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.match(copy.textContent, /downloading in the background \(45%\)/i);
  assert.match(ui.updateStatusLine(status), /downloading in the background \(45%\)/i);
});

test("a failed system download becomes an explicit retry instead of an install action", () => {
  const { button, copy } = control();
  const status = {
    selfUpdateEnabled: true,
    updateAvailable: true,
    currentVersionCode: 94,
    latestVersionCode: 95,
    latestVersionName: "0.1.94",
    downloadState: "failed",
    partialBytes: 45,
    latestBytes: 100,
    resumable: false
  };

  ui.setUpdateAppControl(button, { env: "android" }, status);

  assert.equal(ui.updateDownloadState(status), "failed");
  assert.equal(button.textContent, "Retry update");
  assert.equal(button.disabled, false);
  assert.match(copy.textContent, /download stopped/i);
  assert.match(ui.updateStatusLine(status), /download stopped/i);
});

test("a stale or mismatched cached APK is never offered for installation", () => {
  for (const status of [
    {
      selfUpdateEnabled: true,
      currentVersionCode: 95,
      currentVersionName: "0.1.94",
      latestVersionCode: 95,
      latestVersionName: "0.1.94",
      downloadedVersionCode: 95,
      downloadedVersionName: "0.1.94",
      downloadReady: true,
      downloadState: "ready"
    },
    {
      selfUpdateEnabled: true,
      updateAvailable: true,
      currentVersionCode: 94,
      currentVersionName: "0.1.93",
      latestVersionCode: 96,
      latestVersionName: "0.1.95",
      downloadedVersionCode: 95,
      downloadedVersionName: "0.1.94",
      downloadReady: true,
      downloadState: "ready"
    }
  ]) {
    const { button, copy } = control();
    ui.setUpdateAppControl(button, { env: "android" }, status);

    assert.equal(ui.updateDownloadState(status), "idle");
    assert.doesNotMatch(button.textContent, /^Install\b/);
    assert.doesNotMatch(copy.textContent, /already downloaded and verified/i);
  }
});

test("installer copy explicitly reports reuse of a verified APK", () => {
  const message = ui.updateResultMessage({ reused: true, action: "installer" });
  assert.match(message, /already downloaded verified APK/i);
  assert.doesNotMatch(message, /download(?:ing)? again/i);
});

test("confirmed updates persist a versioned Setup handoff across WebView recreation", () => {
  ui.beginAppUpdate({
    currentVersionCode: 82,
    currentVersionName: "0.1.82",
    latestVersionCode: 83,
    latestVersionName: "0.1.83"
  });

  assert.equal(context.window.location.href, "home.html?app-update=1&version=0.1.83");
  assert.equal(ui.pendingAppUpdate().latestVersionCode, 83);
  assert.equal(ui.pendingAppUpdate().latestVersionName, "0.1.83");
  assert.equal(sessionStored.size, 0, "the handoff must not depend on session-scoped storage");

  const recreatedContext = {
    window: {
      location: { href: "" },
      localStorage: storage(stored),
      sessionStorage: storage(new Map())
    }
  };
  runInNewContext(source, recreatedContext, { filename: "maintenance-ui.recreated.js" });
  const recreatedUi = recreatedContext.window.CaatuuMaintenanceUi;
  assert.equal(recreatedUi.pendingAppUpdate().latestVersionCode, 83);
  assert.equal(recreatedUi.pendingAppUpdate().latestVersionName, "0.1.83");

  recreatedUi.clearPendingAppUpdate();
  assert.equal(recreatedUi.pendingAppUpdate(), null);
  assert.equal(ui.pendingAppUpdate(), null);
});

test("update confirmation names the installed and available versions", () => {
  const confirmation = ui.updateConfirmation({
    currentVersionCode: 90,
    currentVersionName: "0.1.89",
    latestVersionCode: 91,
    latestVersionName: "0.1.90"
  });

  assert.equal(confirmation.title, "Install Caatuu 0.1.90?");
  assert.equal(confirmation.versions, "Installed: 0.1.89. Available: 0.1.90.");
  assert.equal(confirmation.action, "Update to 0.1.90");
});

test("browser and store-managed builds do not expose sideload controls", () => {
  for (const [runtime, status] of [
    [{ env: "browser" }, { selfUpdateEnabled: true }],
    [{ env: "android" }, { selfUpdateEnabled: false }]
  ]) {
    const { button, row } = control();
    ui.setUpdateAppControl(button, runtime, status);
    assert.equal(button.hidden, true);
    assert.equal(button.disabled, true);
    assert.equal(row.hidden, true);
  }
});

test("the shared controller announces a single in-flight update check immediately", async () => {
  const { button } = control();
  button.dataset = {};
  button.addEventListener = () => {};
  const statusNode = { textContent: "" };
  const versionNode = { textContent: "Version check pending", dataset: { fallbackVersion: "Version check pending" } };
  const browserInstall = { hidden: false };
  context.document = {
    querySelector(selector) {
      if (selector === "#updateApp") return button;
      if (selector === "#maintenanceStatus") return statusNode;
      if (selector === "#settingsVersion") return versionNode;
      if (selector === "#browserInstallActions") return browserInstall;
      return null;
    }
  };

  let resolveStatus;
  let calls = 0;
  const runtime = {
    env: "android",
    maintenance: {
      updateStatus() {
        calls += 1;
        return new Promise((resolve) => { resolveStatus = resolve; });
      }
    }
  };
  const controller = ui.createUpdateController(runtime);
  const first = controller.activate();
  const second = controller.activate();

  assert.equal(calls, 1);
  assert.equal(button.textContent, "Checking for updates...");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(statusNode.textContent, "Checking the update server...");

  resolveStatus({
    selfUpdateEnabled: true,
    updateAvailable: false,
    currentVersionCode: 93,
    currentVersionName: "0.1.92"
  });
  await Promise.all([first, second]);

  assert.equal(button.textContent, "Check for updates");
  assert.equal(statusNode.textContent, "Caatuu 0.1.92 (93). App is up to date.");
});
