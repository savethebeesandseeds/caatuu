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
      verbMemory: "caatuu-czech.verb-memory.v3",
      verbMemoryLegacy: "caatuu-czech.verb-memory.v2",
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
        bindingRegistry: "data/curriculum/cs-CZ.cross-game-bindings.v1.json",
        sharedMechanicCapabilities: "data/curriculum/shared-mechanic-capabilities.v1.en.json",
        morphologyCatalog: "data/curriculum/cs-CZ.morphology-developer-pilot.v1.json"
      },
      releasePins: {
        curriculumId: "caatuu.shared-beginner",
        curriculumVersion: "1.0.0",
        canonicalContractDigest: "sha256:ea771050c38c0bac732fa5ae02a0494b6505b98b8a635590ee3fa7ff2cb32dd9",
        targetPackId: "caatuu.cs-CZ.shared-beginner",
        targetPackVersion: "1.1.0",
        targetLocale: "cs-CZ",
        targetPackDigest: "sha256:07526a2a7b54c062aebbda21f4e3c41d43add1ebec1f928575a5d57bbeb2e461",
        sourceCatalogId: "caatuu.cs-CZ.cross-game-pilot-sources",
        sourceCatalogVersion: "1.4.0",
        sourceCatalogDigest: "sha256:a181e41db3b93f6f19e66dba7e13e61104089a719279d3e0baa56297a9b9cb7b",
        bindingRegistryId: "caatuu.cs-CZ.cross-game-bindings",
        bindingRegistryVersion: "1.5.0",
        bindingRegistryDigest: "sha256:7837b28bc69e453340ae1446565e4f639d0bc83f07abc631748be1d98094bdec"
      },
      verbExerciseFamilies: {
        queryParameter: "verb-family",
        defaultFamily: "meaning",
        families: {
          meaning: {
            exerciseFamilyId: "verb-nebula.meaning-match",
            stableContentId: "cs.verb.cist.read",
            assessedCapabilityId: "independent-discrimination",
            developerOnly: false
          },
          morphology: {
            exerciseFamilyId: "verb-nebula.contextual-target-realization",
            stableContentId: "cs.morphology.cist.present-singular-person.1sg",
            targetSkillId: "cs.skill.form.cist.present-singular-person",
            assessedCapabilityId: "independent-form-discrimination",
            developerOnly: true,
            requiresPinnedCatalog: true,
            optionCount: 3,
            sequence: {
              id: "sequence.verb-nebula.cs.morphology.cist.present-singular-person",
              revision: 1,
              orderedContentIds: [
                "cs.morphology.cist.present-singular-person.1sg",
                "cs.morphology.cist.present-singular-person.2sg",
                "cs.morphology.cist.present-singular-person.3sg"
              ],
              orderedBindingIds: [
                "binding.verb-nebula.cs.morphology.cist.present-singular-person.1sg",
                "binding.verb-nebula.cs.morphology.cist.present-singular-person.2sg",
                "binding.verb-nebula.cs.morphology.cist.present-singular-person.3sg"
              ]
            }
          }
        }
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
