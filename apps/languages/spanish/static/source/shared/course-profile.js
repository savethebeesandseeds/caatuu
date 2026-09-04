(() => {
  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  window.CaatuuCourse = deepFreeze({
    schemaVersion: 1,
    id: "es",
    status: "development",
    brandLabel: "Caatuu",
    workspaceLabel: "Caatuu Spanish",
    routePrefix: "/es",
    entryPath: "/es/index.html",
    sourceLanguage: {
      id: "en",
      label: "English",
      nativeLabel: "English",
      shortCode: "EN",
      locale: "en",
      direction: "ltr",
      flagClass: "en-flag",
      flagSrc: "/assets/icons/english_flag.png"
    },
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
    },
    linguisticFeatures: [
      "verb-conjugation",
      "grammatical-agreement"
    ],
    games: [
      "verb-lab",
      "word-net",
      "conjugation-comet",
      "agreement-aurora"
    ],
    upcomingGames: [
      "memory-moon",
      "sound-quasar"
    ],
    languageAdapter: {
      schemaVersion: 1,
      module: "source/language/adapter.mjs"
    },
    browserProviders: {},
    gameContent: {
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
    },
    dictionaryContent: null,
    embeddingContent: {
      catalog: "data/embeddings/catalog.json"
    },
    courseSelector: {
      schemaVersion: 1,
      courses: [
        {
          id: "cz",
          status: "active",
          routePrefix: "/cz",
          entryPath: "/cz/index.html",
          storage: {
            learningPerformance: "caatuu-czech.learning.performance.v1"
          },
          sourceLanguage: {
            id: "en",
            label: "English",
            nativeLabel: "English",
            shortCode: "EN",
            locale: "en",
            direction: "ltr",
            flagClass: "en-flag",
            flagSrc: "/assets/icons/english_flag.png"
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
          }
        },
        {
          id: "zh",
          status: "development",
          routePrefix: "/zh",
          entryPath: "/zh/index.html",
          storage: {
            learningPerformance: "caatuu-zh-hans.learning.performance.v1"
          },
          sourceLanguage: {
            id: "en",
            label: "English",
            nativeLabel: "English",
            shortCode: "EN",
            locale: "en",
            direction: "ltr",
            flagClass: "en-flag",
            flagSrc: "/assets/icons/english_flag.png"
          },
          targetLanguage: {
            id: "zh",
            label: "Mandarin",
            nativeLabel: "中文",
            shortCode: "ZH",
            locale: "zh-Hans",
            direction: "ltr",
            flagClass: "zh-hans-flag",
            flagSrc: "/assets/icons/china_flag.png"
          }
        },
        {
          id: "es",
          status: "development",
          routePrefix: "/es",
          entryPath: "/es/index.html",
          storage: {
            learningPerformance: "caatuu-es.learning.performance.v1"
          },
          sourceLanguage: {
            id: "en",
            label: "English",
            nativeLabel: "English",
            shortCode: "EN",
            locale: "en",
            direction: "ltr",
            flagClass: "en-flag",
            flagSrc: "/assets/icons/english_flag.png"
          },
          targetLanguage: {
            id: "es",
            label: "Spanish",
            nativeLabel: "Español",
            shortCode: "ES",
            locale: "es-ES",
            direction: "ltr",
            flagClass: "spain-flag",
            flagSrc: "/assets/icons/spain_flag.png"
          }
        }
      ]
    },
    routes: {
      languageSelection: "/",
      home: "index.html",
      games: "index.html",
      verbNebula: "index.html?game=verb-lab",
      wordWorld: "index.html?game=word-net",
      conjugationComet: "/language-runtime/static/games/conjugation-comet.html",
      agreementAurora: "/language-runtime/static/games/agreement-aurora.html",
      settings: "index.html"
    },
    storage: {
      namespace: "caatuu-es",
      theme: "caatuu-es.theme",
      fontSize: "caatuu-es.font-size",
      learningPreferences: "caatuu-es.learning.preferences.v1",
      learningPerformance: "caatuu-es.learning.performance.v1",
      semanticLearningDatabase: "caatuu-es.semantic-learning",
      verbMemory: "caatuu-es.verb-memory.v3",
      wordWorldTranslationMode: "caatuu-es.word-world.translation-mode",
      wordWorldRecentSentences: "caatuu-es.word-world.recent-sentences.v1"
    },
    cache: {
      prefix: "caatuu-es-pwa-",
      setupFallback: "caatuu-es-setup-v1"
    },
    capabilities: {
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
    },
    skillCompass: null,
    platforms: {
      browser: {
        enabled: true,
        entryPath: "/es/index.html",
        backend: "static"
      },
      android: {
        enabled: false,
        channels: []
      }
    }
  });
})();
