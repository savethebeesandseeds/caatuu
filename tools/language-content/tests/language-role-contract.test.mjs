import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LEARNER_BASE_REALIZATIONS_SCHEMA,
  LanguageRoleError,
  loadAndPrepareLanguageRoleContent,
  prepareEnglishRankingPayload,
  prepareLanguageRoleContent,
  validateLearnerBaseRealizations
} from "../lib/language-role-contract.mjs";
import {
  LEARNER_BASE_RUNTIME_SCHEMA,
  buildLearnerBaseRuntimeProjection,
  validateLearnerBaseRuntimeProjection
} from "../lib/language-role-runtime.mjs";
import { rankConcepts } from "../../../apps/language-runtime/static/source/catalog-runtime.mjs";

const repositoryRootUrl = new URL("../../../", import.meta.url);
const repositoryRoot = fileURLToPath(repositoryRootUrl);
const conceptsPath = "apps/languages/shared/english-concepts/word-world-starter-v1.json";
const targetsPath =
  "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json";
const [fullConcepts, fullTargets] = await Promise.all([
  readJson(conceptsPath),
  readJson(targetsPath)
]);

function syntheticCatalogs() {
  const concept = structuredClone(
    fullConcepts.concepts.find(({ id }) => id === "ww.object.book")
  );
  const target = structuredClone(
    fullTargets.realizations.find(({ conceptId }) => conceptId === concept.id)
  );
  const concepts = {
    ...structuredClone(fullConcepts),
    concepts: [concept]
  };
  const targets = {
    ...structuredClone(fullTargets),
    realizations: [target]
  };
  const learnerBase = {
    $schema: LEARNER_BASE_REALIZATIONS_SCHEMA,
    schemaVersion: 1,
    id: "synthetic-french-word-world-v1",
    baseLanguage: {
      languageTag: "fr",
      script: "Latn"
    },
    sourceCatalog: conceptsPath,
    review: {
      status: "native-reviewed",
      reviewer: "Synthetic Test Reviewer",
      reviewedAt: "2026-09-03T00:00:00Z",
      notes: "Synthetic architecture fixture only; not distributable language content."
    },
    license: structuredClone(fullConcepts.license),
    realizations: [{
      conceptId: concept.id,
      text: "Ceci est un livre."
    }]
  };
  return { concepts, targets, learnerBase };
}

test("the learner-base authoring and runtime schemas are target-neutral", async () => {
  const [authoringSchema, runtimeSchema] = await Promise.all([
    readJson("tools/language-packs/schemas/learner-base-realizations.v1.schema.json"),
    readJson("tools/language-packs/schemas/learner-base-realizations.runtime.v1.schema.json")
  ]);
  assert.equal(authoringSchema.$id, LEARNER_BASE_REALIZATIONS_SCHEMA);
  assert.equal(runtimeSchema.$id, LEARNER_BASE_RUNTIME_SCHEMA);
  assert.doesNotMatch(
    JSON.stringify({ authoringSchema, runtimeSchema }),
    /Mandarin|Chinese|pinyin|zh-Hans|Arabic|French target/u
  );
  assert.equal(authoringSchema.additionalProperties, false);
  assert.equal(runtimeSchema.additionalProperties, false);
});

test("English audit, non-English learner prompt, and target realization remain distinct", () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  const prepared = prepareLanguageRoleContent(concepts, targets, {
    sourceLanguage: { locale: "fr", label: "French" },
    learnerBaseRealizations: learnerBase
  });
  const [record] = prepared.records;

  assert.deepEqual(prepared.roles, {
    auditLanguage: "en",
    retrievalLanguage: "en",
    learnerBaseLanguage: "fr",
    targetLanguage: "zh-Hans"
  });
  assert.equal(record.audit.text, "This is a book.");
  assert.equal(record.learnerPrompt.text, "Ceci est un livre.");
  assert.equal(record.learnerPrompt.authority, "learner-base-realization");
  assert.equal(record.target.text, "这是一本书。");
  assert.notEqual(record.audit.text, record.learnerPrompt.text);
  assert.notEqual(record.learnerPrompt.text, record.target.text);
});

