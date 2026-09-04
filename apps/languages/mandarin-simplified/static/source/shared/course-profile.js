(() => {
  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  window.CaatuuCourse = deepFreeze({
    schemaVersion: 1,
    id: "zh",
    status: "development",
    brandLabel: "Caatuu",
    workspaceLabel: "Caatuu Mandarin",
    routePrefix: "/zh",
    entryPath: "/zh/index.html",
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
      script: "Hans",
      speechLocale: "zh-CN",
      direction: "ltr",
      flagClass: "zh-hans-flag",
      flagSrc: "/assets/icons/china_flag.png"
    },
    linguisticFeatures: [
      "hanzi-pinyin"
    ],
    games: [
      "verb-lab",
      "word-net",
      "naturalization-nucleus"
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
      "naturalization-nucleus": {
        naturalizationNucleusCatalog: "data/games/naturalization-nucleus/challenges.json"
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
      naturalizationNucleus: "index.html?game=naturalization-nucleus",
      settings: "index.html"
    },
    storage: {
      namespace: "caatuu-zh-hans",
      theme: "caatuu-zh-hans.theme",
      fontSize: "caatuu-zh-hans.font-size",
      learningPreferences: "caatuu-zh-hans.learning.preferences.v1",
      learningPerformance: "caatuu-zh-hans.learning.performance.v1",
      semanticLearningDatabase: "caatuu-zh-hans.semantic-learning",
      verbMemory: "caatuu-zh-hans.verb-memory.v3",
      wordWorldTranslationMode: "caatuu-zh-hans.word-world.translation-mode",
      wordWorldRecentSentences: "caatuu-zh-hans.word-world.recent-sentences.v1"
    },
    cache: {
      prefix: "caatuu-zh-hans-pwa-",
      setupFallback: "caatuu-zh-hans-setup-v1"
    },
    capabilities: {
      llm: false,
      generation: false,
      chat: false,
      embeddings: true,
      semanticSearch: true,
      skillCompass: false,
      dictionary: false,
      memory: true,
      verbs: false,
      wordWorld: true,
      conjugationComet: false,
      offlineModels: false,
      speech: true,
      pronunciationGuides: false
    },
    skillCompass: null,
    platforms: {
      browser: {
        enabled: true,
        entryPath: "/zh/index.html",
        backend: "static"
      },
      android: {
        enabled: true,
        channels: [
          {
            kind: "release",
            manifest: "/android/caatuu.json",
            artifact: "/android/caatuu.apk",
            minimumVersionCode: 161
          },
          {
            kind: "preview",
            manifest: "/android/caatuu-preview.json",
            artifact: "/android/caatuu-preview.apk",
            minimumVersionCode: 161
          }
        ]
      }
    }
  });
})();
