import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const NUCLEUS_SCHEMA_URL = "https://caatuu.org/schemas/development/naturalization-nucleus.preview.v1.json";
const readText = (path) => readFile(new URL(path, repoRoot), "utf8");
const readJson = (path) => readText(path).then(JSON.parse);

const [
  bootstrap,
  controller,
  catalog,
  mandarinSetup,
  czechSetup,
  androidAssets,
  appAssets,
  readingGuides,
  shipFiles
] = await Promise.all([
  readText("apps/language-runtime/static/source/app-bootstrap.mjs"),
  readText("apps/languages/mandarin-simplified/static/source/games/naturalization-nucleus/naturalization-nucleus.js"),
  readJson("apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/challenges.json"),
  readJson("apps/languages/mandarin-simplified/static/setup-assets.json"),
  readJson("apps/languages/czech/static/setup-assets.json"),
  readJson("apps/languages/mandarin-simplified/android-assets.json"),
  readJson("apps/language-runtime/app-assets.json"),
  readJson("apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.reading-guides.json"),
  readdir(new URL("apps/launcher/static/assets/ships/", repoRoot))
]);

const context = vm.createContext({ window: {} });
vm.runInContext(controller, context, { filename: "naturalization-nucleus.js" });
const game = context.window.CaatuuNaturalizationNucleus;
const validatedCatalog = game.validateCatalog(catalog);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

test("the course-owned controller exposes its engine boundary and stays CSP-safe", () => {
  assert.match(bootstrap, /gameAvailable\?\.\(course, "naturalization-nucleus"\) === true/u);
  assert.match(bootstrap, /naturalization-nucleus\/naturalization-nucleus\.css\?v=naturalization-nucleus-11/u);
  assert.match(bootstrap, /naturalization-nucleus\/naturalization-nucleus\.js\?v=naturalization-nucleus-11/u);
  assert.equal(typeof game.mount, "function");
  assert.equal(typeof game.createRound, "function");
  assert.equal(typeof game.filterChallengesForDifficulty, "function");
  assert.equal(typeof game.placeHanzi, "function");
  assert.equal(typeof game.countConnections, "function");
  assert.equal(typeof game.seedChain, "function");
  assert.equal(typeof game.attachPiece, "function");
  assert.equal(typeof game.describeChain, "function");
  assert.doesNotMatch(controller, /innerHTML/u);
  assert.doesNotMatch(controller, /\.style\b/u);
  assert.doesNotMatch(controller, /round-success|postMessage/u);
});

test("the expanded catalog provides three balanced cumulative levels and exactly mirrors the ship collection", () => {
  assert.equal(catalog.$schema, NUCLEUS_SCHEMA_URL);
  assert.equal(validatedCatalog.$schema, NUCLEUS_SCHEMA_URL);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.courseId, "zh");
  assert.equal(catalog.gameId, "naturalization-nucleus");
  assert.equal(catalog.status, "machine-assisted-preview");
  assert.equal(catalog.review.status, "native-review-required");
  assert.deepEqual(catalog.roundSettings.pieceCounts, [5, 9]);
  assert.equal(catalog.roundSettings.defaultPieceCount, 5);
  assert.equal(catalog.challenges.length, 120);
  assert.equal(new Set(catalog.challenges.map(({ id }) => id)).size, catalog.challenges.length);
  assert.equal(new Set(catalog.challenges.map(({ hanzi }) => hanzi)).size, catalog.challenges.length);
  assert.ok(catalog.challenges.every(({ translation }) => typeof translation === "string" && translation.length > 0));
  assert.ok(catalog.challenges.every((challenge) => Object.hasOwn(challenge, "difficulty")));
  assert.deepEqual(
    [1, 2, 3].map((difficulty) => catalog.challenges.filter((challenge) => challenge.difficulty === difficulty).length),
    [40, 40, 40]
  );
  assert.deepEqual(
    [1, 2, 3].map((difficulty) => game.filterChallengesForDifficulty(validatedCatalog.challenges, difficulty).length),
    [40, 80, 120]
  );
  assert.deepEqual(
    [1, 2, 3].map((difficulty) => new Set(
      game.filterChallengesForDifficulty(validatedCatalog.challenges, difficulty).map(game.readingKey)
    ).size),
    [39, 78, 114]
  );
  assert.ok(catalog.challenges.every(({ sourceConceptIds }) => (
    Array.isArray(sourceConceptIds)
    && sourceConceptIds.length > 0
    && new Set(sourceConceptIds).size === sourceConceptIds.length
  )));
  assert.ok(catalog.challenges.every(({ translation }) => (
    !/\b(?:weapon|gun|knife|blood|fight|attack|kill|war|violent)\b/iu.test(translation)
  )));

  const expectedShipFiles = shipFiles.filter((file) => file.endsWith(".png")).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const catalogShipFiles = catalog.roundSettings.artwork.map((src) => decodeURIComponent(src.split("/").at(-1))).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  assert.equal(expectedShipFiles.length, 28);
  assert.deepEqual(catalogShipFiles, expectedShipFiles);
});

