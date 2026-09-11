import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assignUniqueVerbHintCandidates,
  buildGuidedVerbRound,
  dealVerbRound,
  extractCoreVerbPairs,
  filterVerbPairsForDifficulty,
  isVerbRoundComplete,
  verbHintSearchText,
  normalizeVerbPairCount,
  restoreVerbQueue,
  resolvePinnedStableVerbPair,
  resolvePinnedStableVerbPairs,
  resolveStableVerbPair,
  shuffleVerbMeanings,
  validatePinnedVerbPairLocator,
  verbPairMatches,
  VERB_NEBULA_PAIR_COUNTS,
} from "../../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs";

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
  "../../../apps/languages/czech/static/data/games/verb-nebula/content.json",
  import.meta.url
);
const mandarinDictionaryUrl = new URL(
  "../../../apps/languages/mandarin-simplified/static/data/games/verb-nebula/content.json",
  import.meta.url
);
const appUrl = new URL("../../../apps/language-runtime/static/source/caatuu-workspace.js", import.meta.url);
const indexUrl = new URL("../../../apps/language-runtime/static/app/index.html", import.meta.url);

test("extracts unique learner verbs from the ordered Core dictionary", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const pairs = extractCoreVerbPairs(dictionary);

  assert.ok(pairs.length >= Math.max(...VERB_NEBULA_PAIR_COUNTS));
  const firstVerbIndex = dictionary.findIndex((row) => /^V(?:\s|$)/u.test(row.kind));
  assert.equal(pairs[0].sourceIndex, firstVerbIndex);
  for (const [index, pair] of pairs.entries()) {
    const source = dictionary[pair.sourceIndex];
    assert.match(source.kind, /^V(?:\s|$)/u);
    assert.equal(pair.cz, source.cs.split(" / ")[0].trim().normalize("NFC"));
    assert.equal(pair.eng, source.en.split(" / ")[0].trim().normalize("NFC"));
    assert.ok(index === 0 || pairs[index - 1].sourceIndex < pair.sourceIndex);
  }
  assert.equal(new Set(pairs.map((pair) => pair.cz.toLowerCase())).size, pairs.length);
  assert.equal(new Set(pairs.map((pair) => pair.eng.toLowerCase())).size, pairs.length);
  assert.ok(pairs.every((pair) => !pair.eng.includes(" / ")));
});

