import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compileProductAssets,
  loadAndroidCourseConfiguration,
  STORE_LANGUAGE_FILES,
  STORE_LAUNCHER_ICON_FILES
} from "../../android/tooling/build-product-assets.mjs";
import { sourcePathForArtifact } from "../../server/tooling/refresh-setup-assets.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const toolingDir = dirname(scriptPath);
const defaultWorkspaceRoot = resolve(toolingDir, "../../..");
const templateDir = join(toolingDir, "templates");
const toolingDataDir = join(toolingDir, "data");
const defaultOutputDir = join(defaultWorkspaceRoot, "artifacts/web/github-pages");
const maximumBundleBytes = 800_000_000;
const maximumFileBytes = 100_000_000;
const staticWorkerPolicyVersion = 2;
const webProfile = Object.freeze({
  schemaVersion: 1,
  profile: "web-static-core",
  capabilities: Object.freeze({
    chat: false,
    llm: false,
    generation: false,
    godot: false,
    embeddings: false,
    semanticSearch: false,
    imageLookup: true,
    stats: true,
    dictionary: true,
    fullDictionary: false,
    wordWorldStandardOnly: true,
    dynamicApi: false
  }),
  privacy: Object.freeze({
    bugReportsLocalOnly: true,
    dictionaryGapReportsLocalOnly: true
  })
});

const excludedProductPaths = Object.freeze([
  /^sw\.js$/u,
  /^data\/embeddings(?:\/|$)/u,
  /^data\/dictionaries(?:\/|$)/u,
  /^source\/shared\/vector-db\.js$/u,
  /^source\/features\/dictionary\/dictionary-patch-core\.mjs$/u,
  /^vendor(?:\/|$)/u
]);

const rootExtraFiles = Object.freeze([
  Object.freeze({
    source: "assets/loading-animation/animations_manifest.json",
    output: "assets/loading_animation/animations_manifest.json"
  })
]);

const keymapEntryCounts = Object.freeze({
  "misc-character-keymap": 304,
  "macaw-action-keymap": 250,
  "robot-keymap": 33
});

function slashPath(value) {
  return String(value).split(sep).join("/");
}

