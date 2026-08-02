import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  computeBindingRegistryDigest,
  computeCanonicalContractDigest,
  computeSourceCatalogDigest,
  computeTargetPackDigest
} from "../../../curriculum/runtime/curriculum-runtime-core.mjs";

const repoRoot = new URL("../../../../", import.meta.url);
const curriculumRoot = new URL("apps/curriculum/", repoRoot);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);
const runtimeDataRoot = new URL("data/curriculum/", staticRoot);

const [
  profileSource,
  facadeSource,
  indexHtml,
  wordWorldHtml,
  serviceWorker,
  sourceCore,
  runtimeCore,
  sourcePlanner,
  runtimePlanner,
  sourceService,
  runtimeService,
  sourceGuidedOpportunity,
  runtimeGuidedOpportunity,
  sourceMorphologyRound,
  runtimeMorphologyRound,
  curriculum,
  targetPack,
  sourceCatalog,
  bindingRegistry
] = await Promise.all([
  readFile(new URL("course-profile.js", staticRoot), "utf8"),
  readFile(new URL("curriculum-service.js", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("runtime/curriculum-runtime-core.mjs", curriculumRoot), "utf8"),
  readFile(new URL("curriculum/curriculum-runtime-core.mjs", staticRoot), "utf8"),
  readFile(new URL("runtime/curriculum-planner-core.mjs", curriculumRoot), "utf8"),
  readFile(new URL("curriculum/curriculum-planner-core.mjs", staticRoot), "utf8"),
  readFile(new URL("runtime/curriculum-service.mjs", curriculumRoot), "utf8"),
  readFile(new URL("curriculum/curriculum-service.mjs", staticRoot), "utf8"),
  readFile(new URL("runtime/guided-opportunity.mjs", curriculumRoot), "utf8"),
  readFile(new URL("curriculum/guided-opportunity.mjs", staticRoot), "utf8"),
  readFile(new URL("runtime/morphology-round-core.mjs", curriculumRoot), "utf8"),
  readFile(new URL("curriculum/morphology-round-core.mjs", staticRoot), "utf8"),
  readFile(new URL("canonical-curriculum.v1.en.json", runtimeDataRoot), "utf8").then(JSON.parse),
  readFile(new URL("cs-CZ.realization-pack.v1.json", runtimeDataRoot), "utf8").then(JSON.parse),
  readFile(new URL("pilot-content-sources.v1.json", runtimeDataRoot), "utf8").then(JSON.parse),
  readFile(new URL("cs-CZ.cross-game-bindings.v1.json", runtimeDataRoot), "utf8").then(JSON.parse)
]);

const context = { window: {} };
vm.runInNewContext(profileSource, context, { filename: "course-profile.js" });
const course = context.window.CaatuuCourse;

test("runtime curriculum copies are byte-identical to their authoritative component sources", () => {
  assert.equal(runtimeCore, sourceCore);
  assert.equal(runtimePlanner, sourcePlanner);
  assert.equal(runtimeService, sourceService);
  assert.equal(runtimeGuidedOpportunity, sourceGuidedOpportunity);
  assert.equal(runtimeMorphologyRound, sourceMorphologyRound);
});

test("the immutable course profile pins every runtime authority and keeps release disabled", async () => {
  assert.ok(Object.isFrozen(course.curriculum));
  assert.ok(Object.isFrozen(course.curriculum.releasePins));
  assert.deepEqual(JSON.parse(JSON.stringify(course.curriculum.paths)), {
    canonicalManifest: "data/curriculum/canonical-curriculum.v1.en.json",
    realizationPack: "data/curriculum/cs-CZ.realization-pack.v1.json",
    sourceCatalog: "data/curriculum/pilot-content-sources.v1.json",
    bindingRegistry: "data/curriculum/cs-CZ.cross-game-bindings.v1.json",
    sharedMechanicCapabilities: "data/curriculum/shared-mechanic-capabilities.v1.en.json",
    morphologyCatalog: "data/curriculum/cs-CZ.morphology-developer-pilot.v1.json"
  });
  const pins = course.curriculum.releasePins;
  assert.equal(pins.canonicalContractDigest, await computeCanonicalContractDigest(curriculum));
  assert.equal(pins.targetPackDigest, await computeTargetPackDigest(targetPack));
  assert.equal(pins.sourceCatalogDigest, await computeSourceCatalogDigest(sourceCatalog));
  assert.equal(pins.bindingRegistryDigest, await computeBindingRegistryDigest(bindingRegistry));
  assert.equal(course.curriculum.guidedMode.developerOnly, true);
  assert.equal(course.curriculum.approval.status, "prototype-not-human-approved");
  assert.equal(course.curriculum.approval.releaseEnabled, false);
  assert.equal(Object.hasOwn(course.curriculum, "approvalAttestation"), false);
  assert.equal(
    course.curriculum.verbExerciseFamilies.families.morphology.targetSkillId,
    "cs.skill.form.cist.present-singular-person"
  );
});

test("only game pages install the synchronous curriculum facade in dependency order", () => {
  for (const [name, source, gameScript] of [
    ["index.html", indexHtml, 'src="app.js?v=shell-81"'],
    ["word-net.html", wordWorldHtml, 'src="word-net.js?v=word-net-72"']
  ]) {
    const courseIndex = source.indexOf('src="course-profile.js?v=course-12"');
    const runtimeIndex = source.indexOf('src="runtime.js?v=runtime-34"');
    const semanticIndex = source.indexOf('src="semantic-learning.js?v=semantic-learning-7"');
    const curriculumIndex = source.indexOf('src="curriculum-service.js?v=curriculum-service-9"');
    const gameIndex = source.indexOf(gameScript);
    assert.ok(courseIndex >= 0, `${name} must load the course profile`);
    assert.ok(runtimeIndex > courseIndex, `${name} must load runtime after the profile`);
    assert.ok(semanticIndex > runtimeIndex, `${name} must load semantic learning after runtime`);
    assert.ok(curriculumIndex > semanticIndex, `${name} must expose the curriculum facade after semantic learning`);
    assert.ok(gameIndex > curriculumIndex, `${name} game code must load after the curriculum facade`);
  }
  assert.match(facadeSource, /window\.CaatuuCurriculum = Object\.freeze/);
  for (const method of [
    "ready",
    "developerPilotModeEnabled",
    "resolveBinding",
    "issueTask",
    "beginOpportunity",
    "recordEvidence",
    "recordExposure",
    "claimDeveloperPilot",
    "claimDeveloperPilotSequence",
    "completeDeveloperPilotStep",
    "saveMorphologyRoundState",
    "restoreMorphologyRoundState",
    "resetProgress",
    "skillSummary",
    "progression",
    "nextRequest"
  ]) {
    assert.match(facadeSource, new RegExp(`${method}:`), `facade must expose ${method}`);
  }
});

test("the service worker makes every pinned curriculum asset available offline", () => {
  assert.match(serviceWorker, /caatuu-czech-pwa-v387/);
  for (const asset of [
    "curriculum-service.js?v=curriculum-service-9",
    "curriculum/curriculum-service.mjs?v=curriculum-service-9",
    "curriculum/curriculum-runtime-core.mjs",
    "curriculum/curriculum-planner-core.mjs",
    "curriculum/guided-opportunity.mjs?v=guided-opportunity-5",
    "curriculum/morphology-round-core.mjs",
    "curriculum/morphology-round-core.mjs?v=morphology-round-core-2",
    "data/curriculum/canonical-curriculum.v1.en.json",
    "data/curriculum/cs-CZ.realization-pack.v1.json",
    "data/curriculum/pilot-content-sources.v1.json",
    "data/curriculum/cs-CZ.cross-game-bindings.v1.json",
    "data/curriculum/shared-mechanic-capabilities.v1.en.json",
    "data/curriculum/cs-CZ.morphology-developer-pilot.v1.json"
  ]) {
    assert.ok(serviceWorker.includes(`"./${asset}"`), `service worker must precache ${asset}`);
  }
  assert.match(sourceService, /fetchImpl\(path, \{ cache: "reload"/);
  assert.doesNotMatch(sourceService, /fetchImpl\(path, \{ cache: "no-store"/);
  assert.match(serviceWorker, /request\.cache === "reload"[\s\S]*?networkThenCache\(request\)/);
});
