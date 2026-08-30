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
import { fileURLToPath } from "node:url";
import {
  extractLearnerContent,
  inspectLearnerFields
} from "../../../tools/czech-ml/scripts/learner-content-safety-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "../../..");
export const DEFAULT_COURSE_MANIFEST_PATH = "apps/languages/czech/course.json";
export const CANONICAL_APP_ENTRY_PATH = "apps/language-runtime/static/app/index.html";
export const SHARED_APP_ASSET_CATALOG_PATH = "apps/language-runtime/app-assets.json";

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
    implementation: "vector-database-catalog-v1",
    resource: "embeddingCatalog",
  }),
  dictionary: Object.freeze({
    capability: "dictionary",
    implementation: "sqlite-dictionary-catalog-v1",
    resource: "dictionaryCatalog",
  }),
  speech: Object.freeze({
    capability: "speech",
    implementation: "android-text-to-speech-v1",
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
      assert.equal(declaration.implementation, spec.implementation, `Android native provider ${name} implementation is unsupported`);
      assert.equal(declaration.resource, spec.resource, `Android native provider ${name} must reference resources.${spec.resource}`);
      resolved[name] = Object.freeze({
        implementation: spec.implementation,
        catalogAsset: resourceAssetPath(spec.resource),
      });
    } else {
      exactObjectKeys(declaration, ["implementation", "localeSource"], `Android native provider ${name}`);
      assert.equal(declaration.implementation, spec.implementation, `Android native provider ${name} implementation is unsupported`);
      assert.equal(declaration.localeSource, spec.localeSource, `Android native provider ${name} locale source is unsupported`);
      resolved[name] = Object.freeze({
        implementation: spec.implementation,
        locale: course.targetLanguage?.speechLocale,
      });
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    providers: Object.freeze(resolved),
  });
}

export function productProfileForCourse(course, { assetPaths = [], nativeProviders } = {}) {
  const capabilities = requireObject(course.capabilities, "course capabilities");
  requireObject(nativeProviders, "resolved Android native provider contract");
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
    capabilities: Object.freeze({
      // Product packages are deterministic even when the browser course supports these.
      chat: false,
      llm: false,
      generation: false,
      godot: false,
      embeddings: capabilities.embeddings,
      imageLookup: capabilities.wordWorld,
      stats: capabilities.memory,
      dictionary: capabilities.dictionary,
      speech: capabilities.speech,
      wordWorldStandardOnly: capabilities.wordWorld,
    }),
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
  assert.ok(Array.isArray(manifest.offline?.assets), "setup assets must declare offline assets");
  const offlineCount = manifest.offline.assets.length;
  manifest.offline.assets = manifest.offline.assets.filter(
    (asset) => !/^\.\/(?:chat\.html|source\/features\/chat\/)/u.test(String(asset)),
  );
  assert.equal(offlineCount - manifest.offline.assets.length, 3, "setup assets must remove the three disabled Chat files");
  return `${JSON.stringify(manifest, null, 2)}\n`;
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
    "Models, dictionaries, datasets, artwork, branding, and third-party components keep their separate terms.",
    "Dictionaries, datasets, artwork, branding, and third-party components keep their separate terms.",
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

function assertSetupBoundary(outputDir, languageStaticDir, profile, { strictCzech = false } = {}) {
  const outputPath = join(outputDir, "setup-assets.json");
  assert.ok(existsSync(outputPath), "store output must retain the setup manifest");
  if (strictCzech) {
    const developmentSource = readSourceText(join(languageStaticDir, "setup-assets.json"));
    assert.equal(
      readSourceText(outputPath),
      normalizeText(transformSetupAssets(developmentSource)),
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

function assertWordWorldBoundary(outputDir, files) {
  const providerModuleUrl = "source/games/word-world/word-net-standard.mjs?v=word-net-standard-5";
  const meaningAdapterUrl = "/language-runtime/static/source/word-net-core.mjs?v=word-net-core-19";
  const providerModule = providerModuleUrl.split("?", 1)[0];
  const meaningAdapter = meaningAdapterUrl.slice(1).split("?", 1)[0];
  assert.ok(files.includes(providerModule), `Czech Word World must package its course provider ${providerModule}`);
  assert.ok(files.includes(meaningAdapter), `Czech Word World must package the shared meaning adapter ${meaningAdapter}`);

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
    process.stdout.write("Usage: node apps/android/tooling/build-product-assets.mjs [--course-manifest FILE] [--output DIR] [--workspace-root DIR] [--source DIR|--language-static DIR] [--launcher DIR|--launcher-static DIR]\n");
  } else {
    const result = compileProductAssets(options);
    process.stdout.write(`${JSON.stringify({
      profile: "product",
      outputDir: result.outputDir,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes
    }, null, 2)}\n`);
  }
}