function normalizeText(value) {
  return String(value).replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

function readText(path) {
  return normalizeText(readFileSync(path, "utf8"));
}

function readSafeText(path, roots) {
  assertSafeSourceFile(path, roots);
  return readText(path);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalizeText(value), "utf8");
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function samePath(left, right) {
  const first = resolve(left);
  const second = resolve(right);
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function assertNoSymlinkAncestors(path, boundary, label) {
  const target = resolve(path);
  const root = resolve(boundary);
  assert.ok(samePath(target, root) || inside(root, target), `${label} must stay below ${root}`);
  let current = target;
  while (true) {
    if (existsSync(current)) {
      assert.ok(!lstatSync(current).isSymbolicLink(), `${label} may not traverse a symbolic link: ${current}`);
    }
    if (samePath(current, root)) break;
    const parent = dirname(current);
    assert.notEqual(parent, current, `${label} escaped its checked boundary`);
    current = parent;
  }
}

function assertSafeSourceFile(source, roots) {
  const sourcePath = resolve(source);
  const candidates = (Array.isArray(roots) ? roots : [roots]).map((root) => resolve(root));
  const sourceRoot = candidates.find((root) => samePath(root, sourcePath) || inside(root, sourcePath));
  assert.ok(sourceRoot, `Static source is outside its approved roots: ${sourcePath}`);
  assertNoSymlinkAncestors(sourcePath, sourceRoot, "Static source");
  assert.ok(existsSync(sourcePath), `Static source is missing: ${sourcePath}`);
  const sourceStat = lstatSync(sourcePath);
  assert.ok(sourceStat.isFile() && !sourceStat.isSymbolicLink(), `Static source is not a regular file: ${sourcePath}`);
  const realRoot = realpathSync(sourceRoot);
  const realSource = realpathSync(sourcePath);
  assert.ok(samePath(realRoot, realSource) || inside(realRoot, realSource), `Static source escapes its approved root: ${sourcePath}`);
}

function copyFile(source, output, sourceRoots) {
  assertSafeSourceFile(source, sourceRoots);
  assert.ok(existsSync(source), `Static source is missing: ${source}`);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(source, output);
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
  assert.equal(count, expectedCount, `${label}: expected ${expectedCount} anchor(s), found ${count}`);
  return source.split(before).join(after);
}

function replacePattern(source, pattern, replacement, label, expectedCount = 1) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const matches = [...source.matchAll(matcher)];
  assert.equal(matches.length, expectedCount, `${label}: expected ${expectedCount} match(es), found ${matches.length}`);
  return source.replace(matcher, replacement);
}

function replaceBetween(source, startAnchor, endAnchor, replacement, label) {
  assert.equal(countOccurrences(source, startAnchor), 1, `${label}: expected one start anchor`);
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `${label}: expected an end anchor after the start anchor`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function assertSafeOutputDirectory(outputDir, workspaceRoot) {
  const output = resolve(outputDir);
  const workspace = resolve(workspaceRoot);
  for (const protectedPath of [
    workspace,
    join(workspace, "apps"),
    join(workspace, "apps/launcher/static"),
    join(workspace, "apps/languages/czech/static")
  ]) {
    assert.notEqual(output.toLowerCase(), resolve(protectedPath).toLowerCase(), `Refusing to replace protected path: ${output}`);
  }
  assert.notEqual(dirname(output), output, `Refusing to replace a filesystem root: ${output}`);
  if (inside(workspace, output)) {
    const allowedRoot = join(workspace, "artifacts/web");
    assert.ok(inside(allowedRoot, output), `Static output inside the workspace must be below ${allowedRoot}`);
    assertNoSymlinkAncestors(output, workspace, "Static output");
  } else {
    const temporaryRoot = resolve(tmpdir());
    assert.ok(inside(temporaryRoot, output), `External static output must be below ${temporaryRoot}`);
    assert.match(
      relative(temporaryRoot, output),
      /(?:caatuu-static|github-pages)/iu,
      "External static output must be unmistakably task-specific"
    );
    assertNoSymlinkAncestors(output, temporaryRoot, "Static output");
  }
}

function assertReplaceableGeneratedOutput(outputDir) {
  if (!existsSync(outputDir)) return;
  const outputStat = lstatSync(outputDir);
  assert.ok(outputStat.isDirectory() && !outputStat.isSymbolicLink(), `Static output is not a regular directory: ${outputDir}`);
  const sentinelPath = join(outputDir, "caatuu-web-bundle.json");
  assert.ok(existsSync(sentinelPath), `Refusing to replace an output without the static bundle sentinel: ${outputDir}`);
  const sentinelStat = lstatSync(sentinelPath);
  assert.ok(sentinelStat.isFile() && !sentinelStat.isSymbolicLink(), `Static bundle sentinel is not a regular file: ${sentinelPath}`);
  const manifest = JSON.parse(readText(sentinelPath));
  assert.equal(
    manifest.schema_name || manifest.schemaName,
    "caatuu-web-bundle",
    `Refusing to replace an unrelated generated directory: ${outputDir}`
  );
}

function replaceGeneratedOutput(stagingDir, outputDir, workspaceRoot) {
  assertSafeOutputDirectory(stagingDir, workspaceRoot);
  assertSafeOutputDirectory(outputDir, workspaceRoot);
  assertReplaceableGeneratedOutput(outputDir);
  let backupDir = null;
  if (existsSync(outputDir)) {
    backupDir = mkdtempSync(join(dirname(outputDir), `.${basename(outputDir)}.backup-`));
    assertSafeOutputDirectory(backupDir, workspaceRoot);
    rmdirSync(backupDir);
    renameSync(outputDir, backupDir);
  }
  try {
    renameSync(stagingDir, outputDir);
  } catch (error) {
    if (backupDir && existsSync(backupDir) && !existsSync(outputDir)) {
      renameSync(backupDir, outputDir);
      backupDir = null;
    }
    throw error;
  }
  if (backupDir) rmSync(backupDir, { recursive: true });
}

function publicPathFromUrl(value, label = "public URL") {
  const raw = String(value || "");
  assert.ok(raw.startsWith("/"), `${label} must start at the origin root: ${raw}`);
  assert.doesNotMatch(raw, /[?#]/u, `${label} may not contain a query or fragment: ${raw}`);
  assert.doesNotMatch(raw, /\\/u, `${label} may not contain a backslash: ${raw}`);
  assert.doesNotMatch(raw, /%(?:2f|5c)/iu, `${label} may not encode a path separator: ${raw}`);
  assert.doesNotMatch(raw, /[\u0000-\u001f\u007f]/u, `${label} may not contain control characters: ${raw}`);
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    throw new Error(`${label} is not valid percent-encoding: ${raw}`, { cause: error });
  }
  assert.doesNotMatch(decoded, /\\/u, `${label} may not decode to a backslash: ${raw}`);
  assert.doesNotMatch(decoded, /[\u0000-\u001f\u007f]/u, `${label} may not decode to control characters: ${raw}`);
  const path = decoded.slice(1);
  const segments = path.split("/");
  assert.ok(path && segments.every(Boolean), `${label} may not contain an empty path segment: ${raw}`);
  for (const segment of segments) {
    assert.ok(segment !== "." && segment !== "..", `${label} may not traverse directories: ${raw}`);
    assert.equal(segment, segment.normalize("NFC"), `${label} must use NFC-normalized path segments: ${raw}`);
    assert.doesNotMatch(segment, /[<>:"|?*]/u, `${label} contains a Windows-unsafe path segment: ${raw}`);
    assert.doesNotMatch(segment, /[. ]$/u, `${label} contains a Windows-unsafe path ending: ${raw}`);
    assert.doesNotMatch(segment, /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu, `${label} contains a reserved Windows path segment: ${raw}`);
  }
  assert.ok(!isAbsolute(path), `${label} may not be an absolute filesystem path: ${raw}`);
  return segments.join("/");
}

function launcherIconPaths(launcherStaticDir) {
  const registry = JSON.parse(readSafeText(join(launcherStaticDir, "languages.json"), launcherStaticDir));
  assert.equal(registry?.browserSetup?.schemaVersion, 1, "Launcher browser setup must use schema version 1");
  assert.ok(Array.isArray(registry.browserSetup.courses), "Launcher browser setup must declare its courses");
  const paths = new Set(STORE_LAUNCHER_ICON_FILES.map((icon) => `assets/icons/${icon}`));
  for (const courseRecord of registry.browserSetup.courses) {
    const path = publicPathFromUrl(
      courseRecord?.targetLanguage?.flagSrc,
      `browser setup flag for ${courseRecord?.id || "unknown course"}`
    );
    assert.match(path, /^assets\/icons\/[^/]+\.png$/u, `Browser setup flag must be a launcher PNG: /${path}`);
    paths.add(path);
  }
  return [...paths].sort();
}

function outputPath(root, webPath) {
  const target = resolve(root, webPath);
  assert.ok(inside(root, target), `Static path escapes its output root: ${webPath}`);
  return target;
}

function allFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) result.push(slashPath(relative(root, fullPath)));
      else throw new Error(`Static output may not contain links or special files: ${fullPath}`);
    }
  };
  visit(root);
  return result.sort();
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function keptProductFiles() {
  return [...new Set([...STORE_LANGUAGE_FILES, "caatuu-profile.json"])]
    .filter((path) => !excludedProductPaths.some((pattern) => pattern.test(path)))
    .sort();
}

function transformCourseProfile(input) {
  let source = normalizeText(input);
  source = exactReplace(source, "      embeddings: true", "      embeddings: false", "static embeddings capability");
  source = exactReplace(source, "      semanticSearch: true", "      semanticSearch: false", "static semantic-search capability");
  source = exactReplace(source, "      skillCompass: true", "      skillCompass: false", "static skill-compass capability");
  source = replaceBetween(
    source,
    "    skillCompass: {",
    "    platforms: {",
    "    skillCompass: null,\n",
    "static skill-compass configuration"
  );
  source = replaceBetween(
    source,
    "    platforms: {",
    "  });",
    `    platforms: {
      browser: {
        enabled: true,
        entryPath: "/cz/index.html",
        backend: "static-dictionary"
      },
      android: {
        enabled: false,
        channels: []
      }
    }
`,
    "static browser-only platform configuration"
  );
  return source;
}

function transformRuntime(input) {
  let source = normalizeText(input);
  source = replacePattern(source, /^  const embeddingCatalogPath = .*\n/mu, "", "runtime embedding catalog constant");
  source = replacePattern(source, /^  const dictionaryPatchPath = .*\n/mu, "", "runtime dictionary patch constant");
  source = replacePattern(source, /^  let browserVectorDatabase = .*\n/mu, "", "runtime vector database state");
  source = replacePattern(source, /^  let dictionaryPatchRuntimePromise = .*\n/mu, "", "runtime dictionary patch state");
  source = exactReplace(source, '    webGpu: env === "browser" && "gpu" in navigator,', "    webGpu: false,", "runtime WebGPU capability");
  source = exactReplace(source, '    browserVectorDb: "WebAssembly" in window,', "    browserVectorDb: false,", "runtime browser vector capability");
  source = exactReplace(source, '    sharedSemanticVectorDb: "WebAssembly" in window,', "    sharedSemanticVectorDb: false,", "runtime shared vector capability");
  source = exactReplace(source, '    androidVectorDb: env === "android",', "    androidVectorDb: false,", "runtime Android vector capability");
  source = exactReplace(
    source,
    "    return Math.max(128 * 1024 * 1024, Math.ceil(Number(expectedBytes || 0) * 0.12));",
    "    return Math.max(4 * 1024 * 1024, Math.ceil(Number(expectedBytes || 0) * 0.12));",
    "static setup storage reserve"
  );
  source = replaceBetween(
    source,
    "  async function browserUpdateStatus() {",
    "  function browserArtifacts(manifest) {",
    `  async function browserUpdateStatus() {
    return {
      updateAvailable: false,
      currentVersionCode: 0,
      currentVersionName: "static web",
      latestVersionCode: 0,
      latestVersionName: "static web",
      source: "static-site"
    };
  }

`,
    "static browser update status"
  );
  source = exactReplace(
    source,
    '      const url = new URL("sw.js", window.location.href);',
    '      const url = new URL("/sw.js", window.location.origin);',
    "root service-worker probe"
  );
  source = replaceBetween(
    source,
    "  function browserServiceWorkerRegistration() {",
    "  function checkBrowserFreshness(",
    `  function browserServiceWorkerRegistration() {
    if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;
    const rootScope = new URL("/", window.location.origin).href;
    const legacyCzechScope = new URL("/cz/", window.location.origin).href;
    serviceWorkerRegistrationPromise = navigator.serviceWorker.getRegistrations()
      .then(async (registrations) => {
        await Promise.all(registrations
          .filter((registration) => registration.scope === legacyCzechScope && registration.scope !== rootScope)
          .map((registration) => registration.unregister()));
        return navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none"
        });
      })
      .then((registration) => {
        observeServiceWorkerRegistration(registration);
        return registration;
      })
      .catch((error) => {
        serviceWorkerRegistrationPromise = null;
        throw error;
      });
    return serviceWorkerRegistrationPromise;
  }

`,
    "root service-worker registration and legacy-scope retirement"
  );
  source = replaceBetween(
    source,
    "  async function loadEmbeddingCatalog() {",
    "  window.CaatuuRuntime = {",
    `  let staticDictionaryRuntimePromise = null;

  function staticDictionaryRuntime() {
    if (!staticDictionaryRuntimePromise) {
      staticDictionaryRuntimePromise = import("../features/dictionary/dictionary-static-core.mjs?v=dictionary-static-core-1")
        .then((module) => module.createStaticDictionaryApi())
        .catch((error) => {
          staticDictionaryRuntimePromise = null;
          throw error;
        });
    }
    return staticDictionaryRuntimePromise;
  }

`,
    "model/vector/dynamic-dictionary implementation"
  );
  source = replaceBetween(
    source,
    "    vector: {",
    "    maintenance: {",
    `    vector: {
      status() {
        return Promise.resolve({
          available: false,
          ready: false,
          runtime: "static-keymap-only"
        });
      },
      search(text, options = {}) {
        return Promise.resolve({
          runtime: "static-keymap-only",
          text: String(text || ""),
          limit: Number(options.limit || 10),
          sourceKinds: Array.isArray(options.sourceKinds) ? options.sourceKinds : [],
          results: []
        });
      }
    },
    dictionary: {
      async status() {
        return (await staticDictionaryRuntime()).status();
      },
      async download(handlers = {}) {
        return (await staticDictionaryRuntime()).download(handlers);
      },
      async search(query, options = {}) {
        return (await staticDictionaryRuntime()).search(query, options);
      }
    },
`,
    "model-free vector compatibility API"
  );
  assert.doesNotMatch(source, /(?:\/android\/|\/api\/|vector-db\.js|embeddingCatalogPath|dictionaryPatchPath|browserVectorDatabase)/u);
  return source;
}

function transformSharedWorkspace(input) {
  return replacePattern(
    normalizeText(input),
    /^\s*repoLink\.href = `https:\/\/huggingface\.co\/\$\{model\.repoId\}`;\n/mu,
    "",
    "static model-source link"
  );
}

function transformSharedCourseServiceWorker(input) {
  return replaceBetween(
    normalizeText(input),
    "function isModelRuntimeRequest(url) {",
    "async function cacheFirst(request, config) {",
    `function isModelRuntimeRequest() {
  return false;
}

`,
    "static model-runtime request policy"
  );
}

function transformLanguageIndex(input) {
  let source = normalizeText(input);
  const replacements = [
    ["<small>full dictionary</small>", "<small>static web dictionary</small>"],
    ["<h2>Czech → English Dictionary</h2>", "<h2>Czech → English Web Dictionary</h2>"],
    ["<p>Czech words, English meanings, and inflected forms.</p>", "<p>The curated Czech learning words and their English meanings.</p>"],
    ['aria-label="Full dictionary controls"', 'aria-label="Web dictionary controls"'],
    ['aria-label="Search the full Czech to English dictionary"', 'aria-label="Search the curated Czech to English web dictionary"'],
    ["Results may include several meanings and example sentences.", "Results come from the 865-record curated learning dictionary, with a compact Standard-game form supplement."],
    [">Download full dictionary</button>", ">Static dictionary</button>"]
  ];
  for (const [before, after] of replacements) {
    source = exactReplace(source, before, after, `language index ${before}`);
  }
  return source;
}

function transformDictionaryUi(input) {
  let source = normalizeText(input);
  assert.equal(
    countOccurrences(source, "  const dictionaryApi = window.CaatuuRuntime?.dictionary;"),
    1,
    "dictionary UI must retain the shared runtime API"
  );
  const replacements = [
    ["Search the full Czech to English dictionary", "Search the curated Czech to English web dictionary"],
    ["No full-dictionary match.", "No web-dictionary match."],
    ["Full-dictionary lookup is not available right now.", "Web-dictionary lookup is not available right now."],
    ["Full-dictionary search failed. Please try again.", "Web-dictionary search failed. Please try again."],
    ['setAvailability("Available", "ready");', 'setAvailability("Core web · 865 records", "ready");']
  ];
  for (const [before, after] of replacements) {
    const count = countOccurrences(source, before);
    assert.ok(count >= 1, `dictionary UI anchor missing: ${before}`);
    source = source.split(before).join(after);
  }
  return source;
}

function transformLauncherIndex(input) {
  let source = normalizeText(input);
  source = exactReplace(source, "<small>Android preview</small>", "<small>Android app</small>", "launcher Android label");
  source = exactReplace(source, "<b>Checking Android build</b>", "<b>Published separately</b>", "launcher Android state");
  source = replaceBetween(
    source,
    '          <details class="advanced-entry">',
    '          <p class="home-footnote">',
    "",
    "launcher server-only preview link"
  );
  return source;
}

function transformNotFound(input) {
  let source = exactReplace(
    normalizeText(input),
    "The Caatuu runtime answered this\n                request, so the app origin is reachable.",
    "The static Caatuu site answered this\n                request, so the app origin is reachable.",
    "static 404 explanation"
  );
  source = exactReplace(
    source,
    "/assets/macaw/actions/jedy_%20stop.png",
    "/assets/macaw/actions/072-gesture_stop.png",
    "static 404 illustration"
  );
  return source;
}

function transformLanguageRegistry(input) {
  const registry = JSON.parse(normalizeText(input));
  assert.equal(registry.schemaVersion, 1);
  for (const language of registry.languages || []) {
    language.capabilities = (language.capabilities || []).filter((capability) =>
      !["chat", "embeddings", "offlineModels", "semanticSearch", "skillCompass"].includes(capability)
    );
    if (language.platforms?.android) {
      language.platforms.android = { enabled: false, channels: [] };
    }
  }
  return `${JSON.stringify(registry, null, 2)}\n`;
}

function transformKeymap(input, publishedVisualPaths, artifactKey) {
  const raw = JSON.parse(normalizeText(input));
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw), `${artifactKey} must be an object map`);
  const transformed = {};
  for (const [assetUrl, metadata] of Object.entries(raw)) {
    const assetPath = publicPathFromUrl(assetUrl, `${artifactKey} entry`);
    if (!publishedVisualPaths.has(assetPath)) continue;
    assert.ok(metadata && typeof metadata === "object" && !Array.isArray(metadata), `${artifactKey} metadata must be an object`);
    const { embedding: _embedding, ...staticMetadata } = metadata;
    transformed[assetUrl] = staticMetadata;
  }
  assert.equal(
    Object.keys(transformed).length,
    keymapEntryCounts[artifactKey],
    `${artifactKey} must retain its reviewed child-facing entries`
  );
  return `${JSON.stringify(transformed, null, 2)}\n`;
}

