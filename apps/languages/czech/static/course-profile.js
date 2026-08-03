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
        realizationPack: "data/curriculum/cs-CZ.realization-pack.v1.json?v=89d6c728e4929926",
        sourceCatalog: "data/curriculum/pilot-content-sources.v1.json?v=50ff3e7f35a5ce36",
        bindingRegistry: "data/curriculum/cs-CZ.cross-game-bindings.v1.json?v=aaf085b226243f22",
        sharedMechanicCapabilities: "data/curriculum/shared-mechanic-capabilities.v1.en.json",
        morphologyCatalog: "data/curriculum/cs-CZ.morphology-present-person-developer-pilot.v1.json?v=31ce75b2e464d308"
      },
      releasePins: {
        curriculumId: "caatuu.shared-beginner",
        curriculumVersion: "1.0.0",
        canonicalContractDigest: "sha256:ea771050c38c0bac732fa5ae02a0494b6505b98b8a635590ee3fa7ff2cb32dd9",
        targetPackId: "caatuu.cs-CZ.shared-beginner",
        targetPackVersion: "1.2.0",
        targetLocale: "cs-CZ",
        targetPackDigest: "sha256:89d6c728e49299260eba89f136ce046219384b6cd7f16aee1dc5f4217e87562a",
        sourceCatalogId: "caatuu.cs-CZ.cross-game-pilot-sources",
        sourceCatalogVersion: "1.6.0",
        sourceCatalogDigest: "sha256:50ff3e7f35a5ce3686ca128b66983460e2e4f5eba18b07a11dd49ca40e60c9df",
        bindingRegistryId: "caatuu.cs-CZ.cross-game-bindings",
        bindingRegistryVersion: "1.7.1",
        bindingRegistryDigest: "sha256:aaf085b226243f221a29ea3d113d78f2e61ad9d14d98697139ca88321b02bb29"
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
        stableContentId: "cs.morphology.cist.present-person-number.1sg",
        targetSkillId: "cs.skill.form.cist.present-person-number",
        assessedCapabilityId: "independent-form-discrimination",
        developerOnly: true,
        requiresPinnedCatalog: true,
        reviewStatus: "prototype-not-human-approved",
        releaseEnabled: false,
        optionCount: 6,
        sequence: {
          id: "sequence.conjugation-comet.cs.morphology.cist.present-person-number",
          revision: 1,
          orderedContentIds: [
            "cs.morphology.cist.present-person-number.1sg",
            "cs.morphology.cist.present-person-number.2sg",
            "cs.morphology.cist.present-person-number.3sg",
            "cs.morphology.cist.present-person-number.1pl",
            "cs.morphology.cist.present-person-number.2pl",
            "cs.morphology.cist.present-person-number.3pl"
          ],
          orderedBindingIds: [
            "binding.conjugation-comet.cs.morphology.cist.present-person-number.1sg",
            "binding.conjugation-comet.cs.morphology.cist.present-person-number.2sg",
            "binding.conjugation-comet.cs.morphology.cist.present-person-number.3sg",
            "binding.conjugation-comet.cs.morphology.cist.present-person-number.1pl",
            "binding.conjugation-comet.cs.morphology.cist.present-person-number.2pl",
            "binding.conjugation-comet.cs.morphology.cist.present-person-number.3pl"
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
