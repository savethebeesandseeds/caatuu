#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateLanguageContent } from "./lib/content-contract.mjs";
import {
  ENGLISH_CONCEPT_RUNTIME_SCHEMA,
  TARGET_REALIZATION_RUNTIME_SCHEMA,
  validateEnglishConceptRuntimeProjection,
  validateTargetRealizationRuntimeProjection
} from "./lib/runtime-projection-contract.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");

export const WORD_WORLD_PATHS = Object.freeze({
  conceptsSource: "apps/languages/shared/english-concepts/word-world-starter-v1.json",
  realizationsSource: "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json",
  conceptsRuntime: "apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
  realizationsRuntime: "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json",
  readingGuidesRuntime: "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.reading-guides.json",
  manifest: "apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json"
});

const PREVIEW_GUIDE_SCHEMA =
  "https://caatuu.org/schemas/development/target-text-guides.preview.v1.json";
const PREVIEW_GUIDE_STATUS = "machine-assisted-preview";

export function buildWordWorldRuntimeProjections(concepts, realizations, manifest) {
  validateLanguageContent(structuredClone(concepts), structuredClone(realizations));
  assertOrderedCoverage(concepts, realizations);
  if (realizations.review?.status !== "native-review-required") {
    throw new Error(
      "Word World projection currently supports native-review-required sources only; reviewed pronunciation needs a separate approved runtime transition."
    );
  }

  const englishProjection = {
    ...clone(concepts),
    $schema: ENGLISH_CONCEPT_RUNTIME_SCHEMA,
    derivedFrom: WORD_WORLD_PATHS.conceptsSource
  };
  const targetProjection = {
    $schema: TARGET_REALIZATION_RUNTIME_SCHEMA,
    schemaVersion: realizations.schemaVersion,
    courseId: realizations.courseId,
    derivedFrom: WORD_WORLD_PATHS.realizationsSource,
    projectionPolicy: {
      tokenization: "authored",
      pronunciationIncluded: false,
      reason: "Pronunciation guidance is disabled until native review is complete."
    },
    targetLanguage: clone(realizations.targetLanguage),
    sourceCatalog: realizations.sourceCatalog,
    contentPolicy: realizations.contentPolicy,
    review: clone(realizations.review),
    license: clone(realizations.license),
    realizations: realizations.realizations.map((realization) => ({
      conceptId: realization.conceptId,
      text: realization.text,
      tokens: realization.tokens.map((token) => ({
        surface: token.surface,
        gloss: token.gloss,
        playable: token.playable
      }))
    }))
  };
  const readingGuideProjection = {
    $schema: PREVIEW_GUIDE_SCHEMA,
    schemaVersion: 1,
    courseId: realizations.courseId,
    system: "pinyin",
    status: PREVIEW_GUIDE_STATUS,
    derivedFrom: WORD_WORLD_PATHS.realizationsSource,
    review: clone(realizations.review),
    entries: realizations.realizations.map((realization) => ({
      conceptId: realization.conceptId,
      tokens: realization.tokens.map((token) => ({
        surface: token.surface,
        units: token.readingUnits.map((unit) => ({
          surface: unit.surface,
          notation: unit.pronunciation.notation
        }))
      }))
    }))
  };
  const runtimeManifest = buildRuntimeManifest(concepts, realizations);
  assertManifestAuthority(manifest, runtimeManifest);

  validateEnglishConceptRuntimeProjection(englishProjection, {
    source: concepts,
    expectedDerivedFrom: WORD_WORLD_PATHS.conceptsSource
  });
  validateTargetRealizationRuntimeProjection(targetProjection, {
    source: realizations,
    expectedDerivedFrom: WORD_WORLD_PATHS.realizationsSource
  });
  validateReadingGuideProjection(readingGuideProjection, targetProjection, realizations);
  validateManifestProjection(runtimeManifest, readingGuideProjection, realizations);

  return Object.freeze({
    englishProjection,
    targetProjection,
    readingGuideProjection,
    runtimeManifest
  });
}

