import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAndroidCourseBundlePlan,
  createAndroidCoursePublicationPlan,
} from "../android-course-bundle-plan.mjs";
import {
  loadAndroidCourseBundleCatalogPlan,
  productCapabilitiesForCourse,
} from "../build-product-assets.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function currentInputs() {
  const catalog = readJson(join(workspaceRoot, "apps/languages/catalog.json"));
  const courses = catalog.courses.map((entry) => ({
    id: entry.id,
    manifestPath: entry.manifest,
    course: readJson(join(workspaceRoot, entry.manifest)),
  }));
  const bundleDeclaration = readJson(join(workspaceRoot, "apps/android/course-bundle.json"));
  return { catalog, courses, bundleDeclaration };
}

function inputsWithThirdCourse() {
  const input = currentInputs();
  const third = structuredClone(input.courses.find(({ id }) => id === "zh"));
  third.id = "fr-es";
  third.manifestPath = "apps/languages/spanish-from-french/course.json";
  third.course.id = "fr-es";
  third.course.directoryName = "spanish-from-french";
  third.course.routePrefix = "/learn-spanish";
  third.course.entryPath = "/learn-spanish/index.html";
  third.course.workspaceLabel = "Caatuu Spanish";
  third.course.sourceLanguage = {
    ...third.course.sourceLanguage,
    id: "fr",
    label: "French",
    nativeLabel: "Français",
    shortCode: "FR",
    locale: "fr",
  };
  third.course.targetLanguage = {
    ...third.course.targetLanguage,
    id: "es",
    label: "Spanish",
    nativeLabel: "Español",
    locale: "es-ES",
    script: "Latn",
    speechLocale: "es-ES",
  };
  input.catalog.courses.push({ id: "fr-es", manifest: third.manifestPath });
  input.courses.push(third);
  input.bundleDeclaration.courses.push({ manifest: third.manifestPath });
  return input;
}

function publicationRecords(input) {
  return input.bundleDeclaration.courses.map(({ manifest }) => {
    const record = input.courses.find(({ manifestPath }) => manifestPath === manifest);
    const { course } = record;
    const assetPrefix = `courses/${course.id}`;
    const providers = {};
    if (course.capabilities.embeddings) {
      providers.embeddings = {
        implementation: course.id === "cz" ? "vector-database-catalog-v1" : "webview-english-minilm-v1",
        catalogAsset: `${assetPrefix}/data/embeddings/catalog.json`,
      };
    }
    if (course.capabilities.dictionary) {
      providers.dictionary = {
        implementation: "sqlite-dictionary-catalog-v1",
        catalogAsset: `${assetPrefix}/data/dictionaries/catalog.json`,
      };
    }
    if (course.capabilities.speech) {
      providers.speech = {
        implementation: "android-text-to-speech-v1",
        locale: course.targetLanguage.speechLocale,
      };
    }
    return {
      id: course.id,
      routePrefix: course.routePrefix,
      entryPath: course.entryPath,
      assetPrefix,
      sourceLanguage: {
        id: course.sourceLanguage.id,
        label: course.sourceLanguage.label,
        locale: course.sourceLanguage.locale,
      },
      targetLanguage: {
        id: course.targetLanguage.id,
        label: course.targetLanguage.label,
        nativeLabel: course.targetLanguage.nativeLabel,
        locale: course.targetLanguage.locale,
        script: course.targetLanguage.script,
        speechLocale: course.targetLanguage.speechLocale,
      },
      capabilities: productCapabilitiesForCourse(course),
      nativeProviders: { schemaVersion: 1, providers },
    };
  });
}

test("the Android product bundle is the ordered projection of Android-enabled catalog courses", () => {
  const expected = createAndroidCourseBundlePlan(currentInputs());
  assert.deepEqual(expected, {
    defaultCourseId: "cz",
    courses: [
      { id: "cz", manifestPath: "apps/languages/czech/course.json" },
      { id: "zh", manifestPath: "apps/languages/mandarin-simplified/course.json" },
    ],
  });
  const loaded = loadAndroidCourseBundleCatalogPlan({ workspaceRoot });
  assert.deepEqual(loaded.plan, expected);
  assert.deepEqual(
    loaded.publicationPlan.courses.map(({ id, routePrefix, entryPath }) => ({ id, routePrefix, entryPath })),
    [
      { id: "cz", routePrefix: "/cz", entryPath: "/cz/index.html" },
      { id: "zh", routePrefix: "/zh", entryPath: "/zh/index.html" },
    ],
  );
});

test("the Android publication plan admits a non-English learner base without coupling its route to its id", () => {
  const input = inputsWithThirdCourse();
  const publicationPlan = createAndroidCoursePublicationPlan(input, publicationRecords(input));
  assert.deepEqual(publicationPlan.courses.map(({ id, routePrefix, sourceLanguage, targetLanguage }) => ({
    id,
    routePrefix,
    sourceLanguage: sourceLanguage.id,
    targetLanguage: targetLanguage.id,
  })), [
    { id: "cz", routePrefix: "/cz", sourceLanguage: "en", targetLanguage: "cs" },
    { id: "zh", routePrefix: "/zh", sourceLanguage: "en", targetLanguage: "zh" },
    { id: "fr-es", routePrefix: "/learn-spanish", sourceLanguage: "fr", targetLanguage: "es" },
  ]);
});

