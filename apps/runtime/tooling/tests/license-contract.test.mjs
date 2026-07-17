import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

const [
  rootLicense,
  licensing,
  inventory,
  contributing,
  releasing,
  index,
  launcher,
  languagesSource,
  chrome,
  app,
  chat,
  chatHtml,
  routes,
  modelConfigsSource
] = await Promise.all([
  read("LICENSE"),
  read("docs/LICENSING.md"),
  read("docs/LEGAL_INVENTORY.md"),
  read(".github/CONTRIBUTING.md"),
  read("docs/RELEASING.md"),
  read("apps/launcher/static/index.html"),
  read("apps/launcher/static/launcher.js"),
  read("apps/launcher/static/languages.json"),
  read("apps/languages/czech/static/chrome.js"),
  read("apps/languages/czech/static/app.js"),
  read("apps/languages/czech/static/chat.js"),
  read("apps/languages/czech/static/chat.html"),
  read("apps/runtime/src/routes/mod.rs"),
  read("tools/on-device-models/model-configs.json")
]);

const languages = JSON.parse(languagesSource);
const modelConfigs = JSON.parse(modelConfigsSource);

test("first-party software is AGPL-3.0-only with explicit scope boundaries", () => {
  assert.match(rootLicense, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(rootLicense, /Version 3, 19 November 2007/);
  assert.match(licensing, /AGPL-3\.0-only/);
  assert.match(licensing, /Material with separate terms/);
  assert.match(licensing, /model weights, adapters, merged weights, and quantizations/);
  assert.match(licensing, /LICENSE-MIT-HISTORICAL/);
  assert.match(inventory, /STOP-SHIP/);
  assert.match(inventory, /qwen3-lora-003-hard/);
  assert.match(inventory, /Legacy Planet Word Net/);
  assert.match(contributing, /contributions are\s+temporarily paused/);
  assert.match(releasing, /Debug\s+paths must never be used as an automatic public fallback/);
});

test("product UI presents AGPL code terms without relicensing models or branding", () => {
  const productText = [chrome, app, chat].join("\n");
  assert.doesNotMatch(productText, /MIT app/);
  assert.doesNotMatch(productText, /Caatuu app code is provided under the MIT license/);
  assert.doesNotMatch(productText, /curriculum corpus, MIT/i);
  assert.doesNotMatch(productText, /Waajacu<\/a> TM|Waajacu<sup[^>]*>TM/);
  assert.match(chrome, /first-party software is licensed AGPL-3\.0-only/);
  assert.match(chrome, /provided without warranty/);
  assert.match(chrome, /github\.com\/savethebeesandseeds\/caatuu/);
  assert.match(chrome, /Models, dictionaries, datasets, artwork, branding, and third-party components keep their separate terms/);
  assert.match(app, /derived artifact review pending/);
  assert.match(chat, /derived artifact review pending/);
});

test("public Android discovery accepts only a non-debuggable release channel", () => {
  const czech = languages.languages.find((language) => language.id === "cz");
  assert.ok(czech);
  assert.deepEqual(czech.platforms.android.channels, [
    { manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk" }
  ]);
  assert.doesNotMatch(index, /caatuu-debug\.apk/);
  assert.match(index, /Checking signed beta/);
  assert.match(launcher, /manifest\?\.build_type !== "release"/);
  assert.match(launcher, /manifest\?\.debuggable !== false/);
  assert.doesNotMatch(launcher, /caatuu-debug/);
});

test("models under rights review are absent from selectors and blocked at the server", () => {
  const activeKeys = Object.entries(modelConfigs.models)
    .filter(([, model]) => model.status === "active" && !model.deprecated)
    .map(([key]) => key);
  assert.doesNotMatch(chatHtml, /qwen3-lora-003-hard|planet-wordnet-002-copy/);
  assert.doesNotMatch(chrome, /<option[^>]+(?:qwen3-lora-003-hard|planet-wordnet-002-copy)/);
  assert.ok(!activeKeys.includes("qwen3-lora-003-hard"));
  assert.ok(!activeKeys.includes("cstinyllama-1.2b-planet-wordnet-002-copy"));
  assert.match(routes, /qwen3-1\.7b-lora-003-hard\/\*path/);
  assert.match(routes, /cstinyllama-1\.2b-planet-wordnet-002-copy-q4_k_m\.gguf/);
});
