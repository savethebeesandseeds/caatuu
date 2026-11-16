import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { reportEmbeddedGameStatus } from "../static/source/games/course-game-content.mjs";

const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const loader = workspace.slice(workspace.indexOf("function setEmbeddedGameStartup("), workspace.indexOf("function campaignAvailableTabs("));
function harness() {
  const app = createBrowserHarness();
  const frame = app.document.createElement("iframe");
  frame.id = "game";
  frame.dataset.src = "/conjugation-comet.html";
  frame.contentWindow = {};
  frame.contentDocument = { documentElement: { dataset: {} } };
  const stage = app.document.createElement("section");
  stage.id = "stage";
  const status = app.document.createElement("div");
  status.id = "status";
  status.append(app.document.createElement("strong"), app.document.createElement("small"));
  app.document.body.append(frame, stage, status);
  let assignments = 0, prepareFails = false;
  Object.defineProperty(frame, "src", { set() { assignments++; } });
  const timers = new Map();
  let serial = 0;
  app.window.setTimeout = (fn) => { timers.set(++serial, fn); return serial; };
  app.window.clearTimeout = (id) => timers.delete(id);
  Object.assign(app.context, {
    embeddedGameTabs: { "conjugation-comet": { frameId: "game", stageId: "stage", statusId: "status" } },
    state: { trainTab: "conjugation-comet" },
    setShellRobotLoading: (node, loading) => { node.hidden = !loading; },
    prepareEmbeddedGameDocument: () => { if (prepareFails) throw new Error("blocked document"); },
    sharedGameTitle: () => "Conjugation Comet",
    interfaceText: (key) => key,
    syncEmbeddedGameVisibility() {},
    console: { error() {} }
  });
  vm.runInContext(loader, app.context);
  const start = () => vm.runInContext('ensureEmbeddedGameLoaded("conjugation-comet")', app.context);
  function notify(startup, options = {}) {
    frame.contentDocument.documentElement.dataset = { caatuuGameId: "conjugation-comet", caatuuGameStatus: startup };
    app.context.message = { origin: app.window.location.origin, source: frame.contentWindow,
      data: { source: "caatuu-game", type: "startup", gameId: "conjugation-comet", status: startup }, ...options };
    vm.runInContext("handleEmbeddedGameStartup(message)", app.context);
  }
  return { ...app, frame, stage, status, start, notify, timers, assignments: () => assignments,
    failPreparation() { prepareFails = true; } };
}

test("failed asynchronous initialization can be retried by leaving and reentering the game", () => {
  const app = harness();
  app.start();
  app.frame.dispatchEvent({ type: "load" });
  assert.equal(app.frame.dataset.ready, "false", "document load does not complete async startup");
  assert.equal(app.frame.dataset.loading, "true");
  app.notify("error");
  assert.equal(app.frame.dataset.loading, "false");
  assert.equal(app.frame.dataset.ready, "false");
  assert.equal(app.status.hidden, false);
  app.start();
  assert.equal(app.assignments(), 2);
  app.frame.contentDocument.documentElement.dataset = {};
  app.frame.dispatchEvent({ type: "load" });
  app.notify("ready");
  assert.equal(app.frame.dataset.ready, "true");
  assert.equal(app.stage.getAttribute("aria-busy"), "false");
  assert.equal(app.frame.hasAttribute("aria-hidden"), false);
  app.start();
  assert.equal(app.assignments(), 2, "a successful game is retained");
  assert.equal(app.timers.size, 0);
});

test("startup ignores foreign windows, origins, games and retired document messages", () => {
  const app = harness();
  app.start();
  app.frame.dispatchEvent({ type: "load" });
  app.notify("ready", { origin: "https://foreign.test" });
  app.notify("ready", { source: {} });
  app.notify("ready", { data: { source: "caatuu-game", type: "startup", gameId: "memory-moon", status: "ready" } });
  assert.equal(app.frame.dataset.ready, "false");
  app.frame.contentDocument.documentElement.dataset = {};
  app.context.message = { origin: app.window.location.origin, source: app.frame.contentWindow,
    data: { source: "caatuu-game", type: "startup", gameId: "conjugation-comet", status: "ready" } };
  vm.runInContext("handleEmbeddedGameStartup(message)", app.context);
  assert.equal(app.frame.dataset.ready, "false");
  app.notify("ready");
  assert.equal(app.frame.dataset.ready, "true");
});

test("pre-load completion, preparation exceptions and startup timeouts settle loader state", () => {
  const early = harness();
  early.start();
  early.notify("ready");
  assert.equal(early.frame.dataset.ready, "false");
  early.frame.dispatchEvent({ type: "load" });
  assert.equal(early.frame.dataset.ready, "true");
  for (const reason of ["prepare", "timeout"]) {
    const app = harness();
    app.start();
    if (reason === "prepare") { app.failPreparation(); app.frame.dispatchEvent({ type: "load" }); }
    else [...app.timers.values()][0]();
    assert.equal(app.frame.dataset.loading, "false");
    assert.equal(app.frame.dataset.failed, "true");
    app.start();
    assert.equal(app.assignments(), 2);
  }
});

test("the child reports readiness to its same-origin parent and records early status", () => {
  const sent = [];
  const scope = { document: { documentElement: { dataset: {} } }, location: { origin: "https://caatuu.test" },
    parent: { location: { origin: "https://caatuu.test" }, postMessage: (...args) => sent.push(args) } };
  reportEmbeddedGameStatus(scope, "conjugation-comet", "ready");
  assert.equal(scope.document.documentElement.dataset.caatuuGameStatus, "ready");
  assert.equal(sent[0][0].status, "ready");
  assert.equal(sent[0][1], scope.location.origin);
  reportEmbeddedGameStatus(scope, "conjugation-comet", "error");
  assert.equal(scope.document.documentElement.dataset.caatuuGameStatus, "ready", "later practice failures keep their own recovery UI");
  assert.equal(sent.length, 1);
  scope.document.documentElement.dataset = {};
  scope.parent.location.origin = "https://other.test";
  reportEmbeddedGameStatus(scope, "conjugation-comet", "error");
  assert.equal(sent.length, 1);
});