test("the Android bundle fails closed when it omits an enabled known course", () => {
  const input = currentInputs();
  input.bundleDeclaration.courses = input.bundleDeclaration.courses.filter(
    ({ manifest }) => manifest !== "apps/languages/mandarin-simplified/course.json",
  );
  assert.throws(
    () => createAndroidCourseBundlePlan(input),
    /missing Android-enabled catalog courses: zh \(apps\/languages\/mandarin-simplified\/course\.json\)/u,
  );
});

test("the Android bundle rejects a known course after its Android platform is disabled", () => {
  const input = currentInputs();
  const mandarin = input.courses.find(({ id }) => id === "zh");
  mandarin.course.platforms.android.enabled = false;
  assert.throws(
    () => createAndroidCourseBundlePlan(input),
    /absent from the catalog or not Android-enabled: zh \(apps\/languages\/mandarin-simplified\/course\.json\)/u,
  );
});

test("the Android bundle rejects a declaration absent from the language catalog", () => {
  const input = currentInputs();
  input.bundleDeclaration.courses.push({ manifest: "apps/languages/unknown/course.json" });
  assert.throws(
    () => createAndroidCourseBundlePlan(input),
    /absent from the catalog or not Android-enabled: apps\/languages\/unknown\/course\.json/u,
  );
});

test("the Android bundle preserves catalog order and the catalog default", () => {
  const reordered = currentInputs();
  reordered.bundleDeclaration.courses.reverse();
  assert.throws(
    () => createAndroidCourseBundlePlan(reordered),
    /must follow Android-enabled language catalog order/u,
  );

  const changedDefault = currentInputs();
  changedDefault.bundleDeclaration.defaultCourseId = "zh";
  assert.throws(
    () => createAndroidCourseBundlePlan(changedDefault),
    /defaultCourseId must match the language catalog defaultCourseId/u,
  );
});

test("the Gradle product task tracks the catalog that the asset compiler validates", () => {
  const gradle = readFileSync(join(workspaceRoot, "apps/android/product/build.gradle.kts"), "utf8");
  assert.match(gradle, /val languageCatalogRelativePath = confinedWorkspaceRelativePath\([\s\S]*"apps\/languages\/catalog\.json"[\s\S]*"language catalog"/u);
  assert.match(gradle, /val languageCatalogFile = workspaceRootDir\.file\(languageCatalogRelativePath\)/u);
  assert.match(gradle, /val courseBundlePlanner = workspaceRootDir\.file\("apps\/android\/tooling\/android-course-bundle-plan\.mjs"\)/u);
  assert.match(gradle, /val androidArtifactContract = workspaceRootDir\.file\("apps\/android\/tooling\/android-artifact-contract\.mjs"\)/u);
  assert.match(gradle, /inputs\.file\(courseBundlePlanner\)/u);
  assert.match(gradle, /inputs\.file\(androidArtifactContract\)/u);
  assert.match(gradle, /inputs\.file\(languageCatalogFile\)/u);
  assert.match(gradle, /inputs\.files\(languageCatalogCourseManifestFiles\)/u);
});

test("Android Gradle configuration delegates learner-base readiness and English authority to the course contract", () => {
  const productGradle = readFileSync(join(workspaceRoot, "apps/android/product/build.gradle.kts"), "utf8");
  const legacyGradle = readFileSync(join(workspaceRoot, "apps/android/app/build.gradle.kts"), "utf8");
  for (const [label, gradle] of [["product", productGradle], ["legacy", legacyGradle]]) {
    assert.match(
      gradle,
      /val courseSourceLanguage = requiredObject\(courseManifest\["sourceLanguage"\], "sourceLanguage"\)/u,
      `${label} build must still validate the source-language object`,
    );
    assert.match(
      gradle,
      /requiredString\(courseSourceLanguage\["label"\], "sourceLanguage\.label"\)/u,
      `${label} build must still require source-language presentation`,
    );
    assert.doesNotMatch(
      gradle,
      /courseSourceLanguage\["id"\]\s*==\s*"en"|semantic mediation currently requires English as sourceLanguage\.id/u,
      `${label} build must not confuse the learner base with the English audit authority`,
    );
  }

  const releaseBuilder = readFileSync(join(workspaceRoot, "apps/android/tooling/build-release-aab.sh"), "utf8");
  const languageValidation = releaseBuilder.indexOf(
    'node "$repo_root/tools/language-packs/validate.mjs" --check-views',
  );
  const gradleBuild = releaseBuilder.indexOf("gradle --no-daemon");
  assert.ok(languageValidation >= 0 && languageValidation < gradleBuild);

  const courseContract = readFileSync(join(workspaceRoot, "tools/language-packs/lib/course-contract.mjs"), "utf8");
  assert.match(courseContract, /content\.roles\.auditLanguage !== ENGLISH_AUDIT_LANGUAGE/u);
  assert.match(courseContract, /content\.roles\.retrievalLanguage !== ENGLISH_AUDIT_LANGUAGE/u);
  assert.match(courseContract, /requires reviewed learnerBaseRealizations/u);
});
