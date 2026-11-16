import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildWordWorldContent } from "../build-word-world-content.mjs";
import { repositoryRoot, readRepositoryJson, modernCatalogs } from "../lib/word-world-course-content.mjs";
import { prepareLanguageRoleContent } from "../lib/language-role-contract.mjs";
import { validateEnglishConceptRuntimeProjection } from "../lib/runtime-projection-contract.mjs";

const course = await readRepositoryJson(repositoryRoot, "apps/languages/spanish/course.json");
const sourcePath = `apps/languages/${course.directoryName}/content/word-world/content.json`;
const envelope = await readRepositoryJson(repositoryRoot, sourcePath);
const runtimePath = course.publication.runtimeProjection.targetRealizationsRuntime;
const write = async (root, file, value) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
};

function candidate() {
  return {
    id: "es.word-net.999998", semanticBankId: "sb.word-net.999998",
    difficulty: 1, usefulness: 95, complexity: 20, topic: "everyday",
    englishText: "I want water.", embeddingText: "I want water.", englishAlternates: [],
    targetText: "Quiero agua.", pronunciation: null, learnerBase: null,
    sceneQuery: "I want water.", sceneAssetIds: [], annotations: {},
    tokens: [
      { surface: "Quiero", pronunciation: null, gloss: "I want", playable: true },
      { surface: "agua", pronunciation: null, gloss: "water", playable: true }
    ]
  };
}

function untranslated(item = candidate()) {
  return { ...item, reviewStatus: "untranslated", targetText: "", tokens: [] };
}

async function fixture(t, records) {
  // Disposable data fixtures only; no source checkout, service or translator.
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-publication-readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = `apps/languages/${course.directoryName}/course.json`;
  await write(root, "apps/languages/catalog.json", { courses: [{ id: course.id, manifest }] });
  await write(root, manifest, course);
  await write(root, sourcePath, { ...envelope, records });
  await write(root, course.resources.setupCatalog.path,
    await readRepositoryJson(repositoryRoot, course.resources.setupCatalog.path));
  const swPath = `apps/languages/${course.directoryName}/static/sw.js`;
  await write(root, swPath, await readFile(path.join(repositoryRoot, swPath), "utf8"));
  const publication = course.publication;
  for (const file of [publication.concepts, publication.realizations, runtimePath,
    publication.runtimeProjection.conceptsRuntime, publication.runtimeProjection.manifest]) {
    await write(root, file, { retained: "previous published bytes" });
  }
  return root;
}

test("empty publication is an explicit failure, including --check and --allow-partial", async t => {
  const root = await fixture(t, [untranslated()]);
  const before = await readFile(path.join(root, runtimePath), "utf8");
  for (const options of [{}, { check: true }, { allowPartial: true }]) {
    await assert.rejects(buildWordWorldContent({ root, courseId: "es", ...options }), /no playable records.*not synchronized/u);
  }
  assert.equal(await readFile(path.join(root, runtimePath), "utf8"), before);
});

test("partial publication requires an explicit choice and counts only playable records", async t => {
  const pending = untranslated({ ...candidate(), id: "es.word-net.999999", semanticBankId: "sb.word-net.999999" });
  const root = await fixture(t, [pending, candidate()]);
  const before = await readFile(path.join(root, runtimePath), "utf8");
  await assert.rejects(buildWordWorldContent({ root, courseId: "es" }), /1 playable and 1 untranslated.*--allow-partial/u);
  assert.equal(await readFile(path.join(root, runtimePath), "utf8"), before);
  const options = { root, courseId: "es", allowPartial: true };
  const preview = await buildWordWorldContent({ ...options, check: true });
  assert.equal(preview.recordCount, 1);
  assert.equal(preview.courses[0].sourceRecordCount, 2);
  assert.equal(preview.courses[0].untranslatedCount, 1);
  assert.equal(await readFile(path.join(root, runtimePath), "utf8"), before, "--check must not publish");
  await buildWordWorldContent(options);
  const output = JSON.parse(await readFile(path.join(root, runtimePath), "utf8"));
  assert.deepEqual(output.realizations.map(item => [item.conceptId, item.text]), [[candidate().id, "Quiero agua."]]);
  assert.deepEqual((await buildWordWorldContent({ ...options, check: true })).changes, []);
  // Demoting the last record must not falsely report that the old runtime was withdrawn.
  await write(root, sourcePath, { ...envelope, records: [pending, untranslated()] });
  await assert.rejects(buildWordWorldContent(options), /explicit catalog withdrawal/u);
});

