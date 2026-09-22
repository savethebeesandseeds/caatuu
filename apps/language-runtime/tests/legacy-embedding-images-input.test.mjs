import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const source = await readFile(new URL("../../languages/czech/static/source/features/embedding-images/embedding-images.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function mount() {
  const harness = createBrowserHarness();
  const nodes = {};
  for (const [name, tag] of [["Form", "form"], ["Text", "textarea"], ["Run", "button"], ["Random", "button"], ["Status", "p"], ["Results", "div"]]) {
    const node = harness.document.createElement(tag);
    node.id = `embeddingDebug${name}`;
    nodes[name] = node;
    harness.document.body.append(node);
  }
  nodes.Text.value = "a book";
  const requests = [];
  harness.window.CaatuuRuntime = { vector: { search(text, options) {
    return new Promise((resolve, reject) => requests.push({ text, options, resolve, reject }));
  } } };
  harness.context.isChildFacingMacawActionAssetAllowed = () => true;
  vm.runInContext(source.replace(/^import[^\n]+\n/u, ""), harness.context);
  return { ...harness, nodes, requests,
    shortcut: (options = {}) => nodes.Text.dispatchEvent({ type: "keydown", key: "Enter", ctrlKey: true, ...options }) };
}

test("legacy image-search handlers share one operation and leave composition/held/consumed keys alone", async () => {
  const app = mount();
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }, { altKey: true }]) app.shortcut(options);
  assert.equal(app.requests.length, 0);
  app.shortcut();
  assert.equal(app.requests.length, 2, "one request per image source");
  app.shortcut();
  app.nodes.Form.dispatchEvent({ type: "submit" });
  app.nodes.Random.click();
  assert.equal(app.requests.length, 2);
  assert.equal(app.nodes.Text.value, "a book", "a disabled random action cannot replace the submitted prompt");
  assert.equal(app.nodes.Run.disabled, true);
  app.requests.forEach((request) => request.resolve({ results: [] }));
  await settle();
  assert.equal(app.nodes.Run.disabled, false);
  app.shortcut();
  assert.equal(app.requests.length, 4, "a new deliberate action is accepted after completion");
  app.requests.slice(2).forEach((request) => request.reject(new Error("failed")));
  await settle();
  assert.equal(app.nodes.Run.disabled, false, "errors permit retry");
});

test("late search results after hiding or page retirement cannot overwrite or unlock a replacement", async () => {
  for (const kind of ["visibility", "pagehide"]) {
    const app = mount();
    app.shortcut();
    const old = [...app.requests];
    if (kind === "visibility") {
      app.document.visibilityState = "hidden";
      app.document.dispatchEvent({ type: "visibilitychange" });
      app.document.visibilityState = "visible";
    } else {
      app.window.dispatchEvent({ type: "pagehide", persisted: true });
      app.shortcut();
      assert.equal(app.requests.length, 2);
      app.window.dispatchEvent({ type: "pageshow", persisted: true });
    }
    app.nodes.Text.value = "a house";
    app.shortcut();
    assert.equal(app.requests.length, 4);
    const status = app.nodes.Status.textContent;
    old.forEach((request) => request.resolve({ results: [] }));
    await settle();
    assert.equal(app.nodes.Status.textContent, status);
    assert.equal(app.nodes.Run.disabled, true);
    app.requests.slice(2).forEach((request) => request.resolve({ results: [] }));
    await settle();
    assert.equal(app.nodes.Run.disabled, false);
  }
});
