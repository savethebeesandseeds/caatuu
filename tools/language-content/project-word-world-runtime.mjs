#!/usr/bin/env node

import { readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  DEFAULT_LANGUAGE_CATALOG_PATH,
  loadCatalogLanguageContentCourses
} from "./lib/course-content-catalog.mjs";
import { prepareLanguageRoleContent } from "./lib/language-role-contract.mjs";
import { buildLearnerBaseRuntimeProjection } from "./lib/language-role-runtime.mjs";
import {
  ENGLISH_CONCEPT_RUNTIME_SCHEMA,
  TARGET_REALIZATION_RUNTIME_SCHEMA,
  validateEnglishConceptRuntimeProjection,
  validateTargetRealizationRuntimeProjection
} from "./lib/runtime-projection-contract.mjs";
import { assertProjectionPolicyResult } from "./word-world-projection/contract.mjs";
import {
  MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS
} from "./word-world-projection/mandarin-simplified.mjs";
import { resolveWordWorldProjectionPolicy } from "./word-world-projection/registry.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");

// Backward-compatible alias for the current tracked course. New targets own a
// separate policy and path set; the shared projector contains no target ID,
// script, pronunciation system, or target-specific UI labels.
export const WORD_WORLD_PATHS = MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS;

/**
 * Projects every selected catalog course that declares the modern Word World
 * runtime boundary. The single-policy API below remains available for callers
 * that already resolved a course manifest themselves.
 */
export async function projectCatalogWordWorldRuntime({
  repositoryRoot = defaultRepositoryRoot,
  catalogPath = DEFAULT_LANGUAGE_CATALOG_PATH,
  courseId = null,
  check = false
} = {}) {
  const root = path.resolve(
    repositoryRoot instanceof URL ? fileURLToPath(repositoryRoot) : repositoryRoot
  );
  const records = await loadCatalogLanguageContentCourses({
    repositoryRoot: root,
    catalogPath,
    courseId
  });
  const plans = [];
  for (const record of records) {
    const runtimeProjection = record.course.publication?.runtimeProjection;
    if (!isObject(runtimeProjection)) {
      if (courseId) {
        throw new Error(`Course ${record.id} has no modern Word World runtime projection.`);
      }
      continue;
    }
    const realizations = await readJson(root, record.realizationsPath);
    const policy = resolveWordWorldProjectionPolicy(realizations.contentPolicy);
    if (!policy) {
      throw new Error(
        `Course ${record.id} has no Word World projection policy for ${realizations.contentPolicy ?? "<missing>"}.`
      );
    }
    if (runtimeProjection.policyId !== policy.id) {
      throw new Error(
        `Course ${record.id} runtimeProjection.policyId must be ${policy.id}.`
      );
    }
    const expectedSupplementalKeys = Object.keys(policy.supplementalOutputs).sort();
    const actualSupplementalKeys = Object.keys(
      runtimeProjection.supplementalOutputs ?? {}
    ).sort();
    if (!isDeepStrictEqual(actualSupplementalKeys, expectedSupplementalKeys)) {
      throw new Error(
        `Course ${record.id} supplemental outputs must be exactly ${expectedSupplementalKeys.join(", ") || "none"}.`
      );
    }
    const learnerBaseRuntime = runtimeProjection.learnerBaseRuntime ?? null;
    if (Boolean(record.learnerBaseRealizationsPath) !== Boolean(learnerBaseRuntime)) {
      throw new Error(
        `Course ${record.id} learner-base authoring and runtime paths must either both be present or both be null.`
      );
    }
    const paths = {
      conceptsSource: record.conceptsPath,
      realizationsSource: record.realizationsPath,
      conceptsRuntime: runtimeProjection.conceptsRuntime,
      realizationsRuntime: runtimeProjection.targetRealizationsRuntime,
      manifest: runtimeProjection.manifest,
      ...(record.learnerBaseRealizationsPath
        ? {
            learnerBaseSource: record.learnerBaseRealizationsPath,
            learnerBaseRuntime
          }
        : {})
    };
    for (const [projectionKey, pathKey] of Object.entries(policy.supplementalOutputs)) {
      paths[pathKey] = runtimeProjection.supplementalOutputs[projectionKey];
    }
    plans.push(Object.freeze({ record, policy, paths: Object.freeze(paths) }));
  }
  if (plans.length === 0) {
    throw new Error(
      courseId
        ? `Course ${courseId} has no modern Word World runtime projection.`
        : "The language catalog contains no modern Word World runtime projections."
    );
  }

  // Validate every selected authority before a multi-course write begins, so
  // one invalid later course cannot leave an earlier course freshly projected.
  const preflight = [];
  for (const plan of plans) {
    preflight.push(await projectWordWorldRuntime({
      repositoryRoot: root,
      check: true,
      projectionPolicy: plan.policy,
      paths: plan.paths,
      sourceLanguage: plan.record.sourceLanguage,
      learnerBaseRealizationsPath: plan.record.learnerBaseRealizationsPath
    }));
  }
  const reports = check ? preflight : await projectPlans(plans, root);
  return catalogProjectionReport(plans, reports, check);
}

