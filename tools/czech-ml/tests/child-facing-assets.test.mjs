import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHILD_FACING_EXCLUDED_MACAW_ACTIONS,
  CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS,
  isChildFacingMacawActionAssetAllowed,
  normalizeMacawActionAssetPath,
} from "../../../apps/language-runtime/static/source/child-facing-assets.mjs";

const mlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(mlRoot, "..", "..");
const staticRoot = path.join(repoRoot, "apps", "languages", "czech", "static");
const launcherStaticRoot = path.join(repoRoot, "apps", "launcher", "static");
const keymapFile = path.join(launcherStaticRoot, "assets", "macaw", "actions", "keymaps.json");
const manifestFile = path.join(
  staticRoot,
  "data",
  "embeddings",
  "all-minilm-l6-v2-qint8-v0.1",
  "manifest.json",
);
const databaseFile = path.join(path.dirname(manifestFile), "caatuu-cz-curriculum.sqlite");

test("one central policy identifies the exact combat Macaw source assets", async () => {
  const keymap = JSON.parse(await fs.readFile(keymapFile, "utf8"));
  const excluded = Object.entries(keymap)
    .filter(([assetPath, metadata]) => !isChildFacingMacawActionAssetAllowed(assetPath, metadata.action));

  assert.deepEqual(
    excluded.map(([, metadata]) => metadata.action).sort(),
    [...CHILD_FACING_EXCLUDED_MACAW_ACTIONS].sort(),
  );
  assert.deepEqual(
    excluded.map(([assetPath]) => normalizeMacawActionAssetPath(assetPath)).sort(),
    [...CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS].sort(),
  );
  assert.equal(isChildFacingMacawActionAssetAllowed("/assets/macaw/actions/180-hear_listen.png", "hear_listen"), true);

  for (const [assetPath] of excluded) {
    const sourceFile = path.join(launcherStaticRoot, ...decodeURIComponent(assetPath).replace(/^\//u, "").split("/"));
    await fs.access(sourceFile);
  }
});

test("every child-facing Macaw consumer imports and enforces the central policy", async () => {
  const consumers = [
    path.join(repoRoot, "apps", "language-runtime", "static", "source", "caatuu-workspace.js"),
    path.join(staticRoot, "source", "games", "conjugation-comet", "conjugation-comet.js"),
    path.join(staticRoot, "source", "features", "embedding-images", "embedding-images.js"),
  ];
  for (const file of consumers) {
    const source = await fs.readFile(file, "utf8");
    assert.match(source, /child-facing-assets\.mjs\?v=child-facing-assets-2/u, file);
    assert.match(source, /isChildFacingMacawActionAssetAllowed/u, file);
  }

  const builder = await fs.readFile(path.join(mlRoot, "scripts", "build-curriculum-vector-db.mjs"), "utf8");
  assert.match(builder, /from "\.\.\/\.\.\/\.\.\/apps\/language-runtime\/static\/source\/child-facing-assets\.mjs"/u);
  assert.ok(builder.indexOf("partitionChildFacingAssetRows(allAssetRows)") < builder.indexOf("embedder.embedTexts("));

  const sharedAppAssets = JSON.parse(await fs.readFile(
    path.join(repoRoot, "apps", "language-runtime", "app-assets.json"),
    "utf8",
  ));
  assert.ok(sharedAppAssets.assets.some((asset) => (
    asset.output === "language-runtime/static/source/child-facing-assets.mjs"
  )));
});

test("the generated release vector index and setup catalog omit central-policy assets", async () => {
  const [manifest, keymap, setup] = await Promise.all([
    fs.readFile(manifestFile, "utf8").then(JSON.parse),
    fs.readFile(keymapFile, "utf8").then(JSON.parse),
    fs.readFile(path.join(staticRoot, "setup-assets.json"), "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.asset_counts.macaw_actions, 250);
  assert.equal(manifest.child_facing_asset_policy.excluded_asset_count, 6);
  assert.deepEqual(manifest.child_facing_asset_policy.excluded_macaw_actions, CHILD_FACING_EXCLUDED_MACAW_ACTIONS);
  assert.deepEqual(manifest.child_facing_asset_policy.excluded_macaw_asset_paths, CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS);

  const setupPaths = new Set(setup.artifacts.map((artifact) => normalizeMacawActionAssetPath(artifact.url)).filter(Boolean));
  for (const assetPath of CHILD_FACING_EXCLUDED_MACAW_ASSET_PATHS) {
    const encodedPath = Object.keys(keymap).find((candidate) => (
      normalizeMacawActionAssetPath(candidate) === assetPath
    ));
    assert.ok(encodedPath, assetPath);
    assert.equal(Object.hasOwn(keymap[encodedPath], "embedding"), false, encodedPath);
    assert.equal(setupPaths.has(assetPath), false, assetPath);
  }

  const require = createRequire(import.meta.url);
  const initSqlJs = require(path.join(staticRoot, "vendor", "sql.js", "sql-wasm.js"));
  const SQL = await initSqlJs({
    locateFile: () => path.join(staticRoot, "vendor", "sql.js", "sql-wasm.wasm"),
  });
  const db = new SQL.Database(await fs.readFile(databaseFile));
  try {
    const [result] = db.exec("SELECT asset_path, action FROM macaw_action_embedding_refs ORDER BY asset_path");
    const rows = (result?.values || []).map(([assetPath, action]) => ({ assetPath, action }));
    assert.equal(rows.length, 250);
    assert.equal(rows.every((row) => isChildFacingMacawActionAssetAllowed(row.assetPath, row.action)), true);
  } finally {
    db.close();
  }
});
