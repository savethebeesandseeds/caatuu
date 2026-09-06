import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";

const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const start = workspace.indexOf("const shellRobotScreens = new Map();");
const end = workspace.indexOf("function interfaceLanguageName(", start);
assert.ok(start >= 0 && end > start, "the shell exposes its maintained robot-loading helper section");
const helpers = workspace.slice(start, end).replace(
  /import\("\/language-runtime\/static\/source\/games\/embedded-game-controls\.mjs\?v=[^"]+"\)/u,
  "loadSharedRobotModule()"
);
assert.ok(helpers.includes("loadSharedRobotModule()"), "only the actual dynamic import is replaced by the fixture");

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function fixture() {
  const browser = createBrowserHarness();
  const { document, window } = browser;
  document.visibilityState = "visible";
  const state = { activeView: "verbs", trainTab: "verb-lab", campaignActive: true };
  const mounts = [];
  const errors = [];
  const messages = [];
  let imports = 0;
  let releaseImport;
  const modulePromise = new Promise((resolve) => { releaseImport = resolve; });
  Object.assign(browser.context, {
    state,
    interfaceText(key) {
      messages.push(key);
      assert.equal(key, "verbnebula.round.preparing");
      return "Preparing the next round";
    },
    loadSharedRobotModule() { imports += 1; return modulePromise; },
    console: { error: (...args) => errors.push(args) }
  });
  vm.runInContext(helpers, browser.context, { filename: "caatuu-workspace-shell-robot-helpers.js" });
  const api = vm.runInContext("({ set: setShellRobotLoading, sync: syncShellRobotLoading })", browser.context);

  function loader({ id = "verbRoundInterstitial", gameId = "verb-lab", reward = false } = {}) {
    const panel = document.createElement("section");
    panel.setAttribute("data-train-panel", gameId);
    document.body.append(panel);
    const container = document.createElement("div");
    container.id = id;
    container.hidden = true;
    container.className = "caatuu-game-robot-loading";
    panel.append(container);
    let gem;
    if (reward) {
      const badge = document.createElement("div");
      badge.className = "verb-round-reward";
      gem = document.createElement("img");
      gem.src = "/assets/icons/icon_gem.png";
      badge.append(gem);
      container.append(badge);
    }
    const image = document.createElement("img");
    image.className = "caatuu-game-robot-loading-art";
    image.src = "/assets/robots/robot%20(1).png";
    image.setAttribute("alt", "");
    image.setAttribute("aria-hidden", "true");
    container.append(image);
    return { panel, container, image, gem };
  }
  async function resolveImport() {
    releaseImport({ mountRobotLoadingScreen(options) {
      const controller = mountRobotLoadingScreen(options);
      mounts.push({ container: options.container, controller });
      return controller;
    } });
    await settle();
    assert.deepEqual(errors, [], "shared component initialization succeeds");
  }
  function visibility(hidden) {
    document.visibilityState = hidden ? "hidden" : "visible";
    document.dispatchEvent({ type: "visibilitychange" });
  }
  function pagehide(persisted) { window.dispatchEvent({ type: "pagehide", persisted }); }
  function pageshow() { window.dispatchEvent({ type: "pageshow", persisted: true }); }
  return { ...browser, state, mounts, errors, messages, loader, resolveImport, visibility, pagehide, pageshow,
    set: api.set, sync: api.sync, imports: () => imports };
}

test("absent or unused hidden shell screens do not load a component or request loading copy", () => {
  const game = fixture();
  game.set(null, true);
  const { container } = game.loader();
  game.set(container, false);
  assert.equal(container.hidden, true);
  assert.equal(game.imports(), 0);
  assert.deepEqual(game.messages, []);
});

test("delayed shared imports preserve the latest visibility and labels across multiple screens", async () => {
  const game = fixture();
  const first = game.loader();
  const second = game.loader({ id: "soundQuasarEmbeddedStatus", gameId: "sound-quasar" });
  game.set(first.container, true, "First loading label");
  game.set(second.container, true, "Sound loading");
  game.set(first.container, false, "First hidden label");
  game.set(second.container, true, "Latest sound loading");
  assert.equal(game.imports(), 1);
  assert.equal(first.container.hidden, true);
  assert.equal(second.container.hidden, false);
  assert.equal(second.container.dataset.active, "false", "inactive fallback pauses before its module arrives");
  await game.resolveImport();
  assert.equal(game.mounts.length, 2);
  assert.equal(first.container.hidden, true, "late mounting must not reshow a completed load");
  assert.equal(first.container.getAttribute("aria-label"), "First hidden label");
  assert.equal(second.container.hidden, false);
  assert.equal(second.container.getAttribute("aria-label"), "Latest sound loading");
  assert.equal(second.container.dataset.active, "false");
  assert.equal(first.container.querySelectorAll("img").length, 1);
  assert.equal(second.container.querySelectorAll("img").length, 1);
  game.pagehide(false);
});

