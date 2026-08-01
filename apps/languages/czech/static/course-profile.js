(() => {
  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  window.CaatuuCourse = deepFreeze({
    schemaVersion: 1,
    id: "cz",
    status: "active",
    brandLabel: "Caatuu",
    workspaceLabel: "Caatuu Czech",
    routePrefix: "/cz",
    entryPath: "/cz/home.html",
    sourceLanguage: {
      id: "en",
      label: "English",
      locale: "en"
    },
    targetLanguage: {
      id: "cs",
      label: "Czech",
      nativeLabel: "Čeština",
      shortCode: "CZ",
      locale: "cs-CZ",
      direction: "ltr",
      flagClass: "cz-flag",
      flagSrc: "/assets/icons/czech_flag_ui.png"
    },
    routes: {
      languageSelection: "/",
      home: "home.html",
      games: "index.html",
      settings: "index.html?settings=1"
    },
    storage: {
      namespace: "caatuu-czech",
      theme: "caatuu-czech.theme",
      fontSize: "caatuu-czech.font-size",
      learningPreferences: "caatuu-czech.learning.preferences.v1",
      learningPerformance: "caatuu-czech.learning.performance.v1",
      semanticLearningDatabase: "caatuu-czech.semantic-learning",
      chatSettings: "caatuu-czech.chat.settings.v1",
      verbMemory: "caatuu-czech.verb-memory.v2",
      wordWorldTranslationMode: "caatuu-czech.wordNet.translationMode",
      wordWorldRecentSentences: "caatuu-czech.wordNet.recentSentences.v1",
      wordWorldTranslationCache: "caatuu-czech.wordNet.translationCache.v1"
    },
    curriculum: {
      schemaVersion: 1,
      paths: {
        canonicalManifest: "data/curriculum/canonical-curriculum.v1.en.json",
        realizationPack: "data/curriculum/cs-CZ.realization-pack.v1.json",
        sourceCatalog: "data/curriculum/pilot-content-sources.v1.json",
        bindingRegistry: "data/curriculum/cs-CZ.cross-game-bindings.v1.json"
      },
      releasePins: {
        curriculumId: "caatuu.shared-beginner",
        curriculumVersion: "1.0.0",
        canonicalContractDigest: "sha256:ea771050c38c0bac732fa5ae02a0494b6505b98b8a635590ee3fa7ff2cb32dd9",
        targetPackId: "caatuu.cs-CZ.shared-beginner",
        targetPackVersion: "1.0.0",
        targetLocale: "cs-CZ",
        targetPackDigest: "sha256:5be7e8dea2b427d6195d2f50cf99c9b49d538f25cfd2f404f81d0d8bd46eb7f2",
        sourceCatalogId: "caatuu.cs-CZ.cross-game-pilot-sources",
        sourceCatalogVersion: "1.0.0",
        sourceCatalogDigest: "sha256:e571f49d35d062ba6b9db7eb1e2aa84e4617f62380fa9a30dad13d40e1123476",
        bindingRegistryId: "caatuu.cs-CZ.cross-game-bindings",
        bindingRegistryVersion: "1.0.0",
        bindingRegistryDigest: "sha256:57d2d214291db6f44fc85dcd41cef24be4d1e2ba52452571cbec6c3c1e4e7be5"
      },
      guidedMode: {
        enabled: true,
        developerOnly: true,
        developerQueryParameter: "curriculum-guided"
      },
      approval: {
        status: "prototype-not-human-approved",
        releaseEnabled: false
      }
    },
    cache: {
      prefix: "caatuu-czech-pwa-",
      setupFallback: "caatuu-czech-setup-v1"
    },
    capabilities: {
      chat: true,
      dictionary: true,
      memory: true,
      verbs: true,
      wordWorld: true,
      offlineModels: true,
      semanticSearch: true
    }
  });
})();
