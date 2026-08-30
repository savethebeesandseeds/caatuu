import "./shell-policy.js";

const policy = globalThis.CaatuuShellPolicy;

if (!policy) {
  throw new Error("The shared Caatuu shell policy did not initialize.");
}

export const {
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
} = policy;

export default policy;
