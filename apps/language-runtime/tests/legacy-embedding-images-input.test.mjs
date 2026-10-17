import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { IMAGE_SOURCES } from "../static/source/english-image-search.mjs";
import { isChildFacingMacawActionAssetAllowed } from "../static/source/child-facing-assets.mjs";

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
  delete harness.window.CaatuuRuntime;
  harness.context.createEnglishImageSearch = () => (text, options) => {
    return new Promise((resolve, reject) => requests.push({ text, options, resolve, reject }));
  };
  harness.context.IMAGE_SOURCES = IMAGE_SOURCES;
  harness.context.isChildFacingMacawActionAssetAllowed = isChildFacingMacawActionAssetAllowed;
  vm.runInContext(source.replace(/^import[^\n]+\n/gmu, ""), harness.context);
  return { ...harness, nodes, requests,
    shortcut: (options = {}) => nodes.Text.dispatchEvent({ type: "keydown", key: "Enter", ctrlKey: true, ...options }) };
}

test("legacy image-search handlers share one operation and leave composition/held/consumed keys alone", async () => {
  const app = mount();
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }, { altKey: true }]) app.shortcut(options);
  assert.equal(app.requests.length, 0);
  app.shortcut();
  assert.equal(app.requests.length, 1, "one shared search covers every image source");
  app.shortcut();
  app.nodes.Form.dispatchEvent({ type: "submit" });
  app.nodes.Random.click();
  assert.equal(app.requests.length, 1);
  assert.equal(app.nodes.Text.value, "a book", "a disabled random action cannot replace the submitted prompt");
  assert.equal(app.nodes.Run.disabled, true);
  app.requests.forEach((request) => request.resolve({ rows: [] }));
  await settle();
  assert.equal(app.nodes.Run.disabled, false);
  app.shortcut();
  assert.equal(app.requests.length, 2, "a new deliberate action is accepted after completion");
  app.requests.slice(1).forEach((request) => request.reject(new Error("failed")));
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
      assert.equal(app.requests.length, 1);
      app.window.dispatchEvent({ type: "pageshow", persisted: true });
    }
    app.nodes.Text.value = "a house";
    app.shortcut();
    assert.equal(app.requests.length, 2);
    const status = app.nodes.Status.textContent;
    old.forEach((request) => request.resolve({ rows: [] }));
    await settle();
    assert.equal(app.nodes.Status.textContent, status);
    assert.equal(app.nodes.Run.disabled, true);
    app.requests.slice(1).forEach((request) => request.resolve({ rows: [] }));
    await settle();
    assert.equal(app.nodes.Run.disabled, false);
  }
});

test("legacy image search displays shared artwork without a Czech vector runtime", async () => {
  const app = mount();
  assert.equal(app.window.CaatuuRuntime, undefined);
  app.shortcut();
  app.requests[0].resolve({ mode: "embedding", rows: [
    { sourceKind: "image_asset", path: "/assets/miscellaneous/book.png", description: "A book.", score: .8 },
    { sourceKind: "macaw_action_asset", path: "/assets/macaw/actions/wave.png", description: "A macaw waves.", action: "wave", score: .7 },
    { sourceKind: "robot_asset", path: "/assets/robots/robot.png", description: "A robot.", score: .6 },
    { sourceKind: "ship_asset", path: "/assets/ships/ship.png", description: "A spaceship.", score: .5 },
    { sourceKind: "macaw_action_asset", path: "/assets/macaw/actions/sword.png", description: "A macaw holds a sword.", action: "draw_sword", score: .9 }
  ] });
  await settle();
  assert.equal(app.nodes.Status.textContent, "4 image matches.");
  assert.deepEqual(app.nodes.Results.children.map((group) => group.children[0].textContent),
    ["Miscellaneous", "Macaw actions", "Robots", "Spaceships"]);
  const images = app.nodes.Results.querySelectorAll("img");
  assert.equal(images.length, 4);
  assert.equal(images.some((image) => image.src.includes("sword")), false);
});

test("legacy image search identifies the shared service's keyword fallback", async () => {
  const app = mount();
  app.shortcut();
  app.requests[0].resolve({ mode: "lexical", rows: [] });
  await settle();
  assert.equal(app.nodes.Status.textContent, "0 keyword matches.");
});

test("legacy verb clues use shared Macaw vectors and keep their existing safe action pool", async () => {
  const comet = await readFile(new URL("../../languages/czech/static/source/games/conjugation-comet/conjugation-comet.js", import.meta.url), "utf8");
  const pathStart = comet.indexOf("function normalizeMacawPath(");
  const pathEnd = comet.indexOf("async function loadMacawKeymap(", pathStart);
  const lookupStart = comet.indexOf("async function vectorMacawCandidates(");
  const lookupEnd = comet.indexOf("function macawActionMatches(", lookupStart);
  assert.ok(pathStart >= 0 && pathEnd > pathStart && lookupStart >= 0 && lookupEnd > lookupStart);
  const calls = [];
  const context = { isChildFacingMacawActionAssetAllowed,
    searchMacawImages: async (...args) => {
      calls.push(args);
      return { mode: "embedding", rows: [
        { sourceKind: "macaw_action_asset", path: "/assets/macaw/actions/wave.png", action: "wave", description: "A macaw waves.", score: .8 },
        { sourceKind: "macaw_action_asset", path: "/assets/macaw/actions/sword.png", action: "draw_sword", description: "Sword.", score: .9 },
        { sourceKind: "ship_asset", path: "/assets/ships/ship.png", description: "A ship.", score: .7 }
      ] };
    } };
  vm.createContext(context);
  vm.runInContext(comet.slice(pathStart, pathEnd) + comet.slice(lookupStart, lookupEnd), context);
  const rows = await vm.runInContext('vectorMacawCandidates("wave")', context);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assetPath, "/assets/macaw/actions/wave.png");
  assert.equal(rows[0].alt, "A macaw waves.");
  assert.equal(rows[0].score, 100.8);
  assert.equal(calls[0][0], "wave");
  assert.equal(calls[0][1].sourceKind, "macaw_action_asset");
  context.searchMacawImages = async () => ({ mode: "lexical", rows });
  assert.equal((await vm.runInContext('vectorMacawCandidates("wave")', context)).length, 0,
    "the game's existing keyword fallback must not be promoted to a semantic match");
});