test("the Mandarin Verb Nebula catalog is a complete, stable, runtime-playable curriculum", async () => {
  const dictionary = JSON.parse(await readFile(mandarinDictionaryUrl, "utf8"));
  const pairs = extractCoreVerbPairs(dictionary);
  const requiredFields = [
    "category",
    "difficulty",
    "id",
    "kind",
    "reviewStatus",
    "source",
    "target",
    "usefulness",
    "complexity",
  ];

  assert.ok(dictionary.length >= Math.max(...VERB_NEBULA_PAIR_COUNTS));
  assert.equal(pairs.length, dictionary.length, "the runtime must not silently discard any authored row");

  for (const [index, row] of dictionary.entries()) {
    for (const field of requiredFields) {
      assert.ok(Object.hasOwn(row, field), `Mandarin verb row ${index + 1} requires ${field}`);
    }
    assert.match(row.id, /^zh\.verb\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
    assert.equal(row.kind, "verb");
    assert.match(row.target, /^\p{Script=Han}+$/u, `${row.id} must contain only authored Hanzi`);
    assert.ok(Number.isInteger(row.difficulty) && row.difficulty >= 1 && row.difficulty <= 3);
    for (const field of ["usefulness", "complexity"]) {
      assert.ok(Number.isInteger(row[field]) && row[field] >= 1 && row[field] <= 100);
      assert.equal(pairs[index][field], row[field], `${row.id}.${field} must survive runtime projection`);
    }
    assert.equal(row.reviewStatus, "native-review-required");
    for (const field of ["id", "kind", "target", "source", "category", "reviewStatus"]) {
      assert.ok(typeof row[field] === "string" && row[field].length > 0);
      assert.equal(row[field], row[field].normalize("NFC"), `${row.id}.${field} must be NFC-normalized`);
      assert.equal(row[field], row[field].trim(), `${row.id}.${field} must not have surrounding whitespace`);
    }
    assert.equal(pairs[index].id, row.id);
    assert.equal(pairs[index].target, row.target);
    assert.equal(pairs[index].source, row.source);
    assert.equal(pairs[index].englishAuditText, row.source);
    assert.equal(pairs[index].difficulty, row.difficulty);
    assert.equal(pairs[index].difficultyIsAuthored, true);
  }

  for (const [field, values] of [
    ["id", dictionary.map((row) => row.id)],
    ["target", dictionary.map((row) => row.target)],
    ["source", dictionary.map((row) => row.source.toLocaleLowerCase("en"))],
  ]) {
    assert.equal(new Set(values).size, dictionary.length, `Mandarin ${field} values must be unique`);
  }

  const byId = new Map(dictionary.map((row) => [row.id, row]));
  assert.deepEqual(
    ["shi", "you", "jiao", "xihuan", "he", "kan", "xiang", "qu", "shuo", "mingbai"]
      .map((slug) => byId.has(`zh.verb.${slug}`)),
    new Array(10).fill(true),
    "the original stable learner-progress IDs must remain addressable"
  );
});

test("Mandarin verb tiers preserve authored categories and cumulative progression", async () => {
  const dictionary = JSON.parse(await readFile(mandarinDictionaryUrl, "utf8"));
  const pairs = extractCoreVerbPairs(dictionary);
  for (const level of [1, 2, 3]) {
    const expectedRows = dictionary.filter((row) => row.difficulty <= level);
    const pool = filterVerbPairsForDifficulty(pairs, level);
    assert.deepEqual(pool.map((pair) => pair.id), expectedRows.map((row) => row.id));
    assert.ok(dictionary.some((row) => row.difficulty === level), `badge ${level} must be represented`);
    assert.ok(pool.length >= Math.max(...VERB_NEBULA_PAIR_COUNTS));
    assert.deepEqual(
      new Set(pool.map((pair) => dictionary[pair.sourceIndex].category)),
      new Set(expectedRows.map((row) => row.category))
    );
  }
  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 3), pairs);
});

test("Mandarin Verb Nebula content retains its child-safety exclusions", async () => {
  const dictionary = JSON.parse(await readFile(mandarinDictionaryUrl, "utf8"));
  const unsafeEnglish = /\b(?:alcohol|beer|wine|liquor|tobacco|cigarette|vape|drugs?|weapon|gun|rifle|pistol|bomb|grenade|knife|sword|fight|attack|assault|kill|murder|death|die|dead|blood|injur(?:y|e)|hurt|harm|abuse|bully|bullying|kidnap|torture|suicide|sex|sexual|nude|porn|gambl(?:e|ing)|steal|theft|rob|deceive|password|passcode)\b/iu;
  const unsafeMandarin = /(?:暴力|武器|枪|炮|炸弹|手榴弹|刀|剑|打架|打人|攻击|袭击|杀|谋杀|死亡|死|血|受伤|伤害|虐待|欺凌|霸凌|绑架|折磨|自杀|酒|啤酒|葡萄酒|烈酒|烟|香烟|电子烟|毒品|赌博|色情|性行为|裸体|偷|抢劫|欺骗|密码|口令)/u;

  for (const row of dictionary) {
    assert.doesNotMatch(row.source, unsafeEnglish, `${row.id} has child-inappropriate English content`);
    assert.doesNotMatch(row.target, unsafeMandarin, `${row.id} has child-inappropriate Mandarin content`);
  }

});

test("the ordered Core dictionary retains its child-safety exclusions", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));

  assert.ok(dictionary.length > 0);
  assert.doesNotMatch(
    JSON.stringify(dictionary),
    /\b(?:beer|wine|underwear|bra|boyfriend|girlfriend|razor|shaver)\b/iu
  );
});

