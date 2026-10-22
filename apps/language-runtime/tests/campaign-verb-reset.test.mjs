import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workspace = await readFile(
  new URL("../static/source/caatuu-workspace.js", import.meta.url),
  "utf8"
);
const wordWorld = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");

function initialCampaign(gameId) {
  const state = { activeView: "verbs", trainTab: "galaxy", campaignActive: false,
    campaignTransitionId: 0, campaignQueue: [], campaignPendingTab: "" };
  const activity = [], readiness = [], presentations = [];
  let covered = false;
  const context = vm.createContext({ state, activity,
    document: { body: { dataset: {}, classList: { toggle() {} }, toggleAttribute() {} } },
    window: { CaatuuGameDynamics: { active: false, setActive() {} } },
    embeddedGameTabs: Object.fromEntries(["grammar-gravity", "sound-quasar", "conjugation-comet", "memory-moon", "case-cosmos"].map(id => [id, {}])),
    verbReviewContinuation: null, cancelVerbTapSpeech() {}, syncShellRobotLoading() {},
    syncEmbeddedWordNetVisibility(active) { activity.push({ owner: "word-net", active, covered }); },
    syncEmbeddedGameVisibility(activeTab) { activity.push({ owner: "embedded", active: activeTab, covered }); },
    nextCampaignTab: () => gameId,
    showCampaignTransition() { covered = true; }, hideCampaignTransition() { covered = false; },
    ensureCampaignGameLoaded() {},
    waitForCampaignGameReady: () => new Promise(resolve => readiness.push(resolve)),
    waitForPracticePresentation: () => ({ promise: new Promise(resolve => presentations.push(resolve)) }),
    cancelPracticePresentationWaits() {},
    setTrainTab(id) { state.trainTab = id; context.syncActiveGameVisibility(); }
  });
  vm.runInContext(sourceBetween("function syncActiveGameVisibility()", "function syncEmbeddedWordNetVisibility(")
    + sourceBetween("async function startCampaign()", "function handleCampaignGameMessage(event)"), context);
  return { context, state, activity, readiness, presentations, covered: () => covered };
}

for (const gameId of ["grammar-gravity", "sound-quasar", "conjugation-comet", "case-cosmos", "memory-moon", "word-net"]) {
  test(`Campaign keeps its first ${gameId} challenge inactive until readiness and presentation are released`, async () => {
    const game = initialCampaign(gameId);
    const started = game.context.startCampaign();
    const active = () => game.activity.filter(event => event.owner === "word-net" ? event.active : Boolean(event.active));
    assert.equal(game.covered(), true);
    assert.deepEqual(active(), [], "loading cannot start hidden game timers or input");
    game.readiness.shift()();
    await new Promise(resolve => setImmediate(resolve));
    game.context.syncActiveGameVisibility();
    assert.deepEqual(active(), [], "a settings or reward gate keeps the ready game suspended");
    game.presentations.shift()(true);
    await started;
    assert.equal(game.covered(), false);
    assert.equal(game.state.campaignHandoffPending, false);
    assert.ok(active().length > 0, "the selected game becomes active after presentation readiness");
    assert.equal(game.activity.at(-1).active, gameId);
  });
}

test("cancelling an initial Campaign load cannot reactivate its abandoned first game", async () => {
  const game = initialCampaign("grammar-gravity");
  const started = game.context.startCampaign();
  game.context.stopCampaign();
  game.context.setTrainTab("galaxy");
  game.readiness.shift()();
  await started;
  assert.equal(game.state.campaignActive, false);
  assert.equal(game.state.campaignHandoffPending, false);
  assert.equal(game.covered(), false);
  assert.equal(game.presentations.length, 0);
  assert.ok(game.activity.every(event => event.owner === "word-net" ? !event.active : event.active !== "grammar-gravity"));
});

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
  const calls = [], waits = [], readiness = [], activity = [];
  const window = { location: { origin: "https://local.test" },
    CaatuuWordWorldHost: { advanceCampaignRound: () => {
      assert.equal(state.campaignHandoffPending, true, "the outgoing game is suspended before reset");
      calls.push("next-sentence");
    } } };
  const context = vm.createContext({ state, window, Promise,
    waitForPracticePresentation: () => ({ promise: Promise.resolve(true) }),
    cancelPracticePresentationWaits() {}, nextCampaignTab: () => nextGameId,
    document: { body: { dataset: {} } },
    showCampaignTransition: () => calls.push("show-transition"), hideCampaignTransition: () => calls.push("hide-transition"),
    ensureCampaignGameLoaded: () => calls.push("load-next-game"),
    waitForCampaignGameReady: () => new Promise(resolve => readiness.push(resolve)),
    syncActiveGameVisibility: () => activity.push(!state.campaignHandoffPending),
    setTrainTab: id => { state.trainTab = id; activity.push(!state.campaignHandoffPending); }
  });
  vm.runInContext(campaignCompletionSource + sourceBetween("function stopCampaign()", "function handleCampaignGameMessage"), context);
  window.CaatuuWorkspaceShell = { completeWordWorldRound: () => context.completeWordWorldCampaignRound(),
    continueWordWorld: () => context.continueWordWorldCampaign() };
  return { state, calls, waits, activity, window, context, ready: () => readiness.shift()?.(),
    complete: () => context.completeCampaignRound("word-net", window) };
}

