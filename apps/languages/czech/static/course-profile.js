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
      flagSrc: "/assets/icons/czech_flag.png"
    },
    routes: {
      languageSelection: "/",
      home: "home.html",
      games: "index.html#verbs",
      settings: "index.html#settings"
    },
    storage: {
      namespace: "caatuu-czech",
      theme: "caatuu-czech.theme",
      learningPreferences: "caatuu-czech.learning.preferences.v1",
      learningPerformance: "caatuu-czech.learning.performance.v1",
      chatSettings: "caatuu-czech.chat.settings.v1",
      verbMemory: "caatuu-czech.verb-memory.v2",
      wordWorldTranslationMode: "caatuu-czech.wordNet.translationMode",
      wordWorldRecentSentences: "caatuu-czech.wordNet.recentSentences.v1",
      wordWorldTranslationCache: "caatuu-czech.wordNet.translationCache.v1"
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