test("filters combat Macaw assets from every child-facing Verb Nebula hint source", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(
    app,
    /import\("\/language-runtime\/static\/source\/child-facing-assets\.mjs\?v=child-facing-assets-2"\)/
  );
  assert.match(app, /function isChildSafeVerbHintAsset\(assetPath, action = ""\)/);
  assert.match(app, /childFacingAssets\?\.isChildFacingMacawActionAssetAllowed\(normalizedPath, action\)/);
  assert.match(app, /vectorVerbHintCandidates\(pair\)[\s\S]*?filter\(\(row\) => isChildSafeVerbHintAsset\(row\.assetPath\)\)/);
  assert.match(app, /loadVerbHintKeymap\(\)[\s\S]*?filter\(\(row\) => isChildSafeVerbHintAsset\(row\.assetPath, row\.action\)\)/);
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
const reviewedContrastReferences = Object.freeze([
  Object.freeze({
    id: "cs.verb.jist.eat",
    cz: "jíst",
    eng: "eat",
    difficulty: 1,
    difficultyIsAuthored: true,
    legacyLocator: Object.freeze({ pairId: "core-verb-202", sourceIndex: 202 }),
  }),
  Object.freeze({
    id: "cs.verb.pit.drink",
    cz: "pít",
    eng: "drink",
    difficulty: 1,
    difficultyIsAuthored: true,
    legacyLocator: Object.freeze({ pairId: "core-verb-203", sourceIndex: 203 }),
  }),
  Object.freeze({
    id: "cs.verb.spat.sleep",
    cz: "spát",
    eng: "sleep",
    difficulty: 1,
    difficultyIsAuthored: true,
    legacyLocator: Object.freeze({ pairId: "core-verb-157", sourceIndex: 157 }),
  }),
]);
// Reviewed locators above protect historical progress identities. Exact-byte
// verification uses its own fixture so catalog additions need no new hash pin.
const reviewedFixtureReferences = [reviewedReadReference, ...reviewedContrastReferences]
  .map((reference, sourceIndex) => ({
    ...reference,
    legacyLocator: { pairId: `core-verb-${sourceIndex}`, sourceIndex },
  }));
const reviewedFixtureDictionary = reviewedFixtureReferences.map((reference) => ({
  kind: "V",
  cs: reference.cz,
  en: reference.eng,
  difficulty: reference.difficulty,
  usefulness: 4,
  complexity: 2,
}));
const reviewedFixtureBytes = new TextEncoder().encode(JSON.stringify(reviewedFixtureDictionary));
const reviewedFixtureDigest = `sha256:${createHash("sha256").update(reviewedFixtureBytes).digest("hex")}`;

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
  const pair = await resolvePinnedStableVerbPair(
    reviewedFixtureBytes,
    reviewedFixtureDigest,
    reviewedFixtureReferences[0]
  );

  assert.equal(pair.curriculumContentId, "cs.verb.cist.read");
  assert.equal(pair.id, "core-verb-0");
  assert.equal(pair.cz, "číst");
  assert.equal(pair.eng, "read");
});

test("builds a task-seeded deranged Guided round from reviewed contrasts", async () => {
  const pairs = extractCoreVerbPairs(reviewedFixtureDictionary);
  const [target, ...contrastPairs] = await resolvePinnedStableVerbPairs(
    reviewedFixtureBytes,
    reviewedFixtureDigest,
    reviewedFixtureReferences
  );
  const options = { pairCount: 4, contrastPairs, taskFingerprint: "task-fingerprint-alpha" };
  const first = buildGuidedVerbRound(pairs, target, options);
  const second = buildGuidedVerbRound(pairs, target, options);

  assert.deepEqual(second, first);
  assert.equal(first.round.length, 4);
  assert.equal(first.round.filter((pair) => pair.id === target.id).length, 1);
  assert.equal(new Set(first.round.map((pair) => pair.id)).size, 4);
  assert.deepEqual(
    new Set(first.round.map((pair) => pair.id)),
    new Set(reviewedFixtureReferences.map((reference) => reference.legacyLocator.pairId))
  );
  assert.deepEqual(
    new Set(first.englishRound.map((pair) => pair.id)),
    new Set(first.round.map((pair) => pair.id))
  );
  assert.ok(first.englishRound.every((pair, index) => pair.id !== first.round[index].id));
  assert.deepEqual(first.queueIds, []);

  const seededPlans = Array.from({ length: 12 }, (_, index) => buildGuidedVerbRound(
    pairs,
    target,
    { pairCount: 4, contrastPairs, taskFingerprint: `task-fingerprint-${index}` }
  ));
  assert.ok(new Set(seededPlans.map((plan) => plan.round.findIndex((pair) => pair.id === target.id))).size > 1);
  assert.ok(new Set(seededPlans.map((plan) => plan.englishRound.findIndex((pair) => pair.id === target.id))).size > 1);
});

