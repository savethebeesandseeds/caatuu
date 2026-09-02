import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  extractLearnerContent,
  inspectLearnerFields
} from "../../../tools/czech-ml/scripts/learner-content-safety-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "../../..");
export const DEFAULT_COURSE_MANIFEST_PATH = "apps/languages/czech/course.json";
export const DEFAULT_COURSE_BUNDLE_PATH = "apps/android/course-bundle.json";
export const CANONICAL_APP_ENTRY_PATH = "apps/language-runtime/static/app/index.html";
export const SHARED_APP_ASSET_CATALOG_PATH = "apps/language-runtime/app-assets.json";
export const EMBEDDING_RUNTIME_CATALOG_PATH = "apps/language-runtime/embedding-runtimes.json";
export const PRODUCT_COURSE_BUNDLE_ASSET = "caatuu-course-bundle.json";

function isInside(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function confinedWorkspacePath(workspaceRoot, value, label, { allowAbsolute = false } = {}) {
  assert.equal(typeof value, "string", `${label} must be a string path`);
  assert.ok(value.trim(), `${label} must not be empty`);
  if (!allowAbsolute) assert.ok(!isAbsolute(value), `${label} must be repository-relative`);
  const candidate = resolve(workspaceRoot, value);
  assert.ok(isInside(workspaceRoot, candidate), `${label} must stay inside the workspace`);
  if (existsSync(candidate)) {
    const realWorkspace = realpathSync(workspaceRoot);
    const realCandidate = realpathSync(candidate);
    assert.ok(isInside(realWorkspace, realCandidate), `${label} must not escape the workspace through a link`);
  }
  return candidate;
}

function requireObject(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function readJson(path, label) {
  assert.ok(existsSync(path), `${label} is missing: ${path}`);
  assert.ok(statSync(path).isFile(), `${label} is not a file: ${path}`);
  try {
    return requireObject(JSON.parse(readFileSync(path, "utf8")), label);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function normalizedCatalogPath(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value && value === value.trim(), `${label} must be a nonblank trimmed path`);
  assert.ok(!isAbsolute(value), `${label} must be relative`);
  assert.doesNotMatch(value, /\\/, `${label} must use forward slashes`);
  const segments = value.split("/");
  assert.ok(segments.every((segment) => segment && segment !== "." && segment !== ".."), `${label} must be normalized and confined`);
  return value;
}

function resourcePath(course, name, workspaceRoot) {
  const resource = requireObject(course.resources?.[name], `course resource ${name}`);
  assert.equal(resource.state, "present", `course resource ${name} must be present for Android packaging`);
  assert.ok(["file", "directory"].includes(resource.kind), `course resource ${name} has an unsupported kind`);
  return {
    resource,
    path: confinedWorkspacePath(workspaceRoot, resource.path, `course resource ${name}`),
  };
}

const ANDROID_NATIVE_PROVIDER_SPECS = Object.freeze({
  embeddings: Object.freeze({
    capability: "embeddings",
    implementations: Object.freeze([
      "vector-database-catalog-v1",
      "webview-english-minilm-v1",
    ]),
    resource: "embeddingCatalog",
  }),
  dictionary: Object.freeze({
    capability: "dictionary",
    implementations: Object.freeze(["sqlite-dictionary-catalog-v1"]),
    resource: "dictionaryCatalog",
  }),
  speech: Object.freeze({
    capability: "speech",
    implementations: Object.freeze(["android-text-to-speech-v1"]),
    localeSource: "targetLanguage.speechLocale",
  }),
});

function exactObjectKeys(value, expected, label) {
  const actual = Object.keys(requireObject(value, label)).sort();
  assert.deepEqual(actual, [...expected].sort(), `${label} must contain exactly ${expected.join(", ")}`);
}

function resolveAndroidNativeProviders({ course, assetCatalog, resourceAssetPath }) {
  const contract = requireObject(assetCatalog.nativeProviders, "Android native provider contract");
  exactObjectKeys(contract, ["schemaVersion", "providers"], "Android native provider contract");
  assert.equal(contract.schemaVersion, 1, "Android native provider contract must use schemaVersion 1");
  const declarations = requireObject(contract.providers, "Android native provider declarations");
  for (const name of Object.keys(declarations)) {
    assert.ok(name in ANDROID_NATIVE_PROVIDER_SPECS, `Android native provider ${name} is unsupported`);
  }

  const resolved = {};
  for (const [name, spec] of Object.entries(ANDROID_NATIVE_PROVIDER_SPECS)) {
    const enabled = course.capabilities?.[spec.capability] === true;
    const declaration = declarations[name];
    if (!enabled) {
      assert.equal(declaration, undefined, `Android native provider ${name} must be absent when ${spec.capability} is disabled`);
      continue;
    }
    requireObject(declaration, `Android native provider ${name}`);
    if (spec.resource) {
      exactObjectKeys(declaration, ["implementation", "resource"], `Android native provider ${name}`);
      assert.ok(
        spec.implementations.includes(declaration.implementation),
        `Android native provider ${name} implementation is unsupported`,
      );
      assert.equal(declaration.resource, spec.resource, `Android native provider ${name} must reference resources.${spec.resource}`);
      resolved[name] = Object.freeze({
        implementation: declaration.implementation,
        catalogAsset: resourceAssetPath(spec.resource),
      });
    } else {
      exactObjectKeys(declaration, ["implementation", "localeSource"], `Android native provider ${name}`);
      assert.ok(
        spec.implementations.includes(declaration.implementation),
        `Android native provider ${name} implementation is unsupported`,
      );
      assert.equal(declaration.localeSource, spec.localeSource, `Android native provider ${name} locale source is unsupported`);
      resolved[name] = Object.freeze({
        implementation: declaration.implementation,
        locale: course.targetLanguage?.speechLocale,
      });
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    providers: Object.freeze(resolved),
  });
}

function assertWebViewEmbeddingCatalog(catalog, course) {
  assert.equal(catalog.schemaVersion, 1, "WebView embedding catalog must use schemaVersion 1");
  assert.equal(catalog.courseId, course.id, "WebView embedding catalog courseId must match the course");
  assert.equal(catalog.embeddingPolicy?.inputLanguage, "en", "WebView MiniLM input must be English");
  assert.equal(catalog.embeddingPolicy?.inputField, "embeddingText", "WebView MiniLM must use authored embeddingText");
  assert.equal(catalog.embeddingPolicy?.targetTextAllowed, false, "WebView MiniLM must reject target-language text");
  assert.equal(catalog.embeddingPolicy?.targetPronunciationAllowed, false, "WebView MiniLM must reject pronunciation text");
  assert.equal(catalog.runtime?.modelRequired, true, "WebView MiniLM must require the model");
  assert.equal(
    catalog.runtime?.sharedCatalog,
    "/language-runtime/embedding-runtimes.json",
    "WebView MiniLM must use the canonical shared runtime catalog",
  );
  assert.equal(
    catalog.runtime?.rankerModule,
    "/language-runtime/static/source/english-minilm-ranker.mjs",
    "WebView MiniLM must use the shared English ranker",
  );
  assert.match(
    String(catalog.runtime?.defaultModelId || ""),
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/,
    "WebView MiniLM must select a stable shared runtime ID",
  );
}

export function productCapabilitiesForCourse(course) {
  const capabilities = requireObject(course.capabilities, "course capabilities");
  for (const name of [
    "llm",
    "generation",
    "chat",
    "embeddings",
    "semanticSearch",
    "dictionary",
    "memory",
    "verbs",
    "wordWorld",
    "conjugationComet",
    "offlineModels",
    "speech",
    "pronunciationGuides",
  ]) {
    assert.equal(typeof capabilities[name], "boolean", `course capability ${name} must be boolean`);
  }
  assert.ok(!capabilities.semanticSearch || capabilities.embeddings, "semanticSearch requires embeddings");
  assert.ok(!capabilities.generation || capabilities.llm, "generation requires llm");
  assert.ok(!capabilities.chat || capabilities.llm, "chat requires llm");
  return Object.freeze({
    // Public Android products intentionally do not expose generative execution.
    chat: false,
    llm: false,
    generation: false,
    godot: false,
    embeddings: capabilities.embeddings,
    semanticSearch: capabilities.semanticSearch,
    imageLookup: capabilities.wordWorld,
    stats: capabilities.memory,
    dictionary: capabilities.dictionary,
    memory: capabilities.memory,
    verbs: capabilities.verbs,
    wordWorld: capabilities.wordWorld,
    conjugationComet: capabilities.conjugationComet,
    offlineModels: false,
    speech: capabilities.speech,
    pronunciationGuides: capabilities.pronunciationGuides,
    wordWorldStandardOnly: capabilities.wordWorld,
  });
}

export function productProfileForCourse(course, { assetPaths = [], nativeProviders } = {}) {
  requireObject(nativeProviders, "resolved Android native provider contract");
  const packagedAssets = assetPaths
    .map((value, index) => normalizedCatalogPath(value, `product asset ${index}`))
    .sort();
  assert.equal(new Set(packagedAssets).size, packagedAssets.length, "product assets must be unique");
  return Object.freeze({
    schemaVersion: 2,
    profile: "product",
    course: Object.freeze({
      id: course.id,
      routePrefix: course.routePrefix,
      sourceLanguage: Object.freeze({
        id: course.sourceLanguage?.id,
        locale: course.sourceLanguage?.locale,
      }),
      targetLanguage: Object.freeze({
        id: course.targetLanguage?.id,
        locale: course.targetLanguage?.locale,
        script: course.targetLanguage?.script,
        speechLocale: course.targetLanguage?.speechLocale,
      }),
    }),
    assets: Object.freeze(packagedAssets),
    nativeProviders,
    capabilities: productCapabilitiesForCourse(course),
    privacy: Object.freeze({
      bugReportsLocalOnly: true,
      dictionaryGapReportsLocalOnly: true,
    }),
  });
}

export function loadAndroidCourseConfiguration({
  workspaceRoot = defaultWorkspaceRoot,
  courseManifestPath = DEFAULT_COURSE_MANIFEST_PATH,
} = {}) {
  const resolvedWorkspace = realpathSync(resolve(workspaceRoot));
  const resolvedManifest = confinedWorkspacePath(
    resolvedWorkspace,
    courseManifestPath,
    "course manifest",
    { allowAbsolute: true },
  );
  const course = readJson(resolvedManifest, "course manifest");
  assert.equal(course.schemaVersion, 1, "course manifest must use schemaVersion 1");
  assert.match(String(course.id || ""), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "course id is invalid");
  assert.match(String(course.directoryName || ""), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "course directoryName is invalid");
  assert.match(String(course.routePrefix || ""), /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/, "course routePrefix is invalid");
  assert.ok(
    String(course.entryPath || "").startsWith(`${course.routePrefix}/`),
    "course entryPath must be inside routePrefix",
  );
  assert.equal(course.sourceLanguage?.id, "en", "Android semantic mediation currently requires English as the source language");
  assert.equal(course.platforms?.android?.enabled, true, `course ${course.id} is not enabled for Android`);

  const staticRoot = resourcePath(course, "staticRoot", resolvedWorkspace);
  assert.equal(staticRoot.resource.kind, "directory", "course staticRoot must be a directory");
  const manifestWorkspacePath = slashPath(relative(resolvedWorkspace, resolvedManifest));
  if (!manifestWorkspacePath.startsWith("apps/android/tooling/tests/fixtures/")) {
    assert.equal(
      slashPath(relative(resolvedWorkspace, staticRoot.path)),
      `apps/languages/${course.directoryName}/static`,
      "course staticRoot must match directoryName",
    );
  }
  assert.ok(statSync(staticRoot.path).isDirectory(), `course staticRoot is not a directory: ${staticRoot.path}`);

  const appEntryResource = resourcePath(course, "appEntry", resolvedWorkspace);
  assert.equal(appEntryResource.resource.kind, "file", "course appEntry must be a file");
  assert.equal(
    slashPath(relative(resolvedWorkspace, appEntryResource.path)),
    CANONICAL_APP_ENTRY_PATH,
    `course appEntry must be ${CANONICAL_APP_ENTRY_PATH}`,
  );
  assert.ok(statSync(appEntryResource.path).isFile(), `course appEntry is not a file: ${appEntryResource.path}`);

  const appAssetCatalogPath = confinedWorkspacePath(
    resolvedWorkspace,
    SHARED_APP_ASSET_CATALOG_PATH,
    "shared app asset catalog",
  );
  const appAssetCatalog = readJson(appAssetCatalogPath, "shared app asset catalog");
  assert.deepEqual(
    Object.keys(appAssetCatalog).sort(),
    ["appEntry", "assets", "schemaVersion"],
    "shared app asset catalog must contain exactly appEntry, assets, and schemaVersion",
  );
  assert.equal(appAssetCatalog.schemaVersion, 1, "shared app asset catalog must use schemaVersion 1");
  assert.equal(appAssetCatalog.appEntry, CANONICAL_APP_ENTRY_PATH, "shared app asset catalog appEntry is not canonical");
  assert.ok(Array.isArray(appAssetCatalog.assets) && appAssetCatalog.assets.length > 0, "shared app asset catalog must list assets");
  const appAssets = Object.freeze(appAssetCatalog.assets.map((value, index) => {
    const mapping = requireObject(value, `shared app asset ${index}`);
    assert.deepEqual(
      Object.keys(mapping).sort(),
      ["output", "source"],
      `shared app asset ${index} must contain exactly output and source`,
    );
    const sourcePath = normalizedCatalogPath(mapping.source, `shared app asset ${index} source`);
    const output = normalizedCatalogPath(mapping.output, `shared app asset ${index} output`);
    assert.notEqual(output, "index.html", "shared app assets must not replace the canonical root entry");
    assert.notEqual(output, "caatuu-profile.json", "shared app assets must not replace the product profile");
    assert.doesNotMatch(sourcePath, /(?:^|\/)(?:README(?:\.[^/]*)?|tests?)(?:\/|$)/i, `Shared app asset is not packageable: ${sourcePath}`);
    const source = confinedWorkspacePath(resolvedWorkspace, sourcePath, `shared app asset ${index} source`);
    assert.ok(statSync(source).isFile(), `Shared app asset source is not a file: ${source}`);
    return Object.freeze({ source, sourcePath, output });
  }));
  assert.equal(
    new Set(appAssets.map(({ output }) => output)).size,
    appAssets.length,
    "shared app asset outputs must be unique",
  );
  const appAssetByOutput = new Map(appAssets.map((asset) => [asset.output, asset]));

  const assetCatalogResource = resourcePath(course, "androidAssetCatalog", resolvedWorkspace);
  assert.equal(assetCatalogResource.resource.kind, "file", "androidAssetCatalog must be a file");
  const assetCatalog = readJson(assetCatalogResource.path, "Android asset catalog");
  assert.equal(assetCatalog.schemaVersion, 1, "Android asset catalog must use schemaVersion 1");
  assert.equal(assetCatalog.courseId, course.id, "Android asset catalog courseId must match the course manifest");
  assert.ok(Array.isArray(assetCatalog.files) && assetCatalog.files.length > 0, "Android asset catalog must list files");
  assert.ok(Array.isArray(assetCatalog.launcherIconFiles), "Android asset catalog must list launcherIconFiles");

  const languageFiles = assetCatalog.files.map((value, index) => normalizedCatalogPath(value, `Android asset file ${index}`));
  assert.ok(!languageFiles.includes("index.html"), "Android course assets must not declare a course-local index.html");
  const launcherIconFiles = assetCatalog.launcherIconFiles.map((value, index) => normalizedCatalogPath(value, `Android launcher icon ${index}`));
  assert.ok(
    assetCatalog.sharedRuntimeFiles === undefined || Array.isArray(assetCatalog.sharedRuntimeFiles),
    "Android asset catalog sharedRuntimeFiles must be an array when present",
  );
  const declaredSharedRuntimeFiles = (assetCatalog.sharedRuntimeFiles || [])
    .map((value, index) => normalizedCatalogPath(value, `Android shared runtime file ${index}`));
  assert.equal(new Set(languageFiles).size, languageFiles.length, "Android asset catalog files must be unique");
  assert.equal(new Set(launcherIconFiles).size, launcherIconFiles.length, "Android launcher icon files must be unique");
  const declaredSharedRuntimeAssets = declaredSharedRuntimeFiles.map((path) => {
    assert.doesNotMatch(path, /(?:^|\/)(?:README(?:\.[^/]*)?|tests?)(?:\/|$)/i, `Shared runtime file is not packageable: ${path}`);
    const source = confinedWorkspacePath(
      resolvedWorkspace,
      `apps/language-runtime/${path}`,
      `shared language runtime file ${path}`,
    );
    assert.ok(statSync(source).isFile(), `Shared language runtime entry is not a file: ${source}`);
    return Object.freeze({ source, sourcePath: `apps/language-runtime/${path}`, output: `language-runtime/${path}` });
  });
  const sharedRuntimeAssets = Object.freeze(declaredSharedRuntimeAssets.filter((asset) => {
    const appAsset = appAssetByOutput.get(asset.output);
    if (!appAsset) return true;
    assert.equal(appAsset.source, asset.source, `Shared runtime output ${asset.output} conflicts with the shared app catalog`);
    return false;
  }));

  const resourceAssetPath = (resourceName) => {
    const resolvedResource = resourcePath(course, resourceName, resolvedWorkspace);
    assert.equal(resolvedResource.resource.kind, "file", `course resource ${resourceName} must be a file`);
    const relativeAssetPath = slashPath(relative(staticRoot.path, resolvedResource.path));
    const assetPath = normalizedCatalogPath(relativeAssetPath, `course resource ${resourceName} asset path`);
    assert.ok(
      languageFiles.includes(assetPath),
      `Android asset catalog must package resources.${resourceName} as ${assetPath}`,
    );
    return assetPath;
  };
  const nativeProviders = resolveAndroidNativeProviders({
    course,
    assetCatalog,
    resourceAssetPath,
  });
  const embeddingProvider = nativeProviders.providers.embeddings;
  if (embeddingProvider?.implementation === "webview-english-minilm-v1") {
    assert.equal(course.sourceLanguage?.id, "en", "WebView MiniLM requires English source-language mediation");
    assertWebViewEmbeddingCatalog(
      readJson(join(staticRoot.path, embeddingProvider.catalogAsset), "WebView embedding catalog"),
      course,
    );
  }

  const launcherFiles = Object.freeze([
    ...launcherIconFiles.map((name) => Object.freeze({
      source: `assets/icons/${name}`,
      output: `assets/icons/${name}`,
    })),
    ...(launcherIconFiles.length > 0 ? [Object.freeze({
      source: "assets/loading-animation/animations_manifest.json",
      output: "assets/loading_animation/animations_manifest.json",
    })] : []),
  ].filter((asset) => {
    const appAsset = appAssetByOutput.get(asset.output);
    if (!appAsset) return true;
    const expectedSource = confinedWorkspacePath(
      resolvedWorkspace,
      `apps/launcher/static/${asset.source}`,
      `shared launcher asset ${asset.output}`,
    );
    assert.equal(appAsset.source, expectedSource, `Launcher output ${asset.output} conflicts with the shared app catalog`);
    return false;
  }));
  for (const path of languageFiles) {
    assert.ok(!appAssetByOutput.has(path), `Course asset ${path} conflicts with the shared app catalog`);
  }
  const outputFiles = new Set([
    ...languageFiles,
    ...launcherFiles.map(({ output }) => output),
    ...appAssets.map(({ output }) => output),
    ...sharedRuntimeAssets.map(({ output }) => output),
    "index.html",
    "caatuu-profile.json",
  ]);
  assert.equal(
    outputFiles.size,
    languageFiles.length + launcherFiles.length + appAssets.length + sharedRuntimeAssets.length + 2,
    "Android asset outputs must be unique",
  );
  const productProfile = productProfileForCourse(course, {
    assetPaths: [...outputFiles].filter((path) => path !== "caatuu-profile.json"),
    nativeProviders,
  });

  return Object.freeze({
    workspaceRoot: resolvedWorkspace,
    courseManifestPath: resolvedManifest,
    course,
    languageStaticDir: staticRoot.path,
    appEntryPath: appEntryResource.path,
    appAssetCatalogPath,
    appAssetCatalog,
    appAssets,
    androidAssetCatalogPath: assetCatalogResource.path,
    assetCatalog,
    languageFiles: Object.freeze(languageFiles),
    launcherIconFiles: Object.freeze(launcherIconFiles),
    launcherFiles,
    sharedRuntimeFiles: Object.freeze(declaredSharedRuntimeFiles),
    sharedRuntimeAssets,
    nativeProviders,
    outputFiles,
    productProfile,
  });
}

const DEFAULT_COURSE_CONFIGURATION = loadAndroidCourseConfiguration();

// Compatibility exports remain the default Czech course views. The canonical
// source is apps/languages/czech/android-assets.json through course.json.
export const STORE_LANGUAGE_FILES = DEFAULT_COURSE_CONFIGURATION.languageFiles;
export const STORE_LAUNCHER_ICON_FILES = DEFAULT_COURSE_CONFIGURATION.launcherIconFiles;
export const PRODUCT_PROFILE = DEFAULT_COURSE_CONFIGURATION.productProfile;

function prefixedNativeProviders(nativeProviders, assetPrefix) {
  const providers = {};
  for (const [name, provider] of Object.entries(nativeProviders.providers)) {
    providers[name] = Object.freeze({
      ...provider,
      ...(provider.catalogAsset
        ? { catalogAsset: `${assetPrefix}/${provider.catalogAsset}` }
        : {}),
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    providers: Object.freeze(providers),
  });
}

function courseBundleRecord(configuration) {
  const { course } = configuration;
  const assetPrefix = `courses/${course.id}`;
  return Object.freeze({
    id: course.id,
    routePrefix: course.routePrefix,
    entryPath: course.entryPath,
    assetPrefix,
    sourceLanguage: Object.freeze({
      id: course.sourceLanguage.id,
      label: course.sourceLanguage.label,
      locale: course.sourceLanguage.locale,
    }),
    targetLanguage: Object.freeze({
      id: course.targetLanguage.id,
      label: course.targetLanguage.label,
      nativeLabel: course.targetLanguage.nativeLabel,
      locale: course.targetLanguage.locale,
      script: course.targetLanguage.script,
      speechLocale: course.targetLanguage.speechLocale,
    }),
    capabilities: productCapabilitiesForCourse(course),
    nativeProviders: prefixedNativeProviders(configuration.nativeProviders, assetPrefix),
  });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyEmbeddingRuntimeArtifactSource({
  source,
  artifact,
  artifactPath,
  allowMissingSetupDeliveredRuntimeFiles = false,
}) {
  assert.match(String(artifact.sha256 || ""), /^[a-f\d]{64}$/, `embedding runtime artifact hash is invalid: ${artifactPath}`);
  if (!existsSync(source)) {
    assert.ok(
      allowMissingSetupDeliveredRuntimeFiles,
      `embedding runtime artifact is missing: ${source}`,
    );
    return false;
  }
  assert.ok(statSync(source).isFile(), `embedding runtime artifact is not a file: ${source}`);
  assert.equal(statSync(source).size, artifact.bytes, `embedding runtime artifact byte count drifted: ${artifactPath}`);
  assert.equal(sha256File(source), artifact.sha256, `embedding runtime artifact hash drifted: ${artifactPath}`);
  return true;
}

function loadEmbeddingRuntimeAssets(
  workspaceRoot,
  { allowMissingSetupDeliveredRuntimeFiles = false } = {},
) {
  const catalogPath = confinedWorkspacePath(
    workspaceRoot,
    EMBEDDING_RUNTIME_CATALOG_PATH,
    "embedding runtime catalog",
  );
  const catalog = readJson(catalogPath, "embedding runtime catalog");
  assert.equal(catalog.schemaVersion, 1, "embedding runtime catalog must use schemaVersion 1");
  assert.ok(Array.isArray(catalog.runtimes) && catalog.runtimes.length > 0, "embedding runtime catalog must list runtimes");
  const runtimeIds = new Set();
  const assets = [];
  const outputs = new Set();
  for (const [runtimeIndex, runtime] of catalog.runtimes.entries()) {
    requireObject(runtime, `embedding runtime ${runtimeIndex}`);
    assert.match(String(runtime.id || ""), /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, `embedding runtime ${runtimeIndex} id is invalid`);
    assert.equal(runtime.status, "active", `embedding runtime ${runtime.id} must be active`);
    assert.equal(runtime.inputLanguage, "en", `embedding runtime ${runtime.id} must accept English only`);
    assert.ok(!runtimeIds.has(runtime.id), `duplicate embedding runtime ${runtime.id}`);
    runtimeIds.add(runtime.id);
    assert.ok(Array.isArray(runtime.artifacts) && runtime.artifacts.length > 0, `embedding runtime ${runtime.id} must list artifacts`);
    for (const [artifactIndex, artifact] of runtime.artifacts.entries()) {
      requireObject(artifact, `embedding runtime ${runtime.id} artifact ${artifactIndex}`);
      const artifactPath = normalizedCatalogPath(
        artifact.path,
        `embedding runtime ${runtime.id} artifact ${artifactIndex} path`,
      );
      assert.equal(
        artifact.url,
        `/language-runtime/${artifactPath}`,
        `embedding runtime ${runtime.id} artifact ${artifactPath} URL must match its path`,
      );
      assert.doesNotMatch(
        artifactPath,
        /(?:^|\/)(?:README(?:\.[^/]*)?|tests?)(?:\/|$)/i,
        `embedding runtime artifact is not packageable: ${artifactPath}`,
      );
      const source = confinedWorkspacePath(
        workspaceRoot,
        `apps/language-runtime/${artifactPath}`,
        `embedding runtime artifact ${artifactPath}`,
      );
      verifyEmbeddingRuntimeArtifactSource({
        source,
        artifact,
        artifactPath,
        allowMissingSetupDeliveredRuntimeFiles,
      });
      const output = `language-runtime/${artifactPath}`;
      assert.ok(!outputs.has(output), `duplicate embedding runtime artifact output: ${output}`);
      outputs.add(output);
      assets.push(Object.freeze({ source, output }));
    }
  }
  return Object.freeze({
    catalogPath,
    catalog,
    runtimeIds: Object.freeze(runtimeIds),
    assets: Object.freeze(assets),
  });
}

const BUNDLE_EXCLUDED_COURSE_DOCUMENTATION = Object.freeze(new Set([
  "vendor/transformers/README.md",
]));

function bundleCourseLanguageFiles(configuration, embeddingRuntime) {
  if (!embeddingRuntime.assets.length) return configuration.languageFiles;
  const sharedTransformersByCoursePath = new Map(
    embeddingRuntime.assets
      .filter(({ output }) => output.startsWith("language-runtime/vendor/transformers/"))
      .map((asset) => [asset.output.slice("language-runtime/".length), asset]),
  );
  const files = [];
  for (const path of configuration.languageFiles) {
    if (BUNDLE_EXCLUDED_COURSE_DOCUMENTATION.has(path)) continue;
    if (!path.startsWith("vendor/transformers/")) {
      files.push(path);
      continue;
    }
    const sharedAsset = sharedTransformersByCoursePath.get(path);
    assert.ok(sharedAsset, `Course ${configuration.course.id} duplicates an unlisted shared Transformers.js artifact: ${path}`);
    const courseSource = join(configuration.languageStaticDir, path);
    assert.equal(
      statSync(courseSource).size,
      statSync(sharedAsset.source).size,
      `Course ${configuration.course.id} Transformers.js byte count conflicts with the shared runtime: ${path}`,
    );
    assert.equal(
      sha256File(courseSource),
      sha256File(sharedAsset.source),
      `Course ${configuration.course.id} Transformers.js hash conflicts with the shared runtime: ${path}`,
    );
  }
  return Object.freeze(files);
}

function sharedAssetUnion(configurations, launcherStaticDir) {
  const byOutput = new Map();
  const add = ({ source, output }, label) => {
    const normalizedOutput = normalizedCatalogPath(output, `${label} output`);
    const resolvedSource = realpathSync(resolve(source));
    const existing = byOutput.get(normalizedOutput);
    if (existing) {
      assert.equal(existing.source, resolvedSource, `${label} conflicts at ${normalizedOutput}`);
      return;
    }
    byOutput.set(normalizedOutput, Object.freeze({ source: resolvedSource, output: normalizedOutput }));
  };
  for (const configuration of configurations) {
    for (const asset of configuration.appAssets) add(asset, "shared app asset");
    for (const asset of configuration.sharedRuntimeAssets) add(asset, "shared language runtime asset");
    for (const asset of configuration.launcherFiles) {
      add({ source: join(launcherStaticDir, asset.source), output: asset.output }, "shared launcher asset");
    }
  }
  return Object.freeze([...byOutput.values()].sort((left, right) => left.output.localeCompare(right.output)));
}

export function loadAndroidCourseBundleConfiguration({
  workspaceRoot = defaultWorkspaceRoot,
  courseBundlePath = DEFAULT_COURSE_BUNDLE_PATH,
  launcherStaticDir = join(workspaceRoot, "apps/launcher/static"),
  allowMissingSetupDeliveredRuntimeFiles = false,
} = {}) {
  const resolvedWorkspace = realpathSync(resolve(workspaceRoot));
  const resolvedBundlePath = confinedWorkspacePath(
    resolvedWorkspace,
    courseBundlePath,
    "Android course bundle",
    { allowAbsolute: true },
  );
  const declaration = readJson(resolvedBundlePath, "Android course bundle");
  exactObjectKeys(
    declaration,
    ["$schema", "schemaVersion", "defaultCourseId", "courses"],
    "Android course bundle",
  );
  assert.equal(declaration.schemaVersion, 1, "Android course bundle must use schemaVersion 1");
  assert.match(String(declaration.defaultCourseId || ""), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Android default course id is invalid");
  assert.ok(Array.isArray(declaration.courses) && declaration.courses.length > 0, "Android course bundle must list courses");
  const configurations = declaration.courses.map((entry, index) => {
    exactObjectKeys(entry, ["manifest"], `Android course bundle course ${index}`);
    return loadAndroidCourseConfiguration({
      workspaceRoot: resolvedWorkspace,
      courseManifestPath: entry.manifest,
    });
  });
  const ids = configurations.map(({ course }) => course.id);
  const routePrefixes = configurations.map(({ course }) => course.routePrefix);
  assert.equal(new Set(ids).size, ids.length, "Android course bundle course ids must be unique");
  assert.equal(new Set(routePrefixes).size, routePrefixes.length, "Android course bundle route prefixes must be unique");
  assert.ok(ids.includes(declaration.defaultCourseId), "Android course bundle defaultCourseId must select a bundled course");
  const defaultCourse = configurations.find(({ course }) => course.id === declaration.defaultCourseId);
  for (const configuration of configurations) {
    assert.equal(configuration.appEntryPath, defaultCourse.appEntryPath, "Bundled courses must share one canonical app entry");
    assert.deepEqual(
      configuration.appAssets.map(({ source, output }) => ({ source, output })),
      defaultCourse.appAssets.map(({ source, output }) => ({ source, output })),
      "Bundled courses must share one canonical app asset catalog",
    );
  }

  const needsWebViewMiniLm = configurations.some(({ nativeProviders }) =>
    nativeProviders.providers.embeddings?.implementation === "webview-english-minilm-v1"
  );
  const embeddingRuntime = needsWebViewMiniLm
    ? loadEmbeddingRuntimeAssets(resolvedWorkspace, { allowMissingSetupDeliveredRuntimeFiles })
    : Object.freeze({ catalogPath: null, catalog: null, runtimeIds: Object.freeze(new Set()), assets: Object.freeze([]) });
  for (const configuration of configurations) {
    const provider = configuration.nativeProviders.providers.embeddings;
    if (provider?.implementation !== "webview-english-minilm-v1") continue;
    const catalog = readJson(join(configuration.languageStaticDir, provider.catalogAsset), "WebView embedding catalog");
    assert.ok(
      embeddingRuntime.runtimeIds.has(catalog.runtime.defaultModelId),
      `Course ${configuration.course.id} selects an unbundled embedding runtime`,
    );
  }

  const resolvedLauncher = realpathSync(resolve(launcherStaticDir));
  const sharedAssets = sharedAssetUnion(configurations, resolvedLauncher);
  const courseFilesById = Object.freeze(Object.fromEntries(
    configurations.map((configuration) => [
      configuration.course.id,
      bundleCourseLanguageFiles(configuration, embeddingRuntime),
    ]),
  ));
  const courseRecords = Object.freeze(configurations.map(courseBundleRecord));
  const courseCatalog = Object.freeze({
    $schema: "https://caatuu.org/schemas/android-course-bundle-runtime.v1.schema.json",
    schemaVersion: 1,
    defaultCourseId: declaration.defaultCourseId,
    courses: courseRecords,
  });
  const outputFiles = new Set([
    "index.html",
    PRODUCT_COURSE_BUNDLE_ASSET,
    "caatuu-profile.json",
    ...sharedAssets.map(({ output }) => output),
    ...configurations.flatMap(({ course }) =>
      courseFilesById[course.id].map((path) => `courses/${course.id}/${path}`)
    ),
  ]);
  const expectedFileCount = 3
    + sharedAssets.length
    + configurations.reduce((sum, { course }) => sum + courseFilesById[course.id].length, 0);
  assert.equal(outputFiles.size, expectedFileCount, "Android course bundle asset outputs must be unique");
  const defaultRecord = courseRecords.find(({ id }) => id === declaration.defaultCourseId);
  const productProfile = productProfileForCourse(defaultCourse.course, {
    assetPaths: [...outputFiles].filter((path) => path !== "caatuu-profile.json"),
    nativeProviders: defaultRecord.nativeProviders,
  });

  return Object.freeze({
    workspaceRoot: resolvedWorkspace,
    courseBundlePath: resolvedBundlePath,
    declaration,
    defaultCourse,
    configurations: Object.freeze(configurations),
    launcherStaticDir: resolvedLauncher,
    sharedAssets,
    embeddingRuntime,
    courseFilesById,
    courseCatalog,
    outputFiles,
    productProfile,
  });
}

const TEXT_EXTENSIONS = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mjs", ".webmanifest"
]);

function slashPath(value) {
  return String(value).split(sep).join("/");
}

function extension(path) {
  const match = /(?:^|\/)([^/]+)$/.exec(slashPath(path));
  const fileName = match?.[1] || "";
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

function normalizeText(value) {
  return String(value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function countOccurrences(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function exactReplace(source, before, after, label, expectedCount = 1) {
  const count = countOccurrences(source, before);
  assert.equal(
    count,
    expectedCount,
    `${label}: expected ${expectedCount} exact source anchor(s), found ${count}`
  );
  return source.split(before).join(after);
}

function replaceBetween(source, startAnchor, endAnchor, replacement, label) {
  const startCount = countOccurrences(source, startAnchor);
  assert.equal(startCount, 1, `${label}: expected one start anchor, found ${startCount}`);
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `${label}: expected an end anchor after the start anchor`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function topLevelFunctionRange(source, name, { exported = false, indent = "" } = {}) {
  const prefix = exported ? "export " : "";
  const starts = [
    `\n${indent}${prefix}function ${name}(`,
    `\n${indent}${prefix}async function ${name}(`
  ].map((anchor) => ({ anchor, index: source.indexOf(anchor) }))
    .filter(({ index }) => index >= 0);
  assert.equal(starts.length, 1, `function ${name}: expected exactly one top-level declaration`);
  const start = starts[0].index + 1;
  const escapedIndent = indent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextPattern = exported
    ? /\n(?:export )?(?:(?:async )?function [A-Za-z_$][\w$]*\(|(?:const|let|var|class) [A-Za-z_$][\w$]*)/g
    : new RegExp(`\\n${escapedIndent}(?:async )?function [A-Za-z_$][\\w$]*\\(`, "g");
  nextPattern.lastIndex = start + starts[0].anchor.length;
  const next = nextPattern.exec(source);
  const initIndex = exported ? -1 : source.indexOf("\nvoid init()", start);
  let end = next?.index ?? source.length;
  if (initIndex >= 0 && initIndex < end) end = initIndex;
  return { start, end };
}

function removeTopLevelFunction(source, name, options = {}) {
  const { start, end } = topLevelFunctionRange(source, name, options);
  return `${source.slice(0, start)}${source.slice(end + (end < source.length ? 1 : 0))}`;
}

function replaceTopLevelFunction(source, name, replacement, options = {}) {
  const { start, end } = topLevelFunctionRange(source, name, options);
  const suffix = source.slice(end + (end < source.length ? 1 : 0));
  return `${source.slice(0, start)}${replacement.trim()}\n\n${suffix}`;
}

function stripFlatCssRules(source, patterns, label) {
  let result = source;
  let removed = 0;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("i") ? "gi" : "g";
    const matcher = new RegExp(`([^{}]*${pattern.source}[^{}]*)\\{[^{}]*\\}`, flags);
    let previous;
    do {
      previous = result;
      result = result.replace(matcher, () => {
        removed += 1;
        return "";
      });
    } while (result !== previous);
  }
  assert.ok(removed > 0, `${label}: expected at least one CSS rule to be removed`);
  return result;
}

function readSourceText(path) {
  return normalizeText(readFileSync(path, "utf8"));
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalizeText(text), "utf8");
}

function copyExactFile(source, output) {
  assert.ok(existsSync(source), `Allowlisted source is missing: ${source}`);
  assert.ok(statSync(source).isFile(), `Allowlisted source is not a file: ${source}`);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(source, output);
}

export function transformCourseProfile(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '      chatSettings: "caatuu-czech.chat.settings.v1",\n',
    "",
    "course profile chat storage"
  );
  for (const route of [
    '      chat: "chat.html",\n',
    '      audioLab: "audio-lab.html",\n',
    '      dictionary: "index.html",\n',
    '      embeddingImages: "embedding-images.html",\n',
    '      verbDifficulty: "verb-difficulty.html",\n'
  ]) {
    source = exactReplace(source, route, "", `course developer route ${route.trim()}`);
  }
  source = exactReplace(source, "      llm: true,", "      llm: false,", "course LLM capability");
  source = exactReplace(source, "      generation: true,", "      generation: false,", "course generation capability");
  source = exactReplace(source, "      chat: true,", "      chat: false,", "course chat capability");
  source = exactReplace(
    source,
    "      offlineModels: true,",
    "      offlineModels: false,",
    "course offline model capability"
  );
  source = replaceBetween(
    source,
    "      android: {",
    "    }\n  });",
    `      android: {
        enabled: true,
        channels: []
      }
`,
    "product Android publication channels"
  );
  assert.match(source, /semanticSearch: true/);
  return source;
}

export function transformManifest(input) {
  const manifest = JSON.parse(normalizeText(input));
  assert.equal(manifest.description, "Czech chat, verbs, dictionary, scripts, and guide.");
  assert.ok(manifest.shortcuts?.some((shortcut) => shortcut.url === "./chat.html"));
  manifest.description = "Czech verbs, dictionary, scripts, games, and learning guide.";
  manifest.shortcuts = manifest.shortcuts.filter((shortcut) => shortcut.url !== "./chat.html");
  manifest.icons = manifest.icons.filter((icon) => icon.src !== "icons/caatuu-czech-1024.png");
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function transformIndex(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    'aria-label="Sentence generation"',
    'aria-label="Next sentence options"',
    "shared app Word World options label",
  );
  source = replaceBetween(
    source,
    '                          <section class="word-net-generation-menu-section" role="group" aria-labelledby="wordNetContentSourceLabel">',
    "                        </div>\n                      </div>",
    "",
    "shared app Word World content source selector",
  );
  source = exactReplace(
    source,
    '                            <dt>model</dt>\n                            <dd id="wordNetMetaModel">browser fallback</dd>',
    '                            <dt>content</dt>\n                            <dd id="wordNetMetaModel">curated corpus</dd>',
    "shared app Word World diagnostics content",
  );
  source = replaceBetween(
    source,
    '                  <dialog\n                    class="word-net-generative-dialog"',
    '                <div class="word-net-embedded-status"',
    "",
    "shared app Word World optional content dialog",
  );
  assert.doesNotMatch(
    source,
    /wordNetGenerativeDialog|data-content-mode=["']generative["']|Generative mode/iu,
    "Android product app entry must exclude disabled generative controls",
  );
  assert.match(source, /data-generation-mode="random"/u);
  assert.match(source, /data-generation-mode="selected"/u);
  return source;
}

export function transformSetupAssets(input) {
  const manifest = JSON.parse(normalizeText(input));
  assert.ok(Array.isArray(manifest.artifacts), "setup assets must declare an artifact array");
  const conjugation = manifest.artifacts.filter((artifact) => artifact?.key === "planet-conjugation");
  assert.equal(conjugation.length, 1, "setup assets must expose exactly one Conjugation Comet planet");
  assert.equal(conjugation[0].label, "Conjugation Comet", "setup Conjugation Comet label");
  assert.equal(conjugation[0].url, "/assets/planets/conjugation-comet.png", "setup Conjugation Comet URL");
  assert.equal(conjugation[0].asset_path, "assets/planets/conjugation-comet.png", "setup Conjugation Comet asset path");
  const campaign = manifest.artifacts.filter((artifact) => artifact?.key === "planet-campaign");
  assert.equal(campaign.length, 1, "setup assets must expose exactly one Campaign Mode emblem");
  assert.equal(campaign[0].url, "/assets/planets/campaign-mode.png", "setup Campaign Mode URL");
  assert.equal(campaign[0].asset_path, "assets/planets/campaign-mode.png", "setup Campaign Mode asset path");
  const agreementAurora = manifest.artifacts.filter(
    (artifact) => artifact?.key === "planet-agreement-aurora",
  );
  assert.equal(agreementAurora.length, 1, "setup assets must expose exactly one Agreement Aurora planet");
  assert.equal(
    agreementAurora[0].url,
    "/assets/planets/agreement-aurora.png",
    "development setup Agreement Aurora URL",
  );
  assert.equal(
    agreementAurora[0].asset_path,
    "assets/planets/agreement-aurora.png",
    "setup Agreement Aurora local asset path",
  );
  assert.match(
    String(agreementAurora[0].sha256 || ""),
    /^[a-f\d]{64}$/iu,
    "setup Agreement Aurora SHA-256",
  );
  agreementAurora[0].url = `/assets/planets/releases/${agreementAurora[0].sha256.slice(0, 16)}/agreement-aurora.png`;
  assert.ok(Array.isArray(manifest.offline?.assets), "setup assets must declare offline assets");
  const offlineCount = manifest.offline.assets.length;
  manifest.offline.assets = manifest.offline.assets.filter(
    (asset) => !/^\.\/(?:chat\.html|source\/features\/chat\/)/u.test(String(asset)),
  );
  assert.equal(offlineCount - manifest.offline.assets.length, 3, "setup assets must remove the three disabled Chat files");
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function embeddingRuntimeById(catalog, runtimeId) {
  requireObject(catalog, "embedding runtime catalog");
  assert.ok(Array.isArray(catalog.runtimes), "embedding runtime catalog must list runtimes");
  const matches = catalog.runtimes.filter((runtime) => runtime?.id === runtimeId);
  assert.equal(matches.length, 1, `embedding runtime catalog must contain exactly one ${runtimeId} runtime`);
  return matches[0];
}

export function transformBundleSetupAssets(
  input,
  embeddingRuntimeCatalog,
  runtimeId,
  { strictCzech = false } = {},
) {
  const manifest = JSON.parse(strictCzech ? transformSetupAssets(input) : normalizeText(input));
  assert.ok(Array.isArray(manifest.artifacts), "Bundle setup assets must declare an artifact array");
  assert.ok(Array.isArray(manifest.offline?.assets), "Bundle setup assets must declare offline assets");
  const existingRuntimeArtifacts = manifest.artifacts.filter(
    (artifact) => artifact?.artifact_kind === "embedding-runtime",
  );
  if (strictCzech) {
    assert.ok(existingRuntimeArtifacts.length > 0, "Czech setup must retain its authored embedding runtime anchors");
  }

  const runtime = embeddingRuntimeById(embeddingRuntimeCatalog, runtimeId);
  assert.ok(Array.isArray(runtime.artifacts) && runtime.artifacts.length > 0, "Shared embedding runtime must list artifacts");
  const runtimeArtifacts = runtime.artifacts.map((artifact, index) => ({
    key: `shared-embedding-runtime-${index + 1}`,
    label: `Shared embedding runtime: ${artifact.path.split("/").at(-1)}`,
    artifact_kind: "embedding-runtime",
    url: artifact.url,
    asset_path: `language-runtime/${artifact.path}`,
    native_required: true,
    browser_required: true,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
  }));
  manifest.artifacts = [
    ...manifest.artifacts.filter((artifact) => artifact?.artifact_kind !== "embedding-runtime"),
    ...runtimeArtifacts,
  ];

  const sharedTransformersUrl = runtime.runtime?.transformersModuleUrl;
  assert.equal(
    sharedTransformersUrl,
    "/language-runtime/vendor/transformers/transformers.min.js",
    "Shared embedding runtime Transformers.js URL is unsupported",
  );
  manifest.offline.assets = manifest.offline.assets.filter(
    (asset) => asset !== "./vendor/transformers/transformers.min.js",
  );
  if (!manifest.offline.assets.includes(sharedTransformersUrl)) {
    manifest.offline.assets.push(sharedTransformersUrl);
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function transformBundleVectorDb(input, embeddingRuntimeCatalog) {
  let source = normalizeText(input);
  const modelMatch = /const defaultSemanticModelId = "([^"/]+(?:[.-][^"/]+)*)\/runtime";/u.exec(source);
  assert.ok(modelMatch, "Czech vector database must declare one semantic runtime model id");
  const runtime = embeddingRuntimeById(embeddingRuntimeCatalog, modelMatch[1]);
  const contract = requireObject(runtime.runtime, `embedding runtime ${runtime.id} contract`);
  const replacements = [
    [
      'const defaultTransformersModuleUrl = "../../vendor/transformers/transformers.min.js";',
      `const defaultTransformersModuleUrl = ${JSON.stringify(contract.transformersModuleUrl)};`,
      "Czech vector database Transformers.js URL",
    ],
    [
      `const defaultSemanticModelId = "${runtime.id}/runtime";`,
      `const defaultSemanticModelId = ${JSON.stringify(contract.modelId)};`,
      "Czech vector database semantic model id",
    ],
    [
      'const defaultSemanticModelPath = "../../data/embeddings/";',
      `const defaultSemanticModelPath = ${JSON.stringify(contract.localModelPath)};`,
      "Czech vector database semantic model path",
    ],
    [
      'const defaultSemanticModelFileName = "model_qint8_arm64";',
      `const defaultSemanticModelFileName = ${JSON.stringify(contract.modelFileName)};`,
      "Czech vector database semantic model filename",
    ],
    [
      `const defaultOrtWasmModuleUrl = "../../data/embeddings/${runtime.id}/runtime/ort/ort-wasm-simd-threaded.mjs";`,
      `const defaultOrtWasmModuleUrl = ${JSON.stringify(contract.ortWasmModuleUrl)};`,
      "Czech vector database ORT module URL",
    ],
    [
      `const defaultOrtWasmBinaryUrl = "../../data/embeddings/${runtime.id}/runtime/ort/ort-wasm-simd-threaded.wasm";`,
      `const defaultOrtWasmBinaryUrl = ${JSON.stringify(contract.ortWasmBinaryUrl)};`,
      "Czech vector database ORT binary URL",
    ],
  ];
  for (const [before, after, label] of replacements) {
    source = exactReplace(source, before, after, label);
  }
  return source;
}

export function transformWebViewEmbeddingCatalog(input) {
  const catalog = JSON.parse(normalizeText(input));
  assertWebViewEmbeddingCatalog(catalog, { id: catalog.courseId });
  assert.equal(catalog.runtime.modelDelivery, "browser-on-demand", "Browser embedding catalog delivery anchor drifted");
  assert.equal(catalog.runtime.modelPrecached, false, "Browser embedding catalog precache anchor drifted");
  assert.equal(catalog.runtime.androidPackaged, false, "Browser embedding catalog Android marker drifted");
  catalog.runtime = {
    ...catalog.runtime,
    modelDelivery: "android-setup-download",
    modelPrecached: false,
    androidPackaged: false,
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function transformRuntime(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '  const modelCatalogPath = "data/models/phone-bench/models.json";\n',
    "",
    "runtime model catalog"
  );
  source = exactReplace(
    source,
    '  const webllmCdn = "https://esm.run/@mlc-ai/web-llm";\n  const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";\n',
    "",
    "runtime browser language model constants"
  );
  source = exactReplace(
    source,
    '  let browserEngine = null;\n  let browserEngineModelKey = "";\n  let browserModelLoad = null;\n',
    "",
    "runtime browser language model state"
  );
  source = exactReplace(
    source,
    "    return /caatuu-czech|webllm|mlc|tvm|wasm|model/i.test(name);",
    "    return /caatuu-czech/i.test(name);",
    "runtime cache scope"
  );
  source = exactReplace(
    source,
    "  async function clearBrowserCache() {\n    await unloadBrowserModel();",
    "  async function clearBrowserCache() {",
    "runtime cache model unload"
  );
  source = exactReplace(
    source,
    '          generationSource: clampReportText(payload.feedback.generationSource || "", 80),\n',
    "",
    "runtime feedback generation source"
  );
  source = exactReplace(
    source,
    '          sentenceModelKey: clampReportText(payload.feedback.sentenceModelKey || "", 120),\n          translationModelKey: clampReportText(payload.feedback.translationModelKey || "", 120),\n',
    "",
    "runtime feedback language model keys"
  );
  source = replaceTopLevelFunction(source, "sendDictionaryGapReport", `
  async function sendDictionaryGapReport() {
    throw new Error("Remote dictionary-gap reporting is disabled for the Caatuu product.");
  }`, { indent: "  " });
  source = exactReplace(
    source,
    "            online: () => navigator.onLine !== false,",
    "            online: () => false,",
    "dictionary-gap outbox network gate"
  );
  source = exactReplace(
    source,
    "    scheduleDictionaryGapFlush(0);\n    return { ...result, pending: outbox.list().length, automaticDelivery: true };",
    "    return { ...result, pending: outbox.list().length, automaticDelivery: false, localOnly: true };",
    "dictionary-gap enqueue policy"
  );
  source = replaceTopLevelFunction(source, "flushQueuedDictionaryGaps", `
  async function flushQueuedDictionaryGaps() {
    const outbox = await getDictionaryGapOutbox();
    outbox.refreshFromStorage();
    return {
      sent: [],
      failed: [],
      pending: outbox.list().length,
      disabled: true,
      automaticDelivery: false,
      localOnly: true
    };
  }`, { indent: "  " });
  for (const name of ["clearDictionaryGapFlushTimer", "scheduleDictionaryGapFlush"]) {
    source = removeTopLevelFunction(source, name, { indent: "  " });
  }
  source = replaceBetween(
    source,
    "  async function loadModelCatalog() {",
    "  async function searchBrowserVectorDatabase(text, options = {}) {",
    `  async function loadEmbeddingCatalog() {
    return fetchJson(embeddingCatalogPath);
  }

`,
    "runtime language model implementation"
  );
  source = replaceBetween(
    source,
    "    models: {",
    "    speech: {",
    "",
    "runtime public language model API"
  );
  source = exactReplace(
    source,
    "    clearNativeBrowserState,\n    nativeCall,\n    fetchJson,",
    "    clearNativeBrowserState,\n    fetchJson,",
    "runtime public native call escape hatch"
  );
  source = exactReplace(
    source,
    "    vector: {\n      status() {",
    "    vector: {\n      catalog: loadEmbeddingCatalog,\n      status() {",
    "runtime embedding catalog API"
  );
  source = exactReplace(
    source,
    '? nativeCall("delete_model", {}, handlers)',
    '? nativeCall("delete_local_pack", {}, handlers)',
    "runtime local pack deletion"
  );
  source = exactReplace(
    source,
    `  window.addEventListener("online", () => scheduleDictionaryGapFlush(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleDictionaryGapFlush(0);
  });
  scheduleDictionaryGapFlush(1_000);
`,
    "",
    "dictionary-gap automatic delivery triggers"
  );
  return source;
}

export function transformChromeJs(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '      { href: routes.chat, label: "debug-chat", available: capabilities.chat === true },\n',
    "",
    "chrome disabled Chat route",
  );
  source = exactReplace(source, "<small>AI, developer, storage</small>", "<small>Storage and app controls</small>", "chrome advanced summary");
  source = replaceBetween(
    source,
    '          <section class="settings-card side-card ai-settings-card" aria-label="Chat settings">',
    '          <section class="settings-card side-card maintenance-card" aria-label="App settings">',
    "",
    "chrome language model and developer settings"
  );
  source = replaceBetween(
    source,
    '            <div class="legal-notice" role="note">',
    '            <details class="settings-details model-details legal-details">',
    "",
    "chrome AI notice"
  );
  source = exactReplace(
    source,
    "Third-party or separately licensed models, dictionaries, datasets, artwork, branding, and components keep their separate terms.",
    "Third-party or separately licensed dictionaries, datasets, artwork, branding, and components keep their separate terms.",
    "chrome legal scope"
  );
  source = replaceBetween(
    source,
    '                <dl class="meta-list model-license-list" id="modelLicenseList">',
    "                </dl>",
    `                <dl class="meta-list model-license-list" id="embeddingLicenseList">
                  <div>
                    <dt>Caatuu Curriculum and Asset Embeddings</dt>
                    <dd>all-MiniLM-L6-v2 embedding base, Apache-2.0. Curriculum and asset provenance review pending; embeds English text only.</dd>
                  </div>
`,
    "chrome artifact licenses"
  );
  return source;
}

export function transformChromeCss(input) {
  return stripFlatCssRules(
    normalizeText(input),
    [/\.ai-settings-card/i, /\.preset-control/i, /\.capability-note/i],
    "chrome language model controls"
  );
}

export function transformSetupJs(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    "    return item.key || item.modelKey || item.artifactKey || item.assetPath || item.url || item.label || \"artifact\";",
    "    return item.key || item.artifactKey || item.assetPath || item.url || item.label || \"artifact\";",
    "setup artifact key"
  );
  source = replaceBetween(
    source,
    '    if (kind === "gguf-model") {',
    '    if (kind === "embedding-vector-db" || searchable.includes("embedding")) {',
    "",
    "setup language model display group"
  );
  source = replaceBetween(
    source,
    "    const models = Array.isArray(status?.models) ? status.models : [];",
    "    if (status?.vectorDatabase) {",
    "    const rows = [];\n",
    "setup language model status rows"
  );
  source = exactReplace(
    source,
    "        key: status.vectorDatabase.modelKey || status.vectorDatabase.key || \"embeddings\",",
    "        key: status.vectorDatabase.key || \"embeddings\",",
    "setup embedding key"
  );
  return source;
}

export function transformHomeCss(input) {
  return stripFlatCssRules(normalizeText(input), [/gguf-model/i], "home model artifact styling");
}

export function transformWordNetStandard(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '  const contentMode = entry.contentMode === "standard" ? "standard" : "generative";',
    '  if (entry.contentMode !== "standard") return null;\n  const contentMode = "standard";',
    "Word World history mode"
  );
  source = exactReplace(
    source,
    '    source: String(entry.source || (contentMode === "standard" ? "standard-corpus" : "history")).trim().slice(0, 64),',
    '    source: String(entry.source || "standard-corpus").trim().slice(0, 64),',
    "Word World history source"
  );
  return source;
}

const TRANSFORMS = Object.freeze({
  "index.html": transformIndex,
  "manifest.webmanifest": transformManifest,
  "setup-assets.json": transformSetupAssets,
  "source/features/setup/setup.js": transformSetupJs,
  "source/games/word-world/word-net-standard.mjs": transformWordNetStandard,
  "source/shared/course-profile.js": transformCourseProfile,
  "source/shared/runtime.js": transformRuntime
});

const SHARED_APP_TRANSFORMS = Object.freeze({
  "language-runtime/static/source/caatuu-chrome.js": transformChromeJs,
  "language-runtime/static/styles/caatuu-chrome.css": transformChromeCss,
  "language-runtime/static/styles/caatuu-home.css": transformHomeCss,
});

function assertSafeOutputDirectory(outputDir, workspaceRoot, languageStaticDir, launcherStaticDir) {
  const output = resolve(outputDir);
  assert.ok(output.toLowerCase().includes("product"), "Output path must contain 'product'");
  for (const protectedPath of [workspaceRoot, languageStaticDir, launcherStaticDir]) {
    assert.notEqual(output.toLowerCase(), resolve(protectedPath).toLowerCase(), `Refusing to replace protected path: ${output}`);
  }
  assert.ok(dirname(output) !== output, `Refusing to replace filesystem root: ${output}`);
  const workspaceRelative = relative(resolve(workspaceRoot), output);
  const insideWorkspace = workspaceRelative !== ""
    && !workspaceRelative.startsWith(`..${sep}`)
    && workspaceRelative !== ".."
    && !isAbsolute(workspaceRelative);
  if (insideWorkspace) {
    const allowedRoot = resolve(workspaceRoot, "apps/android/product/build");
    const allowedRelative = relative(allowedRoot, output);
    assert.ok(
      allowedRelative !== ""
        && !allowedRelative.startsWith(`..${sep}`)
        && allowedRelative !== ".."
        && !isAbsolute(allowedRelative),
      `In-workspace store output must be inside ${allowedRoot}`
    );
  }
}

function allFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) result.push(slashPath(relative(root, fullPath)));
      else throw new Error(`Store asset output may not contain links or special files: ${fullPath}`);
    }
  };
  visit(root);
  return result.sort();
}

function checkJavaScriptSyntax(path, source) {
  const moduleSyntax = /(^|\n)\s*(?:import\s+(?!\()|export\s+)|\bimport\.meta\b/m.test(source);
  const result = spawnSync(
    process.execPath,
    ["--input-type", moduleSyntax ? "module" : "commonjs", "--check"],
    { input: source, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  assert.equal(result.status, 0, `${path}: node --check failed\n${result.stderr || result.stdout}`);
}

function staticModuleReferences(source) {
  const references = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.add(match[1]);
  }
  return [...references].filter((value) => value.startsWith(".") || value.startsWith("/"));
}

function packagedReferencePath(reference, containingAsset, routePrefix) {
  if (!reference || reference.startsWith("#") || reference.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(reference)) {
    return null;
  }
  const webPath = containingAsset.startsWith("language-runtime/")
    ? `/${containingAsset}`
    : `${routePrefix}/${containingAsset}`.replace(/\/{2,}/g, "/");
  const pathname = decodeURIComponent(new URL(reference, `https://caatuu.test${webPath}`).pathname);
  if (pathname.startsWith("/language-runtime/")) return pathname.slice(1);
  if (pathname.startsWith("/assets/")) return pathname.slice(1);
  const coursePrefix = `${routePrefix}/`;
  if (pathname.startsWith(coursePrefix)) return pathname.slice(coursePrefix.length);
  return null;
}

function assertImportReferences(outputDir, files, routePrefix) {
  for (const path of files.filter((item) => [".js", ".mjs"].includes(extension(item)))) {
    if (path.startsWith("vendor/")) continue;
    const source = readSourceText(join(outputDir, path));
    checkJavaScriptSyntax(path, source);
    for (const reference of staticModuleReferences(source)) {
      const cleanReference = reference.split(/[?#]/, 1)[0];
      const assetPath = packagedReferencePath(cleanReference, path, routePrefix);
      if (!assetPath) continue;
      const target = resolve(outputDir, assetPath);
      assert.ok(isInside(outputDir, target), `${path}: module import escapes packaged assets: ${reference}`);
      assert.ok(existsSync(target) && statSync(target).isFile(), `${path}: missing module import ${reference}`);
    }
  }
}

function assertHtmlReferences(outputDir, files, routePrefix) {
  const pattern = /[\s<](?:src|href)\s*=\s*["']([^"']+)["']/g;
  for (const path of files.filter((item) => extension(item) === ".html")) {
    const source = readSourceText(join(outputDir, path));
    for (const match of source.matchAll(pattern)) {
      const reference = match[1];
      const cleanReference = reference.split(/[?#]/, 1)[0];
      if (!cleanReference) continue;
      const assetPath = packagedReferencePath(cleanReference, path, routePrefix);
      if (!assetPath) continue;
      const target = resolve(outputDir, assetPath);
      assert.ok(isInside(outputDir, target), `${path}: HTML reference escapes packaged assets: ${reference}`);
      assert.ok(existsSync(target) && statSync(target).isFile(), `${path}: missing HTML reference ${reference}`);
    }
  }
}

function assertNoForbiddenPaths(files) {
  const forbidden = [
    /(^|\/)chat(?:\.|\/)/i,
    /(^|\/)data\/models(?:\/|$)/i,
    /(^|\/)games\/(?:godot|runtime|exports?)(?:\/|$)/i,
    /godot/i,
    /data\/embeddings\/.*\/(?:runtime\/|.*\.(?:sqlite|db|onnx|bin|safetensors|wasm)$)/i
  ];
  for (const path of files) {
    for (const pattern of forbidden) assert.doesNotMatch(path, pattern, `Forbidden store asset path: ${path}`);
  }
}

const CAPABILITY_GATED_SHARED_APP_FILES = new Set([
  "language-runtime/static/source/caatuu-workspace.js",
  "language-runtime/static/source/product-word-world.mjs",
  "language-runtime/static/source/word-net-core.mjs",
  "language-runtime/static/source/word-net-queue.mjs",
]);

function assertFirstPartySurface(outputDir, files) {
  const executableUi = files.filter((path) =>
    !path.startsWith("vendor/")
      && !path.startsWith("language-runtime/vendor/")
      && !path.startsWith("language-runtime/models/")
      && !CAPABILITY_GATED_SHARED_APP_FILES.has(path)
      && [".css", ".html", ".js", ".mjs", ".webmanifest"].includes(extension(path))
  );
  const forbidden = /webllm|web-llm|gguf|qwen|cstinyllama|data\/models|chat\.html|source\/features\/chat|report_dictionary_gap|\/cz\/api\/dictionary\/gaps|godot/i;
  for (const path of executableUi) {
    assert.doesNotMatch(readSourceText(join(outputDir, path)), forbidden, `Forbidden store surface survived in ${path}`);
  }
}

function assertCapabilityGatedSharedApp(outputDir, courseConfiguration, profile) {
  assert.equal(profile.capabilities.llm, false, "Android product must disable the LLM capability");
  assert.equal(profile.capabilities.generation, false, "Android product must disable generation");
  assert.equal(profile.capabilities.chat, false, "Android product must disable chat");
  for (const path of CAPABILITY_GATED_SHARED_APP_FILES) {
    const asset = courseConfiguration.appAssets.find(({ output }) => output === path);
    assert.ok(asset, `Android product must source the canonical capability-gated shared asset ${path}`);
    assert.equal(SHARED_APP_TRANSFORMS[path], undefined, `${path} must not have an Android-specific transform`);
    assert.deepEqual(
      readFileSync(join(outputDir, path)),
      readFileSync(asset.source),
      `Android product must retain the canonical shared app asset byte-for-byte: ${path}`,
    );
  }
}

function assertVectorConfinement(outputDir) {
  const vector = readSourceText(join(outputDir, "source/shared/vector-db.js"));
  assert.match(vector, /env\.allowRemoteModels = false;/);
  assert.match(vector, /env\.allowLocalModels = true;/);
  assert.match(vector, /pipeline\("feature-extraction",\s*[^,]+,\s*\{/);
  assert.match(vector, /local_files_only: true/);
  assert.doesNotMatch(vector, /allowRemoteModels = true/);
}

function assertRuntimeBoundary(outputDir) {
  const runtime = readSourceText(join(outputDir, "source/shared/runtime.js"));
  assert.doesNotMatch(runtime, /modelCatalogPath|browserEngine|browserModelLoad|\.models\s*=|\bmodels:\s*\{|nativeCall\("(?:prompt|load|status|start_download|cancel_download|reset_conversation|delete_model|report_dictionary_gap)"/);
  assert.doesNotMatch(runtime, /^\s+nativeCall,\s*$/m);
  assert.doesNotMatch(runtime, /\/cz\/api\/dictionary\/gaps/);
  assert.match(runtime, /catalog: loadEmbeddingCatalog/);
  assert.match(runtime, /nativeCall\("delete_local_pack"/);
  assert.match(runtime, /online: \(\) => false/);
  assert.match(runtime, /automaticDelivery: false, localOnly: true/);
  assert.doesNotMatch(runtime, /scheduleDictionaryGapFlush\(/);
}

function nativeProvider(profile, name) {
  const provider = profile.nativeProviders?.providers?.[name];
  assert.ok(provider && typeof provider === "object" && !Array.isArray(provider), `Missing Android native provider ${name}`);
  return provider;
}

function providerReferenceAsset(catalogAsset, reference, label) {
  const normalizedReference = normalizedCatalogPath(reference, label);
  const catalogDirectory = catalogAsset.includes("/")
    ? catalogAsset.slice(0, catalogAsset.lastIndexOf("/"))
    : "";
  return normalizedCatalogPath(
    catalogDirectory && !normalizedReference.startsWith(`${catalogDirectory}/`)
      ? `${catalogDirectory}/${normalizedReference}`
      : normalizedReference,
    label,
  );
}

function assertEmbeddingProviderBoundary(outputDir, profile) {
  const provider = nativeProvider(profile, "embeddings");
  assert.equal(provider.implementation, "vector-database-catalog-v1", "Embedding provider implementation is unsupported");
  const catalogPath = join(outputDir, provider.catalogAsset);
  assert.ok(existsSync(catalogPath), "embedding provider catalog must be packaged");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  assert.match(String(catalog.base_url || ""), /^https:\/\//i, "embedding provider catalog must declare an HTTPS base_url");
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  const active = models.find((model) => model.key === catalog.default_model && model.status === "active");
  assert.ok(active, "embedding provider catalog must select an active default model");
  assert.equal(
    active.input_language ?? active.embedding_input_language ?? "en",
    "en",
    "Android embeddings must consume English input",
  );
  assert.match(String(active.sha256 || ""), /^[a-f\d]{64}$/i, "embedding provider model must be hash-pinned");
  assert.ok(Number(active.bytes) > 0, "embedding provider model must declare positive bytes");
  normalizedCatalogPath(active.model_file, "embedding provider model_file");
  const manifestAsset = providerReferenceAsset(
    provider.catalogAsset,
    active.manifest_file,
    "embedding provider manifest_file",
  );
  assert.ok(profile.assets.includes(manifestAsset), `embedding provider manifest must be packaged as ${manifestAsset}`);
  const manifest = JSON.parse(readFileSync(join(outputDir, manifestAsset), "utf8"));
  assert.equal(manifest.model_id, active.key, "embedding provider manifest model_id must match the catalog");
  assert.equal(Number(manifest.bytes), Number(active.bytes), "embedding provider manifest bytes must match the catalog");
  assert.equal(manifest.sha256, active.sha256, "embedding provider manifest SHA-256 must match the catalog");
  assert.equal(manifest.embedding_dimension, 384, "vector-database-catalog-v1 requires 384-dimensional embeddings");
  assert.equal(manifest.embedding_text_field, "english_text", "Android embedding manifests must identify english_text");
  assert.equal(manifest.embedding_input_policy, "english_text_only", "Android embedding manifests must enforce english_text_only");
  assert.equal(typeof manifest.schema_name, "string", "embedding provider manifest schema_name is required");
  assert.ok(manifest.schema_name, "embedding provider manifest schema_name is required");
  assert.ok(Number.isInteger(manifest.schema_version) && manifest.schema_version > 0, "embedding provider manifest schema_version is invalid");
}

function assertDictionaryProviderBoundary(outputDir, profile) {
  const provider = nativeProvider(profile, "dictionary");
  assert.equal(provider.implementation, "sqlite-dictionary-catalog-v1", "Dictionary provider implementation is unsupported");
  const catalogPath = join(outputDir, provider.catalogAsset);
  assert.ok(existsSync(catalogPath), "dictionary provider catalog must be packaged");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const defaultKey = catalog.default_dictionary ?? catalog.default_dictionary_key;
  const dictionaries = Array.isArray(catalog.dictionaries) ? catalog.dictionaries : [];
  const active = dictionaries.find((dictionary) => dictionary.key === defaultKey && dictionary.status === "active");
  assert.ok(active, "dictionary provider catalog must select an active default dictionary");
  assert.equal(active.artifact_kind, "dictionary-database", "dictionary provider artifact kind is unsupported");
  assert.equal(typeof active.label, "string", "dictionary provider label is required");
  assert.ok(active.label, "dictionary provider label is required");
  assert.equal(typeof active.direction, "string", "dictionary provider direction is required");
  assert.ok(active.direction, "dictionary provider direction is required");
  assert.ok(Number(active.bytes ?? active.expected_bytes) > 0, "dictionary provider must declare positive bytes");
  assert.match(String(active.sha256 || ""), /^[a-f\d]{64}$/i, "dictionary provider must be hash-pinned");
  assert.match(String(active.download_url || ""), /^https:\/\//i, "dictionary provider must use an HTTPS download URL");
  normalizedCatalogPath(active.database_file, "dictionary provider database_file");
}

function assertSetupBoundary(
  outputDir,
  languageStaticDir,
  profile,
  { strictCzech = false, expectedTransform = transformSetupAssets } = {},
) {
  const outputPath = join(outputDir, "setup-assets.json");
  assert.ok(existsSync(outputPath), "store output must retain the setup manifest");
  if (strictCzech) {
    const developmentSource = readSourceText(join(languageStaticDir, "setup-assets.json"));
    assert.equal(
      readSourceText(outputPath),
      normalizeText(expectedTransform(developmentSource)),
      "setup manifest must equal the reviewed store transform"
    );
  }
  const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  assert.ok(artifacts.length > 0, "setup manifest must retain artifacts");
  if (profile.capabilities.embeddings) {
    assert.ok(
      artifacts.some((artifact) => String(artifact.artifact_kind || artifact.kind || "").includes("embedding") || String(artifact.key || "").includes("embedding")),
      "setup must retain embedding artifacts"
    );
  }
  if (profile.capabilities.dictionary) {
    const dictionaryCatalogPath = join(outputDir, nativeProvider(profile, "dictionary").catalogAsset);
    assert.ok(existsSync(dictionaryCatalogPath), "dictionary-enabled output must retain the dictionary catalog");
    const dictionaryCatalog = JSON.parse(readFileSync(dictionaryCatalogPath, "utf8"));
    const dictionaries = Array.isArray(dictionaryCatalog.dictionaries) ? dictionaryCatalog.dictionaries : [];
    const activeDictionary = dictionaries.find((dictionary) => dictionary.status === "active" && (
      dictionary.default === true || dictionary.key === dictionaryCatalog.default_dictionary_key
    )) || dictionaries.find((dictionary) => dictionary.status === "active");
    assert.ok(activeDictionary, "dictionary catalog must retain an active dictionary");
    assert.ok(Number(activeDictionary.bytes || activeDictionary.expected_bytes) > 0, "active dictionary must declare bytes");
    assert.match(String(activeDictionary.sha256 || ""), /^[a-f\d]{64}$/i, "active dictionary must be hash-pinned");
    assert.ok(String(activeDictionary.download_url || activeDictionary.url || "").trim(), "active dictionary must declare a download URL");
  }
  for (const artifact of artifacts) {
    const surface = `${artifact.artifact_kind || artifact.kind || ""} ${artifact.url || ""} ${artifact.key || ""}`;
    assert.doesNotMatch(surface, /gguf|data\/models|godot/i);
  }
  const setupPath = join(outputDir, "source/features/setup/setup.js");
  if (existsSync(setupPath)) {
    const setup = readSourceText(setupPath);
    assert.doesNotMatch(setup, /gguf|status\?\.models|modelKey/i);
    if (profile.capabilities.embeddings) assert.match(setup, /status\?\.vectorDatabase/);
  }
}

const REQUIRED_SHARED_APP_FILES = Object.freeze([
  "index.html",
  "language-runtime/static/source/app-bootstrap.mjs",
  "language-runtime/static/source/browser-shell.mjs",
  "language-runtime/static/source/caatuu-chrome.js",
  "language-runtime/static/source/caatuu-workspace.js",
  "language-runtime/static/source/learning-profile.js",
  "language-runtime/static/source/product-word-world.mjs",
  "language-runtime/static/source/word-net-core.mjs",
  "language-runtime/static/source/word-net-queue.mjs",
  "language-runtime/static/source/word-world-host.mjs",
  "language-runtime/static/source/word-world-provider.mjs",
  "language-runtime/static/styles/caatuu-chrome.css",
  "language-runtime/static/styles/caatuu-home.css",
  "language-runtime/static/styles/caatuu-theme.css",
  "language-runtime/static/styles/caatuu-word-world.css",
  "language-runtime/static/styles/caatuu-workspace.css",
]);

const LEGACY_WORD_WORLD_FILES = Object.freeze([
  "word-net.html",
  "source/games/word-world/word-net.css",
  "source/games/word-world/word-net-core.mjs",
  "source/games/word-world/word-net.js",
  "source/games/word-world/word-net-queue.mjs",
  "language-runtime/static/source/product-shell.mjs",
]);

const RETIRED_PARALLEL_UI_FILES = Object.freeze([
  "source/features/home/home.css",
  "source/games/verb-nebula/app.css",
  "source/games/verb-nebula/app.js",
  "source/shared/chrome.css",
  "source/shared/chrome.js",
  "source/shared/learning-profile.js",
  "source/shared/theme.css",
  "language-runtime/static/styles/course-shell.css",
]);

function assertSharedAppBoundary(files) {
  for (const path of REQUIRED_SHARED_APP_FILES) {
    assert.ok(files.includes(path), `Android product must package the canonical shared app asset ${path}`);
  }
  for (const path of LEGACY_WORD_WORLD_FILES) {
    assert.ok(!files.includes(path), `Android product must not package legacy Word World asset ${path}`);
  }
  for (const path of RETIRED_PARALLEL_UI_FILES) {
    assert.ok(!files.includes(path), `Android product must not package retired parallel UI asset ${path}`);
  }
}

function assertWordWorldBoundary(outputDir, files, {
  sharedOutputDir = outputDir,
  sharedFiles = files,
} = {}) {
  const providerModuleUrl = "source/games/word-world/word-net-standard.mjs?v=word-net-standard-5";
  const meaningAdapterUrl = "/language-runtime/static/source/word-net-core.mjs?v=word-net-core-21";
  const providerModule = providerModuleUrl.split("?", 1)[0];
  const meaningAdapter = meaningAdapterUrl.slice(1).split("?", 1)[0];
  assert.ok(files.includes(providerModule), `Czech Word World must package its course provider ${providerModule}`);
  assert.ok(sharedFiles.includes(meaningAdapter), `Czech Word World must package the shared meaning adapter ${meaningAdapter}`);
  assert.ok(existsSync(join(sharedOutputDir, meaningAdapter)), `Czech Word World shared meaning adapter is missing: ${meaningAdapter}`);

  const manifest = JSON.parse(readFileSync(join(outputDir, "data/games/word-world/manifest.json"), "utf8"));
  assert.equal(manifest.sessionProvider?.module, providerModuleUrl, "Czech Word World manifest must declare its versioned course provider URL");
  assert.equal(manifest.sessionProvider?.meaningSelectorModule, meaningAdapterUrl, "Czech Word World manifest must declare the shared meaning adapter");

  const surface = readSourceText(join(outputDir, providerModule));
  assert.doesNotMatch(surface, /generative|WordNetBranchQueue|runtimeAdapter\(\)\.models|WORD_NET_MODEL_KEY|TRANSLATION_MODEL_KEY|requestSentenceCandidate|requestEnglishTranslation|loadTranslationCache|syncContentControl/i);
  assert.match(readSourceText(join(outputDir, providerModule)), /entry\.contentMode !== "standard"\) return null/);
}

function assertLearnerContentSafety(outputDir) {
  const sources = [
    ["agreement-aurora", "data/games/agreement-aurora/challenges.json"],
    ["case-cosmos", "data/games/case-cosmos/challenges.json"],
    ["conjugation-comet", "data/games/conjugation-comet/verbs.json"],
    ["verb-nebula", "data/games/verb-nebula/core-vocabulary.json"],
    ["word-world", "data/games/word-world/standard-v0.1/records.json"],
    ["language-scripts", "data/language/scripts.json"]
  ];
  const fields = sources.filter(([, assetPath]) => existsSync(join(outputDir, assetPath))).flatMap(([sourceId, assetPath]) => {
    const parsed = JSON.parse(readFileSync(join(outputDir, assetPath), "utf8"));
    return extractLearnerContent(sourceId, parsed, assetPath).fields;
  });
  const findings = inspectLearnerFields(fields);
  assert.equal(
    findings.length,
    0,
    `Product learner content has unresolved deterministic safety findings:\n${findings
      .map((finding) => `${finding.severity} ${finding.ruleId} ${finding.file}${finding.field}: ${finding.text}`)
      .join("\n")}`
  );
}

function assertServiceWorkerBoundary(outputDir) {
  const source = readSourceText(join(outputDir, "sw.js"));
  assert.doesNotMatch(source, /isModelRuntimeRequest|huggingface|esm\.run|github\.com|chat/i);
  const loader = /^"use strict";\s+\/\/ Offline catalog revision: ([^\r\n]+)\s+importScripts\("\/language-runtime\/static\/source\/course-service-worker\.js"\);\s*$/u.exec(source);
  assert.ok(
    loader,
    "course service worker must be the canonical shared-worker loader",
  );
  const setupPath = join(outputDir, "setup-assets.json");
  if (existsSync(setupPath)) {
    const setup = JSON.parse(readSourceText(setupPath));
    assert.equal(
      loader[1].trim(),
      setup?.offline?.cacheName,
      "course worker revision must match the packaged offline catalog",
    );
  }
  const workerEngine = join(outputDir, "language-runtime/static/source/course-service-worker.js");
  assert.ok(existsSync(workerEngine) && statSync(workerEngine).isFile(), "shared course service-worker engine must be packaged");
  assert.match(readSourceText(workerEngine), /Retired runtime assets cannot be cached/);
}

function courseAssetTransform(configuration, path, embeddingRuntime) {
  const embeddingProvider = configuration.nativeProviders.providers.embeddings;
  if (
    embeddingProvider?.implementation === "webview-english-minilm-v1"
    && path === embeddingProvider.catalogAsset
  ) {
    return transformWebViewEmbeddingCatalog;
  }
  if (embeddingProvider && path === "setup-assets.json") {
    assert.ok(embeddingRuntime?.catalog, "Embedding setup requires the shared runtime catalog");
    const providerCatalog = readJson(
      join(configuration.languageStaticDir, embeddingProvider.catalogAsset),
      `Course ${configuration.course.id} embedding catalog`,
    );
    const runtimeId = embeddingProvider.implementation === "webview-english-minilm-v1"
      ? providerCatalog.runtime?.defaultModelId
      : providerCatalog.default_model;
    assert.equal(typeof runtimeId, "string", `Course ${configuration.course.id} embedding runtime ID is missing`);
    return (input) => transformBundleSetupAssets(
      input,
      embeddingRuntime.catalog,
      runtimeId,
      { strictCzech: configuration.course.id === "cz" },
    );
  }
  if (configuration.course.id !== "cz") return undefined;
  if (path === "source/shared/vector-db.js") {
    assert.ok(embeddingRuntime?.catalog, "Czech bundle vector database requires the shared embedding runtime catalog");
    return (input) => transformBundleVectorDb(input, embeddingRuntime.catalog);
  }
  return TRANSFORMS[path];
}

function assertSetupDownloadsSharedEmbeddingRuntime(manifest, embeddingRuntime, courseId) {
  const artifacts = (manifest.artifacts || []).filter(
    (artifact) => artifact?.artifact_kind === "embedding-runtime",
  );
  assert.equal(
    artifacts.length,
    embeddingRuntime.assets.length,
    `Course ${courseId} setup must download every shared embedding runtime artifact`,
  );
  const byPath = new Map(artifacts.map((artifact) => [artifact.asset_path, artifact]));
  for (const asset of embeddingRuntime.assets) {
    const assetPath = asset.output;
    const catalogArtifact = embeddingRuntime.catalog.runtimes
      .flatMap((runtime) => runtime.artifacts)
      .find((artifact) => `language-runtime/${artifact.path}` === assetPath);
    const setupArtifact = byPath.get(assetPath);
    assert.ok(setupArtifact, `Course ${courseId} setup is missing ${assetPath}`);
    assert.equal(setupArtifact.url, catalogArtifact.url, `Course ${courseId} setup URL drifted for ${assetPath}`);
    assert.equal(setupArtifact.bytes, catalogArtifact.bytes, `Course ${courseId} setup bytes drifted for ${assetPath}`);
    assert.equal(setupArtifact.sha256, catalogArtifact.sha256, `Course ${courseId} setup hash drifted for ${assetPath}`);
    assert.equal(setupArtifact.native_required, true, `Course ${courseId} setup must require ${assetPath}`);
  }
}

function bundleReferenceAssetPath(reference, containingAsset, courseRecord) {
  if (!reference || reference.startsWith("#") || reference.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(reference)) {
    return null;
  }
  let webPath;
  if (containingAsset === "index.html") {
    webPath = courseRecord.entryPath;
  } else if (containingAsset.startsWith(`${courseRecord.assetPrefix}/`)) {
    const relativeAsset = containingAsset.slice(courseRecord.assetPrefix.length + 1);
    webPath = `${courseRecord.routePrefix}/${relativeAsset}`;
  } else {
    webPath = `/${containingAsset}`;
  }
  const pathname = decodeURIComponent(new URL(reference, `https://caatuu.test${webPath}`).pathname);
  if (pathname.startsWith("/language-runtime/") || pathname.startsWith("/assets/")) {
    return pathname.slice(1);
  }
  for (const record of courseRecord.bundleCourses) {
    if (pathname === record.entryPath) return "index.html";
    const coursePrefix = `${record.routePrefix}/`;
    if (pathname.startsWith(coursePrefix)) {
      return `${record.assetPrefix}/${pathname.slice(coursePrefix.length)}`;
    }
  }
  return null;
}

function assertBundleReferences(outputDir, files, courseCatalog) {
  const records = courseCatalog.courses.map((record) => Object.freeze({
    ...record,
    bundleCourses: courseCatalog.courses,
  }));
  const recordByPrefix = new Map(records.map((record) => [record.assetPrefix, record]));
  const executable = files.filter((path) => [".js", ".mjs"].includes(extension(path)));
  for (const path of executable) {
    if (path.startsWith("language-runtime/vendor/") || path.startsWith("language-runtime/models/")) continue;
    const coursePrefix = records.find(({ assetPrefix }) => path.startsWith(`${assetPrefix}/`))?.assetPrefix;
    const record = coursePrefix ? recordByPrefix.get(coursePrefix) : records[0];
    const source = readSourceText(join(outputDir, path));
    checkJavaScriptSyntax(path, source);
    for (const reference of staticModuleReferences(source)) {
      const assetPath = bundleReferenceAssetPath(reference.split(/[?#]/, 1)[0], path, record);
      if (!assetPath) continue;
      const target = resolve(outputDir, assetPath);
      assert.ok(isInside(outputDir, target), `${path}: module import escapes packaged assets: ${reference}`);
      assert.ok(existsSync(target) && statSync(target).isFile(), `${path}: missing module import ${reference}`);
    }
  }

  const htmlFiles = files.filter((path) => extension(path) === ".html");
  const htmlReferencePattern = /[\s<](?:src|href)\s*=\s*["']([^"']+)["']/g;
  for (const path of htmlFiles) {
    const matchingRecord = records.find(({ assetPrefix }) => path.startsWith(`${assetPrefix}/`));
    const recordsToCheck = path === "index.html" ? records : [matchingRecord || records[0]];
    const source = readSourceText(join(outputDir, path));
    for (const record of recordsToCheck) {
      for (const match of source.matchAll(htmlReferencePattern)) {
        const reference = match[1];
        const cleanReference = reference.split(/[?#]/, 1)[0];
        if (!cleanReference) continue;
        const assetPath = bundleReferenceAssetPath(cleanReference, path, record);
        if (!assetPath) continue;
        const target = resolve(outputDir, assetPath);
        assert.ok(isInside(outputDir, target), `${path}: HTML reference escapes packaged assets: ${reference}`);
        assert.ok(existsSync(target) && statSync(target).isFile(), `${path}: missing HTML reference ${reference}`);
      }
    }
  }
}

export function validateProductAssetBundle({
  outputDir,
  workspaceRoot = defaultWorkspaceRoot,
  courseBundlePath = DEFAULT_COURSE_BUNDLE_PATH,
  launcherStaticDir = join(workspaceRoot, "apps/launcher/static"),
  allowMissingSetupDeliveredRuntimeFiles = false,
  configuration,
}) {
  const bundle = configuration || loadAndroidCourseBundleConfiguration({
    workspaceRoot,
    courseBundlePath,
    launcherStaticDir,
    allowMissingSetupDeliveredRuntimeFiles,
  });
  const resolvedOutput = resolve(outputDir);
  assert.ok(existsSync(resolvedOutput), `Product bundle output does not exist: ${resolvedOutput}`);
  const files = allFiles(resolvedOutput);
  assert.deepEqual(files, [...bundle.outputFiles].sort(), "Product output must equal the Android course bundle allowlist");
  assert.deepEqual(
    readFileSync(join(resolvedOutput, "index.html"), "utf8"),
    transformIndex(readSourceText(bundle.defaultCourse.appEntryPath)),
    "Product bundle must package one reviewed transform of the canonical shared app entry",
  );
  assert.deepEqual(
    files.filter((path) => /(?:^|\/)index\.html$/i.test(path)),
    ["index.html"],
    "Product bundle must contain exactly one shared index.html",
  );
  const runtimeCatalog = JSON.parse(readFileSync(join(resolvedOutput, PRODUCT_COURSE_BUNDLE_ASSET), "utf8"));
  assert.deepEqual(runtimeCatalog, bundle.courseCatalog, "Packaged course bundle catalog must match the reviewed declaration");
  assert.equal(runtimeCatalog.courses.length, bundle.configurations.length, "Every allowlisted course must be in the runtime catalog");
  const profile = JSON.parse(readFileSync(join(resolvedOutput, "caatuu-profile.json"), "utf8"));
  assert.deepEqual(profile, bundle.productProfile, "Default product profile must match the complete course bundle");

  for (const { source, output } of bundle.sharedAssets) {
    const transform = SHARED_APP_TRANSFORMS[output];
    const expected = transform ? transform(readSourceText(source)) : readFileSync(source);
    const actual = transform ? readFileSync(join(resolvedOutput, output), "utf8") : readFileSync(join(resolvedOutput, output));
    assert.deepEqual(actual, expected, `Shared product asset drifted: ${output}`);
  }
  for (const courseConfiguration of bundle.configurations) {
    const courseRoot = join(resolvedOutput, `courses/${courseConfiguration.course.id}`);
    const courseFiles = bundle.courseFilesById[courseConfiguration.course.id];
    assert.ok(courseFiles, `Missing bundle file allowlist for course ${courseConfiguration.course.id}`);
    for (const path of courseFiles) {
      const source = join(courseConfiguration.languageStaticDir, path);
      const output = join(courseRoot, path);
      const transform = courseAssetTransform(courseConfiguration, path, bundle.embeddingRuntime);
      const expected = transform ? transform(readSourceText(source)) : readFileSync(source);
      const actual = transform ? readFileSync(output, "utf8") : readFileSync(output);
      assert.deepEqual(actual, expected, `Course ${courseConfiguration.course.id} asset drifted: ${path}`);
    }
    const courseProfile = productProfileForCourse(courseConfiguration.course, {
      assetPaths: courseFiles,
      nativeProviders: courseConfiguration.nativeProviders,
    });
    if (courseProfile.capabilities.embeddings) {
      const provider = nativeProvider(courseProfile, "embeddings");
      if (provider.implementation === "vector-database-catalog-v1") {
        assertEmbeddingProviderBoundary(courseRoot, courseProfile);
        if (courseFiles.includes("source/shared/vector-db.js")) {
          assertVectorConfinement(courseRoot);
        }
      } else {
        assert.equal(provider.implementation, "webview-english-minilm-v1", "WebView embedding provider is unsupported");
        const catalog = JSON.parse(readFileSync(join(courseRoot, provider.catalogAsset), "utf8"));
        assertWebViewEmbeddingCatalog(catalog, courseConfiguration.course);
        assert.equal(catalog.runtime.modelDelivery, "android-setup-download", "Android WebView MiniLM must use setup delivery");
        assert.equal(catalog.runtime.modelPrecached, false, "Android WebView MiniLM must not claim APK precaching");
        assert.equal(catalog.runtime.androidPackaged, false, "Android WebView MiniLM must not claim packaged model bytes");
      }
      const setup = JSON.parse(readFileSync(join(courseRoot, "setup-assets.json"), "utf8"));
      assertSetupDownloadsSharedEmbeddingRuntime(setup, bundle.embeddingRuntime, courseConfiguration.course.id);
    }
    if (courseProfile.capabilities.dictionary) assertDictionaryProviderBoundary(courseRoot, courseProfile);
    if (courseConfiguration.course.id === "cz") {
      assertRuntimeBoundary(courseRoot);
      if (courseProfile.capabilities.wordWorldStandardOnly) {
        assertWordWorldBoundary(courseRoot, courseFiles, {
          sharedOutputDir: resolvedOutput,
          sharedFiles: files,
        });
      }
    }
    if (courseFiles.includes("setup-assets.json")) {
      assertSetupBoundary(courseRoot, courseConfiguration.languageStaticDir, courseProfile, {
        strictCzech: courseConfiguration.course.id === "cz",
        expectedTransform: courseAssetTransform(courseConfiguration, "setup-assets.json", bundle.embeddingRuntime),
      });
    }
    assertLearnerContentSafety(courseRoot);
    if (courseFiles.includes("source/shared/course-profile.js")) {
      const courseProfileSource = readSourceText(join(courseRoot, "source/shared/course-profile.js"));
      assert.doesNotMatch(courseProfileSource, /llm: true|generation: true|chat: true|offlineModels: true/);
    }
    if (courseFiles.includes("sw.js")) {
      const worker = readSourceText(join(courseRoot, "sw.js"));
      assert.match(worker, /importScripts\("\/language-runtime\/static\/source\/course-service-worker\.js"\)/);
    }
  }

  for (const asset of bundle.embeddingRuntime.assets) {
    assert.ok(!files.includes(asset.output), `Embedding runtime must remain setup-delivered: ${asset.output}`);
  }
  const sharedFiles = [
    "index.html",
    ...bundle.sharedAssets.map(({ output }) => output),
  ].sort();
  assertSharedAppBoundary(sharedFiles);
  assertCapabilityGatedSharedApp(resolvedOutput, bundle.defaultCourse, profile);
  assertNoForbiddenPaths(files);
  assertFirstPartySurface(resolvedOutput, sharedFiles);
  for (const courseConfiguration of bundle.configurations) {
    assertFirstPartySurface(
      join(resolvedOutput, `courses/${courseConfiguration.course.id}`),
      bundle.courseFilesById[courseConfiguration.course.id],
    );
  }
  assertBundleReferences(resolvedOutput, files, runtimeCatalog);

  const totalBytes = files.reduce((sum, path) => sum + statSync(join(resolvedOutput, path)).size, 0);
  return { outputDir: resolvedOutput, fileCount: files.length, totalBytes, files };
}

export function validateProductAssets({
  outputDir,
  workspaceRoot = defaultWorkspaceRoot,
  courseManifestPath = DEFAULT_COURSE_MANIFEST_PATH,
  languageStaticDir,
  configuration,
}) {
  const courseConfiguration = configuration || loadAndroidCourseConfiguration({
    workspaceRoot,
    courseManifestPath,
  });
  const resolvedOutput = resolve(outputDir);
  const resolvedLanguage = languageStaticDir
    ? realpathSync(resolve(languageStaticDir))
    : courseConfiguration.languageStaticDir;
  assert.equal(
    resolvedLanguage,
    courseConfiguration.languageStaticDir,
    "languageStaticDir must match the course manifest staticRoot",
  );
  assert.ok(existsSync(resolvedOutput), `Store output does not exist: ${resolvedOutput}`);
  const files = allFiles(resolvedOutput);
  assert.deepEqual(files, [...courseConfiguration.outputFiles].sort(), "Store output must equal the course Android asset allowlist");
  assert.deepEqual(
    readFileSync(join(resolvedOutput, "index.html"), "utf8"),
    transformIndex(readSourceText(courseConfiguration.appEntryPath)),
    "Packaged index.html must equal the reviewed product transform of the canonical shared app entry",
  );
  assertNoForbiddenPaths(files);
  assertSharedAppBoundary(files);
  assertFirstPartySurface(resolvedOutput, files);
  const profile = JSON.parse(readFileSync(join(resolvedOutput, "caatuu-profile.json"), "utf8"));
  assert.deepEqual(profile, courseConfiguration.productProfile, "Caatuu profile marker must match the course release capabilities");
  assertCapabilityGatedSharedApp(resolvedOutput, courseConfiguration, profile);
  const strictCzech = courseConfiguration.course.id === "cz";
  if (profile.capabilities.embeddings) {
    const embeddingCatalogPath = nativeProvider(profile, "embeddings").catalogAsset;
    assert.ok(files.includes(embeddingCatalogPath), `embedding-enabled output must retain ${embeddingCatalogPath}`);
    if (files.includes("source/shared/vector-db.js")) assertVectorConfinement(resolvedOutput);
    assertEmbeddingProviderBoundary(resolvedOutput, profile);
  }
  if (profile.capabilities.dictionary) assertDictionaryProviderBoundary(resolvedOutput, profile);
  if (strictCzech) assertRuntimeBoundary(resolvedOutput);
  if (files.includes("setup-assets.json")) {
    assertSetupBoundary(resolvedOutput, resolvedLanguage, profile, { strictCzech });
  }
  if (strictCzech && profile.capabilities.wordWorldStandardOnly) assertWordWorldBoundary(resolvedOutput, files);
  assertLearnerContentSafety(resolvedOutput);
  if (files.includes("sw.js")) assertServiceWorkerBoundary(resolvedOutput);
  assertImportReferences(resolvedOutput, files, courseConfiguration.course.routePrefix);
  assertHtmlReferences(resolvedOutput, files, courseConfiguration.course.routePrefix);

  if (files.includes("source/shared/course-profile.js")) {
    const course = readSourceText(join(resolvedOutput, "source/shared/course-profile.js"));
    assert.doesNotMatch(course, /llm: true/);
    assert.doesNotMatch(course, /generation: true/);
    if (strictCzech) {
      assert.match(course, /llm: false/);
      assert.match(course, /generation: false/);
    }
    assert.match(course, /chat: false/);
    assert.match(course, /offlineModels: false/);
    if (profile.capabilities.embeddings) assert.match(course, /semanticSearch: true/);
  }
  if (files.includes("manifest.webmanifest")) {
    const manifest = JSON.parse(readFileSync(join(resolvedOutput, "manifest.webmanifest"), "utf8"));
    assert.ok((manifest.shortcuts || []).every((shortcut) => shortcut.url !== "./chat.html"));
  }

  const totalBytes = files.reduce((sum, path) => sum + statSync(join(resolvedOutput, path)).size, 0);
  return { outputDir: resolvedOutput, fileCount: files.length, totalBytes, files };
}

export function compileProductAssetBundle({
  workspaceRoot = defaultWorkspaceRoot,
  courseBundlePath = DEFAULT_COURSE_BUNDLE_PATH,
  launcherStaticDir = join(workspaceRoot, "apps/launcher/static"),
  outputDir = join(workspaceRoot, "apps/android/product/build/generated/assets/product"),
  allowMissingSetupDeliveredRuntimeFiles = false,
} = {}) {
  const bundle = loadAndroidCourseBundleConfiguration({
    workspaceRoot,
    courseBundlePath,
    launcherStaticDir,
    allowMissingSetupDeliveredRuntimeFiles,
  });
  const resolvedOutput = resolve(outputDir);
  for (const configuration of bundle.configurations) {
    assertSafeOutputDirectory(
      resolvedOutput,
      bundle.workspaceRoot,
      configuration.languageStaticDir,
      bundle.launcherStaticDir,
    );
  }
  rmSync(resolvedOutput, { recursive: true, force: true });
  mkdirSync(resolvedOutput, { recursive: true });
  writeText(
    join(resolvedOutput, "index.html"),
    transformIndex(readSourceText(bundle.defaultCourse.appEntryPath)),
  );
  for (const configuration of bundle.configurations) {
    const courseOutput = join(resolvedOutput, `courses/${configuration.course.id}`);
    const courseFiles = bundle.courseFilesById[configuration.course.id];
    assert.ok(courseFiles, `Missing bundle file allowlist for course ${configuration.course.id}`);
    for (const path of courseFiles) {
      const source = join(configuration.languageStaticDir, path);
      const output = join(courseOutput, path);
      const transform = courseAssetTransform(configuration, path, bundle.embeddingRuntime);
      if (transform) {
        assert.ok(TEXT_EXTENSIONS.has(extension(path)), `Transform target must be text: ${path}`);
        writeText(output, transform(readSourceText(source)));
      } else {
        copyExactFile(source, output);
      }
    }
  }
  for (const { source, output } of bundle.sharedAssets) {
    const transform = SHARED_APP_TRANSFORMS[output];
    if (transform) {
      assert.ok(TEXT_EXTENSIONS.has(extension(output)), `Shared app transform target must be text: ${output}`);
      writeText(join(resolvedOutput, output), transform(readSourceText(source)));
    } else {
      copyExactFile(source, join(resolvedOutput, output));
    }
  }
  writeText(
    join(resolvedOutput, PRODUCT_COURSE_BUNDLE_ASSET),
    `${JSON.stringify(bundle.courseCatalog, null, 2)}\n`,
  );
  writeText(
    join(resolvedOutput, "caatuu-profile.json"),
    `${JSON.stringify(bundle.productProfile, null, 2)}\n`,
  );
  return validateProductAssetBundle({
    outputDir: resolvedOutput,
    configuration: bundle,
  });
}

export function compileProductAssets({
  workspaceRoot = defaultWorkspaceRoot,
  courseManifestPath = DEFAULT_COURSE_MANIFEST_PATH,
  languageStaticDir,
  launcherStaticDir = join(workspaceRoot, "apps/launcher/static"),
  outputDir = join(workspaceRoot, "apps/android/product/build/generated/assets/product")
} = {}) {
  const courseConfiguration = loadAndroidCourseConfiguration({ workspaceRoot, courseManifestPath });
  const resolvedWorkspace = courseConfiguration.workspaceRoot;
  const resolvedLanguage = languageStaticDir
    ? realpathSync(resolve(languageStaticDir))
    : courseConfiguration.languageStaticDir;
  assert.equal(
    resolvedLanguage,
    courseConfiguration.languageStaticDir,
    "languageStaticDir must match the course manifest staticRoot",
  );
  const resolvedLauncher = resolve(launcherStaticDir);
  const resolvedOutput = resolve(outputDir);
  assertSafeOutputDirectory(resolvedOutput, resolvedWorkspace, resolvedLanguage, resolvedLauncher);
  assert.ok(existsSync(resolvedLanguage), `Course static source is missing: ${resolvedLanguage}`);
  assert.ok(existsSync(resolvedLauncher), `Launcher static source is missing: ${resolvedLauncher}`);

  rmSync(resolvedOutput, { recursive: true, force: true });
  mkdirSync(resolvedOutput, { recursive: true });
  const strictCzech = courseConfiguration.course.id === "cz";
  writeText(
    join(resolvedOutput, "index.html"),
    transformIndex(readSourceText(courseConfiguration.appEntryPath)),
  );
  for (const path of courseConfiguration.languageFiles) {
    const sourcePath = join(resolvedLanguage, path);
    const outputPath = join(resolvedOutput, path);
    const transform = strictCzech ? TRANSFORMS[path] : undefined;
    if (transform) {
      assert.ok(TEXT_EXTENSIONS.has(extension(path)), `Transform target must be text: ${path}`);
      writeText(outputPath, transform(readSourceText(sourcePath)));
    } else {
      copyExactFile(sourcePath, outputPath);
    }
  }
  for (const { source, output } of courseConfiguration.launcherFiles) {
    copyExactFile(join(resolvedLauncher, source), join(resolvedOutput, output));
  }
  for (const { source, output } of courseConfiguration.appAssets) {
    const transform = SHARED_APP_TRANSFORMS[output];
    if (transform) {
      assert.ok(TEXT_EXTENSIONS.has(extension(output)), `Shared app transform target must be text: ${output}`);
      writeText(join(resolvedOutput, output), transform(readSourceText(source)));
    } else {
      copyExactFile(source, join(resolvedOutput, output));
    }
  }
  for (const { source, output } of courseConfiguration.sharedRuntimeAssets) {
    copyExactFile(source, join(resolvedOutput, output));
  }
  writeText(
    join(resolvedOutput, "caatuu-profile.json"),
    `${JSON.stringify(courseConfiguration.productProfile, null, 2)}\n`,
  );
  return validateProductAssets({
    outputDir: resolvedOutput,
    languageStaticDir: resolvedLanguage,
    configuration: courseConfiguration,
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help") return { help: true };
    const value = argv[index + 1];
    assert.ok(value && !value.startsWith("--"), `Missing value for ${key}`);
    index += 1;
    if (key === "--workspace-root") options.workspaceRoot = resolve(value);
    else if (key === "--course-manifest") options.courseManifestPath = resolve(value);
    else if (key === "--course-bundle") options.courseBundlePath = resolve(value);
    else if (key === "--language-static" || key === "--source") options.languageStaticDir = resolve(value);
    else if (key === "--launcher-static" || key === "--launcher") options.launcherStaticDir = resolve(value);
    else if (key === "--output") options.outputDir = resolve(value);
    else throw new Error(`Unknown argument: ${key}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node apps/android/tooling/build-product-assets.mjs [--course-bundle FILE|--course-manifest FILE] [--output DIR] [--workspace-root DIR] [--source DIR|--language-static DIR] [--launcher DIR|--launcher-static DIR]\n");
  } else {
    assert.ok(
      !(options.courseBundlePath && options.courseManifestPath),
      "Choose either --course-bundle or --course-manifest, not both",
    );
    const result = options.courseManifestPath || options.languageStaticDir
      ? compileProductAssets(options)
      : compileProductAssetBundle(options);
    process.stdout.write(`${JSON.stringify({
      profile: "product",
      outputDir: result.outputDir,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes
    }, null, 2)}\n`);
  }
}
