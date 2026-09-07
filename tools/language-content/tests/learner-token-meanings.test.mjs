import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { learnerTokenMeanings } from "../../../apps/language-runtime/static/source/learner-base-token-meanings.mjs";
import { prepareLanguageRoleContent, prepareEnglishRankingPayload } from "../lib/language-role-contract.mjs";
import { buildLearnerBaseRuntimeProjection, validateLearnerBaseRuntimeProjection } from "../lib/language-role-runtime.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const course = await readJson("../../../apps/languages/english-from-spanish/course.json");
const [concepts, targets, learnerBase] = await Promise.all([
  readJson(`../../../${course.publication.concepts}`),
  readJson(`../../../${course.publication.realizations}`),
  readJson(`../../../${course.publication.learnerBaseRealizations}`)
]);

test("Spanish word meanings retain their own role when the English target equals the audit language", () => {
  const prepared = prepareLanguageRoleContent(concepts, targets, {
    sourceLanguage: "es-ES",
    learnerBaseRealizations: learnerBase
  });
  const book = prepared.records.find(({ conceptId }) => conceptId === "ww.object.book");
  assert.equal(book.target.text, book.audit.text);
  assert.equal(book.learnerPrompt.languageTag, "es-ES");
  assert.notEqual(book.learnerPrompt.text, book.audit.text);
  const bookIndex = book.target.tokens.findIndex(({ surface }) => surface === "book");
  assert.equal(book.target.tokens[bookIndex].gloss, "book");
  assert.equal(book.learnerTokenMeanings.find(({ tokenIndex }) => tokenIndex === bookIndex).text, "libro");
  const payload = prepareEnglishRankingPayload(prepared, "book");
  assert.equal(payload.inputLanguage, "en");
  assert.deepEqual(Object.keys(payload.candidates[0]), ["conceptId", "embeddingText"]);
  assert.doesNotMatch(JSON.stringify(payload), /tokenMeanings|learnerPrompt|libro/u);
  for (const record of prepared.records) {
    record.target.tokens.forEach((token, tokenIndex) => {
      if (token.playable !== false) assert.ok(record.learnerTokenMeanings.some((meaning) => (
        meaning.tokenIndex === tokenIndex && meaning.surface === token.surface && meaning.text.trim()
      )), `${record.conceptId} token ${tokenIndex} needs an explicit Spanish meaning`);
    });
  }
});

test("base token meanings bind target locale, position and exact authored surface", () => {
  const realization = {
    conceptId: "ww.object.book",
    text: "Esto es un libro.",
    tokenMeanings: [
      { targetLanguage: "en-US", tokenIndex: 0, surface: "book", text: "libro" },
      { targetLanguage: "zh-Hans", tokenIndex: 0, surface: "书", text: "libro" }
    ]
  };
  assert.equal(learnerTokenMeanings({ conceptId: realization.conceptId, text: realization.text }), null);
  assert.deepEqual(learnerTokenMeanings(realization, {
    targetLanguage: "en-US", targetTokens: [{ surface: "book" }]
  }), [realization.tokenMeanings[0]]);
  assert.throws(() => learnerTokenMeanings(realization, {
    targetLanguage: "en-US", targetTokens: [{ surface: "books" }]
  }), /does not match/u);
  for (const tokenMeanings of [
    [],
    [realization.tokenMeanings[0], realization.tokenMeanings[0]],
    [{ ...realization.tokenMeanings[0], tokenIndex: -1 }],
    [{ ...realization.tokenMeanings[0], targetLanguage: "en-us" }],
    [{ ...realization.tokenMeanings[0], text: " " }],
    [{ ...realization.tokenMeanings[0], englishAuditText: "book" }]
  ]) assert.throws(() => learnerTokenMeanings({ ...realization, tokenMeanings }));
});

test("Spanish word meanings survive the narrow base runtime projection and detect tampering", () => {
  const projection = buildLearnerBaseRuntimeProjection(concepts, learnerBase, {
    derivedFrom: "apps/languages/shared/learner-base-realizations/es-ES/word-world-starter-v1.json"
  });
  assert.deepEqual(projection.realizations, learnerBase.realizations);
  assert.doesNotMatch(JSON.stringify(projection), /embeddingText|englishAuditText/u);
  const tampered = structuredClone(projection);
  tampered.realizations[0].tokenMeanings[0].text = "unrelated";
  assert.throws(() => validateLearnerBaseRuntimeProjection(tampered, { source: learnerBase }), /faithful/u);
});
