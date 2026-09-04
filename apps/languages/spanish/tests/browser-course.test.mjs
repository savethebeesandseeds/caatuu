import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  acceptedAnswerVariants,
  languageAnswerKey,
  languageSearchKey,
  learnerDisplay,
  learnerPronunciation,
  prepareSpeechOutput,
  presentDictionaryEntry,
  segmentLanguageText,
  speechOutputConfig
} from "../../../language-runtime/contract.mjs";
import { importBrowserLanguageAdapter } from "../../../language-runtime/tests/browser-module-loader.mjs";
import {
  generateCourseProfileObject,
  loadAndValidateCourseCatalog
} from "../../../../tools/language-packs/lib/course-contract.mjs";
import {
  TARGET_REALIZATION_RUNTIME_SCHEMA,
  validateTargetRealizationRuntimeProjection
} from "../../../../tools/language-content/lib/runtime-projection-contract.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const courseRoot = path.join(repoRoot, "apps/languages/spanish");
const staticRoot = path.join(courseRoot, "static");
const canonicalEntry = path.join(repoRoot, "apps/language-runtime/static/app/index.html");
const adapter = await importBrowserLanguageAdapter(
  new URL("../static/source/language/adapter.mjs", import.meta.url)
);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(courseRoot, relativePath), "utf8"));
}

