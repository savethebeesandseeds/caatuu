import assert from "node:assert/strict";
import test from "node:test";
import { projectPagesCapacity, validatePagesStoragePolicy } from "../pages-storage-policy.mjs";

const sha256 = "a".repeat(64);
const record = (path, bytes) => ({ path, bytes, sha256 });
const inventory = (files) => ({ files, payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0) });
const descriptor = { repository: "savethebeesandseeds/caatuu", releases: [163, 179, 180].map((versionCode) => ({ versionCode, apk: { bytes: 200, sha256 } })) };
const archived = { ...record("android/releases/163/caatuu.apk", 200), downloadUrl: "https://github.com/savethebeesandseeds/caatuu/releases/download/caatuu-android-v163/caatuu-163.apk" };

test("projection deduplicates setup objects, replaces only mutable aliases, and reserves APK space", () => {
  const result = projectPagesCapacity({ inventory: inventory([record("android/caatuu.apk", 20), record("asset", 30)]),
    additions: [record("asset", 30), record("new", 10), record("new", 10), record("android/caatuu.apk", 25)], apkReserveBytes: 100 });
  assert.equal(result.projectedBytes, 165);
  assert.throws(() => projectPagesCapacity({ inventory: inventory([record("asset", 30)]), additions: [record("asset", 31)] }), /Immutable/);
});

test("oversized projection fails before a build and approved retirement cannot remove other bytes", () => {
  const live = inventory([record("large", 999_999_800), archived]);
  assert.throws(() => projectPagesCapacity({ inventory: live, apkReserveBytes: 1 }), /before Gradle/);
  assert.equal(projectPagesCapacity({ inventory: live, archivedApks: [archived], apkReserveBytes: 100 }).projectedBytes, 999_999_900);
  assert.throws(() => projectPagesCapacity({ inventory: live, archivedApks: [{ ...archived, sha256: "b".repeat(64) }] }), /identity/);
});

test("archive policy pins historical APK identity and archive URL and preserves recent versions", () => {
  assert.deepEqual(validatePagesStoragePolicy({ schemaVersion: 1, archivedApks: [archived] }, descriptor), [archived]);
  for (const altered of [{ ...archived, path: "assets/setup/anything" }, { ...archived, bytes: 201 },
    { ...archived, downloadUrl: "https://elsewhere.invalid/app.apk" }, { ...archived, path: "android/releases/179/caatuu.apk" }]) {
    assert.throws(() => validatePagesStoragePolicy({ schemaVersion: 1, archivedApks: [altered] }, descriptor));
  }
});
