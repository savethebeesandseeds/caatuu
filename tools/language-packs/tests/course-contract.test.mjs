import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  checkGeneratedViews,
  CourseContractError,
  generateCourseSelectorAssetMappings,
  generateCourseProfileObject,
  generateCourseProfileSource,
  generateLauncherRegistry,
  loadCourseCatalog,
  validateCourseCatalog
} from "../lib/course-contract.mjs";

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
  assert.equal(generateCourseSelectorAssetMappings([...candidate.courses, third]).length, 3);

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
  await validateCourseCatalog(loaded, { checkExistence: false });
});

test("Czech mirrors the active registry, runtime profile, and resource catalogs", async () => {
  const czech = loaded.courses.find(({ course }) => course.id === "cz").course;
  assert.equal(czech.status, "active");
  assert.equal(czech.routePrefix, "/cz");
  assert.equal(czech.platforms.browser.backend, "czech-dictionary");
  assert.equal(czech.capabilities.llm, true);
  assert.equal(czech.capabilities.embeddings, true);
  assert.equal(czech.capabilities.speech, true);
  assert.equal(czech.routes.conjugationComet, "conjugation-comet.html");
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
  assert.equal(czech.resources.modelCatalog.path, "apps/languages/czech/static/data/models/models.json");
  assert.equal(czech.resources.wordWorldManifest.path, "apps/languages/czech/static/data/games/word-world/manifest.json");
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
  assert.equal(chinese.resources.dictionaryCatalog, undefined);
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
    expectedLauncher.browserSetup.courses.map(({ id, status, entryPath }) => ({ id, status, entryPath })),
    [
      { id: "cz", status: "active", entryPath: "/cz/index.html" },
      { id: "zh", status: "development", entryPath: "/zh/index.html" }
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
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      context.window.CaatuuCourse.courseSelector.courses.map(({ id, status }) => ({ id, status }))
    )),
    [
      { id: "cz", status: "active" },
      { id: "zh", status: "development" }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      context.window.CaatuuCourse.courseSelector.courses.map(({ sourceLanguage }) => sourceLanguage.id)
    )),
    ["en", "en"]
  );

  const mandarin = loaded.courses.find(({ course }) => course.id === "zh").course;
  const mandarinProfileSource = await readFile(
    new URL("../../../apps/languages/mandarin-simplified/static/source/shared/course-profile.js", import.meta.url),
    "utf8"
  );
  const mandarinContext = { window: {} };
  vm.runInNewContext(mandarinProfileSource, mandarinContext);
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
      name: "dictionary backend without dictionary capability",
      code: "backend.contradiction",
      mutate(candidate) {
        candidate.courses[0].course.capabilities.dictionary = false;
        delete candidate.courses[0].course.resources.dictionaryCatalog;
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
      name: "campaign without two playable games",
      code: "game.campaign",
      message: /campaign requires at least two other enabled games/,
      mutate(candidate) {
        candidate.courses[1].course.games = ["campaign", "word-net"];
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
