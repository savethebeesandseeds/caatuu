import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";
import {
  CHILD_FACING_EXCLUDED_MACAW_ACTIONS,
  CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS,
  isChildFacingMacawActionAssetAllowed,
  normalizeMacawActionAssetPath,
} from "../static/source/child-facing-assets.mjs";
import { normalizeImageCatalog } from "../static/source/english-image-search.mjs";

const root = new URL("../../../", import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const keymapPath = "apps/launcher/static/assets/macaw/actions/keymaps.json";

test("central policy identifies the exact retained combat Macaw sources", async () => {
  const keymap = await readJson(keymapPath);
  const excluded = Object.entries(keymap).filter(([path, entry]) => !isChildFacingMacawActionAssetAllowed(path, entry.action));
  assert.deepEqual(excluded.map(([, entry]) => entry.action).sort(), [...CHILD_FACING_EXCLUDED_MACAW_ACTIONS].sort());
  assert.deepEqual(excluded.map(([path]) => normalizeMacawActionAssetPath(path)).sort(), [...CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS].sort());
  assert.equal(isChildFacingMacawActionAssetAllowed("/assets/macaw/actions/180-hear_listen.png", "hear_listen"), true);
  for (const [path] of excluded) await access(new URL(`apps/launcher/static${decodeURIComponent(path)}`, root));
});

test("shared catalog normalization filters central-policy assets before ranking", async () => {
  const keymap = await readJson(keymapPath);
  const rows = normalizeImageCatalog(keymap, "macaw_action_asset");
  const expected = Object.keys(keymap).filter(path => isChildFacingMacawActionAssetAllowed(path, keymap[path].action)).sort();
  assert.deepEqual(rows.map(row => row.path).sort(), expected);
});

test("the shared artwork index and setup catalog omit central-policy assets", async () => {
  const [index, keymap, setup] = await Promise.all([
    readJson("apps/language-runtime/static/data/image-embeddings/minilm-v1.json"),
    readJson(keymapPath),
    readJson("apps/languages/czech/static/setup-assets.json"),
  ]);
  const rows = index.rows.filter(row => row.sourceKind === "macaw_action_asset");
  const allowed = Object.keys(keymap).filter(path => isChildFacingMacawActionAssetAllowed(path, keymap[path].action));
  assert.deepEqual(rows.map(row => row.path).sort(), allowed.sort());
  const setupPaths = new Set(setup.artifacts.map(artifact => normalizeMacawActionAssetPath(artifact.url)).filter(Boolean));
  for (const assetPath of CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS) {
    const encoded = Object.keys(keymap).find(path => normalizeMacawActionAssetPath(path) === assetPath);
    assert.ok(encoded, assetPath);
    assert.equal(Object.hasOwn(keymap[encoded], "embedding"), false, encoded);
    assert.equal(setupPaths.has(assetPath), false, assetPath);
  }
});
