import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
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
    (candidate) => { candidate.realizationFile = "different.realizations.json"; },
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
