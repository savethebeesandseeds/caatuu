import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCanonicalPositiveBytes,
  assertCompatibleSharedStorage,
  assertDictionaryArtifactContract,
  assertEmbeddingArtifactContract,
  assertSafeStorageKey,
  assertSetupArtifactMetadata,
  assertBundledSetupArtifacts,
  projectBundledSetupArtifacts,
  assertPublicSetupDependencies,
  embeddingStorageRecord,
  setupStorageRecord,
  assertUniqueActiveDictionaryKeys,
} from "../android-artifact-contract.mjs";

const course = Object.freeze({ targetLanguage: Object.freeze({ id: "cs" }) });

test("release preflight requires exact published bytes only for remaining native downloads", () => {
  const file = { path: "assets/public image.png", bytes: 123, sha256: "a".repeat(64) };
  const inventory = {
    canonicalOrigin: "https://caatuu.waajacu.com", files: [file],
    payloadFileCount: 1, payloadBytes: file.bytes,
    payloadSha256: createHash("sha256").update(`${file.path}\0${file.bytes}\0${file.sha256}`).digest("hex"),
  };
  const artifact = { key: "image", asset_path: file.path, url: "/assets/public%20image.png?v=1",
    bytes: file.bytes, sha256: file.sha256, native_required: true, browser_required: true };
  const setup = { artifacts: [artifact] };
  assert.equal(assertPublicSetupDependencies(setup, inventory), setup);
  assert.throws(() => assertPublicSetupDependencies({ artifacts: [{ ...artifact, url: "/assets/missing.png" }] }, inventory), /public asset is missing/u);
  assert.throws(() => assertPublicSetupDependencies({ artifacts: [{ ...artifact, sha256: "b".repeat(64) }] }, inventory), /bytes\/hash differ/u);
  assert.throws(() => assertPublicSetupDependencies({ artifacts: [{ ...artifact, bytes: 124 }] }, inventory), /bytes\/hash differ/u);
  assert.doesNotThrow(() => assertPublicSetupDependencies({ artifacts: [{ ...artifact, url: "/assets/bundled.png", native_required: false, android_packaged: true }] }, inventory));
  assert.throws(() => assertPublicSetupDependencies(setup, { ...inventory, payloadSha256: "c".repeat(64) }), /payload digest differs/u);
});

test("native setup skips downloads only for byte-identical assets in the actual shared or course package", () => {
  const bytes = Buffer.from("reviewed bundled content");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const record = (key, asset_path) => ({
    key, asset_path, url: `/${asset_path}`, bytes: bytes.length, sha256,
    native_required: true, browser_required: true, label: "Unchanged metadata",
  });
  const source = { schema_version: 1, artifacts: [
    record("shared", "assets/art.png"),
    record("course", "data/lesson.json"),
    record("external", "language-runtime/model.onnx"),
    record("mismatch", "assets/old.png"),
  ] };
  const assets = new Map([
    ["assets/art.png", bytes],
    ["courses/xy/data/lesson.json", bytes],
    ["assets/old.png", Buffer.from("different bundled bytes")],
  ]);
  const options = { assetPrefix: "courses/xy", readAsset: (path) => assets.get(path) ?? null };
  const projected = projectBundledSetupArtifacts(source, options);
  assert.deepEqual(projected.artifacts.map(({ native_required }) => native_required), [false, false, true, true]);
  assert.ok(source.artifacts.every(({ native_required }) => native_required), "source metadata is not mutated");
  for (const [index, artifact] of projected.artifacts.entries()) {
    const { android_packaged, ...unchanged } = artifact;
    assert.deepEqual({ ...unchanged, native_required: true }, source.artifacts[index]);
    assert.equal(android_packaged, index < 2 ? true : undefined);
  }
  assert.equal(assertBundledSetupArtifacts(projected, options), projected);
  assert.deepEqual(projectBundledSetupArtifacts(projected, options), projected, "final projection is idempotent");
  for (const readAsset of [() => null, () => Buffer.from("wrong")]) {
    assert.throws(() => assertBundledSetupArtifacts(projected, { ...options, readAsset }), /exact matching packaged bytes/u);
  }
  const invalid = structuredClone(projected);
  invalid.artifacts[0].native_required = true;
  assert.throws(() => assertBundledSetupArtifacts(invalid, options), /must not require a download/u);
});

