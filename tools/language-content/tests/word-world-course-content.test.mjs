import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadWordWorldCourses, loadWordWorldContent, wordWorldContentPath, validateWordWorldContent,
  modernCatalogs, czechRuntimeRecords, validateSharedEnglishMeanings, readRepositoryJson, repositoryRoot } from "../lib/word-world-course-content.mjs";
import { buildWordWorldContent } from "../build-word-world-content.mjs";

const courses = await loadWordWorldCourses();
const loaded = await Promise.all(courses.map(async entry => ({ ...entry, ...await loadWordWorldContent(entry.course) })));
const spanish = loaded.find(entry => entry.course.id === "es");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const writeJson = async (root, file, value) => {
  const destination = path.join(root, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(value));
};

test("every course uses the same single-file record format and preserves its language roles", () => {
  const keys = Object.keys(loaded[0].document.records[0]).sort();
  for (const { course, document, sourcePath } of loaded) {
    assert.equal(sourcePath, wordWorldContentPath(course));
    for (const record of document.records) assert.deepEqual(Object.keys(record).sort(), keys);
    assert.equal(validateWordWorldContent(document, course), document);
    if (course.publication.contract === "language-content-v1") {
      const split = modernCatalogs(document, course);
      assert.deepEqual(split.concepts.concepts.map(item => item.id), document.records.map(item => item.id));
      assert.deepEqual(split.realizations.realizations.map(item => item.text), document.records.map(item => item.targetText));
    }
  }
  validateSharedEnglishMeanings(loaded.map(entry => entry.document));
});

test("Czech contextual hints and all runtime fields come from its single JSON", async () => {
  const { course, document } = loaded.find(entry => entry.course.id === "cz");
  const rubric = await readRepositoryJson(repositoryRoot, "tools/czech-ml/data/word-world/standard-v0.1/rubric.json");
  const expected = await readRepositoryJson(repositoryRoot, `${course.resources.staticRoot.path}/data/games/word-world/content.json`);
  assert.deepEqual(czechRuntimeRecords(document, rubric).runtime, expected.records);
  const candidate = structuredClone(document);
  const record = candidate.records.find(item => item.tokens.some(token => token.playable));
  const token = record.tokens.find(item => item.playable);
  token.gloss = "synthetic contextual hint";
  const changed = czechRuntimeRecords(candidate, rubric).runtime.find(item => item.id === record.id);
  assert.equal(changed.targets.find(item => item.tokenIndex === token.tokenIndex).gloss, token.gloss);
});

async function fixture(t) {
  // Content-only fixtures; no application checkout or preview service is copied.
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-word-world-content-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeJson(root, "apps/languages/catalog.json", { courses: loaded.map(entry => ({ id: entry.course.id, manifest: entry.manifestPath })) });
  for (const entry of loaded) {
    await writeJson(root, entry.manifestPath, entry.course);
    await writeJson(root, entry.sourcePath, entry.document);
  }
  const publication = spanish.course.publication;
  await writeJson(root, spanish.course.resources.setupCatalog.path,
    await readRepositoryJson(repositoryRoot, spanish.course.resources.setupCatalog.path));
  const swPath = `apps/languages/${spanish.course.directoryName}/static/sw.js`;
  await writeFile(path.join(root, swPath), await readFile(path.join(repositoryRoot, swPath)));
  for (const file of [publication.concepts, publication.realizations, publication.runtimeProjection.conceptsRuntime,
    publication.runtimeProjection.targetRealizationsRuntime, publication.runtimeProjection.manifest]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  }
  return root;
}

test("one course expands from its own JSON even when old generated inputs are stale", async t => {
  const root = await fixture(t);
  const document = structuredClone(spanish.document);
  const added = { ...structuredClone(document.records[0]), id: "ww.fixture.bird-water", topic: "animals",
    englishText: "The bird drinks water.", embeddingText: "A bird drinking water.", sceneQuery: "a bird drinking water",
    targetText: "El pájaro bebe agua.", tokens: [
      { surface: "El", pronunciation: null, gloss: "the", playable: false },
      { surface: "pájaro", pronunciation: null, gloss: "bird", playable: true },
      { surface: "bebe", pronunciation: null, gloss: "drinks", playable: true },
      { surface: "agua", pronunciation: null, gloss: "water", playable: true }
    ] };
  document.records.push(added);
  await writeJson(root, spanish.sourcePath, document);
  await writeJson(root, spanish.course.publication.realizations, { stale: "must never be an authoring input" });
  const report = await buildWordWorldContent({ root, courseId: "es" });
  assert.equal(report.courses.length, 1);
  assert.equal(report.recordCount, document.records.length);
  const target = await json(path.join(root, spanish.course.publication.runtimeProjection.targetRealizationsRuntime));
  const english = await json(path.join(root, spanish.course.publication.runtimeProjection.conceptsRuntime));
  assert.deepEqual(target.realizations.at(-1).tokens, added.tokens.map(({ pronunciation, ...token }) => token));
  assert.equal(target.realizations.at(-1).text, added.targetText);
  assert.equal(english.concepts.at(-1).embeddingText, added.embeddingText);
  for (const other of loaded.filter(entry => entry.course.id !== "es")) {
    assert.deepEqual(await json(path.join(root, other.sourcePath)), other.document);
  }
  assert.deepEqual((await buildWordWorldContent({ root, courseId: "es", check: true })).changes, []);
});

test("invalid JSON is rejected before any generated output is changed", async t => {
  const root = await fixture(t);
  const document = structuredClone(spanish.document);
  document.records.push(structuredClone(document.records[0]));
  await writeJson(root, spanish.sourcePath, document);
  const output = spanish.course.publication.realizations;
  await writeJson(root, output, { unchanged: true });
  await assert.rejects(buildWordWorldContent({ root, courseId: "es" }), /Duplicate Word World ID/u);
  assert.deepEqual(await json(path.join(root, output)), { unchanged: true });
});

test("reused IDs preserve English meaning without requiring matching course inventories", () => {
  const first = structuredClone(spanish.document), second = structuredClone(first);
  second.courseId = "fixture";
  second.records = second.records.slice(0, 1);
  assert.doesNotThrow(() => validateSharedEnglishMeanings([first, second]));
  second.records[0].englishText = "A different meaning.";
  assert.throws(() => validateSharedEnglishMeanings([first, second]), /conflicting English meaning/u);
});

test("course mismatches, unknown fields and source symlinks cannot select other content", async t => {
  const document = structuredClone(spanish.document);
  document.records[0].unexpected = true;
  assert.throws(() => validateWordWorldContent(document, spanish.course), /unexpected or missing fields/u);
  delete document.records[0].unexpected;
  document.courseId = "zh";
  assert.throws(() => validateWordWorldContent(document, spanish.course), /course mismatch/u);
  const root = await fixture(t);
  const source = path.join(root, spanish.sourcePath), redirect = `${source}.redirect`;
  await writeFile(redirect, JSON.stringify(spanish.document));
  await rm(source);
  await symlink(redirect, source);
  await assert.rejects(loadWordWorldContent(spanish.course, { root }), /noncanonical source/u);
});
