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
  readme,
  runtimePackage,
  mlPackageSource,
  chrome,
  englishConceptsSource,
  mandarinRealizationsSource
] = await Promise.all([
  read("LICENSE"),
  read("docs/LICENSING.md"),
  read("docs/LEGAL_INVENTORY.md"),
  read("README.md"),
  read("apps/server/Cargo.toml"),
  read("tools/czech-ml/package.json"),
  read("apps/language-runtime/static/source/caatuu-chrome.js"),
  read("apps/languages/shared/english-concepts/word-world-starter-v1.json"),
  read("apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json")
]);

const englishConcepts = JSON.parse(englishConceptsSource);
const mandarinRealizations = JSON.parse(mandarinRealizationsSource);

test("first-party software and English/Mandarin curriculum are consistently AGPL-3.0-only", () => {
  assert.match(rootLicense, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(rootLicense, /Version 3, 19 November 2007/);
  assert.match(licensing, /AGPL-3\.0-only/);
  assert.match(readme, /AGPL-3\.0-only/);
  assert.match(runtimePackage, /license = "AGPL-3\.0-only"/);
  assert.equal(JSON.parse(mlPackageSource).license, "AGPL-3.0-only");
  assert.match(chrome, /first-party software, developer documentation, and first-party English and Mandarin curriculum are licensed AGPL-3\.0-only/);
  assert.match(chrome, /provided without warranty/);
  assert.match(chrome, /github\.com\/savethebeesandseeds\/caatuu/);
  for (const catalog of [englishConcepts, mandarinRealizations]) {
    assert.deepEqual(catalog.license, {
      origin: "caatuu-first-party-authored",
      status: "release-cleared",
      spdxExpression: "AGPL-3.0-only",
      sourceReference: "docs/LICENSING.md#first-party-curriculum",
      reviewedBy: "Caatuu project owner",
      reviewedAt: "2026-09-01T08:25:35Z"
    });
  }
  assert.match(licensing, /## First-party curriculum/);
  assert.match(inventory, /FP-006/);
});

test("the code license does not claim separate models, data, art, or branding", () => {
  assert.match(licensing, /Material with separate terms/);
  assert.match(licensing, /base-model weights, adapters, merged weights, and quantizations/);
  assert.match(licensing, /names, logos, domains, and package identity/);
  assert.match(inventory, /MODEL-001/);
  assert.match(inventory, /STOP-SHIP/);
  assert.match(chrome, /Third-party or separately licensed models, dictionaries, datasets, artwork, branding, and components keep their separate terms/);
});

test("historical MIT permissions are preserved as history", async () => {
  const historicalMit = await read("apps/server/LICENSE-MIT-HISTORICAL");
  assert.match(historicalMit, /^MIT License/);
  assert.match(licensing, /Permissions already granted for versions distributed under MIT remain valid/);
  assert.match(licensing, /LICENSE-MIT-HISTORICAL/);
});