test("setup artifacts follow metadata without requiring a named game, artwork, or frozen revision", () => {
  assert.deepEqual(assertSetupArtifactMetadata({ artifacts: [] }), { artifacts: [] });
  for (const digest of ["a".repeat(64), "b".repeat(64)]) {
    const setup = { artifacts: [{
      key: "new-course-art", label: "Any translated title", bytes: 123,
      url: `/assets/illustrations/releases/${digest.slice(0, 16)}/new-art.png`,
      asset_path: "assets/illustrations/new-art.png", sha256: digest,
    }, {
      key: "browser-module", bytes: 12, sha256: digest,
      url: "/xy/source/runtime.js?v=next", browser_required: true,
    }] };
    assert.equal(assertSetupArtifactMetadata(setup), setup);
  }
});

test("setup metadata retains confinement, same-origin delivery and immutable digest checks", () => {
  const artifact = {
    key: "content", bytes: 12, sha256: "a".repeat(64),
    url: "/assets/releases/aaaaaaaaaaaaaaaa/art.png",
    asset_path: "assets/art.png", native_required: true,
  };
  for (const patch of [
    { url: "https://other.example/assets/art.png" },
    { url: "http://caatuu.waajacu.com/assets/art.png" },
    { url: "//caatuu.waajacu.com/assets/art.png" },
    { url: "/assets/../secret" },
    { url: "/assets/%2e%2e/secret" },
    { url: "/assets/%5csecret" },
    { url: "/assets/art.png#fragment" },
    { url: "/assets/releases/bbbbbbbbbbbbbbbb/art.png" },
    { url: "/assets/releases/current/art.png" },
    { bytes: 0 }, { bytes: "12" }, { sha256: "bad" },
    { asset_path: "../outside" }, { asset_path: undefined },
  ]) {
    assert.throws(() => assertSetupArtifactMetadata({ artifacts: [{ ...artifact, ...patch }] }), JSON.stringify(patch));
  }
  assert.throws(() => assertSetupArtifactMetadata({ artifacts: [artifact, artifact] }), /duplicated/u);
});

function dictionaryFixture() {
  return {
    key: "kaikki-cs-en-2026-07-09",
    label: "Full Czech to English Dictionary",
    status: "active",
    artifact_kind: "dictionary-database",
    direction: "cs-en",
    database_file: "kaikki-cs-en-2026-07-09/caatuu-cs-en.sqlite",
    download_url: "https://caatuu.example/cz/caatuu-cs-en.sqlite",
    bytes: 143_106_048,
    sha256: "a".repeat(64),
  };
}

test("dictionary storage keys are stable single-segment identifiers", () => {
  assert.equal(
    assertSafeStorageKey("kaikki-cs-en-2026-07-09", "dictionary key"),
    "kaikki-cs-en-2026-07-09",
  );
  for (const value of ["..", "../x", "x/y", "x\\y", "/x", " x", "x ", "\tx", "x\n"]) {
    assert.throws(
      () => assertSafeStorageKey(value, "dictionary key"),
      /stable safe storage key|nonblank and trimmed/u,
      value,
    );
  }
});

