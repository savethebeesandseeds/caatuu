#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { transformIndex } from "./build-product-assets.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(dirname(scriptPath), "../../..");
const appAssetCatalog = JSON.parse(readFileSync(resolve(workspaceRoot, "apps/language-runtime/app-assets.json"), "utf8"));
const canonicalAppEntry = Buffer.from(transformIndex(
  readFileSync(resolve(workspaceRoot, "apps/language-runtime/static/app/index.html"), "utf8"),
));
const SHARED_APP_REQUIRED_ASSET_PATHS = Object.freeze(
  appAssetCatalog.assets.map(({ output }) => output),
);
const CAPABILITY_GATED_SHARED_APP_PATHS = new Set([
  "language-runtime/static/source/caatuu-workspace.js",
  "language-runtime/static/source/product-word-world.mjs",
  "language-runtime/static/source/word-net-core.mjs",
  "language-runtime/static/source/word-net-queue.mjs",
]);
const BUNDLETOOL_DERIVED_APK_ASSET_PATHS = new Set([
  "dexopt/baseline.prof",
  "dexopt/baseline.profm",
]);

const EXPECTED_APPLICATION_ID = "com.waajacu.caatuu";
const EXPECTED_MIN_SDK = 30;
const MINIMUM_TARGET_SDK = 36;
const EXPECTED_MINILM_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
const EXPECTED_MINILM_RUNTIME_ID = "all-minilm-l6-v2-qint8-v0.1";
const PRODUCT_COURSE_BUNDLE_ASSET = "caatuu-course-bundle.json";
const SHARED_EMBEDDING_RUNTIME_CATALOG_ASSET = "language-runtime/embedding-runtimes.json";
const EXPECTED_PRODUCT_COURSE_IDS = Object.freeze(["cz", "zh"]);
const PRODUCT_CAPABILITY_KEYS = Object.freeze([
  "chat",
  "conjugationComet",
  "dictionary",
  "embeddings",
  "generation",
  "godot",
  "imageLookup",
  "llm",
  "memory",
  "offlineModels",
  "pronunciationGuides",
  "semanticSearch",
  "speech",
  "stats",
  "verbs",
  "wordWorld",
  "wordWorldStandardOnly",
]);

const BASE_REQUIRED_ASSET_PATHS = [
  "caatuu-profile.json",
  PRODUCT_COURSE_BUNDLE_ASSET,
  "index.html",
  ...SHARED_APP_REQUIRED_ASSET_PATHS,
];

const CZECH_EMBEDDING_REQUIRED_COURSE_PATHS = [
  "data/embeddings/models.json",
  "data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json",
  "source/shared/runtime.js",
  "source/shared/vector-db.js",
  "source/shared/semantic-learning.js",
  "source/shared/semantic-learning-core.mjs",
  "vendor/sql.js/sql-wasm.js",
  "vendor/sql.js/sql-wasm.wasm",
  "vendor/sql.js/LICENSE",
];

const CZECH_DICTIONARY_REQUIRED_COURSE_PATHS = [
  "data/dictionaries/catalog.json",
  "data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json",
  "vendor/sql.js/sql-wasm.js",
  "vendor/sql.js/sql-wasm.wasm",
  "vendor/sql.js/LICENSE",
];

const BASE_REQUIRED_NATIVE_CLASSES = [
  "com.caatuu.android.CaatuuActivity",
  "com.caatuu.android.ProductBridge",
  "com.caatuu.android.AppUpdateManager",
  "com.caatuu.android.CaatuuAssetClient",
  "com.caatuu.android.StaticAssetManager",
];

const FORBIDDEN_NATIVE_CLASS_PATTERNS = [
  /\bcom\.caatuu\.android\.(?:ModelManager|NativeCzechModel)(?:\$|\b)/,
  /\bcom\.arm\.aichat(?:\.|\b)/,
  /\borg\.godotengine(?:\.|\b)/,
];

const FORBIDDEN_ARCHIVE_PATH_PATTERNS = [
  /(?:^|\/)chat\.html$/i,
  /(?:^|\/)source\/features\/chat\//i,
  /(?:^|\/)data\/models(?:\/|$)/i,
  /(?:^|\/)assets\/games(?:\/|$)/i,
  /(?:^|\/)artifacts\/games(?:\/|$)/i,
  /(?:^|\/)caatuu-game(?:\/|$)/i,
  /(?:^|\/)godot(?:[-_/]|$)/i,
  /\.pck$/i,
  /\.gguf(?:\.|$)/i,
  /(?:^|\/)lib\/(?:[^/]+\/)?lib(?:ai-chat|llama|ggml|kleidiai|godot)[^/]*\.so$/i,
];

const FIRST_PARTY_EXECUTABLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".webmanifest",
]);

