const MACAW_ACTION_ASSET_PREFIX = "/assets/macaw/actions/";

export const CHILD_FACING_EXCLUDED_MACAW_ACTIONS = Object.freeze([
  "bow_and_arrow",
  "draw_sword",
  "guard_stance",
  "space_sword",
  "sword_attack",
  "sword_block",
]);

export const CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS = Object.freeze([
  "/assets/macaw/actions/macaw (35).png",
  "/assets/macaw/actions/166-draw_sword.png",
  "/assets/macaw/actions/167-sword_attack.png",
  "/assets/macaw/actions/168-sword_block.png",
  "/assets/macaw/actions/169-bow_and_arrow.png",
  "/assets/macaw/actions/170-guard_stance.png",
]);

const excludedActions = new Set(CHILD_FACING_EXCLUDED_MACAW_ACTIONS);
const excludedAssetPaths = new Set(CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS);

export function normalizeMacawAction(value) {
  return String(value || "").trim().toLowerCase().replaceAll(" ", "_");
}

export function normalizeMacawActionAssetPath(value) {
  let assetPath = String(value || "").trim().replaceAll("\\", "/").split(/[?#]/u, 1)[0];
  if (assetPath.startsWith("assets/")) assetPath = `/${assetPath}`;
  try {
    assetPath = decodeURIComponent(assetPath);
  } catch {
    return "";
  }
  assetPath = assetPath.toLowerCase();
  return assetPath.startsWith(MACAW_ACTION_ASSET_PREFIX) ? assetPath : "";
}

export function isChildFacingMacawActionAssetAllowed(assetPath, action = "") {
  const normalizedPath = normalizeMacawActionAssetPath(assetPath);
  if (!normalizedPath) return false;
  return !excludedAssetPaths.has(normalizedPath)
    && !excludedActions.has(normalizeMacawAction(action));
}
