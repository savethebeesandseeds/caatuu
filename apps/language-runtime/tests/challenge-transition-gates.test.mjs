import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fixture({ embedded = false, dynamics = true, hidden = true, crossOrigin = false } = {}) {
  const shell = createBrowserHarness();
  if (dynamics) shell.window.CaatuuGameDynamics = {};
  const browser = embedded ? createBrowserHarness() : shell;
  const panel = shell.document.createElement("section");
  panel.setAttribute("data-train-panel", "test-game");
  shell.document.body.append(panel);
  if (embedded) {
    browser.window.parent = shell.window;
    browser.window.frameElement = shell.document.createElement("iframe");
    panel.append(browser.window.frameElement);
    if (crossOrigin) browser.window.location.origin = "https://another.example";
  }
  const container = browser.document.createElement("section");
  container.hidden = hidden;
  (embedded ? browser.document.body : panel).append(container);
  const events = [];
  shell.window.addEventListener("caatuu:challenge-transition", (event) => events.push(event.detail));
  const loader = mountRobotLoadingScreen({ container, label: "Preparing", active: true });
  return { shell, browser, panel, container, events, loader };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test("inline and same-origin embedded transitions report their shared panel without repeated show events", () => {
  for (const embedded of [false, true]) {
    const { loader, browser, panel, container, events } = fixture({ embedded });
    loader.show();
    loader.show();
    assert.equal(events.length, 1);
    assert.equal(events[0].container, container);
    assert.equal(events[0].content, panel);
    assert.equal(events[0].sourceWindow, browser.window);
    assert.equal(events[0].phase, "show");
    assert.equal(events[0].initial, true);
    assert.equal(events[0].active, true);
    loader.hide();
    loader.show();
    assert.equal(events.at(-1).initial, false);
    loader.setActive(false);
    loader.hide();
    assert.equal(events.at(-1).active, false);
    loader.destroy();
    assert.equal(events.at(-1).phase, "destroy");
  }
});

test("screens without a dynamics owner and cross-origin frames keep their normal immediate visibility", async () => {
  for (const options of [{ dynamics: false }, { embedded: true, crossOrigin: true }]) {
    const { loader, container, events } = fixture(options);
    loader.show();
    await loader.minimumVisible(0);
    loader.hide();
    assert.equal(container.hidden, true);
    assert.equal(events.length, 0);
    loader.destroy();
  }
});

test("a pending reward keeps the transition covered and delays minimum visibility completion", async () => {
  const { loader, shell, container } = fixture();
  const reward = deferred();
  shell.window.addEventListener("caatuu:challenge-transition", (event) => {
    if (["show", "hold"].includes(event.detail.phase)) event.detail.waitUntil(reward.promise);
  });
  loader.show();
  let ready = false;
  const waiting = loader.minimumVisible(0).then(() => { ready = true; });
  loader.hide();
  await settle();
  assert.equal(ready, false);
  assert.equal(container.hidden, false);
  reward.resolve();
  await waiting;
  await settle();
  assert.equal(ready, true);
  assert.equal(container.hidden, true);
  loader.destroy();
});

test("a reward queued after show can attach to the last hide boundary", async () => {
  const { loader, shell, container } = fixture();
  const reward = deferred();
  shell.window.addEventListener("caatuu:challenge-transition", (event) => {
    if (event.detail.phase === "hide") event.detail.waitUntil(reward.promise);
  });
  loader.show();
  loader.hide();
  assert.equal(container.hidden, false);
  reward.resolve();
  await settle();
  assert.equal(container.hidden, true);
  loader.destroy();
});

test("a new show cancels a deferred hide from the preceding transition", async () => {
  const { loader, shell, container, events } = fixture();
  const reward = deferred();
  shell.window.addEventListener("caatuu:challenge-transition", (event) => {
    if (event.detail.phase === "show") event.detail.waitUntil(reward.promise);
  });
  loader.show();
  loader.hide();
  loader.show();
  assert.equal(events.filter((event) => event.phase === "show").length, 2);
  reward.resolve();
  await settle();
  assert.equal(container.hidden, false);
  loader.hide();
  assert.equal(container.hidden, true);
  loader.destroy();
});

test("destroy releases local waits without waiting for or cancelling the global reward", async () => {
  const { loader, shell, container } = fixture();
  const reward = deferred();
  shell.window.addEventListener("caatuu:challenge-transition", (event) => {
    if (event.detail.phase === "hold") event.detail.waitUntil(reward.promise);
  });
  loader.show();
  const waiting = loader.minimumVisible(10000);
  loader.destroy();
  await waiting;
  loader.show();
  assert.equal(container.hidden, true);
  reward.resolve();
  await settle();
  assert.equal(container.hidden, true);
});

test("failed reward presentation releases the game and asynchronous waitUntil calls cannot acquire a gate", async () => {
  const { loader, shell, container, events } = fixture();
  const reward = deferred();
  shell.window.addEventListener("caatuu:challenge-transition", (event) => {
    if (event.detail.phase === "show") event.detail.waitUntil(reward.promise);
  });
  loader.show();
  loader.hide();
  reward.reject(new Error("Presentation unavailable"));
  await settle();
  assert.equal(container.hidden, true);
  const stale = deferred();
  events[0].waitUntil(stale.promise);
  loader.show();
  await loader.minimumVisible(0);
  loader.hide();
  assert.equal(container.hidden, true);
  stale.resolve();
  loader.destroy();
});
