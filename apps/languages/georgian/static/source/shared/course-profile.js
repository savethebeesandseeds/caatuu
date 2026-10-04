(() => {
  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  window.CaatuuCourse = deepFreeze({
    schemaVersion: 1,
    id: "ka",
    status: "development",
    brandLabel: "Caatuu",
    workspaceLabel: "Caatuu Georgian",
    routePrefix: "/ka",
    entryPath: "/ka/index.html",
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
      id: "ka",
      label: "Georgian",
      nativeLabel: "ქართული",
      shortCode: "KA",
      locale: "ka",
      script: "Geor",
      speechLocale: "ka-GE",
      direction: "ltr",
      flagClass: "georgian-flag",
      flagSrc: "/assets/icons/georgian_flag.svg"
    },
    languageRoles: {
      pair: "en->ka",
      learnerBaseLanguage: "en",
      interfaceLanguage: "en",
      targetLanguage: "ka",
      auditLanguage: "en",
      retrievalLanguage: "en"
    },
    interfaceContent: {
      schemaVersion: 1,
      locale: "en",
      direction: "ltr",
      revision: "interface-en-42",
      catalog: "/language-runtime/static/data/interface/en.v1.json"
    },
    learnerBasePreview: false,
    linguisticFeatures: [
      "verb-conjugation",
      "grammatical-agreement",
      "grammatical-case"
    ],
    games: [
      "verb-lab",
      "word-net",
      "conjugation-comet",
      "grammar-gravity"
    ],
    upcomingGames: [
      "memory-moon"
    ],
    languageAdapter: {
      schemaVersion: 1,
      module: "source/language/adapter.mjs"
    },
    browserProviders: {},
    gameContent: {
      "verb-lab": {
        verbNebulaCatalog: "data/games/verb-nebula/content.json"
      },
      "word-net": {
        wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-content-2"
      },
      "conjugation-comet": {
        conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-content-2"
      },
      "grammar-gravity": {
        grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-content-1",
        grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-2"
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
            revision: "interface-en-42",
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
            revision: "interface-en-42",
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
            revision: "interface-en-42",
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
            revision: "interface-es-17",
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
            revision: "interface-en-42",
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
        },
        {
          id: "ar",
          status: "development",
          routePrefix: "/ar",
          entryPath: "/ar/index.html",
          storage: {
            learningPerformance: "caatuu-ar.learning.performance.v1"
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
            revision: "interface-en-42",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "ar",
            label: "Modern Standard Arabic",
            nativeLabel: "العربية الفصحى",
            shortCode: "AR",
            locale: "ar",
            speechLocale: "ar",
            direction: "rtl",
            flagClass: "arabic-mark",
            flagSrc: "/assets/icons/arabic_mark.png"
          }
        },
        {
          id: "la",
          status: "development",
          routePrefix: "/la",
          entryPath: "/la/index.html",
          storage: {
            learningPerformance: "caatuu-la.learning.performance.v1"
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
            revision: "interface-en-42",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "la",
            label: "Scientific Latin",
            nativeLabel: "Latīnum scientificum",
            shortCode: "LA",
            locale: "la",
            speechLocale: "la",
            direction: "ltr",
            flagClass: "latin-mark",
            flagSrc: "/assets/icons/latin_mark.png"
          }
        },
        {
          id: "ka",
          status: "development",
          routePrefix: "/ka",
          entryPath: "/ka/index.html",
          storage: {
            learningPerformance: "caatuu-ka.learning.performance.v1"
          },
          developerContext: {
            gameContent: {
              "verb-lab": {
                verbNebulaCatalog: "data/games/verb-nebula/content.json"
              },
              "word-net": {
                wordWorldManifest: "data/games/word-world/manifest.json?v=word-world-content-2"
              },
              "conjugation-comet": {
                conjugationCometCatalog: "data/games/conjugation-comet/content.json?v=conjugation-comet-content-2"
              },
              "grammar-gravity": {
                grammarGravityCatalog: "data/games/grammar-gravity/content.json?v=grammar-gravity-content-1",
                grammarGravityNouns: "data/games/grammar-gravity/nouns.json?v=grammar-gravity-nouns-2"
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
            revision: "interface-en-42",
            catalog: "/language-runtime/static/data/interface/en.v1.json"
          },
          targetLanguage: {
            id: "ka",
            label: "Georgian",
            nativeLabel: "ქართული",
            shortCode: "KA",
            locale: "ka",
            speechLocale: "ka-GE",
            direction: "ltr",
            flagClass: "georgian-flag",
            flagSrc: "/assets/icons/georgian_flag.svg"
          }
        }
      ]
    },
    routes: {
      conjugationComet: "/language-runtime/static/games/conjugation-comet.html",
      grammarGravity: "/language-runtime/static/games/grammar-gravity.html",
      languageSelection: "/",
      home: "index.html",
      games: "index.html",
      verbNebula: "index.html?game=verb-lab",
      wordWorld: "index.html?game=word-net",
      settings: "index.html"
    },
    storage: {
      namespace: "caatuu-ka",
      theme: "caatuu-ka.theme",
      fontSize: "caatuu-ka.font-size",
      learningPreferences: "caatuu-ka.learning.preferences.v1",
      learningPerformance: "caatuu-ka.learning.performance.v1",
      semanticLearningDatabase: "caatuu-ka.semantic-learning",
      verbMemory: "caatuu-ka.verb-memory.v3",
      wordWorldTranslationMode: "caatuu-ka.word-world.translation-mode",
      wordWorldRecentSentences: "caatuu-ka.word-world.recent-sentences.v1"
    },
    cache: {
      prefix: "caatuu-ka-pwa-",
      setupFallback: "caatuu-ka-setup-v1"
    },
    capabilities: {
      llm: false,
      generation: false,
      chat: false,
      embeddings: true,
      semanticSearch: true,
      dictionary: false,
      memory: false,
      verbs: false,
      wordWorld: true,
      conjugationComet: true,
      offlineModels: false,
      speech: true,
      pronunciationGuides: false
    },
    learningGoals: [
      {
        id: "foundations",
        label: "Reading and first conversations",
        embeddingText: "Read Mkhedruli and use greetings, introductions, basic questions and polite requests.",
        categories: [
          "script",
          "foundations",
          "introductions"
        ]
      },
      {
        id: "daily-life",
        label: "Daily life in Georgia",
        embeddingText: "Talk about home, food, shopping, time, work, study and family.",
        categories: [
          "daily-life",
          "food",
          "shopping",
          "family"
        ]
      },
      {
        id: "getting-around",
        label: "Getting around and asking for help",
        embeddingText: "Ask for directions, use transport, arrange accommodation and describe a practical problem.",
        categories: [
          "travel",
          "directions",
          "services",
          "health"
        ]
      },
      {
        id: "connected-speech",
        label: "Connecting ideas and actions",
        embeddingText: "Use present, future and past actions with appropriate case marking, reasons, conditions and relative clauses.",
        categories: [
          "verb-forms",
          "case",
          "connected-speech"
        ]
      }
    ],
    platforms: {
      browser: {
        enabled: true,
        entryPath: "/ka/index.html",
        backend: "static"
      },
      android: {
        enabled: true,
        channels: [
          {
            kind: "release",
            manifest: "/android/caatuu.json",
            artifact: "/android/caatuu.apk",
            minimumVersionCode: 179
          },
          {
            kind: "preview",
            manifest: "/android/caatuu-preview.json",
            artifact: "/android/caatuu-preview.apk",
            minimumVersionCode: 179
          }
        ]
      }
    }
  });
})();
