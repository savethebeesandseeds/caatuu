import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCourseBundleContract,
  assertGenericDictionaryCatalog,
  assertGenericEmbeddingCatalog,
  assertGenericEmbeddingManifest,
  assertPackageSharedStorage,
  requiredAssetPaths,
  requiredNativeClassNames,
} from "../validate-product-package.mjs";

function capabilities(overrides = {}) {
  return {
    chat: false,
    conjugationComet: false,
    dictionary: false,
    embeddings: true,
    generation: false,
    godot: false,
    imageLookup: true,
    llm: false,
    memory: true,
    offlineModels: false,
    pronunciationGuides: false,
    semanticSearch: true,
    speech: true,
    stats: true,
    verbs: false,
    wordWorld: true,
    wordWorldStandardOnly: true,
    ...overrides,
  };
}

function course({
  id,
  routePrefix,
  sourceLanguage = { id: "en", label: "English", locale: "en" },
  targetLanguage,
  capabilities: courseCapabilities,
  providers,
}) {
  return {
    id,
    routePrefix,
    entryPath: `${routePrefix}/index.html`,
    assetPrefix: `courses/${id}`,
    sourceLanguage,
    targetLanguage,
    capabilities: courseCapabilities,
    nativeProviders: { schemaVersion: 1, providers },
  };
}

function packageFixture() {
  const czechCapabilities = capabilities({ conjugationComet: true, dictionary: true, verbs: true });
  const czechProviders = {
    embeddings: {
      implementation: "vector-database-catalog-v1",
      catalogAsset: "courses/cz/data/embeddings/models.json",
    },
    dictionary: {
      implementation: "sqlite-dictionary-catalog-v1",
      catalogAsset: "courses/cz/data/dictionaries/catalog.json",
    },
    speech: { implementation: "android-text-to-speech-v1", locale: "cs-CZ" },
  };
  const bundle = {
    $schema: "https://caatuu.org/schemas/android-course-bundle-runtime.v1.schema.json",
    schemaVersion: 1,
    defaultCourseId: "cz",
    courses: [
      course({
        id: "cz",
        routePrefix: "/cz",
        targetLanguage: {
          id: "cs",
          label: "Czech",
          nativeLabel: "Čeština",
          locale: "cs-CZ",
          script: "Latn",
          speechLocale: "cs-CZ",
        },
        capabilities: czechCapabilities,
        providers: czechProviders,
      }),
      course({
        id: "zh",
        routePrefix: "/zh",
        targetLanguage: {
          id: "zh",
          label: "Mandarin",
          nativeLabel: "中文",
          locale: "zh-Hans",
          script: "Hans",
          speechLocale: "zh-CN",
        },
        capabilities: capabilities(),
        providers: {
          embeddings: {
            implementation: "webview-english-minilm-v1",
            catalogAsset: "courses/zh/data/embeddings/catalog.json",
          },
          speech: { implementation: "android-text-to-speech-v1", locale: "zh-CN" },
        },
      }),
    ],
  };
  const profile = {
    schemaVersion: 2,
    profile: "product",
    course: {
      id: "cz",
      routePrefix: "/cz",
      sourceLanguage: { id: "en", locale: "en" },
      targetLanguage: { id: "cs", locale: "cs-CZ", script: "Latn", speechLocale: "cs-CZ" },
    },
    capabilities: czechCapabilities,
    nativeProviders: { schemaVersion: 1, providers: czechProviders },
    privacy: { bugReportsLocalOnly: true, dictionaryGapReportsLocalOnly: true },
    assets: [
      "caatuu-course-bundle.json",
      "index.html",
      "courses/cz/setup-assets.json",
      "courses/cz/data/embeddings/models.json",
      "courses/cz/data/dictionaries/catalog.json",
      "courses/zh/setup-assets.json",
      "courses/zh/data/embeddings/catalog.json",
    ],
  };
  return { bundle, profile };
}

