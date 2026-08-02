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
      conjugationComet: "conjugation-comet.html",
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
        sourceCatalogVersion: "1.5.0",
        sourceCatalogDigest: "sha256:f8a8d800e610d218590456047cdc80246554243940b82d7658acfc9c191be570",
        bindingRegistryId: "caatuu.cs-CZ.cross-game-bindings",
        bindingRegistryVersion: "1.6.0",
        bindingRegistryDigest: "sha256:15edc5609148121b8c72ca1da8a1273f2c63566c777929e3b5ad8470d8a70b47"
      },
      verbExerciseFamilies: {
        defaultFamily: "meaning",
        families: {
          meaning: {
            exerciseFamilyId: "verb-nebula.meaning-match",
            stableContentId: "cs.verb.cist.read",
            assessedCapabilityId: "independent-discrimination",
            developerOnly: false
          }
        }
      },
      conjugationComet: {
        enabled: true,
        activityId: "conjugation-comet",
        exerciseFamilyId: "conjugation-comet.contextual-target-realization",
        stableContentId: "cs.morphology.cist.present-singular-person.1sg",
        targetSkillId: "cs.skill.form.cist.present-singular-person",
        assessedCapabilityId: "independent-form-discrimination",
        developerOnly: true,
        requiresPinnedCatalog: true,
        reviewStatus: "prototype-not-human-approved",
        releaseEnabled: false,
        optionCount: 3,
        sequence: {
          id: "sequence.conjugation-comet.cs.morphology.cist.present-singular-person",
          revision: 1,
          orderedContentIds: [
            "cs.morphology.cist.present-singular-person.1sg",
            "cs.morphology.cist.present-singular-person.2sg",
            "cs.morphology.cist.present-singular-person.3sg"
          ],
          orderedBindingIds: [
            "binding.conjugation-comet.cs.morphology.cist.present-singular-person.1sg",
            "binding.conjugation-comet.cs.morphology.cist.present-singular-person.2sg",
            "binding.conjugation-comet.cs.morphology.cist.present-singular-person.3sg"
          ]
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
      conjugationComet: true,
      offlineModels: true,
      semanticSearch: true
    }
  });
})();
