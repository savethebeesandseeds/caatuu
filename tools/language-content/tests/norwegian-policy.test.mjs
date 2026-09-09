import assert from "node:assert/strict";
import test from "node:test";

import { LanguageContentError, validateLanguageContent } from "../lib/content-contract.mjs";
import { buildWordWorldRuntimeProjections } from "../project-word-world-runtime.mjs";
import { resolveTargetContentPolicy } from "../policies/registry.mjs";
import { NORWEGIAN_BOKMAL_CONTENT_POLICY_ID, norwegianBokmalContentPolicy } from "../policies/norwegian-bokmal.mjs";
import { resolveWordWorldProjectionPolicy } from "../word-world-projection/registry.mjs";
import { NORWEGIAN_BOKMAL_WORD_WORLD_PATHS, norwegianBokmalWordWorldProjectionPolicy } from "../word-world-projection/norwegian-bokmal.mjs";

function fixture() {
  const license = { origin: "synthetic-test-fixture", status: "release-review-required",
    spdxExpression: null, sourceReference: null, reviewedBy: null, reviewedAt: null };
  const concepts = {
    $schema: "https://caatuu.org/schemas/english-concepts.v1.schema.json", schemaVersion: 1,
    id: "word-world-nb-v1", language: "en",
    embeddingPolicy: { inputLanguage: "en", inputField: "embeddingText", targetTextAllowed: false },
    license: structuredClone(license),
    concepts: [{ id: "ww.fixture.seal", englishText: "The seal swims.",
      embeddingText: "A seal moving through clear water.", sceneQuery: "seal swimming in water",
      topic: "animals", difficulty: 1 }]
  };
  const realizations = {
    $schema: "https://caatuu.org/schemas/target-realizations.v1.schema.json", schemaVersion: 1,
    courseId: "nb", targetLanguage: { languageTag: "nb-NO", speechLocale: "nb-NO", script: "Latn" },
    sourceCatalog: NORWEGIAN_BOKMAL_WORD_WORLD_PATHS.conceptsSource,
    contentPolicy: NORWEGIAN_BOKMAL_CONTENT_POLICY_ID,
    tokenization: { method: "authored-word-tokens", characterFallbackAllowed: false,
      pronunciationAuthority: "authored-contextual-token" },
    review: { status: "native-review-required", reviewer: null, reviewedAt: null,
      notes: "Synthetic policy fixture; not reviewed curriculum." },
    license: structuredClone(license),
    realizations: [{ conceptId: "ww.fixture.seal", text: "Selen svømmer.", pronunciation: null,
      tokens: [
        { surface: "Selen", pronunciation: null, gloss: "the seal", playable: true },
        { surface: "svømmer", pronunciation: null, gloss: "swims", playable: true }
      ] }]
  };
  return { concepts, realizations };
}

function issue(mutate, code) {
  const { concepts, realizations } = fixture();
  mutate(realizations);
  assert.throws(() => validateLanguageContent(concepts, realizations), error => (
    error instanceof LanguageContentError && error.issues.some(item => item.code === code)
  ));
}

test("Bokmål policy is registered and preserves authored Norwegian letters and pending review", () => {
  const { concepts, realizations } = fixture();
  assert.equal(resolveTargetContentPolicy(NORWEGIAN_BOKMAL_CONTENT_POLICY_ID), norwegianBokmalContentPolicy);
  assert.equal(validateLanguageContent(concepts, realizations).realizations.realizations[0].text, "Selen svømmer.");
  for (const text of ["Ærlig", "Ørn", "Åpen", "Blåbær"]) {
    const draft = fixture().realizations;
    draft.realizations[0].text = text + ".";
    draft.realizations[0].tokens = [{ surface: text, pronunciation: null, gloss: "fixture", playable: true }];
    assert.deepEqual(norwegianBokmalContentPolicy.validate(draft), []);
  }
  assert.throws(() => validateLanguageContent(concepts, realizations, { release: true }), error => (
    error instanceof LanguageContentError && error.issues.some(item => item.code === "release.license")
  ));
});

