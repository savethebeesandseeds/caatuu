#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile, rename, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { repositoryRoot, loadWordWorldCourses, loadWordWorldContent, readRepositoryJson,
  modernCatalogs, czechRuntimeRecords, validateSharedEnglishMeanings } from "./lib/word-world-course-content.mjs";
import { buildWordWorldRuntimeProjections } from "./project-word-world-runtime.mjs";
import { resolveWordWorldProjectionPolicy } from "./word-world-projection/registry.mjs";
import { buildCoverageReport } from "../czech-ml/scripts/word-world-standard-lib.mjs";

const serialize = value => JSON.stringify(value, null, 2) + "\n";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export async function planWordWorldContent({ root = repositoryRoot, catalogPath = "apps/languages/catalog.json",
  courseId = null, includeLegacy = true } = {}) {
  const courses = await loadWordWorldCourses({ root, catalogPath });
  const loaded = await Promise.all(courses.map(async entry => ({ ...entry, ...await loadWordWorldContent(entry.course, { root }) })));
  validateSharedEnglishMeanings(loaded.map(entry => entry.document));
  const selected = loaded.filter(({ course }) => (!courseId || course.id === courseId)
    && (includeLegacy || course.publication.contract === "language-content-v1"));
  assert.ok(selected.length, `No Word World course selected: ${courseId ?? "all"}`);
  const result = [];
  for (const entry of selected) {
    const { course, document, sourcePath } = entry;
    const outputs = new Map();
    const add = (file, value) => outputs.set(file, typeof value === "string" ? value : serialize(value));
    if (course.publication.contract === "language-content-v1") {
      const { concepts, realizations, learnerBase } = modernCatalogs(document, course);
      const publication = course.publication;
      const runtime = publication.runtimeProjection;
      const policy = resolveWordWorldProjectionPolicy(realizations.contentPolicy);
      assert.ok(policy && policy.id === runtime.policyId, `${course.id}: projection policy mismatch`);
      const paths = { conceptsSource: publication.concepts, realizationsSource: publication.realizations,
        conceptsRuntime: runtime.conceptsRuntime, realizationsRuntime: runtime.targetRealizationsRuntime,
        manifest: runtime.manifest,
        ...(learnerBase ? { learnerBaseSource: publication.learnerBaseRealizations, learnerBaseRuntime: runtime.learnerBaseRuntime } : {}) };
      for (const [projectionKey, pathKey] of Object.entries(policy.supplementalOutputs)) paths[pathKey] = runtime.supplementalOutputs[projectionKey];
      const expectedManifest = policy.buildManifest({ concepts, realizations, paths });
      if (learnerBase) {
        expectedManifest.learnerBaseLanguage = document.sourceLanguage;
        expectedManifest.learnerBaseFile = path.posix.relative(path.posix.dirname(paths.manifest), paths.learnerBaseRuntime);
      }
      const projections = buildWordWorldRuntimeProjections(concepts, realizations, expectedManifest, {
        projectionPolicy: policy, paths, sourceLanguage: document.sourceLanguage, learnerBaseRealizations: learnerBase });
      // Compatibility views for existing publication/packaging tools. Never
      // read these back as authoring inputs in the canonical build command.
      add(publication.concepts, concepts);
      add(publication.realizations, realizations);
      if (learnerBase) add(publication.learnerBaseRealizations, learnerBase);
      add(runtime.conceptsRuntime, projections.englishProjection);
      add(runtime.targetRealizationsRuntime, projections.targetProjection);
      if (learnerBase) add(runtime.learnerBaseRuntime, projections.learnerBaseProjection);
      for (const key of Object.keys(policy.supplementalOutputs)) add(runtime.supplementalOutputs[key], projections[key]);
      add(runtime.manifest, projections.runtimeManifest);
    } else {
      const rubric = await readRepositoryJson(root, "tools/czech-ml/data/word-world/standard-v0.1/rubric.json");
      const { authoring, runtime, validation } = czechRuntimeRecords(document, rubric);
      const manifestPath = course.resources.wordWorldManifest.path;
      const manifest = await readRepositoryJson(root, manifestPath);
      const coverage = buildCoverageReport(authoring, rubric, validation, [sourcePath]);
      const bytes = JSON.stringify({ schemaVersion: "caatuu-word-world-runtime-v1", corpusVersion: document.metadata.corpusVersion, records: runtime }) + "\n";
      const contentSha256 = sha(bytes);
      const oldRuntimeFile = manifest.runtimeFile;
      Object.assign(manifest, {
        corpusVersion: document.metadata.corpusVersion, runtimeFile: `content.json?v=${contentSha256.slice(0, 16)}`,
        recordCount: runtime.length, contentSha256, difficultyDistribution: coverage.records.byDifficulty,
        difficultyShare: coverage.records.difficultyShare, playableTargets: coverage.targets.uniquePlayable,
        branchability: { ...manifest.branchability, branchableTargets: coverage.targets.branchable.targetCount,
          strongTargets: coverage.targets.strong.targetCount },
        authoringFile: sourcePath, authoringSchema: document.schemaVersion
      });
      add(path.posix.join(path.posix.dirname(manifestPath), "content.json"), bytes);
      add(manifestPath, manifest);
      add("tools/czech-ml/data/word-world/standard-v0.1/reports/coverage.json", coverage);
      add("tools/czech-ml/data/word-world/standard-v0.1/reports/validation.json", {
        schemaVersion: "caatuu-word-world-validation-v1", corpusVersion: document.metadata.corpusVersion,
        inputFiles: [sourcePath], ...validation
      });
      // Preserve the content-addressed offline URL when only this JSON changes.
      const setupPath = `apps/languages/${course.directoryName}/static/setup-assets.json`;
      const setup = await readRepositoryJson(root, setupPath);
      const base = "./data/games/word-world/";
      const previous = base + oldRuntimeFile, next = base + manifest.runtimeFile;
      if (previous !== next) {
        assert.ok(setup.offline.assets.includes(previous), "Czech offline content URL is missing");
        setup.offline.assets = setup.offline.assets.map(value => value === previous ? next : value);
        add(setupPath, setup);
      }
    }
    const runtimeChanged = (await Promise.all([...outputs].filter(([file]) => file.includes("/static/")).map(async ([file, bytes]) => {
      const existing = await readFile(path.resolve(root, file), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
      return existing !== bytes;
    }))).some(Boolean);
    if (runtimeChanged) {
      const setupPath = course.resources.setupCatalog.path;
      const setup = outputs.has(setupPath) ? JSON.parse(outputs.get(setupPath)) : await readRepositoryJson(root, setupPath);
      const swPath = `apps/languages/${course.directoryName}/static/sw.js`;
      const sw = await readFile(await outputPath(root, swPath), "utf8");
      const previous = setup.offline.cacheName;
      assert.match(previous, /-v\d+$/u, "Expected the course's numbered offline cache");
      const next = previous.replace(/\d+$/u, number => String(Number(number) + 1));
      assert.ok(sw.includes(`Offline catalog revision: ${previous}`), "Service worker cache marker mismatch");
      setup.offline.cacheName = next;
      add(setupPath, setup);
      add(swPath, sw.replace(`Offline catalog revision: ${previous}`, `Offline catalog revision: ${next}`));
    }
    // Resolve every destination before any course is written. A malformed
    // source or escaped path cannot partially update earlier courses.
    for (const file of outputs.keys()) await outputPath(root, file);
    result.push({ courseId: course.id, sourcePath, recordCount: document.records.length, outputs });
  }
  const owners = new Map();
  for (const plan of result) for (const [file, bytes] of plan.outputs) {
    if (owners.has(file)) assert.equal(owners.get(file), bytes, `${file}: courses disagree on generated output`);
    owners.set(file, bytes);
  }
  return result;
}

export async function buildWordWorldContent(options = {}) {
  const root = options.root ?? repositoryRoot;
  const plans = await planWordWorldContent(options);
  const courses = [];
  for (const plan of plans) {
    const changes = [];
    for (const [file, bytes] of plan.outputs) {
      const destination = await outputPath(root, file);
      const existing = await readFile(destination, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (existing === bytes) continue;
      changes.push(file);
      if (!options.check) {
        const temporary = `${destination}.tmp-${process.pid}`;
        await writeFile(temporary, bytes, { flag: "wx" });
        await rename(temporary, destination);
      }
    }
    courses.push({ courseId: plan.courseId, sourcePath: plan.sourcePath, recordCount: plan.recordCount, changes });
  }
  return { check: Boolean(options.check), courses, changes: courses.flatMap(item => item.changes),
    recordCount: courses.reduce((sum, item) => sum + item.recordCount, 0) };
}

async function outputPath(root, file) {
  assert.ok(typeof file === "string" && file && !file.includes("\\") && !path.posix.isAbsolute(file)
    && path.posix.normalize(file) === file && !file.split("/").includes(".."), `Invalid output path: ${file}`);
  const realRoot = await realpath(root), target = path.resolve(realRoot, file);
  assert.ok(target.startsWith(realRoot + path.sep), `Output escapes repository: ${file}`);
  assert.equal(await realpath(path.dirname(target)), path.dirname(target), `Noncanonical output parent: ${file}`);
  try { assert.equal(await realpath(target), target, `Noncanonical output: ${file}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return target;
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--all") continue;
    if (arg === "--check") options.check = true;
    else if (arg === "--course") { options.courseId = process.argv[++i]; assert.ok(options.courseId, "--course needs an ID"); }
    else if (arg === "--repo-root") options.root = process.argv[++i];
    else throw new Error(`Unknown argument ${arg}`);
  }
  const report = await buildWordWorldContent(options);
  for (const course of report.courses) console.log(`${course.courseId}: ${course.recordCount} records; ${course.changes.length} ${report.check ? "stale" : "updated"} generated files (${course.sourcePath}).`);
  if (report.check && report.changes.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
