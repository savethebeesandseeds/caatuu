import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  generateCourseProfileObject,
  loadAndValidateCourseCatalog
} from "../../../../tools/language-packs/lib/course-contract.mjs";
import {
  ENGLISH_CONCEPT_RUNTIME_SCHEMA,
  TARGET_REALIZATION_RUNTIME_SCHEMA,
  validateEnglishConceptRuntimeProjection,
  validateTargetRealizationRuntimeProjection
} from "../../../../tools/language-content/lib/runtime-projection-contract.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const courseRoot = path.join(repoRoot, "apps/languages/mandarin-simplified");
const staticRoot = path.join(courseRoot, "static");
const runtimeStaticRoot = path.join(repoRoot, "apps/language-runtime/static");
const canonicalEntry = path.join(runtimeStaticRoot, "app/index.html");
const czechStaticRoot = path.join(repoRoot, "apps/languages/czech/static");

const SHARED_SHELL_STYLES = Object.freeze([
  "/language-runtime/static/styles/caatuu-theme.css",
  "/language-runtime/static/styles/caatuu-workspace.css",
  "/language-runtime/static/styles/caatuu-home.css",
  "/language-runtime/static/styles/caatuu-chrome.css"
]);
const SHARED_SHELL_SCRIPTS = Object.freeze([
  "/language-runtime/static/source/shell-policy.js",
  "/language-runtime/static/source/caatuu-chrome.js"
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countAssetReferences(html, attribute, assetPath) {
  const pattern = new RegExp(
    `${attribute}=["']${escapeRegExp(assetPath)}(?:\\?[^"'\\s>]*)?["']`,
    "gu"
  );
  return [...html.matchAll(pattern)].length;
}

function assertSingleAuthoritativeReference(html, attribute, assetPath, label) {
  assert.equal(
    countAssetReferences(html, attribute, assetPath),
    1,
    `${label} must reference ${assetPath} exactly once`
  );
}

function assertOrderedShellHosts(html, label) {
  const markers = [
    'class="app-shell"',
    'class="app-header"',
    'class="workspace"',
    'class="app-footer"',
    "data-caatuu-bottom-nav",
    "data-caatuu-settings-panel"
  ];
  let previous = -1;
  for (const marker of markers) {
    const index = html.indexOf(marker);
    assert.ok(index > previous, `${label} must expose the ordered shared-shell host ${marker}`);
    previous = index;
  }
}

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(courseRoot, relativePath), "utf8"));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

function resolveServedUrl(url) {
  const pathname = decodeURIComponent(new URL(url, "https://caatuu.test/zh/").pathname);
  if (["/zh/", "/zh/index.html"].includes(pathname)) return canonicalEntry;
  if (pathname.startsWith("/zh/")) {
    return path.join(staticRoot, pathname.slice("/zh/".length));
  }
  if (pathname.startsWith("/language-runtime/")) {
    return path.join(repoRoot, "apps/language-runtime", pathname.slice("/language-runtime/".length));
  }
  if (pathname.startsWith("/assets/")) {
    const relativeAsset = pathname.slice("/assets/".length);
    const sourceAsset = relativeAsset.startsWith("miscellaneous/")
      ? `visual-vocabulary/${relativeAsset.slice("miscellaneous/".length)}`
      : relativeAsset;
    return path.join(repoRoot, "apps/launcher/static/assets", sourceAsset);
  }
  throw new Error(`Unexpected served URL: ${url}`);
}

test("the compatibility course profile is generated exactly from course.json", async () => {
  const course = await json("course.json");
  const catalog = await loadAndValidateCourseCatalog({ repoRoot });
  const source = await readFile(path.join(staticRoot, "source/shared/course-profile.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "course-profile.js" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CaatuuCourse)),
    generateCourseProfileObject(course, catalog.courses)
  );
  assert.equal(context.window.CaatuuCourse.status, "development");
  assert.equal(context.window.CaatuuCourse.routePrefix, "/zh");
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.CaatuuCourse.games)), ["verb-lab", "word-net", "naturalization-nucleus"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.CaatuuCourse.upcomingGames)), ["memory-moon"]);
  assert.equal(context.window.CaatuuCourse.capabilities.verbs, false);
  assert.equal(context.window.CaatuuCourse.routes.verbNebula, "index.html?game=verb-lab");
  assert.equal(context.window.CaatuuCourse.routes.naturalizationNucleus, "index.html?game=naturalization-nucleus");
});