test("the catalog boundary requires explicit schema, difficulty, and honest review metadata", () => {
  const missingSchema = structuredClone(catalog);
  delete missingSchema.$schema;
  assert.throws(() => game.validateCatalog(missingSchema), /catalog root\.\$schema is required/u);

  const wrongSchema = structuredClone(catalog);
  wrongSchema.$schema = "https://example.invalid/nucleus.json";
  assert.throws(() => game.validateCatalog(wrongSchema), /catalog root\.\$schema must be https:\/\/caatuu\.org\/schemas\/development\/naturalization-nucleus\.preview\.v1\.json/u);

  const missingDifficulty = structuredClone(catalog);
  delete missingDifficulty.challenges[0].difficulty;
  assert.throws(() => game.validateCatalog(missingDifficulty), /challenges\[0\]\.difficulty is required/u);

  const nativeReviewed = structuredClone(catalog);
  nativeReviewed.status = "native-reviewed";
  nativeReviewed.review = {
    status: "native-reviewed",
    reviewer: "Li Wei, native Mandarin educator",
    reviewedAt: "2026-09-01T12:00:00Z",
    notes: "Reviewed every pronunciation, meaning, level, citation, and child-safety decision."
  };
  assert.doesNotThrow(() => game.validateCatalog(nativeReviewed));

  const unqualifiedReviewer = structuredClone(nativeReviewed);
  unqualifiedReviewer.review.reviewer = "AI";
  assert.throws(() => game.validateCatalog(unqualifiedReviewer), /qualified human reviewer/u);

  const impossibleReviewDate = structuredClone(nativeReviewed);
  impossibleReviewDate.review.reviewedAt = "2026-02-30T12:00:00Z";
  assert.throws(() => game.validateCatalog(impossibleReviewDate), /valid ISO date-time/u);

  const cursoryReview = structuredClone(nativeReviewed);
  cursoryReview.review.notes = "Reviewed.";
  assert.throws(() => game.validateCatalog(cursoryReview), /substantively describe/u);

  const prematureReviewer = structuredClone(catalog);
  prematureReviewer.review.reviewer = "Li Wei";
  assert.throws(() => game.validateCatalog(prematureReviewer), /must remain null until native review is complete/u);

  const prematureReviewDate = structuredClone(catalog);
  prematureReviewDate.review.reviewedAt = "2026-09-01T12:00:00Z";
  assert.throws(() => game.validateCatalog(prematureReviewDate), /must remain null until native review is complete/u);
});