test("Guided verb round construction fails closed without its target or contrasts", () => {
  const target = { id: "target", sourceIndex: 10, cz: "\u010d\u00edst", eng: "read", difficulty: 1 };
  assert.throws(
    () => buildGuidedVerbRound([], target, { taskFingerprint: "task" }),
    { code: "VERB_GUIDED_TARGET_MISSING" }
  );
  assert.throws(
    () => buildGuidedVerbRound([target], target, { taskFingerprint: "task" }),
    { code: "VERB_GUIDED_CONTRASTS_MISSING" }
  );
});

test("strict batch lookup rejects missing or duplicate reviewed contrasts", async () => {
  const missing = structuredClone(reviewedFixtureReferences[1]);
  missing.eng = "consume";
  await assert.rejects(
    resolvePinnedStableVerbPairs(
      reviewedFixtureBytes,
      reviewedFixtureDigest,
      [reviewedFixtureReferences[0], missing]
    ),
    { code: "VERB_STABLE_SOURCE_DRIFT" }
  );
  await assert.rejects(
    resolvePinnedStableVerbPairs(
      reviewedFixtureBytes,
      reviewedFixtureDigest,
      [reviewedFixtureReferences[0], reviewedFixtureReferences[0]]
    ),
    { code: "VERB_STABLE_DUPLICATE_REFERENCE" }
  );
});