test("static loading fallbacks follow document, game, and campaign activity before the import resolves", async () => {
  const game = fixture();
  const regular = game.loader();
  const campaign = game.loader({ id: "campaignTransition", gameId: "campaign" });
  game.set(regular.container, true);
  game.set(campaign.container, true);
  assert.equal(regular.container.dataset.active, "true");
  assert.equal(campaign.container.dataset.active, "true");
  game.visibility(true);
  assert.equal(regular.container.dataset.active, "false");
  assert.equal(campaign.container.dataset.active, "false");
  game.visibility(false);
  game.state.trainTab = "sound-quasar";
  game.sync();
  assert.equal(regular.container.dataset.active, "false");
  assert.equal(campaign.container.dataset.active, "true");
  game.state.campaignActive = false;
  game.sync();
  assert.equal(campaign.container.dataset.active, "false");
  game.state.trainTab = "verb-lab";
  regular.container.classList.add("is-error");
  game.sync();
  assert.equal(regular.container.dataset.active, "false");
  regular.container.classList.remove("is-error");
  game.state.activeView = "home";
  game.sync();
  assert.equal(regular.container.dataset.active, "false");
  await game.resolveImport();
  assert.equal(regular.container.dataset.active, "false");
  assert.equal(campaign.container.dataset.active, "false");
  game.state.activeView = "verbs";
  game.sync();
  assert.equal(regular.container.dataset.active, "true");
  game.pagehide(false);
});

test("mounted loading screens retain their identity and labels across hide, theme changes, and reuse", async () => {
  const game = fixture();
  const { container, image } = game.loader();
  game.set(container, true, "A visible round");
  await game.resolveImport();
  game.set(container, false);
  assert.equal(container.hidden, true);
  game.document.documentElement.dataset.theme = "dark";
  game.document.documentElement.dataset.fontSize = "large";
  game.set(container, true, "Another round");
  assert.equal(container.hidden, false);
  assert.equal(container.getAttribute("aria-label"), "Another round");
  assert.equal(container.dataset.active, "true");
  assert.equal(container.querySelector("img"), image);
  assert.equal(game.mounts.length, 1);
  assert.equal(game.imports(), 1);
  game.pagehide(false);
});

test("back-forward caching pauses pending and mounted robot screens without losing current visibility", async () => {
  const game = fixture();
  const { container } = game.loader();
  game.set(container, true, "Preparing cached game");
  game.pagehide(true);
  assert.equal(container.dataset.active, "false");
  await game.resolveImport();
  assert.equal(container.hidden, false);
  assert.equal(container.dataset.active, "false");
  game.pageshow();
  assert.equal(container.dataset.active, "true");
  game.pagehide(true);
  assert.equal(container.dataset.active, "false");
  game.set(container, false, "Already prepared");
  game.pageshow();
  assert.equal(container.hidden, true, "restoring the page cannot reshow a completed load");
  assert.equal(game.mounts.length, 1);
  game.pagehide(false);
});

test("retired shell screens cannot reappear after pending imports or late visibility requests", async () => {
  for (const mounted of [false, true]) {
    const game = fixture();
    const { container } = game.loader();
    game.set(container, true, "Pending game");
    if (mounted) await game.resolveImport();
    game.pagehide(false);
    assert.equal(container.hidden, true);
    assert.equal(container.dataset.active, "false");
    game.set(container, true, "Late callback");
    game.pageshow();
    await game.resolveImport();
    assert.equal(container.hidden, true);
    assert.equal(game.mounts.length, mounted ? 1 : 0);
    assert.equal(game.imports(), 1);
    for (const { controller } of game.mounts) controller.show();
    assert.equal(container.hidden, true, "the retired real shared controller stays destroyed");
  }
});

test("a disconnected loading container is not mounted after the lazy module arrives", async () => {
  const game = fixture();
  const { panel, container } = game.loader();
  game.set(container, true);
  panel.removeChild(container);
  assert.equal(container.isConnected, false);
  await game.resolveImport();
  assert.equal(game.mounts.length, 0);
  game.pagehide(false);
});

test("the real shared loader preserves Verb Nebula reward artwork beside its explicit robot", async () => {
  const game = fixture();
  const { container, image, gem } = game.loader({ reward: true });
  game.set(container, true, "Round cleared. Preparing the next round.");
  await game.resolveImport();
  assert.equal(gem.getAttribute("src"), "/assets/icons/icon_gem.png");
  assert.equal(gem.classList.contains("caatuu-game-robot-loading-art"), false);
  assert.equal(container.querySelector(".caatuu-game-robot-loading-art"), image);
  assert.equal(container.querySelectorAll(".caatuu-game-robot-loading-art").length, 1);
  assert.equal(container.querySelectorAll("img").length, 2);
  assert.equal(container.getAttribute("aria-label"), "Round cleared. Preparing the next round.");
  game.pagehide(false);
});
