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
      "agreement-aurora"
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
      chat: "chat.html",
      audioLab: "audio-lab.html",
      dictionary: "index.html",
      embeddingImages: "embedding-images.html",
      verbDifficulty: "verb-difficulty.html",
      campaign: "index.html",
      verbNebula: "index.html",
      wordWorld: "index.html?game=word-net",
      conjugationComet: "conjugation-comet.html",
      caseCosmos: "case-cosmos.html",
      agreementAurora: "agreement-aurora.html",
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
        backend: "czech-dictionary"
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
