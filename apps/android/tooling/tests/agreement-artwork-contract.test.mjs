import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { transformSetupAssets, transformBundleSetupAssets } from "../build-product-assets.mjs";
import { assertSetupArtifactMetadata } from "../android-artifact-contract.mjs";

const repositoryRoot = new URL("../../../../", import.meta.url);
const validatorUrl = new URL(
  "apps/android/tooling/validate-product-package.mjs",
  repositoryRoot,
);

test("setup projection accepts new artwork paths and no artwork, retaining digest-bound legacy URLs and excluding every Chat file", () => {
  for (const digest of ["a".repeat(64), "b".repeat(64)]) {
    const artifact = {
      key: "planet-agreement-aurora", label: "A translated name", bytes: 42, sha256: digest,
      url: "/assets/illustrations/next-picture.png", asset_path: "assets/illustrations/next-picture.png",
    };
    const source = { artifacts: [artifact], offline: { assets: ["./app.js", "./chat.html", "./source/features/chat/new-module.js"] } };
    const output = JSON.parse(transformSetupAssets(JSON.stringify(source)));
    assert.equal(output.artifacts[0].url, `/assets/planets/releases/${digest.slice(0, 16)}/agreement-aurora.png`);
    assert.deepEqual({ ...output.artifacts[0], url: artifact.url }, artifact);
    assert.deepEqual(output.offline.assets, ["./app.js"]);
    assert.deepEqual(JSON.parse(transformSetupAssets(JSON.stringify({ ...source, artifacts: [] }))).artifacts, []);
    assert.deepEqual(JSON.parse(transformSetupAssets(JSON.stringify({ artifacts: [], offline: { assets: [] } }))).offline.assets, []);
    for (const invalid of [{ sha256: "bad" }, { bytes: 0 }, { asset_path: "../escape.png" }, { url: "https://untrusted.example/art.png" }]) {
      assert.throws(() => transformSetupAssets(JSON.stringify({ ...source, artifacts: [{ ...artifact, ...invalid }] })));
    }
  }
});

test("bundle setup projects any number of disabled Chat files and derives runtime downloads from their authority", () => {
  const artifact = { path: "vendor/transformers/transformers.min.js", url: "/language-runtime/vendor/transformers/transformers.min.js", bytes: 12, sha256: "a".repeat(64) };
  const catalog = { runtimes: [{ id: "fixture-runtime", artifacts: [artifact], runtime: { transformersModuleUrl: artifact.url } }] };
  const source = { artifacts: [], offline: { assets: ["./source/features/chat/another-file.js", "./keep.js"] } };
  const projected = JSON.parse(transformBundleSetupAssets(JSON.stringify(source), catalog, "fixture-runtime"));
  assert.deepEqual(projected.offline.assets, ["./keep.js", artifact.url]);
  assert.equal(projected.artifacts.length, catalog.runtimes[0].artifacts.length);
  assert.equal(projected.artifacts[0].sha256, artifact.sha256);
  assert.equal(projected.artifacts[0].native_required, true);
});
test("immutable artwork projection preserves the current source receipt and actual bytes", async () => {
  const source = JSON.parse(await readFile(new URL("apps/languages/czech/static/setup-assets.json", repositoryRoot), "utf8"));
  const transformed = JSON.parse(transformSetupAssets(JSON.stringify(source)));
  assertSetupArtifactMetadata(transformed);
  const originals = new Map(source.artifacts.map((artifact) => [artifact.key, artifact]));
  for (const artifact of transformed.artifacts.filter(({ url }) => url.includes("/releases/"))) {
    const original = originals.get(artifact.key);
    assert.ok(original, "a projected artifact must have a source authority");
    for (const field of ["bytes", "sha256", "asset_path"]) {
      assert.equal(artifact[field], original[field], `${artifact.key} preserves ${field}`);
    }
    const bytes = await readFile(new URL(`apps/launcher/static/${artifact.asset_path}`, repositoryRoot));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
    assert.ok(artifact.url.includes(`/releases/${artifact.sha256.slice(0, 16)}/`));
  }
});

test("the final archive audit uses generic receipt and bundled-byte validation", async () => {
  const validator = await readFile(validatorUrl, "utf8");
  assert.match(validator, /assertSetupArtifactMetadata\(setup,/u);
  assert.match(validator, /assertBundledSetupArtifacts\(setup,/u);
  assert.doesNotThrow(() => assertSetupArtifactMetadata({ artifacts: [] }));
});
