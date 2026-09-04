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

  const browserWindow = { location: { origin: "https://local.test" } };
  browserWindow.window = browserWindow;
  const context = vm.createContext({
    campaignPlayableTabs: ["verb-lab"],
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
