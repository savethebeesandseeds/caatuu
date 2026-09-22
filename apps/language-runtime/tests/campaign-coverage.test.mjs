import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import policy from "../static/source/shell-policy.mjs";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const registry = JSON.parse(await read("apps/languages/catalog.json"));
const workspace = await read("apps/language-runtime/static/source/caatuu-workspace.js");
const app = await read("apps/language-runtime/static/app/index.html");
function between(start, end) {
  const from = workspace.indexOf(start);
  const to = workspace.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return workspace.slice(from, to);
}
const selection = between("function campaignAvailableTabs()", "function campaignFrame(gameId)");
const lifecycle = between("function resetCompletedVerbRoundForCampaign()", "function setTrainTab(tab)");

function campaign(course, random = () => 0.5) {
  const state = { trainTab: "galaxy", campaignQueue: [], campaignPendingTab: "",
    campaignActive: false, campaignTransitioning: false, campaignTransitionId: 0 };
  const visits = [], resets = [];
  const frames = new Map(policy.campaignGameIds(course).map((id) => [id, { contentWindow: {
    postMessage(message, origin) { resets.push({ id, message, origin }); }
  } }]));
  const window = { location: { origin: "https://local.test" }, CaatuuShellPolicy: policy,
    setTimeout: (callback) => setImmediate(callback), clearTimeout: clearImmediate,
    CaatuuWordWorldHost: { advanceCampaignRound: () => resets.push({ id: "word-net" }) },
    CaatuuNaturalizationNucleus: { advanceCampaignRound: () => resets.push({ id: "naturalization-nucleus" }) } };
  const context = vm.createContext({ state, course, window,
    document: { body: { dataset: {} } }, // Selection must not silently depend on DOM proxies.
    Math: { random, floor: Math.floor }, Promise, campaignTransitionMillis: 1600, wordWorldResultHoldMillis: 4000,
    campaignFrame: (id) => frames.get(id),
    verbRoundComplete: () => false,
    ensureCampaignGameLoaded() {}, showCampaignTransition() {}, hideCampaignTransition() {},
    waitForCampaignGameReady: async () => {}, waitForVerbTransition: async () => {},
    setTrainTab(id) { state.trainTab = id; visits.push(id); }
  });
  vm.runInContext(selection + lifecycle, context);
  return { state, context, visits, resets, window, frames,
    async complete() {
      const id = state.trainTab;
      if (id === "verb-lab") await context.completeCampaignRound(id, window);
      else {
        context.handleCampaignGameMessage({ origin: window.location.origin,
          source: ["word-net", "naturalization-nucleus"].includes(id) ? window : frames.get(id).contentWindow,
          data: { source: "caatuu-game", gameId: id,
            type: ["sound-quasar", "conjugation-comet"].includes(id) ? "round-complete" : "round-success" } });
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(state.campaignTransitioning, false);
    }
  };
}

for (const entry of registry.courses) {
  const course = JSON.parse(await read(entry.manifest));
  const browser = { window: {} };
  vm.runInNewContext(await read(entry.manifest.replace("course.json", "static/source/shared/course-profile.js")), browser);
  test(`${entry.id}: Campaign visits every playable menu game once before repeating`, async () => {
    const expected = policy.availableGameIds(course).filter((id) => id !== "campaign");
    assert.ok(expected.length);
    assert.deepEqual(policy.campaignGameIds(course), expected);
    assert.deepEqual(policy.campaignGameIds(browser.window.CaatuuCourse), expected);
    for (const id of expected) assert.ok(app.includes(`data-train-tab="${id}"`), `${id} needs a shell route`);
    // Exercise both shuffle extremes and the middle, including cycle boundaries.
    for (const random of [0, 0.5, 0.99999]) {
      const game = campaign(browser.window.CaatuuCourse, () => random);
      await game.context.startCampaign();
      for (let turn = 1; turn < expected.length * 4; turn += 1) await game.complete();
      for (let offset = 0; offset < game.visits.length; offset += expected.length) {
        assert.deepEqual(new Set(game.visits.slice(offset, offset + expected.length)), new Set(expected));
      }
      if (expected.length > 1) for (let index = 1; index < game.visits.length; index += 1) {
        assert.notEqual(game.visits[index], game.visits[index - 1]);
      }
      assert.deepEqual(new Set(game.resets.map(({ id }) => id)), new Set(expected.filter((id) => id !== "verb-lab")));
      for (const reset of game.resets.filter(({ message }) => message)) {
        assert.equal(reset.message.type, "campaign-advance");
        assert.equal(reset.origin, game.window.location.origin);
      }
    }
  });
  test(`${entry.id}: reopening Campaign preserves the unvisited games`, async () => {
    const game = campaign(course);
    const expected = policy.campaignGameIds(course);
    for (let index = 0; index < expected.length; index += 1) {
      await game.context.startCampaign();
      await game.context.startCampaign(); // Repeated activation cannot reshuffle or skip.
      game.context.stopCampaign();
    }
    assert.equal(game.visits.length, expected.length);
    assert.deepEqual(new Set(game.visits), new Set(expected));
  });
}

test("cancelling a transition returns its unvisited destination to the queue", async () => {
  const course = JSON.parse(await read(registry.courses[0].manifest));
  const game = campaign(course);
  await game.context.startCampaign();
  const originalQueue = [...game.state.campaignQueue];
  const waits = [];
  game.context.waitForVerbTransition = () => new Promise((resolve) => waits.push(resolve));
  const completed = game.context.completeCampaignRound(game.state.trainTab, game.window);
  assert.ok(game.state.campaignPendingTab);
  game.context.stopCampaign();
  assert.deepEqual([...game.state.campaignQueue], originalQueue);
  waits.forEach((resolve) => resolve());
  await completed;
  game.context.waitForVerbTransition = async () => {};
  await game.context.startCampaign();
  assert.equal(game.state.trainTab, originalQueue[0]);
});

test("a game that becomes unavailable cannot remain in the pending queue", () => {
  const course = { capabilities: { wordWorld: true, speech: true }, games: ["word-net", "sound-quasar"],
    routes: { wordWorld: "word.html", soundQuasar: "sound.html" } };
  const game = campaign(course);
  game.state.campaignQueue = ["sound-quasar", "word-net"];
  course.capabilities.speech = false;
  assert.equal(game.context.nextCampaignTab(), "word-net");
  course.capabilities.wordWorld = false;
  assert.equal(game.context.nextCampaignTab(), "");
});
