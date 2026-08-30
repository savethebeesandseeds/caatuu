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
    linguisticFeatures: [],
    games: [
      "verb-lab",
      "word-net"
    ],
    upcomingGames: [
      "memory-moon"
    ],
    languageAdapter: {
      schemaVersion: 1,
      module: "source/language/adapter.mjs"
    },
    courseSelector: {
      schemaVersion: 1,
      courses: [
        {
          id: "cz",
          status: "active",
          routePrefix: "/cz",
          entryPath: "/cz/index.html",
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
        }
      ]
    },
    routes: {
      languageSelection: "/",
      home: "index.html",
      games: "index.html",
      verbNebula: "index.html?game=verb-lab",
      wordWorld: "index.html?game=word-net",
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
        enabled: false,
        channels: []
      }
    }
  });
})();
