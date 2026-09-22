import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workspace = await readFile(
  new URL("../static/source/caatuu-workspace.js", import.meta.url),
  "utf8"
);
const wordWorld = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");

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

function wordWorldCampaign({ nextGameId = "verb-lab" } = {}) {
  const state = { campaignActive: true, campaignTransitioning: false,
    campaignTransitionId: 0, trainTab: "word-net", campaignQueue: [] };
  const calls = [];
  const waits = [];
  const timers = new Set();
  const window = { location: { origin: "https://local.test" },
    setTimeout(callback, delay) {
      const timer = { delay, resolve: callback };
      waits.push(timer);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    CaatuuWordWorldHost: { advanceCampaignRound: () => calls.push("next-sentence") } };
  const context = vm.createContext({
    state, window, Promise, campaignTransitionMillis: 1600,
    nextCampaignTab: () => nextGameId,
    document: { body: { dataset: {} } },
    showCampaignTransition: () => calls.push("show-transition"),
    hideCampaignTransition: () => calls.push("hide-transition"),
    ensureCampaignGameLoaded: () => calls.push("load-next-game"),
    waitForCampaignGameReady: async () => {},
    setTrainTab: (id) => { state.trainTab = id; },
    waitForVerbTransition: (delay) => new Promise((resolve) => waits.push({ delay, resolve }))
  });
  vm.runInContext(workspace.match(/^const wordWorldResultHoldMillis = .+;$/mu)[0]
    + "\n" + campaignCompletionSource
    + sourceBetween("function stopCampaign()", "function handleCampaignGameMessage"), context);
  window.CaatuuWorkspaceShell = {
    completeWordWorldRound: () => context.completeWordWorldCampaignRound(),
    continueWordWorld: () => context.continueWordWorldCampaign()
  };
  return { state, calls, waits, timers, window, context,
    complete: () => context.completeCampaignRound("word-net", window) };
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
  game.context.stopCampaign();
  assert.equal(game.timers.size, 0);
  game.waits[0].resolve();
  await completed;
  assert.deepEqual(game.calls, ["hide-transition"]);
  assert.equal(game.state.trainTab, "word-net");
});

test("a cancelled result timer cannot release a later campaign round", async () => {
  const game = wordWorldCampaign();
  const oldCompletion = game.complete();
  const oldTimer = game.waits[0];
  game.context.stopCampaign();
  game.state.campaignActive = true;
  const newCompletion = game.complete();
  oldTimer.resolve();
  await oldCompletion;
  assert.equal(game.timers.size, 1);
  assert.deepEqual(game.calls, ["hide-transition"]);
  game.context.continueWordWorldCampaign();
  await new Promise((resolve) => setImmediate(resolve));
  game.waits.at(-1).resolve();
  await newCompletion;
  assert.equal(game.calls.filter((call) => call === "next-sentence").length, 1);
});

function attachWordWorld(game) {
  const state = { guidedRequested: false, busy: false, reconstruction: { submitted: true, correct: true } };
  let generated = 0;
  const context = vm.createContext({
    state, window: game.window, lifecycleOptions: {}, course: { id: "test" },
    shouldBlockReconstructionAdvance: () => !state.reconstruction.submitted,
    completeWordWorldExposure() {},
    generateFromConfiguredMode() { generated++; state.busy = true; }
  });
  vm.runInContext(wordWorld.slice(wordWorld.indexOf("async function activateNextSentence("),
    wordWorld.indexOf("function beginWordWorldEncounter()"))
    + wordWorld.slice(wordWorld.indexOf("function announceCampaignRoundSuccess()"),
      wordWorld.indexOf("function suspendStarterWordPresentation()")), context);
  game.window.CaatuuWordWorldHost.advanceCampaignRound = () => context.activateNextSentence({ campaignAdvance: true });
  return { state, generated: () => generated, next: () => context.activateNextSentence(),
    success: () => context.announceCampaignRoundSuccess() };
}

for (const nextGameId of ["verb-lab", "word-net"]) {
  for (const first of ["click", "timer"]) test(`${first} and repeated Next clicks consume one campaign round before ${nextGameId}`, async () => {
    const game = wordWorldCampaign({ nextGameId });
    const round = attachWordWorld(game);
    round.success();
    assert.equal(game.state.campaignTransitioning, true, "success claims the transition synchronously");
    const oldTimer = game.waits[0];
    if (first === "click") await round.next();
    else oldTimer.resolve();
    await round.next();
    oldTimer.resolve(); // A timer callback already queued before cancellation is harmless.
    await new Promise((resolve) => setImmediate(resolve));
    await round.next();
    assert.equal(round.generated(), 1);
    assert.equal(game.timers.size, 0);
    assert.equal(game.waits.length, 2, "only one result hold and one game transition");
    game.waits[1].resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(game.state.trainTab, nextGameId);
    assert.equal(game.state.campaignTransitioning, false);
    assert.equal(round.generated(), 1);
  });
}

test("ordinary Word World and an incorrect campaign answer continue within the game", async () => {
  for (const campaignActive of [false, true]) {
    const game = wordWorldCampaign();
    const round = attachWordWorld(game);
    game.state.campaignActive = campaignActive;
    round.state.reconstruction.correct = false;
    await round.next();
    assert.equal(round.generated(), 1);
    assert.equal(game.state.trainTab, "word-net");
    assert.equal(game.state.campaignTransitioning, false);
    assert.equal(game.waits.length, 0);
  }
});

test("Next cannot skip an unsubmitted reconstruction", async () => {
  const game = wordWorldCampaign();
  const round = attachWordWorld(game);
  round.state.reconstruction.submitted = false;
  await round.next();
  assert.equal(round.generated(), 0);
  assert.equal(game.state.campaignTransitioning, false);
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
