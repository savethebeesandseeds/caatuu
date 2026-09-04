import assert from "node:assert/strict";

import {
  assertDictionaryArtifactContract,
  assertSafeStorageKey,
} from "./android-artifact-contract.mjs";

const courseIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const ANDROID_ENGLISH_AUDIT_LANGUAGE_ID = "en";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactObjectKeys(value, keys, label) {
  assert.ok(isObject(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unexpected or missing fields`);
}

function repositoryPath(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string path`);
  assert.ok(value && value === value.trim(), `${label} must be a nonblank trimmed path`);
  assert.ok(!value.startsWith("/") && !value.includes("\\"), `${label} must be repository-relative and use forward slashes`);
  assert.ok(
    value.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
    `${label} must be normalized and confined`,
  );
  return value;
}

function courseLabel(course) {
  return `${course.id} (${course.manifestPath})`;
}

export function assertAndroidDictionaryLanguageContract(catalog, course, label = "Android dictionary catalog") {
  assert.ok(isObject(catalog), `${label} must be an object`);
  assert.ok(isObject(course), `${label} course must be an object`);
  const defaultKey = catalog.default_dictionary ?? catalog.default_dictionary_key;
  assertSafeStorageKey(defaultKey, `${label} default dictionary`);
  assert.ok(Array.isArray(catalog.dictionaries), `${label} must list dictionaries`);
  const active = catalog.dictionaries.find((dictionary) => dictionary?.key === defaultKey);
  assert.ok(active, `${label} default dictionary is absent`);
  assertDictionaryArtifactContract(active, course, label);
  assert.equal(
    active.lookupLanguage,
    course.targetLanguage?.id,
    `${label} lookupLanguage must match the course target language`,
  );
  assert.equal(
    canonicalLanguageTag(active.lookupLanguageTag),
    canonicalLanguageTag(course.targetLanguage?.locale),
    `${label} lookupLanguageTag must match the exact course target locale and script`,
  );
  assert.equal(
    active.meaningLanguage,
    ANDROID_ENGLISH_AUDIT_LANGUAGE_ID,
    `${label} meaningLanguage must remain the immutable English audit language`,
  );
  assert.equal(
    canonicalLanguageTag(active.meaningLanguageTag),
    ANDROID_ENGLISH_AUDIT_LANGUAGE_ID,
    `${label} meaningLanguageTag must remain the immutable English audit language`,
  );
  if (course.targetLanguage?.script) {
    assert.equal(
      new Intl.Locale(canonicalLanguageTag(active.lookupLanguageTag)).maximize().script,
      course.targetLanguage.script,
      `${label} lookupLanguageTag script must match the course target script`,
    );
  }
  return active;
}

function canonicalLanguageTag(value) {
  const normalized = String(value || "").trim().replaceAll("_", "-");
  assert.ok(normalized, "language tag must be nonblank");
  return Intl.getCanonicalLocales(normalized)[0];
}

function requiredPublicationString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value && value === value.trim(), `${label} must be nonblank and trimmed`);
  return value;
}

function publicationLanguage(value, fields, label) {
  assert.ok(isObject(value), `${label} must be an object`);
  return Object.freeze(Object.fromEntries(fields.map((field) => [
    field,
    requiredPublicationString(value[field], `${label} ${field}`),
  ])));
}

function publicationCourseIdentity(record, plannedCourse) {
  const course = record.course;
  const routePrefix = requiredPublicationString(course.routePrefix, `${plannedCourse.id} routePrefix`);
  assert.match(
    routePrefix,
    /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    `${plannedCourse.id} routePrefix is invalid`,
  );
  const entryPath = requiredPublicationString(course.entryPath, `${plannedCourse.id} entryPath`);
  assert.ok(
    entryPath.startsWith(`${routePrefix}/`) &&
      !entryPath.includes("\\") &&
      entryPath.slice(routePrefix.length + 1).split("/").every(
        (segment) => segment && segment !== "." && segment !== "..",
      ),
    `${plannedCourse.id} entryPath must be normalized and inside routePrefix`,
  );
  return Object.freeze({
    id: plannedCourse.id,
    manifestPath: plannedCourse.manifestPath,
    routePrefix,
    entryPath,
    sourceLanguage: publicationLanguage(course.sourceLanguage, ["id", "label", "locale"], `${plannedCourse.id} sourceLanguage`),
    targetLanguage: publicationLanguage(
      course.targetLanguage,
      ["id", "label", "nativeLabel", "locale", "script", "speechLocale"],
      `${plannedCourse.id} targetLanguage`,
    ),
  });
}