function transformProductOutput(workspaceRoot, stagingDir) {
  const czDir = join(stagingDir, "cz");
  const sharedSourceDir = join(stagingDir, "language-runtime/static/source");
  writeText(join(czDir, "source/shared/course-profile.js"), transformCourseProfile(readText(join(czDir, "source/shared/course-profile.js"))));
  writeText(join(czDir, "source/shared/runtime.js"), transformRuntime(readText(join(czDir, "source/shared/runtime.js"))));
  writeText(join(czDir, "index.html"), transformLanguageIndex(readText(join(czDir, "index.html"))));
  writeText(
    join(czDir, "source/features/dictionary/dictionary-full.js"),
    transformDictionaryUi(readText(join(czDir, "source/features/dictionary/dictionary-full.js")))
  );
  writeText(
    join(sharedSourceDir, "caatuu-workspace.js"),
    transformSharedWorkspace(readText(join(sharedSourceDir, "caatuu-workspace.js")))
  );
  writeText(
    join(sharedSourceDir, "course-service-worker.js"),
    transformSharedCourseServiceWorker(readText(join(sharedSourceDir, "course-service-worker.js")))
  );
  const wordWorldPath = join(stagingDir, "language-runtime/static/source/product-word-world.mjs");
  writeText(
    wordWorldPath,
    exactReplace(
      readText(wordWorldPath),
      'const DICTIONARY_GAP_NOTICE = "Missing word queued for server review.";',
      'const DICTIONARY_GAP_NOTICE = "Missing word saved on this device.";',
      "Word World local dictionary-gap notice"
    )
  );
  const setupPath = join(czDir, "source/features/setup/setup.js");
  writeText(
    setupPath,
    exactReplace(
      readText(setupPath),
      'setText("#setupMessage", "Report sent. Thank you.");',
      'setText("#setupMessage", "Saved on this device. Thank you.");',
      "local setup report completion copy"
    )
  );
  writeJson(join(czDir, "caatuu-profile.json"), webProfile);
  copyFile(
    join(templateDir, "dictionary-static-core.mjs"),
    join(czDir, "source/features/dictionary/dictionary-static-core.mjs"),
    templateDir
  );
  copyFile(
    join(toolingDataDir, "word-world-static-dictionary.v1.json"),
    join(czDir, "data/games/word-world/static-dictionary.v1.json"),
    toolingDataDir
  );
  const dictionarySourceDir = join(workspaceRoot, "apps/languages/czech/static/data/dictionaries");
  copyFile(
    join(dictionarySourceDir, "ATTRIBUTION.md"),
    join(czDir, "data/dictionaries/ATTRIBUTION.md"),
    dictionarySourceDir
  );
}

