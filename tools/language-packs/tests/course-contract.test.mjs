import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  authoredGrammarPromotionIssues,
  browserCourseGameContentClosureIssues,
  browserLanguageAdapterIdentityIssues,
  browserBackendContractIssues,
  browserSetupCacheNamespaceIssues,
  browserSharedRuntimeClosureIssues,
  checkGeneratedViews,
  CourseContractError,
  courseLanguagePairIdentity,
  generateCourseSelectorAssetMappings,
  generateCourseProfileObject,
  generateCourseProfileSource,
  generateLauncherRegistry,
  learnerSourceDeliveryClosureIssues,
  learnerSourceReadinessIssues,
  loadCourseCatalog,
  sourceLanguagePresentationIssues,
  validateCourseCatalog,
  wordWorldGenerationReadinessIssues,
  wordWorldProjectionDeliveryClosureIssues
} from "../lib/course-contract.mjs";
import {
  validateConjugationCometCatalog
} from "../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import {
  normalizeAgreementAuroraPack
} from "../../../apps/language-runtime/static/source/games/agreement-aurora/agreement-aurora-core.mjs";
import {
  GAME_IDS,
  LEARNER_BASE_PRESENTATION_CONTRACT,
  NON_CAMPAIGN_GAME_IDS,
  PLANET_GAME_CONTRACT
} from "../../../apps/language-runtime/static/source/shell-policy.mjs";

const repoRoot = new URL("../../../", import.meta.url);

function cloneLoaded(loaded) {
  return structuredClone(loaded);
}

function hasIssue(error, code, messagePattern) {
  return error instanceof CourseContractError && error.issues.some((issue) => (
    issue.code === code && (!messagePattern || messagePattern.test(issue.message))
  ));
}

async function assertFixtureFails(loaded, fixture) {
  const candidate = cloneLoaded(loaded);
  fixture.mutate(candidate);
  await assert.rejects(
    validateCourseCatalog(candidate, { checkExistence: fixture.checkExistence ?? false }),
    (error) => hasIssue(error, fixture.code, fixture.message),
    fixture.name
  );
}

const loaded = await loadCourseCatalog({ repoRoot });
const czechWordWorldRuntimeManifest = JSON.parse(await readFile(
  new URL("../../../apps/languages/czech/static/data/games/word-world/manifest.json", import.meta.url),
  "utf8"
));

test("every browser adapter is canonically present and bound to its course target", async () => {
  for (const record of loaded.courses.filter(({ course }) => course.platforms.browser.enabled)) {
    assert.deepEqual(
      await browserLanguageAdapterIdentityIssues(record, repoRoot),
      [],
      record.course.id
    );
  }
});

