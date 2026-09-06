(() => {
  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  window.CaatuuCourse = deepFreeze({
    schemaVersion: 1,
    id: "es-en",
    status: "development",
    brandLabel: "Caatuu",
    workspaceLabel: "Caatuu Inglés",
    routePrefix: "/es-en",
    entryPath: "/es-en/index.html",
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
    targetLanguage: {
      id: "en",
      label: "English",
      nativeLabel: "English",
      shortCode: "EN",
      locale: "en-US",
      script: "Latn",
      speechLocale: "en-US",
      direction: "ltr",
      flagClass: "en-flag",
      flagSrc: "/assets/icons/english_flag.png"
    },
    languageRoles: {
      pair: "es-es->en-us",
      learnerBaseLanguage: "es-ES",
      interfaceLanguage: "es-ES",
      targetLanguage: "en-US",
      auditLanguage: "en",
      retrievalLanguage: "en"
    },
    interfaceContent: {
      schemaVersion: 1,
      locale: "es-ES",
      direction: "ltr",
      revision: "interface-es-2",
      catalog: "/language-runtime/static/data/interface/es.v1.json"
    },
    learnerBasePreview: true,
    linguisticFeatures: [
      "verb-conjugation",
      "grammatical-agreement"
    ],
    games: [
      "word-net",
      "conjugation-comet",
      "grammar-gravity",
      "sound-quasar"
    ],
    upcomingGames: [],
    languageAdapter: {
      schemaVersion: 1,
      module: "source/language/adapter.mjs"
    },
    browserProviders: {},
    gameContent: {
      "word-net": {
        wordWorldManifest: "data/games/word-world/manifest.json"
      },
      "conjugation-comet": {
        conjugationCometCatalog: "data/games/conjugation-comet/verbs.json?v=conjugation-comet-content-1"
      },
      "grammar-gravity": {
        grammarGravityCatalog: "data/games/grammar-gravity/challenges.json?v=grammar-gravity-content-2",
        grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-1"
      },
      "sound-quasar": {
        soundQuasarCatalog: "data/games/sound-quasar/challenges.json?v=sound-quasar-items-v2"
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
          developerContext: {
            gameContent: {
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
                caseCosmosCatalog: "data/games/case-cosmos/challenges.json?v=case-cosmos-data-6"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/challenges.json?v=grammar-gravity-data-5",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-3"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/challenges.json?v=sound-quasar-items-v2"
              }
            },
            dictionaryContent: {
              providerId: "czech-full-dictionary-v1",
              catalog: "data/dictionaries/catalog.json",
              coreEntries: "data/games/verb-nebula/core-vocabulary.json",
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
            revision: "interface-en-27",
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
                verbNebulaCatalog: "data/games/verb-nebula/core-vocabulary.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json"
              },
              "naturalization-nucleus": {
                naturalizationNucleusCatalog: "data/games/naturalization-nucleus/challenges.json"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/challenges.json?v=sound-quasar-items-v2"
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
            revision: "interface-en-27",
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
                verbNebulaCatalog: "data/games/verb-nebula/core-vocabulary.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/verbs.json?v=conjugation-comet-content-1"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/challenges.json?v=grammar-gravity-content-3",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-3"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/challenges.json?v=sound-quasar-items-v2"
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
            revision: "interface-en-27",
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
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/verbs.json?v=conjugation-comet-content-1"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/challenges.json?v=grammar-gravity-content-2",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-1"
              },
              "sound-quasar": {
                soundQuasarCatalog: "data/games/sound-quasar/challenges.json?v=sound-quasar-items-v2"
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
            revision: "interface-es-2",
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
        }
      ]
    },
    routes: {
      soundQuasar: "/language-runtime/static/games/sound-quasar.html",
      languageSelection: "/",
      home: "index.html",
      games: "index.html",
      wordWorld: "index.html?game=word-net",
      conjugationComet: "/language-runtime/static/games/conjugation-comet.html",
      grammarGravity: "/language-runtime/static/games/grammar-gravity.html",
      settings: "index.html"
    },
    storage: {
      namespace: "caatuu-es-en",
      theme: "caatuu-es-en.theme",
      fontSize: "caatuu-es-en.font-size",
      learningPreferences: "caatuu-es-en.learning.preferences.v1",
      learningPerformance: "caatuu-es-en.learning.performance.v1",
      semanticLearningDatabase: "caatuu-es-en.semantic-learning",
      verbMemory: "caatuu-es-en.verb-memory.v3",
      wordWorldTranslationMode: "caatuu-es-en.word-world.translation-mode",
      wordWorldRecentSentences: "caatuu-es-en.word-world.recent-sentences.v1"
    },
    cache: {
      prefix: "caatuu-es-en-pwa-",
      setupFallback: "caatuu-es-en-setup-v1"
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
        entryPath: "/es-en/index.html",
        backend: "static"
      },
      android: {
        enabled: false,
        channels: []
      }
    }
  });
})();