function copyProductOutput(productDir, stagingDir, courseConfiguration) {
  for (const path of keptProductFiles()) {
    copyFile(join(productDir, path), join(stagingDir, "cz", path), productDir);
  }
  copyFile(join(productDir, "index.html"), join(stagingDir, "cz/index.html"), productDir);
  for (const { output } of courseConfiguration.appAssets.filter(({ output }) => output.startsWith("language-runtime/"))) {
    copyFile(join(productDir, output), join(stagingDir, output), productDir);
  }
  for (const { output } of courseConfiguration.sharedRuntimeAssets) {
    copyFile(join(productDir, output), join(stagingDir, output), productDir);
  }
}

function assertStaticCompilerSources(languageStaticDir, launcherStaticDir) {
  for (const path of STORE_LANGUAGE_FILES) {
    assertSafeSourceFile(join(languageStaticDir, path), languageStaticDir);
  }
  for (const path of launcherIconPaths(launcherStaticDir)) {
    assertSafeSourceFile(join(launcherStaticDir, path), launcherStaticDir);
  }
  assertSafeSourceFile(
    join(launcherStaticDir, "assets/loading-animation/animations_manifest.json"),
    launcherStaticDir
  );
}

function copyLauncherSurface(workspaceRoot, stagingDir) {
  const launcherDir = join(workspaceRoot, "apps/launcher/static");
  writeText(join(stagingDir, "index.html"), transformLauncherIndex(readSafeText(join(launcherDir, "index.html"), launcherDir)));
  copyFile(join(launcherDir, "app.css"), join(stagingDir, "app.css"), launcherDir);
  copyFile(join(templateDir, "launcher-static.js"), join(stagingDir, "launcher.js"), templateDir);
  writeText(join(stagingDir, "languages.json"), transformLanguageRegistry(readSafeText(join(launcherDir, "languages.json"), launcherDir)));
  writeText(join(stagingDir, "404.html"), transformNotFound(readSafeText(join(launcherDir, "not-found.html"), launcherDir)));
  for (const path of launcherIconPaths(launcherDir)) {
    copyFile(join(launcherDir, path), join(stagingDir, path), launcherDir);
  }
  for (const { source, output } of rootExtraFiles) {
    copyFile(join(launcherDir, source), join(stagingDir, output), launcherDir);
  }
}

function selectedStaticArtifacts(workspaceRoot) {
  const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");
  const languageStaticDir = join(workspaceRoot, "apps/languages/czech/static");
  const manifestPath = join(languageStaticDir, "setup-assets.json");
  assertSafeSourceFile(manifestPath, languageStaticDir);
  const sourceManifest = JSON.parse(readSafeText(manifestPath, languageStaticDir));
  const selected = (sourceManifest.artifacts || []).filter((artifact) =>
    ["visual-asset", "asset-keymap"].includes(artifact?.artifact_kind)
  );
  assert.equal(selected.filter((artifact) => artifact.artifact_kind === "visual-asset").length, 646);
  assert.equal(selected.filter((artifact) => artifact.artifact_kind === "asset-keymap").length, 3);
  const artifactKeys = selected.map((artifact) => String(artifact.key || ""));
  assert.ok(artifactKeys.every(Boolean), "Every published artifact must have a key");
  assert.equal(new Set(artifactKeys).size, artifactKeys.length, "Published artifact keys must be unique");
  const rawUrls = selected.map((artifact) => String(artifact.url || ""));
  assert.equal(new Set(rawUrls).size, rawUrls.length, "Published artifact URLs must be unique");
  const publicPaths = selected.map((artifact) => publicPathFromUrl(artifact.url, artifact.key));
  assert.equal(new Set(publicPaths).size, publicPaths.length, "Published artifact destinations must be unique");
  assert.equal(
    new Set(publicPaths.map((path) => path.toLocaleLowerCase("en-US"))).size,
    publicPaths.length,
    "Published artifact destinations must be unique without case distinctions"
  );
  const publishedVisualPaths = new Set(selected
    .filter((artifact) => artifact.artifact_kind === "visual-asset")
    .map((artifact) => publicPathFromUrl(artifact.url, artifact.key)));
  assert.equal(publishedVisualPaths.size, 646, "Published visual destinations must be unique");
  return { launcherStaticDir, languageStaticDir, sourceManifest, selected, publishedVisualPaths };
}

function expectedStaticSetupManifest(workspaceRoot) {
  const {
    launcherStaticDir,
    languageStaticDir,
    sourceManifest,
    selected,
    publishedVisualPaths
  } = selectedStaticArtifacts(workspaceRoot);
  const artifacts = selected.map((artifact) => {
    if (artifact.artifact_kind !== "asset-keymap") {
      return { ...artifact, native_required: false, browser_required: false };
    }
    const sourcePath = sourcePathForArtifact({
      artifact,
      launcherStaticDir,
      languageStaticDir,
      languageRoutePrefix: "/cz"
    });
    assertSafeSourceFile(sourcePath, [launcherStaticDir, languageStaticDir]);
    assert.equal(statSync(sourcePath).size, Number(artifact.bytes), `${artifact.key} source byte count changed`);
    assert.equal(sha256File(sourcePath), String(artifact.sha256).toLowerCase(), `${artifact.key} source hash changed`);
    const transformed = transformKeymap(readSafeText(sourcePath, [launcherStaticDir, languageStaticDir]), publishedVisualPaths, artifact.key);
    return {
      ...artifact,
      bytes: Buffer.byteLength(transformed, "utf8"),
      sha256: sha256Bytes(transformed),
      native_required: false,
      browser_required: true
    };
  });
  return { version: sourceManifest.version, cache_name: sourceManifest.cache_name, artifacts };
}

function copyPublishedAssets(workspaceRoot, stagingDir) {
  const {
    launcherStaticDir,
    languageStaticDir,
    sourceManifest,
    selected,
    publishedVisualPaths
  } = selectedStaticArtifacts(workspaceRoot);
  const artifacts = [];

  for (const artifact of selected) {
    const publicPath = publicPathFromUrl(artifact.url, artifact.key);
    assert.ok(
      !existsSync(outputPath(stagingDir, publicPath)),
      `${artifact.key} collides with an already generated static file: ${publicPath}`
    );
  }

  for (const artifact of selected) {
    const publicPath = publicPathFromUrl(artifact.url, artifact.key);
    const sourcePath = sourcePathForArtifact({
      artifact,
      launcherStaticDir,
      languageStaticDir,
      languageRoutePrefix: "/cz"
    });
    const destination = outputPath(stagingDir, publicPath);
    if (artifact.artifact_kind === "asset-keymap") {
      assertSafeSourceFile(sourcePath, [launcherStaticDir, languageStaticDir]);
      assert.equal(statSync(sourcePath).size, Number(artifact.bytes), `${artifact.key} source byte count changed`);
      assert.equal(sha256File(sourcePath), String(artifact.sha256).toLowerCase(), `${artifact.key} source hash changed`);
      const transformed = transformKeymap(readSafeText(sourcePath, [launcherStaticDir, languageStaticDir]), publishedVisualPaths, artifact.key);
      writeText(destination, transformed);
    } else {
      copyFile(sourcePath, destination, [launcherStaticDir, languageStaticDir]);
    }
    const bytes = statSync(destination).size;
    const sha256 = sha256File(destination);
    if (artifact.artifact_kind === "visual-asset") {
      assert.equal(bytes, Number(artifact.bytes), `${artifact.key} byte count changed`);
      assert.equal(sha256, String(artifact.sha256).toLowerCase(), `${artifact.key} hash changed`);
    }
    artifacts.push({
      ...artifact,
      bytes,
      sha256,
      native_required: false,
      browser_required: artifact.artifact_kind === "asset-keymap"
    });
  }

  const outputManifest = {
    version: sourceManifest.version,
    cache_name: sourceManifest.cache_name,
    artifacts
  };
  assert.deepEqual(outputManifest, expectedStaticSetupManifest(workspaceRoot));
  writeJson(join(stagingDir, "cz/setup-assets.json"), outputManifest);
  return outputManifest;
}

