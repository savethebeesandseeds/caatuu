import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workspace = await readFile(
  new URL("../static/source/caatuu-workspace.js", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = workspace.indexOf(startMarker);
  const end = workspace.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return workspace.slice(start, end);
}

const campaignSelectionSource = sourceBetween(
  "function campaignAvailableTabs()",
  "function campaignFrame(gameId)"
);
const campaignCompletionSource = sourceBetween(
  "function resetCompletedVerbRoundForCampaign()",
  "async function startCampaign()"
);

function wordWorldCampaign() {
  const state = { campaignActive: true, campaignTransitioning: false,
    campaignTransitionId: 0, trainTab: "word-net", campaignQueue: [] };
  const calls = [];
  const waits = [];
  const window = { location: { origin: "https://local.test" },
    CaatuuWordWorldHost: { next: () => calls.push("next-sentence") } };
  const context = vm.createContext({
    state, window, Promise, campaignTransitionMillis: 1600,
    nextCampaignTab: () => "verb-lab",
    showCampaignTransition: () => calls.push("show-transition"),
    hideCampaignTransition: () => calls.push("hide-transition"),
    ensureCampaignGameLoaded: () => calls.push("load-next-game"),
    waitForCampaignGameReady: async () => {},
    setTrainTab: (id) => { state.trainTab = id; },
    waitForVerbTransition: (delay) => new Promise((resolve) => waits.push({ delay, resolve }))
  });
  vm.runInContext(workspace.match(/^const wordWorldResultHoldMillis = .+;$/mu)[0]
    + "\n" + campaignCompletionSource, context);
  return { state, calls, waits, complete: () => context.completeCampaignRound("word-net", window) };
}

test("Campaign leaves the Word World result visible for reading before loading the next round", async () => {
  const game = wordWorldCampaign();
  const completed = game.complete();
  assert.equal(game.waits.length, 1);
  assert.ok(game.waits[0].delay >= 4000, "the result needs at least four seconds of reading time");
  assert.deepEqual(game.calls, [], "neither the loader nor the next sentence may cover the result");
  await game.complete();
  assert.equal(game.waits.length, 1, "duplicate success events cannot start another transition");
  game.waits[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(game.calls, ["show-transition", "next-sentence", "load-next-game"]);
  game.waits[1].resolve();
  await completed;
  assert.equal(game.state.trainTab, "verb-lab");
  assert.equal(game.state.campaignTransitioning, false);
});

test("leaving Campaign while reading a Word World result cancels its delayed transition", async () => {
  const game = wordWorldCampaign();
  const completed = game.complete();
  game.state.campaignActive = false;
  game.state.campaignTransitionId += 1;
  game.waits[0].resolve();
  await completed;
  assert.deepEqual(game.calls, []);
  assert.equal(game.state.trainTab, "word-net");
});

for (const gameId of ["sound-quasar", "conjugation-comet"]) test(`${gameId} batch completion uses the campaign transition only for the verified game frame`, () => {
  const calls = [];
  const messages = [];
  const frameWindow = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const browserWindow = { location: { origin: "https://local.test" } };
  const context = vm.createContext({
    window: browserWindow,
    campaignFrame: (id) => id === gameId ? { contentWindow: frameWindow } : null,
    completeCampaignRound: (id, source) => calls.push({ id, source })
  });
  vm.runInContext(sourceBetween("function handleCampaignGameMessage(event)", "function setTrainTab(tab)")
    + sourceBetween("function advanceCompletedCampaignGame(gameId, sourceWindow)", "async function completeCampaignRound"), context);
  const data = { source: "caatuu-game", type: "round-complete", gameId };
  context.handleCampaignGameMessage({ origin: "https://other.test", source: frameWindow, data });
  context.handleCampaignGameMessage({ origin: "https://local.test", source: {}, data });
  context.handleCampaignGameMessage({ origin: "https://local.test", source: frameWindow, data: { ...data, gameId: "word-net" } });
  assert.equal(calls.length, 0);
  context.handleCampaignGameMessage({ origin: "https://local.test", source: frameWindow, data });
  assert.deepEqual(calls, [{ id: gameId, source: frameWindow }]);
  context.advanceCompletedCampaignGame(gameId, frameWindow);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.type, "campaign-advance");
  assert.equal(messages[0].origin, "https://local.test");
});

test("a one-game Campaign consumes each completed Verb round before the next cycle", async () => {
  const firstPair = Object.freeze({ id: "verb-a" });
  const queuedPairs = [
    Object.freeze({ id: "verb-b" }),
    Object.freeze({ id: "verb-c" })
  ];
  const state = {
    campaignActive: true,
    campaignQueue: [],
    campaignTransitionId: 0,
    campaignTransitioning: false,
    trainTab: "verb-lab",
    verbEnglishRound: [firstPair],
    verbHintById: new Map([[firstPair.id, { status: "ready" }]]),
    verbHintRequestId: 0,
    verbMatchedIds: new Set([firstPair.id]),
    verbRoundRewardXp: 1,
    verbRound: [firstPair],
    verbQueueIds: queuedPairs.map(({ id }) => id),
    verbStats: Object.freeze({ attempts: 1, matches: 1, rounds: 1 })
  };
  const pairById = new Map([firstPair, ...queuedPairs].map((pair) => [pair.id, pair]));
  const dealtRoundIds = [];
  const savedSnapshots = [];
  let clearedSolutionAdvances = 0;
  let resetSelections = 0;

  const browserWindow = { location: { origin: "https://local.test" },
    CaatuuShellPolicy: { campaignGameIds: () => ["verb-lab"] } };
  browserWindow.window = browserWindow;
  const context = vm.createContext({
    course: {},
    campaignTransitionMillis: 0,
    clearVerbSolutionAdvance() {
      clearedSolutionAdvances += 1;
    },
    courseGameAvailable(gameId) {
      return gameId === "verb-lab";
    },
    document: {
      querySelector(selector) {
        return selector === '[data-train-tab="verb-lab"]' ? {} : null;
      }
    },
    ensureCampaignGameLoaded() {},
    hideCampaignTransition() {},
    Math,
    Promise,
    resetVerbSelections() {
      resetSelections += 1;
    },
    saveVerbMemory() {
      savedSnapshots.push({
        roundIds: state.verbRound.map(({ id }) => id),
        queueIds: [...state.verbQueueIds]
      });
    },
    setTrainTab(gameId) {
      state.trainTab = gameId;
      if (gameId !== "verb-lab" || state.verbRound.length) return;
      const nextId = state.verbQueueIds.shift();
      const nextPair = pairById.get(nextId);
      state.verbRound = [nextPair];
      state.verbEnglishRound = [nextPair];
      state.verbMatchedIds = new Set();
      state.verbHintById.set(nextId, { status: "ready" });
      dealtRoundIds.push(nextId);
    },
    showCampaignTransition() {},
    state,
    verbRoundComplete() {
      return state.verbRound.length > 0
        && state.verbRound.every(({ id }) => state.verbMatchedIds.has(id));
    },
    waitForCampaignGameReady() {
      return Promise.resolve();
    },
    waitForVerbTransition() {
      return Promise.resolve();
    },
    window: browserWindow
  });

  vm.runInContext(
    `${campaignSelectionSource}\n${campaignCompletionSource}\n`
      + "globalThis.completeCampaignRound = completeCampaignRound;",
    context,
    { filename: "campaign-verb-reset.js" }
  );

  for (const expectedRoundId of ["verb-b", "verb-c"]) {
    await context.completeCampaignRound("verb-lab", browserWindow);
    assert.equal(state.campaignTransitioning, false);
    assert.equal(state.trainTab, "verb-lab");
    assert.equal(state.verbRound[0]?.id, expectedRoundId);
    assert.equal(state.verbEnglishRound[0]?.id, expectedRoundId);
    assert.equal(state.verbMatchedIds.size, 0);
    assert.deepEqual(dealtRoundIds, ["verb-b", "verb-c"].slice(0, dealtRoundIds.length));
    state.verbMatchedIds.add(expectedRoundId);
  }

  assert.equal(clearedSolutionAdvances, 2);
  assert.equal(resetSelections, 2);
  assert.equal(state.verbHintRequestId, 2);
  assert.equal(state.verbRoundRewardXp, 1, "Campaign reset must retain the earned-round presentation");
  assert.deepEqual(state.verbStats, { attempts: 1, matches: 1, rounds: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(savedSnapshots)), [
    { roundIds: [], queueIds: ["verb-b", "verb-c"] },
    { roundIds: [], queueIds: ["verb-c"] }
  ]);
});