async function projectPlans(plans, repositoryRoot) {
  const reports = [];
  for (const plan of plans) {
    reports.push(await projectWordWorldRuntime({
      repositoryRoot,
      check: false,
      projectionPolicy: plan.policy,
      paths: plan.paths,
      sourceLanguage: plan.record.sourceLanguage,
      learnerBaseRealizationsPath: plan.record.learnerBaseRealizationsPath
    }));
  }
  return reports;
}

function catalogProjectionReport(plans, reports, check) {
  const courses = plans.map((plan, index) => Object.freeze({
    courseId: plan.record.id,
    policyId: plan.policy.id,
    recordCount: reports[index].recordCount,
    changes: Object.freeze([...reports[index].changes])
  }));
  return Object.freeze({
    check,
    courses: Object.freeze(courses),
    changes: Object.freeze(courses.flatMap(({ changes }) => changes)),
    recordCount: courses.reduce((sum, course) => sum + course.recordCount, 0)
  });
}

export function buildWordWorldRuntimeProjections(
  concepts,
  realizations,
  manifest,
  {
    projectionPolicy = null,
    paths = null,
    sourceLanguage = "en",
    learnerBaseRealizations = null
  } = {}
) {
  const selectedPolicy = projectionPolicy
    ?? resolveWordWorldProjectionPolicy(realizations.contentPolicy);
  if (!selectedPolicy) {
    throw new Error(
      `No Word World projection policy is registered for ${realizations.contentPolicy}.`
    );
  }
  if (selectedPolicy.contentPolicyId !== realizations.contentPolicy) {
    throw new Error(
      `Word World projection policy ${selectedPolicy.id} does not match ${realizations.contentPolicy}.`
    );
  }
  const selectedPaths = Object.freeze({
    ...selectedPolicy.defaultPaths,
    ...(paths ?? {})
  });
  const languageRoleContent = prepareLanguageRoleContent(
    structuredClone(concepts),
    structuredClone(realizations),
    { sourceLanguage, learnerBaseRealizations: structuredClone(learnerBaseRealizations) }
  );
  assertOrderedCoverage(concepts, realizations);
  const targetPolicy = selectedPolicy.targetProjectionPolicy({
    concepts,
    realizations,
    languageRoleContent,
    paths: selectedPaths
  });
  validateTargetProjectionPolicy(targetPolicy, selectedPolicy);

  const englishProjection = {
    ...clone(concepts),
    $schema: ENGLISH_CONCEPT_RUNTIME_SCHEMA,
    derivedFrom: selectedPaths.conceptsSource
  };
  const targetProjection = {
    $schema: TARGET_REALIZATION_RUNTIME_SCHEMA,
    schemaVersion: realizations.schemaVersion,
    courseId: realizations.courseId,
    derivedFrom: selectedPaths.realizationsSource,
    projectionPolicy: {
      tokenization: "authored",
      pronunciationIncluded: targetPolicy.pronunciationIncluded,
      reason: targetPolicy.reason
    },
    targetLanguage: clone(realizations.targetLanguage),
    sourceCatalog: realizations.sourceCatalog,
    contentPolicy: realizations.contentPolicy,
    review: clone(realizations.review),
    license: clone(realizations.license),
    realizations: realizations.realizations.map((realization) => ({
      conceptId: realization.conceptId,
      text: realization.text,
      ...(targetPolicy.pronunciationIncluded
        ? { pronunciation: clone(realization.pronunciation) }
        : {}),
      tokens: realization.tokens.map((token) => ({
        surface: token.surface,
        ...(targetPolicy.pronunciationIncluded
          ? { pronunciation: clone(token.pronunciation) }
          : {}),
        gloss: token.gloss,
        playable: token.playable
      }))
    }))
  };
  const learnerBaseProjection = learnerBaseRealizations
    ? buildLearnerBaseRuntimeProjection(concepts, learnerBaseRealizations, {
      derivedFrom: requirePath(selectedPaths, "learnerBaseSource")
    })
    : null;
  const supplementalProjections = selectedPolicy.projectSupplemental({
    concepts,
    realizations,
    languageRoleContent,
    learnerBaseProjection,
    targetProjection,
    paths: selectedPaths
  });
  assertProjectionPolicyResult(selectedPolicy, supplementalProjections);
  const policyManifest = selectedPolicy.buildManifest({
    concepts,
    realizations,
    englishProjection,
    targetProjection,
    learnerBaseProjection,
    languageRoleContent,
    supplementalProjections,
    paths: selectedPaths
  });
  if (Object.hasOwn(policyManifest, "learnerBaseLanguage")
      || Object.hasOwn(policyManifest, "learnerBaseFile")) {
    throw new Error(
      "Word World target policies cannot author the shared learner-base manifest binding."
    );
  }
  const runtimeManifest = {
    ...policyManifest,
    ...(learnerBaseProjection
      ? {
          learnerBaseLanguage: languageRoleContent.roles.learnerBaseLanguage,
          learnerBaseFile: manifestReferenceForOutput(
            selectedPolicy.manifestBindings.learnerBaseProjection,
            selectedPaths.manifest,
            requirePath(selectedPaths, "learnerBaseRuntime")
          )
        }
      : {})
  };
  assertManifestAuthority(manifest, runtimeManifest);
  validateManifestOutputBindings(
    selectedPolicy,
    runtimeManifest,
    selectedPaths,
    learnerBaseProjection
  );

  validateEnglishConceptRuntimeProjection(englishProjection, {
    source: concepts,
    expectedDerivedFrom: selectedPaths.conceptsSource
  });
  validateTargetRealizationRuntimeProjection(targetProjection, {
    source: realizations,
    expectedDerivedFrom: selectedPaths.realizationsSource
  });
  validateSharedManifestProjection(
    runtimeManifest,
    concepts,
    realizations,
    languageRoleContent,
    learnerBaseProjection,
    selectedPaths
  );
  selectedPolicy.validate({
    concepts,
    realizations,
    englishProjection,
    targetProjection,
    learnerBaseProjection,
    languageRoleContent,
    supplementalProjections,
    runtimeManifest,
    paths: selectedPaths
  });

  return Object.freeze({
    englishProjection,
    targetProjection,
    ...(learnerBaseProjection ? { learnerBaseProjection } : {}),
    ...supplementalProjections,
    runtimeManifest
  });
}