function coreAssetPaths(stagingDir, setupManifest) {
  const files = allFiles(stagingDir).filter((path) => !["sw.js", "caatuu-web-bundle.json"].includes(path));
  const paths = new Set(["/", "/index.html", "/cz/", "/cz/index.html"]);
  for (const path of files) {
    if (path.startsWith("cz/")) paths.add(`/${path}`);
    if (path.startsWith("language-runtime/")) paths.add(`/${path}`);
    if (["app.css", "launcher.js", "languages.json", "404.html"].includes(path)) paths.add(`/${path}`);
    if (path.startsWith("assets/icons/")) paths.add(`/${path}`);
    if (path === "assets/loading_animation/animations_manifest.json") paths.add(`/${path}`);
  }
  for (const artifact of setupManifest.artifacts.filter((item) => item.artifact_kind === "asset-keymap")) {
    paths.add(`/${publicPathFromUrl(artifact.url, artifact.key)}`);
  }
  for (const url of [
    "/assets/macaw/actions/macaw%20(23).png",
    "/assets/miscellaneous/burrow-review_062.png",
    "/assets/macaw/actions/macaw%20(62).png",
    "/assets/macaw/actions/072-gesture_stop.png"
  ]) {
    paths.add(url);
  }
  return [...paths].sort();
}

function serviceWorkerSource(coreAssets, cacheDigest) {
  return `const WORKER_POLICY_VERSION = ${staticWorkerPolicyVersion};
const CACHE_NAME = "caatuu-czech-web-static-${cacheDigest}";
const CACHE_PREFIX = "caatuu-czech-web-static-";
const LEGACY_PWA_CACHE_PREFIX = "caatuu-czech-pwa-";
const CORE_ASSETS = ${JSON.stringify(coreAssets, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(CORE_ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => (
        (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_PWA_CACHE_PREFIX))
        && key !== CACHE_NAME
      ))
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.searchParams.has("caatuu_setup_sha256") || request.cache === "no-store") {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === "navigate" || request.cache === "reload" || ["document", "script", "style"].includes(request.destination)) {
    event.respondWith(networkThenCache(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function cachedResponse(request) {
  const current = await caches.open(CACHE_NAME);
  return current.match(request, { ignoreSearch: true });
}

async function cacheFirst(request) {
  const cached = await cachedResponse(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheResponse(request, response);
  return response;
}

async function networkThenCache(request) {
  try {
    const response = await fetch(new Request(request, { cache: "reload" }));
    await cacheResponse(request, response);
    return response;
  } catch (error) {
    let cached = await cachedResponse(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = new URL(request.url);
      fallback.search = "";
      cached = await cachedResponse(fallback.href);
      if (cached) return cached;
    }
    throw error;
  }
}

async function cacheResponse(request, response) {
  if (!response || response.status !== 200) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    // Cache quota pressure must never hide a valid network response.
  }
}
`;
}

function resolveCoreAsset(outputDir, asset) {
  if (asset === "/") return join(outputDir, "index.html");
  if (asset === "/cz/") return join(outputDir, "cz/index.html");
  return outputPath(outputDir, publicPathFromUrl(asset, "service-worker core asset"));
}

function generateServiceWorker(stagingDir, setupManifest) {
  const coreAssets = coreAssetPaths(stagingDir, setupManifest);
  for (const asset of coreAssets) {
    const path = resolveCoreAsset(stagingDir, asset);
    assert.ok(existsSync(path) && statSync(path).isFile(), `Core asset is missing: ${asset}`);
  }
  const cacheDigest = sha256Bytes([`policy:${staticWorkerPolicyVersion}`, ...coreAssets.map((asset) => {
    const path = resolveCoreAsset(stagingDir, asset);
    return `${asset}\0${sha256File(path)}`;
  })].join("\n")).slice(0, 16);
  writeText(join(stagingDir, "sw.js"), serviceWorkerSource(coreAssets, cacheDigest));
  return { cacheDigest, coreAssets };
}

function inventoryFor(outputDir) {
  return allFiles(outputDir)
    .filter((path) => path !== "caatuu-web-bundle.json")
    .map((path) => ({
      path,
      bytes: statSync(join(outputDir, path)).size,
      sha256: sha256File(join(outputDir, path))
    }));
}

function inventoryDigest(files) {
  return sha256Bytes(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join("\n"));
}

function generateBundleManifest(stagingDir, setupManifest, cacheDigest) {
  const files = inventoryFor(stagingDir);
  const payloadBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const manifest = {
    schema_name: "caatuu-web-bundle",
    schema_version: 1,
    profile: webProfile.profile,
    basePath: "/",
    canonicalOrigin: "https://caatuu.waajacu.com",
    entrypoints: ["/", "/cz/", "/cz/index.html"],
    serviceWorkerCache: `caatuu-czech-web-static-${cacheDigest}`,
    requiredSetupArtifacts: setupManifest.artifacts.filter((artifact) => artifact.browser_required).length,
    publishedVisualAssets: setupManifest.artifacts.filter((artifact) => artifact.artifact_kind === "visual-asset").length,
    payloadFileCount: files.length,
    payloadBytes,
    payloadSha256: inventoryDigest(files),
    files
  };
  writeJson(join(stagingDir, "caatuu-web-bundle.json"), manifest);
  return manifest;
}

function expectedFiles(workspaceRoot, setupManifest) {
  const courseConfiguration = loadAndroidCourseConfiguration({ workspaceRoot });
  const expected = new Set([
    "index.html",
    "app.css",
    "launcher.js",
    "languages.json",
    "404.html",
    "sw.js",
    "caatuu-web-bundle.json",
    "assets/loading_animation/animations_manifest.json",
    "cz/source/features/dictionary/dictionary-static-core.mjs",
    "cz/data/games/word-world/static-dictionary.v1.json",
    "cz/data/dictionaries/ATTRIBUTION.md",
    "cz/index.html"
  ]);
  for (const path of keptProductFiles()) expected.add(`cz/${path}`);
  for (const { output } of courseConfiguration.appAssets.filter(({ output }) => output.startsWith("language-runtime/"))) {
    expected.add(output);
  }
  for (const { output } of courseConfiguration.sharedRuntimeAssets) expected.add(output);
  for (const path of launcherIconPaths(join(workspaceRoot, "apps/launcher/static"))) expected.add(path);
  for (const artifact of setupManifest.artifacts) {
    expected.add(publicPathFromUrl(artifact.url, artifact.key));
  }
  return [...expected].sort();
}