test("the learner projection uses its runtime schema and withholds unreviewed pronunciation", async () => {
  const authoring = await json("content/word-world/starter-v1.realizations.json");
  const projection = await json("static/data/games/word-world/starter-v1.realizations.json");
  assert.equal(projection.$schema, TARGET_REALIZATION_RUNTIME_SCHEMA);
  validateTargetRealizationRuntimeProjection(projection, {
    source: authoring,
    expectedDerivedFrom: "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json"
  });
  assert.equal(projection.review.status, "native-review-required");
  assert.equal(projection.projectionPolicy.pronunciationIncluded, false);
  assert.deepEqual(projection.review, authoring.review);
  assert.deepEqual(projection.license, authoring.license);
  assert.equal(projection.realizations.length, authoring.realizations.length);
  const sourceById = new Map(authoring.realizations.map((record) => [record.conceptId, record]));
  for (const record of projection.realizations) {
    const source = sourceById.get(record.conceptId);
    assert.ok(source, record.conceptId);
    assert.equal(record.text, source.text);
    assert.deepEqual(
      record.tokens,
      source.tokens.map(({ surface, gloss, playable }) => ({ surface, gloss, playable }))
    );
  }
  const serializedProjection = JSON.stringify(projection);
  assert.doesNotMatch(serializedProjection, /"pronunciation"\s*:/u);
  assert.doesNotMatch(serializedProjection, /"readingUnits"\s*:/u);
});

test("the shared browser English catalog is a faithful reusable projection", async () => {
  const source = JSON.parse(await readFile(
    path.join(repoRoot, "apps/languages/shared/english-concepts/word-world-starter-v1.json"),
    "utf8"
  ));
  const projection = JSON.parse(await readFile(
    path.join(repoRoot, "apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json"),
    "utf8"
  ));
  assert.equal(projection.$schema, ENGLISH_CONCEPT_RUNTIME_SCHEMA);
  validateEnglishConceptRuntimeProjection(projection, {
    source,
    expectedDerivedFrom: "apps/languages/shared/english-concepts/word-world-starter-v1.json"
  });
  assert.deepEqual(projection.embeddingPolicy, {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false
  });
});

test("setup and service-worker catalogs cover every required offline URL", async () => {
  const setup = await json("static/setup-assets.json");
  const [courseWorker, czechWorker, sharedWorker] = await Promise.all([
    readFile(path.join(staticRoot, "sw.js"), "utf8"),
    readFile(path.join(czechStaticRoot, "sw.js"), "utf8"),
    readFile(
      path.join(repoRoot, "apps/language-runtime/static/source/course-service-worker.js"),
      "utf8"
    )
  ]);
  assert.equal(setup.courseId, "zh");
  assert.deepEqual(setup.application, {
    entryPath: "/zh/index.html",
    appEntry: "apps/language-runtime/static/app/index.html"
  });
  assert.equal(setup.offline.cacheName, "caatuu-zh-hans-pwa-v51");
  assert.match(courseWorker, /Offline catalog revision: caatuu-zh-hans-pwa-v51/u);
  assert.match(czechWorker, /Offline catalog revision: caatuu-czech-pwa-v571/u);
  const withoutRevision = (source) => source.replace(/^\/\/ Offline catalog revision: .+\r?\n/mu, "");
  assert.equal(withoutRevision(courseWorker), withoutRevision(czechWorker));
  assert.match(
    courseWorker,
    /importScripts\("\/language-runtime\/static\/source\/course-service-worker\.js"\)/u
  );
  for (const artifact of setup.artifacts) {
    await access(resolveServedUrl(artifact.url));
  }
  for (const asset of setup.offline.assets) await access(resolveServedUrl(asset));
  assert.doesNotMatch(JSON.stringify(setup), /word-world\.html/u);
  assert.doesNotMatch(JSON.stringify(setup), /authored-word-world-provider/u);
  for (const asset of [
    "/language-runtime/static/source/caatuu-workspace.js?v=workspace-6",
    "/language-runtime/static/source/maintenance-ui.js?v=maintenance-17",
    "/language-runtime/static/source/child-facing-assets.mjs?v=child-facing-assets-2",
    "/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs?v=verb-nebula-core-11",
    "/language-runtime/static/source/games/verb-nebula/verb-exercise-family-core.mjs?v=verb-exercise-family-core-3",
    "/language-runtime/static/source/word-world-host.mjs?v=word-world-host-9",
    "/language-runtime/static/source/word-world-provider.mjs?v=word-world-provider-13",
    "/language-runtime/static/source/product-word-world.mjs?v=shared-renderer-13",
    "/language-runtime/static/source/word-net-core.mjs?v=word-net-core-21",
    "/language-runtime/static/source/word-net-queue.mjs?v=word-net-queue-6",
  ]) assert.ok(setup.offline.assets.includes(asset), `offline course must cache ${asset}`);
  for (const asset of [
    "data/games/naturalization-nucleus/challenges.json",
    "source/games/naturalization-nucleus/naturalization-nucleus.css?v=naturalization-nucleus-11",
    "source/games/naturalization-nucleus/naturalization-nucleus.js?v=naturalization-nucleus-11",
    "/assets/planets/naturalization-nucleus.png"
  ]) assert.ok(setup.offline.assets.includes(asset), `offline course must cache ${asset}`);
  assert.ok(setup.offline.assets.includes("data/games/word-world/starter-v1.reading-guides.json"));
  assert.ok(!setup.offline.assets.some((asset) => asset.includes("product-shell.mjs")));
  assert.match(sharedWorker, /application\?\.appEntry !== CAATUU_CANONICAL_APP_ENTRY/u);
  assert.match(sharedWorker, /Deprecated mini-app documents cannot be cached/u);
  assert.match(sharedWorker, /Retired runtime assets cannot be cached/u);
});