test("English-authority ranking cannot receive learner prompts or target text", async () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  const prepared = prepareLanguageRoleContent(concepts, targets, {
    sourceLanguage: "fr",
    learnerBaseRealizations: learnerBase
  });
  const explicitPayload = prepareEnglishRankingPayload(prepared, "nearby object book");
  assert.deepEqual(Object.keys(explicitPayload), ["inputLanguage", "query", "candidates"]);
  assert.equal(explicitPayload.inputLanguage, "en");
  assert.deepEqual(Object.keys(explicitPayload.candidates[0]), ["conceptId", "embeddingText"]);

  let rankerPayload;
  const ranked = await rankConcepts(prepared.records, "book", async (payload) => {
    rankerPayload = payload;
    return payload.candidates.map(({ conceptId }) => ({ conceptId, score: 1 }));
  });
  assert.equal(ranked[0].conceptId, "ww.object.book");
  for (const payload of [explicitPayload, rankerPayload]) {
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /Ceci est un livre/u);
    assert.doesNotMatch(serialized, /\p{Script=Han}/u);
    assert.doesNotMatch(serialized, /learnerPrompt|target|englishText/u);
  }
  assert.throws(
    () => prepareEnglishRankingPayload(prepared, "où est le livre"),
    /English-authority retrieval query/u
  );
  assert.throws(
    () => prepareEnglishRankingPayload(prepared, "书"),
    /English-authority retrieval query/u
  );
});

test("non-English bases fail closed without exact reviewed concept-ID coverage", () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  assert.throws(
    () => prepareLanguageRoleContent(concepts, targets, { sourceLanguage: "fr" }),
    (error) => hasIssue(error, "base.required")
  );

  const wrongLanguage = structuredClone(learnerBase);
  wrongLanguage.baseLanguage.languageTag = "de";
  assert.throws(
    () => prepareLanguageRoleContent(concepts, targets, {
      sourceLanguage: "fr",
      learnerBaseRealizations: wrongLanguage
    }),
    (error) => hasIssue(error, "base.language-mismatch")
  );

  const missing = structuredClone(learnerBase);
  missing.realizations = [];
  assert.throws(
    () => validateLearnerBaseRealizations(concepts, missing),
    (error) => hasIssue(error, "base.shape") && hasIssue(error, "base.coverage-missing")
  );

  const pending = structuredClone(learnerBase);
  pending.review = {
    status: "native-review-required",
    reviewer: null,
    reviewedAt: null,
    notes: "Synthetic pending review."
  };
  assert.throws(
    () => validateLearnerBaseRealizations(concepts, pending, { requireNativeReview: true }),
    (error) => hasIssue(error, "base.activation-native-review")
  );
});

test("learner-base scripts must match canonical language-tag maximization", () => {
  const { concepts, learnerBase } = syntheticCatalogs();

  assert.doesNotThrow(() => validateLearnerBaseRealizations(concepts, learnerBase));

  const ordinaryTag = structuredClone(learnerBase);
  ordinaryTag.baseLanguage = { languageTag: "es-ES", script: "Latn" };
  assert.doesNotThrow(() => validateLearnerBaseRealizations(concepts, ordinaryTag));

  const wrongOrdinaryScript = structuredClone(ordinaryTag);
  wrongOrdinaryScript.baseLanguage.script = "Cyrl";
  assert.throws(
    () => validateLearnerBaseRealizations(concepts, wrongOrdinaryScript),
    (error) => hasIssue(error, "base.language")
      && /maximized script Latn for es-ES/u.test(error.message)
  );

  const explicitScript = structuredClone(learnerBase);
  explicitScript.baseLanguage = { languageTag: "sr-Cyrl", script: "Cyrl" };
  assert.doesNotThrow(() => validateLearnerBaseRealizations(concepts, explicitScript));

  const wrongExplicitScript = structuredClone(explicitScript);
  wrongExplicitScript.baseLanguage.script = "Latn";
  assert.throws(
    () => validateLearnerBaseRealizations(concepts, wrongExplicitScript),
    (error) => hasIssue(error, "base.language")
      && /maximized script Cyrl for sr-Cyrl/u.test(error.message)
  );

  const runtimeProjection = buildLearnerBaseRuntimeProjection(concepts, ordinaryTag, {
    derivedFrom: "apps/languages/shared/learner-base-realizations/es/word-world-starter-v1.json"
  });
  assert.doesNotThrow(() => validateLearnerBaseRuntimeProjection(runtimeProjection));

  const wrongRuntimeScript = structuredClone(runtimeProjection);
  wrongRuntimeScript.baseLanguage.script = "Cyrl";
  assert.throws(
    () => validateLearnerBaseRuntimeProjection(wrongRuntimeScript),
    /maximized script Latn for es-ES/u
  );
});

