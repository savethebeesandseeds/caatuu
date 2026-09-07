import assert from "node:assert/strict";
import test from "node:test";
import { buildSoundQuasarRound, validateSoundQuasarCatalog } from "../static/source/games/sound-quasar/sound-quasar-core.mjs";

function spanishToEnglish() {
  const words = [["water", "agua"], ["bread", "pan"], ["cat", "gato"], ["house", "casa"]];
  return {
    schemaVersion: 1,
    gameId: "sound-quasar",
    courseId: "es-en",
    targetLanguageId: "en",
    learnerBaseLanguage: "es-ES",
    auditLanguage: "en",
    id: "english-listening-v1",
    contentRevision: "english-listening-1",
    mode: "practice",
    audio: { kind: "device-speech", locale: "en-US", reviewStatus: "unreviewed", purpose: "listening-practice" },
    provenance: {
      sourcePath: "apps/languages/english-from-spanish/static/data/games/verb-nebula/content.json",
      sourceItemIds: words.map(([word]) => word),
      selection: "Finite authored vocabulary for a language-role regression."
    },
    items: words.map(([target, meaning]) => ({
      id: target, revision: "word-1", target, meaning, englishAuditText: target,
      sourceId: target, sourceReviewStatus: "native-review-required"
    }))
  };
}

const expected = { courseId: "es-en", targetLanguageId: "en", learnerBaseLanguage: "es-ES" };

test("Spanish listening meanings stay separate from English speech and audit authority", () => {
  const catalog = validateSoundQuasarCatalog(spanishToEnglish(), expected);
  const round = buildSoundQuasarRound(catalog, { random: () => 0 });
  assert.equal(catalog.learnerBaseLanguage, "es-ES");
  assert.equal(catalog.audio.locale, "en-US");
  assert.equal(catalog.auditLanguage, "en");
  const answer = catalog.items.find(({ id }) => id === round.answerId);
  assert.equal(round.target, answer.target);
  assert.equal(round.meaning, answer.meaning);
  assert.notEqual(round.meaning, answer.englishAuditText);
  assert.equal(Object.hasOwn(round, "englishAuditText"), false);
  assert.ok(round.choices.every((choice) => !Object.hasOwn(choice, "englishAuditText")));
});

test("listening rejects absent or mismatched learner-base identity and changed audit language", () => {
  for (const mutate of [
    (catalog) => { delete catalog.learnerBaseLanguage; },
    (catalog) => { catalog.learnerBaseLanguage = "fr-FR"; },
    (catalog) => { catalog.learnerBaseLanguage = "es-es"; },
    (catalog) => { delete catalog.auditLanguage; },
    (catalog) => { catalog.auditLanguage = "es"; }
  ]) {
    const catalog = spanishToEnglish();
    mutate(catalog);
    assert.throws(() => validateSoundQuasarCatalog(catalog, expected), /learner.?base|auditLanguage/iu);
  }
});
