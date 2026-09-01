import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validatePagesCurrentReleaseDescriptor } from "../pages-current-release.mjs";

const descriptor = JSON.parse(await readFile(new URL("../pages-current-release.json", import.meta.url), "utf8"));

test("Pages pins stable 163 as a small overlay over preserved 162 and 161", () => {
  const value = validatePagesCurrentReleaseDescriptor(descriptor);
  assert.equal(value.stable.versionCode, 163);
  assert.equal(value.previousStableVersionCode, 162);
  assert.equal(value.compatibilityVersionCode, 161);
  assert.equal(value.stable.apk.sha256, "fd1d4bd283c558174eacd68e08c01a93235fae0b28970e6993e1e84a2d142545");
  assert.equal(value.stable.apk.bytes, 26553893);
  assert.deepEqual(value.setupEntries, [
    "assets/courses/cz/setup-assets.json",
    "assets/courses/zh/setup-assets.json",
  ]);
});

test("every 163 overlay file has an immutable GitHub Release URL", () => {
  const value = validatePagesCurrentReleaseDescriptor(descriptor);
  for (const record of [value.stable.apk, value.stable.manifest, value.stable.receipt]) {
    assert.match(record.downloadUrl, /\/releases\/download\/caatuu-android-v163\//u);
  }
});