test("English-base courses derive prompts directly and reject a duplicate overlay", () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  const prepared = prepareLanguageRoleContent(concepts, targets, {
    sourceLanguage: { locale: "en", label: "English" }
  });
  assert.equal(prepared.records[0].learnerPrompt.text, "This is a book.");
  assert.equal(prepared.records[0].learnerPrompt.authority, "english-concept");
  assert.equal(prepared.learnerBaseRealizations, null);
  assert.throws(
    () => prepareLanguageRoleContent(concepts, targets, {
      sourceLanguage: "en",
      learnerBaseRealizations: learnerBase
    }),
    (error) => hasIssue(error, "base.redundant")
  );
});

test("the public learner-base projection is narrow, faithful, and tamper-evident", () => {
  const { concepts, learnerBase } = syntheticCatalogs();
  const derivedFrom =
    "apps/languages/shared/learner-base-realizations/fr/word-world-starter-v1.json";
  const projection = buildLearnerBaseRuntimeProjection(concepts, learnerBase, { derivedFrom });
  assert.equal(projection.$schema, LEARNER_BASE_RUNTIME_SCHEMA);
  assert.deepEqual(Object.keys(projection.realizations[0]), ["conceptId", "text"]);
  assert.doesNotMatch(JSON.stringify(projection), /embeddingText|Mandarin|这是/u);

  const tampered = structuredClone(projection);
  tampered.realizations[0].text = "Texte modifié.";
  assert.throws(
    () => validateLearnerBaseRuntimeProjection(tampered, {
      source: learnerBase,
      expectedDerivedFrom: derivedFrom
    }),
    /faithful/u
  );
});