function publicationPlanFor(bundle) {
  return {
    defaultCourseId: bundle.defaultCourseId,
    courses: bundle.courses.map((courseRecord) => ({
      id: courseRecord.id,
      manifestPath: `apps/languages/${courseRecord.id}/course.json`,
      assetPrefix: courseRecord.assetPrefix,
      routePrefix: courseRecord.routePrefix,
      entryPath: courseRecord.entryPath,
      sourceLanguage: structuredClone(courseRecord.sourceLanguage),
      targetLanguage: structuredClone(courseRecord.targetLanguage),
      capabilities: structuredClone(courseRecord.capabilities),
      nativeProviders: structuredClone(courseRecord.nativeProviders),
    })),
  };
}

function thirdCourseFixture() {
  const fixture = packageFixture();
  fixture.bundle.courses.push(course({
    id: "es",
    routePrefix: "/learn-spanish",
    sourceLanguage: { id: "fr", label: "French", locale: "fr" },
    targetLanguage: {
      id: "es",
      label: "Spanish",
      nativeLabel: "Español",
      locale: "es-ES",
      script: "Latn",
      speechLocale: "es-ES",
    },
    capabilities: capabilities({
      embeddings: false,
      imageLookup: false,
      memory: false,
      semanticSearch: false,
      speech: false,
      stats: false,
      wordWorld: false,
      wordWorldStandardOnly: false,
    }),
    providers: {},
  }));
  fixture.profile.assets.push("courses/es/setup-assets.json");
  return { ...fixture, publicationPlan: publicationPlanFor(fixture.bundle) };
}

test("package requirements are derived from the declared courses and native capabilities", () => {
  const { bundle, profile } = packageFixture();
  assert.equal(assertCourseBundleContract(bundle, profile), bundle);

  const assets = requiredAssetPaths(bundle);
  for (const asset of [
    "caatuu-course-bundle.json",
    "courses/cz/data/embeddings/models.json",
    "courses/zh/data/embeddings/catalog.json",
    "courses/cz/data/dictionaries/catalog.json",
    "language-runtime/embedding-runtimes.json",
  ]) {
    assert.ok(assets.includes(asset), `missing package requirement: ${asset}`);
  }
  assert.ok(!assets.some((asset) => asset.startsWith("data/models/")));

  const nativeClasses = requiredNativeClassNames(bundle);
  for (const className of ["VectorDatabaseManager", "DictionaryManager", "AndroidSpeechManager"]) {
    assert.ok(nativeClasses.includes(`com.caatuu.android.${className}`));
  }
});

test("the package contract rejects provider escape and duplicated vendor payloads", () => {
  const { bundle, profile } = packageFixture();
  const escaped = structuredClone(bundle);
  escaped.courses[1].nativeProviders.providers.embeddings.catalogAsset = "data/embeddings/catalog.json";
  assert.throws(
    () => assertCourseBundleContract(escaped, profile),
    /provider catalog asset must be namespaced under courses\/zh/,
  );

  const duplicated = structuredClone(profile);
  duplicated.assets.push("courses/cz/vendor/transformers/transformers.min.js");
  assert.throws(
    () => assertCourseBundleContract(bundle, duplicated),
    /must not duplicate shared Transformers\.js artifacts/,
  );
});

test("the package contract follows a catalog-derived third-course publication plan", () => {
  const { bundle, profile, publicationPlan } = thirdCourseFixture();
  assert.equal(assertCourseBundleContract(bundle, profile, "fixture package", publicationPlan), bundle);
});

