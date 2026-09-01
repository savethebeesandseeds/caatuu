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
  "apps/launcher/static/assets/planets/agreement-aurora.png",
  repositoryRoot,
);
const validatorUrl = new URL(
  "apps/android/tooling/validate-product-package.mjs",
  repositoryRoot,
);
const expectedRemoteUrl = "/assets/planets/releases/5fe5c25467d51dbe/agreement-aurora.png";
const expectedLocalPath = "assets/planets/agreement-aurora.png";
const expectedBytes = 1_258_690;
const expectedSha256 = "5fe5c25467d51dbec0c7e6600f187a685ccb0d42c34a47c3d1a737d2b6051966";

test("release 163 uses immutable Agreement Aurora download bytes without changing its APK-local path", async () => {
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
