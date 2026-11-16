import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { REPORTING_COURSE_CATALOG } from "../src/course-catalog.mjs";
import { buildReportingCourseCatalog, reportingCourseCatalogSource } from "../tooling/course-catalog.mjs";
import { REPORTING_POLICY_V2, DICTIONARY_GAP_SCHEMA_V2, SENTENCE_REPORT_SCHEMA_V2,
  validateDictionaryGapV2, validateSentenceReportV2, canonicalSentencePayloadV2 } from "../src/contracts-v2.mjs";
import { handleRequest } from "../src/index.mjs";

const sentence = course => ({ schema: SENTENCE_REPORT_SCHEMA_V2,
  courseId: course.courseId, sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage,
  clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a", sentence: "q\u0301 العربية עברית čeština",
  translation: "A sentence.", reason: "unnatural_target_language", comment: "", entryId: "fixture",
  contentMode: "authored", corpusVersion: "fixture-v1" });

test("generated reporting authority exactly follows enabled course locale/provider declarations", () => {
  const built = buildReportingCourseCatalog();
  assert.deepEqual(REPORTING_COURSE_CATALOG, built);
  assert.equal(readFileSync(new URL("../src/course-catalog.mjs", import.meta.url), "utf8"), reportingCourseCatalogSource(built));
  const course = JSON.parse(readFileSync(new URL("../../languages/czech/course.json", import.meta.url), "utf8"));
  const alias = { ...course, id: "ordinary" };
  const aliased = buildReportingCourseCatalog({ courses: [alias] }).courses[0];
  assert.deepEqual(aliased, { ...built.courses.find(entry => entry.courseId === course.id), courseId: "ordinary" });
  const disabled = structuredClone(alias);
  disabled.platforms.browser.pagesEnabled = false;
  assert.deepEqual(buildReportingCourseCatalog({ courses: [disabled] }).courses, []);
  assert.throws(() => buildReportingCourseCatalog({ courses: [alias, alias] }), /Duplicate reporting course/u);
  const invalidProvider = structuredClone(alias);
  invalidProvider.resources.dictionaryProvider.gapReporting.dictionaryKey = "not-in-catalog";
  assert.throws(() => buildReportingCourseCatalog({ courses: [invalidProvider] }), /active catalog entry/u);
});

test("v2 sentence reports accept every declared course and preserve legitimate combining marks", () => {
  for (const course of REPORTING_COURSE_CATALOG.courses) {
    const report = sentence(course);
    assert.deepEqual(validateSentenceReportV2(report), report);
    assert.equal(validateSentenceReportV2({ ...report, sentence: "first\nsecond\tthird" }).sentence, "first second third");
    for (const patch of [{ courseId: "unknown" }, { sourceLanguage: "zz" }, { targetLanguage: "zz" },
      { sentence: "bad\u0000text" }, { sentence: "x".repeat(361) }, { reason: "unnatural_czech" }, { device: "unexpected" }]) {
      assert.equal(validateSentenceReportV2({ ...report, ...patch }), null);
    }
  }
  const [first, second] = REPORTING_COURSE_CATALOG.courses;
  assert.notEqual(canonicalSentencePayloadV2(sentence(first)), canonicalSentencePayloadV2(sentence(second)));
});

test("v2 dictionary reports bind the exact declared tuple and use the target locale for normalization", () => {
  const course = REPORTING_COURSE_CATALOG.courses.find(course => course.dictionary);
  const report = { schema: DICTIONARY_GAP_SCHEMA_V2, courseId: course.courseId,
    sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage, ...course.dictionary,
    targetWord: "Příklad", normalizedWord: "příklad", lookupOutcome: "no_results", lookupReturned: 0 };
  assert.deepEqual(validateDictionaryGapV2(report), report);
  for (const patch of [{ providerId: "wrong" }, { dictionaryKey: "wrong" }, { dictionaryDirection: "es-en" },
    { targetLanguage: "cs" }, { courseId: "es" }, { lookupReturned: "0" }, { lookupReturned: 1 }]) {
    assert.equal(validateDictionaryGapV2({ ...report, ...patch }), null);
  }
  const turkish = { courseId: "another", sourceLanguage: "en", targetLanguage: "tr-TR", sentenceReports: true,
    dictionary: { providerId: "another-provider", dictionaryKey: "dataset", dictionaryDirection: "tr-en" } };
  const adapted = { ...report, courseId: turkish.courseId, sourceLanguage: turkish.sourceLanguage,
    targetLanguage: turkish.targetLanguage, ...turkish.dictionary, targetWord: "I", normalizedWord: "ı" };
  assert.deepEqual(validateDictionaryGapV2(adapted, { schemaVersion: 2, courses: [turkish] }), adapted);
});

test("v2 dictionary normalization restores NFC after locale casing reorders combining marks", () => {
  const course = REPORTING_COURSE_CATALOG.courses.find(course => course.dictionary);
  const report = { schema: DICTIONARY_GAP_SCHEMA_V2, courseId: course.courseId,
    sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage, ...course.dictionary,
    targetWord: "\u0130\u0327", normalizedWord: "i\u0327\u0307", lookupOutcome: "no_results", lookupReturned: 0 };
  assert.notEqual(report.targetWord.toLocaleLowerCase(course.targetLanguage), report.normalizedWord);
  assert.deepEqual(validateDictionaryGapV2(report), report);
  assert.equal(validateDictionaryGapV2({ ...report, normalizedWord: "i" }), null);
});

test("v2 rollout policy is checked before reading bodies or touching storage", async () => {
  for (const route of ["/api/v2/sentence-reports", "/api/v2/dictionary-gaps"]) {
    const request = new Request(`https://caatuu.waajacu.com${route}`, { method: "POST",
      headers: { "content-type": "application/json", "x-caatuu-reporting-policy": "2026-09-02.v1" }, body: "not-json" });
    Object.defineProperty(request, "body", { get() { throw new Error("body must not be read"); } });
    const response = await handleRequest(request, { DB: { prepare() { throw new Error("storage must not be touched"); } } });
    assert.equal(response.status, 428);
  }
  const legacy = new Request("https://caatuu.waajacu.com/api/sentence-reports", { method: "POST",
    headers: { "content-type": "application/json", "x-caatuu-reporting-policy": REPORTING_POLICY_V2 }, body: "{}" });
  assert.equal((await handleRequest(legacy, {})).status, 428);
});

test("v2 SQLite migration, concurrent idempotency, retention and course capacity are enforced", () => {
  const result = spawnSync(process.execPath, ["--experimental-sqlite", fileURLToPath(new URL("./fixtures/sqlite-storage-v2.mjs", import.meta.url))],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});