test("Bokmål policy rejects cross-course, Nynorsk, generic Norwegian, and script drift", () => {
  issue(value => { value.courseId = "nn"; }, "norwegian.course");
  for (const tag of ["nn-NO", "no-NO", "nb"]) {
    issue(value => { value.targetLanguage.languageTag = tag; }, "norwegian.locale");
  }
  issue(value => { value.targetLanguage.speechLocale = "nn-NO"; }, "norwegian.locale");
  issue(value => { value.targetLanguage.script = "Cyrl"; }, "norwegian.locale");
  issue(value => {
    value.realizations[0].text = "Ж svømmer.";
    value.realizations[0].tokens[0].surface = "Ж";
  }, "norwegian.script");
  issue(value => {
    value.realizations[0].text = "Selen\u200e svømmer.";
    value.realizations[0].tokens[0].surface = "Selen\u200e";
  }, "norwegian.format-control");
});

test("Bokmål requires complete authored tokens and does not approve invented pronunciation", () => {
  issue(value => { value.tokenization.method = "implicit-words"; }, "norwegian.tokenization");
  issue(value => { value.tokenization.characterFallbackAllowed = true; }, "norwegian.tokenization");
  issue(value => { value.realizations[0].tokens[0].gloss = "seal\u200e"; }, "norwegian.format-control");
  const pronunciation = { system: "ipa", notation: "s", languageTag: "nb-NO", reviewed: false };
  issue(value => { value.realizations[0].pronunciation = pronunciation; }, "norwegian.pronunciation");
  issue(value => { value.realizations[0].tokens[0].pronunciation = pronunciation; }, "norwegian.pronunciation");
  issue(value => { value.realizations[0].tokens[0].readingUnits = [{ surface: "Selen", pronunciation: null }]; }, "norwegian.reading-units");
});

test("Bokmål projections bind exact content paths without changing English retrieval or review", () => {
  const { concepts, realizations } = fixture();
  const policy = norwegianBokmalWordWorldProjectionPolicy;
  assert.equal(resolveWordWorldProjectionPolicy(NORWEGIAN_BOKMAL_CONTENT_POLICY_ID), policy);
  const manifest = policy.buildManifest({ concepts, realizations, paths: NORWEGIAN_BOKMAL_WORD_WORLD_PATHS });
  const projected = buildWordWorldRuntimeProjections(concepts, realizations, manifest);
  assert.deepEqual(Object.keys(projected), ["englishProjection", "targetProjection", "runtimeManifest"]);
  assert.equal(projected.runtimeManifest.targetLanguage, "nb-NO");
  assert.equal(projected.runtimeManifest.sourceConceptCatalog, "/language-runtime/static/data/english-concepts/word-world-nb-v1.json");
  assert.equal(projected.runtimeManifest.realizationFile, "content.json");
  assert.equal(projected.runtimeManifest.embeddingPolicy.inputLanguage, "en");
  assert.equal(projected.runtimeManifest.embeddingPolicy.targetTextAllowed, false);
  assert.deepEqual(projected.runtimeManifest.license, realizations.license);
  assert.equal(projected.runtimeManifest.review.pronunciationApproved, false);
  assert.equal(projected.targetProjection.projectionPolicy.pronunciationIncluded, false);
  assert.doesNotMatch(JSON.stringify(projected.targetProjection), /"pronunciation"/u);
  assert.equal(Object.hasOwn(projected.runtimeManifest, "targetTextGuide"), false);
  for (const field of ["targetLanguage", "realizationFile", "sourceConceptCatalog"]) {
    const bad = structuredClone(manifest);
    bad[field] = "wrong";
    assert.throws(() => buildWordWorldRuntimeProjections(concepts, realizations, bad), /manifest authority differs/u);
  }
  const approved = structuredClone(manifest);
  approved.review.pronunciationApproved = true;
  assert.throws(() => buildWordWorldRuntimeProjections(concepts, realizations, approved), /manifest authority differs/u);
});