test("the catalog boundary normalizes and scans every learner-visible field for child safety", () => {
  const compatibilityUnsafeTitle = structuredClone(catalog);
  compatibilityUnsafeTitle.title = "ＷＥＡＰＯＮ practice";
  assert.throws(() => game.validateCatalog(compatibilityUnsafeTitle), /title contains child-inappropriate English content/u);

  const controlledInstructions = structuredClone(catalog);
  controlledInstructions.instructions += "\u202e";
  assert.throws(() => game.validateCatalog(controlledInstructions), /instructions must not contain Unicode format controls/u);

  const unsafeTranslation = structuredClone(catalog);
  unsafeTranslation.challenges[0].translation = "knife";
  assert.throws(() => game.validateCatalog(unsafeTranslation), /translation contains child-inappropriate English content/u);

  const unsafeWarTranslation = structuredClone(catalog);
  unsafeWarTranslation.challenges[0].translation = "war";
  assert.throws(() => game.validateCatalog(unsafeWarTranslation), /translation contains child-inappropriate English content/u);

  const compatibilityUnsafePoison = structuredClone(catalog);
  compatibilityUnsafePoison.title = "ＰＯＩＳＯＮ lesson";
  assert.throws(() => game.validateCatalog(compatibilityUnsafePoison), /title contains child-inappropriate English content/u);

  const unsafeHanzi = structuredClone(catalog);
  unsafeHanzi.challenges[0].hanzi = "刀";
  assert.throws(() => game.validateCatalog(unsafeHanzi), /hanzi contains a child-inappropriate standalone Hanzi/u);

  const newlyDeniedHanzi = structuredClone(catalog);
  newlyDeniedHanzi.challenges[0].hanzi = "毒";
  assert.throws(() => game.validateCatalog(newlyDeniedHanzi), /hanzi contains a child-inappropriate standalone Hanzi/u);

  const unsafeMandarinWar = structuredClone(catalog);
  unsafeMandarinWar.instructions = "学习战争。";
  assert.throws(() => game.validateCatalog(unsafeMandarinWar), /instructions contains child-inappropriate Mandarin content/u);

  const unsafeMandarinPoison = structuredClone(catalog);
  unsafeMandarinPoison.instructions = "学习中毒。";
  assert.throws(() => game.validateCatalog(unsafeMandarinPoison), /instructions contains child-inappropriate Mandarin content/u);

  const ordinaryHealthLanguage = structuredClone(catalog);
  ordinaryHealthLanguage.instructions = "Visit a clinic for an ache; ask a doctor about medicine when you are hurt.";
  assert.doesNotThrow(() => game.validateCatalog(ordinaryHealthLanguage));
});

test("isolated alternate-reading glyphs retain citation readings rather than contextual tone sandhi", () => {
  const contextualMutations = new Map([
    ["不", { pinyin: "bú", tone: 2 }],
    ["谢", { pinyin: "xie", tone: 5 }],
    ["一", { pinyin: "yí", tone: 2 }],
    ["上", { pinyin: "shang", tone: 5 }],
    ["奶", { pinyin: "nai", tone: 5 }]
  ]);

  for (const [hanzi, contextualReading] of contextualMutations) {
    const mutated = structuredClone(catalog);
    const challenge = mutated.challenges.find((entry) => entry.hanzi === hanzi);
    assert.ok(challenge, `missing alternate-reading audit challenge ${hanzi}`);
    Object.assign(challenge, contextualReading);
    assert.throws(
      () => game.validateCatalog(mutated),
      new RegExp(`must use the citation reading .+ for isolated ${hanzi}`, "u")
    );
  }
});

test("every challenge cites a Word World concept with the exact Hanzi and pinyin reading", () => {
  const guidesByConcept = new Map(readingGuides.entries.map((entry) => [entry.conceptId, entry]));
  assert.equal(guidesByConcept.size, readingGuides.entries.length);

  for (const challenge of catalog.challenges) {
    for (const sourceConceptId of challenge.sourceConceptIds) {
      const guide = guidesByConcept.get(sourceConceptId);
      assert.ok(guide, `${challenge.id} cites missing Word World concept ${sourceConceptId}.`);
      const hasExactReading = guide.tokens.some((token) => token.units.some((unit) => (
        unit.surface === challenge.hanzi
        && unit.notation.normalize("NFC") === challenge.pinyin.normalize("NFC")
      )));
      assert.ok(
        hasExactReading,
        `${challenge.id} (${challenge.hanzi} ${challenge.pinyin}) is not an exact reading unit in ${sourceConceptId}.`
      );
    }
  }
});

