import assert from "node:assert/strict";
import test from "node:test";
import { NEW_APK_RESERVE_BYTES, PAGES_PAYLOAD_MAX_BYTES, assertNewApkFitsPagesReserve,
  projectPagesCapacity, validatePagesStoragePolicy } from "../pages-storage-policy.mjs";

const sha256 = "a".repeat(64);
const record = (path, bytes) => ({ path, bytes, sha256 });
const inventory = (files) => ({ files, payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0) });
const descriptor = { repository: "savethebeesandseeds/caatuu", releases: [163, 179, 180].map((versionCode) => ({ versionCode, apk: { bytes: 200, sha256 } })) };
const archived = { ...record("android/releases/163/caatuu.apk", 200), downloadUrl: "https://github.com/savethebeesandseeds/caatuu/releases/download/caatuu-android-v163/caatuu-163.apk" };

test("new signed APKs are bounded by each reserved copy while the hosting cap stays fixed", () => {
  assert.equal(NEW_APK_RESERVE_BYTES, 16_000_000);
  assert.equal(PAGES_PAYLOAD_MAX_BYTES, 1_000_000_000);
  assert.equal(assertNewApkFitsPagesReserve(1), 1);
  assert.equal(assertNewApkFitsPagesReserve(NEW_APK_RESERVE_BYTES), NEW_APK_RESERVE_BYTES);
  for (const bytes of [NEW_APK_RESERVE_BYTES + 1, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.throws(() => assertNewApkFitsPagesReserve(bytes));
  }
  const bytesBeforeTwoCopies = PAGES_PAYLOAD_MAX_BYTES - 2 * NEW_APK_RESERVE_BYTES;
  assert.equal(projectPagesCapacity({ inventory: inventory([record("site", bytesBeforeTwoCopies)]),
    apkReserveBytes: 2 * NEW_APK_RESERVE_BYTES }).remainingBytes, 0);
  assert.throws(() => projectPagesCapacity({ inventory: inventory([record("site", bytesBeforeTwoCopies + 1)]),
    apkReserveBytes: 2 * NEW_APK_RESERVE_BYTES }));
});

test("the new package creation bound does not change approved historical APK identities", () => {
  const historical = { ...archived, bytes: NEW_APK_RESERVE_BYTES + 1 };
  const historicalDescriptor = { ...descriptor, releases: descriptor.releases.map(release =>
    release.versionCode === 163 ? { ...release, apk: { ...release.apk, bytes: historical.bytes } } : release) };
  assert.deepEqual(validatePagesStoragePolicy({ schemaVersion: 1, archivedApks: [historical] }, historicalDescriptor), [historical]);
});

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