export async function projectWordWorldRuntime({
  repositoryRoot = defaultRepositoryRoot,
  check = false,
  projectionPolicy = null,
  paths = null,
  sourceLanguage = "en",
  learnerBaseRealizationsPath = null
} = {}) {
  const root = path.resolve(repositoryRoot);
  const selectedPolicy = projectionPolicy
    ?? resolveWordWorldProjectionPolicy("mandarin-simplified-v1");
  if (!selectedPolicy) throw new Error("The default Word World projection policy is unavailable.");
  const selectedPaths = Object.freeze({
    ...selectedPolicy.defaultPaths,
    ...(paths ?? {}),
    ...(learnerBaseRealizationsPath
      ? { learnerBaseSource: learnerBaseRealizationsPath }
      : {})
  });
  const [concepts, realizations, manifest, learnerBaseRealizations] = await Promise.all([
    readJson(root, selectedPaths.conceptsSource),
    readJson(root, selectedPaths.realizationsSource),
    readJson(root, selectedPaths.manifest),
    selectedPaths.learnerBaseSource
      ? readJson(root, selectedPaths.learnerBaseSource)
      : null
  ]);
  const projections = buildWordWorldRuntimeProjections(concepts, realizations, manifest, {
    projectionPolicy: selectedPolicy,
    paths: selectedPaths,
    sourceLanguage,
    learnerBaseRealizations
  });
  const outputs = [
    [selectedPaths.conceptsRuntime, projections.englishProjection],
    [selectedPaths.realizationsRuntime, projections.targetProjection],
    ...(projections.learnerBaseProjection
      ? [[requirePath(selectedPaths, "learnerBaseRuntime"), projections.learnerBaseProjection]]
      : []),
    ...Object.entries(selectedPolicy.supplementalOutputs).map(
      ([projectionKey, pathKey]) => [selectedPaths[pathKey], projections[projectionKey]]
    ),
    [selectedPaths.manifest, projections.runtimeManifest]
  ];
  const changes = [];
  for (const [relativePath, value] of outputs) {
    const file = await resolveRealRepositoryFile(root, relativePath, { allowMissing: true });
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
    throw new Error("English concepts and target realizations must have exact one-to-one ID order.");
  }
}

