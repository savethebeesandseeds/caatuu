import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repoRoot), "utf8");
}

test("legal authorities consistently define first-party AGPL scope and preserve separate terms", async () => {
  const [
    rootLicense,
    licensing,
    inventory,
    historicalMit,
    cargo,
    mlPackageSource,
    englishConceptsSource,
    mandarinRealizationsSource,
  ] = await Promise.all([
    read("LICENSE"),
    read("docs/LICENSING.md"),
    read("docs/LEGAL_INVENTORY.md"),
    read("apps/server/LICENSE-MIT-HISTORICAL"),
    read("apps/server/Cargo.toml"),
    read("tools/czech-ml/package.json"),
    read("apps/languages/shared/english-concepts/word-world-starter-v1.json"),
    read("apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json"),
  ]);

  assert.match(rootLicense, /GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]*Version 3, 19 November 2007/u);
  assert.match(cargo, /license = "AGPL-3\.0-only"/u);
  assert.equal(JSON.parse(mlPackageSource).license, "AGPL-3.0-only");
  assert.match(licensing, /AGPL-3\.0-only[\s\S]*Material with separate terms/u);
  assert.match(licensing, /models[\s\S]*dictionaries[\s\S]*artwork[\s\S]*names, logos, domains/u);
  assert.match(inventory, /STOP-SHIP/u);
  assert.match(historicalMit, /^MIT License/u);
  assert.match(licensing, /LICENSE-MIT-HISTORICAL/u);

  for (const document of [JSON.parse(englishConceptsSource), JSON.parse(mandarinRealizationsSource)]) {
    assert.equal(document.license?.spdxExpression, "AGPL-3.0-only");
    assert.equal(document.license?.status, "release-cleared");
    assert.equal(document.license?.sourceReference, "docs/LICENSING.md#first-party-curriculum");
    assert.ok(document.license?.reviewedBy);
    assert.match(document.license?.reviewedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
  }
});

test("product surfaces disclose code terms and keep reviewed models and corpora explicit", async () => {
  const [chrome, workspace, routes, chatHtml, modelConfigsSource, wordWorldManifestSource] = await Promise.all([
    read("apps/language-runtime/static/source/caatuu-chrome.js"),
    read("apps/language-runtime/static/source/caatuu-workspace.js"),
    read("apps/server/src/routes/mod.rs"),
    read("apps/languages/czech/static/chat.html"),
    read("tools/on-device-models/model-configs.json"),
    read("apps/languages/czech/static/data/games/word-world/manifest.json"),
  ]);
  const productText = `${chrome}\n${workspace}`;
  assert.match(chrome, /first-party software and developer documentation are licensed AGPL-3\.0-only/u);
  assert.match(chrome, /First-party curriculum is licensed as stated in its tracked course metadata/u);
  assert.doesNotMatch(chrome, /first-party (?:English|Mandarin|Czech|Chinese) curriculum/iu);
  assert.match(chrome, /Third-party or separately licensed models, dictionaries, datasets, artwork, branding, and components keep their separate terms/u);
  assert.doesNotMatch(productText, /MIT app|Caatuu app code is provided under the MIT license/u);

  const wordWorldManifest = JSON.parse(wordWorldManifestSource);
  assert.match(workspace, /key: "caatuu-word-world-standard-v0\.1"/u);
  assert.match(workspace, new RegExp(`Corpus standard-v0\\.1 · ${wordWorldManifest.recordCount} rows`, "u"));

  const activeModels = Object.entries(JSON.parse(modelConfigsSource).models)
    .filter(([, model]) => model.status === "active" && !model.deprecated)
    .map(([key]) => key);
  assert.ok(!activeModels.includes("qwen3-lora-003-hard"));
  assert.ok(!activeModels.includes("cstinyllama-1.2b-planet-wordnet-002-copy"));
  assert.doesNotMatch(chatHtml, /qwen3-lora-003-hard|planet-wordnet-002-copy/u);
  assert.match(routes, /qwen3-1\.7b-lora-003-hard\/\*path/u);
  assert.match(routes, /cstinyllama-1\.2b-planet-wordnet-002-copy-q4_k_m\.gguf/u);
});

test("public discovery distinguishes stable Android releases from gated previews", async () => {
  const [languagesSource, launcher, index] = await Promise.all([
    read("apps/launcher/static/languages.json"),
    read("apps/launcher/static/launcher.js"),
    read("apps/launcher/static/index.html"),
  ]);
  const czech = JSON.parse(languagesSource).languages.find(({ id }) => id === "cz");
  assert.deepEqual(czech?.platforms.android.channels, [
    { kind: "release", manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk", minimumVersionCode: 160 },
    { kind: "preview", manifest: "/android/caatuu-preview.json", artifact: "/android/caatuu-preview.apk", minimumVersionCode: 160 },
  ]);
  assert.doesNotMatch(index, /caatuu-debug\.apk/u);
  assert.match(launcher, /channel\.kind === "preview"/u);
  assert.match(launcher, /manifest\.build_type === "debug" && manifest\.debuggable === true/u);
  assert.match(launcher, /manifest\.build_type === "release" && manifest\.debuggable === false/u);
  assert.match(launcher, /manifest\.version_code < channel\.minimumVersionCode/u);
});