async function missing(relativePath) {
  return access(path.join(staticRoot, relativePath)).then(() => false, () => true);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveServedUrl(url) {
  const pathname = decodeURIComponent(new URL(url, "https://caatuu.test/es/").pathname);
  if (["/es/", "/es/index.html"].includes(pathname)) return canonicalEntry;
  if (pathname.startsWith("/es/")) return path.join(staticRoot, pathname.slice("/es/".length));
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

test("Spanish is a development course projected into the one shared browser app", async () => {
  const course = await json("course.json");
  assert.equal(course.id, "es");
  assert.equal(course.status, "development");
  assert.equal(course.routePrefix, "/es");
  assert.equal(course.entryPath, "/es/index.html");
  assert.equal(course.sourceLanguage.id, "en");
  assert.equal(course.targetLanguage.locale, "es-ES");
  assert.equal(course.targetLanguage.script, "Latn");
  assert.deepEqual(course.games, [
    "verb-lab",
    "word-net",
    "conjugation-comet",
    "agreement-aurora"
  ]);
  assert.deepEqual(course.upcomingGames, ["memory-moon", "sound-quasar"]);
  assert.deepEqual(course.linguisticFeatures, ["verb-conjugation", "grammatical-agreement"]);
  assert.equal(course.platforms.browser.enabled, true);
  assert.equal(course.platforms.android.enabled, false);
  assert.equal(course.resources.appEntry.path, "apps/language-runtime/static/app/index.html");
  assert.equal(
    course.routes.conjugationComet,
    "/language-runtime/static/games/conjugation-comet.html"
  );
  assert.equal(
    course.routes.agreementAurora,
    "/language-runtime/static/games/agreement-aurora.html"
  );
  assert.equal(await missing("index.html"), true, "a course must not fork the canonical app document");
  assert.equal(await missing("source/app.mjs"), true, "a course must not grow a private app shell");
  assert.equal(await missing("word-world.html"), true, "a course must not grow a private Word World document");
  assert.equal(await missing("conjugation-comet.html"), true, "a course must not fork the shared Conjugation Comet host");
  assert.equal(await missing("agreement-aurora.html"), true, "a course must not fork the shared Agreement Aurora host");
  const html = await readFile(canonicalEntry, "utf8");
  assert.match(html, /class="app-shell"/u);
  assert.match(html, /\/language-runtime\/static\/source\/app-bootstrap\.mjs/u);
});

test("Spanish identity and unavailable systems fail closed in the course contract", async () => {
  const course = await json("course.json");
  assert.deepEqual(course.capabilities, {
    llm: false,
    generation: false,
    chat: false,
    embeddings: true,
    semanticSearch: true,
    skillCompass: false,
    dictionary: false,
    memory: false,
    verbs: false,
    wordWorld: true,
    conjugationComet: true,
    offlineModels: false,
    speech: true,
    pronunciationGuides: false
  });
  assert.equal(course.skillCompass, null);
  assert.equal(course.publication.contract, "language-content-v1");
  assert.equal(course.publication.runtimeProjection.policyId, "spanish-spain-word-world-v1");
  assert.equal(course.publication.learnerBaseRealizations, null);
  assert.deepEqual(course.publication.runtimeProjection.supplementalOutputs, {});
});

test("the generated compatibility profile is exactly the catalog projection", async () => {
  const course = await json("course.json");
  const catalog = await loadAndValidateCourseCatalog({ repoRoot });
  const source = await readFile(path.join(staticRoot, "source/shared/course-profile.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "course-profile.js" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CaatuuCourse)),
    generateCourseProfileObject(course, catalog.courses)
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CaatuuCourse.gameContent)),
    {
      "verb-lab": {
        verbNebulaCatalog: "data/games/verb-nebula/core-vocabulary.json"
      },
      "word-net": {
        wordWorldManifest: "data/games/word-world/manifest.json"
      },
      "conjugation-comet": {
        conjugationCometCatalog: "data/games/conjugation-comet/verbs.json?v=conjugation-comet-content-1"
      },
      "agreement-aurora": {
        agreementAuroraCatalog: "data/games/agreement-aurora/challenges.json?v=agreement-aurora-content-1"
      }
    }
  );
});

test("the Spanish adapter folds search accents, preserves answer accents, and segments Spanish punctuation", () => {
  assert.equal(adapter.id, "spanish-spain");
  assert.equal(adapter.languageTags.locale, "es-ES");
  assert.equal(adapter.speech.output.languageTag, "es-ES");
  assert.equal(adapter.normalization.text("si\u0301"), "sí");
  assert.equal(languageSearchKey(adapter, "  PINGÜINO  "), "pinguino");
  assert.equal(languageSearchKey(adapter, "SÍ"), "si");
  assert.notEqual(languageAnswerKey(adapter, "sí"), languageAnswerKey(adapter, "si"));
  assert.notEqual(languageAnswerKey(adapter, "tú"), languageAnswerKey(adapter, "tu"));
  assert.deepEqual(segmentLanguageText(adapter, "¿Dónde está el pingüino?"), [
    { type: "punctuation", text: "¿" },
    { type: "word", text: "Dónde" },
    { type: "word", text: "está" },
    { type: "word", text: "el" },
    { type: "word", text: "pingüino" },
    { type: "punctuation", text: "?" }
  ]);
  assert.deepEqual(learnerDisplay(adapter, "¡Buenos días!"), {
    text: "¡Buenos días!",
    languageTag: "es-ES",
    direction: "ltr"
  });
  assert.equal(learnerPronunciation(adapter, "hola"), null);
  assert.deepEqual(acceptedAnswerVariants(adapter, {
    text: "el ordenador",
    acceptedAnswers: ["un ordenador"]
  }), ["el ordenador", "un ordenador"]);
});

test("Spanish speech and dictionary presentation stay at explicit adapter boundaries", () => {
  assert.deepEqual(speechOutputConfig(adapter, { difficulty: 1 }), {
    languageTag: "es-ES",
    rate: 0.55,
    pitch: 1,
    voice: "",
    pace: "slower",
    paceLabel: "Slower",
    maxCharacters: 1000
  });
  assert.equal(prepareSpeechOutput(adapter, "¿Dónde está?"), "¿Dónde está?");
  assert.deepEqual(presentDictionaryEntry(adapter, {
    target: "libro",
    source: "book",
    kind: "noun",
    category: "objects"
  }, { sourceLanguageId: "en" }), {
    targetText: "libro",
    englishAuditText: "book",
    category: "objects",
    partOfSpeech: "noun",
    exampleTargetText: "",
    usageNote: ""
  });
});

test("Word World and embeddings keep English as the sole retrieval authority", async () => {
  const [manifest, embeddings] = await Promise.all([
    json("static/data/games/word-world/manifest.json"),
    json("static/data/embeddings/catalog.json")
  ]);
  assert.equal(manifest.courseId, "es");
  assert.equal(manifest.targetLanguage, "es-ES");
  assert.equal(manifest.mediationLanguage, "en");
  assert.equal(manifest.sessionProvider.kind, "authored-realizations");
  assert.equal(manifest.review.status, "native-review-required");
  assert.equal(manifest.review.pronunciationApproved, false);
  assert.equal(manifest.license.status, "release-review-required");
  assert.deepEqual(manifest.embeddingPolicy, {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false,
    modelId: "all-minilm-l6-v2-qint8-v0.1",
    fallback: "deterministic-lexical"
  });
  assert.deepEqual(embeddings.embeddingPolicy, {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false,
    targetPronunciationAllowed: false
  });
  assert.equal(embeddings.courseId, "es");
  assert.equal(embeddings.runtime.sharedCatalog, "/language-runtime/embedding-runtimes.json");
  assert.equal(embeddings.runtime.defaultModelId, "all-minilm-l6-v2-qint8-v0.1");
  assert.equal(embeddings.runtime.modelPrecached, false);
  assert.equal(embeddings.runtime.androidPackaged, false);
  assert.equal("models" in embeddings, false);
  assert.doesNotMatch(JSON.stringify({ manifest, embeddings }), /(?:Czech|Mandarin|cs-CZ|zh-Hans)/u);
});

test("the projected Spanish realization catalog remains a faithful narrow view", async () => {
  const [source, projection, manifest] = await Promise.all([
    json("content/word-world/starter-v1.realizations.json"),
    json("static/data/games/word-world/starter-v1.realizations.json"),
    json("static/data/games/word-world/manifest.json")
  ]);
  assert.equal(projection.$schema, TARGET_REALIZATION_RUNTIME_SCHEMA);
  validateTargetRealizationRuntimeProjection(projection, {
    source,
    expectedDerivedFrom: "apps/languages/spanish/content/word-world/starter-v1.realizations.json"
  });
  assert.equal(projection.realizations.length, source.realizations.length);
  assert.equal(manifest.recordCount, projection.realizations.length);
  assert.deepEqual(projection.review, source.review);
  assert.deepEqual(projection.license, source.license);
  assert.doesNotMatch(JSON.stringify(projection), /"pronunciation"\s*:/u);
});

test("Verb Nebula has course-owned Spanish text and explicit English audit text", async () => {
  const records = await json("static/data/games/verb-nebula/core-vocabulary.json");
  assert.ok(Array.isArray(records) && records.length > 0);
  assert.equal(new Set(records.map(({ id }) => id)).size, records.length);
  for (const record of records) {
    assert.match(record.id, /^es\./u);
    assert.equal(typeof record.target, "string");
    assert.ok(record.target.trim());
    assert.equal(typeof record.source, "string");
    assert.ok(record.source.trim(), `${record.id} is missing its English audit text`);
  }
});

test("setup and the service worker declare one complete Spanish offline closure", async () => {
  const [setup, worker] = await Promise.all([
    json("static/setup-assets.json"),
    readFile(path.join(staticRoot, "sw.js"), "utf8")
  ]);
  assert.equal(setup.courseId, "es");
  assert.deepEqual(setup.application, {
    entryPath: "/es/index.html",
    appEntry: "apps/language-runtime/static/app/index.html"
  });
  assert.equal(setup.offline.cacheName, "caatuu-es-pwa-v9");
  assert.equal(setup.offline.cachePrefix, "caatuu-es-pwa-");
  assert.match(worker, /Offline catalog revision: caatuu-es-pwa-v9/u);
  assert.match(worker, /importScripts\("\/language-runtime\/static\/source\/course-service-worker\.js"\)/u);
  for (const asset of [
    "source/shared/course-profile.js?v=course-32",
    "source/language/adapter.mjs",
    "data/embeddings/catalog.json",
    "data/games/verb-nebula/core-vocabulary.json",
    "data/games/word-world/manifest.json",
    "data/games/word-world/starter-v1.realizations.json",
    "data/games/conjugation-comet/verbs.json?v=conjugation-comet-content-1",
    "data/games/agreement-aurora/challenges.json?v=agreement-aurora-content-1",
    "/language-runtime/static/games/conjugation-comet.html",
    "/language-runtime/static/games/agreement-aurora.html",
    "/language-runtime/static/source/games/course-game-content.mjs?v=course-game-content-1",
    "/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs?v=conjugation-comet-core-2",
    "/language-runtime/static/source/games/conjugation-comet/conjugation-comet-host.mjs?v=conjugation-comet-shared-2",
    "/language-runtime/static/source/games/agreement-aurora/agreement-aurora-core.mjs?v=agreement-aurora-core-2",
    "/language-runtime/static/source/games/agreement-aurora/agreement-aurora-host.mjs?v=agreement-aurora-shared-2",
    "/language-runtime/static/styles/games/conjugation-comet.css?v=conjugation-comet-shared-1",
    "/language-runtime/static/styles/games/agreement-aurora.css?v=agreement-aurora-shared-1",
    "/language-runtime/static/source/product-word-world.mjs?v=shared-renderer-17",
    "/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
    "/assets/icons/czech_flag_ui.png",
    "/assets/icons/china_flag.png",
    "/assets/icons/spain_flag.png",
    "/assets/icons/english_flag.png"
  ]) assert.ok(setup.offline.assets.includes(asset), `Spanish offline closure is missing ${asset}`);
  assert.doesNotMatch(JSON.stringify(setup), /(?:word-world\.html|authored-word-world-provider|course-shell\.css)/u);
  assert.equal(new Set(setup.artifacts.map(({ key }) => key)).size, setup.artifacts.length);
  for (const artifact of setup.artifacts) {
    const sourcePath = resolveServedUrl(artifact.url);
    const bytes = await readFile(sourcePath);
    assert.equal(artifact.bytes, bytes.length, `${artifact.key} byte count drifted`);
    assert.equal(artifact.sha256, sha256(bytes), `${artifact.key} digest drifted`);
  }
});

test("the web manifest owns only Spanish identity and shared-app routes", async () => {
  const manifest = await json("static/manifest.webmanifest");
  assert.equal(manifest.id, "/es/");
  assert.equal(manifest.start_url, "/es/index.html");
  assert.equal(manifest.scope, "/es/");
  assert.equal(manifest.lang, "en");
  assert.equal(manifest.icons[0].src, "/assets/icons/spain_flag.png");
  assert.deepEqual(manifest.shortcuts.map(({ url }) => url), [
    "/es/index.html?game=verb-lab",
    "/es/index.html?game=word-net"
  ]);
});
