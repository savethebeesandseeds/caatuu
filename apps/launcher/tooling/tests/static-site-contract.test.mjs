import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compileStaticSite, validateStaticSite } from "../build-static-site.mjs";

test("static compiler closes the complete Pages payload", { timeout: 300_000 }, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "caatuu-static-contract-"));
  const outputDir = join(temporaryRoot, "github-pages");
  try {
    const built = compileStaticSite({ outputDir });
    assert.equal(built.profile, "web-static-core");
    assert.ok(built.fileCount > 730, "the closed payload includes the canonical shared app graph");
    assert.ok(built.totalBytes < 800_000_000);
    assert.ok(built.setupRequiredBytes > 0 && built.setupRequiredBytes < 1024 * 1024);
    const firstManifest = JSON.parse(
      readFileSync(join(outputDir, "caatuu-web-bundle.json"), "utf8"),
    );

    const rebuilt = compileStaticSite({ outputDir });
    assert.deepEqual(rebuilt, built);

    const validated = validateStaticSite({ outputDir });
    assert.deepEqual(validated, built);
    const manifest = JSON.parse(readFileSync(join(outputDir, "caatuu-web-bundle.json"), "utf8"));
    assert.deepEqual(manifest, firstManifest);
    assert.equal(manifest.schema_name, "caatuu-web-bundle");
    assert.equal(manifest.schema_version, 1);
    assert.ok(!Object.hasOwn(manifest, "schemaName"));
    assert.ok(!Object.hasOwn(manifest, "schemaVersion"));
    assert.equal(manifest.payloadFileCount, built.fileCount - 1);
    assert.equal(manifest.requiredSetupArtifacts, 3);
    assert.equal(manifest.publishedVisualAssets, 647);
    assert.equal(manifest.basePath, "/");
    const serviceWorker = readFileSync(join(outputDir, "sw.js"), "utf8");
    for (const sharedAsset of [
      "/language-runtime/static/source/word-world-provider.mjs",
      "/language-runtime/static/source/product-word-world.mjs",
      "/language-runtime/static/styles/caatuu-word-world.css"
    ]) {
      assert.ok(serviceWorker.includes(JSON.stringify(sharedAsset)), `${sharedAsset} must be available on the first offline return`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
