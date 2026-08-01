import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assignUniqueVerbHintCandidates,
  dealVerbRound,
  extractCoreVerbPairs,
  filterVerbPairsForDifficulty,
  isVerbRoundComplete,
  verbHintSearchText,
  normalizeVerbPairCount,
  restoreVerbQueue,
  resolvePinnedStableVerbPair,
  resolveStableVerbPair,
  shuffleVerbMeanings,
  validatePinnedVerbPairLocator,
  verbPairMatches,
} from "../../../apps/languages/czech/static/verb-nebula-core.mjs";

test("uses the exact English equivalent for Macaw retrieval", () => {
  assert.equal(verbHintSearchText({ cz: "letět", eng: "fly" }), "fly");
  assert.equal(verbHintSearchText({ cz: "letět", eng: "  fly  " }), "fly");
});

test("assigns every clue image once and gives contested art to the strongest match", () => {
  const assignments = assignUniqueVerbHintCandidates([
    [
      { assetPath: "/shared.png", score: 0.82 },
      { assetPath: "/close.png", score: 0.7 },
    ],
    [
      { assetPath: "/shared.png", score: 0.94 },
      { assetPath: "/wait.png", score: 0.68 },
    ],
    [
      { assetPath: "/walk.png", score: 0.91 },
      { assetPath: "/shared.png", score: 0.4 },
    ],
  ]);

  assert.deepEqual(assignments.map((candidate) => candidate.assetPath), [
    "/close.png",
    "/shared.png",
    "/walk.png",
  ]);
  assert.equal(new Set(assignments.map((candidate) => candidate.assetPath)).size, 3);
});

const dictionaryUrl = new URL(
  "../../../apps/languages/czech/static/data/dictionary.json",
  import.meta.url
);
const appUrl = new URL("../../../apps/languages/czech/static/app.js", import.meta.url);
const indexUrl = new URL("../../../apps/languages/czech/static/index.html", import.meta.url);

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

const reviewedReadReference = Object.freeze({
  id: "cs.verb.cist.read",
  cz: "číst",
  eng: "read",
  difficulty: 1,
  difficultyIsAuthored: true,
  legacyLocator: Object.freeze({
    pairId: "core-verb-179",
    sourceIndex: 179,
  }),
});
const reviewedDictionaryDigest = "sha256:2acc46335f21dea340866206cdba656ebcf0644f3b8bb55ee2e9f1b0c44d2a1b";

test("resolves the reviewed read pair by stable curriculum identity", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const pair = resolveStableVerbPair(dictionary, reviewedReadReference);

  assert.equal(pair.curriculumContentId, "cs.verb.cist.read");
  assert.equal(pair.cz, "číst");
  assert.equal(pair.eng, "read");
  assert.equal(pair.id, "core-verb-179");
  assert.equal(pair.sourceIndex, 179);
  assert.deepEqual(validatePinnedVerbPairLocator(dictionary, reviewedReadReference), pair);
});

test("stable lookup survives unrelated reordering but the pinned locator detects it", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const reordered = [
    ...dictionary.slice(0, 179),
    { kind: "N", cs: "testovací zástupný řádek", en: "test placeholder row" },
    ...dictionary.slice(179),
  ];

  const movedPair = resolveStableVerbPair(reordered, reviewedReadReference);
  assert.equal(movedPair.curriculumContentId, "cs.verb.cist.read");
  assert.equal(movedPair.cz, "číst");
  assert.equal(movedPair.eng, "read");
  assert.equal(movedPair.sourceIndex, 180);
  assert.equal(movedPair.id, "core-verb-180");
  assert.throws(
    () => validatePinnedVerbPairLocator(reordered, reviewedReadReference),
    { code: "VERB_STABLE_LOCATOR_DRIFT" }
  );
});

