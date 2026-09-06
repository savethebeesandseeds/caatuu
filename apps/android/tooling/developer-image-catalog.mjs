import { isChildFacingMacawActionAssetAllowed } from "../../language-runtime/static/source/child-facing-assets.mjs";

const IMAGE_PREFIXES = ["/assets/miscellaneous/", "/assets/macaw/actions/"];
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif"]);

function imageOutputPath(value) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  let path;
  try { path = decodeURIComponent(value.startsWith("assets/") ? `/${value}` : value); }
  catch { return ""; }
  const prefix = IMAGE_PREFIXES.find((candidate) => path.startsWith(candidate));
  if (!prefix) return "";
  const filename = path.slice(prefix.length);
  if (!filename || /[/\\?#\u0000-\u001f]/u.test(filename)
      || !IMAGE_EXTENSIONS.has(filename.split(".").at(-1).toLowerCase())) return "";
  return path;
}

function packagedImagePaths(assets) {
  if (!(assets instanceof Set) && !Array.isArray(assets)) {
    throw new TypeError("Packaged assets must be an array of mappings or a Set of output paths.");
  }
  return new Set([...assets].map((asset) => imageOutputPath(
    typeof asset === "string" ? asset : asset?.output
  )).filter(Boolean));
}

/** Keep authoritative entries only for safe images that the package actually contains. */
export function filterPackagedImageKeymap(catalog, assets) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new TypeError("An image keymap must be a JSON object keyed by public asset paths.");
  }
  const outputs = packagedImagePaths(assets);
  return Object.fromEntries(Object.entries(catalog).filter(([key, metadata]) => {
    const path = imageOutputPath(key);
    if (!path || !outputs.has(path)) return false;
    return !path.startsWith("/assets/macaw/actions/")
      || isChildFacingMacawActionAssetAllowed(key, metadata?.action);
  }));
}

/** Text transform for exact shared-asset build and verification call sites. */
export function transformPackagedImageKeymap(input, assets) {
  const catalog = typeof input === "string" ? JSON.parse(input) : input;
  return `${JSON.stringify(filterPackagedImageKeymap(catalog, assets), null, 2)}\n`;
}
