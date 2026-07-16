import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

const [
  rootLicense,
  licensing,
  inventory,
  readme,
  runtimePackage,
  mlPackageSource,
  chrome
] = await Promise.all([
  read("LICENSE"),
  read("LICENSING.md"),
  read("LEGAL_INVENTORY.md"),
  read("README.md"),
  read("apps/caatuu-runtime/Cargo.toml"),
  read("tools/caatuu-cz-ml/package.json"),
  read("apps/caatuu-czech/static/chrome.js")
]);

test("first-party software is consistently AGPL-3.0-only", () => {
  assert.match(rootLicense, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(rootLicense, /Version 3, 19 November 2007/);
  assert.match(licensing, /AGPL-3\.0-only/);
  assert.match(readme, /AGPL-3\.0-only/);
  assert.match(runtimePackage, /license = "AGPL-3\.0-only"/);
  assert.equal(JSON.parse(mlPackageSource).license, "AGPL-3.0-only");
  assert.match(chrome, /first-party software is licensed AGPL-3\.0-only/);
  assert.match(chrome, /provided without warranty/);
  assert.match(chrome, /github\.com\/savethebeesandseeds\/caatuu/);
});

test("the code license does not claim separate models, data, art, or branding", () => {
  assert.match(licensing, /Material with separate terms/);
  assert.match(licensing, /base-model weights, adapters, merged weights, and quantizations/);
  assert.match(licensing, /names, logos, domains, and package identity/);
  assert.match(inventory, /MODEL-001/);
  assert.match(inventory, /STOP-SHIP/);
  assert.match(chrome, /Models, dictionaries, datasets, artwork, branding, and third-party components keep their separate terms/);
});

test("historical MIT permissions are preserved as history", async () => {
  const historicalMit = await read("apps/caatuu-runtime/LICENSE-MIT-HISTORICAL");
  assert.match(historicalMit, /^MIT License/);
  assert.match(licensing, /Permissions already granted for versions distributed under MIT remain valid/);
  assert.match(licensing, /LICENSE-MIT-HISTORICAL/);
});
