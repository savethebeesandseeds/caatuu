import "./shell-policy.js";

const policy = globalThis.CaatuuShellPolicy;

if (!policy) {
  throw new Error("The shared Caatuu shell policy did not initialize.");
}

export const {
  PRIMARY_NAVIGATION,
  LEARNER_BASE_PRESENTATION_CONTRACT,
  PLANET_GAME_CONTRACT,
  NON_CAMPAIGN_GAME_REGISTRY,
  NON_CAMPAIGN_GAME_IDS,
  CAMPAIGN_GAME_IDS,
  GAME_IDS,
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
  targetScriptToken,
  deriveShellPolicy
} = policy;

export default policy;