test("Campaign preserves the Word World result until Next, then waits only for real readiness", async () => {
  const game = wordWorldCampaign(), completed = game.complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(game.calls, [], "there is no timed result dismissal or loading overlay");
  assert.notEqual(game.state.campaignHandoffPending, true, "the result remains interactive until Next");
  await game.complete();
  game.context.continueWordWorldCampaign();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(game.calls, ["show-transition", "next-sentence", "load-next-game"]);
  assert.deepEqual(game.activity, [false]);
  assert.equal(game.state.trainTab, "word-net", "unready destination cannot replace the current game");
  game.ready(); await completed;
  assert.equal(game.state.trainTab, "verb-lab"); assert.equal(game.state.campaignTransitioning, false);
  assert.deepEqual(game.activity, [false, true]);
  assert.equal(game.state.campaignHandoffPending, false);
});

test("cancelling a handoff retires suspension without reactivating the outgoing game", async () => {
  const game = wordWorldCampaign(), completed = game.complete();
  game.context.continueWordWorldCampaign();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(game.state.campaignHandoffPending, true);
  game.context.stopCampaign();
  assert.equal(game.state.campaignHandoffPending, false);
  assert.deepEqual(game.activity, [false], "navigation chooses the next active presentation");
  game.ready(); await completed;
  assert.equal(game.state.trainTab, "word-net");
});

test("a late embedded load or appearance sync cannot reactivate the outgoing game during handoff", () => {
  const messages = [];
  const state = { activeView: "verbs", trainTab: "memory-moon", campaignHandoffPending: true };
  const frame = { dataset: { ready: "true" }, contentWindow: {
    postMessage: message => messages.push(message)
  } };
  const context = vm.createContext({ state, Object,
    embeddedGameTabs: { "memory-moon": { frameId: "moon" } },
    document: { getElementById: () => frame, documentElement: { dataset: {} } },
    window: { location: { origin: "https://local.test" } }
  });
  vm.runInContext(sourceBetween("function syncEmbeddedGameVisibility(activeTab)", "function ensureEmbeddedGameLoaded(gameId)"), context);
  context.syncEmbeddedGameVisibility("memory-moon");
  assert.equal(messages.at(-1).active, false);
  state.campaignHandoffPending = false;
  context.syncEmbeddedGameVisibility("memory-moon");
  assert.equal(messages.at(-1).active, true);
});

test("leaving Campaign while reviewing cancels its pending manual handoff", async () => {
  const game = wordWorldCampaign(), completed = game.complete();
  game.context.stopCampaign(); await completed;
  assert.deepEqual(game.calls, ["hide-transition"]); assert.equal(game.state.trainTab, "word-net");
});

test("a retired review callback cannot release a later campaign round", async () => {
  const game = wordWorldCampaign(), oldCompletion = game.complete(), oldRelease = game.state.campaignContinueResult;
  game.context.stopCampaign(); game.state.campaignActive = true;
  const newCompletion = game.complete(); oldRelease(); await oldCompletion;
  assert.equal(typeof game.state.campaignContinueResult, "function");
  assert.deepEqual(game.calls, ["hide-transition"]);
  game.context.continueWordWorldCampaign(); await new Promise(resolve => setImmediate(resolve));
  game.ready(); await newCompletion;
  assert.equal(game.calls.filter(call => call === "next-sentence").length, 1);
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
  test(`repeated Next clicks consume one campaign round before ${nextGameId}`, async () => {
    const game = wordWorldCampaign({ nextGameId }), round = attachWordWorld(game);
    round.success(); assert.equal(game.state.campaignTransitioning, true);
    assert.equal(round.generated(), 0, "success itself preserves the learning result");
    await round.next(); await round.next(); await new Promise(resolve => setImmediate(resolve));
    await round.next(); assert.equal(round.generated(), 1);
    game.ready(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(game.state.trainTab, nextGameId); assert.equal(game.state.campaignTransitioning, false);
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
    waitForPracticePresentation: () => ({ promise: Promise.resolve(true), cancel() {} }),
    clearVerbReview() {
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
    syncActiveGameVisibility() {},
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