test("difficulty metadata is explicit, cumulative, validated, and runtime-compatible", () => {
  const leveledCatalog = structuredClone(catalog);
  leveledCatalog.challenges.forEach((challenge, index) => {
    challenge.difficulty = index < 9 ? 1 : (index < 15 ? 2 : 3);
  });
  const validated = game.validateCatalog(leveledCatalog);

  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 1).length, 9);
  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 2).length, 15);
  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 3).length, validated.challenges.length);
  assert.equal(game.filterChallengesForDifficulty(validated.challenges, 99).length, 9);

  for (const difficulty of [1, 2, 3]) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const round = game.createRound(validated, 9, seededRandom((difficulty * 100) + seed), "", difficulty);
      assert.equal(round.difficulty, difficulty);
      assert.ok(round.pieces.every(({ left, right }) => (
        left.difficulty <= difficulty && right.difficulty <= difficulty
      )));
    }
  }

  const invalidDifficulty = structuredClone(leveledCatalog);
  invalidDifficulty.challenges[0].difficulty = 4;
  assert.throws(() => game.validateCatalog(invalidDifficulty), /difficulty must be an integer from 1 to 3/u);

  const insufficientLevelOne = structuredClone(leveledCatalog);
  insufficientLevelOne.challenges.forEach((challenge) => { challenge.difficulty = 2; });
  assert.throws(() => game.validateCatalog(insufficientLevelOne), /Level 1 must provide at least 9 distinct pinyin readings/u);
});

test("generated domino decks contain one closed cycle but begin scrambled", () => {
  for (const pieceCount of [5, 9]) {
    for (let seed = 1; seed <= 24; seed += 1) {
      const round = game.createRound(validatedCatalog, pieceCount, seededRandom(seed));
      assert.equal(round.pieces.length, pieceCount);
      assert.equal(round.solution.length, pieceCount);
      assert.equal(game.countConnections(round.solution), pieceCount);
      assert.ok(game.countConnections(round.pieces) <= Math.floor(pieceCount / 3));
      assert.equal(new Set(round.pieces.map(({ left }) => game.readingKey(left))).size, pieceCount);
      assert.equal(new Set(round.pieces.map(({ right }) => game.readingKey(right))).size, pieceCount);
      for (const piece of round.pieces) assert.notEqual(game.readingKey(piece.left), game.readingKey(piece.right));

      const leftReadings = round.solution.map(({ left }) => game.readingKey(left)).sort();
      const rightReadings = round.solution.map(({ right }) => game.readingKey(right)).sort();
      assert.deepEqual(leftReadings, rightReadings);
      assert.equal(game.countConnections([...round.solution.slice(2), ...round.solution.slice(0, 2)]), pieceCount);
      assert.ok(game.countConnections([...round.solution].reverse()) < pieceCount);
    }
  }
});

test("Hanzi tiles match only their pinyin socket and complete 5/9 orbits", () => {
  for (const pieceCount of [5, 9]) {
    const round = game.createRound(validatedCatalog, pieceCount, seededRandom(30 + pieceCount));
    const targets = round.solution.map(({ left }) => left);
    let placements = Array.from({ length: pieceCount }, () => "");
    const wrongPiece = round.pieces.find(({ left }) => game.readingKey(left) !== game.readingKey(targets[0]));
    assert.equal(game.placeHanzi(placements, wrongPiece, targets, 0), null);

    for (let socketIndex = 0; socketIndex < pieceCount; socketIndex += 1) {
      const candidate = round.pieces.find(({ left }) => game.readingKey(left) === game.readingKey(targets[socketIndex]));
      const transition = game.placeHanzi(placements, candidate, targets, socketIndex);
      assert.ok(transition);
      assert.deepEqual([...transition.matchSlots], [socketIndex]);
      assert.equal(transition.matches[0].id, targets[socketIndex].id);
      assert.equal(transition.solved, socketIndex === pieceCount - 1);
      assert.equal(game.placeHanzi(transition.placements, candidate, targets, socketIndex), null);
      placements = [...transition.placements];
    }
  }
});