const FORBIDDEN_FIRST_PARTY_SOURCE_PATTERNS = [
  /@mlc-ai\/web-llm/i,
  /(?:^|["'`(\s])(?:\.\/|\.\.\/|\/)?data\/models\//i,
  /\b(?:llama\.cpp|ggml|gguf|webllm)\b/i,
  /\bdebug-chat\b/i,
  /\bchat\.html\b/i,
  /\bwordNetGenerativeDialog\b/,
  /data-content-mode\s*=\s*["']generative["']/i,
  /\bGenerative mode\b/i,
  /\bmodels\.generate\s*\(/,
  /\b(?:loadModelCatalog|loadBrowserModel|generateBrowser|browserFallbackModel|webllmCdn)\b/,
  /nativeCall\(\s*["'](?:prompt|start_download|cancel_download|reset_conversation|benchmark|delete_model)["']/,
  /["'](?:prompt|start_download|cancel_download|reset_conversation|benchmark|delete_model)["']\s*->/,
  /(?:^|["'`(\s])\/?games\/caatuu-game(?:\/|\b)/i,
  /\bgodot-v\d+\b/i,
];

function usage() {
  console.log(
    "Usage: node apps/android/tooling/validate-product-package.mjs " +
      "--aab <caatuu.aab> --apk <aab-derived-universal.apk> " +
      "[--apkanalyzer <path>] [--unzip <path>] [--allow-transition-debug]",
  );
}

function parseArguments(argv) {
  const options = { apkanalyzer: "apkanalyzer", unzip: "unzip", allowTransitionDebug: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--allow-transition-debug") {
      options.allowTransitionDebug = true;
      continue;
    }
    if (!["--aab", "--apk", "--apkanalyzer", "--unzip"].includes(argument)) {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.aab || !options.apk) throw new Error("--aab and --apk are required");
  return { ...options, help: false };
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: options.encoding ?? "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8")
      : String(error.stderr || "");
    throw new Error(`${basename(command)} ${args.join(" ")} failed${stderr ? `: ${stderr.trim()}` : ""}`);
  }
}

function archiveEntries(unzip, archive) {
  return run(unzip, ["-Z1", archive])
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function archiveBuffer(unzip, archive, entry) {
  return run(unzip, ["-p", archive, entry], { encoding: "buffer" });
}

function archiveText(unzip, archive, entry) {
  return archiveBuffer(unzip, archive, entry).toString("utf8");
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeAssetPath(entry, kind) {
  if (kind === "aab") {
    const match = /^base\/assets\/(.+)$/u.exec(entry);
    return match?.[1] ?? null;
  }
  const match = /^assets\/(.+)$/u.exec(entry);
  return match?.[1] ?? null;
}

function archiveEntryForAsset(assetPath, kind) {
  return kind === "aab" ? `base/assets/${assetPath}` : `assets/${assetPath}`;
}

function assertNoForbiddenPaths(entries, label) {
  for (const entry of entries) {
    for (const pattern of FORBIDDEN_ARCHIVE_PATH_PATTERNS) {
      assert(!pattern.test(entry), `${label} contains forbidden product path ${entry}`);
    }
  }
}

function courseAssetPath(course, relativePath) {
  return `${course.assetPrefix}/${relativePath}`;
}

function productCourses(contract) {
  if (Array.isArray(contract?.courses)) return contract.courses;
  if (contract?.course) {
    return [{
      ...contract.course,
      assetPrefix: contract.course.id ? `courses/${contract.course.id}` : "",
      capabilities: contract.capabilities,
      nativeProviders: contract.nativeProviders,
    }];
  }
  return [];
}

export function requiredAssetPaths(contract) {
  const required = [...BASE_REQUIRED_ASSET_PATHS];
  for (const course of productCourses(contract)) {
    if (!course.assetPrefix) continue;
    required.push(courseAssetPath(course, "setup-assets.json"));
    const embeddingCatalog = course?.nativeProviders?.providers?.embeddings?.catalogAsset;
    const dictionaryCatalog = course?.nativeProviders?.providers?.dictionary?.catalogAsset;
    if (course.capabilities?.embeddings && embeddingCatalog) required.push(embeddingCatalog);
    if (course.capabilities?.embeddings && course.id === "cz") {
      required.push(...CZECH_EMBEDDING_REQUIRED_COURSE_PATHS.map((path) => courseAssetPath(course, path)));
    }
    if (course.capabilities?.dictionary && dictionaryCatalog) required.push(dictionaryCatalog);
    if (course.capabilities?.dictionary && course.id === "cz") {
      required.push(...CZECH_DICTIONARY_REQUIRED_COURSE_PATHS.map((path) => courseAssetPath(course, path)));
    }
  }
  if (productCourses(contract).some((course) => course.capabilities?.embeddings)) {
    required.push(SHARED_EMBEDDING_RUNTIME_CATALOG_ASSET);
  }
  return [...new Set(required)];
}

export function requiredNativeClassNames(contract) {
  const providerSets = productCourses(contract).map((course) => course?.nativeProviders?.providers ?? {});
  return [
    ...BASE_REQUIRED_NATIVE_CLASSES,
    ...(providerSets.some((providers) => providers.embeddings?.implementation === "vector-database-catalog-v1")
      ? ["com.caatuu.android.VectorDatabaseManager"]
      : []),
    ...(providerSets.some((providers) => providers.dictionary)
      ? ["com.caatuu.android.DictionaryManager"]
      : []),
    ...(providerSets.some((providers) => providers.speech)
      ? ["com.caatuu.android.AndroidSpeechManager"]
      : []),
  ];
}

function assertRequiredAssets(entries, kind, label, contract) {
  const entrySet = new Set(entries);
  for (const assetPath of requiredAssetPaths(contract)) {
    const expected = archiveEntryForAsset(assetPath, kind);
    assert(entrySet.has(expected), `${label} is missing required product asset ${expected}`);
  }
}

function assertCanonicalAppEntry(unzip, archive, kind, label) {
  const entry = archiveEntryForAsset("index.html", kind);
  assert(
    archiveBuffer(unzip, archive, entry).equals(canonicalAppEntry),
    `${label} index.html must equal the reviewed product transform of apps/language-runtime/static/app/index.html`,
  );
}

function assertCanonicalCapabilityGatedSharedAssets(unzip, archive, kind, label) {
  for (const assetPath of CAPABILITY_GATED_SHARED_APP_PATHS) {
    const mapping = appAssetCatalog.assets.find(({ output }) => output === assetPath);
    assert(mapping, `${label} is missing the canonical mapping for ${assetPath}`);
    const expected = readFileSync(resolve(workspaceRoot, mapping.source));
    const entry = archiveEntryForAsset(assetPath, kind);
    assert(
      archiveBuffer(unzip, archive, entry).equals(expected),
      `${label} capability-gated shared asset ${assetPath} must match its canonical source`,
    );
  }
}

function assertDeclaredAssetBoundary(entries, kind, label, profile) {
  const actual = entries
    .map((entry) => normalizeAssetPath(entry, kind))
    .filter((assetPath) => assetPath && !assetPath.endsWith("/") && assetPath !== "caatuu-profile.json")
    .filter((assetPath) => kind !== "apk" || !BUNDLETOOL_DERIVED_APK_ASSET_PATHS.has(assetPath))
    .sort();
  const declared = [...profile.assets].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(declared),
    `${label} packaged assets must exactly match the manifest-derived product profile`,
  );
}

function parseJsonAsset(unzip, archive, assetPath, kind, label) {
  const entry = archiveEntryForAsset(assetPath, kind);
  try {
    return JSON.parse(archiveText(unzip, archive, entry));
  } catch (error) {
    fail(`${label} contains invalid ${entry}: ${error.message}`);
  }
}

function hasExactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isSafeAssetPath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function assertProductCapabilities(capabilities, label) {
  assert(
    JSON.stringify(Object.keys(capabilities ?? {}).sort()) === JSON.stringify([...PRODUCT_CAPABILITY_KEYS].sort()),
    `${label} must contain the exact reviewed capabilities`,
  );
  for (const capability of PRODUCT_CAPABILITY_KEYS) {
    assert(typeof capabilities[capability] === "boolean", `${label} capability ${capability} must be boolean`);
  }
  for (const capability of ["chat", "llm", "generation", "godot", "offlineModels"]) {
    assert(capabilities[capability] === false, `${label} capability ${capability} must be false`);
  }
  assert(
    capabilities.imageLookup === capabilities.wordWorld &&
      capabilities.wordWorldStandardOnly === capabilities.wordWorld,
    `${label} image lookup and Standard-only Word World capabilities must agree`,
  );
  assert(capabilities.stats === capabilities.memory, `${label} stats and memory capabilities must agree`);
  assert(
    !capabilities.semanticSearch || capabilities.embeddings,
    `${label} semanticSearch requires embeddings`,
  );
}

function assertNativeProviderContract(subject, label, { assetPrefix = null, packagedAssets = [] } = {}) {
  const contract = subject?.nativeProviders;
  assert(hasExactKeys(contract, ["schemaVersion", "providers"]), `${label} native provider contract has unsupported fields`);
  assert(contract.schemaVersion === 1, `${label} native provider contract must use schemaVersion 1`);
  const providers = contract.providers;
  assert(providers && typeof providers === "object" && !Array.isArray(providers), `${label} native providers must be an object`);
  const expectedProviderNames = [
    ...(subject.capabilities.embeddings ? ["embeddings"] : []),
    ...(subject.capabilities.dictionary ? ["dictionary"] : []),
    ...(subject.capabilities.speech ? ["speech"] : []),
  ].sort();
  assert(
    JSON.stringify(Object.keys(providers).sort()) === JSON.stringify(expectedProviderNames),
    `${label} native providers must exactly match enabled capabilities`,
  );

  for (const [name, implementations] of [
    ["embeddings", ["vector-database-catalog-v1", "webview-english-minilm-v1"]],
    ["dictionary", ["sqlite-dictionary-catalog-v1"]],
  ]) {
    const provider = providers[name];
    if (!provider) continue;
    assert(hasExactKeys(provider, ["catalogAsset", "implementation"]), `${label} ${name} provider has unsupported fields`);
    assert(implementations.includes(provider.implementation), `${label} ${name} provider implementation is unsupported`);
    assert(isSafeAssetPath(provider.catalogAsset), `${label} ${name} provider catalog asset is unsafe`);
    if (assetPrefix) {
      assert(
        provider.catalogAsset.startsWith(`${assetPrefix}/`),
        `${label} ${name} provider catalog asset must be namespaced under ${assetPrefix}`,
      );
    }
    assert(packagedAssets.includes(provider.catalogAsset), `${label} ${name} provider catalog asset is not packaged`);
  }

  if (providers.speech) {
    assert(hasExactKeys(providers.speech, ["implementation", "locale"]), `${label} speech provider has unsupported fields`);
    assert(providers.speech.implementation === "android-text-to-speech-v1", `${label} speech provider implementation is unsupported`);
    assert(
      providers.speech.locale === (subject.course?.targetLanguage ?? subject.targetLanguage)?.speechLocale,
      `${label} speech provider locale must match the course manifest`,
    );
  }
}

export function assertCourseBundleContract(bundle, profile, label = "Caatuu product package") {
  assert(
    hasExactKeys(bundle, ["$schema", "schemaVersion", "defaultCourseId", "courses"]),
    `${label} course bundle has unsupported fields`,
  );
  assert(
    bundle.$schema === "https://caatuu.org/schemas/android-course-bundle-runtime.v1.schema.json",
    `${label} course bundle schema identifier is unsupported`,
  );
  assert(bundle.schemaVersion === 1, `${label} course bundle must use schemaVersion 1`);
  assert(bundle.defaultCourseId === "cz", `${label} default course must be cz`);
  assert(Array.isArray(bundle.courses), `${label} courses must be an array`);
  assert(
    JSON.stringify(bundle.courses.map((course) => course?.id)) === JSON.stringify(EXPECTED_PRODUCT_COURSE_IDS),
    `${label} must contain exactly the ordered cz and zh courses`,
  );

  const packagedAssets = Array.isArray(profile?.assets) ? profile.assets : [];
  const assetPrefixes = new Set();
  const routePrefixes = new Set();
  for (const course of bundle.courses) {
    const courseLabel = `${label} ${course?.id ?? "unknown"} course`;
    assert(
      hasExactKeys(course, [
        "assetPrefix",
        "capabilities",
        "entryPath",
        "id",
        "nativeProviders",
        "routePrefix",
        "sourceLanguage",
        "targetLanguage",
      ]),
      `${courseLabel} has unsupported fields`,
    );
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(course.id), `${courseLabel} id is invalid`);
    assert(course.routePrefix === `/${course.id}`, `${courseLabel} routePrefix must match its id`);
    assert(course.entryPath === `${course.routePrefix}/index.html`, `${courseLabel} entryPath must match its route`);
    assert(course.assetPrefix === `courses/${course.id}`, `${courseLabel} assetPrefix must match its id`);
    assert(!assetPrefixes.has(course.assetPrefix), `${courseLabel} assetPrefix is duplicated`);
    assert(!routePrefixes.has(course.routePrefix), `${courseLabel} routePrefix is duplicated`);
    assetPrefixes.add(course.assetPrefix);
    routePrefixes.add(course.routePrefix);

    assert(
      hasExactKeys(course.sourceLanguage, ["id", "label", "locale"]),
      `${courseLabel} source language has unsupported fields`,
    );
    assert(course.sourceLanguage.id === "en", `${courseLabel} source language must remain English`);
    assert(
      hasExactKeys(course.targetLanguage, ["id", "label", "nativeLabel", "locale", "script", "speechLocale"]),
      `${courseLabel} target language has unsupported fields`,
    );
    for (const [name, value] of Object.entries({
      "source label": course.sourceLanguage.label,
      "source locale": course.sourceLanguage.locale,
      "target id": course.targetLanguage.id,
      "target label": course.targetLanguage.label,
      "target native label": course.targetLanguage.nativeLabel,
      "target locale": course.targetLanguage.locale,
      "target script": course.targetLanguage.script,
      "target speech locale": course.targetLanguage.speechLocale,
    })) {
      assert(typeof value === "string" && value.trim(), `${courseLabel} ${name} must be non-empty`);
    }
    assertProductCapabilities(course.capabilities, courseLabel);
    assertNativeProviderContract(course, courseLabel, {
      assetPrefix: course.assetPrefix,
      packagedAssets,
    });
    assert(
      packagedAssets.includes(courseAssetPath(course, "setup-assets.json")),
      `${courseLabel} setup catalog is not packaged`,
    );
    assert(
      !packagedAssets.includes(courseAssetPath(course, "index.html")),
      `${courseLabel} must use the single canonical root index.html`,
    );
  }

  const [czech, mandarin] = bundle.courses;
  assert(czech.targetLanguage.id === "cs", `${label} Czech target language must be cs`);
  assert(mandarin.targetLanguage.id === "zh", `${label} Mandarin target language must be zh`);
  assert(
    czech.nativeProviders.providers.embeddings?.implementation === "vector-database-catalog-v1",
    `${label} Czech embeddings must use the native vector database catalog`,
  );
  assert(
    mandarin.nativeProviders.providers.embeddings?.implementation === "webview-english-minilm-v1",
    `${label} Mandarin embeddings must use the shared WebView MiniLM runtime`,
  );

  for (const asset of packagedAssets.filter((path) => path.startsWith("courses/"))) {
    assert(
      bundle.courses.some((course) => asset.startsWith(`${course.assetPrefix}/`)),
      `${label} contains an asset for an undeclared course: ${asset}`,
    );
  }
  assert(
    !packagedAssets.some((assetPath) => /^courses\/[^/]+\/.+\/runtime\//u.test(assetPath)),
    `${label} must not duplicate shared MiniLM runtime artifacts inside a course tree`,
  );
  assert(
    !packagedAssets.some((assetPath) => /^courses\/[^/]+\/vendor\/transformers\//u.test(assetPath)),
    `${label} must not duplicate shared Transformers.js artifacts inside a course tree`,
  );
  assert(!packagedAssets.includes("setup-assets.json"), `${label} must not retain a root single-course setup catalog`);
  assert(packagedAssets.includes(PRODUCT_COURSE_BUNDLE_ASSET), `${label} course bundle is not declared as packaged`);
  return bundle;
}

function assertStoreProfile(profile, label, defaultCourse) {
  const expectedTopLevelKeys = ["assets", "capabilities", "course", "nativeProviders", "privacy", "profile", "schemaVersion"];
  const expectedCourseKeys = ["id", "routePrefix", "sourceLanguage", "targetLanguage"];
  const expectedSourceLanguageKeys = ["id", "locale"];
  const expectedTargetLanguageKeys = ["id", "locale", "script", "speechLocale"];
  const expectedPrivacyKeys = ["bugReportsLocalOnly", "dictionaryGapReportsLocalOnly"];
  assert(
    JSON.stringify(Object.keys(profile ?? {}).sort()) === JSON.stringify(expectedTopLevelKeys),
    `${label} store profile must contain only the reviewed top-level keys`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.course ?? {}).sort()) === JSON.stringify(expectedCourseKeys),
    `${label} store profile must contain the exact course identity keys`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.course?.sourceLanguage ?? {}).sort()) ===
      JSON.stringify(expectedSourceLanguageKeys),
    `${label} store profile must contain the exact source-language keys`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.course?.targetLanguage ?? {}).sort()) ===
      JSON.stringify(expectedTargetLanguageKeys),
    `${label} store profile must contain the exact target-language keys`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.capabilities ?? {}).sort()) ===
      JSON.stringify([...PRODUCT_CAPABILITY_KEYS].sort()),
    `${label} store profile must contain the exact reviewed capabilities`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.privacy ?? {}).sort()) === JSON.stringify(expectedPrivacyKeys),
    `${label} store profile must contain the exact reviewed privacy flags`,
  );
  assert(profile?.schemaVersion === 2, `${label} store profile must use schemaVersion 2`);
  assert(profile?.profile === "product", `${label} profile must identify the Caatuu product`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profile?.course?.id), `${label} course id is invalid`);
  assert(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profile?.course?.routePrefix), `${label} course route is invalid`);
  assert(profile?.course?.sourceLanguage?.id === "en", `${label} source language must remain English`);
  for (const [name, value] of Object.entries({
    "source locale": profile?.course?.sourceLanguage?.locale,
    "target id": profile?.course?.targetLanguage?.id,
    "target locale": profile?.course?.targetLanguage?.locale,
    "target script": profile?.course?.targetLanguage?.script,
    "speech locale": profile?.course?.targetLanguage?.speechLocale,
  })) {
    assert(typeof value === "string" && value.trim(), `${label} ${name} must be non-empty`);
  }
  assert(Array.isArray(profile?.assets), `${label} store profile assets must be an array`);
  assert(new Set(profile.assets).size === profile.assets.length, `${label} store profile assets must be unique`);
  for (const asset of profile.assets) {
    assert(
      typeof asset === "string" && asset.length > 0 && !asset.startsWith("/") && !asset.includes("\\")
        && asset.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
      `${label} store profile contains an unsafe asset path`,
    );
  }
  assert(!profile.assets.includes("caatuu-profile.json"), `${label} store profile must not declare itself as an asset`);
  assert(profile.assets.includes("index.html"), `${label} store profile must declare the canonical root entry`);
  assertProductCapabilities(profile.capabilities, `${label} store profile`);
  assert(
    profile?.privacy?.bugReportsLocalOnly === true,
    `${label} store profile must keep bug reports local-only`,
  );
  assert(
    profile?.privacy?.dictionaryGapReportsLocalOnly === true,
    `${label} store profile must keep dictionary-gap reports local-only`,
  );
  assert(defaultCourse, `${label} course bundle does not contain its default course`);
  assert(profile.course.id === defaultCourse.id, `${label} compatibility profile course must match the bundle default`);
  assert(
    profile.course.routePrefix === defaultCourse.routePrefix,
    `${label} compatibility profile route must match the bundle default`,
  );
  assert(
    profile.course.sourceLanguage.id === defaultCourse.sourceLanguage.id &&
      profile.course.sourceLanguage.locale === defaultCourse.sourceLanguage.locale,
    `${label} compatibility profile source language must match the bundle default`,
  );
  for (const field of ["id", "locale", "script", "speechLocale"]) {
    assert(
      profile.course.targetLanguage[field] === defaultCourse.targetLanguage[field],
      `${label} compatibility profile target language ${field} must match the bundle default`,
    );
  }
  assert(
    JSON.stringify(profile.capabilities) === JSON.stringify(defaultCourse.capabilities),
    `${label} compatibility profile capabilities must match the bundle default`,
  );
  assert(
    JSON.stringify(profile.nativeProviders) === JSON.stringify(defaultCourse.nativeProviders),
    `${label} compatibility profile native providers must match the bundle default`,
  );
  assertNativeProviderContract(profile, label, {
    assetPrefix: defaultCourse.assetPrefix,
    packagedAssets: profile.assets,
  });
}