test("the package contract rejects catalog-plan omission, extra, order, and default drift", () => {
  const { bundle, profile, publicationPlan } = thirdCourseFixture();

  const omitted = structuredClone(bundle);
  omitted.courses = omitted.courses.filter(({ id }) => id !== "zh");
  assert.throws(
    () => assertCourseBundleContract(omitted, profile, "fixture package", publicationPlan),
    /missing Android-enabled catalog courses: zh/u,
  );

  const extra = structuredClone(bundle);
  extra.courses.push(course({
    id: "de",
    routePrefix: "/de",
    targetLanguage: {
      id: "de",
      label: "German",
      nativeLabel: "Deutsch",
      locale: "de-DE",
      script: "Latn",
      speechLocale: "de-DE",
    },
    capabilities: capabilities({
      embeddings: false,
      imageLookup: false,
      memory: false,
      semanticSearch: false,
      speech: false,
      stats: false,
      wordWorld: false,
      wordWorldStandardOnly: false,
    }),
    providers: {},
  }));
  assert.throws(
    () => assertCourseBundleContract(extra, profile, "fixture package", publicationPlan),
    /courses absent from the Android publication plan: de/u,
  );

  const reordered = structuredClone(bundle);
  [reordered.courses[1], reordered.courses[2]] = [reordered.courses[2], reordered.courses[1]];
  assert.throws(
    () => assertCourseBundleContract(reordered, profile, "fixture package", publicationPlan),
    /courses must follow Android-enabled language catalog order: cz, zh, es/u,
  );

  const changedDefault = structuredClone(bundle);
  changedDefault.defaultCourseId = "zh";
  assert.throws(
    () => assertCourseBundleContract(changedDefault, profile, "fixture package", publicationPlan),
    /default course must match the Android-enabled language catalog \(cz\)/u,
  );
});

test("the package contract rejects capability and native-provider drift from publication authorities", () => {
  const { bundle, profile, publicationPlan } = thirdCourseFixture();

  const capabilityDrift = structuredClone(bundle);
  capabilityDrift.courses[2].capabilities.pronunciationGuides = true;
  assert.throws(
    () => assertCourseBundleContract(capabilityDrift, profile, "fixture package", publicationPlan),
    /capabilities must match apps\/languages\/es\/course\.json/u,
  );

  const providerDrift = structuredClone(bundle);
  providerDrift.courses[0].nativeProviders.providers.embeddings.catalogAsset =
    "courses/cz/data/embeddings/alternate.json";
  const expandedProfile = structuredClone(profile);
  expandedProfile.assets.push("courses/cz/data/embeddings/alternate.json");
  assert.throws(
    () => assertCourseBundleContract(providerDrift, expandedProfile, "fixture package", publicationPlan),
    /native providers must match the Android asset catalog/u,
  );
});