export async function projectWordWorldRuntime({
  repositoryRoot = defaultRepositoryRoot,
  check = false
} = {}) {
  const root = path.resolve(repositoryRoot);
  const [concepts, realizations, manifest] = await Promise.all([
    readJson(root, WORD_WORLD_PATHS.conceptsSource),
    readJson(root, WORD_WORLD_PATHS.realizationsSource),
    readJson(root, WORD_WORLD_PATHS.manifest)
  ]);
  const projections = buildWordWorldRuntimeProjections(concepts, realizations, manifest);
  const outputs = [
    [WORD_WORLD_PATHS.conceptsRuntime, projections.englishProjection],
    [WORD_WORLD_PATHS.realizationsRuntime, projections.targetProjection],
    [WORD_WORLD_PATHS.readingGuidesRuntime, projections.readingGuideProjection],
    [WORD_WORLD_PATHS.manifest, projections.runtimeManifest]
  ];
  const changes = [];
  for (const [relativePath, value] of outputs) {
    const file = resolveRepositoryFile(root, relativePath);
    const expected = serialize(value);
    const current = await readFile(file, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (current === expected) continue;
    changes.push(relativePath);
    if (!check) await writeAtomic(file, expected);
  }
  return Object.freeze({ check, changes, recordCount: concepts.concepts.length });
}

function assertOrderedCoverage(concepts, realizations) {
  const conceptIds = concepts.concepts.map((concept) => concept.id);
  const realizationIds = realizations.realizations.map((realization) => realization.conceptId);
  if (JSON.stringify(conceptIds) !== JSON.stringify(realizationIds)) {
    throw new Error("English concepts and Mandarin realizations must have exact one-to-one ID order.");
  }
}

function validateReadingGuideProjection(guide, targetProjection, sourceRealizations) {
  if (guide.schemaVersion !== 1 || guide.courseId !== targetProjection.courseId) {
    throw new Error("Reading-guide identity does not match the target projection.");
  }
  if (guide.system !== "pinyin" || guide.status !== PREVIEW_GUIDE_STATUS) {
    throw new Error("Reading guide must remain an explicit machine-assisted pinyin preview.");
  }
  if (JSON.stringify(guide.review) !== JSON.stringify(sourceRealizations.review)) {
    throw new Error("Reading-guide review metadata must match the authoring source.");
  }
  if (guide.entries.length !== targetProjection.realizations.length) {
    throw new Error("Reading guide must cover every target realization.");
  }
  guide.entries.forEach((entry, recordIndex) => {
    const realization = targetProjection.realizations[recordIndex];
    const sourceRealization = sourceRealizations.realizations[recordIndex];
    if (entry.conceptId !== realization.conceptId || entry.tokens.length !== realization.tokens.length) {
      throw new Error(`Reading-guide coverage differs at ${entry.conceptId}.`);
    }
    entry.tokens.forEach((token, tokenIndex) => {
      const projectedToken = realization.tokens[tokenIndex];
      const sourceToken = sourceRealization.tokens[tokenIndex];
      if (token.surface !== projectedToken.surface || token.units.map((unit) => unit.surface).join("") !== token.surface) {
        throw new Error(`Reading-guide units differ at ${entry.conceptId} token ${tokenIndex}.`);
      }
      if (token.units.some((unit) => !unit.notation.trim() || /\s/u.test(unit.notation.trim()))) {
        throw new Error(`Reading-guide unit notation is invalid at ${entry.conceptId} token ${tokenIndex}.`);
      }
      if (
        token.units.length !== sourceToken.readingUnits.length
        || token.units.some((unit, unitIndex) => (
          unit.surface !== sourceToken.readingUnits[unitIndex].surface
          || unit.notation !== sourceToken.readingUnits[unitIndex].pronunciation.notation
        ))
      ) {
        throw new Error(
          `Reading-guide notation differs from authoring readingUnits at ${entry.conceptId} token ${tokenIndex}.`
        );
      }
    });
  });
}

function validateManifestProjection(manifest, guide, realizations) {
  const expectedRealizationFile = path.posix.basename(WORD_WORLD_PATHS.realizationsRuntime);
  const expectedGuideFile = path.posix.basename(WORD_WORLD_PATHS.readingGuidesRuntime);
  const guideLanguageTag = realizations.realizations[0]?.tokens[0]
    ?.readingUnits[0]?.pronunciation?.languageTag;
  if (manifest.courseId !== realizations.courseId) {
    throw new Error("Word World manifest courseId does not match the realization catalog.");
  }
  if (
    manifest.realizationFile !== expectedRealizationFile
    || manifest.targetTextGuide?.file !== expectedGuideFile
  ) {
    throw new Error("Word World manifest files do not match the generated runtime projections.");
  }
  if (
    manifest.targetTextGuide?.system !== guide.system
    || manifest.targetTextGuide?.status !== guide.status
    || manifest.targetTextGuide?.languageTag !== guideLanguageTag
  ) {
    throw new Error("Word World manifest reading-guide system, status, or language differs from the generated guide.");
  }
  if (manifest.targetLanguage !== realizations.targetLanguage.languageTag) {
    throw new Error("Word World manifest targetLanguage does not match the realization catalog.");
  }
  if (
    manifest.review?.status !== realizations.review.status
    || manifest.review?.notes !== realizations.review.notes
    || manifest.review?.pronunciationApproved !== false
  ) {
    throw new Error("Word World manifest review gate differs from the unreviewed authoring source.");
  }
  if (manifest.recordCount !== realizations.realizations.length) {
    throw new Error("Word World manifest recordCount does not match the realization catalog.");
  }
}

function buildRuntimeManifest(concepts, realizations) {
  if (!isDeepStrictEqual(concepts.license, realizations.license)) {
    throw new Error("Word World concept and realization license gates must match before projection.");
  }
  return {
    schemaVersion: "caatuu-word-world-runtime-manifest-v2",
    courseId: realizations.courseId,
    corpusVersion: "starter-v1",
    mode: "authored",
    sessionProvider: {
      kind: "authored-realizations"
    },
    features: {
      wordMeanings: true
    },
    sourceConceptCatalog:
      "/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
    realizationFile: path.posix.basename(WORD_WORLD_PATHS.realizationsRuntime),
    targetTextGuide: {
      file: path.posix.basename(WORD_WORLD_PATHS.readingGuidesRuntime),
      system: "pinyin",
      languageTag: "zh-Latn-pinyin",
      status: PREVIEW_GUIDE_STATUS,
      labels: {
        section: "Mandarin text",
        showGuide: "Show pinyin",
        colorTones: "Color tones"
      },
      defaults: {
        showGuide: true,
        colorTones: true
      }
    },
    recordCount: concepts.concepts.length,
    targetLanguage: realizations.targetLanguage.languageTag,
    mediationLanguage: "en",
    tokenization: "authored",
    review: {
      status: realizations.review.status,
      pronunciationApproved: false,
      notes: realizations.review.notes
    },
    capabilities: {
      llm: false,
      generation: false,
      chat: false,
      embeddings: true,
      semanticSearch: true,
      dictionary: false,
      wordMeanings: true,
      speech: true,
      pronunciationGuides: false,
      wordWorld: true
    },
    embeddingPolicy: {
      inputLanguage: concepts.embeddingPolicy.inputLanguage,
      inputField: concepts.embeddingPolicy.inputField,
      targetTextAllowed: concepts.embeddingPolicy.targetTextAllowed,
      modelId: "all-minilm-l6-v2-qint8-v0.1",
      fallback: "deterministic-lexical"
    },
    license: clone(concepts.license)
  };
}

function assertManifestAuthority(manifest, generatedManifest) {
  const normalizedTrackedManifest = clone(manifest);
  normalizedTrackedManifest.recordCount = generatedManifest.recordCount;
  if (!isDeepStrictEqual(normalizedTrackedManifest, generatedManifest)) {
    throw new Error(
      "Word World manifest authority differs from the immutable generated shape; only recordCount drift is repairable."
    );
  }
}

async function readJson(root, relativePath) {
  const file = resolveRepositoryFile(root, relativePath);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveRepositoryFile(root, relativePath) {
  const file = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Repository path escapes the workspace: ${relativePath}`);
  }
  return file;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeAtomic(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const options = { check: false, repositoryRoot: defaultRepositoryRoot };
  for (const argument of process.argv.slice(2)) {
    if (argument === "--check") options.check = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  const report = await projectWordWorldRuntime(options);
  if (report.changes.length === 0) {
    console.log(`Word World runtime projections are current (${report.recordCount} records).`);
    return;
  }
  const verb = report.check ? "Drift" : "Updated";
  for (const file of report.changes) console.log(`${verb}: ${file}`);
  if (report.check) process.exitCode = 1;
  else console.log(`Projected ${report.recordCount} Word World records.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
