import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../languages/czech/static/", import.meta.url);
const [app, indexHtml, comet, cometHtml, wordWorld, wordWorldHtml, verbs] = await Promise.all([
  readFile(new URL("source/games/verb-nebula/app.js", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("conjugation-comet.html", staticRoot), "utf8"),
  readFile(new URL("source/games/word-world/word-net.js", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("data/games/conjugation-comet/verbs.json", staticRoot), "utf8").then(JSON.parse)
]);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source boundary must exist`);
  return source.slice(start, end);
}

test("the retired Guided URL mode cannot replace either stable game", () => {
  assert.match(functionSource(app, "explicitLocalGuidedRequest", "verbMeaningExerciseFamilyConfiguration"), /return false/);
  assert.match(functionSource(wordWorld, "explicitLocalGuidedRequest", "guidedJourneyStep"), /return false/);
  assert.doesNotMatch(indexHtml, /curriculum-service/);
  assert.doesNotMatch(wordWorldHtml, /curriculum-service/);
  assert.doesNotMatch(cometHtml, /curriculum-service/);
});

test("Verb Nebula remains the ordinary meaning-match game", () => {
  assert.match(app, /loadJsonBytes\("data\/games\/verb-nebula\/core-vocabulary\.json"\)/);
  assert.match(app, /verbNebulaCore\.dealVerbRound/);
  assert.match(app, /verbNebulaCore\.verbPairMatches/);
  assert.match(app, /CaatuuLearning\?\.record\("verb-nebula"/);
  assert.match(app, /function recordVerbSemanticAttempt/);
  assert.doesNotMatch(indexHtml, /id="verbMorphologyBoard"/);
});

test("Word World keeps curated Standard content and honest semantic exposure", () => {
  assert.match(wordWorld, /loadStandardWordWorldCorpus/);
  assert.match(wordWorld, /function recordStandardSemanticExposure/);
  assert.match(wordWorld, /outcome: "exposure"/);
  assert.match(wordWorld, /score: null/);
  assert.match(wordWorld, /masteryWeight: 0/);
  assert.match(wordWorld, /CaatuuLearning\?\.record\("word-world"/);
});

test("Conjugation Comet owns morphology and reads the complete verb dataset", () => {
  assert.match(comet, /const VERBS_URL = "data\/games\/conjugation-comet\/verbs\.json"/);
  assert.match(comet, /state\.phase = "meaning"/);
  assert.match(comet, /state\.phase = "forms"/);
  assert.match(comet, /CaatuuLearning\?\.record\?\.\("conjugation-comet"/);
  assert.doesNotMatch(comet, /CaatuuCurriculum|curriculum\//);
  assert.ok(verbs.length > 1, "Comet must not be pinned to a one-verb pilot");
});

test("progress reset still drains active game work before clearing totals", () => {
  assert.match(app, /registerProgressResetPreparation\?\.\(prepareVerbProgressReset\)/);
  assert.match(app, /async function prepareVerbProgressReset[\s\S]*?lifecycle\?\.abort\?\.\(\)/);
  assert.match(wordWorld, /registerProgressResetPreparation\?\.\(prepareGuidedWordProgressReset\)/);
  assert.match(wordWorld, /async function prepareGuidedWordProgressReset[\s\S]*?lifecycle\.abort\(\)/);
});
