import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  LanguageContentError,
  validateLanguageContent
} from "../lib/content-contract.mjs";
import {
  buildWordWorldRuntimeProjections
} from "../project-word-world-runtime.mjs";
import {
  registeredTargetContentPolicyIds,
  resolveTargetContentPolicy
} from "../policies/registry.mjs";
import {
  SPANISH_SPAIN_CONTENT_POLICY_ID,
  spanishSpainContentPolicy
} from "../policies/spanish-spain.mjs";
import {
  MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS
} from "../word-world-projection/mandarin-simplified.mjs";
import {
  registeredWordWorldProjectionPolicyIds,
  resolveWordWorldProjectionPolicy
} from "../word-world-projection/registry.mjs";
import {
  SPANISH_SPAIN_WORD_WORLD_PROJECTION_POLICY_ID,
  SPANISH_SPAIN_WORD_WORLD_PATHS,
  spanishSpainWordWorldProjectionPolicy
} from "../word-world-projection/spanish-spain.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectorPath = fileURLToPath(new URL("../project-word-world-runtime.mjs", import.meta.url));
const validatorPath = fileURLToPath(new URL("../validate.mjs", import.meta.url));
const sourceConcepts = JSON.parse(await readFile(
  path.join(repositoryRoot, ...SPANISH_SPAIN_WORD_WORLD_PATHS.conceptsSource.split("/")),
  "utf8"
));

function targetLicense() {
  return {
    origin: "caatuu-first-party-authored",
    status: "release-review-required",
    spdxExpression: null,
    sourceReference: null,
    reviewedBy: null,
    reviewedAt: null
  };
}

function spanishRealizations(concepts = sourceConcepts, { repeatedFixture = false } = {}) {
  const records = repeatedFixture
    ? concepts.concepts.map(({ id }) => ({
        conceptId: id,
        text: "Palabra de ejemplo.",
        pronunciation: null,
        tokens: [
          { surface: "Palabra", pronunciation: null, gloss: "word", playable: true },
          { surface: "de", pronunciation: null, gloss: "of", playable: true },
          { surface: "ejemplo", pronunciation: null, gloss: "example", playable: true }
        ]
      }))
    : [{
        conceptId: concepts.concepts[0].id,
        text: "La niña lee.",
        pronunciation: null,
        tokens: [
          { surface: "La", pronunciation: null, gloss: "the", playable: true },
          { surface: "niña", pronunciation: null, gloss: "girl", playable: true },
          { surface: "lee", pronunciation: null, gloss: "reads", playable: true }
        ]
      }];
  return {
    $schema: "https://caatuu.org/schemas/target-realizations.v1.schema.json",
    schemaVersion: 1,
    courseId: "es",
    targetLanguage: {
      languageTag: "es-ES",
      speechLocale: "es-ES",
      script: "Latn"
    },
    sourceCatalog: SPANISH_SPAIN_WORD_WORLD_PATHS.conceptsSource,
    contentPolicy: SPANISH_SPAIN_CONTENT_POLICY_ID,
    tokenization: {
      method: "authored-word-tokens",
      characterFallbackAllowed: false,
      pronunciationAuthority: "authored-contextual-token"
    },
    review: {
      status: "native-review-required",
      reviewer: null,
      reviewedAt: null,
      notes: "Synthetic Spanish policy fixture pending native review."
    },
    license: targetLicense(),
    realizations: records
  };
}

function oneConceptCatalog() {
  return {
    ...structuredClone(sourceConcepts),
    concepts: [structuredClone(sourceConcepts.concepts[0])]
  };
}

function hasIssue(error, code) {
  return error instanceof LanguageContentError
    && error.issues.some((candidate) => candidate.code === code);
}

function assertSpanishIssue(mutate, code) {
  const concepts = oneConceptCatalog();
  const realizations = spanishRealizations(concepts);
  mutate(realizations);
  assert.throws(
    () => validateLanguageContent(concepts, realizations),
    (error) => hasIssue(error, code)
  );
}

test("Spanish (Spain) content policy is registered and accepts authored Latin word tokens", () => {
  const concepts = oneConceptCatalog();
  const realizations = spanishRealizations(concepts);
  const prepared = validateLanguageContent(concepts, realizations);

  assert.equal(resolveTargetContentPolicy(SPANISH_SPAIN_CONTENT_POLICY_ID), spanishSpainContentPolicy);
  assert.ok(registeredTargetContentPolicyIds().includes(SPANISH_SPAIN_CONTENT_POLICY_ID));
  assert.equal(prepared.realizations.targetLanguage.languageTag, "es-ES");
  assert.equal(prepared.realizations.realizations[0].pronunciation, null);
  assert.equal(
    prepared.realizations.realizations[0].tokens.every((token) => (
      token.pronunciation === null && !Object.hasOwn(token, "readingUnits")
    )),
    true
  );
  assert.throws(
    () => validateLanguageContent(concepts, realizations, { release: true }),
    (error) => hasIssue(error, "release.license")
  );
});