test("Word World and embedding manifests declare the English-only shared MiniLM path", async () => {
  const wordWorld = await json("static/data/games/word-world/manifest.json");
  const embeddings = await json("static/data/embeddings/catalog.json");
  const sharedRuntimes = JSON.parse(await readFile(
    path.join(repoRoot, "apps/language-runtime/embedding-runtimes.json"),
    "utf8"
  ));
  assert.equal(wordWorld.recordCount, 250);
  assert.equal(wordWorld.capabilities.llm, false);
  assert.equal(wordWorld.capabilities.generation, false);
  assert.equal(wordWorld.capabilities.chat, false);
  assert.equal(wordWorld.capabilities.dictionary, false);
  assert.equal(wordWorld.capabilities.pronunciationGuides, false);
  assert.equal(wordWorld.review.status, "native-review-required");
  assert.deepEqual(wordWorld.embeddingPolicy, {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false,
    modelId: "all-minilm-l6-v2-qint8-v0.1",
    fallback: "deterministic-lexical"
  });
  assert.equal(embeddings.runtime.modelRequired, true);
  assert.equal(embeddings.runtime.defaultModelId, "all-minilm-l6-v2-qint8-v0.1");
  assert.equal(embeddings.runtime.rankerModule, "/language-runtime/static/source/english-minilm-ranker.mjs");
  assert.equal(embeddings.runtime.sharedCatalog, "/language-runtime/embedding-runtimes.json");
  assert.equal(embeddings.runtime.modelDelivery, "browser-on-demand");
  assert.equal(embeddings.runtime.modelPrecached, false);
  assert.equal(embeddings.runtime.androidPackaged, false);
  assert.equal(embeddings.runtime.fallback, "deterministic-lexical");
  assert.equal("models" in embeddings, false, "course catalogs must select rather than duplicate shared runtimes");
  const sharedModel = sharedRuntimes.runtimes.find(({ id }) => id === embeddings.runtime.defaultModelId);
  assert.equal(sharedModel.inputLanguage, "en");
  assert.equal(sharedModel.embedding.dimension, 384);
  assert.equal(sharedModel.runtime.modelId, "all-minilm-l6-v2-qint8-v0.1/runtime");
  assert.equal(sharedModel.runtime.modelFileName, "model_qint8_arm64");
  assert.equal(embeddings.thirdPartyNotices.length, 3);
  const appSource = await readFile(path.join(runtimeStaticRoot, "source/word-world-provider.mjs"), "utf8");
  assert.match(appSource, /return createRanker\(model\.runtime\)/u);
  assert.match(appSource, /selectEmbeddingRuntime/u);
  assert.match(appSource, /course,/u);
  assert.match(appSource, /policy\.inputLanguage !== "en"/u);
  assert.doesNotMatch(appSource, /(?:zh-hans|mandarin-simplified|course\.id\s*[!=]==?)/iu);
});

test("the canonical page has no inline executable code while development noindex is course-driven", async () => {
  const [html, bootstrap, course] = await Promise.all([
    readFile(canonicalEntry, "utf8"),
    readFile(path.join(runtimeStaticRoot, "source/app-bootstrap.mjs"), "utf8"),
    json("course.json")
  ]);
  assert.doesNotMatch(html, /<script>(?:.|\n)*?<\/script>/u);
  assert.match(bootstrap, /course\.status !== "active"/u);
  assert.match(bootstrap, /robots\.content = "noindex, nofollow"/u);
  assert.equal(course.status, "development");
});

