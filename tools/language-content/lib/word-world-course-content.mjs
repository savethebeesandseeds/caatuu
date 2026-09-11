import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLanguageRoleContent } from "./language-role-contract.mjs";
import { validateRecords, toRuntimeRecord } from "../../czech-ml/scripts/word-world-standard-lib.mjs";
import { normalizeContentProgression } from "../../../apps/language-runtime/static/source/games/content-progression.mjs";

export const WORD_WORLD_COURSE_SCHEMA = "caatuu-word-world-course-content-v1";
export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fields = ["id", "difficulty", "usefulness", "complexity", "topic", "englishText", "embeddingText", "englishAlternates",
  "targetText", "pronunciation", "tokens", "learnerBase", "sceneQuery", "sceneAssetIds", "annotations"];

export function wordWorldContentPath(course) {
  assert.match(course.directoryName, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  return `apps/languages/${course.directoryName}/content/word-world/content.json`;
}

export async function readRepositoryJson(root, relativePath) {
  assert.ok(typeof relativePath === "string" && relativePath && !relativePath.includes("\\")
    && !path.posix.isAbsolute(relativePath) && path.posix.normalize(relativePath) === relativePath
    && !relativePath.split("/").some(part => part === ".." || part === "."), "Expected a confined repository path");
  const realRoot = await realpath(root);
  const expected = path.resolve(realRoot, relativePath);
  assert.equal(await realpath(path.resolve(root, relativePath)), expected, `${relativePath}: noncanonical source`);
  return JSON.parse(await readFile(expected, "utf8"));
}

export async function loadWordWorldCourses({ root = repositoryRoot, catalogPath = "apps/languages/catalog.json" } = {}) {
  const catalog = await readRepositoryJson(root, catalogPath);
  return Promise.all(catalog.courses.map(async item => {
    const course = await readRepositoryJson(root, item.manifest);
    assert.equal(course.id, item.id);
    return { course, manifestPath: item.manifest, sourcePath: wordWorldContentPath(course) };
  }));
}

export async function loadWordWorldContent(course, { root = repositoryRoot } = {}) {
  const sourcePath = wordWorldContentPath(course);
  const document = await readRepositoryJson(root, sourcePath);
  validateWordWorldContent(document, course);
  return { document, sourcePath };
}

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: unexpected or missing fields`);
}

function text(value, label) {
  assert.ok(typeof value === "string" && value.trim() && value === value.trim()
    && value === value.normalize("NFC") && !/[<>\p{Cc}\p{Cf}]/u.test(value), `${label}: expected normalized plain text`);
}

export function validateWordWorldContent(document, course) {
  exactKeys(document, ["schemaVersion", "courseId", "sourceLanguage", "targetLanguage", "metadata", "records"], "Word World content");
  assert.equal(document.schemaVersion, WORD_WORLD_COURSE_SCHEMA);
  assert.equal(document.courseId, course.id, "Word World course mismatch");
  assert.equal(document.sourceLanguage, course.sourceLanguage.locale);
  assert.equal(document.targetLanguage, course.targetLanguage.locale);
  assert.ok(document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata));
  assert.ok(Array.isArray(document.records) && document.records.length, "Word World needs records");
  const ids = new Set();
  for (const item of document.records) {
    exactKeys(item, fields, `Word World ${item?.id}`);
    text(item.id, "Record ID");
    assert.ok(!ids.has(item.id), `Duplicate Word World ID ${item.id}`);
    ids.add(item.id);
    assert.ok([1, 2, 3].includes(item.difficulty), `${item.id}: difficulty must be 1, 2 or 3`);
    normalizeContentProgression(item, item.id);
    for (const key of ["topic", "englishText", "embeddingText", "targetText", "sceneQuery"]) text(item[key], `${item.id}.${key}`);
    assert.ok(Array.isArray(item.englishAlternates) && Array.isArray(item.sceneAssetIds) && Array.isArray(item.tokens), `${item.id}: invalid lists`);
    item.englishAlternates.forEach(value => text(value, `${item.id}.englishAlternates`));
    assert.ok(item.annotations && typeof item.annotations === "object" && !Array.isArray(item.annotations));
    if (document.sourceLanguage.startsWith("en")) assert.equal(item.learnerBase, null, "English learner text comes from englishText");
    else {
      exactKeys(item.learnerBase, ["text", "tokenMeanings"], `${item.id}.learnerBase`);
      text(item.learnerBase.text, `${item.id}.learnerBase.text`);
      assert.ok(Array.isArray(item.learnerBase.tokenMeanings));
    }
  }
  if (course.publication.contract === "language-content-v1") {
    const { concepts, realizations, learnerBase } = modernCatalogs(document, course);
    prepareLanguageRoleContent(concepts, realizations, { sourceLanguage: document.sourceLanguage, learnerBaseRealizations: learnerBase });
  } else {
    assert.equal(course.id, "cz", "Unsupported legacy Word World projection");
    czechAuthoringRecords(document);
  }
  return document;
}

// Reconstruct the existing validated publication contracts in memory. The
// compatibility JSON files written from these objects are generated outputs.
export function modernCatalogs(document, course) {
  const { english, target, learnerBase: baseMetadata } = document.metadata;
  assert.ok(english && target, "Missing publication review/licensing metadata");
  const concepts = { ...structuredClone(english), concepts: document.records.map(item => {
    assert.equal(item.englishAlternates.length, 0, `${item.id}: this provider has no alternate-English field`);
    assert.equal(item.sceneAssetIds.length, 0, `${item.id}: this provider uses embedding image retrieval`);
    assert.equal(Object.keys(item.annotations).length, 0, `${item.id}: unsupported extra annotations`);
    return { id: item.id, englishText: item.englishText, embeddingText: item.embeddingText,
      sceneQuery: item.sceneQuery, topic: item.topic, difficulty: item.difficulty,
      ...normalizeContentProgression(item, item.id) };
  }) };
  const realizations = { ...structuredClone(target), sourceCatalog: course.publication.concepts,
    realizations: document.records.map(item => ({ conceptId: item.id, text: item.targetText,
      pronunciation: structuredClone(item.pronunciation), tokens: structuredClone(item.tokens) })) };
  const learnerBase = baseMetadata ? { ...structuredClone(baseMetadata), sourceCatalog: course.publication.concepts,
    realizations: document.records.map(item => ({ conceptId: item.id, ...structuredClone(item.learnerBase) })) } : null;
  assert.equal(Boolean(learnerBase), Boolean(course.publication.learnerBaseRealizations));
  return { concepts, realizations, learnerBase };
}

export function czechAuthoringRecords(document) {
  return document.records.map(item => {
    assert.equal(item.embeddingText, item.englishText, `${item.id}: the Czech provider ranks the included English sentence`);
    assert.equal(item.pronunciation, null, `${item.id}: Czech standard speech uses the sentence text`);
    exactKeys(item.annotations, ["cefr", "learning", "grammar", "provenance", "review"], `${item.id}.annotations`);
    return {
      schemaVersion: "caatuu-word-world-record-v1", id: item.id,
      languages: { en: { text: item.englishText, alternates: [...item.englishAlternates] }, cs: { text: item.targetText } },
      difficulty: item.difficulty, cefr: item.annotations.cefr, topic: item.topic,
      targets: item.tokens.map(token => {
        exactKeys(token, ["surface", "normalized", "tokenIndex", "playable", "gloss"], `${item.id}.token`);
        if (token.gloss !== null) text(token.gloss, `${item.id}.token.gloss`);
        const { gloss, ...target } = token;
        return target;
      }),
      learning: structuredClone(item.annotations.learning), grammar: structuredClone(item.annotations.grammar),
      scene: { query: item.sceneQuery, assetIds: [...item.sceneAssetIds] },
      provenance: structuredClone(item.annotations.provenance), review: structuredClone(item.annotations.review)
    };
  });
}

export function czechRuntimeRecords(document, rubric) {
  const authoring = czechAuthoringRecords(document);
  const validation = validateRecords(authoring, rubric);
  assert.ok(validation.valid, validation.errors.join("\n"));
  const runtime = authoring.map((record, index) => {
    const output = toRuntimeRecord(record);
    Object.assign(output, normalizeContentProgression(document.records[index], record.id));
    output.targets.forEach((target, tokenIndex) => {
      const gloss = document.records[index].tokens[tokenIndex].gloss;
      if (gloss !== null) target.gloss = gloss;
    });
    return output;
  });
  return { authoring, runtime, validation };
}

// Reusing a concept ID preserves its English meaning, but does not require
// other courses to contain the same set of IDs or the same difficulty.
export function validateSharedEnglishMeanings(documents) {
  const meanings = new Map();
  for (const document of documents) for (const item of document.records) {
    const value = [item.englishText, item.embeddingText];
    if (meanings.has(item.id)) assert.deepEqual(value, meanings.get(item.id), `${item.id}: conflicting English meaning across courses`);
    else meanings.set(item.id, value);
  }
}
