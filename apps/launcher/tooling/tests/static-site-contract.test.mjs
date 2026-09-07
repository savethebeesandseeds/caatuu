import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
    for (const androidInstallerAsset of [
      "setup.html",
      "course-install.html",
      "language-runtime/static/source/course-setup.mjs",
      "language-runtime/static/styles/course-setup.css"
    ]) {
      assert.ok(!manifest.files.some(({ path }) => path === androidInstallerAsset),
        `${androidInstallerAsset} requires the APK registry and must not enter Pages`);
    }
    assert.equal(built.totalBytes, manifest.files.reduce((sum, file) => sum + file.bytes, 0)
      + statSync(join(outputDir, "caatuu-web-bundle.json")).size);
    const setup = JSON.parse(readFileSync(join(outputDir, "cz/setup-assets.json"), "utf8"));
    const sourceSetup = JSON.parse(readFileSync(new URL("../../../languages/czech/static/setup-assets.json", import.meta.url), "utf8"));
    const required = setup.artifacts.filter((artifact) => artifact.browser_required);
    assert.equal(manifest.requiredSetupArtifacts, required.length);
    assert.equal(built.setupRequiredBytes, required.reduce((sum, artifact) => sum + artifact.bytes, 0));
    assert.equal(manifest.publishedVisualAssets, sourceSetup.artifacts.filter((artifact) => artifact.artifact_kind === "visual-asset").length);
    assert.equal(manifest.basePath, "/");
    const launcherIndex = readFileSync(join(outputDir, "index.html"), "utf8");
    assert.match(launcherIndex, /\bdata-android-download\b/u);
    assert.doesNotMatch(launcherIndex, /data-i18n="launcher\.android\.(?:preview|checking)"|class="advanced-entry"/u,
      "interface initialization must not restore development-only launcher copy or links");
    const languageIndex = readFileSync(join(outputDir, "cz/index.html"), "utf8");
    const interfaceContent = createInterfaceContent(JSON.parse(readFileSync(
      join(outputDir, "language-runtime/static/data/interface/en.v1.json"), "utf8"
    )));
    for (const key of ["dictionary.full.subtitle", "dictionary.full.download", "dictionary.full.search.help"]) {
      const escapedKey = key.replaceAll(".", "\\.");
      const text = new RegExp(`<([a-z][a-z0-9]*)\\b(?=[^>]*\\bdata-i18n="${escapedKey}")[^>]*>([^<]*)<\\/\\1>`, "u").exec(languageIndex)?.[2];
      assert.equal(text, interfaceContent.t(key), `${key}: translation initialization must retain the projected static description`);
      assert.ok(text?.trim());
    }
    const controls = /<[^>]*\bdata-i18n-aria-label="dictionary\.full\.controls"[^>]*>/u.exec(languageIndex)?.[0];
    assert.equal(/\baria-label="([^"]*)"/u.exec(controls)?.[1], interfaceContent.t("dictionary.full.controls"));
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