function validateTargetProjectionPolicy(targetPolicy, projectionPolicy) {
  if (!targetPolicy || typeof targetPolicy !== "object" || Array.isArray(targetPolicy)) {
    throw new TypeError(`${projectionPolicy.id}.targetProjectionPolicy() must return an object.`);
  }
  if (typeof targetPolicy.pronunciationIncluded !== "boolean") {
    throw new TypeError(
      `${projectionPolicy.id}.targetProjectionPolicy().pronunciationIncluded must be boolean.`
    );
  }
  if (typeof targetPolicy.reason !== "string" || !targetPolicy.reason.trim()) {
    throw new TypeError(`${projectionPolicy.id}.targetProjectionPolicy().reason must be non-empty.`);
  }
}

function validateSharedManifestProjection(
  manifest,
  concepts,
  realizations,
  languageRoleContent,
  learnerBaseProjection,
  paths
) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Word World projection policy must build a manifest object.");
  }
  if (manifest.courseId !== realizations.courseId) {
    throw new Error("Word World manifest courseId does not match the realization catalog.");
  }
  if (manifest.targetLanguage !== realizations.targetLanguage.languageTag) {
    throw new Error("Word World manifest targetLanguage does not match the realization catalog.");
  }
  if (manifest.mediationLanguage !== "en") {
    throw new Error("Word World manifest mediationLanguage must remain en.");
  }
  if (
    manifest.embeddingPolicy?.inputLanguage !== "en"
    || manifest.embeddingPolicy?.inputField !== "embeddingText"
    || manifest.embeddingPolicy?.targetTextAllowed !== false
  ) {
    throw new Error("Word World manifest must preserve the English-only embedding boundary.");
  }
  if (manifest.recordCount !== concepts.concepts.length) {
    throw new Error("Word World manifest recordCount does not match the English concept catalog.");
  }
  if (learnerBaseProjection) {
    if (manifest.learnerBaseLanguage !== languageRoleContent.roles.learnerBaseLanguage) {
      throw new Error(
        "Word World manifest must bind the non-English learner-base language and projection file."
      );
    }
  }
}

function requirePath(paths, key) {
  if (typeof paths?.[key] !== "string" || !paths[key].trim()) {
    throw new Error(`Word World projection path ${key} is required.`);
  }
  return paths[key];
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

function validateManifestOutputBindings(policy, manifest, paths, learnerBaseProjection) {
  const outputPaths = {
    englishProjection: requirePath(paths, "conceptsRuntime"),
    targetProjection: requirePath(paths, "realizationsRuntime"),
    ...(learnerBaseProjection
      ? { learnerBaseProjection: requirePath(paths, "learnerBaseRuntime") }
      : {}),
    ...Object.fromEntries(Object.entries(policy.supplementalOutputs).map(
      ([projectionKey, pathKey]) => [projectionKey, requirePath(paths, pathKey)]
    ))
  };

  for (const [projectionKey, binding] of Object.entries(policy.manifestBindings)) {
    const reference = nestedValue(manifest, binding.field);
    const outputPath = outputPaths[projectionKey];
    if (!outputPath) {
      if (reference !== undefined && reference !== null && reference !== "") {
        throw new Error(
          `Word World manifest ${binding.field} must be absent without ${projectionKey}.`
        );
      }
      continue;
    }
    if (typeof reference !== "string" || !reference.trim()) {
      throw new Error(`Word World manifest ${binding.field} must reference ${projectionKey}.`);
    }
    const resolved = binding.reference === "manifest-relative"
      ? resolveManifestRelativePath(paths.manifest, reference)
      : resolveSharedRuntimeUrl(reference);
    if (resolved !== outputPath) {
      throw new Error(
        `Word World manifest ${binding.field} resolves to ${resolved}, not declared output ${outputPath}.`
      );
    }
  }
}

function nestedValue(value, dottedPath) {
  return dottedPath.split(".").reduce(
    (current, key) => current && typeof current === "object" ? current[key] : undefined,
    value
  );
}

function resolveManifestRelativePath(manifestPath, reference) {
  if (
    reference.includes("\\")
    || path.posix.isAbsolute(reference)
    || reference.includes("?")
    || reference.includes("#")
  ) {
    throw new Error(`Word World manifest-relative reference is not confined: ${reference}`);
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(manifestPath), reference));
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    throw new Error(`Word World manifest-relative reference escapes the repository: ${reference}`);
  }
  return resolved;
}

