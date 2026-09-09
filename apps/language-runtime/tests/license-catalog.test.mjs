import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  firstPartyLicenseArtifacts, embeddingRuntimeLicenseArtifacts,
  wordWorldLicenseArtifact, nativeLicenseArtifacts, conceptLicenseArtifact
} from "../static/source/license-catalog.mjs";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const appAssets = await json("../app-assets.json");
const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url));
const notice = await json("../models/all-minilm-l6-v2-qint8-v0.1/runtime/THIRD_PARTY_NOTICES.json");

test("Caatuu has an explicit first-party license, with an exact offline copy of the root grant", async () => {
  const caatuu = firstPartyLicenseArtifacts().find(({ key }) => key === "caatuu-software");
  assert.equal(caatuu.license, "AGPL-3.0-only");
  const mapping = appAssets.assets.find(({ output }) => `/${output}` === caatuu.licenseUrl);
  assert.deepEqual(await read(mapping.source), await read("LICENSE"));
});

test("each embedding runtime component links to an actually packaged offline license text", async () => {
  const artifacts = embeddingRuntimeLicenseArtifacts(notice);
  assert.equal(artifacts.length, notice.components.length);
  for (const artifact of artifacts) {
    const pathname = artifact.licenseUrl.slice(1);
    const mapping = appAssets.assets.find(({ output }) => output === pathname);
    const path = mapping?.source || `apps/${pathname}`;
    const text = (await read(path)).toString();
    assert.match(text, /Apache License|MIT License/u, artifact.label);
    assert.doesNotMatch(artifact.licenseUrl, /\.json$/u, "metadata is not the complete license text");
  }
  assert.throws(() => embeddingRuntimeLicenseArtifacts({ components: [{ name: "unknown", license: "MIT" }] }), /offline license/);
});

for (const [directory, id] of [["czech", "cz"], ["mandarin-simplified", "zh"], ["spanish", "es"], ["english-from-spanish", "es-en"], ["norwegian-bokmal", "nb"]]) {
  test(`${id} content attribution uses that course's current manifest and preserves unresolved licenses`, async () => {
    const manifest = await json(`../../languages/${directory}/static/data/games/word-world/manifest.json`);
    const row = wordWorldLicenseArtifact(manifest, { courseId: id, sourceUrl: "data/games/word-world/manifest.json" });
    assert.equal(row.entryCount, manifest.recordCount);
    assert.equal(row.license, manifest.license?.spdxExpression || (id === "cz" ? "MIT" : "License review pending"));
    assert.ok(row.intendedUse.includes(manifest.corpusVersion));
    if (manifest.license?.status === "release-review-required") assert.equal(row.licenseUrl, "");
  });
}

test("Android includes explicit notices for every resolved native dependency and preserves attribution", async () => {
  const catalog = await json("../static/legal/android-dependencies.json");
  const rows = nativeLicenseArtifacts(catalog);
  assert.equal(new Set(rows.map(({ key }) => key)).size, catalog.components.length);
  const notices = (await read("apps/language-runtime/static/legal/ANDROID-NOTICES.txt")).toString();
  assert.match(notices, /Apache License/u);
  for (const component of catalog.components) {
    assert.ok(notices.includes(component.id));
    assert.ok(notices.includes(component.author));
    assert.match(component.pomSha256, /^[a-f0-9]{64}$/u);
  }
  assert.throws(() => nativeLicenseArtifacts({ components: [] }), /inventory/);
});

test("English concept licensing follows its authority and never supplies a missing grant", async () => {
  const catalog = await json("../static/data/english-concepts/word-world-starter-v1.json");
  const row = conceptLicenseArtifact(catalog, "/concepts.json");
  assert.equal(row.license, catalog.license.spdxExpression);
  assert.equal(row.entryCount, catalog.concepts.length);
  const pending = conceptLicenseArtifact({ ...catalog, license: null }, "/concepts.json");
  assert.equal(pending.license, "License review pending");
  assert.equal(pending.licenseUrl, "");
});
