import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateConjugationCometCatalog } from "../../../language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import { validatePlanetEnglishAuditDocument } from "../../../../tools/language-content/lib/planet-english-audit.mjs";

const catalogUrl = new URL(
  "../static/data/games/conjugation-comet/verbs.json",
  import.meta.url
);

async function rawCatalog() {
  return JSON.parse(await readFile(catalogUrl, "utf8"));
}

test("the Spanish Conjugation Comet pilot is a finite es-ES authored catalog", async () => {
  const raw = await rawCatalog();
  const catalog = validateConjugationCometCatalog(raw, {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  });
  assert.equal(catalog.targetLocale, "es-ES");
  assert.equal(catalog.variety.id, "es-ES");
  assert.equal(catalog.review.status, "native-review-required");
  assert.deepEqual(catalog.license, {
    origin: "first-party-authored",
    status: "release-review-required",
    spdx: null,
    noteEnglish: "First-party development curriculum. Release is blocked until the project assigns and records the approved curriculum license."
  });
  assert.deepEqual(catalog.authority, {
    kind: "authored-finite-catalog",
    dictionaryLookup: false,
    runtimeGeneration: false,
    englishAuditRequired: true
  });
  assert.equal(catalog.verbs.length, 11);
  assert.equal(catalog.verbs.reduce((total, verb) => total + verb.forms.length, 0), 66);
});

test("the Spanish pilot covers the bounded recommended present-tense families", async () => {
  const catalog = validateConjugationCometCatalog(await rawCatalog(), {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  });
  const lemmas = new Set(catalog.verbs.map((verb) => verb.targetText));
  for (const required of [
    "hablar",
    "comer",
    "vivir",
    "ser",
    "estar",
    "ir",
    "tener",
    "haber",
    "querer",
    "pedir",
    "levantarse"
  ]) assert.ok(lemmas.has(required), required);

  assert.ok(catalog.verbs.some((verb) => verb.tags.includes("regular-ar")));
  assert.ok(catalog.verbs.some((verb) => verb.tags.includes("regular-er")));
  assert.ok(catalog.verbs.some((verb) => verb.tags.includes("regular-ir")));
  assert.ok(catalog.verbs.some((verb) => verb.tags.includes("stem-change-e-ie")));
  assert.ok(catalog.verbs.some((verb) => verb.tags.includes("stem-change-e-i")));
  assert.ok(catalog.verbs.some((verb) => verb.tags.includes("reflexive")));
  for (const verb of catalog.verbs) {
    assert.equal(verb.forms.length, 6, verb.targetText);
    assert.ok(verb.forms.some((form) => form.subjectTargetText.includes("vosotros")), verb.targetText);
  }
});

test("learner-base cues and independent English audit text are complete", async () => {
  const raw = await rawCatalog();
  assert.equal(raw.learnerBaseLanguageId, "en");
  assert.equal(raw.auditLanguageId, "en");
  for (const verb of raw.verbs) {
    assert.equal(verb.learnerBaseText, verb.englishAuditText, verb.id);
    for (const form of verb.forms) {
      assert.equal(form.learnerBaseCueText, form.englishAuditText, `${verb.id}.${form.id}`);
    }
  }
  assert.deepEqual(validatePlanetEnglishAuditDocument(
    "conjugation-comet-items-v1",
    raw,
    { location: "spanish-conjugation", sourceLanguageId: "en" }
  ), []);

  const missingAudit = structuredClone(raw);
  delete missingAudit.verbs[0].forms[0].englishAuditText;
  assert.throws(() => validateConjugationCometCatalog(missingAudit, {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  }), /englishAuditText/u);
});

test("Spanish review and license gates cannot be bypassed by descriptive metadata", async () => {
  const raw = await rawCatalog();
  const missingLicense = structuredClone(raw);
  delete missingLicense.license;
  assert.throws(() => validateConjugationCometCatalog(missingLicense, {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  }), /review, license, and authority metadata/u);

  const unclearedSpdx = structuredClone(raw);
  unclearedSpdx.license.spdx = "AGPL-3.0-only";
  assert.throws(() => validateConjugationCometCatalog(unclearedSpdx, {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  }), /must keep license\.spdx null/u);

  const unboundedReviewState = structuredClone(raw);
  unboundedReviewState.review.status = "probably-reviewed";
  assert.throws(() => validateConjugationCometCatalog(unboundedReviewState, {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  }), /unsupported state/u);
});
