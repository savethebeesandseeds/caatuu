import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dealVerbRound,
  extractCoreVerbPairs,
  isVerbRoundComplete,
  verbHintSearchText,
  normalizeVerbPairCount,
  restoreVerbQueue,
  shuffleVerbMeanings,
  verbPairMatches,
} from "../../../apps/caatuu-czech/static/verb-nebula-core.mjs";

test("uses the exact English equivalent for Macaw retrieval", () => {
  assert.equal(verbHintSearchText({ cz: "letět", eng: "fly" }), "fly");
  assert.equal(verbHintSearchText({ cz: "letět", eng: "  fly  " }), "fly");
});

const dictionaryUrl = new URL(
  "../../../apps/caatuu-czech/static/data/dictionary.json",
  import.meta.url
);
const appUrl = new URL("../../../apps/caatuu-czech/static/app.js", import.meta.url);
const indexUrl = new URL("../../../apps/caatuu-czech/static/index.html", import.meta.url);

test("extracts unique learner verbs from the ordered Core dictionary", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const pairs = extractCoreVerbPairs(dictionary);

  assert.equal(pairs.length, 150);
  assert.equal(pairs[0].cz, "být");
  assert.equal(pairs[0].eng, "be");
  assert.equal(new Set(pairs.map((pair) => pair.cz.toLowerCase())).size, pairs.length);
  assert.equal(new Set(pairs.map((pair) => pair.eng.toLowerCase())).size, pairs.length);
  assert.ok(pairs.every((pair) => !pair.eng.includes(" / ")));
});

test("supports the 2, 4, 6, and 8 pair layouts", () => {
  assert.equal(normalizeVerbPairCount(2), 2);
  assert.equal(normalizeVerbPairCount("6"), 6);
  assert.equal(normalizeVerbPairCount("8"), 8);
  assert.equal(normalizeVerbPairCount(5), 4);
});

test("deals a unique full round and preserves the waiting queue", () => {
  const pairs = Array.from({ length: 8 }, (_, index) => ({
    id: `verb-${index}`,
    cz: `cz-${index}`,
    eng: `en-${index}`,
  }));
  const queue = restoreVerbQueue(pairs, pairs.map((pair) => pair.id), () => 0.5);
  const first = dealVerbRound(pairs, queue, 6, () => 0.5);

  assert.equal(first.round.length, 6);
  assert.equal(new Set(first.round.map((pair) => pair.id)).size, 6);
  assert.deepEqual(first.queueIds, ["verb-6", "verb-7"]);

  const second = dealVerbRound(pairs, first.queueIds, 6, () => 0.5);
  assert.equal(second.round.length, 6);
  assert.equal(new Set(second.round.map((pair) => pair.id)).size, 6);
  assert.deepEqual(second.round.slice(0, 2).map((pair) => pair.id), ["verb-6", "verb-7"]);

  const eight = dealVerbRound(pairs, pairs.map((pair) => pair.id), 8, () => 0.5);
  assert.equal(eight.round.length, 8);
  assert.equal(new Set(eight.round.map((pair) => pair.id)).size, 8);
});

test("restores only unseen queue items while adding newly catalogued verbs", () => {
  const pairs = Array.from({ length: 5 }, (_, index) => ({ id: `verb-${index}` }));
  const restored = restoreVerbQueue(
    pairs,
    ["verb-3"],
    () => 0.5,
    ["verb-0", "verb-1", "verb-2", "verb-3"]
  );

  assert.deepEqual(restored, ["verb-3", "verb-4"]);
});

test("deranges the English column so answers are not aligned", () => {
  const round = Array.from({ length: 6 }, (_, index) => ({ id: `verb-${index}` }));
  const meanings = shuffleVerbMeanings(round, () => 0);

  assert.deepEqual(new Set(meanings.map((pair) => pair.id)), new Set(round.map((pair) => pair.id)));
  assert.ok(meanings.every((pair, index) => pair.id !== round[index].id));
});

test("matches cards only by shared queue identity", () => {
  assert.equal(verbPairMatches("verb-2", "verb-2"), true);
  assert.equal(verbPairMatches("verb-2", "verb-3"), false);
  assert.equal(verbPairMatches("", "verb-3"), false);
});

test("completes a round only when every dealt pair was matched", () => {
  const round = [{ id: "verb-1" }, { id: "verb-2" }];
  assert.equal(isVerbRoundComplete(round, new Set(["verb-1"])), false);
  assert.equal(isVerbRoundComplete(round, new Set(["verb-1", "verb-2"])), true);
  assert.equal(isVerbRoundComplete(round, new Set(["verb-1", "verb-2", "other"])), true);
  assert.equal(isVerbRoundComplete([], new Set()), false);
});

test("Verb Nebula reveals solutions and auto-advances through a robot interstitial", async () => {
  const [app, index] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(indexUrl, "utf8"),
  ]);

  assert.match(index, /data-verb-pair-count="8"/);
  assert.match(index, /id="verbRevealSolution"[^>]+aria-label="Reveal solution"/);
  assert.doesNotMatch(index, /id="verbNextRound"/);
  assert.match(app, /#verbRevealSolution"\)\?\.addEventListener\("click", revealVerbSolution\)/);
  assert.match(app, /if \(verbRoundComplete\(\)\) \{\s*void transitionToNextVerbRound\(\);/);
  assert.match(app, /state\.verbSolutionRevealed \? state\.verbRound : state\.verbEnglishRound/);
  assert.match(app, /These pairs do not count as matches\./);
  assert.match(app, /preloadVerbHintsForRound\(nextRound\.round\)/);
  assert.match(app, /waitForVerbTransition\(verbRoundInterstitialMillis\)/);
  assert.match(app, /verbRobotKeymapUrl = "\/assets\/robots\/keymap\.json"/);
  assert.match(app, /const verbHintLookupTimeoutMillis = 6000;/);
  assert.match(app, /const request = Promise\.race\(\[lookup, deadline\]\);/);
  assert.doesNotMatch(app, /Picture clue for \$\{pair\.eng\}/);
  assert.match(
    app,
    /if \(verbNebulaCore\.isVerbRoundComplete\(state\.verbRound, state\.verbMatchedIds\)\) \{\s*state\.verbRound = \[\];\s*state\.verbEnglishRound = \[\];\s*state\.verbMatchedIds\.clear\(\);/,
    "a persisted completed round must not strand the player after reload"
  );
});