test("Spanish policy rejects identity, locale, tokenization, pronunciation, reading units, script, and format drift", () => {
  assertSpanishIssue((candidate) => { candidate.courseId = "es-mx"; }, "spanish.course");
  assertSpanishIssue((candidate) => { candidate.targetLanguage.languageTag = "es-MX"; }, "spanish.locale");
  assertSpanishIssue((candidate) => { candidate.tokenization.method = "implicit-words"; }, "spanish.tokenization");
  assertSpanishIssue((candidate) => {
    candidate.realizations[0].pronunciation = {
      system: "ipa",
      notation: "la ˈniɲa ˈle.e",
      languageTag: "es-ES",
      reviewed: false
    };
  }, "spanish.pronunciation");
  assertSpanishIssue((candidate) => {
    candidate.realizations[0].tokens[0].readingUnits = [
      { surface: "La", pronunciation: null }
    ];
  }, "spanish.reading-units");
  assertSpanishIssue((candidate) => {
    candidate.realizations[0].text = "Ж niña lee.";
    candidate.realizations[0].tokens[0].surface = "Ж";
  }, "spanish.script");
  assertSpanishIssue((candidate) => {
    candidate.realizations[0].text = "La\u200e niña lee.";
    candidate.realizations[0].tokens[0].surface = "La\u200e";
  }, "spanish.format-control");
});

test("Spanish Word World projection owns no guide and preserves the target license authority", () => {
  const concepts = oneConceptCatalog();
  const realizations = spanishRealizations(concepts);
  const manifest = spanishSpainWordWorldProjectionPolicy.buildManifest({
    concepts,
    realizations,
    paths: SPANISH_SPAIN_WORD_WORLD_PATHS
  });
  const projected = buildWordWorldRuntimeProjections(concepts, realizations, manifest);

  assert.equal(
    resolveWordWorldProjectionPolicy(SPANISH_SPAIN_CONTENT_POLICY_ID),
    spanishSpainWordWorldProjectionPolicy
  );
  assert.ok(
    registeredWordWorldProjectionPolicyIds().includes(
      SPANISH_SPAIN_WORD_WORLD_PROJECTION_POLICY_ID
    )
  );
  assert.deepEqual(Object.keys(projected), [
    "englishProjection",
    "targetProjection",
    "runtimeManifest"
  ]);
  assert.equal(projected.targetProjection.projectionPolicy.pronunciationIncluded, false);
  assert.doesNotMatch(JSON.stringify(projected.targetProjection), /"pronunciation"/u);
  assert.equal(Object.hasOwn(projected.runtimeManifest, "targetTextGuide"), false);
  assert.deepEqual(projected.runtimeManifest.license, realizations.license);
  assert.notDeepEqual(projected.runtimeManifest.license, concepts.license);
  assert.equal(projected.runtimeManifest.license.status, "release-review-required");
  for (const field of ["spdxExpression", "sourceReference", "reviewedBy", "reviewedAt"]) {
    assert.equal(projected.runtimeManifest.license[field], null);
  }

  const wrongManifest = structuredClone(manifest);
  wrongManifest.license = structuredClone(concepts.license);
  assert.throws(
    () => buildWordWorldRuntimeProjections(concepts, realizations, wrongManifest),
    /manifest authority differs/u
  );
});