test("the three-role loader keeps each authority on its own path", async () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-language-roles-"));
  const basePath =
    "apps/languages/shared/learner-base-realizations/fr/word-world-starter-v1.json";
  try {
    for (const [relativePath, value] of [
      [conceptsPath, concepts],
      [targetsPath, targets],
      [basePath, learnerBase]
    ]) {
      const file = path.join(temporaryRoot, ...relativePath.split("/"));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
    const prepared = await loadAndPrepareLanguageRoleContent({
      repoRoot: temporaryRoot,
      conceptsPath,
      targetRealizationsPath: targetsPath,
      learnerBaseRealizationsPath: basePath,
      sourceLanguage: "fr"
    });
    assert.equal(prepared.paths.concepts, conceptsPath);
    assert.equal(prepared.paths.targetRealizations, targetsPath);
    assert.equal(prepared.paths.learnerBaseRealizations, basePath);
    assert.equal(prepared.records[0].learnerPrompt.text, "Ceci est un livre.");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the three-role loader rejects a catalog symlink outside its role authority", async () => {
  const { concepts, targets } = syntheticCatalogs();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-language-role-link-"));
  try {
    const conceptFile = path.join(temporaryRoot, ...conceptsPath.split("/"));
    const targetFile = path.join(temporaryRoot, ...targetsPath.split("/"));
    const outsideFile = path.join(temporaryRoot, "outside", "targets.json");
    await mkdir(path.dirname(conceptFile), { recursive: true });
    await mkdir(path.dirname(targetFile), { recursive: true });
    await mkdir(path.dirname(outsideFile), { recursive: true });
    await writeFile(conceptFile, JSON.stringify(concepts), "utf8");
    await writeFile(outsideFile, JSON.stringify(targets), "utf8");
    await symlink(outsideFile, targetFile, "file");

    await assert.rejects(
      loadAndPrepareLanguageRoleContent({
        repoRoot: temporaryRoot,
        conceptsPath,
        targetRealizationsPath: targetsPath,
        sourceLanguage: "en"
      }),
      /resolves outside its declared language-content authority root/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the three-role loader rejects a target authority symlink to a broader in-repository directory", async () => {
  const { concepts, targets } = syntheticCatalogs();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-target-authority-link-"));
  try {
    await writeJson(temporaryRoot, conceptsPath, concepts);
    const broaderRoot = path.join(temporaryRoot, "broader-target-content");
    await writeJson(broaderRoot, "word-world/starter-v1.realizations.json", targets);
    const languageRoot = path.join(temporaryRoot, "apps/languages/mandarin-simplified");
    await mkdir(languageRoot, { recursive: true });
    await symlink(broaderRoot, path.join(languageRoot, "content"), "dir");

    await assert.rejects(
      loadAndPrepareLanguageRoleContent({
        repoRoot: temporaryRoot,
        conceptsPath,
        targetRealizationsPath: targetsPath,
        sourceLanguage: "en"
      }),
      /outside its declared language-content authority root/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the three-role loader rejects a learner-base authority symlink to a broader in-repository directory", async () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-base-authority-link-"));
  const basePath =
    "apps/languages/shared/learner-base-realizations/fr/word-world-starter-v1.json";
  try {
    await writeJson(temporaryRoot, conceptsPath, concepts);
    await writeJson(temporaryRoot, targetsPath, targets);
    const broaderRoot = path.join(temporaryRoot, "broader-base-content");
    await writeJson(broaderRoot, "fr/word-world-starter-v1.json", learnerBase);
    const sharedRoot = path.join(temporaryRoot, "apps/languages/shared");
    await mkdir(sharedRoot, { recursive: true });
    await symlink(
      broaderRoot,
      path.join(sharedRoot, "learner-base-realizations"),
      "dir"
    );

    await assert.rejects(
      loadAndPrepareLanguageRoleContent({
        repoRoot: temporaryRoot,
        conceptsPath,
        targetRealizationsPath: targetsPath,
        learnerBaseRealizationsPath: basePath,
        sourceLanguage: "fr"
      }),
      /outside its declared language-content authority root/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the three-role loader accepts a symlinked workspace root without widening role authorities", async () => {
  const { concepts, targets, learnerBase } = syntheticCatalogs();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-role-root-alias-"));
  const realRoot = path.join(temporaryRoot, "real-workspace");
  const aliasRoot = path.join(temporaryRoot, "workspace-alias");
  const basePath =
    "apps/languages/shared/learner-base-realizations/fr/word-world-starter-v1.json";
  try {
    await writeJson(realRoot, conceptsPath, concepts);
    await writeJson(realRoot, targetsPath, targets);
    await writeJson(realRoot, basePath, learnerBase);
    await symlink(realRoot, aliasRoot, "dir");
    const prepared = await loadAndPrepareLanguageRoleContent({
      repoRoot: aliasRoot,
      conceptsPath,
      targetRealizationsPath: targetsPath,
      learnerBaseRealizationsPath: basePath,
      sourceLanguage: "fr"
    });
    assert.equal(prepared.records[0].learnerPrompt.text, "Ceci est un livre.");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function hasIssue(error, code) {
  return error instanceof LanguageRoleError
    && error.issues.some((issue) => issue.code === code);
}

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, ...relativePath.split("/")), "utf8")
  );
}

async function writeJson(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
