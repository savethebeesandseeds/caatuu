import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setupArtifactSourcePath, sharedWordWorldGestureDelivery } from "../audit-runtime-boundary.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(root, "apps/language-runtime/app-assets.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "apps/languages/czech/static/setup-assets.json"), "utf8"));
const renderer = readFileSync(resolve(root, "apps/language-runtime/static/source/product-word-world.mjs"), "utf8");

test("the boundary audit follows the shared gesture owner's declared delivery instead of an inline implementation", () => {
  assert.equal(sharedWordWorldGestureDelivery(renderer, catalog), true);
  const owner = "language-runtime/static/source/horizontal-gesture.mjs";
  assert.equal(sharedWordWorldGestureDelivery(renderer, { assets: catalog.assets.filter((asset) => asset.output !== owner) }), false);
  assert.equal(sharedWordWorldGestureDelivery(renderer.replace("bindHorizontalGesture({", "retiredBinding({"), catalog), false);
  assert.equal(sharedWordWorldGestureDelivery(renderer.replace('"./horizontal-gesture.mjs"', '"https://outside.test/horizontal-gesture.mjs"'), catalog), false);
});

test("the setup audit uses canonical shared mappings, course queries and confined source resolution", () => {
  for (const key of ["horizontal-gesture", "grammar-gravity-nouns"]) {
    const artifact = manifest.artifacts.find((entry) => entry.key === key);
    assert.ok(artifact, `${key} is declared`);
    const source = setupArtifactSourcePath(artifact, manifest, catalog, root);
    assert.equal(readFileSync(source).length, artifact.bytes);
    assert.ok(!source.includes("?"));
  }
  const moved = { source: "apps/language-runtime/static/assets/initial-image.png", output: "assets/moved-image.png" };
  assert.equal(setupArtifactSourcePath({ key: "mapped", url: "/assets/moved-image.png?v=2" }, manifest, { assets: [moved] }, root), resolve(root, moved.source));
  assert.throws(() => setupArtifactSourcePath({ key: "escape", url: "/language-runtime/../../../outside" }, manifest, catalog, root), /escapes/u);
  assert.throws(() => setupArtifactSourcePath({ key: "unknown", url: "https://outside.test/file.js" }, manifest, catalog, root), /unsupported/u);
});