export function createAndroidCourseBundlePlan({ catalog, courses, bundleDeclaration }) {
  exactObjectKeys(
    catalog,
    ["$schema", "schemaVersion", "defaultCourseId", "reservedRoutePrefixes", "courses"],
    "Language catalog",
  );
  assert.equal(catalog.schemaVersion, 1, "Language catalog must use schemaVersion 1");
  assert.match(String(catalog.defaultCourseId || ""), courseIdPattern, "Language catalog default course ID is invalid");
  assert.ok(Array.isArray(catalog.courses) && catalog.courses.length > 0, "Language catalog must list courses");
  assert.ok(Array.isArray(courses), "Loaded language catalog courses must be an array");
  assert.equal(courses.length, catalog.courses.length, "Every language catalog course must have one loaded manifest");

  const recordsById = new Map();
  for (const record of courses) {
    assert.ok(isObject(record), "Loaded language catalog course must be an object");
    assert.match(String(record.id || ""), courseIdPattern, "Loaded language catalog course ID is invalid");
    assert.ok(!recordsById.has(record.id), `Loaded language catalog course is repeated: ${record.id}`);
    recordsById.set(record.id, record);
  }

  const catalogRecords = catalog.courses.map((entry, index) => {
    exactObjectKeys(entry, ["id", "manifest"], `Language catalog course ${index}`);
    assert.match(String(entry.id || ""), courseIdPattern, `Language catalog course ${index} ID is invalid`);
    const manifestPath = repositoryPath(entry.manifest, `Language catalog course ${entry.id} manifest`);
    const record = recordsById.get(entry.id);
    assert.ok(record, `Language catalog course has no loaded manifest: ${entry.id}`);
    assert.equal(record.manifestPath, manifestPath, `${entry.id} loaded manifest path disagrees with the catalog`);
    assert.ok(isObject(record.course), `${entry.id} course manifest must be an object`);
    assert.equal(record.course.id, entry.id, `${entry.id} course manifest ID disagrees with the catalog`);
    assert.equal(
      typeof record.course.platforms?.android?.enabled,
      "boolean",
      `${entry.id} Android enabled flag must be boolean`,
    );
    return Object.freeze({
      id: entry.id,
      manifestPath,
      androidEnabled: record.course.platforms.android.enabled,
    });
  });
  assert.equal(recordsById.size, catalogRecords.length, "Loaded language manifests must match the catalog exactly");

  exactObjectKeys(
    bundleDeclaration,
    ["$schema", "schemaVersion", "defaultCourseId", "courses"],
    "Android course bundle",
  );
  assert.equal(bundleDeclaration.schemaVersion, 1, "Android course bundle must use schemaVersion 1");
  assert.match(String(bundleDeclaration.defaultCourseId || ""), courseIdPattern, "Android default course ID is invalid");
  assert.ok(Array.isArray(bundleDeclaration.courses) && bundleDeclaration.courses.length > 0, "Android course bundle must list courses");

  const declaredManifestPaths = bundleDeclaration.courses.map((entry, index) => {
    exactObjectKeys(entry, ["manifest"], `Android course bundle course ${index}`);
    return repositoryPath(entry.manifest, `Android course bundle course ${index} manifest`);
  });
  assert.equal(
    new Set(declaredManifestPaths).size,
    declaredManifestPaths.length,
    "Android course bundle course manifests must be unique",
  );

  const androidCourses = catalogRecords.filter(({ androidEnabled }) => androidEnabled);
  assert.ok(androidCourses.length > 0, "Language catalog has no Android-enabled courses for the product bundle");
  assert.ok(
    androidCourses.some(({ id }) => id === catalog.defaultCourseId),
    `Language catalog default course ${catalog.defaultCourseId} must be enabled for Android`,
  );
  assert.equal(
    bundleDeclaration.defaultCourseId,
    catalog.defaultCourseId,
    "Android course bundle defaultCourseId must match the language catalog defaultCourseId",
  );

  const expectedByPath = new Map(androidCourses.map((course) => [course.manifestPath, course]));
  const allCatalogByPath = new Map(catalogRecords.map((course) => [course.manifestPath, course]));
  const declared = new Set(declaredManifestPaths);
  const missing = androidCourses.filter(({ manifestPath }) => !declared.has(manifestPath));
  assert.equal(
    missing.length,
    0,
    `Android course bundle is missing Android-enabled catalog courses: ${missing.map(courseLabel).join(", ")}`,
  );
  const extra = declaredManifestPaths.filter((manifestPath) => !expectedByPath.has(manifestPath));
  assert.equal(
    extra.length,
    0,
    `Android course bundle includes courses absent from the catalog or not Android-enabled: ${extra.map((manifestPath) => {
      const course = allCatalogByPath.get(manifestPath);
      return course ? courseLabel(course) : manifestPath;
    }).join(", ")}`,
  );
  assert.deepEqual(
    declaredManifestPaths,
    androidCourses.map(({ manifestPath }) => manifestPath),
    "Android course bundle courses must follow Android-enabled language catalog order",
  );

  return Object.freeze({
    defaultCourseId: catalog.defaultCourseId,
    courses: Object.freeze(androidCourses.map(({ id, manifestPath }) => Object.freeze({ id, manifestPath }))),
  });
}

