import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PAGES_PAYLOAD_MAX_BYTES = 1_000_000_000;
export const NEW_APK_RESERVE_BYTES = 32_000_000;

export function validatePagesStoragePolicy(value, descriptor) {
  assert.deepEqual(Object.keys(value).sort(), ["archivedApks", "schemaVersion"]);
  assert.equal(value.schemaVersion, 1);
  assert.ok(Array.isArray(value.archivedApks));
  const seen = new Set();
  for (const record of value.archivedApks) {
    assert.deepEqual(Object.keys(record).sort(), ["bytes", "downloadUrl", "path", "sha256"]);
    const match = /^android\/releases\/([1-9][0-9]*)\/caatuu\.apk$/u.exec(record.path);
    assert.ok(match, "Only explicitly approved historical APK copies may be archived");
    assert.ok(!seen.has(record.path), "Duplicate archived APK path");
    seen.add(record.path);
    const version = Number(match[1]);
    const release = descriptor.releases.find(({ versionCode }) => versionCode === version);
    assert.ok(release && version < descriptor.releases.at(-2)?.versionCode,
      "Archive policy must preserve baseline, current and previous APKs");
    assert.equal(record.bytes, release.apk.bytes, "Archived APK byte count changed");
    assert.equal(record.sha256, release.apk.sha256, "Archived APK hash changed");
    assert.equal(record.downloadUrl,
      `https://github.com/${descriptor.repository}/releases/download/caatuu-android-v${version}/caatuu-${version}.apk`);
  }
  return value.archivedApks;
}

export function readPagesStoragePolicy(descriptor, path = fileURLToPath(new URL("./pages-storage-policy.json", import.meta.url))) {
  return validatePagesStoragePolicy(JSON.parse(readFileSync(
    path, "utf8")), descriptor);
}

/** Metadata-only projection: no APK build, asset materialization or publication. */
export function projectPagesCapacity({ inventory, additions = [], archivedApks = [], apkReserveBytes = 0, setupReserveBytes = 0 }) {
  const files = new Map(inventory.files.map((file) => [file.path, { ...file }]));
  assert.equal(files.size, inventory.files.length);
  assert.equal(inventory.payloadBytes, [...files.values()].reduce((sum, file) => sum + file.bytes, 0));
  let archivedBytes = 0;
  for (const record of archivedApks) {
    const existing = files.get(record.path);
    if (!existing) continue;
    assert.equal(existing.bytes, record.bytes, `Archive identity differs: ${record.path}`);
    assert.equal(existing.sha256, record.sha256, `Archive identity differs: ${record.path}`);
    files.delete(record.path);
    archivedBytes += existing.bytes;
  }
  const mutable = new Set(["android/caatuu.apk", "android/caatuu.json"]);
  const retired = new Set(archivedApks.map(({ path }) => path));
  for (const record of additions) {
    if (retired.has(record.path)) continue;
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0);
    assert.match(record.sha256, /^[a-f0-9]{64}$/u);
    const existing = files.get(record.path);
    if (existing && !mutable.has(record.path)) {
      assert.equal(existing.bytes, record.bytes, `Immutable Pages bytes differ: ${record.path}`);
      assert.equal(existing.sha256, record.sha256, `Immutable Pages hash differs: ${record.path}`);
    }
    files.set(record.path, { path: record.path, bytes: record.bytes, sha256: record.sha256 });
  }
  assert.ok(Number.isSafeInteger(apkReserveBytes) && apkReserveBytes >= 0);
  assert.ok(Number.isSafeInteger(setupReserveBytes) && setupReserveBytes >= 0);
  const projectedBytes = [...files.values()].reduce((sum, file) => sum + file.bytes, 0) + apkReserveBytes + setupReserveBytes;
  assert.ok(Number.isSafeInteger(projectedBytes) && projectedBytes <= PAGES_PAYLOAD_MAX_BYTES,
    `Projected Pages payload ${projectedBytes} exceeds the ${PAGES_PAYLOAD_MAX_BYTES}-byte hosting limit; resolve capacity before Gradle`);
  return { publishedBytes: inventory.payloadBytes, archivedBytes, apkReserveBytes, setupReserveBytes, projectedBytes,
    remainingBytes: PAGES_PAYLOAD_MAX_BYTES - projectedBytes };
}