test("a matching pair starts a chain in either selection order", () => {
  const round = game.createRound(validatedCatalog, 5, seededRandom(41));
  const [first, second] = round.solution;
  const forward = game.seedChain(first, second, 0);
  const reverse = game.seedChain(second, first, 0);

  assert.ok(forward);
  assert.ok(reverse);
  assert.equal(forward.chain[0].id, first.id);
  assert.equal(forward.chain[1].id, second.id);
  assert.equal(reverse.chain[0].id, first.id);
  assert.equal(reverse.chain[1].id, second.id);
  assert.equal(forward.matches[0].id, second.left.id);
  assert.equal(game.seedChain(first, first, 0), null);
  assert.equal(game.seedChain(first, round.solution[3], 0), null);

  const view = game.describeChain(forward.chain, 5, forward.headSlot, false);
  assert.equal(view.matches.length, 1);
  assert.equal(view.matches[0].slot, 0);
  assert.equal(view.leftEnd.slot, 4);
  assert.equal(view.leftEnd.challenge.id, first.left.id);
  assert.equal(view.rightEnd.slot, 1);
  assert.equal(view.rightEnd.challenge.id, second.right.id);
});

test("dominoes grow from either hanging end and never create an early loop", () => {
  const round = game.createRound(validatedCatalog, 5, seededRandom(52));
  const [first, second, third, fourth, fifth] = round.solution;
  const seed = game.seedChain(first, second, 0);
  const appended = game.attachPiece(seed.chain, third, 5, seed.headSlot);
  assert.equal(appended.side, "append");
  assert.equal(appended.chain.at(-1).id, third.id);
  assert.equal(appended.matchSlots[0], 1);

  const prepended = game.attachPiece(seed.chain, fifth, 5, seed.headSlot);
  assert.equal(prepended.side, "prepend");
  assert.equal(prepended.chain[0].id, fifth.id);
  assert.equal(prepended.headSlot, 4);
  assert.equal(prepended.matchSlots[0], 4);

  assert.equal(game.attachPiece(seed.chain, fourth, 5, seed.headSlot), null);
  assert.equal(game.attachPiece(seed.chain, first, 5, seed.headSlot), null);
  assert.equal(seed.chain.length, 2);
});

test("the final domino must satisfy both ends and closes every 5/9 socket", () => {
  for (const pieceCount of [5, 9]) {
    const round = game.createRound(validatedCatalog, pieceCount, seededRandom(60 + pieceCount));
    let transition = game.seedChain(round.solution[0], round.solution[1], 0);
    for (let index = 2; index < pieceCount - 1; index += 1) {
      transition = game.attachPiece(transition.chain, round.solution[index], pieceCount, transition.headSlot);
      assert.ok(transition);
      assert.equal(transition.closed, false);
    }

    const viewBeforeClose = game.describeChain(transition.chain, pieceCount, transition.headSlot, false);
    assert.equal(viewBeforeClose.matches.length, pieceCount - 2);
    assert.ok(viewBeforeClose.leftEnd);
    assert.ok(viewBeforeClose.rightEnd);
    assert.notEqual(viewBeforeClose.leftEnd.slot, viewBeforeClose.rightEnd.slot);

    const finalPiece = round.solution.at(-1);
    const oneSidedFinalPiece = { ...finalPiece, right: round.solution[2].right };
    assert.equal(game.attachPiece(transition.chain, oneSidedFinalPiece, pieceCount, transition.headSlot), null);

    const closed = game.attachPiece(transition.chain, finalPiece, pieceCount, transition.headSlot);
    assert.ok(closed);
    assert.equal(closed.side, "close");
    assert.equal(closed.closed, true);
    assert.equal(closed.chain.length, pieceCount);
    assert.equal(closed.matches.length, 2);
    assert.equal(new Set(closed.matchSlots).size, 2);

    const solved = game.describeChain(closed.chain, pieceCount, closed.headSlot, closed.closed);
    assert.equal(solved.solved, true);
    assert.equal(solved.matches.length, pieceCount);
    assert.equal(new Set(solved.matches.map(({ slot }) => slot)).size, pieceCount);
    assert.equal(solved.leftEnd, null);
    assert.equal(solved.rightEnd, null);
    assert.equal(game.attachPiece(closed.chain, finalPiece, pieceCount, closed.headSlot), null);
  }
});