test("strict runtime lookup rejects missing, mismatched, and reordered catalog pins", async () => {
  const dictionaryBytes = reviewedFixtureBytes;
  const reference = reviewedFixtureReferences[0];
  await assert.rejects(
    resolvePinnedStableVerbPair(dictionaryBytes, "", reference),
    { code: "VERB_STABLE_INVALID_CATALOG_DIGEST" }
  );
  await assert.rejects(
    resolvePinnedStableVerbPair(
      dictionaryBytes,
      `sha256:${"0".repeat(64)}`,
      reference
    ),
    { code: "VERB_STABLE_CATALOG_DIGEST_MISMATCH" }
  );

  const reordered = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(dictionaryBytes));
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  await assert.rejects(
    resolvePinnedStableVerbPair(
      new TextEncoder().encode(JSON.stringify(reordered)),
      reviewedFixtureDigest,
      reference
    ),
    { code: "VERB_STABLE_CATALOG_DIGEST_MISMATCH" }
  );

  const bomPrefixed = new Uint8Array(dictionaryBytes.length + 3);
  bomPrefixed.set([0xef, 0xbb, 0xbf]);
  bomPrefixed.set(dictionaryBytes, 3);
  await assert.rejects(
    resolvePinnedStableVerbPair(
      bomPrefixed,
      reviewedFixtureDigest,
      reference
    ),
    { code: "VERB_STABLE_CATALOG_DIGEST_MISMATCH" }
  );

  for (const tampered of [
    new TextEncoder().encode(`${JSON.stringify(reviewedFixtureDictionary)}\n`),
    new TextEncoder().encode(JSON.stringify(reviewedFixtureDictionary.map((row, index) => (
      index === 0 ? { ...row, usefulness: 5 } : row
    )))),
  ]) {
    await assert.rejects(
      resolvePinnedStableVerbPair(tampered, reviewedFixtureDigest, reference),
      { code: "VERB_STABLE_CATALOG_DIGEST_MISMATCH" }
    );
  }
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

test("Core verb difficulty tiers preserve authored progression and remain cumulatively playable", async () => {
  const dictionary = JSON.parse(await readFile(dictionaryUrl, "utf8"));
  const verbRows = dictionary.filter((row) => /^V(?:\s|$)/u.test(String(row?.kind || "")));
  const rowTierCounts = verbRows.reduce((counts, row) => {
    assert.ok(Number.isInteger(row.difficulty) && row.difficulty >= 1 && row.difficulty <= 3,
      `${row.cs || "Core verb"} must have an explicit difficulty from 1 to 3`);
    counts[row.difficulty] += 1;
    return counts;
  }, { 1: 0, 2: 0, 3: 0 });

  assert.ok(Object.values(rowTierCounts).every((count) => count > 0));

  const pairs = extractCoreVerbPairs(dictionary);
  for (const pair of pairs) {
    const source = dictionary[pair.sourceIndex];
    assert.equal(pair.difficulty, source.difficulty);
    assert.equal(pair.difficultyIsAuthored, true);
    for (const field of ["usefulness", "complexity"]) {
      assert.ok(Number.isInteger(source[field]) && source[field] >= 1 && source[field] <= 100);
      assert.equal(pair[field], source[field]);
    }
  }
  for (const level of [1, 2, 3]) {
    const pool = filterVerbPairsForDifficulty(pairs, level);
    assert.deepEqual(pool, pairs.filter((pair) => dictionary[pair.sourceIndex].difficulty <= level));
    assert.ok(pool.length >= Math.max(...VERB_NEBULA_PAIR_COUNTS));
  }
  assert.deepEqual(filterVerbPairsForDifficulty(pairs, 3), pairs);
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
  assert.match(
    app,
    /#verbRevealSolution"\)\?\.addEventListener\("click", \(\) => \{\s*void trackVerbGuidedOperation\(toggleVerbSolution\);\s*\}\)/
  );
  assert.match(
    app,
    /const roundComplete = verbRoundComplete\(\);[\s\S]*?if \(roundComplete && !state\.verbGuidedMode\) \{\s*if \(state\.campaignActive\) void completeCampaignRound\("verb-lab", window\);\s*else void transitionToNextVerbRound\(\);\s*\}/
  );
  assert.match(index, /id="verbSolutionArrows"/);
  assert.match(app, /renderVerbSolutionArrows\(\)/);
  assert.match(app, /svg\.classList\.toggle\("is-visible", Boolean\(visible\)\)/);
  assert.match(app, /route\.dataset\.verbPairId = pair\.id/);
  assert.doesNotMatch(app, /solutionOrdinal/);
  assert.match(app, /assignUniqueVerbHintCandidates\(candidateGroups\)/);
  assert.match(
    app,
    /const guidedLifecycle = state\.verbGuidedLifecycle;[\s\S]*?await guidedLifecycle\.recordSolutionReveal[\s\S]*?state\.verbSolutionRevealed = true/
  );
  assert.match(app, /if \(!state\.verbGuidedMode\) \{[\s\S]*?state\.verbSolutionAdvanceTimer = window\.setTimeout/);
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
  assert.match(app, /entry\.screen = mountRobotLoadingScreen\(/);
  assert.doesNotMatch(app, /verbRobotKeymapUrl/);
  assert.match(app, /const verbHintLookupTimeoutMillis = 6000;/);
  assert.match(app, /const request = Promise\.race\(\[lookup, deadline\]\)/);
  assert.doesNotMatch(app, /Picture clue for \$\{pair\.eng\}/);
  assert.match(
    app,
    /if \(verbNebulaCore\.isVerbRoundComplete\(state\.verbRound, state\.verbMatchedIds\)\) \{\s*state\.verbRound = \[\];\s*state\.verbEnglishRound = \[\];\s*state\.verbMatchedIds\.clear\(\);/,
    "a persisted completed round must not strand the player after reload"
  );
});
