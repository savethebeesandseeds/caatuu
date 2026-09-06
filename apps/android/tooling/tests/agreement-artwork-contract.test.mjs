import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { transformSetupAssets } from "../build-product-assets.mjs";

const repositoryRoot = new URL("../../../../", import.meta.url);
const setupUrl = new URL(
  "apps/languages/czech/static/setup-assets.json",
  repositoryRoot,
);
const artworkUrl = new URL(
  "apps/launcher/static/assets/planets/grammar-gravity.png",
  repositoryRoot,
);
const validatorUrl = new URL(
  "apps/android/tooling/validate-product-package.mjs",
  repositoryRoot,
);
const expectedRemoteUrl = "/assets/planets/releases/57561da01036cfce/agreement-aurora.png";
const expectedLocalPath = "assets/planets/grammar-gravity.png";
const expectedBytes = 1_003_117;
const expectedSha256 = "57561da01036cfce901243a4a4ea8a9cee25b34c089a324a76a64d85d4663c6d";

test("Grammar Gravity retains immutable download bytes with its renamed APK-local path", async () => {
  const source = await readFile(setupUrl, "utf8");
  const transformed = JSON.parse(transformSetupAssets(source));
  const matches = transformed.artifacts.filter(
    (artifact) => artifact.key === "planet-agreement-aurora",
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].url, expectedRemoteUrl);
  assert.equal(matches[0].asset_path, expectedLocalPath);
  assert.equal(matches[0].bytes, expectedBytes);
  assert.equal(matches[0].sha256, expectedSha256);

  const artwork = await readFile(artworkUrl);
  assert.equal((await stat(artworkUrl)).size, expectedBytes);
  assert.equal(createHash("sha256").update(artwork).digest("hex"), expectedSha256);
});

test("the final package audit enforces the immutable remote URL and canonical local path", async () => {
  const validator = await readFile(validatorUrl, "utf8");
  assert.match(validator, new RegExp(expectedRemoteUrl.replaceAll("/", "\\/"), "u"));
  assert.match(validator, new RegExp(expectedLocalPath.replaceAll("/", "\\/"), "u"));
  assert.match(validator, /assertAgreementArtworkBoundary\(setup, courseLabel\)/u);
});