function resolveSharedRuntimeUrl(reference) {
  const publicPrefix = "/language-runtime/static/";
  if (!reference.startsWith(publicPrefix)) {
    throw new Error(`Word World shared runtime URL is not confined: ${reference}`);
  }
  const relative = reference.slice(publicPrefix.length);
  if (!relative || relative.includes("\\")
      || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Word World shared runtime URL is not confined: ${reference}`);
  }
  return `apps/language-runtime/static/${relative}`;
}

function manifestReferenceForOutput(binding, manifestPath, outputPath) {
  if (binding.reference === "manifest-relative") {
    const reference = path.posix.relative(path.posix.dirname(manifestPath), outputPath);
    if (!reference || path.posix.isAbsolute(reference) || reference.includes("\\")) {
      throw new Error(`Word World output cannot be referenced from its manifest: ${outputPath}`);
    }
    return reference;
  }
  const runtimePrefix = "apps/language-runtime/static/";
  if (!outputPath.startsWith(runtimePrefix)) {
    throw new Error(`Word World shared runtime output is not confined: ${outputPath}`);
  }
  return `/language-runtime/static/${outputPath.slice(runtimePrefix.length)}`;
}

async function readJson(root, relativePath) {
  const file = await resolveRealRepositoryFile(root, relativePath);
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

async function resolveRealRepositoryFile(root, relativePath, { allowMissing = false } = {}) {
  const lexicalRoot = path.resolve(root);
  const file = resolveRepositoryFile(root, relativePath);
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)]);
    const expectedRealFile = path.resolve(realRoot, path.relative(lexicalRoot, file));
    const relative = path.relative(realRoot, realFile);
    if (
      !relative
      || relative.startsWith("..")
      || path.isAbsolute(relative)
      || path.relative(expectedRealFile, realFile) !== ""
    ) {
      throw new Error(`Repository path resolves outside its canonical workspace location: ${relativePath}`);
    }
    return realFile;
  } catch (error) {
    if (!allowMissing || error?.code !== "ENOENT") throw error;
    const [realRoot, realParent] = await Promise.all([
      realpath(root),
      realpath(path.dirname(file))
    ]);
    const expectedRealParent = path.resolve(
      realRoot,
      path.relative(lexicalRoot, path.dirname(file))
    );
    const relativeParent = path.relative(realRoot, realParent);
    if (
      relativeParent.startsWith("..")
      || path.isAbsolute(relativeParent)
      || path.relative(expectedRealParent, realParent) !== ""
    ) {
      throw new Error(`Repository output parent resolves outside its canonical workspace location: ${relativePath}`);
    }
    return path.resolve(realParent, path.basename(file));
  }
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

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function usage() {
  return `Usage: node tools/language-content/project-word-world-runtime.mjs [options]

Options:
  --all                 Project every catalog course with a modern Word World publication (default)
  --course <id>         Project one catalog course
  --catalog <path>      Course catalog (default: ${DEFAULT_LANGUAGE_CATALOG_PATH})
  --repo-root <path>    Repository root (defaults to this checkout)
  --check               Report projection drift without writing
  --help                Show this help`;
}

function parseArguments(argv) {
  const options = {
    all: false,
    catalogPath: DEFAULT_LANGUAGE_CATALOG_PATH,
    check: false,
    courseId: null,
    repositoryRoot: defaultRepositoryRoot
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") {
      if (options.courseId) throw new Error("--all cannot be combined with --course.");
      options.all = true;
    } else if (argument === "--course") {
      if (options.all) throw new Error("--course cannot be combined with --all.");
      if (options.courseId) throw new Error("--course may be provided only once.");
      options.courseId = argv[++index];
      if (!options.courseId) throw new Error("--course requires an id.");
    } else if (argument === "--catalog") {
      options.catalogPath = argv[++index];
      if (!options.catalogPath) throw new Error("--catalog requires a path.");
    } else if (argument === "--repo-root") {
      options.repositoryRoot = argv[++index];
      if (!options.repositoryRoot) throw new Error("--repo-root requires a path.");
    } else if (argument === "--check") {
      options.check = true;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.courseId) options.all = true;
  return options;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const report = await projectCatalogWordWorldRuntime({
    repositoryRoot: options.repositoryRoot,
    catalogPath: options.catalogPath,
    courseId: options.courseId,
    check: options.check
  });
  for (const course of report.courses) {
    if (course.changes.length === 0) {
      console.log(`${course.courseId}: Word World runtime projection is current (${course.recordCount} records).`);
      continue;
    }
    const verb = report.check ? "Drift" : "Updated";
    for (const file of course.changes) console.log(`${verb} (${course.courseId}): ${file}`);
  }
  if (report.check) {
    if (report.changes.length > 0) process.exitCode = 1;
    else console.log(`Checked ${report.recordCount} Word World records across ${report.courses.length} course(s).`);
  } else {
    console.log(`Projected ${report.recordCount} Word World records across ${report.courses.length} course(s).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