test("Czech and Mandarin resolve one authoritative Caatuu document and bootstrap", async () => {
  const [czech, mandarin, html] = await Promise.all([
    JSON.parse(await readFile(path.join(repoRoot, "apps/languages/czech/course.json"), "utf8")),
    json("course.json"),
    readFile(canonicalEntry, "utf8")
  ]);
  assert.deepEqual(czech.resources.appEntry, mandarin.resources.appEntry);
  assert.equal(czech.resources.appEntry.path, "apps/language-runtime/static/app/index.html");
  assert.equal(await access(path.join(repoRoot, "apps/languages/czech/static/index.html")).then(() => false, () => true), true);
  assert.equal(await access(path.join(staticRoot, "index.html")).then(() => false, () => true), true);
  for (const style of SHARED_SHELL_STYLES) assertSingleAuthoritativeReference(html, "href", style, "canonical app");
  for (const script of SHARED_SHELL_SCRIPTS) assertSingleAuthoritativeReference(html, "src", script, "canonical app");
  assertSingleAuthoritativeReference(html, "src", "/language-runtime/static/source/app-bootstrap.mjs", "canonical app");
  assertOrderedShellHosts(html, "canonical app");
});

test("Mandarin removes the mini-app and mounts Word World through the authoritative workspace and host", async () => {
  const [home, workspaceSource, hostSource, providerSource, setup, serviceWorker, androidAssets] = await Promise.all([
    readFile(canonicalEntry, "utf8"),
    readFile(path.join(runtimeStaticRoot, "source/caatuu-workspace.js"), "utf8"),
    readFile(path.join(runtimeStaticRoot, "source/word-world-host.mjs"), "utf8"),
    readFile(path.join(runtimeStaticRoot, "source/word-world-provider.mjs"), "utf8"),
    json("static/setup-assets.json"),
    readFile(path.join(staticRoot, "sw.js"), "utf8"),
    json("android-assets.json")
  ]);

  for (const [label, source] of [
    ["home", home],
    ["shared workspace", workspaceSource],
    ["shared Word World host", hostSource],
    ["shared Word World provider", providerSource],
    ["setup catalog", JSON.stringify(setup)],
    ["service worker", serviceWorker],
    ["Android allowlist", JSON.stringify(androidAssets)]
  ]) {
    assert.doesNotMatch(
      source,
      /(?:site-header|course-main|preview-card-grid|course-shell\.css)/u,
      `${label} must not retain the deprecated Mandarin mini-app boundary`
    );
  }

  assert.match(home, /class="app-shell"/u);
  assert.match(workspaceSource, /CaatuuWordWorldHost/u);
  assert.match(hostSource, /import\("\.\/word-world-provider\.mjs\?v=word-world-provider-13"\)/u);
  assert.match(providerSource, /prepareWordWorldContext\(/u);
  assert.match(providerSource, /return mountRenderer\(root, context, \{/u);
  assert.doesNotMatch(JSON.stringify(setup), /authored-word-world-provider/u);
  assert.equal(await access(path.join(staticRoot, "word-world.html")).then(() => false, () => true), true);
  assert.equal(await access(path.join(staticRoot, "source/app.mjs")).then(() => false, () => true), true);
});

test("Android allowlists remain narrow and point only to present course/shared files", async () => {
  const [catalog, appAssets] = await Promise.all([
    json("android-assets.json"),
    readFile(path.join(repoRoot, "apps/language-runtime/app-assets.json"), "utf8").then(JSON.parse)
  ]);
  assert.equal(catalog.enabled, undefined);
  assert.deepEqual(catalog.nativeProviders.providers, {
    embeddings: {
      implementation: "webview-english-minilm-v1",
      resource: "embeddingCatalog"
    },
    speech: {
      implementation: "android-text-to-speech-v1",
      localeSource: "targetLanguage.speechLocale"
    }
  });
  assert.equal(catalog.policy.llmAssetsAllowed, false);
  assert.equal(catalog.policy.targetPronunciationMetadataAllowed, true);
  assert.ok(catalog.files.includes("data/games/word-world/starter-v1.reading-guides.json"));
  for (const file of catalog.files) await access(path.join(staticRoot, file));
  assert.equal(appAssets.schemaVersion, 1);
  assert.equal(appAssets.appEntry, "apps/language-runtime/static/app/index.html");
  for (const asset of appAssets.assets) {
    await access(path.join(repoRoot, asset.source));
  }
  assert.ok(appAssets.assets.some(({ output }) => output === "language-runtime/static/source/english-minilm-ranker.mjs"));
  assert.doesNotMatch(JSON.stringify(catalog), /(?:model_qint8|ort-wasm|transformers\.min\.js)/u);
  for (const file of catalog.launcherIconFiles) {
    await access(path.join(repoRoot, "apps/launcher/static/assets/icons", file));
  }
});

test("fresh course files have no deprecated Chinese archive dependency", async () => {
  const files = [
    ...await collectFiles(staticRoot),
    ...await collectFiles(path.join(repoRoot, "apps/language-runtime/static"))
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /(?:\/archive\/chinese|apps\/archive\/chinese|archive\\chinese)/iu, file);
  }
});
