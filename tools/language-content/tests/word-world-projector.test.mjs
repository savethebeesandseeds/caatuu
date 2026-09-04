import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  WORD_WORLD_PATHS,
  buildWordWorldRuntimeProjections,
  projectWordWorldRuntime
} from "../project-word-world-runtime.mjs";
import { defineWordWorldProjectionPolicy } from "../word-world-projection/contract.mjs";

const repositoryRootUrl = new URL("../../../", import.meta.url);
const repositoryRoot = fileURLToPath(repositoryRootUrl);

async function readJson(relativePath, root = repositoryRoot) {
  return JSON.parse(await readFile(path.join(root, ...relativePath.split("/")), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function markPronunciationReviewed(realizations) {
  realizations.review = {
    status: "native-reviewed",
    reviewer: "Projector Test Reviewer",
    reviewedAt: "2026-09-01T00:00:00Z",
    notes: "Synthetic test evidence only."
  };
  for (const realization of realizations.realizations) {
    realization.pronunciation.reviewed = true;
    for (const token of realization.tokens) {
      token.pronunciation.reviewed = true;
      for (const unit of token.readingUnits) unit.pronunciation.reviewed = true;
    }
  }
}

test("the Word World projector is deterministic and derives every guide unit from authoring", async () => {
  const [concepts, realizations, manifest] = await Promise.all([
    readJson(WORD_WORLD_PATHS.conceptsSource),
    readJson(WORD_WORLD_PATHS.realizationsSource),
    readJson(WORD_WORLD_PATHS.manifest)
  ]);
  const first = buildWordWorldRuntimeProjections(clone(concepts), clone(realizations), clone(manifest));
  const second = buildWordWorldRuntimeProjections(clone(concepts), clone(realizations), clone(manifest));
  assert.deepEqual(first, second);
  assert.equal(first.runtimeManifest.recordCount, 250);
  assert.equal(first.readingGuideProjection.entries.length, 250);

  first.readingGuideProjection.entries.forEach((entry, realizationIndex) => {
    const source = realizations.realizations[realizationIndex];
    assert.equal(entry.conceptId, source.conceptId);
    entry.tokens.forEach((token, tokenIndex) => {
      assert.deepEqual(
        token.units,
        source.tokens[tokenIndex].readingUnits.map((unit) => ({
          surface: unit.surface,
          notation: unit.pronunciation.notation
        }))
      );
    });
  });
});

test("the Word World projector rejects manifest tampering and premature review claims", async () => {
  const [concepts, realizations, manifest] = await Promise.all([
    readJson(WORD_WORLD_PATHS.conceptsSource),
    readJson(WORD_WORLD_PATHS.realizationsSource),
    readJson(WORD_WORLD_PATHS.manifest)
  ]);

  for (const mutate of [
    (candidate) => { candidate.sourceConceptCatalog = "/different/concepts.json"; },
    (candidate) => { candidate.realizationFile = "different.realizations.json"; },
    (candidate) => { candidate.targetTextGuide.file = "different.reading-guides.json"; },
    (candidate) => { candidate.schemaVersion = "tampered-manifest-v9"; },
    (candidate) => { candidate.license.status = "release-review-required"; },
    (candidate) => { candidate.unexpectedReleaseClaim = true; }
  ]) {
    const wrongManifest = clone(manifest);
    mutate(wrongManifest);
    assert.throws(
      () => buildWordWorldRuntimeProjections(clone(concepts), clone(realizations), wrongManifest),
      /manifest authority differs/u
    );
  }

  const reviewedRealizations = clone(realizations);
  markPronunciationReviewed(reviewedRealizations);
  assert.throws(
    () => buildWordWorldRuntimeProjections(clone(concepts), reviewedRealizations, clone(manifest)),
    /supports native-review-required sources only/u
  );
});

test("the shared projector accepts a target-neutral policy and non-English base projection", async () => {
  const [allConcepts, allRealizations] = await Promise.all([
    readJson(WORD_WORLD_PATHS.conceptsSource),
    readJson(WORD_WORLD_PATHS.realizationsSource)
  ]);
  const concept = clone(allConcepts.concepts.find(({ id }) => id === "ww.object.book"));
  const target = clone(
    allRealizations.realizations.find(({ conceptId }) => conceptId === concept.id)
  );
  const concepts = { ...clone(allConcepts), concepts: [concept] };
  const realizations = { ...clone(allRealizations), realizations: [target] };
  realizations.sourceCatalog =
    "apps/languages/shared/english-concepts/word-world-starter-v1.json";
  const learnerBaseRealizations = {
    $schema: "https://caatuu.org/schemas/learner-base-realizations.v1.schema.json",
    schemaVersion: 1,
    id: "synthetic-french-word-world-v1",
    baseLanguage: { languageTag: "fr", script: "Latn" },
    sourceCatalog: realizations.sourceCatalog,
    review: {
      status: "native-reviewed",
      reviewer: "Synthetic Projector Test Reviewer",
      reviewedAt: "2026-09-03T00:00:00Z",
      notes: "Synthetic architecture fixture only; not distributable language content."
    },
    license: clone(concepts.license),
    realizations: [{ conceptId: concept.id, text: "Ceci est un livre." }]
  };
  const buildManifest = ({
    concepts: sourceConcepts,
    realizations: targetRealizations,
    paths
  }) => ({
    schemaVersion: "synthetic-word-world-manifest-v1",
    courseId: targetRealizations.courseId,
    recordCount: sourceConcepts.concepts.length,
    targetLanguage: targetRealizations.targetLanguage.languageTag,
    mediationLanguage: "en",
    sourceConceptCatalog: path.posix.relative(
      path.posix.dirname(paths.manifest),
      paths.conceptsRuntime
    ),
    realizationFile: path.posix.relative(
      path.posix.dirname(paths.manifest),
      paths.realizationsRuntime
    ),
    embeddingPolicy: {
      inputLanguage: "en",
      inputField: "embeddingText",
      targetTextAllowed: false
    }
  });
  let validationContext;
  const neutralPolicy = defineWordWorldProjectionPolicy({
    id: "synthetic-target-neutral-v1",
    contentPolicyId: realizations.contentPolicy,
    defaultPaths: {
      conceptsSource: "apps/languages/shared/english-concepts/word-world-starter-v1.json",
      realizationsSource:
        "apps/languages/synthetic/content/word-world/starter-v1.realizations.json",
      conceptsRuntime:
        "apps/language-runtime/static/data/english-concepts/synthetic-word-world-v1.json",
      realizationsRuntime:
        "apps/languages/synthetic/static/data/games/word-world/starter-v1.realizations.json",
      learnerBaseSource:
        "apps/languages/shared/learner-base-realizations/fr/synthetic-word-world-v1.json",
      learnerBaseRuntime:
        "apps/languages/synthetic/static/data/games/word-world/french-base.runtime.json",
      manifest: "apps/languages/synthetic/static/data/games/word-world/manifest.json"
    },
    supplementalOutputs: {},
    manifestBindings: {
      englishProjection: {
        field: "sourceConceptCatalog",
        reference: "manifest-relative"
      },
      targetProjection: {
        field: "realizationFile",
        reference: "manifest-relative"
      },
      learnerBaseProjection: {
        field: "learnerBaseFile",
        reference: "manifest-relative",
        optional: true
      }
    },
    targetProjectionPolicy() {
      return {
        pronunciationIncluded: false,
        reason: "Synthetic policy deliberately exposes no pronunciation aid."
      };
    },
    projectSupplemental() {
      return {};
    },
    buildManifest,
    validate(context) {
      validationContext = context;
    }
  });
  const manifest = {
    ...buildManifest({
      concepts,
      realizations,
      paths: neutralPolicy.defaultPaths
    }),
    learnerBaseLanguage: "fr",
    learnerBaseFile: path.posix.relative(
      path.posix.dirname(neutralPolicy.defaultPaths.manifest),
      neutralPolicy.defaultPaths.learnerBaseRuntime
    )
  };
  const projected = buildWordWorldRuntimeProjections(
    clone(concepts),
    clone(realizations),
    manifest,
    {
      projectionPolicy: neutralPolicy,
      sourceLanguage: "fr",
      learnerBaseRealizations: clone(learnerBaseRealizations)
    }
  );

  assert.deepEqual(Object.keys(projected), [
    "englishProjection",
    "targetProjection",
    "learnerBaseProjection",
    "runtimeManifest"
  ]);
  assert.equal(projected.targetProjection.projectionPolicy.pronunciationIncluded, false);
  assert.equal(projected.learnerBaseProjection.realizations[0].text, "Ceci est un livre.");
  assert.equal(validationContext.supplementalProjections.readingGuideProjection, undefined);
  assert.equal(projected.runtimeManifest.mediationLanguage, "en");
  assert.equal(projected.runtimeManifest.learnerBaseLanguage, "fr");

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-non-english-projector-"));
  try {
    for (const [relativePath, value] of [
      [neutralPolicy.defaultPaths.conceptsSource, concepts],
      [neutralPolicy.defaultPaths.realizationsSource, realizations],
      [neutralPolicy.defaultPaths.learnerBaseSource, learnerBaseRealizations],
      [neutralPolicy.defaultPaths.manifest, manifest]
    ]) {
      const file = path.join(temporaryRoot, ...relativePath.split("/"));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
    for (const relativePath of [
      neutralPolicy.defaultPaths.conceptsRuntime,
      neutralPolicy.defaultPaths.realizationsRuntime,
      neutralPolicy.defaultPaths.learnerBaseRuntime
    ]) {
      await mkdir(path.dirname(path.join(temporaryRoot, ...relativePath.split("/"))), {
        recursive: true
      });
    }

    const writeReport = await projectWordWorldRuntime({
      repositoryRoot: temporaryRoot,
      projectionPolicy: neutralPolicy,
      paths: neutralPolicy.defaultPaths,
      sourceLanguage: "fr",
      learnerBaseRealizationsPath: neutralPolicy.defaultPaths.learnerBaseSource
    });
    assert.equal(writeReport.recordCount, 1);
    assert.ok(writeReport.changes.includes(neutralPolicy.defaultPaths.learnerBaseRuntime));
    const cleanReport = await projectWordWorldRuntime({
      repositoryRoot: temporaryRoot,
      projectionPolicy: neutralPolicy,
      paths: neutralPolicy.defaultPaths,
      sourceLanguage: "fr",
      learnerBaseRealizationsPath: neutralPolicy.defaultPaths.learnerBaseSource,
      check: true
    });
    assert.deepEqual(cleanReport.changes, []);
    const learnerRuntime = await readJson(
      neutralPolicy.defaultPaths.learnerBaseRuntime,
      temporaryRoot
    );
    assert.equal(learnerRuntime.realizations[0].text, "Ceci est un livre.");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("write, check, tamper detection, repair, and idempotence work in an isolated repository", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-word-world-projector-"));
  try {
    for (const relativePath of Object.values(WORD_WORLD_PATHS)) {
      await mkdir(path.dirname(path.join(temporaryRoot, ...relativePath.split("/"))), {
        recursive: true
      });
    }
    for (const relativePath of [
      WORD_WORLD_PATHS.conceptsSource,
      WORD_WORLD_PATHS.realizationsSource,
      WORD_WORLD_PATHS.manifest
    ]) {
      await copyFile(
        path.join(repositoryRoot, ...relativePath.split("/")),
        path.join(temporaryRoot, ...relativePath.split("/"))
      );
    }

    const writeReport = await projectWordWorldRuntime({ repositoryRoot: temporaryRoot });
    assert.equal(writeReport.recordCount, 250);
    assert.ok(writeReport.changes.includes(WORD_WORLD_PATHS.conceptsRuntime));
    assert.ok(writeReport.changes.includes(WORD_WORLD_PATHS.realizationsRuntime));
    assert.ok(writeReport.changes.includes(WORD_WORLD_PATHS.readingGuidesRuntime));

    const cleanCheck = await projectWordWorldRuntime({ repositoryRoot: temporaryRoot, check: true });
    assert.deepEqual(cleanCheck.changes, []);

    const guidePath = path.join(
      temporaryRoot,
      ...WORD_WORLD_PATHS.readingGuidesRuntime.split("/")
    );
    const guideSource = await readFile(guidePath, "utf8");
    const tamperedGuide = guideSource.replace('"notation": "nǐ"', '"notation": "ni3"');
    assert.notEqual(tamperedGuide, guideSource, "fixture must alter one tracked guide reading");
    await writeFile(guidePath, tamperedGuide, "utf8");

    const dirtyCheck = await projectWordWorldRuntime({ repositoryRoot: temporaryRoot, check: true });
    assert.deepEqual(dirtyCheck.changes, [WORD_WORLD_PATHS.readingGuidesRuntime]);

    const repair = await projectWordWorldRuntime({ repositoryRoot: temporaryRoot });
    assert.deepEqual(repair.changes, [WORD_WORLD_PATHS.readingGuidesRuntime]);
    const repairedCheck = await projectWordWorldRuntime({ repositoryRoot: temporaryRoot, check: true });
    assert.deepEqual(repairedCheck.changes, []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("projector rejects an output symlink outside the repository", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-word-world-link-"));
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "caatuu-word-world-outside-"));
  try {
    for (const relativePath of Object.values(WORD_WORLD_PATHS)) {
      await mkdir(path.dirname(path.join(temporaryRoot, ...relativePath.split("/"))), {
        recursive: true
      });
    }
    for (const relativePath of [
      WORD_WORLD_PATHS.conceptsSource,
      WORD_WORLD_PATHS.realizationsSource,
      WORD_WORLD_PATHS.manifest
    ]) {
      await copyFile(
        path.join(repositoryRoot, ...relativePath.split("/")),
        path.join(temporaryRoot, ...relativePath.split("/"))
      );
    }
    const outsideFile = path.join(outsideRoot, "concepts.json");
    await writeFile(outsideFile, "{}", "utf8");
    await symlink(
      outsideFile,
      path.join(temporaryRoot, ...WORD_WORLD_PATHS.conceptsRuntime.split("/")),
      "file"
    );

    await assert.rejects(
      projectWordWorldRuntime({ repositoryRoot: temporaryRoot, check: true }),
      /resolves outside.*workspace/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("projector never follows an output symlink to an unrelated in-repository file", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-word-world-in-repo-link-"));
  try {
    for (const relativePath of Object.values(WORD_WORLD_PATHS)) {
      await mkdir(path.dirname(path.join(temporaryRoot, ...relativePath.split("/"))), {
        recursive: true
      });
    }
    for (const relativePath of [
      WORD_WORLD_PATHS.conceptsSource,
      WORD_WORLD_PATHS.realizationsSource,
      WORD_WORLD_PATHS.manifest
    ]) {
      await copyFile(
        path.join(repositoryRoot, ...relativePath.split("/")),
        path.join(temporaryRoot, ...relativePath.split("/"))
      );
    }
    const victim = path.join(temporaryRoot, "unrelated-tracked-content.json");
    const sentinel = "{\"mustRemain\":true}\n";
    await writeFile(victim, sentinel, "utf8");
    await symlink(
      victim,
      path.join(temporaryRoot, ...WORD_WORLD_PATHS.conceptsRuntime.split("/")),
      "file"
    );

    await assert.rejects(
      projectWordWorldRuntime({ repositoryRoot: temporaryRoot }),
      /canonical workspace location/u
    );
    assert.equal(await readFile(victim, "utf8"), sentinel);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