test("the modern compatibility CLI requires explicit partial selection and keeps --check read-only", async t => {
  const pending = untranslated({ ...candidate(), id: "es.word-net.999999", semanticBankId: "sb.word-net.999999" });
  const root = await fixture(t, [pending, candidate()]);
  const before = await readFile(path.join(root, runtimePath), "utf8");
  const cli = fileURLToPath(new URL("../project-word-world-runtime.mjs", import.meta.url));
  const args = [cli, "--course", "es", "--repo-root", root, "--check"];
  const blocked = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /1 playable and 1 untranslated.*--allow-partial/u);
  const allowed = spawnSync(process.execPath, [...args, "--allow-partial"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(allowed.status, 1, allowed.stderr);
  assert.match(allowed.stdout, /Drift \(es\):/u);
  assert.equal(await readFile(path.join(root, runtimePath), "utf8"), before, "compatibility --check must not publish");
});

test("a completed pilot projects the modern token shape and preserves grades and bank identity", async t => {
  const record = candidate();
  const source = modernCatalogs({...envelope, records:[record]}, course);
  const prepared = prepareLanguageRoleContent(source.concepts, source.realizations, {sourceLanguage:'en'});
  assert.equal(prepared.records[0].semanticBankId, record.semanticBankId);
  const root = await fixture(t, [record]);
  await buildWordWorldContent({ root, courseId: "es" });
  const concepts = JSON.parse(await readFile(path.join(root, course.publication.runtimeProjection.conceptsRuntime), "utf8"));
  const output = JSON.parse(await readFile(path.join(root, runtimePath), "utf8"));
  assert.equal(concepts.concepts[0].semanticBankId, record.semanticBankId);
  validateEnglishConceptRuntimeProjection(concepts);
  const invalid = structuredClone(concepts);
  invalid.concepts[0].semanticBankId = "sb.memory-moon.999998";
  assert.throws(() => validateEnglishConceptRuntimeProjection(invalid), /semanticBankId/u);
  for (const key of ["id", "englishText", "embeddingText", "difficulty", "usefulness", "complexity"]) {
    assert.equal(concepts.concepts[0][key], record[key], key);
  }
  assert.deepEqual(output.realizations[0].tokens, record.tokens.map(({ pronunciation, ...token }) => token));
});

test("invalid hints and the Czech token shape cannot publish through the modern provider", async t => {
  const root = await fixture(t, [candidate()]);
  const before = await readFile(path.join(root, runtimePath), "utf8");
  for (const mutate of [
    item => { item.semanticBankId = "sb.verb-lab.999998"; },
    item => { item.tokens[0].gloss = null; },
    item => { item.tokens[0].normalized = "quiero"; item.tokens[0].tokenIndex = 0; }
  ]) {
    const record = candidate();
    mutate(record);
    await write(root, sourcePath, { ...envelope, records: [record] });
    await assert.rejects(buildWordWorldContent({ root, courseId: "es" }));
    assert.equal(await readFile(path.join(root, runtimePath), "utf8"), before);
  }
});

test("existing modern records do not require a semantic bank reference", async t => {
  const record = candidate();
  delete record.semanticBankId;
  const root = await fixture(t, [record]);
  await buildWordWorldContent({ root, courseId: "es" });
  assert.deepEqual((await buildWordWorldContent({ root, courseId: "es", check: true })).changes, []);
});