function assertEmbeddingCatalog(catalog, manifest, label) {
  assert(catalog?.default_model === "all-minilm-l6-v2-qint8-v0.1", `${label} must select MiniLM`);
  const active = catalog?.models?.find((model) => model?.key === catalog.default_model);
  assert(active?.status === "active", `${label} MiniLM embedding catalog entry must be active`);
  assert(
    active?.embedding_model_revision === EXPECTED_MINILM_REVISION,
    `${label} MiniLM catalog revision must remain pinned`,
  );
  assert(manifest?.model_id === catalog.default_model, `${label} embedding manifest must match the catalog`);
  assert(
    manifest?.model_revision === EXPECTED_MINILM_REVISION,
    `${label} MiniLM manifest revision must remain pinned`,
  );
  assert(manifest?.model_license === "Apache-2.0", `${label} MiniLM manifest must retain Apache-2.0`);
  assert(Array.isArray(manifest?.runtime?.artifacts), `${label} embedding manifest must list runtime artifacts`);
  for (const suffix of [
    "onnx/model_qint8_arm64.onnx",
    "ort/ort-wasm-simd-threaded.mjs",
    "ort/ort-wasm-simd-threaded.wasm",
    "LICENSE-APACHE-2.0.txt",
    "THIRD_PARTY_NOTICES.json",
  ]) {
    assert(
      manifest.runtime.artifacts.some((artifact) => artifact?.file === suffix),
      `${label} embedding manifest is missing runtime artifact ${suffix}`,
    );
  }
}