test("round generation avoids visible homophone ambiguity and immediate artwork repeats", () => {
  const duplicate = {
    ...validatedCatalog.challenges[0],
    id: "zh.hanzi.synthetic-homophone",
    hanzi: "在",
    pinyin: validatedCatalog.challenges[3].pinyin,
    tone: validatedCatalog.challenges[3].tone
  };
  const homophoneCatalog = {
    ...validatedCatalog,
    challenges: [duplicate, ...validatedCatalog.challenges]
  };
  for (let seed = 1; seed <= 16; seed += 1) {
    const previousArtwork = catalog.roundSettings.artwork[0];
    const round = game.createRound(homophoneCatalog, 9, seededRandom(seed), previousArtwork);
    assert.equal(new Set(round.pieces.map(({ left }) => game.readingKey(left))).size, 9);
    assert.notEqual(round.artworkSrc, previousArtwork);
  }

  const insufficientCatalog = {
    roundSettings: { pieceCounts: [5], artwork: [catalog.roundSettings.artwork[0]] },
    challenges: [
      validatedCatalog.challenges[0],
      validatedCatalog.challenges[1],
      validatedCatalog.challenges[2],
      validatedCatalog.challenges[3],
      duplicate
    ]
  };
  assert.throws(() => game.createRound(insufficientCatalog, 5, seededRandom(1)), /distinct readings/u);
});

test("Mandarin offline and Android delivery include the game and all ships while Czech does not", () => {
  const mandarinOffline = JSON.stringify(mandarinSetup.offline.assets);
  const czechOffline = JSON.stringify(czechSetup.offline.assets);
  for (const fragment of [
    "data/games/naturalization-nucleus/challenges.json",
    "source/games/naturalization-nucleus/naturalization-nucleus.js",
    "source/games/naturalization-nucleus/naturalization-nucleus.css",
    "/assets/planets/naturalization-nucleus.png"
  ]) {
    const pattern = new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(mandarinOffline, pattern);
    assert.doesNotMatch(czechOffline, pattern);
  }
  for (const path of [
    "data/games/naturalization-nucleus/challenges.json",
    "source/games/naturalization-nucleus/naturalization-nucleus.js",
    "source/games/naturalization-nucleus/naturalization-nucleus.css"
  ]) assert.ok(androidAssets.files.includes(path));

  for (const robotAsset of [
    "/assets/robots/keymap.json",
    "/assets/robots/robot%20(1).png"
  ]) assert.ok(mandarinSetup.offline.assets.includes(robotAsset));

  for (const src of catalog.roundSettings.artwork) {
    assert.ok(mandarinSetup.offline.assets.includes(src));
    assert.ok(!czechSetup.offline.assets.includes(src));
    const decoded = decodeURIComponent(src.replace(/^\//u, ""));
    assert.ok(appAssets.assets.some(({ source, output }) => (
      source === `apps/launcher/static/${decoded}` && output === decoded
    )));
  }
});