function checkJavaScriptSyntax(path, source) {
  const moduleSyntax = /(^|\n)\s*(?:import\s+(?!\()|export\s+)|\bimport\.meta\b/mu.test(source);
  const result = spawnSync(
    process.execPath,
    ["--input-type", moduleSyntax ? "module" : "commonjs", "--check"],
    { input: source, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  assert.equal(result.status, 0, `${path}: node --check failed\n${result.stderr || result.stdout}`);
}

function moduleReferences(source) {
  const references = new Set();
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu,
    /(?:^|\n)\s*export\s+[^;]*?\s+from\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.add(match[1]);
  }
  return [...references];
}

const allowedExternalAnchorOrigins = new Set([
  "https://github.com",
  "https://www.waajacu.com"
]);

function referenceDisposition(path, reference, context, { allowExternalAnchor = false } = {}) {
  const value = String(reference || "").trim();
  if (!value || value.startsWith("#")) return "fragment";
  if (/^data:/iu.test(value)) return "embedded";
  assert.ok(!value.startsWith("//"), `${path}: ${context} requires a network resource: ${value}`);
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    if (allowExternalAnchor) {
      const target = new URL(value);
      assert.equal(target.protocol, "https:", `${path}: external anchor must use HTTPS: ${value}`);
      assert.ok(
        allowedExternalAnchorOrigins.has(target.origin),
        `${path}: external anchor origin is not approved: ${value}`
      );
      return "external-anchor";
    }
    assert.fail(`${path}: ${context} requires a network resource: ${value}`);
  }
  return "local";
}

function assertPublishedReference(outputDir, sourcePath, reference, context) {
  const target = referencePath(outputDir, sourcePath, reference);
  assert.ok(target && inside(outputDir, target), `${sourcePath}: ${context} escapes output: ${reference}`);
  assert.ok(
    existsSync(target) && statSync(target).isFile(),
    `${sourcePath}: missing ${context} ${reference}`
  );
  return target;
}

function assertExecutableReferences(outputDir, files) {
  for (const path of files.filter((item) => [".js", ".mjs"].includes(extname(item)))) {
    const source = readText(join(outputDir, path));
    checkJavaScriptSyntax(path, source);
    for (const reference of moduleReferences(source)) {
      const disposition = referenceDisposition(path, reference, "module import");
      if (disposition !== "local") continue;
      assert.ok(
        reference.startsWith(".") || reference.startsWith("/"),
        `${path}: bare module import is not self-contained: ${reference}`
      );
      assertPublishedReference(outputDir, path, reference, "module import");
    }
  }
}

function referencePath(outputDir, htmlPath, reference) {
  const clean = reference.split(/[?#]/u, 1)[0];
  if (!clean) return null;
  if (clean === "/") return join(outputDir, "index.html");
  const decoded = decodeURIComponent(clean);
  if (decoded.startsWith("/")) {
    const publicPath = decoded.replace(/^\/+/, "");
    return decoded.endsWith("/")
      ? outputPath(outputDir, `${publicPath}index.html`)
      : outputPath(outputDir, publicPath);
  }
  const target = resolve(outputDir, dirname(htmlPath), decoded);
  return decoded.endsWith("/") ? join(target, "index.html") : target;
}

function assertHtmlReferences(outputDir, files) {
  for (const path of files.filter((item) => extname(item) === ".html")) {
    const source = readText(join(outputDir, path));
    for (const tagMatch of source.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gisu)) {
      const tagName = tagMatch[1].toLowerCase();
      for (const attribute of tagMatch[0].matchAll(/\b(src|href|data-src|poster|srcset)\s*=\s*["']([^"']+)["']/giu)) {
        const attributeName = attribute[1].toLowerCase();
        const references = attributeName === "srcset"
          ? attribute[2].split(",").map((candidate) => candidate.trim().split(/\s+/u, 1)[0]).filter(Boolean)
          : [attribute[2]];
        for (const reference of references) {
          const disposition = referenceDisposition(path, reference, `HTML ${attributeName}`, {
            allowExternalAnchor: tagName === "a" && attributeName === "href"
          });
          if (disposition !== "local") continue;
          assertPublishedReference(outputDir, path, reference, `HTML ${attributeName}`);
        }
      }
    }
  }
}

function assertCssReferences(outputDir, files) {
  for (const path of files.filter((item) => extname(item) === ".css")) {
    const source = readText(join(outputDir, path));
    const references = new Set();
    for (const match of source.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/giu)) {
      references.add(match[1]);
    }
    for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) references.add(match[2]);
    for (const reference of references) {
      const disposition = referenceDisposition(path, reference, "CSS resource");
      if (disposition !== "local") continue;
      assertPublishedReference(outputDir, path, reference, "CSS resource");
    }
  }
}

function assertWebManifestReferences(outputDir, files) {
  const resourceKeys = new Set(["id", "scope", "src", "start_url", "url"]);
  for (const path of files.filter((item) => extname(item) === ".webmanifest")) {
    const manifest = JSON.parse(readText(join(outputDir, path)));
    const visit = (value, key = "") => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, key);
        return;
      }
      if (value && typeof value === "object") {
        for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
        return;
      }
      if (typeof value !== "string" || !resourceKeys.has(key)) return;
      const disposition = referenceDisposition(path, value, `web manifest ${key}`);
      if (disposition !== "local") return;
      assertPublishedReference(outputDir, path, value, `web manifest ${key}`);
    };
    visit(manifest);
  }
}