test("Android dictionary lookup follows the target language while meanings remain English-auditable", () => {
  const { bundle } = packageFixture();
  const catalog = {
    default_dictionary: "fixture-cs-en",
    dictionaries: [{
      key: "fixture-cs-en",
      label: "Fixture Czech to English Dictionary",
      status: "active",
      artifact_kind: "dictionary-database",
      direction: "cs-en",
      lookupLanguage: "cs",
      lookupLanguageTag: "cs-CZ",
      meaningLanguage: "en",
      meaningLanguageTag: "en",
      bytes: 10,
      sha256: "a".repeat(64),
      database_file: "fixture-cs-en/fixture.sqlite",
      download_url: "https://example.test/fixture.sqlite",
    }],
  };
  assert.equal(
    assertGenericDictionaryCatalog(catalog, bundle.courses[0], "fixture dictionary"),
    catalog.dictionaries[0],
  );

  const nonEnglishMeanings = structuredClone(catalog);
  nonEnglishMeanings.dictionaries[0].meaningLanguage = "fr";
  assert.throws(
    () => assertGenericDictionaryCatalog(nonEnglishMeanings, bundle.courses[0], "fixture dictionary"),
    /meaningLanguage must remain the immutable English audit language/u,
  );

  const wrongLookupLanguage = structuredClone(catalog);
  wrongLookupLanguage.dictionaries[0].lookupLanguage = "sk";
  assert.throws(
    () => assertGenericDictionaryCatalog(wrongLookupLanguage, bundle.courses[0], "fixture dictionary"),
    /lookupLanguage must match the course target language/u,
  );

  const wrongLookupScript = structuredClone(catalog);
  wrongLookupScript.dictionaries[0].lookupLanguageTag = "cs-Latn-US";
  assert.throws(
    () => assertGenericDictionaryCatalog(wrongLookupScript, bundle.courses[0], "fixture dictionary"),
    /lookupLanguageTag must match the exact course target locale and script/u,
  );

  const nonEnglishMeaningTag = structuredClone(catalog);
  nonEnglishMeaningTag.dictionaries[0].meaningLanguageTag = "fr";
  assert.throws(
    () => assertGenericDictionaryCatalog(nonEnglishMeaningTag, bundle.courses[0], "fixture dictionary"),
    /meaningLanguageTag must remain the immutable English audit language/u,
  );

  for (const mutate of [
    (entry) => { delete entry.bytes; entry.expected_bytes = 10; },
    (entry) => { entry.bytes = "10"; },
    (entry) => { entry.bytes = 10.5; },
    (entry) => { entry.bytes = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const invalidBytes = structuredClone(catalog);
    mutate(invalidBytes.dictionaries[0]);
    assert.throws(
      () => assertGenericDictionaryCatalog(invalidBytes, bundle.courses[0], "fixture dictionary"),
      /positive safe integer byte count in the canonical bytes field/u,
    );
  }
});

test("the final package embedding audit confines the database name and HTTPS download", () => {
  const catalog = {
    base_url: "https://example.test/embeddings",
    default_model: "fixture-minilm",
    models: [{
      key: "fixture-minilm",
      status: "active",
      artifact_kind: "embedding-vector-db",
      input_language: "en",
      model_file: "fixture-minilm/fixture.sqlite",
      manifest_file: "fixture-minilm/manifest.json",
      bytes: 10,
      sha256: "b".repeat(64),
    }],
  };
  const manifest = {
    model_id: "fixture-minilm",
    file: "fixture.sqlite",
    url: "fixture-minilm/fixture.sqlite",
    bytes: 10,
    sha256: "b".repeat(64),
    embedding_dimension: 384,
    embedding_text_field: "english_text",
    embedding_input_policy: "english_text_only",
    schema_name: "fixture-vector-db",
    schema_version: 1,
  };
  const active = assertGenericEmbeddingCatalog(catalog, "fixture");
  assert.doesNotThrow(() => assertGenericEmbeddingManifest(active, manifest, catalog.base_url, "fixture"));
  const nonEnglishRetrieval = structuredClone(catalog);
  nonEnglishRetrieval.models[0].input_language = "fr";
  assert.throws(
    () => assertGenericEmbeddingCatalog(nonEnglishRetrieval, "fixture"),
    /Android embeddings must consume English input/u,
  );
  assert.throws(
    () => assertGenericEmbeddingManifest(active, { ...manifest, file: "../fixture.sqlite" }, catalog.base_url, "fixture"),
    /exact safe file basename/u,
  );
  assert.throws(
    () => assertGenericEmbeddingManifest(active, manifest, "http://example.test/embeddings", "fixture"),
    /must use HTTPS/u,
  );
});

test("the final package rejects a second course that reuses storage with a different identity", () => {
  const first = {
    courseId: "cz",
    storagePath: "setup-assets/language-runtime/models/config.json",
    source: "https://caatuu.waajacu.com/language-runtime/models/config.json",
    declaredPath: "language-runtime/models/config.json",
    bytes: 100,
    sha256: "c".repeat(64),
    artifactKind: "embedding-runtime",
  };
  assert.doesNotThrow(() => assertPackageSharedStorage([first, { ...first, courseId: "zh" }]));
  assert.throws(
    () => assertPackageSharedStorage([
      first,
      { ...first, courseId: "zh", sha256: "d".repeat(64) },
    ]),
    /shared storage path .* has conflicting sha256 for courses cz and zh/u,
  );
});

test("the release builder validates one product AAB-derived APK boundary", async () => {
  const builder = await readFile(new URL("../build-release-aab.sh", import.meta.url), "utf8");
  for (const contract of [
    "-PcaatuuDistributionProfile=product",
    ":product:generateProductAssets",
    ":product:lintRelease",
    ":product:bundleRelease",
    "--mode=universal",
    "validate-product-package.mjs",
  ]) {
    assert.ok(builder.includes(contract), `missing release boundary: ${contract}`);
  }
  assert.doesNotMatch(builder, /:app:|:llamaLib:|prepare-llama-vendor/u);
});