test("dictionary artifacts use canonical numeric bytes and safe download metadata", () => {
  const valid = dictionaryFixture();
  assert.equal(assertDictionaryArtifactContract(valid, course, "dictionary").active, valid);

  for (const mutate of [
    (record) => { delete record.bytes; record.expected_bytes = 10; },
    (record) => { record.bytes = "10"; },
    (record) => { record.bytes = 1.5; },
    (record) => { record.bytes = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(
      () => assertDictionaryArtifactContract(invalid, course, "dictionary"),
      /positive safe integer byte count in the canonical bytes field/u,
    );
  }

  for (const [field, value, expected] of [
    ["label", " Czech", /label must be nonblank and trimmed/u],
    ["direction", "cs", /direction is invalid/u],
    ["direction", "cs-fr", /must map the course target language to English/u],
    ["database_file", "../dictionary.sqlite", /normalized and confined/u],
    ["database_file", "dictionary\\file.sqlite", /relative forward-slash path/u],
    ["download_url", "http://caatuu.example/dictionary.sqlite", /must use HTTPS/u],
    ["download_url", "https://caatuu.example/dictionary file.sqlite", /must not contain whitespace/u],
  ]) {
    const invalid = structuredClone(valid);
    invalid[field] = value;
    assert.throws(() => assertDictionaryArtifactContract(invalid, course, "dictionary"), expected);
  }
});

test("embedding manifests bind one safe local basename to canonical bytes and an HTTPS download", () => {
  const active = {
    artifact_kind: "embedding-vector-db",
    model_file: "model-v1/curriculum.sqlite",
    bytes: 100,
    sha256: "b".repeat(64),
  };
  const manifest = {
    file: "curriculum.sqlite",
    url: "model-v1/curriculum.sqlite",
    bytes: 100,
    sha256: "b".repeat(64),
  };
  assert.equal(
    assertEmbeddingArtifactContract(active, manifest, "https://caatuu.example/embeddings", "embedding"),
    manifest,
  );

  for (const file of ["..", "../x.sqlite", "x/y.sqlite", "x\\y.sqlite", "/x.sqlite", " x.sqlite", "x.sqlite "]) {
    const invalid = { ...manifest, file };
    assert.throws(
      () => assertEmbeddingArtifactContract(active, invalid, "https://caatuu.example/embeddings", "embedding"),
      /exact safe file basename|nonblank and trimmed/u,
      file,
    );
  }
  assert.throws(
    () => assertEmbeddingArtifactContract(active, { ...manifest, file: "other.sqlite" }, "https://caatuu.example", "embedding"),
    /must match the catalog model_file basename/u,
  );
  assert.throws(
    () => assertEmbeddingArtifactContract(active, manifest, "http://caatuu.example", "embedding"),
    /must use HTTPS/u,
  );
  assert.throws(
    () => assertEmbeddingArtifactContract(active, { ...manifest, bytes: "100" }, "https://caatuu.example", "embedding"),
    /positive safe integer byte count/u,
  );
  assert.equal(
    embeddingStorageRecord(
      active,
      manifest,
      "https://caatuu.waajacu.com/cz/data/embeddings",
      "cz",
      "embedding",
    ).source,
    "https://caatuu.waajacu.com/cz/data/embeddings/model-v1/curriculum.sqlite",
  );
  assert.throws(
    () => assertEmbeddingArtifactContract(
      active,
      { ...manifest, url: `data/embeddings/${manifest.url}` },
      "https://caatuu.example/embeddings",
      "embedding",
    ),
    /manifest URL must equal the catalog model_file/u,
  );
});

test("the tracked Czech embedding manifest resolves to its exact published database URL", async () => {
  const catalog = JSON.parse(await readFile(
    new URL("../../../languages/czech/static/data/embeddings/models.json", import.meta.url),
    "utf8",
  ));
  const active = catalog.models.find(({ key }) => key === catalog.default_model);
  const manifest = JSON.parse(await readFile(
    new URL(
      `../../../languages/czech/static/data/embeddings/${active.manifest_file}`,
      import.meta.url,
    ),
    "utf8",
  ));
  assert.equal(
    embeddingStorageRecord(active, manifest, catalog.base_url, "cz", "Czech embedding").source,
    "https://caatuu.waajacu.com/cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite",
  );
});

test("shared Android storage permits only complete byte-identical artifact identities", () => {
  const first = {
    courseId: "cz",
    storagePath: "vector-dbs/shared.sqlite",
    source: "https://caatuu.example/cz/shared.sqlite",
    declaredPath: "model-v1/shared.sqlite",
    bytes: 100,
    sha256: "c".repeat(64),
    artifactKind: "embedding-vector-db",
  };
  assert.equal(assertCompatibleSharedStorage([
    first,
    { ...first, courseId: "sk" },
  ]).length, 2);

  for (const [field, value] of [
    ["source", "https://caatuu.example/sk/shared.sqlite"],
    ["declaredPath", "model-v2/shared.sqlite"],
    ["bytes", 101],
    ["sha256", "d".repeat(64)],
    ["artifactKind", "dictionary-database"],
  ]) {
    assert.throws(
      () => assertCompatibleSharedStorage([
        first,
        { ...first, courseId: "sk", [field]: value },
      ]),
      new RegExp(`shared storage path vector-dbs/shared\\.sqlite has conflicting ${field} for courses cz and sk`, "u"),
      field,
    );
  }
});

test("setup storage paths are course-scoped except for reviewed shared namespaces", () => {
  const artifact = {
    key: "runtime-config",
    artifact_kind: "embedding-runtime",
    asset_path: "language-runtime/models/runtime/config.json",
    url: "/language-runtime/models/runtime/config.json",
    native_required: true,
    bytes: 100,
    sha256: "e".repeat(64),
  };
  assert.equal(
    setupStorageRecord(artifact, "cz", "setup").storagePath,
    "setup-assets/language-runtime/models/runtime/config.json",
  );
  assert.equal(
    setupStorageRecord({ ...artifact, asset_path: "data/private.bin", url: "/cz/data/private.bin" }, "cz", "setup").storagePath,
    "setup-assets/courses/cz/data/private.bin",
  );
});

test("active dictionary storage keys are unique across the Android bundle", () => {
  assert.equal(assertUniqueActiveDictionaryKeys([
    { courseId: "cz", key: "dictionary-cs-en-v1" },
    { courseId: "zh", key: "dictionary-zh-en-v1" },
  ]).length, 2);
  assert.throws(
    () => assertUniqueActiveDictionaryKeys([
      { courseId: "cz", key: "dictionary-shared-v1" },
      { courseId: "sk", key: "dictionary-shared-v1" },
    ]),
    /active dictionary storage key dictionary-shared-v1 is shared by courses cz and sk/u,
  );
});

test("canonical byte validation accepts only positive safe integers", () => {
  assert.equal(assertCanonicalPositiveBytes(1, "bytes"), 1);
  for (const value of [undefined, "1", 0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertCanonicalPositiveBytes(value, "bytes"), /positive safe integer/u);
  }
});

test("native managers apply the shared storage contract before file and recursive-delete operations", async () => {
  const [assetClient, dictionaryManager, staticAssetManager, vectorManager] = await Promise.all([
    readFile(new URL("../../app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", import.meta.url), "utf8"),
    readFile(new URL("../../app/src/main/java/com/caatuu/android/DictionaryManager.kt", import.meta.url), "utf8"),
    readFile(new URL("../../app/src/main/java/com/caatuu/android/StaticAssetManager.kt", import.meta.url), "utf8"),
    readFile(new URL("../../app/src/main/java/com/caatuu/android/VectorDatabaseManager.kt", import.meta.url), "utf8"),
  ]);
  assert.match(dictionaryManager, /NativeArtifactContract\.storageKey\(item\.getString\("key"\)/u);
  assert.match(dictionaryManager, /positiveSafeByteCount\(item\.opt\("bytes"\)/u);
  assert.match(dictionaryManager, /val root = rootDir\(\)[\s\S]*root\.deleteRecursively\(\)/u);
  assert.match(dictionaryManager, /NativeArtifactContract\.canonicalChild\([\s\S]*"Dictionary storage key"/u);
  assert.match(vectorManager, /NativeArtifactContract\.fileName\([\s\S]*manifest\.getString\("file"\)/u);
  assert.match(vectorManager, /positiveSafeByteCount\([\s\S]*manifest\.opt\("bytes"\)/u);
  assert.match(vectorManager, /vectorCatalog\.models\.forEach \{ spec ->[\s\S]*databaseFile\(spec, databasesDir\)[\s\S]*markerFile\(spec, databasesDir\)/u);
  assert.doesNotMatch(vectorManager, /databasesDir\.deleteRecursively\(\)/u);
  assert.match(vectorManager, /NativeArtifactContract\.canonicalChild\([\s\S]*"Vector database storage root"/u);
  assert.match(vectorManager, /marker\.readText\(\)\.trim\(\) == identityMarker\(spec\)/u);
  assert.match(staticAssetManager, /internal fun verifiedLocalAsset\(assetPath: String\)/u);
  assert.match(staticAssetManager, /marker\.readText\(\)\.trim\(\) == identityMarker\(spec\)/u);
  assert.match(assetClient, /private var activeCourseId: String = courseRegistry\.defaultCourseId/u);
  assert.match(assetClient, /val vectorManager = vectorDatabaseManagers\[activeCourseId\]/u);
  assert.match(assetClient, /val staticManager = staticAssetManagers\[activeCourseId\]/u);
  assert.match(assetClient, /return manager\.verifiedDatabaseFile\(spec\)/u);
  assert.match(assetClient, /if \(selectedVectorPath\) return notFound\(\)/u);
  assert.match(assetClient, /if \(staticManager\?\.ownsAssetPath\(assetPath\) == true\) return notFound\(\)/u);
  assert.doesNotMatch(assetClient, /staticAssetManagers\.values\.any/u);
});