function assertStaticNetworkSinks(outputDir, files) {
  const forbiddenRuntimePatterns = [
    /\bnew\s+(?:SharedWorker|WebSocket|EventSource)\s*\(/u,
    /\bnavigator\s*\.\s*sendBeacon\s*\(/u,
    /\bXMLHttpRequest\b/u
  ];
  const literalResourcePatterns = [
    /\bfetch\s*\(\s*(["'`])([^"'`]+)\1/gu,
    /\bimportScripts\s*\(\s*(["'`])([^"'`]+)\1/gu,
    /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(["'`])([^"'`]+)\1/gu,
    /\bserviceWorker\s*\.\s*register\s*\(\s*(["'`])([^"'`]+)\1/gu
  ];
  for (const path of files.filter((item) => [".html", ".js", ".mjs"].includes(extname(item)))) {
    const source = readText(join(outputDir, path));
    for (const pattern of forbiddenRuntimePatterns) {
      assert.doesNotMatch(source, pattern, `${path}: server-dependent runtime API survived`);
    }
    for (const pattern of literalResourcePatterns) {
      for (const match of source.matchAll(pattern)) {
        if (match[1] === "`" && match[2].includes("${")) continue;
        const disposition = referenceDisposition(path, match[2], "runtime resource");
        if (disposition === "local") {
          assertPublishedReference(outputDir, path, match[2], "runtime resource");
        }
      }
    }
  }
}

export function assertStaticNetworkBoundary(outputDir, files) {
  assertExecutableReferences(outputDir, files);
  assertHtmlReferences(outputDir, files);
  assertCssReferences(outputDir, files);
  assertWebManifestReferences(outputDir, files);
  assertStaticNetworkSinks(outputDir, files);
}

function assertNoServerOrModelBoundary(outputDir, files) {
  const forbiddenPaths = [
    /(^|\/)android(?:\/|$)/iu,
    /(^|\/)chat(?:\.|\/)/iu,
    /(^|\/)data\/embeddings(?:\/|$)/iu,
    /(^|\/)data\/models(?:\/|$)/iu,
    /(^|\/)vendor(?:\/|$)/iu,
    /vector-db\.js$/iu,
    /\.(?:aab|apk|db|gguf|onnx|safetensors|sqlite)$/iu,
    /(^|\/)source\/features\/home\/home\.css$/iu,
    /(^|\/)source\/games\/verb-nebula\/app\.(?:css|js)$/iu,
    /(^|\/)source\/shared\/(?:chrome\.(?:css|js)|learning-profile\.js|theme\.css)$/iu,
    /(^|\/)language-runtime\/static\/styles\/course-shell\.css$/iu
  ];
  for (const path of files) {
    for (const pattern of forbiddenPaths) assert.doesNotMatch(path, pattern, `Forbidden static path: ${path}`);
  }
  const executable = files.filter((path) => [".html", ".js", ".mjs", ".css", ".webmanifest"].includes(extname(path)));
  for (const path of executable) {
    const source = readText(join(outputDir, path));
    assert.doesNotMatch(source, /(?:\bapi\/|\/android\/|esm\.run|huggingface\.co|vector-db\.js)/iu, `Server/model reference survived in ${path}`);
  }
}

function assertSetupManifest(outputDir, manifest) {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.cache_name, "caatuu-czech-setup-v1");
  assert.equal(manifest.artifacts.length, 649);
  const visual = manifest.artifacts.filter((artifact) => artifact.artifact_kind === "visual-asset");
  const keymaps = manifest.artifacts.filter((artifact) => artifact.artifact_kind === "asset-keymap");
  assert.equal(visual.length, 646);
  assert.equal(keymaps.length, 3);
  assert.ok(visual.every((artifact) => artifact.browser_required === false && artifact.native_required === false));
  assert.ok(keymaps.every((artifact) => artifact.browser_required === true && artifact.native_required === false));
  for (const artifact of manifest.artifacts) {
    const path = outputPath(outputDir, publicPathFromUrl(artifact.url, artifact.key));
    assert.ok(existsSync(path) && statSync(path).isFile(), `${artifact.key} is not published`);
    assert.equal(statSync(path).size, Number(artifact.bytes), `${artifact.key} byte mismatch`);
    assert.equal(sha256File(path), String(artifact.sha256).toLowerCase(), `${artifact.key} hash mismatch`);
  }
  for (const artifact of keymaps) {
    const path = outputPath(outputDir, publicPathFromUrl(artifact.url, artifact.key));
    const source = readText(path);
    assert.doesNotMatch(source, /"embedding"\s*:/u, `${artifact.key} retains model metadata`);
    const entries = JSON.parse(source);
    assert.equal(Object.keys(entries).length, keymapEntryCounts[artifact.key]);
    for (const assetUrl of Object.keys(entries)) {
      const assetPath = outputPath(outputDir, publicPathFromUrl(assetUrl, `${artifact.key} entry`));
      assert.ok(existsSync(assetPath) && statSync(assetPath).isFile(), `${artifact.key} points to missing ${assetUrl}`);
    }
  }
}

function assertServiceWorker(outputDir, setupManifest) {
  const source = readText(join(outputDir, "sw.js"));
  const match = /const CORE_ASSETS = (\[[\s\S]*?\]);/u.exec(source);
  assert.ok(match, "Static service worker must declare CORE_ASSETS");
  const assets = JSON.parse(match[1]);
  const expectedAssets = coreAssetPaths(outputDir, setupManifest);
  assert.deepEqual(assets, expectedAssets, "Static service worker must precache the exact reviewed core");
  const expectedDigest = sha256Bytes([`policy:${staticWorkerPolicyVersion}`, ...expectedAssets.map((asset) => {
    const path = resolveCoreAsset(outputDir, asset);
    return `${asset}\0${sha256File(path)}`;
  })].join("\n")).slice(0, 16);
  assert.match(source, new RegExp(`CACHE_NAME = "caatuu-czech-web-static-${expectedDigest}"`, "u"));
  assert.match(source, new RegExp(`WORKER_POLICY_VERSION = ${staticWorkerPolicyVersion}`, "u"));
  assert.match(source, /LEGACY_PWA_CACHE_PREFIX/u);
  assert.match(source, /caatuu_setup_sha256/u);
  assert.match(source, /ignoreSearch: true/u);
  assert.doesNotMatch(source, /\bcaches\.match\(/u, "Static worker may not fall through to legacy caches");
  assert.doesNotMatch(source, /data\/embeddings|\/android\/|\/api\//u);
  for (const asset of assets) {
    const path = resolveCoreAsset(outputDir, asset);
    assert.ok(existsSync(path) && statSync(path).isFile(), `Service worker references missing ${asset}`);
  }
}

function assertBundleManifest(outputDir) {
  const manifest = JSON.parse(readText(join(outputDir, "caatuu-web-bundle.json")));
  assert.equal(manifest.schema_name, "caatuu-web-bundle");
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.profile, webProfile.profile);
  assert.equal(manifest.basePath, "/");
  assert.equal(manifest.canonicalOrigin, "https://caatuu.waajacu.com");
  assert.deepEqual(manifest.entrypoints, ["/", "/cz/", "/cz/index.html"]);
  assert.equal(manifest.requiredSetupArtifacts, 3);
  assert.equal(manifest.publishedVisualAssets, 646);
  const inventory = inventoryFor(outputDir);
  assert.deepEqual(manifest.files, inventory, "Static bundle inventory changed");
  assert.equal(manifest.payloadFileCount, inventory.length);
  assert.equal(manifest.payloadBytes, inventory.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(manifest.payloadSha256, inventoryDigest(inventory));
  const worker = readText(join(outputDir, "sw.js"));
  const cacheName = /const CACHE_NAME = "([^"]+)";/u.exec(worker)?.[1];
  assert.equal(manifest.serviceWorkerCache, cacheName, "Bundle manifest must identify the generated worker cache");
}

function exactCzechKey(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("cs-CZ");
}

function foldedCzechKey(value) {
  return exactCzechKey(value).normalize("NFD").replace(/\p{M}/gu, "");
}

function dictionaryEntryMatchesSurface(entry, surface) {
  const key = exactCzechKey(surface);
  return [
    entry?.lemma,
    entry?.matchedTerm,
    ...(Array.isArray(entry?.forms) ? entry.forms.map((form) => form?.form) : [])
  ].some((value) => exactCzechKey(value) === key);
}

export function assertWordWorldRuntimeBoundary(outputDir) {
  const manifestPath = "cz/data/games/word-world/manifest.json";
  const manifest = JSON.parse(readText(join(outputDir, manifestPath)));
  assert.equal(manifest.schemaVersion, "caatuu-word-world-runtime-manifest-v1");
  assert.equal(manifest.mode, "standard");
  assert.equal(typeof manifest.runtimeFile, "string");
  assert.ok(manifest.runtimeFile.trim(), `${manifestPath}: runtimeFile is empty`);
  const disposition = referenceDisposition(
    manifestPath,
    manifest.runtimeFile,
    "Word World runtimeFile"
  );
  assert.equal(disposition, "local", `${manifestPath}: runtimeFile must be a published local file`);
  const recordsPath = assertPublishedReference(
    outputDir,
    manifestPath,
    manifest.runtimeFile,
    "Word World runtimeFile"
  );
  return { manifest, recordsPath };
}

function assertGameBoundary(outputDir, workspaceRoot) {
  const { manifest: wordWorldManifest, recordsPath } = assertWordWorldRuntimeBoundary(outputDir);
  const corpus = JSON.parse(readText(recordsPath));
  const records = Array.isArray(corpus.records) ? corpus.records : [];
  assert.equal(wordWorldManifest.mode, "standard");
  assert.equal(wordWorldManifest.recordCount, 792);
  assert.equal(records.length, 792);
  assert.equal(sha256File(recordsPath), wordWorldManifest.contentSha256);
  assert.deepEqual(wordWorldManifest.difficultyDistribution, { "1": 175, "2": 565, "3": 52 });
  const supplement = JSON.parse(readText(join(outputDir, "cz/data/games/word-world/static-dictionary.v1.json")));
  const dictionaryManifest = JSON.parse(readSafeText(
    join(workspaceRoot, "apps/languages/czech/static/data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json"),
    join(workspaceRoot, "apps/languages/czech/static")
  ));
  assert.equal(supplement.schema_name, "caatuu-static-word-world-dictionary");
  assert.equal(supplement.schema_version, 1);
  assert.equal(supplement.corpus_version, wordWorldManifest.corpusVersion);
  assert.equal(supplement.corpus_sha256, wordWorldManifest.contentSha256);
  assert.equal(supplement.source_dictionary?.key, dictionaryManifest.key);
  assert.equal(supplement.source_dictionary?.database_sha256, dictionaryManifest.sha256);
  assert.equal(supplement.source_dictionary?.source_sha256, dictionaryManifest.source_sha256);
  assert.equal(supplement.source_dictionary?.license, dictionaryManifest.license);
  assert.equal(supplement.source_dictionary?.attribution, "data/dictionaries/ATTRIBUTION.md");
  assert.equal(supplement.surface_count, 1277);
  assert.equal(supplement.resolved_surface_count, 1195);
  assert.equal(supplement.unresolved_surfaces?.length, 82);
  assert.equal(
    supplement.surface_count,
    supplement.resolved_surface_count + supplement.unresolved_surfaces.length,
    "Static Word World dictionary coverage counts must close"
  );
  const surfaces = new Set(records.flatMap((record) => (
    [...String(record.cs || "").normalize("NFC").matchAll(/[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)?|\d+/gu)]
      .map((match) => match[0])
  )));
  assert.equal(surfaces.size, supplement.surface_count);
  const unresolved = new Set(supplement.unresolved_surfaces);
  assert.ok([...unresolved].every((surface) => surfaces.has(surface)));
  for (const [key, entries] of Object.entries(supplement.entries || {})) {
    assert.equal(key, foldedCzechKey(key), `Static dictionary supplement key is not normalized: ${key}`);
    assert.ok(Array.isArray(entries) && entries.length > 0, `Static dictionary supplement key is empty: ${key}`);
  }
  for (const surface of surfaces) {
    if (unresolved.has(surface)) continue;
    const entries = supplement.entries?.[foldedCzechKey(surface)] || [];
    assert.ok(
      entries.some((entry) => dictionaryEntryMatchesSurface(entry, surface)),
      `Static dictionary supplement cannot resolve claimed Word World surface: ${surface}`
    );
  }
  assert.ok(Array.isArray(supplement.entries?.citim));
  assert.ok(supplement.entries.citim.some((entry) => (
    entry.lemma === "cítit"
    && entry.forms?.some((form) => form.form === "cítím")
    && entry.senses?.some((sense) => /feel/u.test(sense.gloss))
  )));
  assert.ok(existsSync(join(outputDir, "cz/data/dictionaries/ATTRIBUTION.md")));
  const wordWorld = readText(join(outputDir, "language-runtime/static/source/product-word-world.mjs"));
  assert.match(wordWorld, /contentMode: "standard"/u);
  assert.match(wordWorld, /Missing word saved on this device\./u);
  assert.doesNotMatch(wordWorld, /Missing word queued for server review/u);
  const courseProfile = readText(join(outputDir, "cz/source/shared/course-profile.js"));
  assert.match(courseProfile, /embeddings:\s*false/u);
  assert.match(courseProfile, /semanticSearch:\s*false/u);
  assert.match(courseProfile, /skillCompass:\s*false/u);
  assert.match(courseProfile, /skillCompass:\s*null/u);
  assert.doesNotMatch(courseProfile, /\/android\//u);
  const runtime = readText(join(outputDir, "cz/source/shared/runtime.js"));
  assert.match(runtime, /runtime: "static-keymap-only"/u);
  assert.match(runtime, /results: \[\]/u);
  assert.match(runtime, /dictionary:\s*\{/u);
  assert.match(runtime, /staticDictionaryRuntime\(\)\)\.download\(handlers\)/u);
  assert.match(runtime, /staticDictionaryRuntime\(\)\)\.search\(query, options\)/u);
  assert.match(runtime, /registration\.unregister\(\)/u);
  assert.doesNotMatch(runtime, /\bembed\s*\(/u);
}

export function validateStaticSite({
  workspaceRoot = defaultWorkspaceRoot,
  outputDir = defaultOutputDir
} = {}) {
  const resolvedWorkspace = resolve(workspaceRoot);
  const resolvedOutput = resolve(outputDir);
  assertSafeOutputDirectory(resolvedOutput, resolvedWorkspace);
  assert.ok(existsSync(resolvedOutput), `Static output does not exist: ${resolvedOutput}`);
  const files = allFiles(resolvedOutput);
  const setupManifest = JSON.parse(readText(join(resolvedOutput, "cz/setup-assets.json")));
  assert.deepEqual(
    setupManifest,
    expectedStaticSetupManifest(resolvedWorkspace),
    "Static setup manifest must derive exactly from the authoritative source manifest"
  );
  assert.deepEqual(files, expectedFiles(resolvedWorkspace, setupManifest), "Static output must equal the exact reviewed file set");
  const caseFolded = files.map((path) => path.toLocaleLowerCase("en-US"));
  assert.equal(new Set(caseFolded).size, caseFolded.length, "Static output contains a case-insensitive path collision");
  const totalBytes = files.reduce((sum, path) => {
    const bytes = statSync(join(resolvedOutput, path)).size;
    assert.ok(bytes <= maximumFileBytes, `${path} exceeds the static single-file limit`);
    return sum + bytes;
  }, 0);
  assert.ok(totalBytes <= maximumBundleBytes, `Static bundle exceeds ${maximumBundleBytes} bytes`);

  assertNoServerOrModelBoundary(resolvedOutput, files);
  assertSetupManifest(resolvedOutput, setupManifest);
  assertServiceWorker(resolvedOutput, setupManifest);
  assertStaticNetworkBoundary(resolvedOutput, files);
  assertGameBoundary(resolvedOutput, resolvedWorkspace);
  assertBundleManifest(resolvedOutput);

  const profile = JSON.parse(readText(join(resolvedOutput, "cz/caatuu-profile.json")));
  assert.deepEqual(profile, webProfile);
  const course = readText(join(resolvedOutput, "cz/source/shared/course-profile.js"));
  assert.match(course, /chat: false/u);
  assert.match(course, /embeddings: false/u);
  assert.match(course, /offlineModels: false/u);
  assert.match(course, /semanticSearch: false/u);
  assert.match(course, /skillCompass: false/u);
  assert.match(course, /skillCompass: null/u);
  const registry = JSON.parse(readText(join(resolvedOutput, "languages.json")));
  const czech = registry.languages.find((language) => language.id === "cz");
  assert.ok(czech?.platforms?.browser?.enabled);
  assert.equal(czech?.platforms?.android?.enabled, false);
  assert.deepEqual(czech?.platforms?.android?.channels, []);
  for (const unavailableCapability of ["embeddings", "semanticSearch", "skillCompass"]) {
    assert.ok(!czech.capabilities.includes(unavailableCapability), `static languages.json must omit ${unavailableCapability}`);
  }
  for (const [label, reference] of [
    ["flagSrc", czech.flagSrc],
    ["entryPath", czech.entryPath],
    ["browser entryPath", czech.platforms.browser.entryPath]
  ]) {
    assert.equal(
      referenceDisposition("languages.json", reference, `language ${label}`),
      "local",
      `languages.json: ${label} must be a published local file`
    );
    assertPublishedReference(resolvedOutput, "languages.json", reference, `language ${label}`);
  }
  const launcher = readText(join(resolvedOutput, "launcher.js"));
  assert.match(launcher, /registration\.unregister\(\)/u);
  assert.match(launcher, /navigator\.serviceWorker\.register\("\/sw\.js"/u);

  return {
    outputDir: resolvedOutput,
    profile: webProfile.profile,
    fileCount: files.length,
    totalBytes,
    setupRequiredBytes: setupManifest.artifacts
      .filter((artifact) => artifact.browser_required)
      .reduce((sum, artifact) => sum + Number(artifact.bytes || 0), 0)
  };
}

export function compileStaticSite({
  workspaceRoot = defaultWorkspaceRoot,
  outputDir = defaultOutputDir
} = {}) {
  const resolvedWorkspace = resolve(workspaceRoot);
  const resolvedOutput = resolve(outputDir);
  assertSafeOutputDirectory(resolvedOutput, resolvedWorkspace);
  const languageStaticDir = join(resolvedWorkspace, "apps/languages/czech/static");
  const launcherStaticDir = join(resolvedWorkspace, "apps/launcher/static");
  assert.ok(existsSync(languageStaticDir), `Czech source is missing: ${languageStaticDir}`);
  assert.ok(existsSync(launcherStaticDir), `Launcher source is missing: ${launcherStaticDir}`);
  assertStaticCompilerSources(languageStaticDir, launcherStaticDir);
  const courseConfiguration = loadAndroidCourseConfiguration({ workspaceRoot: resolvedWorkspace });

  const productTempRoot = mkdtempSync(join(tmpdir(), "caatuu-web-product-"));
  const productDir = join(productTempRoot, "product");
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  const stagingDir = mkdtempSync(join(dirname(resolvedOutput), `.${basename(resolvedOutput)}.staging-`));
  assertSafeOutputDirectory(stagingDir, resolvedWorkspace);

  try {
    compileProductAssets({
      workspaceRoot: resolvedWorkspace,
      languageStaticDir,
      launcherStaticDir,
      outputDir: productDir
    });
    copyProductOutput(productDir, stagingDir, courseConfiguration);
    transformProductOutput(resolvedWorkspace, stagingDir);
    copyLauncherSurface(resolvedWorkspace, stagingDir);
    const setupManifest = copyPublishedAssets(resolvedWorkspace, stagingDir);
    const { cacheDigest } = generateServiceWorker(stagingDir, setupManifest);
    generateBundleManifest(stagingDir, setupManifest, cacheDigest);
    const staged = validateStaticSite({ workspaceRoot: resolvedWorkspace, outputDir: stagingDir });
    replaceGeneratedOutput(stagingDir, resolvedOutput, resolvedWorkspace);
    return { ...staged, outputDir: resolvedOutput };
  } finally {
    rmSync(productTempRoot, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const options = { validateOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--validate-only") {
      options.validateOnly = true;
      continue;
    }
    const value = argv[index + 1];
    assert.ok(value && !value.startsWith("--"), `${argument} requires a value`);
    index += 1;
    if (argument === "--workspace-root") options.workspaceRoot = resolve(value);
    else if (argument === "--output") options.outputDir = resolve(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node apps/launcher/tooling/build-static-site.mjs [--output DIR] [--workspace-root DIR] [--validate-only]\n");
  } else {
    const result = options.validateOnly ? validateStaticSite(options) : compileStaticSite(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