test("stable lookup rejects reviewed-label drift and ambiguity", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const drifted = dictionary.map((row, index) => (
    index === 179 ? { ...row, en: "study" } : row
  ));
  assert.throws(
    () => resolveStableVerbPair(drifted, reviewedReadReference),
    { code: "VERB_STABLE_SOURCE_DRIFT" }
  );

  const ambiguous = [...dictionary, { ...dictionary[179] }];
  assert.throws(
    () => resolveStableVerbPair(ambiguous, reviewedReadReference),
    { code: "VERB_STABLE_AMBIGUOUS" }
  );
});

test("strict runtime lookup verifies the exact dictionary bytes before resolving", async () => {
  const dictionaryJsonText = await readFile(dictionaryUrl, "utf8");
  const pair = await resolvePinnedStableVerbPair(
    dictionaryJsonText,
    reviewedDictionaryDigest,
    reviewedReadReference
  );

  assert.equal(pair.curriculumContentId, "cs.verb.cist.read");
  assert.equal(pair.id, "core-verb-179");
  assert.equal(pair.cz, "číst");
  assert.equal(pair.eng, "read");
});

test("strict runtime lookup rejects missing, mismatched, and reordered catalog pins", async () => {
  const dictionaryJsonText = await readFile(dictionaryUrl, "utf8");
  await assert.rejects(
    resolvePinnedStableVerbPair(dictionaryJsonText, "", reviewedReadReference),
    { code: "VERB_STABLE_INVALID_CATALOG_DIGEST" }
  );
  await assert.rejects(
    resolvePinnedStableVerbPair(
      dictionaryJsonText,
      `sha256:${"0".repeat(64)}`,
      reviewedReadReference
    ),
    { code: "VERB_STABLE_CATALOG_DIGEST_MISMATCH" }
  );

  const reordered = JSON.parse(dictionaryJsonText);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  await assert.rejects(
    resolvePinnedStableVerbPair(
      JSON.stringify(reordered),
      reviewedDictionaryDigest,
      reviewedReadReference
    ),
    { code: "VERB_STABLE_CATALOG_DIGEST_MISMATCH" }
  );
});

test("keeps the curated difficulty metadata and defaults unclassified verbs to Navigator", () => {
  const pairs = extractCoreVerbPairs([
    { kind: "V", cs: "one", en: "first", difficulty: 1 },
    { kind: "V", cs: "two", en: "second", difficulty: "2" },
    { kind: "V", cs: "invalid", en: "invalid", difficulty: 99 },
    { kind: "V", cs: "missing", en: "missing" },
  ]);

  assert.deepEqual(pairs.map((pair) => pair.difficulty), [1, 2, 3, 3]);
  assert.deepEqual(pairs.map((pair) => pair.difficultyIsAuthored), [true, true, false, false]);
  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 1).map((pair) => pair.id), ["core-verb-0"]);
});

test("keeps a wholly pre-tier cached catalog playable during an app upgrade", () => {
  const legacyPairs = extractCoreVerbPairs([
    { kind: "V", cs: "one", en: "first" },
    { kind: "V", cs: "two", en: "second" },
  ]);

  assert.deepEqual(legacyPairs.map((pair) => pair.difficultyIsAuthored), [false, false]);
  assert.deepEqual(filterVerbPairsForDifficulty(legacyPairs, 1), legacyPairs);
});

test("Core verb difficulty tiers are explicit, intentionally uneven, and cumulatively playable", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const verbRows = dictionary.filter((row) => /^V(?:\s|$)/u.test(String(row?.kind || "")));
  const rowTierCounts = verbRows.reduce((counts, row) => {
    assert.ok(Number.isInteger(row.difficulty) && row.difficulty >= 1 && row.difficulty <= 3,
      `${row.cs || "Core verb"} must have an explicit difficulty from 1 to 3`);
    counts[row.difficulty] += 1;
    return counts;
  }, { 1: 0, 2: 0, 3: 0 });

  assert.deepEqual(rowTierCounts, { 1: 45, 2: 76, 3: 32 });

  const pairs = extractCoreVerbPairs(dictionary);
  const pairTierCounts = pairs.reduce((counts, pair) => {
    counts[pair.difficulty] += 1;
    return counts;
  }, { 1: 0, 2: 0, 3: 0 });
  assert.deepEqual(pairTierCounts, { 1: 45, 2: 73, 3: 32 });

  const explorer = filterVerbPairsForDifficulty(pairs, 1);
  const traveler = filterVerbPairsForDifficulty(pairs, 2);
  const navigator = filterVerbPairsForDifficulty(pairs, 3);
  assert.equal(explorer.length, 45);
  assert.equal(traveler.length, 118);
  assert.equal(navigator.length, 150);
  assert.ok(explorer.every((pair) => pair.difficulty === 1));
  assert.ok(traveler.every((pair) => pair.difficulty <= 2));
  assert.deepEqual(navigator, pairs);
  assert.ok([explorer, traveler, navigator].every((pool) => pool.length >= 8));
});

