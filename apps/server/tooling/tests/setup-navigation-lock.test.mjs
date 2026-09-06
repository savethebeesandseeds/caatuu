import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "../../../language-runtime/tests/helpers/fake-browser.mjs";

const repoRoot = new URL("../../../../", import.meta.url);
const setupSource = await readFile(new URL("apps/languages/czech/static/source/features/setup/setup.js", repoRoot), "utf8");
const homeStyles = await readFile(new URL("apps/language-runtime/static/styles/caatuu-home.css", repoRoot), "utf8");
const start = setupSource.indexOf("  function setNavigationLocked(locked)");
const end = setupSource.indexOf("  function renderSetupEvent(message)", start);
assert.ok(start >= 0 && end > start, "the actual setup navigation controller is available");

function setupNavigation() {
  const harness = createBrowserHarness();
  const { document, context, window } = harness;
  const nav = document.createElement("nav");
  nav.dataset.caatuuBottomNav = "";
  const buttons = Object.fromEntries(["home", "games", "settings"].map((key) => {
    const button = document.createElement("button");
    button.dataset.navKey = key;
    nav.append(button);
    return [key, button];
  }));
  const header = document.createElement("header");
  header.dataset.caatuuAppHeader = "";
  const headerButton = document.createElement("button");
  header.append(headerButton);
  document.body.append(nav, header);
  const destinations = [];
  const messages = [];
  const logs = [];
  window.CaatuuChrome = { showHomeDestination: (target) => destinations.push(target) };
  context.pushLog = (...entry) => logs.push(entry);
  context.setText = (selector, text) => messages.push({ selector, text });
  vm.runInContext(`let navigationLocked = false; let appUpdateLocked = false;\n${setupSource.slice(start, end)}\nbindNavigationLock();`, context);
  return {
    ...harness, buttons, destinations, headerButton, logs, messages, nav,
    lock(locked, update = false) {
      vm.runInContext(`appUpdateLocked = ${Boolean(update)}; setNavigationLocked(${Boolean(locked)});`, context);
    },
    click(target) {
      const event = { type: "click", target };
      document.dispatchEvent(event);
      return event;
    }
  };
}

test("incomplete setup keeps a keyboard-accessible Home recovery route while guarding Games and Backpack", () => {
  const browser = setupNavigation();
  browser.lock(true);
  assert.equal(browser.document.body.classList.contains("setup-blocked"), true);
  assert.equal(browser.nav.dataset.setupLocked, "true");
  assert.equal(browser.nav.getAttribute("aria-disabled"), "false", "the containing nav must not disable its Home descendant");
  assert.equal(browser.buttons.home.hasAttribute("aria-disabled"), false);
  assert.notEqual(browser.buttons.home.tabIndex, -1);
  browser.buttons.home.focus();
  assert.equal(browser.document.activeElement, browser.buttons.home);

  const homeClick = browser.click(browser.buttons.home);
  assert.equal(homeClick.defaultPrevented, true);
  assert.equal(homeClick.immediatePropagationStopped, true, "the ordinary Home-menu handler must not intercept setup recovery");
  assert.deepEqual(browser.destinations, ["home"]);
  assert.deepEqual(browser.messages, []);

  for (const key of ["games", "settings"]) {
    assert.equal(browser.buttons[key].getAttribute("aria-disabled"), "true");
    assert.equal(browser.buttons[key].tabIndex, -1);
    assert.equal(browser.click(browser.buttons[key]).defaultPrevented, true);
    assert.equal(browser.messages.at(-1).text, "Finish setup before opening app sections.");
  }
  assert.equal(browser.click(browser.headerButton).defaultPrevented, false);
  assert.deepEqual(browser.destinations, ["home"]);
});

test("verified readiness unlocks ordinary navigation without rerouting its clicks", () => {
  const browser = setupNavigation();
  browser.lock(true);
  browser.lock(false);
  assert.equal(browser.document.body.classList.contains("setup-blocked"), false);
  assert.equal(browser.nav.dataset.setupLocked, "false");
  for (const button of Object.values(browser.buttons)) {
    assert.equal(button.hasAttribute("aria-disabled"), false);
    assert.equal(button.hasAttribute("tabindex"), false);
    assert.equal(browser.click(button).defaultPrevented, false);
  }
  assert.deepEqual(browser.destinations, []);
  assert.deepEqual(browser.messages, []);
});

test("a confirmed app update retains the full dock and header lock, including Home", () => {
  const browser = setupNavigation();
  browser.lock(true, true);
  assert.equal(browser.document.body.classList.contains("app-update-lock"), true);
  assert.equal(browser.nav.getAttribute("aria-disabled"), "true");
  for (const button of [...Object.values(browser.buttons), browser.headerButton]) {
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(button.tabIndex, -1);
    assert.equal(browser.click(button).defaultPrevented, true);
    assert.equal(browser.messages.at(-1).text, "Finish or retry the app update before opening other sections.");
  }
  assert.deepEqual(browser.destinations, []);
  browser.lock(true, false);
  assert.equal(browser.document.body.classList.contains("app-update-lock"), false);
  assert.equal(browser.buttons.home.hasAttribute("aria-disabled"), false);
  assert.equal(browser.headerButton.hasAttribute("aria-disabled"), false);
});

test("the visual pointer lock exempts only ordinary-setup Home, never the confirmed update lock", () => {
  assert.match(homeStyles, /body\.setup-blocked \.bottom-app-nav \.app-nav-item:not\(\[data-nav-key="home"\]\),/u);
  assert.match(homeStyles, /\.bottom-app-nav\[data-setup-locked="true"\] \.app-nav-item:not\(\[data-nav-key="home"\]\),/u);
  assert.match(homeStyles, /body\.app-update-lock \.bottom-app-nav \.app-nav-item \{\s*opacity: 0\.42;\s*pointer-events: none;/u);
});