function assertGenericEmbeddingCatalog(catalog, label) {
  assert(/^https:\/\//iu.test(catalog?.base_url ?? ""), `${label} embedding catalog must declare an HTTPS base_url`);
  assert(typeof catalog?.default_model === "string" && catalog.default_model, `${label} must select an embedding model`);
  const active = catalog?.models?.find((model) => model?.key === catalog.default_model);
  assert(active?.status === "active", `${label} default embedding model must be active`);
  assert(
    (active?.input_language ?? active?.embedding_input_language ?? "en") === "en",
    `${label} Android embeddings must consume English input`,
  );
  assert(isSafeAssetPath(active?.model_file), `${label} embedding model_file is unsafe`);
  assert(isSafeAssetPath(active?.manifest_file), `${label} embedding manifest_file is unsafe`);
  assert(Number(active?.bytes) > 0, `${label} embedding model must declare positive bytes`);
  assert(/^[a-f0-9]{64}$/u.test(String(active?.sha256 ?? "")), `${label} embedding model must be hash-pinned`);
  return active;
}

function assertWebViewEmbeddingCatalog(catalog, course, label) {
  assert(catalog?.schemaVersion === 1, `${label} WebView embedding catalog must use schemaVersion 1`);
  assert(catalog?.courseId === course.id, `${label} WebView embedding catalog courseId must match the bundle`);
  assert(catalog?.embeddingPolicy?.inputLanguage === "en", `${label} WebView MiniLM input language must be English`);
  assert(catalog?.embeddingPolicy?.inputField === "embeddingText", `${label} WebView MiniLM must use embeddingText`);
  assert(catalog?.embeddingPolicy?.targetTextAllowed === false, `${label} WebView MiniLM must reject target text`);
  assert(
    catalog?.embeddingPolicy?.targetPronunciationAllowed === false,
    `${label} WebView MiniLM must reject target pronunciation text`,
  );
  assert(catalog?.runtime?.modelRequired === true, `${label} WebView MiniLM model must be required`);
  assert(
    catalog?.runtime?.sharedCatalog === `/${SHARED_EMBEDDING_RUNTIME_CATALOG_ASSET}`,
    `${label} WebView MiniLM must use the packaged shared runtime catalog`,
  );
  assert(
    catalog?.runtime?.rankerModule === "/language-runtime/static/source/english-minilm-ranker.mjs",
    `${label} WebView MiniLM must use the shared English ranker`,
  );
  assert(
    catalog?.runtime?.defaultModelId === EXPECTED_MINILM_RUNTIME_ID,
    `${label} WebView MiniLM must select the reviewed shared runtime`,
  );
  assert(catalog?.runtime?.modelDelivery === "android-bundled", `${label} WebView MiniLM must use bundled delivery`);
  assert(catalog?.runtime?.modelPrecached === true, `${label} WebView MiniLM model must be precached`);
  assert(catalog?.runtime?.androidPackaged === true, `${label} WebView MiniLM model must be packaged`);
}

function assertSharedEmbeddingRuntimeCatalog(unzip, archive, entries, kind, label, profile) {
  const catalog = parseJsonAsset(
    unzip,
    archive,
    SHARED_EMBEDDING_RUNTIME_CATALOG_ASSET,
    kind,
    label,
  );
  assert(
    hasExactKeys(catalog, ["$schema", "schemaVersion", "runtimes"]),
    `${label} shared embedding runtime catalog has unsupported fields`,
  );
  assert(catalog.schemaVersion === 1, `${label} shared embedding runtime catalog must use schemaVersion 1`);
  assert(Array.isArray(catalog.runtimes), `${label} shared embedding runtime catalog must list runtimes`);
  const activeRuntimes = catalog.runtimes.filter((runtime) => runtime?.status === "active");
  assert(activeRuntimes.length === 1, `${label} shared embedding runtime catalog must have one active runtime`);
  const runtime = activeRuntimes[0];
  assert(runtime.id === EXPECTED_MINILM_RUNTIME_ID, `${label} shared embedding runtime must select MiniLM`);
  assert(runtime.inputLanguage === "en", `${label} shared MiniLM input language must remain English`);
  assert(runtime.source?.revision === EXPECTED_MINILM_REVISION, `${label} shared MiniLM revision must remain pinned`);
  assert(runtime.source?.license === "Apache-2.0", `${label} shared MiniLM license must remain Apache-2.0`);
  assert(runtime.embedding?.dimension === 384, `${label} shared MiniLM dimension must remain 384`);
  assert(runtime.embedding?.normalized === true, `${label} shared MiniLM embeddings must remain normalized`);
  assert(
    runtime.runtime?.transformersModuleUrl === "/language-runtime/vendor/transformers/transformers.min.js",
    `${label} shared MiniLM must use the packaged Transformers.js module`,
  );
  assert(
    runtime.runtime?.localModelPath === "/language-runtime/models/",
    `${label} shared MiniLM model path must remain local`,
  );
  assert(
    runtime.runtime?.modelId === `${EXPECTED_MINILM_RUNTIME_ID}/runtime`,
    `${label} shared MiniLM runtime modelId is unsupported`,
  );
  assert(Array.isArray(runtime.artifacts), `${label} shared MiniLM runtime must list artifacts`);
  assert(runtime.artifacts.length === 12, `${label} shared MiniLM runtime must retain all 12 reviewed artifacts`);

  const entrySet = new Set(entries);
  const artifactPaths = new Set();
  for (const artifact of runtime.artifacts) {
    assert(
      hasExactKeys(artifact, ["path", "url", "bytes", "sha256"]),
      `${label} shared MiniLM artifact has unsupported fields`,
    );
    assert(isSafeAssetPath(artifact.path), `${label} shared MiniLM artifact path is unsafe`);
    assert(
      artifact.path.startsWith("models/") || artifact.path.startsWith("vendor/"),
      `${label} shared MiniLM artifact must be under language-runtime/models or language-runtime/vendor`,
    );
    assert(!artifactPaths.has(artifact.path), `${label} shared MiniLM artifact path is duplicated`);
    artifactPaths.add(artifact.path);
    const assetPath = `language-runtime/${artifact.path}`;
    assert(artifact.url === `/${assetPath}`, `${label} shared MiniLM artifact URL must match its asset path`);
    assert(profile.assets.includes(assetPath), `${label} shared MiniLM artifact ${assetPath} is not declared`);
    const entry = archiveEntryForAsset(assetPath, kind);
    assert(entrySet.has(entry), `${label} is missing shared MiniLM artifact ${entry}`);
    const bytes = archiveBuffer(unzip, archive, entry);
    assert(
      Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes === bytes.length,
      `${label} shared MiniLM artifact ${assetPath} byte count does not match the catalog`,
    );
    assert(
      /^[a-f0-9]{64}$/u.test(artifact.sha256) &&
        createHash("sha256").update(bytes).digest("hex") === artifact.sha256,
      `${label} shared MiniLM artifact ${assetPath} SHA-256 does not match the catalog`,
    );
  }
  for (const suffix of [
    "vendor/transformers/transformers.min.js",
    `models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/config.json`,
    `models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/onnx/model_qint8_arm64.onnx`,
    `models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/ort/ort-wasm-simd-threaded.mjs`,
    `models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/ort/ort-wasm-simd-threaded.wasm`,
    `models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/LICENSE-APACHE-2.0.txt`,
    `models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/THIRD_PARTY_NOTICES.json`,
  ]) {
    assert(artifactPaths.has(suffix), `${label} shared MiniLM catalog is missing ${suffix}`);
  }
  assert(
    !profile.assets.some((assetPath) => /^courses\/[^/]+\/.+\/runtime\//u.test(assetPath)),
    `${label} must not duplicate shared MiniLM runtime artifacts inside a course tree`,
  );
  assert(
    !profile.assets.some((assetPath) => /^courses\/[^/]+\/vendor\/transformers\//u.test(assetPath)),
    `${label} must not duplicate shared Transformers.js artifacts inside a course tree`,
  );
  return runtime.artifacts;
}

function providerReferenceAsset(catalogAsset, reference) {
  const catalogDirectory = catalogAsset.includes("/")
    ? catalogAsset.slice(0, catalogAsset.lastIndexOf("/"))
    : "";
  const resolved = catalogDirectory && !reference.startsWith(`${catalogDirectory}/`)
    ? `${catalogDirectory}/${reference}`
    : reference;
  assert(isSafeAssetPath(resolved), "provider manifest reference is unsafe");
  return resolved;
}

function assertGenericEmbeddingManifest(active, manifest, label) {
  assert(manifest?.model_id === active.key, `${label} embedding manifest model_id must match the catalog`);
  assert(Number(manifest?.bytes) === Number(active.bytes), `${label} embedding manifest bytes must match the catalog`);
  assert(manifest?.sha256 === active.sha256, `${label} embedding manifest SHA-256 must match the catalog`);
  assert(manifest?.embedding_dimension === 384, `${label} vector provider requires 384-dimensional embeddings`);
  assert(manifest?.embedding_text_field === "english_text", `${label} embedding manifest must identify english_text`);
  assert(manifest?.embedding_input_policy === "english_text_only", `${label} embedding manifest must enforce english_text_only`);
  assert(typeof manifest?.schema_name === "string" && manifest.schema_name, `${label} embedding manifest schema_name is required`);
  assert(Number.isSafeInteger(manifest?.schema_version) && manifest.schema_version > 0, `${label} embedding manifest schema_version is invalid`);
}

function assertDictionaryCatalog(catalog, manifest, label) {
  assert(
    catalog?.default_dictionary === "kaikki-cs-en-2026-07-09",
    `${label} must select the reviewed Czech-English dictionary`,
  );
  const active = catalog?.dictionaries?.find(
    (dictionary) => dictionary?.key === catalog.default_dictionary,
  );
  assert(active?.status === "active", `${label} default dictionary catalog entry must be active`);
  assert(active?.artifact_kind === "dictionary-database", `${label} default dictionary kind is incorrect`);
  assert(active?.direction === "cs-en", `${label} default dictionary direction must be cs-en`);
  assert(
    Number.isSafeInteger(active?.bytes) && active.bytes > 0,
    `${label} default dictionary must declare a positive byte count`,
  );
  assert(
    /^[a-f0-9]{64}$/u.test(active?.sha256 ?? ""),
    `${label} default dictionary must have a SHA-256`,
  );
  assert(
    /^https:\/\/[a-z0-9.-]+(?:\/|$)/iu.test(active?.download_url ?? ""),
    `${label} default dictionary must use an HTTPS download URL`,
  );
  assert(
    active?.manifest_file === `${catalog.default_dictionary}/manifest.json`,
    `${label} default dictionary must identify its packaged manifest`,
  );
  for (const field of ["key", "status", "artifact_kind", "direction", "bytes", "sha256", "download_url"]) {
    assert(
      manifest?.[field] === active[field],
      `${label} dictionary manifest ${field} must match the catalog`,
    );
  }
}

function assertGenericDictionaryCatalog(catalog, label) {
  const defaultKey = catalog?.default_dictionary ?? catalog?.default_dictionary_key;
  assert(typeof defaultKey === "string" && defaultKey, `${label} must select a dictionary`);
  const active = catalog?.dictionaries?.find((dictionary) => dictionary?.key === defaultKey);
  assert(active?.status === "active", `${label} default dictionary must be active`);
  assert(active?.artifact_kind === "dictionary-database", `${label} dictionary artifact kind is incorrect`);
  assert(Number(active?.bytes ?? active?.expected_bytes) > 0, `${label} dictionary must declare positive bytes`);
  assert(/^[a-f0-9]{64}$/u.test(String(active?.sha256 ?? "")), `${label} dictionary must be hash-pinned`);
  assert(typeof active?.download_url === "string" && active.download_url, `${label} dictionary must declare a download URL`);
}

function assertSetupEmbeddingBoundary(
  setup,
  label,
  { strictCzech = false, sharedRuntimeArtifacts = [] } = {},
) {
  const embeddingArtifacts = (setup?.artifacts ?? []).filter(
    (artifact) => artifact?.artifact_kind === "embedding-runtime",
  );
  assert(embeddingArtifacts.length > 0, `${label} setup manifest must retain embedding runtime artifacts`);
  assert(
    embeddingArtifacts.every(
      (artifact) =>
        artifact.native_required === true &&
        artifact.browser_required === true &&
        Number.isSafeInteger(artifact.bytes) &&
        artifact.bytes > 0 &&
        /^[a-f0-9]{64}$/u.test(artifact.sha256),
    ),
    `${label} embedding runtime entries must remain required and hash-pinned`,
  );
  const targets = embeddingArtifacts.map(
    (artifact) => `${decodeURIComponent(String(artifact.url || ""))} ${artifact.asset_path || ""}`,
  );
  if (strictCzech) {
    assert(embeddingArtifacts.length === 10, `${label} Czech setup manifest must retain all 10 embedding runtime artifacts`);
    for (const suffix of [
      "/onnx/model_qint8_arm64.onnx",
      "/ort/ort-wasm-simd-threaded.mjs",
      "/ort/ort-wasm-simd-threaded.wasm",
    ]) {
      assert(targets.some((target) => target.includes(suffix)), `${label} setup manifest is missing ${suffix}`);
    }
    const sharedByAssetPath = new Map(
      sharedRuntimeArtifacts.map((artifact) => [`language-runtime/${artifact.path}`, artifact]),
    );
    for (const artifact of embeddingArtifacts) {
      const urlAssetPath = decodeURIComponent(String(artifact.url || ""))
        .split("?", 1)[0]
        .replace(/^\/+/, "");
      assert(
        artifact.asset_path === urlAssetPath && urlAssetPath.startsWith(`language-runtime/models/${EXPECTED_MINILM_RUNTIME_ID}/runtime/`),
        `${label} Czech setup embedding artifact must reference the shared packaged MiniLM runtime`,
      );
      const sharedArtifact = sharedByAssetPath.get(urlAssetPath);
      assert(sharedArtifact, `${label} Czech setup embedding artifact is absent from the shared runtime catalog`);
      assert(
        artifact.bytes === sharedArtifact.bytes && artifact.sha256 === sharedArtifact.sha256,
        `${label} Czech setup embedding artifact bytes and hash must match the shared runtime catalog`,
      );
    }
    const offlineAssets = (setup?.offline?.assets ?? []).map((value) => decodeURIComponent(String(value)).split("?", 1)[0]);
    assert(
      offlineAssets.includes("/language-runtime/vendor/transformers/transformers.min.js"),
      `${label} Czech setup must precache the shared Transformers.js module`,
    );
    assert(
      !offlineAssets.some((value) => /^\/(?!language-runtime\/)[a-z0-9-]+\/(?:data\/embeddings\/.+\/runtime|vendor\/transformers)\//u.test(value)),
      `${label} Czech setup must not precache a course-local MiniLM runtime`,
    );
  }
}

function assertEmbeddingConfinement(vectorSource, label) {
  for (const pattern of [
    /env\.allowRemoteModels\s*=\s*false/,
    /env\.allowLocalModels\s*=\s*true/,
    /pipeline\(\s*["']feature-extraction["']/,
    /local_files_only\s*:\s*true/,
    /defaultTransformersModuleUrl\s*=\s*["']\/language-runtime\/vendor\/transformers\/transformers\.min\.js["']/,
    /defaultSemanticModelPath\s*=\s*["']\/language-runtime\/models\/["']/,
    /defaultOrtWasmModuleUrl\s*=\s*["']\/language-runtime\/models\/all-minilm-l6-v2-qint8-v0\.1\/runtime\/ort\/ort-wasm-simd-threaded\.mjs["']/,
    /defaultOrtWasmBinaryUrl\s*=\s*["']\/language-runtime\/models\/all-minilm-l6-v2-qint8-v0\.1\/runtime\/ort\/ort-wasm-simd-threaded\.wasm["']/,
  ]) {
    assert(pattern.test(vectorSource), `${label} vector runtime is missing local embedding confinement ${pattern}`);
  }
}

function assertNoForbiddenFirstPartySource(unzip, archive, entries, kind, label) {
  for (const entry of entries) {
    const assetPath = normalizeAssetPath(entry, kind);
    if (
      !assetPath ||
      assetPath.startsWith("vendor/") ||
      assetPath.startsWith("language-runtime/vendor/") ||
      assetPath.startsWith("language-runtime/models/") ||
      /^courses\/[^/]+\/vendor\//u.test(assetPath)
    ) continue;
    if (CAPABILITY_GATED_SHARED_APP_PATHS.has(assetPath)) continue;
    const extension = assetPath.slice(assetPath.lastIndexOf("."));
    if (!FIRST_PARTY_EXECUTABLE_EXTENSIONS.has(extension)) continue;
    const source = archiveText(unzip, archive, entry);
    for (const pattern of FORBIDDEN_FIRST_PARTY_SOURCE_PATTERNS) {
      assert(!pattern.test(source), `${label} first-party asset ${entry} contains forbidden product pattern ${pattern}`);
    }
  }
}

function assertAssetBoundary(unzip, archive, entries, kind, label) {
  assertNoForbiddenPaths(entries, label);
  const profileEntry = archiveEntryForAsset("caatuu-profile.json", kind);
  const bundleEntry = archiveEntryForAsset(PRODUCT_COURSE_BUNDLE_ASSET, kind);
  assert(entries.includes(profileEntry), `${label} is missing required product asset ${profileEntry}`);
  assert(entries.includes(bundleEntry), `${label} is missing required product asset ${bundleEntry}`);
  const profile = parseJsonAsset(unzip, archive, "caatuu-profile.json", kind, label);
  const bundle = parseJsonAsset(unzip, archive, PRODUCT_COURSE_BUNDLE_ASSET, kind, label);
  assertCourseBundleContract(bundle, profile, label);
  const defaultCourse = bundle.courses.find((course) => course.id === bundle.defaultCourseId);
  assertStoreProfile(profile, label, defaultCourse);
  assertDeclaredAssetBoundary(entries, kind, label, profile);
  assertRequiredAssets(entries, kind, label, bundle);
  assertCanonicalAppEntry(unzip, archive, kind, label);
  assertCanonicalCapabilityGatedSharedAssets(unzip, archive, kind, label);
  const sharedRuntimeArtifacts = bundle.courses.some((course) => course.capabilities.embeddings)
    ? assertSharedEmbeddingRuntimeCatalog(unzip, archive, entries, kind, label, profile)
    : [];
  for (const course of bundle.courses) {
    const courseLabel = `${label} ${course.id} course`;
    const strictCzech = course.id === "cz";
    if (course.capabilities.embeddings) {
      const embeddingProvider = course.nativeProviders.providers.embeddings;
      const embeddingCatalogAsset = embeddingProvider.catalogAsset;
      const catalog = parseJsonAsset(unzip, archive, embeddingCatalogAsset, kind, courseLabel);
      if (embeddingProvider.implementation === "webview-english-minilm-v1") {
        assertWebViewEmbeddingCatalog(catalog, course, courseLabel);
      } else {
        const activeEmbedding = assertGenericEmbeddingCatalog(catalog, courseLabel);
        const embeddingManifestAsset = providerReferenceAsset(
          embeddingCatalogAsset,
          activeEmbedding.manifest_file,
        );
        assert(profile.assets.includes(embeddingManifestAsset), `${courseLabel} embedding provider manifest is not packaged`);
        const embeddingManifest = parseJsonAsset(
          unzip,
          archive,
          embeddingManifestAsset,
          kind,
          courseLabel,
        );
        assertGenericEmbeddingManifest(activeEmbedding, embeddingManifest, courseLabel);
        if (strictCzech) assertEmbeddingCatalog(catalog, embeddingManifest, courseLabel);
        const setupAsset = courseAssetPath(course, "setup-assets.json");
        const setup = parseJsonAsset(unzip, archive, setupAsset, kind, courseLabel);
        assertSetupEmbeddingBoundary(setup, courseLabel, { strictCzech, sharedRuntimeArtifacts });
        const vectorSourceAsset = courseAssetPath(course, "source/shared/vector-db.js");
        if (profile.assets.includes(vectorSourceAsset)) {
          assertEmbeddingConfinement(
            archiveText(unzip, archive, archiveEntryForAsset(vectorSourceAsset, kind)),
            courseLabel,
          );
        }
      }
    }
    if (course.capabilities.dictionary) {
      const dictionaryCatalogAsset = course.nativeProviders.providers.dictionary.catalogAsset;
      const dictionaryCatalog = parseJsonAsset(
        unzip,
        archive,
        dictionaryCatalogAsset,
        kind,
        courseLabel,
      );
      assertGenericDictionaryCatalog(dictionaryCatalog, courseLabel);
      if (strictCzech) {
        const dictionaryManifest = parseJsonAsset(
          unzip,
          archive,
          courseAssetPath(course, "data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json"),
          kind,
          courseLabel,
        );
        assertDictionaryCatalog(dictionaryCatalog, dictionaryManifest, courseLabel);
      }
    }
  }
  assertNoForbiddenFirstPartySource(unzip, archive, entries, kind, label);
  return { bundle, profile };
}

function assertApkManifest(apkanalyzerPath, apk, allowTransitionDebug = false) {
  const command = (subject, verb) => run(apkanalyzerPath, [subject, verb, apk]).trim();
  assert(command("manifest", "application-id") === EXPECTED_APPLICATION_ID, "Caatuu APK application ID is incorrect");
  assert(Number(command("manifest", "min-sdk")) === EXPECTED_MIN_SDK, "Caatuu APK min SDK must be 30");
  assert(Number(command("manifest", "target-sdk")) >= MINIMUM_TARGET_SDK, "Caatuu APK target SDK must be at least 36");
  assert(
    command("manifest", "debuggable") === (allowTransitionDebug ? "true" : "false"),
    allowTransitionDebug
      ? "Caatuu transition APK must be debuggable for compatibility with the old updater"
      : "Caatuu APK must be non-debuggable",
  );

  const permissions = new Set(
    command("manifest", "permissions")
      .split(/\r?\n/u)
      .map((permission) => permission.trim())
      .filter(Boolean),
  );
  assert(permissions.has("android.permission.INTERNET"), "Caatuu APK must retain INTERNET permission");
  assert(
    permissions.has("android.permission.REQUEST_INSTALL_PACKAGES"),
    "direct Caatuu APK must retain REQUEST_INSTALL_PACKAGES for verified self-updates",
  );

  const manifest = command("manifest", "print");
  assert(/android:usesCleartextTraffic="false"/u.test(manifest), "Caatuu APK must disable cleartext traffic");
  assert(/android:name="com\.caatuu\.android\.CaatuuActivity"/u.test(manifest), "Caatuu APK must launch CaatuuActivity");
  assert(/androidx\.core\.content\.FileProvider/u.test(manifest), "Caatuu APK must expose its private verified-update FileProvider");
  assert(!/android:name="com\.caatuu\.android\.MainActivity"/u.test(manifest), "Caatuu APK must not retain the development MainActivity");
}

function assertDexBoundary(apkanalyzerPath, apk, profile) {
  const dex = run(apkanalyzerPath, ["dex", "packages", "--defined-only", apk]);
  for (const className of requiredNativeClassNames(profile)) {
    assert(
      new RegExp(`\\b${escapeRegExp(className)}(?:\\$|\\s|$)`, "u").test(dex),
      `Caatuu APK is missing native class ${className}`,
    );
  }
  for (const pattern of FORBIDDEN_NATIVE_CLASS_PATTERNS) {
    assert(!pattern.test(dex), `Caatuu APK contains forbidden native class pattern ${pattern}`);
  }
  for (const method of [
    "runPrompt",
    "loadModel",
    "downloadModel",
    "startModelDownload",
    "resetConversation",
    "runBenchmark",
  ]) {
    assert(!new RegExp(`\\b${method}\\b`, "u").test(dex), `Caatuu APK contains forbidden bridge method ${method}`);
  }

  const bridgeCode = run(apkanalyzerPath, [
    "dex",
    "code",
    "--class",
    "com.caatuu.android.ProductBridge",
    apk,
  ]);
  for (const operation of [
    "start_download",
    "cancel_download",
    "reset_conversation",
    "prompt",
    "benchmark",
    "delete_model",
  ]) {
    assert(
      !new RegExp(`const-string[^\\n]+"${operation}"`, "u").test(bridgeCode),
      `Caatuu bridge exposes forbidden native operation ${operation}`,
    );
  }
}

function verifyAabDerivedApkAssets(unzip, aab, aabEntries, apk, apkEntries, allowTransitionDebug = false) {
  const aabAssets = new Map(
    aabEntries
      .map((entry) => [normalizeAssetPath(entry, "aab"), entry])
      .filter(([assetPath]) => assetPath && !assetPath.endsWith("/")),
  );
  const apkAssets = new Map(
    apkEntries
      .map((entry) => [normalizeAssetPath(entry, "apk"), entry])
      .filter(([assetPath]) => assetPath && !assetPath.endsWith("/")),
  );
  for (const [assetPath, aabEntry] of aabAssets) {
    const apkEntry = apkAssets.get(assetPath);
    assert(Boolean(apkEntry), `universal APK is missing AAB asset ${assetPath}`);
    assert(
      archiveBuffer(unzip, aab, aabEntry).equals(archiveBuffer(unzip, apk, apkEntry)),
      `universal APK contains bytes different from the AAB for ${assetPath}`,
    );
  }
  const derivedApkAssets = [...apkAssets.keys()].filter((assetPath) => !aabAssets.has(assetPath));
  const expectedDerivedAssets = allowTransitionDebug
    ? []
    : [...BUNDLETOOL_DERIVED_APK_ASSET_PATHS];
  assert(
    JSON.stringify(derivedApkAssets.sort()) === JSON.stringify(expectedDerivedAssets),
    `universal APK contains unexpected bundletool-derived assets: ${derivedApkAssets.join(", ")}`,
  );
}

export function validateProductArchiveAssets({
  unzip,
  aab,
  apk,
  allowTransitionDebug = false,
}) {
  const aabEntries = archiveEntries(unzip, aab);
  const apkEntries = archiveEntries(unzip, apk);
  const aabContract = assertAssetBoundary(unzip, aab, aabEntries, "aab", "Caatuu AAB");
  const apkContract = assertAssetBoundary(unzip, apk, apkEntries, "apk", "AAB-derived universal APK");
  assert(
    JSON.stringify(aabContract) === JSON.stringify(apkContract),
    "Caatuu AAB and AAB-derived APK must declare identical product course contracts",
  );
  verifyAabDerivedApkAssets(
    unzip,
    aab,
    aabEntries,
    apk,
    apkEntries,
    allowTransitionDebug,
  );
  return apkContract;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Caatuu package validator usage error: ${error.message}`);
    usage();
    process.exitCode = 2;
    return;
  }
  if (options.help) return usage();

  const aab = resolve(options.aab);
  const apk = resolve(options.apk);
  try {
    assert(existsSync(aab), `Caatuu AAB does not exist at ${aab}`);
    assert(existsSync(apk), `AAB-derived universal APK does not exist at ${apk}`);

    const apkContract = validateProductArchiveAssets({
      unzip: options.unzip,
      aab,
      apk,
      allowTransitionDebug: options.allowTransitionDebug,
    });
    assertApkManifest(options.apkanalyzer, apk, options.allowTransitionDebug);
    assertDexBoundary(options.apkanalyzer, apk, apkContract.bundle);

    console.log(`Caatuu package boundary passed for ${basename(aab)} and ${basename(apk)}.`);
  } catch (error) {
    console.error(`Caatuu package boundary failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) main();
