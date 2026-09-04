import assert from "node:assert/strict";

const SAFE_STORAGE_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SAFE_FILE_BASENAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const DIRECTION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ARTIFACT_KIND_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SETUP_ASSET_ORIGIN = "https://caatuu.waajacu.com";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertTrimmedNonblankString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value && value === value.trim(), `${label} must be nonblank and trimmed`);
  return value;
}

export function assertSafeStorageKey(value, label) {
  const key = assertTrimmedNonblankString(value, label);
  assert.match(key, SAFE_STORAGE_KEY_PATTERN, `${label} must be a stable safe storage key`);
  return key;
}

export function assertSafeRelativePath(value, label) {
  const path = assertTrimmedNonblankString(value, label);
  assert.ok(!path.startsWith("/") && !path.includes("\\"), `${label} must be a relative forward-slash path`);
  assert.ok(
    path.split("/").every((segment) =>
      segment !== "." && segment !== ".." && SAFE_FILE_BASENAME_PATTERN.test(segment)
    ),
    `${label} must be normalized and confined`,
  );
  return path;
}

export function assertNormalizedRelativePath(value, label) {
  const path = assertTrimmedNonblankString(value, label);
  assert.ok(!path.startsWith("/") && !path.includes("\\"), `${label} must be a relative forward-slash path`);
  assert.ok(
    path.split("/").every((segment) =>
      segment && segment !== "." && segment !== ".." && !/[\u0000-\u001f\u007f]/u.test(segment)
    ),
    `${label} must be normalized and confined`,
  );
  return path;
}

export function assertSafeFileBasename(value, label) {
  const file = assertTrimmedNonblankString(value, label);
  assert.match(file, SAFE_FILE_BASENAME_PATTERN, `${label} must be an exact safe file basename`);
  assert.ok(file !== "." && file !== "..", `${label} must be an exact safe file basename`);
  return file;
}

export function assertCanonicalPositiveBytes(value, label) {
  assert.ok(
    Number.isSafeInteger(value) && value > 0,
    `${label} must be a positive safe integer byte count in the canonical bytes field`,
  );
  return value;
}

export function assertHttpsUrl(value, label) {
  const rawUrl = assertTrimmedNonblankString(value, label);
  assert.doesNotMatch(rawUrl, /\s/u, `${label} must not contain whitespace`);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    assert.fail(`${label} must be an absolute HTTPS URL`);
  }
  assert.equal(url.protocol, "https:", `${label} must use HTTPS`);
  assert.ok(url.hostname, `${label} must identify an HTTPS host`);
  assert.equal(url.username, "", `${label} must not contain credentials`);
  assert.equal(url.password, "", `${label} must not contain credentials`);
  return rawUrl;
}

export function assertSha256(value, label) {
  const sha256 = assertTrimmedNonblankString(value, label);
  assert.match(sha256, SHA256_PATTERN, `${label} must be a lowercase SHA-256`);
  return sha256;
}

export function assertArtifactKind(value, label) {
  const artifactKind = assertTrimmedNonblankString(value, label);
  assert.match(artifactKind, ARTIFACT_KIND_PATTERN, `${label} must be a stable artifact kind`);
  return artifactKind;
}

export function resolveAndAssertHttpsUrl(baseUrl, reference, label) {
  const base = assertHttpsUrl(baseUrl, `${label} base URL`);
  const rawReference = assertTrimmedNonblankString(reference, label);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(rawReference) && !rawReference.startsWith("/")) {
    assertSafeRelativePath(rawReference, `${label} path`);
  }
  let resolved;
  try {
    resolved = new URL(rawReference, base.endsWith("/") ? base : `${base}/`);
  } catch {
    assert.fail(`${label} must resolve to an HTTPS URL`);
  }
  assertHttpsUrl(resolved.href, label);
  return resolved.href;
}

export function assertDictionaryArtifactContract(active, course, label) {
  assert.ok(isObject(active), `${label} default dictionary must be an object`);
  const key = assertSafeStorageKey(active.key, `${label} key`);
  assert.equal(active.status, "active", `${label} default dictionary must be active`);
  assert.equal(
    assertArtifactKind(active.artifact_kind, `${label} artifact_kind`),
    "dictionary-database",
    `${label} dictionary artifact kind is incorrect`,
  );
  assertTrimmedNonblankString(active.label, `${label} label`);
  const direction = assertTrimmedNonblankString(active.direction, `${label} direction`);
  assert.match(direction, DIRECTION_PATTERN, `${label} direction is invalid`);
  if (course) {
    const targetLanguageId = assertTrimmedNonblankString(
      course.targetLanguage?.id,
      `${label} course target language ID`,
    );
    assert.equal(
      direction,
      `${targetLanguageId}-en`,
      `${label} direction must map the course target language to English`,
    );
  }
  assertSafeRelativePath(active.database_file, `${label} database_file`);
  assertCanonicalPositiveBytes(active.bytes, `${label} bytes`);
  assertSha256(active.sha256, `${label} sha256`);
  assertHttpsUrl(active.download_url, `${label} download_url`);
  return Object.freeze({ key, active });
}

export function activeDictionaryStorageKeys(catalog, label) {
  assert.ok(isObject(catalog), `${label} must be an object`);
  assert.ok(Array.isArray(catalog.dictionaries), `${label} must list dictionaries`);
  return catalog.dictionaries
    .filter((dictionary) => dictionary?.status === "active")
    .map((dictionary, index) => assertSafeStorageKey(
      dictionary?.key,
      `${label} active dictionary ${index} key`,
    ));
}