test("difficulty filtering is cumulative, stable, and conservative for invalid settings", () => {
  const pairs = [
    { id: "one", difficulty: 1 },
    { id: "two", difficulty: 2 },
    { id: "three", difficulty: 3 },
    { id: "unclassified" },
  ];

  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 1).map((pair) => pair.id), ["one"]);
  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 2).map((pair) => pair.id), ["one", "two"]);
  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 3).map((pair) => pair.id), [
    "one", "two", "three", "unclassified",
  ]);
  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 99).map((pair) => pair.id), ["one"]);
});

test("a lower difficulty cannot restore locked verbs into its queue", () => {
  const pairs = [
    { id: "raw", difficulty: 1 },
    { id: "everyday", difficulty: 2 },
    { id: "specialized", difficulty: 3 },
  ];
  const explorer = filterVerbPairsForDifficulty(pairs, 1);
  const restored = restoreVerbQueue(
    explorer,
    ["specialized", "raw", "everyday"],
    () => 0.5
  );

  assert.deepEqual(restored, ["raw"]);
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

test("Verb Nebula keeps revealed solutions visible and gates the next round on clue images", async () => {
  const [app, index] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(indexUrl, "utf8"),
  ]);

  assert.match(index, /data-verb-pair-count="8"/);
  assert.match(index, /id="verbRevealSolution"[^>]+aria-label="Reveal solution"/);
  assert.doesNotMatch(index, /id="verbNextRound"/);
  assert.match(app, /#verbRevealSolution"\)\?\.addEventListener\("click", toggleVerbSolution\)/);
  assert.match(app, /const roundComplete = verbRoundComplete\(\);[\s\S]*?if \(roundComplete\) \{\s*void transitionToNextVerbRound\(\);/);
  assert.match(index, /id="verbSolutionArrows"/);
  assert.match(app, /renderVerbSolutionArrows\(\)/);
  assert.match(app, /svg\.classList\.toggle\("is-visible", Boolean\(visible\)\)/);
  assert.match(app, /route\.dataset\.verbPairId = pair\.id/);
  assert.doesNotMatch(app, /solutionOrdinal/);
  assert.match(app, /assignUniqueVerbHintCandidates\(candidateGroups\)/);
  assert.match(app, /Follow the arrows to review every pair\./);
  assert.match(app, /state\.verbSolutionRevealed = !state\.verbSolutionRevealed;\s*clearVerbSolutionAdvance\(\);\s*setVerbMatchFeedback/);
  assert.doesNotMatch(app, /transitionToNextVerbRound\(\{ revealSolution: true \}\)/);
  assert.match(app, /preloadVerbHintsForRound\(nextRound\.round\)/);
  assert.match(app, /preloadVerbHintAsset\(hint\?\.assetPath\)/);
  assert.match(app, /applyVerbRound\(nextRound, preloadedHints\);/);
  assert.match(app, /difficulty: state\.verbDifficulty/);
  assert.match(app, /filterVerbPairsForDifficulty\([\s\S]*?state\.verbDifficulty/);
  assert.match(app, /const sameDifficulty = Number\(memory\?\.difficulty\) === state\.verbDifficulty/);
  assert.match(app, /reason === "difficulty"\) rebaseVerbDifficulty\(\)/);
  assert.match(app, /row\.append\(renderVerbHintSlot\(pair\), button\);/);
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
