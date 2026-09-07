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
      revision: "interface-en-31",
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
      semanticLearningProvider: "source/shared/semantic-learning.js?v=semantic-learning-8",
      setupProgressProvider: "source/features/setup/setup-progress.js?v=setup-progress-1",
      setupProvider: "source/features/setup/setup.js?v=setup-42"
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
            revision: "interface-en-31",
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
            revision: "interface-en-31",
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
            revision: "interface-en-31",
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
            revision: "interface-es-6",
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
      skillCompass: true,
      dictionary: true,
      memory: true,
      verbs: true,
      wordWorld: true,
      conjugationComet: true,
      offlineModels: true,
      speech: true,
      pronunciationGuides: false
    },
    skillCompass: {
      schemaVersion: 1,
      id: "cz-everyday-compass",
      version: "1.1.0",
      modelId: "all-minilm-l6-v2-qint8-v0.1",
      minimumConfidence: 0.12,
      copy: {
        eyebrow: "Your learning shape",
        title: "Skill compass",
        summary: "Lifetime map",
        chartTitle: "Lifetime Czech skill compass",
        chartDescription: "Practice and assessed strength across seven everyday Czech topics, each marked by its own emblem.",
        legendLabel: "Chart legend",
        practiceLabel: "Practice",
        strengthLabel: "Strength",
        confidenceLabel: "Confidence",
        progressLabel: "Skill compass mapping progress",
        notMapped: "Not mapped",
        building: "Building",
        notAssessed: "Not assessed",
        idleMessage: "Your saved learning evidence becomes the shape shown here.",
        emptyChartDescription: "No semantic learning evidence has been recorded yet.",
        emptyMessage: "Play Verb Nebula or explore Word World to begin your compass.",
        emptySummary: "No map yet",
        projectionDescription: "Lifetime semantic map with practice evidence on {practicedCount} of {topicCount} topics and reportable strength on {strengthCount}.",
        unmappedMessage: "Your saved evidence has not reached these topic axes yet. Keep exploring.",
        practiceOnlyMessage: "Practice is mapped. More scored activities will reveal Strength.",
        partialStrengthMessage: "Lifetime practice is mapped. More scored activities will complete the Strength shape.",
        completeMessage: "Lifetime map ready. Topic axes can overlap and do not add to 100%.",
        loadingMessage: "Mapping your journey...",
        loadingSummary: "Mapping",
        errorMessage: "The compass could not be mapped just now. Your progress is still saved.",
        errorSummary: "Try again",
        changedMessage: "Your saved learning evidence changed. Open the compass to refresh.",
        closedMessage: "Open the compass when you want to map your saved learning evidence.",
        updateReadySummary: "Update ready",
        closedSummary: "Open to map"
      },
      axes: [
        {
          id: "people",
          label: "People & feelings",
          chartLabel: "People",
          emblem: "people",
          probe: {
            locale: "en",
            revision: "1",
            text: "Talk about people, relationships, feelings, greetings, help, and personal needs in Czech."
          }
        },
        {
          id: "home-school",
          label: "Home & school",
          chartLabel: "Home & school",
          emblem: "home",
          probe: {
            locale: "en",
            revision: "1",
            text: "Handle home objects, school activities, learning, play, and everyday technology in Czech."
          }
        },
        {
          id: "food-shopping",
          label: "Food & choices",
          chartLabel: "Food & choices",
          chartLabelBelow: true,
          emblem: "food",
          probe: {
            locale: "en",
            revision: "1",
            text: "Discuss food and meals, shop with money and prices, make choices, and ask politely in Czech."
          }
        },
        {
          id: "places-travel",
          label: "Places & journeys",
          chartLabel: "Places & travel",
          emblem: "journey",
          probe: {
            locale: "en",
            revision: "1",
            text: "Find places, understand directions, describe movement, and use transport safely in Czech."
          }
        },
        {
          id: "actions-abilities",
          label: "Actions & abilities",
          chartLabel: "Actions",
          emblem: "actions",
          probe: {
            locale: "en",
            revision: "1",
            text: "Describe actions, abilities, instructions, and what people or things are doing in Czech."
          }
        },
        {
          id: "time-plans",
          label: "Time & plans",
          chartLabel: "Time & plans",
          chartLabelBelow: true,
          emblem: "time",
          probe: {
            locale: "en",
            revision: "1",
            text: "Tell time, describe daily routines, follow sequences, and make future plans in Czech."
          }
        },
        {
          id: "world-description",
          label: "World & description",
          chartLabel: "World",
          emblem: "world",
          probe: {
            locale: "en",
            revision: "1",
            text: "Describe animals, nature, weather, clothing, colors, and other qualities in Czech."
          }
        }
      ]
    },
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
