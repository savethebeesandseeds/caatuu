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
      script: "Latn",
      speechLocale: "cs-CZ",
      direction: "ltr",
      flagClass: "cz-flag",
      flagSrc: "/assets/icons/czech_flag_ui.png"
    },
    languageRoles: {
      pair: "en->cs-cz",
      learnerBaseLanguage: "en",
      interfaceLanguage: "en",
      targetLanguage: "cs-CZ",
      auditLanguage: "en",
      retrievalLanguage: "en"
    },
    interfaceContent: {
      schemaVersion: 1,
      locale: "en",
      direction: "ltr",
      revision: "interface-en-38",
      catalog: "/language-runtime/static/data/interface/en.v1.json"
    },
    learnerBasePreview: false,
    linguisticFeatures: [
      "verb-conjugation",
      "grammatical-case",
      "grammatical-agreement"
    ],
    games: [
      "campaign",
      "verb-lab",
      "word-net",
      "conjugation-comet",
      "case-cosmos",
      "grammar-gravity",
      "sound-quasar"
    ],
    upcomingGames: [
      "memory-moon"
    ],
    languageAdapter: {
      schemaVersion: 1,
      module: "source/language/adapter.mjs"
    },
    browserProviders: {
      courseRuntime: "source/shared/runtime.js?v=runtime-42",
      setupProgressProvider: "source/features/setup/setup-progress.js?v=setup-progress-1",
      setupProvider: "source/features/setup/setup.js?v=setup-43"
    },
    gameContent: {
      "verb-lab": {
        verbNebulaCatalog: "data/games/verb-nebula/content.json"
      },
      "word-net": {
        wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-token-hints-1"
      },
      "conjugation-comet": {
        conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-verbs-5"
      },
      "case-cosmos": {
        caseCosmosCatalog: "data/games/case-cosmos/content.json?v=case-cosmos-data-8"
      },
      "grammar-gravity": {
        grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-data-7",
        grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-4"
      },
      "sound-quasar": {
        soundQuasarCatalog: "data/games/sound-quasar/content.json?v=sound-quasar-retained-levels-1"
      }
    },
    dictionaryContent: {
      catalog: "data/dictionaries/catalog.json",
      coreEntries: "data/games/verb-nebula/content.json",
      scriptLines: "data/language/scripts.json",
      referenceDocument: "data/dictionaries/reference.html",
      providerId: "czech-full-dictionary-v1",
      providerModule: "source/features/dictionary/dictionary-full.js?v=full-dictionary-7",
      gapReporting: {
        providerId: "czech-full-dictionary-v1",
        dictionaryKey: "kaikki-cs-en-2026-07-09",
        dictionaryDirection: "cs-en"
      }
    },
    embeddingContent: {
      catalog: "data/embeddings/models.json"
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
          developerContext: {
            gameContent: {
              "verb-lab": {
                verbNebulaCatalog: "data/games/verb-nebula/content.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-token-hints-1"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-verbs-5"
              },
              "case-cosmos": {
                caseCosmosCatalog: "data/games/case-cosmos/content.json?v=case-cosmos-data-8"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-data-7",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-4"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/content.json?v=sound-quasar-retained-levels-1"
              }
            },
            dictionaryContent: {
              providerId: "czech-full-dictionary-v1",
              catalog: "data/dictionaries/catalog.json",
              coreEntries: "data/games/verb-nebula/content.json",
              scriptLines: "data/language/scripts.json",
              referenceDocument: "data/dictionaries/reference.html"
            },
            embeddingContent: {
              catalog: "data/embeddings/models.json"
            }
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
          interfaceContent: {
            schemaVersion: 1,
            locale: "en",
            direction: "ltr",
            revision: "interface-en-38",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "cs",
            label: "Czech",
            nativeLabel: "Čeština",
            shortCode: "CZ",
            locale: "cs-CZ",
            speechLocale: "cs-CZ",
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
          developerContext: {
            gameContent: {
              "verb-lab": {
                verbNebulaCatalog: "data/games/verb-nebula/content.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json?v=catalog-files-2"
              },
              "naturalization-nucleus": {
                naturalizationNucleusCatalog: "data/games/naturalization-nucleus/content.json"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/content.json?v=sound-quasar-retained-levels-1"
              }
            },
            dictionaryContent: null,
            embeddingContent: {
              catalog: "data/embeddings/catalog.json"
            }
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
          interfaceContent: {
            schemaVersion: 1,
            locale: "en",
            direction: "ltr",
            revision: "interface-en-38",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "zh",
            label: "Mandarin",
            nativeLabel: "中文",
            shortCode: "ZH",
            locale: "zh-Hans",
            speechLocale: "zh-CN",
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
          developerContext: {
            gameContent: {
              "verb-lab": {
                verbNebulaCatalog: "data/games/verb-nebula/content.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-context-hints-1"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-content-1"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-content-3",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-4"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/content.json?v=sound-quasar-retained-levels-1"
              }
            },
            dictionaryContent: null,
            embeddingContent: {
              catalog: "data/embeddings/catalog.json"
            }
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
          interfaceContent: {
            schemaVersion: 1,
            locale: "en",
            direction: "ltr",
            revision: "interface-en-38",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "es",
            label: "Spanish",
            nativeLabel: "Español",
            shortCode: "ES",
            locale: "es-ES",
            speechLocale: "es-ES",
            direction: "ltr",
            flagClass: "spain-flag",
            flagSrc: "/assets/icons/spain_flag.png"
          }
        },
        {
          id: "es-en",
          status: "development",
          routePrefix: "/es-en",
          entryPath: "/es-en/index.html",
          storage: {
            learningPerformance: "caatuu-es-en.learning.performance.v1"
          },
          developerContext: {
            gameContent: {
              "verb-lab": {
                verbNebulaCatalog: "data/games/verb-nebula/content.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-context-hints-1"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-content-1"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-content-2",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-3"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/content.json?v=sound-quasar-items-v3"
              }
            },
            dictionaryContent: null,
            embeddingContent: {
              catalog: "data/embeddings/catalog.json"
            }
          },
          sourceLanguage: {
            id: "es",
            label: "Spanish",
            nativeLabel: "Español",
            shortCode: "ES",
            locale: "es-ES",
            direction: "ltr",
            flagClass: "spain-flag",
            flagSrc: "/assets/icons/spain_flag.png"
          },
          interfaceContent: {
            schemaVersion: 1,
            locale: "es-ES",
            direction: "ltr",
            revision: "interface-es-13",
            catalog: "/language-runtime/static/data/interface/es.v1.json"
          },
          targetLanguage: {
            id: "en",
            label: "English",
            nativeLabel: "English",
            shortCode: "EN",
            locale: "en-US",
            speechLocale: "en-US",
            direction: "ltr",
            flagClass: "en-flag",
            flagSrc: "/assets/icons/english_flag.png"
          }
        },
        {
          id: "nb",
          status: "development",
          routePrefix: "/nb",
          entryPath: "/nb/index.html",
          storage: {
            learningPerformance: "caatuu-nb.learning.performance.v1"
          },
          developerContext: {
            gameContent: {
              "verb-lab": {
                verbNebulaCatalog: "data/games/verb-nebula/content.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-content-1"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-content-1"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-content-1",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-1"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/content.json?v=sound-quasar-content-1"
              }
            },
            dictionaryContent: null,
            embeddingContent: {
              catalog: "data/embeddings/catalog.json"
            }
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
          interfaceContent: {
            schemaVersion: 1,
            locale: "en",
            direction: "ltr",
            revision: "interface-en-38",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "nb",
            label: "Norwegian Bokmål",
            nativeLabel: "Norsk bokmål",
            shortCode: "NB",
            locale: "nb-NO",
            speechLocale: "nb-NO",
            direction: "ltr",
            flagClass: "norway-flag",
            flagSrc: "/assets/icons/norway_flag.png"
          }
        }
      ]
    },
    routes: {
      soundQuasar: "/language-runtime/static/games/sound-quasar.html",
      languageSelection: "/",
      home: "index.html",
      games: "index.html",
      chat: "chat.html",
      audioLab: "audio-lab.html",
      dictionary: "index.html",
      embeddingImages: "embedding-images.html",
      verbDifficulty: "verb-difficulty.html",
      campaign: "index.html",
      verbNebula: "index.html",
      wordWorld: "index.html?game=word-net",
      conjugationComet: "/language-runtime/static/games/conjugation-comet.html",
      caseCosmos: "case-cosmos.html",
      grammarGravity: "/language-runtime/static/games/grammar-gravity.html",
      settings: "index.html"
    },
    storage: {
      namespace: "caatuu-czech",
      theme: "caatuu-czech.theme",
      fontSize: "caatuu-czech.font-size",
      learningPreferences: "caatuu-czech.learning.preferences.v1",
      learningPerformance: "caatuu-czech.learning.performance.v1",
      semanticLearningDatabase: "caatuu-czech.semantic-learning",
      chatSettings: "caatuu-czech.chat.settings.v1",
      verbMemory: "caatuu-czech.verb-memory.v3",
      verbMemoryLegacy: "caatuu-czech.verb-memory.v2",
      wordWorldTranslationMode: "caatuu-czech.wordNet.translationMode",
      wordWorldRecentSentences: "caatuu-czech.wordNet.recentSentences.v1",
      wordWorldTranslationCache: "caatuu-czech.wordNet.translationCache.v1"
    },
    cache: {
      prefix: "caatuu-czech-pwa-",
      setupFallback: "caatuu-czech-setup-v1"
    },
    capabilities: {
      llm: true,
      generation: true,
      chat: true,
      embeddings: true,
      semanticSearch: true,
      dictionary: true,
      memory: true,
      verbs: true,
      wordWorld: true,
      conjugationComet: true,
      offlineModels: true,
      speech: true,
      pronunciationGuides: false
    },
    learningGoals: [
      {
        id: "people",
        label: "People & conversations",
        embeddingText: "Talk with people about feelings, friendship and everyday conversations.",
        categories: [
          "people",
          "feelings",
          "friendship",
          "conversation"
        ]
      },
      {
        id: "home-school",
        label: "Home & school",
        embeddingText: "Talk about home, school, learning and everyday technology.",
        categories: [
          "home",
          "school",
          "technology"
        ]
      },
      {
        id: "food-shopping",
        label: "Food & shopping",
        embeddingText: "Talk about food, meals, shopping and things to buy.",
        categories: [
          "food",
          "shopping"
        ]
      },
      {
        id: "places-travel",
        label: "Places & travel",
        embeddingText: "Find places, describe locations and travel by different kinds of transport.",
        categories: [
          "location",
          "transport",
          "travel"
        ]
      },
      {
        id: "creative-play",
        label: "Play & creativity",
        embeddingText: "Talk about playing, music and creative activities.",
        categories: [
          "play",
          "music",
          "creativity"
        ]
      },
      {
        id: "time-plans",
        label: "Time & daily plans",
        embeddingText: "Tell the time, describe daily routines and make plans.",
        categories: [
          "time",
          "plans",
          "routine",
          "daily-life"
        ]
      },
      {
        id: "world-description",
        label: "Animals, nature & weather",
        embeddingText: "Describe animals, nature and the weather.",
        categories: [
          "animals",
          "nature",
          "weather"
        ]
      }
    ],
    platforms: {
      browser: {
        enabled: true,
        entryPath: "/cz/index.html",
        backend: "dictionary-api-v1"
      },
      android: {
        enabled: true,
        channels: [
          {
            kind: "release",
            manifest: "/android/caatuu.json",
            artifact: "/android/caatuu.apk",
            minimumVersionCode: 160
          },
          {
            kind: "preview",
            manifest: "/android/caatuu-preview.json",
            artifact: "/android/caatuu-preview.apk",
            minimumVersionCode: 160
          }
        ]
      }
    }
  });
})();