export function assertEmbeddingArtifactContract(active, manifest, baseUrl, label) {
  assert.ok(isObject(active), `${label} active embedding model must be an object`);
  assert.ok(isObject(manifest), `${label} embedding manifest must be an object`);
  const modelFile = assertSafeRelativePath(active.model_file, `${label} embedding model_file`);
  const manifestFile = assertSafeFileBasename(manifest.file, `${label} embedding manifest file`);
  assert.equal(
    modelFile.split("/").at(-1),
    manifestFile,
    `${label} embedding manifest file must match the catalog model_file basename`,
  );
  const catalogBytes = assertCanonicalPositiveBytes(active.bytes, `${label} embedding catalog bytes`);
  const manifestBytes = assertCanonicalPositiveBytes(manifest.bytes, `${label} embedding manifest bytes`);
  assert.equal(manifestBytes, catalogBytes, `${label} embedding manifest bytes must match the catalog`);
  assertArtifactKind(active.artifact_kind, `${label} embedding artifact_kind`);
  assertSha256(active.sha256, `${label} embedding sha256`);
  assert.equal(manifest.sha256, active.sha256, `${label} embedding manifest SHA-256 must match the catalog`);
  assert.equal(
    manifest.url,
    modelFile,
    `${label} embedding manifest URL must equal the catalog model_file`,
  );
  resolveAndAssertHttpsUrl(baseUrl, modelFile, `${label} embedding manifest URL`);
  return manifest;
}

function storageRecord({
  courseId,
  storagePath,
  source,
  declaredPath,
  bytes,
  sha256,
  artifactKind,
}, label) {
  return Object.freeze({
    courseId: assertTrimmedNonblankString(courseId, `${label} courseId`),
    storagePath: assertNormalizedRelativePath(storagePath, `${label} storage path`),
    source: assertHttpsUrl(source, `${label} source`),
    declaredPath: assertNormalizedRelativePath(declaredPath, `${label} declared path`),
    bytes: assertCanonicalPositiveBytes(bytes, `${label} bytes`),
    sha256: assertSha256(sha256, `${label} sha256`),
    artifactKind: assertArtifactKind(artifactKind, `${label} artifact kind`),
  });
}

export function dictionaryStorageRecord(active, course, courseId, label) {
  const { key } = assertDictionaryArtifactContract(active, course, label);
  const databasePath = assertSafeRelativePath(active.database_file, `${label} database_file`);
  return storageRecord({
    courseId,
    // A dictionary key owns its directory: course-scoped deletion operates at this boundary.
    storagePath: `dictionaries/${key}`,
    source: active.download_url,
    declaredPath: databasePath,
    bytes: active.bytes,
    sha256: active.sha256,
    artifactKind: active.artifact_kind,
  }, label);
}

export function embeddingStorageRecord(active, manifest, baseUrl, courseId, label) {
  assertEmbeddingArtifactContract(active, manifest, baseUrl, label);
  const fileName = assertSafeFileBasename(manifest.file, `${label} embedding manifest file`);
  return storageRecord({
    courseId,
    storagePath: `vector-dbs/${fileName}`,
    source: resolveAndAssertHttpsUrl(baseUrl, active.model_file, `${label} embedding manifest URL`),
    declaredPath: active.model_file,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    artifactKind: active.artifact_kind,
  }, label);
}

export function setupStorageRecord(artifact, courseId, label) {
  assert.ok(isObject(artifact), `${label} must be an object`);
  assert.equal(artifact.native_required, true, `${label} must be required by the native setup manager`);
  const authoredPath = assertNormalizedRelativePath(artifact.asset_path, `${label} asset_path`);
  const packagedPath = authoredPath.startsWith("assets/") || authoredPath.startsWith("language-runtime/")
    ? authoredPath
    : `courses/${assertSafeStorageKey(courseId, `${label} courseId`)}/${authoredPath}`;
  const source = resolveAndAssertHttpsUrl(SETUP_ASSET_ORIGIN, artifact.url, `${label} URL`);
  return storageRecord({
    courseId,
    storagePath: `setup-assets/${packagedPath}`,
    source,
    declaredPath: packagedPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    artifactKind: artifact.artifact_kind,
  }, label);
}

export function assertCompatibleSharedStorage(records, label = "Android course bundle") {
  assert.ok(Array.isArray(records), `${label} storage records must be an array`);
  const ownerByPath = new Map();
  for (const [index, rawRecord] of records.entries()) {
    assert.ok(isObject(rawRecord), `${label} storage record ${index} must be an object`);
    const record = storageRecord(rawRecord, `${label} storage record ${index}`);
    const existing = ownerByPath.get(record.storagePath);
    if (existing) {
      for (const field of ["source", "declaredPath", "bytes", "sha256", "artifactKind"]) {
        assert.equal(
          record[field],
          existing[field],
          `${label} shared storage path ${record.storagePath} has conflicting ${field} ` +
            `for courses ${existing.courseId} and ${record.courseId}`,
        );
      }
    } else {
      ownerByPath.set(record.storagePath, record);
    }
  }
  return Object.freeze(records.map((record) => Object.freeze({ ...record })));
}

export function assertUniqueActiveDictionaryKeys(records, label = "Android course bundle") {
  assert.ok(Array.isArray(records), `${label} dictionary records must be an array`);
  const ownerByKey = new Map();
  for (const [index, record] of records.entries()) {
    assert.ok(isObject(record), `${label} dictionary record ${index} must be an object`);
    const courseId = assertTrimmedNonblankString(record.courseId, `${label} dictionary record ${index} courseId`);
    const key = assertSafeStorageKey(record.key, `${label} dictionary record ${index} key`);
    const existingOwner = ownerByKey.get(key);
    assert.equal(
      existingOwner,
      undefined,
      `${label} active dictionary storage key ${key} is shared by courses ${existingOwner} and ${courseId}`,
    );
    ownerByKey.set(key, courseId);
  }
  return records;
}