test("a canonically present but valid adapter for another target is rejected", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-adapter-identity-"));
  try {
    const relativeStaticRoot = "apps/languages/fixture/static";
    const relativeAdapter = `${relativeStaticRoot}/source/language/adapter.mjs`;
    const adapterFile = path.join(temporaryRoot, ...relativeAdapter.split("/"));
    await mkdir(path.dirname(adapterFile), { recursive: true });
    await writeFile(
      adapterFile,
      await readFile(
        new URL("../../../apps/languages/czech/static/source/language/adapter.mjs", import.meta.url),
        "utf8"
      ),
      "utf8"
    );

    const record = {
      manifestPath: "apps/languages/fixture/course.json",
      course: {
        id: "fixture",
        platforms: { browser: { enabled: true } },
        targetLanguage: structuredClone(
          loaded.courses.find(({ course }) => course.id === "zh").course.targetLanguage
        ),
        resources: {
          staticRoot: {
            kind: "directory",
            path: relativeStaticRoot,
            scope: "course",
            state: "present"
          },
          languageAdapter: {
            kind: "file",
            path: relativeAdapter,
            scope: "course",
            state: "present"
          }
        }
      }
    };

    assert.deepEqual(
      (await browserLanguageAdapterIdentityIssues(record, temporaryRoot)).map(({ code }) => code),
      ["content.language-adapter"]
    );
    record.course.targetLanguage = structuredClone(
      loaded.courses.find(({ course }) => course.id === "cz").course.targetLanguage
    );
    assert.deepEqual(await browserLanguageAdapterIdentityIssues(record, temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("declared browser providers are confined, revisioned course modules", async () => {
  const invalid = cloneLoaded(loaded);
  delete invalid.courses.find(({ course }) => course.id === "cz")
    .course.resources.courseRuntime.revision;
  await assert.rejects(
    validateCourseCatalog(invalid, { checkExistence: false }),
    (error) => hasIssue(error, "browser.provider", /courseRuntime.*revisioned course JavaScript/u)
  );
});

test("browser shared runtime delivery requires one canonical offline pathname per mapping", () => {
  const appAssetCatalog = {
    assets: [
      {
        source: "apps/language-runtime/static/source/shared-runtime.mjs",
        output: "language-runtime/static/source/shared-runtime.mjs"
      },
      {
        source: "apps/language-runtime/static/source/course-service-worker.js",
        output: "language-runtime/static/source/course-service-worker.js"
      }
    ]
  };
  const setupCatalog = {
    offline: {
      assets: ["/language-runtime/static/source/shared-runtime.mjs?v=runtime-1"]
    }
  };

  assert.deepEqual(browserSharedRuntimeClosureIssues({
    appAssetCatalog,
    setupCatalog,
    courseId: "xx",
    routePrefix: "/xx"
  }), []);

  assert.match(
    browserSharedRuntimeClosureIssues({
      appAssetCatalog,
      setupCatalog: { offline: { assets: [] } },
      courseId: "xx",
      routePrefix: "/xx"
    })[0].message,
    /omit shared runtime pathname/
  );
  assert.match(
    browserSharedRuntimeClosureIssues({
      appAssetCatalog,
      setupCatalog: {
        offline: {
          assets: [
            "/language-runtime/static/source/shared-runtime.mjs?v=runtime-1",
            "/language-runtime/static/source/shared-runtime.mjs?v=runtime-2"
          ]
        }
      },
      courseId: "xx",
      routePrefix: "/xx"
    })[0].message,
    /repeat shared runtime pathname .* 2 times/
  );

  const remapped = structuredClone(appAssetCatalog);
  remapped.assets[0].output = "language-runtime/static/source/renamed-runtime.mjs";
  assert.match(
    browserSharedRuntimeClosureIssues({
      appAssetCatalog: remapped,
      setupCatalog,
      courseId: "xx",
      routePrefix: "/xx"
    })[0].message,
    /is remapped to language-runtime\/static\/source\/renamed-runtime\.mjs/
  );
});

test("enabled games cache their exact revisioned course-content URLs", async () => {
  const spanish = loaded.courses.find(({ course }) => course.id === "es").course;
  const setupCatalog = JSON.parse(await readFile(
    new URL("../../../apps/languages/spanish/static/setup-assets.json", import.meta.url),
    "utf8"
  ));
  assert.deepEqual(
    browserCourseGameContentClosureIssues({ course: spanish, setupCatalog }),
    []
  );

  const missing = structuredClone(setupCatalog);
  missing.offline.assets = missing.offline.assets.filter(
    (asset) => asset !== "data/games/conjugation-comet/verbs.json?v=conjugation-comet-content-1"
  );
  assert.match(
    browserCourseGameContentClosureIssues({ course: spanish, setupCatalog: missing })[0].message,
    /omit the exact conjugation-comet\.conjugationCometCatalog URL \/es\/data\/games\/conjugation-comet\/verbs\.json\?v=conjugation-comet-content-1/u
  );

  const stale = structuredClone(setupCatalog);
  stale.offline.assets = stale.offline.assets.map((asset) => (
    asset === "data/games/agreement-aurora/challenges.json?v=agreement-aurora-content-1"
      ? "data/games/agreement-aurora/challenges.json?v=stale"
      : asset
  ));
  assert.match(
    browserCourseGameContentClosureIssues({ course: spanish, setupCatalog: stale })[0].message,
    /agreement-aurora-content-1/u
  );

  const repeated = structuredClone(setupCatalog);
  repeated.offline.assets.push(
    "./data/games/agreement-aurora/challenges.json?v=agreement-aurora-content-1"
  );
  assert.match(
    browserCourseGameContentClosureIssues({ course: spanish, setupCatalog: repeated })[0].message,
    /repeat the exact agreement-aurora\.agreementAuroraCatalog URL .* 2 times/u
  );
});

test("browser setup caches are confined to the exact course cache namespace", async () => {
  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  const mandarin = loaded.courses.find(({ course }) => course.id === "zh").course;
  const copiedSetup = {
    offline: {
      cachePrefix: czech.cache.prefix,
      cacheName: `${czech.cache.prefix}v999`
    }
  };
  assert.deepEqual(
    browserSetupCacheNamespaceIssues({ course: mandarin, setupCatalog: copiedSetup })
      .map(({ code }) => code),
    ["browser.cache-namespace", "browser.cache-namespace"]
  );

  const mismatchedAuthority = cloneLoaded(loaded);
  mismatchedAuthority.courses.find(({ course }) => course.id === "zh")
    .course.cache.prefix = "caatuu-zh-hans-next-pwa-";
  await assert.rejects(
    validateCourseCatalog(mismatchedAuthority, { checkExistence: true }),
    (error) => hasIssue(
      error,
      "browser.cache-namespace",
      /zh setup offline\.cachePrefix .* must exactly match course\.cache\.prefix/
    )
  );
});

test("course selector assets follow the same browser-course projection", () => {
  assert.deepEqual(generateCourseSelectorAssetMappings(loaded.courses), [
    {
      courseId: "cz",
      url: "/assets/icons/english_flag.png",
      source: "apps/launcher/static/assets/icons/english_flag.png",
      output: "assets/icons/english_flag.png"
    },
    {
      courseId: "cz",
      url: "/assets/icons/czech_flag_ui.png",
      source: "apps/launcher/static/assets/icons/czech_flag_ui.png",
      output: "assets/icons/czech_flag_ui.png"
    },
    {
      courseId: "zh",
      url: "/assets/icons/china_flag.png",
      source: "apps/launcher/static/assets/icons/china_flag.png",
      output: "assets/icons/china_flag.png"
    },
    {
      courseId: "es",
      url: "/assets/icons/spain_flag.png",
      source: "apps/launcher/static/assets/icons/spain_flag.png",
      output: "assets/icons/spain_flag.png"
    }
  ]);

  const candidate = cloneLoaded(loaded);
  const third = structuredClone(candidate.courses[0]);
  third.course.id = "third";
  third.course.status = "development";
  third.course.targetLanguage.flagSrc = "/assets/icons/third.png";
  third.course.resources.launcherFlag.path = "apps/launcher/static/assets/icons/third.png";
  assert.equal(
    generateCourseSelectorAssetMappings([...candidate.courses, third]).at(-1).output,
    "assets/icons/third.png"
  );
  third.course.platforms.browser.enabled = false;
  assert.equal(generateCourseSelectorAssetMappings([...candidate.courses, third]).length, 4);

  third.course.platforms.browser.enabled = true;
  third.course.targetLanguage.flagSrc = "/assets/icons/czech_flag_ui.png";
  assert.throws(
    () => generateCourseSelectorAssetMappings([...candidate.courses, third]),
    (error) => hasIssue(error, "view.selector-assets", /maps both/)
  );
});

test("versioned schemas and both authoritative manifests are valid JSON", async () => {
  const [catalogSchema, courseSchema, androidAssetsSchema, embeddingSchema, embeddingRuntimeSchema] = await Promise.all([
    readFile(new URL("schemas/catalog.v1.schema.json", new URL("../", import.meta.url)), "utf8").then(JSON.parse),
    readFile(new URL("schemas/course-pack.v1.schema.json", new URL("../", import.meta.url)), "utf8").then(JSON.parse),
    readFile(new URL("schemas/android-assets.v1.schema.json", new URL("../", import.meta.url)), "utf8").then(JSON.parse),
    readFile(new URL("schemas/embedding-catalog.v1.schema.json", new URL("../", import.meta.url)), "utf8").then(JSON.parse),
    readFile(new URL("schemas/embedding-runtime-catalog.v1.schema.json", new URL("../", import.meta.url)), "utf8").then(JSON.parse)
  ]);
  assert.equal(catalogSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(courseSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(androidAssetsSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(embeddingSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(embeddingRuntimeSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.match(catalogSchema.$id, /language-catalog\.v1/);
  assert.match(courseSchema.$id, /course-pack\.v1/);
  assert.match(androidAssetsSchema.$id, /android-assets\.v1/);
  assert.match(embeddingSchema.$id, /embedding-catalog\.v1/);
  assert.match(embeddingRuntimeSchema.$id, /embedding-runtime-catalog\.v1/);
  assert.ok(courseSchema.properties.linguisticFeatures.items.enum.includes("hanzi-pinyin"));
  assert.ok(courseSchema.$defs.presentCourseFileResource);
  assert.ok(courseSchema.$defs.courseRoute);
  assert.deepEqual(
    courseSchema.properties.routes.additionalProperties,
    { $ref: "#/$defs/courseRoute" }
  );
  assert.deepEqual(
    courseSchema.properties.routes.properties.languageSelection,
    { const: "/" }
  );
  assert.ok(courseSchema.$defs.publication.required.includes("learnerBaseRealizations"));
  assert.ok(courseSchema.$defs.publication.required.includes("runtimeProjection"));
  assert.ok(courseSchema.$defs.wordWorldRuntimeProjection);
  assert.ok(courseSchema.$defs.presentCourseDataFileResource);
  assert.ok(courseSchema.$defs.platforms.properties.browser.required.includes("pagesEnabled"));
  assert.equal(courseSchema.$defs.platforms.properties.browser.properties.pagesEnabled.type, "boolean");
  assert.deepEqual(courseSchema.properties.games.items.enum, GAME_IDS);
  assert.deepEqual(courseSchema.properties.upcomingGames.items.enum, NON_CAMPAIGN_GAME_IDS);
  assert.equal(NON_CAMPAIGN_GAME_IDS.includes("sound-quasar"), true);
  assert.equal(PLANET_GAME_CONTRACT.planets["sound-quasar"].route, "soundQuasar");
  assert.deepEqual(PLANET_GAME_CONTRACT.planets["sound-quasar"].capabilities, ["speech"]);
  assert.equal(PLANET_GAME_CONTRACT.planets["sound-quasar"].implementationState, "unimplemented");
  assert.equal(
    PLANET_GAME_CONTRACT.planets["naturalization-nucleus"].linguisticFeatures.includes("hanzi-pinyin"),
    true
  );
  await validateCourseCatalog(loaded, { checkExistence: false });
});

test("Czech mirrors the active registry, runtime profile, and resource catalogs", async () => {
  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  assert.equal(czech.status, "active");
  assert.equal(czech.routePrefix, "/cz");
  assert.equal(czech.platforms.browser.pagesEnabled, true);
  assert.equal(czech.platforms.browser.backend, "dictionary-api-v1");
  assert.equal(czech.capabilities.llm, true);
  assert.equal(czech.capabilities.embeddings, true);
  assert.equal(czech.capabilities.speech, true);
  assert.equal(
    czech.routes.conjugationComet,
    "/language-runtime/static/games/conjugation-comet.html"
  );
  assert.equal(
    czech.routes.agreementAurora,
    "/language-runtime/static/games/agreement-aurora.html"
  );
  assert.equal(czech.games.includes("naturalization-nucleus"), false);
  assert.equal(czech.routes.naturalizationNucleus, undefined);
  assert.equal(czech.resources.naturalizationNucleusCatalog, undefined);
  assert.deepEqual(
    czech.platforms.android.channels.map(({ kind, minimumVersionCode }) => ({ kind, minimumVersionCode })),
    [
      { kind: "release", minimumVersionCode: 160 },
      { kind: "preview", minimumVersionCode: 160 }
    ]
  );
  assert.equal(czech.resources.embeddingCatalog.path, "apps/languages/czech/static/data/embeddings/models.json");
  assert.equal(czech.resources.dictionaryCatalog.path, "apps/languages/czech/static/data/dictionaries/catalog.json");
  assert.equal(czech.resources.dictionaryProvider.path, "apps/languages/czech/static/source/features/dictionary/dictionary-full.js");
  assert.equal(czech.resources.dictionaryProvider.providerId, "czech-full-dictionary-v1");
  assert.equal(czech.resources.dictionaryProvider.revision, "full-dictionary-7");
  assert.equal(czech.resources.dictionaryReferenceDocument.path, "apps/languages/czech/static/data/dictionaries/reference.html");
  assert.equal(czech.resources.dictionaryCoreEntries.path, "apps/languages/czech/static/data/games/verb-nebula/core-vocabulary.json");
  assert.equal(czech.resources.dictionaryScriptLines.path, "apps/languages/czech/static/data/language/scripts.json");
  assert.equal(czech.resources.modelCatalog.path, "apps/languages/czech/static/data/models/models.json");
  assert.equal(czech.resources.wordWorldManifest.path, "apps/languages/czech/static/data/games/word-world/manifest.json");
  assert.equal(czech.resources.verbNebulaCatalog.path, "apps/languages/czech/static/data/games/verb-nebula/core-vocabulary.json");
  assert.equal(czech.resources.conjugationCometCatalog.path, "apps/languages/czech/static/data/games/conjugation-comet/verbs.json");
  assert.equal(czech.resources.caseCosmosCatalog.path, "apps/languages/czech/static/data/games/case-cosmos/challenges.json");
  assert.equal(czech.resources.agreementAuroraCatalog.path, "apps/languages/czech/static/data/games/agreement-aurora/challenges.json");
  assert.equal(czech.resources.languageAdapter.path, "apps/languages/czech/static/source/language/adapter.mjs");
  assert.equal(czech.resources.androidAssetCatalog.path, "apps/languages/czech/android-assets.json");
  assert.equal(czech.sourceLanguage.flagSrc, "/assets/icons/english_flag.png");
  assert.equal(czech.resources.sourceLanguageFlag.path, "apps/launcher/static/assets/icons/english_flag.png");
  assert.deepEqual(czech.resources.appEntry, {
    kind: "file",
    path: "apps/language-runtime/static/app/index.html",
    scope: "shared",
    state: "present"
  });
});

test("Mandarin is an unlisted development no-LLM English-embedding pack", () => {
  const chinese = loaded.courses.find(({ course }) => course.id === "zh").course;
  assert.equal(chinese.status, "development");
  assert.equal(chinese.routePrefix, "/zh");
  assert.equal(chinese.targetLanguage.locale, "zh-Hans");
  assert.equal(chinese.targetLanguage.script, "Hans");
  assert.equal(chinese.targetLanguage.speechLocale, "zh-CN");
  assert.equal(chinese.platforms.browser.enabled, true);
  assert.equal(chinese.platforms.browser.pagesEnabled, true);
  assert.equal(chinese.platforms.browser.backend, "static");
  assert.equal(chinese.platforms.android.enabled, true);
  assert.equal(chinese.platforms.android.channels.length, 2);
  assert.ok(chinese.platforms.android.channels.every(({ minimumVersionCode }) => minimumVersionCode === 161));
  assert.deepEqual(
    {
      llm: chinese.capabilities.llm,
      generation: chinese.capabilities.generation,
      chat: chinese.capabilities.chat,
      embeddings: chinese.capabilities.embeddings,
      semanticSearch: chinese.capabilities.semanticSearch
    },
    { llm: false, generation: false, chat: false, embeddings: true, semanticSearch: true }
  );
  assert.equal(chinese.resources.embeddingCatalog.state, "present");
  assert.equal(chinese.resources.languageAdapter.state, "present");
  assert.equal(chinese.resources.wordWorldManifest.state, "present");
  assert.equal(chinese.resources.verbNebulaCatalog.state, "present");
  assert.equal(chinese.resources.dictionaryCatalog, undefined);
  assert.equal(chinese.resources.dictionaryCoreEntries, undefined);
  assert.equal(chinese.resources.dictionaryScriptLines, undefined);
  assert.equal(chinese.resources.dictionaryProvider, undefined);
  assert.equal(chinese.resources.dictionaryReferenceDocument, undefined);
  assert.equal(chinese.resources.modelCatalog, undefined);
  assert.ok(chinese.linguisticFeatures.includes("hanzi-pinyin"));
  assert.ok(chinese.games.includes("naturalization-nucleus"));
  assert.deepEqual(chinese.resources.naturalizationNucleusCatalog, {
    kind: "file",
    path: "apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/challenges.json",
    scope: "course",
    state: "present"
  });
  assert.equal(chinese.resources.appEntry.path, "apps/language-runtime/static/app/index.html");
  assert.deepEqual(chinese.resources.appEntry, loaded.courses[0].course.resources.appEntry);
});

test("language-pair identity distinguishes script variants even when primary IDs match", () => {
  const sourceLanguage = { id: "en", locale: "en" };
  assert.notEqual(
    courseLanguagePairIdentity({
      sourceLanguage,
      targetLanguage: { id: "zh", locale: "zh-Hans" }
    }),
    courseLanguagePairIdentity({
      sourceLanguage,
      targetLanguage: { id: "zh", locale: "zh-Hant" }
    })
  );
  assert.equal(
    courseLanguagePairIdentity({
      sourceLanguage: { id: "EN", locale: "EN" },
      targetLanguage: { id: "zh", locale: "zh-hans" }
    }),
    "en->zh-hans"
  );
});

test("source-language presentation treats script variants as distinct locale authorities", () => {
  const language = (locale, nativeLabel) => ({
    id: "zh",
    label: "Chinese",
    nativeLabel,
    shortCode: locale === "zh-Hans" ? "简" : "繁",
    locale,
    direction: "ltr",
    flagClass: locale === "zh-Hans" ? "china-flag" : "taiwan-flag",
    flagSrc: locale === "zh-Hans" ? "/assets/icons/china_flag.png" : "/assets/icons/taiwan_flag.png"
  });
  const courses = [
    { course: { id: "from-hans", sourceLanguage: language("zh-Hans", "简体中文") } },
    { course: { id: "from-hant", sourceLanguage: language("zh-Hant", "繁體中文") } }
  ];
  assert.deepEqual(sourceLanguagePresentationIssues(courses), []);

  courses.push({
    course: {
      id: "from-hans-conflict",
      sourceLanguage: { ...language("zh-hans", "简体中文"), shortCode: "ZH" }
    }
  });
  assert.equal(
    sourceLanguagePresentationIssues(courses).some(({ code }) => code === "language.presentation"),
    true
  );
});

test("a third dictionary course uses the generic backend contract without a Czech identity pin", () => {
  const thirdCourse = {
    id: "sk",
    capabilities: { dictionary: true },
    platforms: { browser: { enabled: true, backend: "dictionary-api-v1" } }
  };
  assert.deepEqual(browserBackendContractIssues(thirdCourse), []);
  assert.deepEqual(
    browserBackendContractIssues({
      ...thirdCourse,
      platforms: { browser: { enabled: true, backend: "static" } }
    }).map(({ code }) => code),
    ["backend.contradiction"]
  );
});

test("Word World generation fails closed until a target owns a versioned strategy", () => {
  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  const mandarin = loaded.courses.find(({ course }) => course.id === "zh").course;
  assert.deepEqual(wordWorldGenerationReadinessIssues(czech, czechWordWorldRuntimeManifest), []);
  assert.deepEqual(
    wordWorldGenerationReadinessIssues({
      ...mandarin,
      capabilities: { ...mandarin.capabilities, generation: true }
    }, {}).map(({ code }) => code),
    ["word-world.generation-strategy"]
  );
  assert.deepEqual(
    wordWorldGenerationReadinessIssues(czech, {
      ...czechWordWorldRuntimeManifest,
      generationStrategy: {
        ...czechWordWorldRuntimeManifest.generationStrategy,
        targetLanguageTag: "sk-SK"
      }
    }).map(({ code }) => code),
    ["word-world.generation-strategy"]
  );
  assert.deepEqual(
    wordWorldGenerationReadinessIssues(czech, {
      ...czechWordWorldRuntimeManifest,
      generationStrategy: {
        ...czechWordWorldRuntimeManifest.generationStrategy,
        undeclaredPromptOverride: "must fail closed"
      }
    }).map(({ code }) => code),
    ["word-world.generation-strategy"]
  );
  const futureSpanishCourse = {
    ...czech,
    id: "es",
    targetLanguage: {
      id: "es",
      label: "Spanish",
      nativeLabel: "Español",
      shortCode: "ES",
      locale: "es-ES",
      script: "Latn",
      speechLocale: "es-ES",
      direction: "ltr",
      flagClass: "spain-flag",
      flagSrc: "/assets/icons/spain_flag.png"
    }
  };
  assert.deepEqual(
    wordWorldGenerationReadinessIssues(futureSpanishCourse, {
      generationStrategy: {
        id: "spanish-local-word-world-v1",
        targetLanguageTag: "es-ES",
        auditLanguageTag: "en",
        sentenceModelKey: "spanish-sentence-model-v1",
        translationModelKey: "spanish-english-model-v1"
      }
    }).map(({ code }) => code),
    ["word-world.generation-strategy"]
  );
});

test("English audit authority is independent while unsupported learner bases fail closed", async () => {
  const candidate = cloneLoaded(loaded);
  const frenchToMandarin = candidate.courses.find(({ course }) => course.id === "zh").course;
  assert.equal(frenchToMandarin.publication.learnerBaseRealizations, null);
  frenchToMandarin.sourceLanguage = {
    id: "fr",
    label: "French",
    nativeLabel: "Français",
    shortCode: "FR",
    locale: "fr-FR",
    direction: "ltr",
    flagClass: "fr-flag",
    flagSrc: "/assets/icons/france_flag.png"
  };
  frenchToMandarin.resources.sourceLanguageFlag = {
    kind: "file",
    path: "apps/launcher/static/assets/icons/france_flag.png",
    scope: "shared",
    state: "present"
  };

  await assert.rejects(
    validateCourseCatalog(candidate, { checkExistence: false }),
    (error) => (
      hasIssue(error, "source-language.readiness", /non-English learner base/u)
      && hasIssue(error, "publication.base-realizations", /shared learner-base realization catalog/u)
      && !hasIssue(error, "publication.language")
    )
  );

  const redundantBase = cloneLoaded(loaded);
  redundantBase.courses.find(({ course }) => course.id === "zh")
    .course.publication.learnerBaseRealizations =
      "apps/languages/shared/learner-base-realizations/french-starter-v1.json";
  await assert.rejects(
    validateCourseCatalog(redundantBase, { checkExistence: false }),
    (error) => hasIssue(
      error,
      "publication.base-realizations",
      /must not duplicate English concepts/u
    )
  );

  frenchToMandarin.status = "active";
  await assert.rejects(
    generateLauncherRegistry(candidate),
    (error) => hasIssue(error, "source-language.readiness", /cannot enter the launcher/u)
  );
});

test("reviewed non-English learner-base presentation is registered per shared game", () => {
  const course = structuredClone(loaded.courses.find(({ course: item }) => item.id === "zh").course);
  course.sourceLanguage = {
    id: "fr",
    label: "French",
    nativeLabel: "Français",
    shortCode: "FR",
    locale: "fr-FR",
    direction: "ltr",
    flagClass: "fr-flag",
    flagSrc: "/assets/icons/french_flag.png"
  };
  course.games = ["word-net"];
  course.publication.learnerBaseRealizations =
    "apps/languages/shared/learner-base-realizations/fr/word-world-starter-v1.json";
  course.publication.runtimeProjection.learnerBaseRuntime =
    "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.fr-base.json";

  assert.deepEqual(learnerSourceReadinessIssues(course), []);
  assert.equal(
    PLANET_GAME_CONTRACT.planets["word-net"].learnerBasePresentationContract,
    "word-world-concept-id-projection-v1"
  );
  assert.equal(
    LEARNER_BASE_PRESENTATION_CONTRACT.implementations[
      PLANET_GAME_CONTRACT.planets["word-net"].learnerBasePresentationContract
    ].publicationContract,
    "language-content-v1"
  );
  assert.equal(
    PLANET_GAME_CONTRACT.planets["conjugation-comet"].learnerBasePresentationContract,
    "authored-game-three-role-v1"
  );
  assert.equal(
    PLANET_GAME_CONTRACT.planets["agreement-aurora"].learnerBasePresentationContract,
    "authored-game-three-role-v1"
  );

  const projection = course.publication.runtimeProjection;
  const runtimePaths = [
    projection.conceptsRuntime,
    projection.targetRealizationsRuntime,
    projection.learnerBaseRuntime,
    projection.manifest,
    ...Object.values(projection.supplementalOutputs)
  ];
  const courseStaticRoot = "apps/languages/mandarin-simplified/static/";
  const setupAssets = runtimePaths.map((runtimePath, index) => {
    const asset = runtimePath.startsWith(courseStaticRoot)
      ? runtimePath.slice(courseStaticRoot.length)
      : `/${runtimePath.slice("apps/".length)}`;
    return index === 0 ? `${asset}?v=fixture` : asset;
  });
  const androidFiles = runtimePaths
    .filter((runtimePath) => runtimePath.startsWith(courseStaticRoot))
    .map((runtimePath) => runtimePath.slice(courseStaticRoot.length));
  const appAssets = runtimePaths
    .filter((runtimePath) => runtimePath.startsWith("apps/language-runtime/"))
    .map((runtimePath) => ({
      source: runtimePath,
      output: runtimePath.slice("apps/".length)
    }));
  assert.deepEqual(learnerSourceDeliveryClosureIssues(course, {
    setupCatalog: { offline: { assets: setupAssets } },
    androidCatalog: { files: androidFiles },
    appAssetCatalog: { assets: appAssets }
  }), []);

  const missingSetup = setupAssets.filter((asset) => !asset.includes("fr-base"));
  const missingAndroid = androidFiles.filter((asset) => !asset.includes("fr-base"));
  assert.deepEqual(
    learnerSourceDeliveryClosureIssues(course, {
      setupCatalog: { offline: { assets: missingSetup } },
      androidCatalog: { files: missingAndroid },
      appAssetCatalog: { assets: appAssets }
    }).map(({ code }) => code),
    ["source-language.browser-package", "source-language.android-package"]
  );

  assert.deepEqual(
    learnerSourceDeliveryClosureIssues(course, {
      setupCatalog: { offline: { assets: setupAssets } },
      androidCatalog: { files: androidFiles },
      appAssetCatalog: { assets: [] }
    }).map(({ code }) => code),
    ["source-language.android-package"]
  );

  const remappedAppAssets = structuredClone(appAssets);
  remappedAppAssets[0].output = "language-runtime/static/data/not-the-authority.json";
  assert.deepEqual(
    learnerSourceDeliveryClosureIssues(course, {
      setupCatalog: { offline: { assets: setupAssets } },
      androidCatalog: { files: androidFiles },
      appAssetCatalog: { assets: remappedAppAssets }
    }).map(({ code }) => code),
    ["source-language.android-package"]
  );

  assert.deepEqual(
    learnerSourceDeliveryClosureIssues(course, {
      setupCatalog: { offline: { assets: setupAssets } },
      androidCatalog: { files: androidFiles },
      appAssetCatalog: { assets: [...appAssets, structuredClone(appAssets[0])] }
    }).map(({ code }) => code),
    ["source-language.android-package"]
  );

  course.games = ["conjugation-comet", "agreement-aurora"];
  assert.deepEqual(learnerSourceReadinessIssues(course), []);

  course.games.push("verb-lab");
  assert.equal(
    learnerSourceReadinessIssues(course).some(({ code }) => code === "source-language.presentation"),
    true
  );

  course.games = ["campaign", "word-net"];
  assert.deepEqual(learnerSourceReadinessIssues(course), []);
  course.games = ["campaign", "verb-lab"];
  assert.equal(
    learnerSourceReadinessIssues(course).some(({ code, message }) => (
      code === "source-language.presentation" && /campaign, verb-lab/u.test(message)
    )),
    true
  );

  course.games = ["word-net"];
  course.capabilities.dictionary = true;
  assert.equal(
    learnerSourceReadinessIssues(course).some(({ code, message }) => (
      code === "source-language.presentation" && /dictionary/u.test(message)
    )),
    true
  );
});

test("English-base Word World delivery packages every course and shared projection", async () => {
  const course = structuredClone(loaded.courses.find(({ course: item }) => item.id === "zh").course);
  const projection = course.publication.runtimeProjection;
  const runtimePaths = [
    projection.conceptsRuntime,
    projection.targetRealizationsRuntime,
    projection.manifest,
    ...Object.values(projection.supplementalOutputs)
  ];
  const courseStaticRoot = `apps/languages/${course.directoryName}/static/`;
  const setupAssets = runtimePaths.map((runtimePath) => (
    runtimePath.startsWith(courseStaticRoot)
      ? runtimePath.slice(courseStaticRoot.length)
      : `/${runtimePath.slice("apps/".length)}`
  ));
  const androidFiles = runtimePaths
    .filter((runtimePath) => runtimePath.startsWith(courseStaticRoot))
    .map((runtimePath) => runtimePath.slice(courseStaticRoot.length));
  const appAssets = runtimePaths
    .filter((runtimePath) => runtimePath.startsWith("apps/language-runtime/"))
    .map((runtimePath) => ({
      source: runtimePath,
      output: runtimePath.slice("apps/".length)
    }));
  assert.deepEqual(wordWorldProjectionDeliveryClosureIssues(course, {
    setupCatalog: { offline: { assets: setupAssets } },
    androidCatalog: { files: androidFiles },
    appAssetCatalog: { assets: appAssets }
  }), []);

  const missingTarget = projection.targetRealizationsRuntime.slice(courseStaticRoot.length);
  assert.deepEqual(
    wordWorldProjectionDeliveryClosureIssues(course, {
      setupCatalog: { offline: { assets: setupAssets.filter((asset) => asset !== missingTarget) } },
      androidCatalog: { files: androidFiles.filter((asset) => asset !== missingTarget) },
      appAssetCatalog: { assets: appAssets }
    }).map(({ code }) => code),
    ["source-language.browser-package", "source-language.android-package"]
  );

  const remapped = structuredClone(appAssets);
  remapped[0].output = "language-runtime/static/data/wrong.json";
  assert.deepEqual(
    wordWorldProjectionDeliveryClosureIssues(course, {
      setupCatalog: { offline: { assets: setupAssets } },
      androidCatalog: { files: androidFiles },
      appAssetCatalog: { assets: remapped }
    }).map(({ code }) => code),
    ["source-language.android-package"]
  );

  const invalidSetup = cloneLoaded(loaded);
  invalidSetup.courses.find(({ course: item }) => item.id === "zh")
    .course.resources.setupCatalog.path =
      "apps/languages/mandarin-simplified/static/data/embeddings/models.json";
  await assert.rejects(
    validateCourseCatalog(invalidSetup, { checkExistence: true }),
    (error) => hasIssue(error, "source-language.browser-package", /setup catalog/u)
  );
});

test("skill-compass packs are explicit, structured, and independent from semantic search", async () => {
  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  const mandarin = loaded.courses.find(({ course }) => course.id === "zh").course;
  assert.equal(czech.capabilities.skillCompass, true);
  assert.equal(czech.skillCompass.id, "cz-everyday-compass");
  assert.equal(mandarin.capabilities.semanticSearch, true);
  assert.equal(mandarin.capabilities.skillCompass, false);
  assert.equal(mandarin.skillCompass, null);

  for (const invalidPack of ["cz-everyday-compass", []]) {
    const candidate = cloneLoaded(loaded);
    candidate.courses.find(({ course }) => course.id === "cz").course.skillCompass = invalidPack;
    await assert.rejects(
      validateCourseCatalog(candidate, { checkExistence: false }),
      (error) => hasIssue(error, "manifest.shape", /skillCompass must be an object or null/)
    );
  }

  const missingPack = cloneLoaded(loaded);
  missingPack.courses.find(({ course }) => course.id === "cz").course.skillCompass = null;
  await assert.rejects(
    validateCourseCatalog(missingPack, { checkExistence: false }),
    (error) => hasIssue(error, "capability.contradiction", /requires an authored skillCompass pack/)
  );

  const undeclaredPack = cloneLoaded(loaded);
  undeclaredPack.courses.find(({ course }) => course.id === "cz").course.capabilities.skillCompass = false;
  await assert.rejects(
    validateCourseCatalog(undeclaredPack, { checkExistence: false }),
    (error) => hasIssue(error, "capability.contradiction", /declares a skillCompass pack while the capability is disabled/)
  );
});

test("launcher and course-profile compatibility views match the current consumers", async () => {
  await validateCourseCatalog(loaded, { checkExistence: false });
  await checkGeneratedViews(loaded);
  const expectedLauncher = await generateLauncherRegistry(loaded);
  const actualLauncher = JSON.parse(await readFile(new URL("../../../apps/launcher/static/languages.json", import.meta.url), "utf8"));
  assert.deepEqual(expectedLauncher, actualLauncher);
  assert.deepEqual(expectedLauncher.languages.map(({ id }) => id), ["cz"]);
  assert.equal(expectedLauncher.browserSetup.entryPath, "/cz/index.html");
  assert.deepEqual(
    expectedLauncher.browserSetup.courses.map(({ id, status, entryPath, storage }) => ({ id, status, entryPath, storage })),
    [
      {
        id: "cz",
        status: "active",
        entryPath: "/cz/index.html",
        storage: { learningPerformance: "caatuu-czech.learning.performance.v1" }
      },
      {
        id: "zh",
        status: "development",
        entryPath: "/zh/index.html",
        storage: { learningPerformance: "caatuu-zh-hans.learning.performance.v1" }
      },
      {
        id: "es",
        status: "development",
        entryPath: "/es/index.html",
        storage: { learningPerformance: "caatuu-es.learning.performance.v1" }
      }
    ]
  );

  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  const generatedProfileSource = generateCourseProfileSource(czech, loaded.courses);
  const existingProfileSource = await readFile(new URL("../../../apps/languages/czech/static/source/shared/course-profile.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.runInNewContext(generatedProfileSource, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CaatuuCourse)),
    generateCourseProfileObject(czech, loaded.courses)
  );
  assert.ok(Object.isFrozen(context.window.CaatuuCourse));
  assert.equal(generatedProfileSource, existingProfileSource.replace(/\r\n/gu, "\n"));
  assert.match(generatedProfileSource, /\n    schemaVersion: 1,/);
  assert.doesNotMatch(generatedProfileSource, /"schemaVersion":/);
  assert.equal(context.window.CaatuuCourse.capabilities.embeddings, true);
  assert.equal(context.window.CaatuuCourse.targetLanguage.script, "Latn");
  assert.equal(context.window.CaatuuCourse.targetLanguage.speechLocale, "cs-CZ");
  assert.equal(context.window.CaatuuCourse.languageAdapter.module, "source/language/adapter.mjs");
  assert.equal(Object.hasOwn(context.window.CaatuuCourse.platforms.browser, "pagesEnabled"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.CaatuuCourse.browserProviders)), {
    courseRuntime: "source/shared/runtime.js?v=runtime-41",
    semanticLearningProvider: "source/shared/semantic-learning.js?v=semantic-learning-7",
    setupProgressProvider: "source/features/setup/setup-progress.js?v=setup-progress-1",
    setupProvider: "source/features/setup/setup.js?v=setup-39"
  });
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
        conjugationCometCatalog: "data/games/conjugation-comet/verbs.json?v=conjugation-comet-verbs-4"
      },
      "case-cosmos": {
        caseCosmosCatalog: "data/games/case-cosmos/challenges.json?v=case-cosmos-data-5"
      },
      "agreement-aurora": {
        agreementAuroraCatalog: "data/games/agreement-aurora/challenges.json?v=agreement-aurora-data-3"
      }
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CaatuuCourse.dictionaryContent)),
    {
      catalog: "data/dictionaries/catalog.json",
      coreEntries: "data/games/verb-nebula/core-vocabulary.json",
      scriptLines: "data/language/scripts.json",
      referenceDocument: "data/dictionaries/reference.html",
      providerId: "czech-full-dictionary-v1",
      providerModule: "source/features/dictionary/dictionary-full.js?v=full-dictionary-7",
      gapReporting: {
        providerId: "czech-full-dictionary-v1",
        dictionaryKey: "kaikki-cs-en-2026-07-09",
        dictionaryDirection: "cs-en"
      }
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      context.window.CaatuuCourse.courseSelector.courses.map(({ id, status, storage }) => ({ id, status, storage }))
    )),
    [
      {
        id: "cz",
        status: "active",
        storage: { learningPerformance: "caatuu-czech.learning.performance.v1" }
      },
      {
        id: "zh",
        status: "development",
        storage: { learningPerformance: "caatuu-zh-hans.learning.performance.v1" }
      },
      {
        id: "es",
        status: "development",
        storage: { learningPerformance: "caatuu-es.learning.performance.v1" }
      }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      context.window.CaatuuCourse.courseSelector.courses.map(({ sourceLanguage }) => sourceLanguage.id)
    )),
    ["en", "en", "en"]
  );

  const mandarin = loaded.courses.find(({ course }) => course.id === "zh").course;
  const mandarinProfileSource = await readFile(
    new URL("../../../apps/languages/mandarin-simplified/static/source/shared/course-profile.js", import.meta.url),
    "utf8"
  );
  const mandarinContext = { window: {} };
  vm.runInNewContext(mandarinProfileSource, mandarinContext);
  assert.equal(mandarinContext.window.CaatuuCourse.dictionaryContent, null);
  assert.deepEqual(JSON.parse(JSON.stringify(mandarinContext.window.CaatuuCourse.browserProviders)), {});
  assert.deepEqual(
    JSON.parse(JSON.stringify(mandarinContext.window.CaatuuCourse)),
    generateCourseProfileObject(mandarin, loaded.courses)
  );
});

test("failure fixtures catch identity, route, and namespace collisions", async () => {
  const fixtures = [
    {
      name: "inconsistent shared source-language presentation",
      code: "language.presentation",
      message: /Source language en.*cz.*zh/,
      mutate(candidate) {
        candidate.courses[1].course.sourceLanguage.shortCode = "ENG";
      }
    },
    {
      name: "duplicate course ID",
      code: "collision.id",
      mutate(candidate) {
        candidate.courses[1].course.id = "cz";
        candidate.courses[1].catalogEntry.id = "cz";
      }
    },
    {
      name: "nested course route",
      code: "collision.route",
      mutate(candidate) {
        candidate.courses[1].course.routePrefix = "/cz/child";
        candidate.courses[1].course.entryPath = "/cz/child/index.html";
        candidate.courses[1].course.platforms.browser.entryPath = "/cz/child/index.html";
      }
    },
    {
      name: "duplicate storage namespace",
      code: "collision.namespace",
      mutate(candidate) {
        candidate.courses[1].course.storage.namespace = "caatuu-czech";
      }
    },
    {
      name: "duplicate learner-base and target language pair",
      code: "collision.language-pair",
      mutate(candidate) {
        candidate.courses[1].course.targetLanguage = structuredClone(
          candidate.courses[0].course.targetLanguage
        );
      }
    }
  ];
  for (const fixture of fixtures) await assertFixtureFails(loaded, fixture);
});

test("course routes stay confined while retaining the language selector and exact shared game hosts", async () => {
  for (const { course } of loaded.courses) {
    assert.equal(course.routes.languageSelection, "/", course.id);
  }
  for (const courseId of ["cz", "es"]) {
    const course = loaded.courses.find(({ course: entry }) => entry.id === courseId).course;
    assert.equal(
      course.routes.conjugationComet,
      PLANET_GAME_CONTRACT.planets["conjugation-comet"].sharedHost,
      courseId
    );
    assert.equal(
      course.routes.agreementAurora,
      PLANET_GAME_CONTRACT.planets["agreement-aurora"].sharedHost,
      courseId
    );
  }

  const fixtures = [
    {
      name: "absolute URL scheme",
      code: "route.invalid",
      message: /cz\.routes\.home/u,
      mutate(candidate) {
        candidate.courses.find(({ course }) => course.id === "cz")
          .course.routes.home = "https://example.invalid/game.html";
      }
    },
    {
      name: "protocol-relative URL",
      code: "route.invalid",
      message: /cz\.routes\.games/u,
      mutate(candidate) {
        candidate.courses.find(({ course }) => course.id === "cz")
          .course.routes.games = "//example.invalid/game.html";
      }
    },
    {
      name: "percent-encoded traversal",
      code: "route.invalid",
      message: /cz\.routes\.settings/u,
      mutate(candidate) {
        candidate.courses.find(({ course }) => course.id === "cz")
          .course.routes.settings = "safe/%2e%2e/settings.html";
      }
    }
  ];
  for (const fixture of fixtures) await assertFixtureFails(loaded, fixture);
});

test("failure fixtures catch invalid language tags and reserved archive boundaries", async () => {
  const fixtures = [
    {
      name: "invalid target locale",
      code: "locale.invalid",
      mutate(candidate) {
        candidate.courses[1].course.targetLanguage.locale = "zh_Hans";
      }
    },
    {
      name: "legacy zh-hans redirect boundary",
      code: "route.reserved",
      message: /reserved route \/zh-hans/,
      mutate(candidate) {
        candidate.courses[1].course.routePrefix = "/zh-hans";
        candidate.courses[1].course.entryPath = "/zh-hans/index.html";
        candidate.courses[1].course.platforms.browser.entryPath = "/zh-hans/index.html";
      }
    },
    {
      name: "archive route descendant",
      code: "route.reserved",
      message: /reserved route \/archive/,
      mutate(candidate) {
        candidate.courses[1].course.routePrefix = "/archive/course";
        candidate.courses[1].course.entryPath = "/archive/course/index.html";
        candidate.courses[1].course.platforms.browser.entryPath = "/archive/course/index.html";
      }
    }
  ];
  for (const fixture of fixtures) await assertFixtureFails(loaded, fixture);
});

test("failure fixtures catch capability, backend, and resource contradictions", async () => {
  const fixtures = [
    {
      name: "course without a source-language flag resource",
      code: "resource.required",
      message: /sourceLanguageFlag/,
      mutate(candidate) {
        delete candidate.courses[1].course.resources.sourceLanguageFlag;
      }
    },
    {
      name: "source-language flag URL disagrees with its resource",
      code: "resource.url-mismatch",
      message: /sourceLanguage\.flagSrc.*sourceLanguageFlag/,
      mutate(candidate) {
        for (const { course } of candidate.courses) {
          course.sourceLanguage.flagSrc = "/assets/icons/different-english-flag.svg";
        }
      }
    },
    {
      name: "semantic search without embeddings",
      code: "capability.contradiction",
      message: /semanticSearch requires embeddings/,
      mutate(candidate) {
        candidate.courses[1].course.capabilities.embeddings = false;
        delete candidate.courses[1].course.resources.embeddingCatalog;
      }
    },
    {
      name: "generation without an LLM",
      code: "capability.contradiction",
      message: /generation requires llm/,
      mutate(candidate) {
        candidate.courses[0].course.capabilities.llm = false;
      }
    },
    {
      name: "dictionary API backend without dictionary capability",
      code: "backend.contradiction",
      mutate(candidate) {
        candidate.courses[0].course.capabilities.dictionary = false;
        delete candidate.courses[0].course.resources.dictionaryCatalog;
      }
    },
    {
      name: "browser dictionary capability with a static backend",
      code: "backend.contradiction",
      message: /dictionary-api-v1/u,
      mutate(candidate) {
        candidate.courses[0].course.platforms.browser.backend = "static";
      }
    },
    {
      name: "enabled Android without an asset catalog",
      code: "resource.required",
      message: /androidAssetCatalog/,
      mutate(candidate) {
        delete candidate.courses[0].course.resources.androidAssetCatalog;
      }
    },
    {
      name: "Android channel without a compatibility floor",
      code: "manifest.shape",
      message: /minimumVersionCode/,
      mutate(candidate) {
        delete candidate.courses[0].course.platforms.android.channels[0].minimumVersionCode;
      }
    },
    {
      name: "Android channel with a non-positive compatibility floor",
      code: "manifest.shape",
      message: /minimumVersionCode must be a positive safe integer/,
      mutate(candidate) {
        candidate.courses[0].course.platforms.android.channels[0].minimumVersionCode = 0;
      }
    },
    {
      name: "planned resource in active course",
      code: "status.planned-resource",
      mutate(candidate) {
        candidate.courses[0].course.resources.appEntry.state = "planned";
      }
    }
  ];
  for (const fixture of fixtures) await assertFixtureFails(loaded, fixture);
});

test("browser courses declare only known, unique linguistic features and games", async () => {
  for (const { course } of loaded.courses.filter(({ course }) => course.platforms.browser.enabled)) {
    assert.ok(Array.isArray(course.linguisticFeatures), course.id);
    assert.equal(new Set(course.linguisticFeatures).size, course.linguisticFeatures.length, course.id);
    assert.ok(Array.isArray(course.games), course.id);
    assert.equal(new Set(course.games).size, course.games.length, course.id);
    assert.ok(Array.isArray(course.upcomingGames), course.id);
    assert.equal(new Set(course.upcomingGames).size, course.upcomingGames.length, course.id);
    assert.equal(course.upcomingGames.some((gameId) => course.games.includes(gameId)), false, course.id);
  }

  const fixtures = [
    {
      name: "browser course without linguistic features",
      code: "platform.contradiction",
      message: /requires linguisticFeatures/,
      mutate(candidate) {
        delete candidate.courses[1].course.linguisticFeatures;
      }
    },
    {
      name: "unknown linguistic feature",
      code: "linguistic-feature.invalid",
      message: /unsupported value/,
      mutate(candidate) {
        candidate.courses[1].course.linguisticFeatures.push("noun-magic");
      }
    },
    {
      name: "duplicate linguistic feature",
      code: "linguistic-feature.invalid",
      message: /duplicate value/,
      mutate(candidate) {
        candidate.courses[0].course.linguisticFeatures.push(candidate.courses[0].course.linguisticFeatures[0]);
      }
    },
    {
      name: "browser course without games",
      code: "platform.contradiction",
      message: /requires games/,
      mutate(candidate) {
        delete candidate.courses[1].course.games;
      }
    },
    {
      name: "unknown game",
      code: "game.invalid",
      message: /unsupported value/,
      mutate(candidate) {
        candidate.courses[1].course.games.push("translation-planet");
      }
    },
    {
      name: "duplicate game",
      code: "game.invalid",
      message: /duplicate value/,
      mutate(candidate) {
        candidate.courses[1].course.games.push(candidate.courses[1].course.games[0]);
      }
    },
    {
      name: "unknown upcoming game",
      code: "game.upcoming.invalid",
      message: /unsupported value/,
      mutate(candidate) {
        candidate.courses[1].course.upcomingGames.push("translation-planet");
      }
    },
    {
      name: "game cannot be playable and upcoming",
      code: "game.lifecycle",
      message: /cannot be both playable and upcoming/,
      mutate(candidate) {
        candidate.courses[1].course.upcomingGames.push("verb-lab");
      }
    },
    {
      name: "unimplemented placeholder cannot be promoted by a course",
      code: "game.implementation",
      message: /sound-quasar.*marked unimplemented.*upcomingGames/,
      mutate(candidate) {
        const course = candidate.courses[1].course;
        course.upcomingGames = course.upcomingGames.filter((gameId) => gameId !== "sound-quasar");
        course.games.push("sound-quasar");
        course.routes.soundQuasar = "index.html?game=sound-quasar";
      }
    },
    {
      name: "game without required linguistic feature",
      code: "game.linguistic-feature",
      message: /case-cosmos.*grammatical-case/,
      mutate(candidate) {
        candidate.courses[0].course.linguisticFeatures = candidate.courses[0].course.linguisticFeatures
          .filter((feature) => feature !== "grammatical-case");
      }
    },
    {
      name: "game without required capability",
      code: "game.capability",
      message: /word-net.*wordWorld/,
      mutate(candidate) {
        candidate.courses[1].course.capabilities.wordWorld = false;
      }
    },
    {
      name: "game without declared route",
      code: "game.route",
      message: /agreement-aurora.*routes\.agreementAurora/,
      mutate(candidate) {
        delete candidate.courses[0].course.routes.agreementAurora;
      }
    },
    {
      name: "campaign without a campaign-eligible game",
      code: "game.campaign",
      message: /campaign requires at least 1 campaign-eligible enabled game/,
      mutate(candidate) {
        candidate.courses[1].course.games = ["campaign", "naturalization-nucleus"];
        candidate.courses[1].course.routes.campaign = "index.html";
      }
    }
  ];
  for (const fixture of fixtures) await assertFixtureFails(loaded, fixture);
});

test("Naturalization Nucleus requires Chinese pinyin support and a present course catalog", async () => {
  const czechWithOnlyRoute = cloneLoaded(loaded);
  const czech = czechWithOnlyRoute.courses.find(({ course }) => course.id === "cz").course;
  czech.games.push("naturalization-nucleus");
  czech.routes.naturalizationNucleus = "index.html?game=naturalization-nucleus";
  await assert.rejects(
    validateCourseCatalog(czechWithOnlyRoute, { checkExistence: false }),
    (error) => (
      hasIssue(error, "game.linguistic-feature", /naturalization-nucleus.*hanzi-pinyin/u)
      && hasIssue(error, "resource.required", /naturalizationNucleusCatalog/u)
    )
  );

  const syntheticThirdLanguage = cloneLoaded(loaded);
  const synthetic = syntheticThirdLanguage.courses.find(({ course }) => course.id === "zh").course;
  synthetic.targetLanguage = {
    ...synthetic.targetLanguage,
    id: "ja",
    label: "Japanese",
    nativeLabel: "Japanese",
    shortCode: "JA",
    locale: "ja-JP",
    script: "Jpan",
    speechLocale: "ja-JP"
  };
  await assert.rejects(
    validateCourseCatalog(syntheticThirdLanguage, { checkExistence: false }),
    (error) => hasIssue(error, "linguistic-feature.language", /hanzi-pinyin.*targetLanguage\.id is not zh/u)
  );

  const missingCatalog = cloneLoaded(loaded);
  delete missingCatalog.courses.find(({ course }) => course.id === "zh")
    .course.resources.naturalizationNucleusCatalog;
  await assert.rejects(
    validateCourseCatalog(missingCatalog, { checkExistence: false }),
    (error) => hasIssue(error, "resource.required", /naturalizationNucleusCatalog/u)
  );

  const misScopedCatalog = cloneLoaded(loaded);
  misScopedCatalog.courses.find(({ course }) => course.id === "zh")
    .course.resources.naturalizationNucleusCatalog.scope = "shared";
  await assert.rejects(
    validateCourseCatalog(misScopedCatalog, { checkExistence: false }),
    (error) => hasIssue(error, "path.scope", /naturalizationNucleusCatalog.*course scope/u)
  );

  const plannedCatalog = cloneLoaded(loaded);
  plannedCatalog.courses.find(({ course }) => course.id === "zh")
    .course.resources.naturalizationNucleusCatalog.state = "planned";
  await assert.rejects(
    validateCourseCatalog(plannedCatalog, { checkExistence: false }),
    (error) => hasIssue(error, "game.resource", /naturalizationNucleusCatalog\.state must be present/u)
  );

  const directoryCatalog = cloneLoaded(loaded);
  directoryCatalog.courses.find(({ course }) => course.id === "zh")
    .course.resources.naturalizationNucleusCatalog.kind = "directory";
  await assert.rejects(
    validateCourseCatalog(directoryCatalog, { checkExistence: false }),
    (error) => hasIssue(error, "game.resource", /naturalizationNucleusCatalog\.kind must be file/u)
  );

  const orphanCatalog = cloneLoaded(loaded);
  const orphanedMandarin = orphanCatalog.courses.find(({ course }) => course.id === "zh").course;
  orphanedMandarin.games = orphanedMandarin.games.filter((gameId) => gameId !== "naturalization-nucleus");
  orphanedMandarin.linguisticFeatures = orphanedMandarin.linguisticFeatures
    .filter((feature) => feature !== "hanzi-pinyin");
  delete orphanedMandarin.routes.naturalizationNucleus;
  await assert.rejects(
    validateCourseCatalog(orphanCatalog, { checkExistence: false }),
    (error) => hasIssue(error, "game.resource", /naturalizationNucleusCatalog.*neither enabled nor upcoming/u)
  );
});

test("every playable authored planet requires its declared course content", async () => {
  const requirements = [
    ["cz", "verb-lab", "verbNebulaCatalog"],
    ["cz", "word-net", "wordWorldManifest"],
    ["cz", "conjugation-comet", "conjugationCometCatalog"],
    ["cz", "case-cosmos", "caseCosmosCatalog"],
    ["cz", "agreement-aurora", "agreementAuroraCatalog"],
    ["zh", "verb-lab", "verbNebulaCatalog"],
    ["zh", "word-net", "wordWorldManifest"],
    ["zh", "naturalization-nucleus", "naturalizationNucleusCatalog"],
    ["es", "verb-lab", "verbNebulaCatalog"],
    ["es", "word-net", "wordWorldManifest"],
    ["es", "conjugation-comet", "conjugationCometCatalog"],
    ["es", "agreement-aurora", "agreementAuroraCatalog"]
  ];

  for (const [courseId, gameId, resourceName] of requirements) {
    const course = loaded.courses.find(({ course: entry }) => entry.id === courseId).course;
    assert.ok(course.games.includes(gameId), `${courseId} must enable ${gameId}`);
    assert.deepEqual(
      {
        kind: course.resources[resourceName]?.kind,
        scope: course.resources[resourceName]?.scope,
        state: course.resources[resourceName]?.state
      },
      { kind: "file", scope: "course", state: "present" },
      `${courseId}.${gameId} must declare ${resourceName}`
    );

    const missing = cloneLoaded(loaded);
    delete missing.courses.find(({ course: entry }) => entry.id === courseId).course.resources[resourceName];
    await assert.rejects(
      validateCourseCatalog(missing, { checkExistence: false }),
      (error) => hasIssue(error, "resource.required", new RegExp(resourceName, "u")),
      `${courseId}.${gameId} must fail closed without ${resourceName}`
    );
  }

  const wrongExistingPath = cloneLoaded(loaded);
  wrongExistingPath.courses.find(({ course }) => course.id === "cz")
    .course.resources.verbNebulaCatalog.path = "apps/languages/czech/static/data/games/word-world/manifest.json";
  await assert.rejects(
    validateCourseCatalog(wrongExistingPath, { checkExistence: false }),
    (error) => hasIssue(error, "game.resource", /verbNebulaCatalog\.path must be .*verb-nebula\/core-vocabulary\.json/u)
  );
});

test("finite authored Conjugation Comet content does not imply the legacy verbs provider", async () => {
  const spanish = loaded.courses.find(({ course }) => course.id === "es").course;
  assert.equal(spanish.capabilities.conjugationComet, true);
  assert.equal(spanish.capabilities.verbs, false);
  await validateCourseCatalog(cloneLoaded(loaded), { checkExistence: false });
});

test("Word World runtime outputs are bound exactly to course publication authority", async () => {
  const mandarin = loaded.courses.find(({ course }) => course.id === "zh").course;
  assert.deepEqual(mandarin.publication.runtimeProjection, {
    policyId: "mandarin-simplified-word-world-v1",
    conceptsRuntime: "apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
    targetRealizationsRuntime: "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json",
    learnerBaseRuntime: null,
    supplementalOutputs: {
      readingGuideProjection: "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.reading-guides.json"
    },
    manifest: "apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json"
  });

  const fixtures = [
    {
      name: "wrong projection policy",
      code: "publication.runtime-policy",
      mutate(course) {
        course.publication.runtimeProjection.policyId = "different-word-world-v1";
      }
    },
    {
      name: "manifest differs from the resource authority",
      code: "publication.runtime-authority",
      mutate(course) {
        course.publication.runtimeProjection.manifest =
          "apps/languages/mandarin-simplified/static/data/games/word-world/other.json";
      }
    },
    {
      name: "same target filename in a different runtime directory",
      code: "publication.runtime-drift",
      mutate(course) {
        course.publication.runtimeProjection.targetRealizationsRuntime =
          "apps/languages/mandarin-simplified/static/data/other-course/starter-v1.realizations.json";
      }
    },
    {
      name: "missing policy-owned supplemental output",
      code: "publication.runtime-authority",
      mutate(course) {
        delete course.publication.runtimeProjection.supplementalOutputs.readingGuideProjection;
      }
    },
    {
      name: "English base with a learner-base runtime",
      code: "publication.runtime-authority",
      mutate(course) {
        course.publication.runtimeProjection.learnerBaseRuntime =
          "apps/languages/mandarin-simplified/static/data/games/word-world/base.json";
      }
    },
    {
      name: "target realization script differs from the course",
      code: "publication.language",
      mutate(course) {
        course.targetLanguage.script = "Hant";
      }
    }
  ];
  for (const fixture of fixtures) {
    const candidate = cloneLoaded(loaded);
    fixture.mutate(candidate.courses.find(({ course }) => course.id === "zh").course);
    await assert.rejects(
      validateCourseCatalog(candidate, { checkExistence: false }),
      (error) => hasIssue(error, fixture.code),
      fixture.name
    );
  }
});

test("dictionary capability requires explicit course data and projects its declared browser paths", async () => {
  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  for (const resourceName of [
    "dictionaryCatalog",
    "dictionaryCoreEntries",
    "dictionaryScriptLines",
    "dictionaryReferenceDocument",
    "dictionaryProvider"
  ]) {
    assert.deepEqual(
      {
        kind: czech.resources[resourceName]?.kind,
        scope: czech.resources[resourceName]?.scope,
        state: czech.resources[resourceName]?.state
      },
      { kind: "file", scope: "course", state: "present" },
      resourceName
    );

    const missing = cloneLoaded(loaded);
    delete missing.courses.find(({ course }) => course.id === "cz").course.resources[resourceName];
    await assert.rejects(
      validateCourseCatalog(missing, { checkExistence: false }),
      (error) => hasIssue(error, "resource.required", new RegExp(resourceName, "u"))
    );
  }

  const planned = cloneLoaded(loaded);
  planned.courses.find(({ course }) => course.id === "cz")
    .course.resources.dictionaryScriptLines.state = "planned";
  await assert.rejects(
    validateCourseCatalog(planned, { checkExistence: false }),
    (error) => hasIssue(error, "capability.resource", /dictionaryScriptLines\.state to be present/u)
  );

  const shared = cloneLoaded(loaded);
  shared.courses.find(({ course }) => course.id === "cz")
    .course.resources.dictionaryCoreEntries.scope = "shared";
  await assert.rejects(
    validateCourseCatalog(shared, { checkExistence: false }),
    (error) => hasIssue(error, "path.scope", /dictionaryCoreEntries.*course scope/u)
  );

  const directory = cloneLoaded(loaded);
  directory.courses.find(({ course }) => course.id === "cz")
    .course.resources.dictionaryCoreEntries.kind = "directory";
  await assert.rejects(
    validateCourseCatalog(directory, { checkExistence: false }),
    (error) => hasIssue(error, "capability.resource", /dictionaryCoreEntries\.kind to be file/u)
  );

  const customPaths = structuredClone(czech);
  customPaths.resources.dictionaryCoreEntries.path = "apps/languages/czech/static/data/dictionaries/core-custom.json";
  customPaths.resources.dictionaryScriptLines.path = "apps/languages/czech/static/data/dictionaries/scripts-custom.json";
  customPaths.resources.dictionaryReferenceDocument.path = "apps/languages/czech/static/data/dictionaries/reference-custom.html";
  customPaths.resources.dictionaryProvider.path = "apps/languages/czech/static/source/features/dictionary/provider-custom.js";
  customPaths.resources.dictionaryProvider.providerId = "custom-dictionary-provider-v2";
  customPaths.resources.dictionaryProvider.revision = "provider-custom-2";
  assert.deepEqual(generateCourseProfileObject(customPaths, loaded.courses).dictionaryContent, {
    catalog: "data/dictionaries/catalog.json",
    coreEntries: "data/dictionaries/core-custom.json",
    scriptLines: "data/dictionaries/scripts-custom.json",
    referenceDocument: "data/dictionaries/reference-custom.html",
    providerId: "custom-dictionary-provider-v2",
    providerModule: "source/features/dictionary/provider-custom.js?v=provider-custom-2",
    gapReporting: {
      providerId: "custom-dictionary-provider-v2",
      dictionaryKey: "kaikki-cs-en-2026-07-09",
      dictionaryDirection: "cs-en"
    }
  });

  const withoutGapReporting = structuredClone(czech);
  delete withoutGapReporting.resources.dictionaryProvider.gapReporting;
  assert.equal(
    Object.hasOwn(generateCourseProfileObject(withoutGapReporting, loaded.courses).dictionaryContent, "gapReporting"),
    false,
    "future dictionary providers do not inherit Czech reporting metadata"
  );

  for (const providerId of [undefined, "unversioned-provider", "Provider-v1"]) {
    const invalid = cloneLoaded(loaded);
    const provider = invalid.courses.find(({ course }) => course.id === "cz")
      .course.resources.dictionaryProvider;
    if (providerId === undefined) delete provider.providerId;
    else provider.providerId = providerId;
    await assert.rejects(
      validateCourseCatalog(invalid, { checkExistence: false }),
      (error) => hasIssue(error, "capability.resource", /dictionaryProvider\.providerId/u)
        || hasIssue(error, "manifest.shape", /providerId/u)
    );
  }

  const wrongArtifactBinding = cloneLoaded(loaded);
  wrongArtifactBinding.courses.find(({ course }) => course.id === "cz")
    .course.resources.dictionaryProvider.providerId = "different-dictionary-provider-v1";
  await assert.rejects(
    validateCourseCatalog(wrongArtifactBinding),
    (error) => hasIssue(error, "content.dictionary-provider", /different-dictionary-provider-v1/u)
  );

  for (const [field, value] of [
    ["dictionaryKey", "other-dictionary-v1"],
    ["dictionaryDirection", "es-en"]
  ]) {
    const wrongGapBinding = cloneLoaded(loaded);
    wrongGapBinding.courses.find(({ course }) => course.id === "cz")
      .course.resources.dictionaryProvider.gapReporting[field] = value;
    await assert.rejects(
      validateCourseCatalog(wrongGapBinding),
      (error) => hasIssue(error, "content.dictionary-gap-reporting", /active default dictionary key and direction/u)
    );
  }

  const misplacedProviderIdentity = cloneLoaded(loaded);
  misplacedProviderIdentity.courses.find(({ course }) => course.id === "cz")
    .course.resources.embeddingCatalog.providerId = "misplaced-provider-v1";
  await assert.rejects(
    validateCourseCatalog(misplacedProviderIdentity, { checkExistence: false }),
    (error) => hasIssue(error, "manifest.shape", /embeddingCatalog.*providerId/u)
  );
});

test("browser delivery fails closed for development, active, and retired courses", async () => {
  const fixtures = [
    {
      name: "browser-enabled development course without appEntry",
      code: "resource.required",
      message: /Browser-enabled course zh requires resources\.appEntry/,
      mutate(candidate) {
        delete candidate.courses[1].course.resources.appEntry;
      }
    },
    {
      name: "browser-enabled development course with planned staticRoot",
      code: "platform.contradiction",
      message: /requires a present resources\.staticRoot/,
      mutate(candidate) {
        candidate.courses[1].course.resources.staticRoot.state = "planned";
      }
    },
    {
      name: "browser-enabled development course with planned appEntry",
      code: "platform.contradiction",
      message: /requires a present resources\.appEntry/,
      mutate(candidate) {
        candidate.courses[1].course.resources.appEntry.state = "planned";
      }
    },
    {
      name: "browser-enabled course with wrong staticRoot kind",
      code: "platform.contradiction",
      message: /resources\.staticRoot\.kind to be directory/,
      mutate(candidate) {
        candidate.courses[1].course.resources.staticRoot.kind = "file";
      }
    },
    {
      name: "browser-enabled course with course-scoped appEntry",
      code: "path.scope",
      message: /resources\.appEntry to use shared scope/,
      mutate(candidate) {
        candidate.courses[1].course.resources.appEntry.scope = "course";
      }
    },
    {
      name: "browser course selects a different shared application entry",
      code: "resource.app-entry",
      message: /must be the canonical shared application|must share one appEntry/,
      mutate(candidate) {
        candidate.courses[1].course.resources.appEntry.path = "apps/language-runtime/static/source/course-shell.mjs";
      }
    },
    {
      name: "retired browser-enabled course",
      code: "platform.contradiction",
      message: /Retired course zh cannot enable its browser platform/,
      mutate(candidate) {
        candidate.courses[1].course.status = "retired";
      }
    },
    {
      name: "active browser-disabled course",
      code: "platform.contradiction",
      message: /Active course cz must enable its browser platform/,
      mutate(candidate) {
        candidate.courses[0].course.platforms.browser.enabled = false;
      }
    },
    {
      name: "Pages-enabled course with disabled browser delivery",
      code: "platform.contradiction",
      message: /cannot enable Pages while its browser platform is disabled/,
      mutate(candidate) {
        candidate.courses[1].course.platforms.browser.enabled = false;
      }
    },
    {
      name: "entryPath traversal",
      code: "route.invalid",
      message: /confined file path/,
      mutate(candidate) {
        candidate.courses[1].course.entryPath = "/zh/../index.html";
        candidate.courses[1].course.platforms.browser.entryPath = "/zh/../index.html";
      }
    }
  ];
  for (const fixture of fixtures) await assertFixtureFails(loaded, fixture);

  const browserDisabledActive = cloneLoaded(loaded);
  browserDisabledActive.courses[0].course.platforms.browser.enabled = false;
  await assert.rejects(
    generateLauncherRegistry(browserDisabledActive),
    (error) => hasIssue(error, "platform.contradiction", /cannot be emitted into the launcher/)
  );
});

test("Pages publication requires release-cleared target licensing without requiring native review for preview courses", async () => {
  const spanish = loaded.courses.find(({ course }) => course.id === "es").course;
  assert.equal(spanish.platforms.browser.enabled, true);
  assert.equal(spanish.platforms.browser.pagesEnabled, false);

  const publishSpanish = cloneLoaded(loaded);
  publishSpanish.courses.find(({ course }) => course.id === "es")
    .course.platforms.browser.pagesEnabled = true;
  await assert.rejects(
    validateCourseCatalog(publishSpanish, { checkExistence: false }),
    (error) => hasIssue(error, "release.license", /target catalog licensing is not release-cleared/u)
  );
});

test("active promotion fails closed while native-language review is incomplete", async () => {
  const promoted = cloneLoaded(loaded);
  promoted.courses[1].course.status = "active";

  await assert.rejects(
    validateCourseCatalog(promoted, { checkExistence: false }),
    (error) => (
      hasIssue(error, "activation.native-review", /status native-reviewed/)
      && !hasIssue(error, "release.license")
    )
  );
  await assert.rejects(
    generateLauncherRegistry(promoted),
    (error) => hasIssue(error, "activation.native-review", /status native-reviewed/)
  );

  const legacyBypass = cloneLoaded(promoted);
  legacyBypass.courses[1].course.publication = {
    contract: "legacy-active-v1",
    concepts: null,
    realizations: null
  };
  await assert.rejects(
    generateLauncherRegistry(legacyBypass),
    (error) => hasIssue(error, "publication.legacy", /cannot use the Czech-only legacy publication exception/)
  );
});

test("Spanish grammar catalogs independently gate preview, browser, Android, and active promotion", async () => {
  const spanish = structuredClone(loaded.courses.find(({ course }) => course.id === "es").course);
  const [conjugationDocument, agreementDocument] = await Promise.all([
    readFile(
      new URL("../../../apps/languages/spanish/static/data/games/conjugation-comet/verbs.json", import.meta.url),
      "utf8"
    ).then(JSON.parse),
    readFile(
      new URL("../../../apps/languages/spanish/static/data/games/agreement-aurora/challenges.json", import.meta.url),
      "utf8"
    ).then(JSON.parse)
  ]);
  const validateConjugation = (document) => validateConjugationCometCatalog(document, {
    expectedCourseId: "es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "es-ES"
  });
  const validateAgreement = (document) => normalizeAgreementAuroraPack(document, {
    courseId: "es",
    learnerBaseLanguage: "en",
    targetLanguage: "es-ES",
    targetLabel: "Spanish"
  });
  const pendingCatalogs = [
    ["conjugation-comet", validateConjugation(conjugationDocument)],
    ["agreement-aurora", validateAgreement(agreementDocument)]
  ];

  for (const [gameId, catalog] of pendingCatalogs) {
    assert.deepEqual(authoredGrammarPromotionIssues(spanish, gameId, catalog), []);
  }

  const pagesPreview = structuredClone(spanish);
  pagesPreview.platforms.browser.pagesEnabled = true;
  const androidPreview = structuredClone(spanish);
  androidPreview.platforms.android.enabled = true;
  for (const releaseCourse of [pagesPreview, androidPreview]) {
    for (const [gameId, catalog] of pendingCatalogs) {
      assert.deepEqual(
        authoredGrammarPromotionIssues(releaseCourse, gameId, catalog).map(({ code }) => code),
        ["release.game-license"]
      );
    }
  }

  const active = structuredClone(spanish);
  active.status = "active";
  for (const [gameId, catalog] of pendingCatalogs) {
    assert.deepEqual(
      authoredGrammarPromotionIssues(active, gameId, catalog).map(({ code }) => code),
      ["release.game-license", "activation.game-native-review"]
    );
  }

  const clearedConjugationDocument = structuredClone(conjugationDocument);
  clearedConjugationDocument.review.status = "release-approved";
  clearedConjugationDocument.license.status = "release-cleared";
  clearedConjugationDocument.license.spdx = "AGPL-3.0-only";
  const clearedAgreementDocument = structuredClone(agreementDocument);
  clearedAgreementDocument.review.status = "approved";
  clearedAgreementDocument.review.reviewer = "Test reviewer";
  clearedAgreementDocument.review.reviewedAt = "2026-09-04";
  clearedAgreementDocument.license.status = "release-cleared";
  clearedAgreementDocument.license.spdxExpression = "AGPL-3.0-only";
  const clearedCatalogs = [
    ["conjugation-comet", validateConjugation(clearedConjugationDocument)],
    ["agreement-aurora", validateAgreement(clearedAgreementDocument)]
  ];
  for (const [gameId, catalog] of clearedCatalogs) {
    assert.deepEqual(authoredGrammarPromotionIssues(active, gameId, catalog), []);
  }

  const czechLegacy = structuredClone(loaded.courses.find(({ course }) => course.id === "cz").course);
  assert.equal(czechLegacy.publication.contract, "legacy-active-v1");
  for (const [gameId, catalog] of pendingCatalogs) {
    assert.deepEqual(authoredGrammarPromotionIssues(czechLegacy, gameId, catalog), []);
  }
  const falseLegacyClaim = structuredClone(czechLegacy);
  falseLegacyClaim.id = "not-czech";
  assert.deepEqual(
    authoredGrammarPromotionIssues(falseLegacyClaim, "conjugation-comet", pendingCatalogs[0][1])
      .map(({ code }) => code),
    ["release.game-license", "activation.game-native-review"]
  );

  const promoted = cloneLoaded(loaded);
  promoted.courses.find(({ course }) => course.id === "es").course.status = "active";
  await assert.rejects(
    validateCourseCatalog(promoted, { checkExistence: false }),
    (error) => (
      hasIssue(error, "release.game-license", /es\.conjugation-comet/u)
      && hasIssue(error, "activation.game-native-review", /es\.conjugation-comet/u)
      && hasIssue(error, "release.game-license", /es\.agreement-aurora/u)
      && hasIssue(error, "activation.game-native-review", /es\.agreement-aurora/u)
    )
  );
  await assert.rejects(
    generateLauncherRegistry(promoted),
    (error) => (
      hasIssue(error, "release.game-license", /es\.conjugation-comet/u)
      && hasIssue(error, "activation.game-native-review", /es\.conjugation-comet/u)
      && hasIssue(error, "release.game-license", /es\.agreement-aurora/u)
      && hasIssue(error, "activation.game-native-review", /es\.agreement-aurora/u)
    )
  );
});

test("failure fixtures catch traversal, scope escape, missing paths, and file-kind drift", async () => {
  const traversal = {
    name: "repository traversal",
    code: "path.invalid",
    mutate(candidate) {
      candidate.courses[1].course.resources.embeddingCatalog.path = "../outside.json";
    }
  };
  await assertFixtureFails(loaded, traversal);

  const scopeEscape = {
    name: "course resource outside course root",
    code: "path.scope",
    mutate(candidate) {
      candidate.courses[1].course.resources.embeddingCatalog.path = "apps/languages/czech/static/data/embeddings/models.json";
    }
  };
  await assertFixtureFails(loaded, scopeEscape);

  const missing = cloneLoaded(loaded);
  missing.courses[1].course.resources.embeddingCatalog = {
    kind: "file",
    path: "apps/languages/mandarin-simplified/static/data/embeddings/definitely-missing.json",
    scope: "course",
    state: "present"
  };
  await assert.rejects(
    validateCourseCatalog(missing, { checkExistence: true }),
    (error) => hasIssue(error, "path.missing", /zh\.resources\.embeddingCatalog/)
  );

  const wrongKind = cloneLoaded(loaded);
  wrongKind.courses[0].course.resources.appEntry.kind = "directory";
  await assert.rejects(
    validateCourseCatalog(wrongKind, { checkExistence: true }),
    (error) => hasIssue(error, "path.kind", /cz\.resources\.appEntry/)
  );
});

test("route boundaries do not confuse canonical /zh with the reserved /zh-hans alias", async () => {
  await validateCourseCatalog(loaded, { checkExistence: false });
  const chinese = loaded.courses.find(({ course }) => course.id === "zh").course;
  assert.equal(chinese.routePrefix, "/zh");
});

test("course catalog and manifest symlinks cannot escape the repository", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "caatuu-course-catalog-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "caatuu-course-catalog-outside-"));
  try {
    await mkdir(path.join(repository, "apps", "languages"), { recursive: true });
    const outsideCatalog = path.join(outside, "catalog.json");
    await writeFile(outsideCatalog, "{}", "utf8");
    await symlink(outsideCatalog, path.join(repository, "apps", "languages", "catalog.json"), "file");
    await assert.rejects(
      loadCourseCatalog({ repoRoot: repository }),
      (error) => hasIssue(error, "catalog.path", /resolves outside repository root/u)
    );

    await rm(path.join(repository, "apps", "languages", "catalog.json"));
    const catalog = {
      $schema: "../../tools/language-packs/schemas/catalog.v1.schema.json",
      schemaVersion: 1,
      defaultCourseId: "xx",
      reservedRoutePrefixes: [],
      courses: [{ id: "xx", manifest: "apps/languages/fixture/course.json" }]
    };
    await writeFile(
      path.join(repository, "apps", "languages", "catalog.json"),
      JSON.stringify(catalog),
      "utf8"
    );
    const manifestDirectory = path.join(repository, "apps", "languages", "fixture");
    await mkdir(manifestDirectory, { recursive: true });
    const outsideManifest = path.join(outside, "course.json");
    await writeFile(outsideManifest, "{}", "utf8");
    await symlink(outsideManifest, path.join(manifestDirectory, "course.json"), "file");
    await assert.rejects(
      loadCourseCatalog({ repoRoot: repository }),
      (error) => hasIssue(error, "catalog.path", /outside its repository course root/u)
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