export function createAndroidCoursePublicationPlan(input, publicationCourses) {
  const plan = createAndroidCourseBundlePlan(input);
  const recordsById = new Map(input.courses.map((record) => [record.id, record]));
  assert.ok(Array.isArray(publicationCourses), "Android publication courses must be an array");
  assert.equal(
    publicationCourses.length,
    plan.courses.length,
    "Every planned Android course must have one publication record",
  );
  const publicationById = new Map();
  for (const record of publicationCourses) {
    assert.ok(isObject(record), "Android publication course must be an object");
    assert.match(String(record.id || ""), courseIdPattern, "Android publication course ID is invalid");
    assert.ok(!publicationById.has(record.id), `Android publication course is repeated: ${record.id}`);
    publicationById.set(record.id, record);
  }
  return Object.freeze({
    defaultCourseId: plan.defaultCourseId,
    courses: Object.freeze(plan.courses.map((course) => {
      const identity = publicationCourseIdentity(recordsById.get(course.id), course);
      const published = publicationById.get(course.id);
      assert.ok(published, `Android publication record is missing for course ${course.id}`);
      exactObjectKeys(published, [
        "assetPrefix",
        "capabilities",
        "entryPath",
        "id",
        "nativeProviders",
        "routePrefix",
        "sourceLanguage",
        "targetLanguage",
      ], `Android publication course ${course.id}`);
      assert.equal(published.assetPrefix, `courses/${course.id}`, `${course.id} publication assetPrefix is invalid`);
      assert.equal(published.routePrefix, identity.routePrefix, `${course.id} publication routePrefix disagrees with its manifest`);
      assert.equal(published.entryPath, identity.entryPath, `${course.id} publication entryPath disagrees with its manifest`);
      assert.deepEqual(published.sourceLanguage, identity.sourceLanguage, `${course.id} publication sourceLanguage disagrees with its manifest`);
      assert.deepEqual(published.targetLanguage, identity.targetLanguage, `${course.id} publication targetLanguage disagrees with its manifest`);
      assert.ok(isObject(published.capabilities), `${course.id} publication capabilities must be an object`);
      assert.ok(isObject(published.nativeProviders), `${course.id} publication nativeProviders must be an object`);
      return Object.freeze({
        ...identity,
        assetPrefix: published.assetPrefix,
        capabilities: published.capabilities,
        nativeProviders: published.nativeProviders,
      });
    })),
  });
}
