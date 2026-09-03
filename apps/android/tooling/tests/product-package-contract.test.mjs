import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCourseBundleContract,
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

function course({ id, routePrefix, targetLanguage, capabilities: courseCapabilities, providers }) {
  return {
    id,
    routePrefix,
    entryPath: `${routePrefix}/index.html`,
    assetPrefix: `courses/${id}`,
    sourceLanguage: { id: "en", label: "English", locale: "en" },
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
