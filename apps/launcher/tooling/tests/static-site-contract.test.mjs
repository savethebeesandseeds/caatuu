import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compileStaticSite, validateStaticSite } from "../build-static-site.mjs";
import { createInterfaceContent } from "../../../language-runtime/static/source/interface-content.mjs";

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
    assert.equal(manifest.publishedVisualAssets, 691);
    assert.equal(manifest.basePath, "/");
    const languageIndex = readFileSync(join(outputDir, "cz/index.html"), "utf8");
    assert.match(languageIndex, /data-i18n="dictionary\.full\.subtitle">static web dictionary<\/small>/u);
    assert.match(languageIndex, /aria-label="Web dictionary controls" data-i18n-aria-label="dictionary\.full\.controls"/u);
    const interfaceContent = createInterfaceContent(JSON.parse(readFileSync(
      join(outputDir, "language-runtime/static/data/interface/en.v1.json"), "utf8"
    )));
    assert.equal(interfaceContent.t("dictionary.full.subtitle"), "static web dictionary",
      "interface initialization must preserve the static dictionary description");
    assert.equal(interfaceContent.t("dictionary.full.controls"), "Web dictionary controls");
    assert.equal(interfaceContent.t("dictionary.full.download"), "Static dictionary");
    assert.match(interfaceContent.t("dictionary.full.search.help"), /865-record curated learning dictionary/u);
    const chrome = readFileSync(join(outputDir, "language-runtime/static/source/caatuu-chrome.js"), "utf8");
    assert.match(chrome, /class="settings-card side-card developer-tools-card"/u);
    const serviceWorker = readFileSync(join(outputDir, "sw.js"), "utf8");
    for (const sharedAsset of [
      "/language-runtime/static/source/word-world-provider.mjs",
      "/language-runtime/static/source/product-word-world.mjs",
      "/language-runtime/static/styles/caatuu-word-world.css",
      "/language-runtime/static/source/developer-tools/developer-tools.mjs",
      "/language-runtime/static/source/developer-tools/audio-lab.mjs",
      "/language-runtime/static/source/developer-tools/catalog-inspectors.mjs",
      "/language-runtime/static/source/developer-tools/model-tools.mjs",
      "/language-runtime/static/source/developer-tools/browser-model-service.mjs",
      "/language-runtime/static/styles/caatuu-developer-tools.css"
    ]) {
      assert.ok(serviceWorker.includes(JSON.stringify(sharedAsset)), `${sharedAsset} must be available on the first offline return`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