test("projector and validator CLIs select one course or every modern catalog course", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-language-content-catalog-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const mandarinCoursePath = "apps/languages/mandarin-simplified/course.json";
  const spanishCoursePath = "apps/languages/spanish/course.json";
  const legacyCoursePath = "apps/languages/czech/course.json";
  const catalogPath = "apps/languages/catalog.json";
  const mandarinCourse = JSON.parse(await readFile(
    path.join(repositoryRoot, ...mandarinCoursePath.split("/")),
    "utf8"
  ));
  const concepts = structuredClone(sourceConcepts);
  const realizations = spanishRealizations(concepts, { repeatedFixture: true });
  const spanishManifest = spanishSpainWordWorldProjectionPolicy.buildManifest({
    concepts,
    realizations,
    paths: SPANISH_SPAIN_WORD_WORLD_PATHS
  });
  const spanishCourse = {
    id: "es",
    sourceLanguage: { id: "en", locale: "en" },
    publication: {
      contract: "language-content-v1",
      concepts: SPANISH_SPAIN_WORD_WORLD_PATHS.conceptsSource,
      realizations: SPANISH_SPAIN_WORD_WORLD_PATHS.realizationsSource,
      learnerBaseRealizations: null,
      runtimeProjection: {
        policyId: spanishSpainWordWorldProjectionPolicy.id,
        conceptsRuntime: SPANISH_SPAIN_WORD_WORLD_PATHS.conceptsRuntime,
        targetRealizationsRuntime: SPANISH_SPAIN_WORD_WORLD_PATHS.realizationsRuntime,
        learnerBaseRuntime: null,
        supplementalOutputs: {},
        manifest: SPANISH_SPAIN_WORD_WORLD_PATHS.manifest
      }
    }
  };

  for (const relativePath of new Set([
    ...Object.values(MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS),
    ...Object.values(SPANISH_SPAIN_WORD_WORLD_PATHS),
    mandarinCoursePath,
    spanishCoursePath,
    legacyCoursePath,
    catalogPath
  ])) {
    await mkdir(path.dirname(path.join(temporaryRoot, ...relativePath.split("/"))), {
      recursive: true
    });
  }
  for (const relativePath of [
    MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS.conceptsSource,
    MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS.realizationsSource,
    MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS.manifest
  ]) {
    await copyFile(
      path.join(repositoryRoot, ...relativePath.split("/")),
      path.join(temporaryRoot, ...relativePath.split("/"))
    );
  }
  await writeJson(temporaryRoot, SPANISH_SPAIN_WORD_WORLD_PATHS.realizationsSource, realizations);
  await writeJson(temporaryRoot, SPANISH_SPAIN_WORD_WORLD_PATHS.manifest, spanishManifest);
  await writeJson(temporaryRoot, mandarinCoursePath, mandarinCourse);
  await writeJson(temporaryRoot, spanishCoursePath, spanishCourse);
  await writeJson(temporaryRoot, legacyCoursePath, {
    id: "cz",
    sourceLanguage: { id: "en", locale: "en" },
    publication: { contract: "legacy-active-v1" }
  });
  await writeJson(temporaryRoot, catalogPath, {
    schemaVersion: 1,
    defaultCourseId: "cz",
    courses: [
      { id: "cz", manifest: legacyCoursePath },
      { id: "zh", manifest: mandarinCoursePath },
      { id: "es", manifest: spanishCoursePath }
    ]
  });

  const projectorWrite = run(projectorPath, [
    "--all", "--repo-root", temporaryRoot, "--catalog", catalogPath
  ]);
  assert.equal(projectorWrite.status, 0, projectorWrite.stderr);
  assert.match(projectorWrite.stdout, /Projected 500 Word World records across 2 course\(s\)/u);

  const projectorCheck = run(projectorPath, [
    "--check", "--repo-root", temporaryRoot, "--catalog", catalogPath
  ]);
  assert.equal(projectorCheck.status, 0, projectorCheck.stderr);
  assert.match(projectorCheck.stdout, /zh: Word World runtime projection is current/u);
  assert.match(projectorCheck.stdout, /es: Word World runtime projection is current/u);

  const spanishOnly = run(projectorPath, [
    "--course", "es", "--check", "--repo-root", temporaryRoot, "--catalog", catalogPath
  ]);
  assert.equal(spanishOnly.status, 0, spanishOnly.stderr);
  assert.match(spanishOnly.stdout, /es: Word World runtime projection is current/u);
  assert.doesNotMatch(spanishOnly.stdout, /zh:/u);

  const validation = run(validatorPath, [
    "--all", "--repo-root", temporaryRoot, "--catalog", catalogPath
  ]);
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /zh: validated 250 English concepts/u);
  assert.match(validation.stdout, /es: validated 250 English concepts/u);
  assert.match(validation.stdout, /Validated 2 catalog language-content course\(s\)/u);

  const legacyProjection = run(projectorPath, [
    "--course", "cz", "--check", "--repo-root", temporaryRoot, "--catalog", catalogPath
  ]);
  assert.notEqual(legacyProjection.status, 0);
  assert.match(legacyProjection.stderr, /does not use language-content-v1/u);

  const releaseValidation = run(validatorPath, [
    "--all", "--release", "--repo-root", temporaryRoot, "--catalog", catalogPath
  ]);
  assert.notEqual(releaseValidation.status, 0);
  assert.match(releaseValidation.stderr, /es:[\s\S]*release\.license/u);
});

async function writeJson(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(script, arguments_) {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.error, undefined);
  return result;
}
