(function attachCaatuuShellPolicy(root) {
  "use strict";

  const PRIMARY_NAVIGATION = Object.freeze([
    Object.freeze({ id: "home", label: "Home", route: "home" }),
    Object.freeze({ id: "games", label: "Games", route: "games" }),
    Object.freeze({ id: "backpack", label: "Backpack", route: "settings" })
  ]);

  const NON_CAMPAIGN_GAME_REGISTRY = Object.freeze({
    "verb-lab": Object.freeze({
      id: "verb-lab",
      route: "verbNebula",
      capabilities: Object.freeze([]),
      linguisticFeatures: Object.freeze([])
    }),
    "word-net": Object.freeze({
      id: "word-net",
      route: "wordWorld",
      capabilities: Object.freeze(["wordWorld"]),
      linguisticFeatures: Object.freeze([])
    }),
    "conjugation-comet": Object.freeze({
      id: "conjugation-comet",
      route: "conjugationComet",
      capabilities: Object.freeze(["conjugationComet"]),
      linguisticFeatures: Object.freeze(["verb-conjugation"])
    }),
    "case-cosmos": Object.freeze({
      id: "case-cosmos",
      route: "caseCosmos",
      capabilities: Object.freeze([]),
      linguisticFeatures: Object.freeze(["grammatical-case"])
    }),
    "agreement-aurora": Object.freeze({
      id: "agreement-aurora",
      route: "agreementAurora",
      capabilities: Object.freeze([]),
      linguisticFeatures: Object.freeze(["grammatical-agreement"])
    }),
    "memory-moon": Object.freeze({
      id: "memory-moon",
      route: "memoryMoon",
      capabilities: Object.freeze(["memory"]),
      linguisticFeatures: Object.freeze([])
    })
  });

  const NON_CAMPAIGN_GAME_IDS = Object.freeze([
    "verb-lab",
    "word-net",
    "conjugation-comet",
    "case-cosmos",
    "agreement-aurora",
    "memory-moon"
  ]);
  const GAME_IDS = Object.freeze(["campaign", ...NON_CAMPAIGN_GAME_IDS]);
  const LOCAL_AI_FEATURES = new Set(["generation", "chat"]);
  const LOCAL_AI_DISABLED_MESSAGE = "Local AI is currently disabled in this app. No model will be downloaded or loaded.";
  const LOCAL_AI_UNSUPPORTED_MESSAGE = "Local AI is not available for this course. These controls are disabled, and no generation model will be downloaded or loaded.";

  const SETTINGS_SECTION_REGISTRY = Object.freeze([
    Object.freeze({ id: "items", mode: "shared" }),
    Object.freeze({ id: "progress", mode: "shared" }),
    Object.freeze({ id: "appearance", mode: "shared" }),
    Object.freeze({ id: "course-storage", mode: "shared" }),
    Object.freeze({ id: "speech", mode: "all", capabilities: Object.freeze(["speech"]) }),
    Object.freeze({ id: "ai-model", mode: "shared" }),
    Object.freeze({ id: "chat", mode: "all", capabilities: Object.freeze(["chat"]) }),
    Object.freeze({ id: "dictionary", mode: "all", capabilities: Object.freeze(["dictionary"]) }),
    Object.freeze({
      id: "pronunciation",
      mode: "all",
      capabilities: Object.freeze(["pronunciationGuides"])
    })
  ]);

  function capabilityRecord(courseOrCapabilities) {
    if (!courseOrCapabilities || typeof courseOrCapabilities !== "object") return {};
    const nested = courseOrCapabilities.capabilities;
    return nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested
      : courseOrCapabilities;
  }

  function capabilityEnabled(capabilities, capability) {
    return capabilities[capability] === true;
  }

  function allCapabilitiesEnabled(capabilities, required) {
    return required.every((capability) => capabilityEnabled(capabilities, capability));
  }

  function declaredValues(courseOrCapabilities, name) {
    if (!courseOrCapabilities || typeof courseOrCapabilities !== "object") return new Set();
    return new Set(Array.isArray(courseOrCapabilities[name])
      ? courseOrCapabilities[name].filter((value) => typeof value === "string")
      : []);
  }

  function allLinguisticFeaturesDeclared(courseOrCapabilities, required) {
    const declared = declaredValues(courseOrCapabilities, "linguisticFeatures");
    return required.every((feature) => declared.has(feature));
  }

  function gameDeclared(courseOrCapabilities, gameId) {
    if (!courseOrCapabilities?.capabilities) {
      // Capability-only compatibility fixtures predate explicit course game
      // declarations. Keep their legacy Verb Nebula gate without imposing it
      // on modern language packs.
      if (gameId === "verb-lab") return courseOrCapabilities?.verbs === true;
      return true;
    }
    return declaredValues(courseOrCapabilities, "games").has(gameId);
  }

  function routeEnabled(courseOrCapabilities, route) {
    if (!courseOrCapabilities?.capabilities) return true;
    return nonEmptyString(courseOrCapabilities.routes?.[route]);
  }

  function deriveGameAvailability(courseOrCapabilities) {
    const capabilities = capabilityRecord(courseOrCapabilities);
    const availability = {};
    let playableNonCampaignGames = 0;

    for (const gameId of NON_CAMPAIGN_GAME_IDS) {
      const game = NON_CAMPAIGN_GAME_REGISTRY[gameId];
      const available = gameDeclared(courseOrCapabilities, gameId)
        && allCapabilitiesEnabled(capabilities, game.capabilities)
        && allLinguisticFeaturesDeclared(courseOrCapabilities, game.linguisticFeatures)
        && routeEnabled(courseOrCapabilities, game.route);
      availability[gameId] = available;
      if (available) playableNonCampaignGames += 1;
    }

    // Campaign Mode belongs to the shared shell. A language pack only declares
    // the games it can actually play; the shell can orchestrate even one game.
    availability.campaign = playableNonCampaignGames >= 1;
    return Object.freeze(availability);
  }

  function isGameAvailable(gameId, courseOrCapabilities) {
    const normalizedId = typeof gameId === "string" ? gameId.trim() : "";
    if (!GAME_IDS.includes(normalizedId)) return false;
    return deriveGameAvailability(courseOrCapabilities)[normalizedId] === true;
  }

  function availableGameIds(courseOrCapabilities) {
    const availability = deriveGameAvailability(courseOrCapabilities);
    return Object.freeze(GAME_IDS.filter((gameId) => availability[gameId] === true));
  }

  function availableGames(course) {
    return availableGameIds(course);
  }

  function gameState(courseOrCapabilities, gameId) {
    const normalizedId = typeof gameId === "string" ? gameId.trim() : "";
    if (!GAME_IDS.includes(normalizedId)) return "hidden";
    if (isGameAvailable(normalizedId, courseOrCapabilities)) return "playable";
    if (
      normalizedId !== "campaign"
      && declaredValues(courseOrCapabilities, "upcomingGames").has(normalizedId)
    ) return "upcoming";
    return "hidden";
  }

  function presentedGameIds(courseOrCapabilities) {
    return Object.freeze(GAME_IDS.filter((gameId) => gameState(courseOrCapabilities, gameId) !== "hidden"));
  }

  function hasAvailableGames(course) {
    return availableGames(course).length > 0;
  }

  function derivePrimaryNavigation(courseOrCapabilities) {
    const hasGames = availableGameIds(courseOrCapabilities).length > 0;
    return Object.freeze(PRIMARY_NAVIGATION.filter((item) => item.id !== "games" || hasGames));
  }

  function visiblePrimaryNavigation(course) {
    return Object.freeze(derivePrimaryNavigation(course).map((item) => item.id));
  }

  function sectionAvailable(section, capabilities) {
    if (section.mode === "shared") return true;
    if (section.mode === "any") {
      return section.capabilities.some((capability) => capabilityEnabled(capabilities, capability));
    }
    return allCapabilitiesEnabled(capabilities, section.capabilities);
  }

  function availableSettingsSectionIds(courseOrCapabilities) {
    const capabilities = capabilityRecord(courseOrCapabilities);
    return Object.freeze(
      SETTINGS_SECTION_REGISTRY
        .filter((section) => sectionAvailable(section, capabilities))
        .map((section) => section.id)
    );
  }

  function visibleSettings(course) {
    return availableSettingsSectionIds(course);
  }

  function gameAvailable(course, gameId) {
    return isGameAvailable(gameId, course);
  }

  function nonEmptyString(value) {
    return typeof value === "string" && Boolean(value.trim());
  }

  function localAiAvailability(course, runtime, feature) {
    const normalizedFeature = String(feature || "").trim();
    const capabilities = capabilityRecord(course);
    const supported = LOCAL_AI_FEATURES.has(normalizedFeature)
      && capabilities.llm === true
      && capabilities[normalizedFeature] === true;
    const reportedAvailability = runtime?.featureAvailability?.[normalizedFeature];
    const reportedEnabled = typeof reportedAvailability === "boolean"
      ? reportedAvailability
      : reportedAvailability?.enabled;
    const nativeGenerationEnabled = runtime?.env === "android"
      && typeof runtime?.models?.generate === "function";
    const runtimeEnabled = typeof reportedEnabled === "boolean"
      ? reportedEnabled
      : nativeGenerationEnabled;
    const enabled = supported && runtimeEnabled;
    return Object.freeze({
      feature: normalizedFeature,
      supported,
      enabled,
      reason: !supported ? "course-unsupported" : enabled ? "enabled" : "runtime-disabled",
      message: !supported
        ? LOCAL_AI_UNSUPPORTED_MESSAGE
        : enabled
          ? ""
          : LOCAL_AI_DISABLED_MESSAGE
    });
  }

  function resolveDeveloperLinkPath(course, definition) {
    if (nonEmptyString(definition.route)) {
      const route = course && typeof course === "object" ? course.routes?.[definition.route.trim()] : undefined;
      if (nonEmptyString(route)) return route.trim();
    }
    return nonEmptyString(definition.path) ? definition.path.trim() : "";
  }

  function isDeveloperLinkAvailable(course, definition) {
    if (!course || typeof course !== "object" || !definition || typeof definition !== "object") return false;
    if (!nonEmptyString(definition.capability)) return false;
    if (!capabilityEnabled(capabilityRecord(course), definition.capability.trim())) return false;
    return Boolean(resolveDeveloperLinkPath(course, definition));
  }

  function availableDeveloperLinks(course, definitions = []) {
    if (!Array.isArray(definitions)) return Object.freeze([]);
    return Object.freeze(definitions
      .filter((definition) => isDeveloperLinkAvailable(course, definition))
      .map((definition) => Object.freeze({
        ...definition,
        capability: definition.capability.trim(),
        href: resolveDeveloperLinkPath(course, definition)
      })));
  }

  function deriveShellPolicy(course, options = {}) {
    const gameAvailability = deriveGameAvailability(course);
    const gameStates = Object.freeze(Object.fromEntries(
      GAME_IDS.map((gameId) => [gameId, gameState(course, gameId)])
    ));
    return Object.freeze({
      primaryNavigation: derivePrimaryNavigation(course),
      gameAvailability,
      games: Object.freeze(GAME_IDS.filter((gameId) => gameAvailability[gameId] === true)),
      gameStates,
      presentedGames: presentedGameIds(course),
      settingsSections: availableSettingsSectionIds(course),
      developerLinks: availableDeveloperLinks(course, options.developerLinks)
    });
  }

  root.CaatuuShellPolicy = Object.freeze({
    PRIMARY_NAVIGATION,
    NON_CAMPAIGN_GAME_REGISTRY,
    SETTINGS_SECTION_REGISTRY,
    deriveGameAvailability,
    isGameAvailable,
    availableGameIds,
    availableGames,
    gameState,
    presentedGameIds,
    hasAvailableGames,
    gameAvailable,
    derivePrimaryNavigation,
    visiblePrimaryNavigation,
    availableSettingsSectionIds,
    visibleSettings,
    LOCAL_AI_DISABLED_MESSAGE,
    LOCAL_AI_UNSUPPORTED_MESSAGE,
    localAiAvailability,
    isDeveloperLinkAvailable,
    availableDeveloperLinks,
    deriveShellPolicy
  });
})(typeof globalThis === "object" ? globalThis : window);
