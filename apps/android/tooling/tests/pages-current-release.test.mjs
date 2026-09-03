import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  advancePagesCurrentReleaseDescriptor,
  assertPagesReleaseHistoryPrefix,
  pagesCurrentReleaseDownloadPlan,
  validatePagesCurrentReleaseDescriptor,
  validatePagesReleaseFiles,
  writePagesCurrentReleaseDescriptor,
} from "../pages-current-release.mjs";

const descriptor = JSON.parse(await readFile(new URL("../pages-current-release.json", import.meta.url), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const descriptorVersionCodes = descriptor.releases.map((release) => release.versionCode);
const currentRelease = descriptor.releases[descriptor.releases.length - 1];
const currentVersionCode = currentRelease.versionCode;
const previousStableVersionCode = descriptor.releases.length > 1
  ? descriptor.releases[descriptor.releases.length - 2].versionCode
  : descriptor.baselineStableVersionCode;
const nextVersionCode = currentVersionCode + 1;
const followingVersionCode = nextVersionCode + 1;

function futureRelease(versionCode, digestOffset = 0) {
  const digest = (offset) => ((digestOffset + offset) % 10).toString().repeat(64);
  return {
    versionCode,
    versionName: `0.1.${versionCode - 152}`,
    sourceRevision: ((digestOffset + 10) % 16).toString(16).repeat(40),
    manifest: { bytes: 1000 + versionCode, sha256: digest(1) },
    apk: { bytes: 20_000_000 + versionCode, sha256: digest(2) },
    receipt: { bytes: 1100 + versionCode, sha256: digest(3) },
  };
}

async function candidateFixture(versionCode = nextVersionCode) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "caatuu-pages-release-"));
  const releaseDir = join(workspaceRoot, "artifacts", "android", "releases", String(versionCode));
  await mkdir(releaseDir, { recursive: true });
  const apk = Buffer.from(`sealed-apk-${versionCode}\n`);
  const sourceRevision = "a".repeat(40);
  const versionName = `0.1.${versionCode - 152}`;
  const signer = "b".repeat(64);
  const sourceUrl = `https://github.com/savethebeesandseeds/caatuu/tree/${sourceRevision}`;
  const receipt = {
    schema_name: "caatuu-android-release-candidate",
    schema_version: 1,
    mode: "builder-emitted",
    repository: "savethebeesandseeds/caatuu",
    source_revision: sourceRevision,
    source_url: sourceUrl,
    identity: {
      package_name: "com.waajacu.caatuu",
      version_code: versionCode,
      version_name: versionName,
      build_type: "release",
      debuggable: false,
      signing_lineage: "direct-release-v1",
      signer_certificate_sha256: signer,
    },
    artifacts: {
      apk: { path: "artifacts/android/caatuu-universal.apk", bytes: apk.length, sha256: sha256(apk) },
      aab: { path: "artifacts/android/caatuu.aab", bytes: 7, sha256: "c".repeat(64) },
    },
    audit: { bundletool: "passed", product_package: "passed" },
  };
  const receiptRaw = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const manifest = {
    schema_version: 1,
    profile: "product",
    channel: "stable",
    signing_lineage: "direct-release-v1",
    package_name: "com.waajacu.caatuu",
    version_code: versionCode,
    version_name: versionName,
    build_type: "release",
    debuggable: false,
    apk_url: `https://caatuu.waajacu.com/android/releases/${versionCode}/caatuu.apk`,
    sha256: sha256(apk),
    bytes: apk.length,
    signer_certificate_sha256: signer,
    source_revision: sourceRevision,
    source_url: sourceUrl,
    audit: {
      bundletool: "passed",
      product_package: "passed",
      candidate_receipt_sha256: sha256(receiptRaw),
    },
  };
  const paths = {
    workspaceRoot,
    apkPath: join(releaseDir, "caatuu.apk"),
    manifestPath: join(releaseDir, "caatuu.json"),
    receiptPath: join(releaseDir, "caatuu-release-candidate.json"),
  };
  await Promise.all([
    writeFile(paths.apkPath, apk),
    writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(paths.receiptPath, receiptRaw),
  ]);
  return paths;
}

test("Pages stores an ordered overlay list and derives all release locations", () => {
  const value = validatePagesCurrentReleaseDescriptor(descriptor);
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.releases.length, descriptor.releases.length);
  assert.equal(value.stable.versionCode, currentVersionCode);
  assert.equal(value.previousStableVersionCode, previousStableVersionCode);
  assert.equal(value.compatibilityVersionCode, descriptor.compatibilityVersionCode);
  assert.equal(value.githubRelease.tag, `caatuu-android-v${currentVersionCode}`);
  assert.deepEqual(value.stable.apk.publicPaths, [
    `android/releases/${currentVersionCode}/caatuu.apk`,
    "android/caatuu.apk",
  ]);
  assert.equal(value.stable.apk.sourcePath, `artifacts/android/releases/${currentVersionCode}/caatuu.apk`);
  assert.equal(value.stable.apk.releaseAssetName, `caatuu-${currentVersionCode}.apk`);
  assert.equal(
    value.stable.apk.downloadUrl,
    `https://github.com/savethebeesandseeds/caatuu/releases/download/caatuu-android-v${currentVersionCode}/caatuu-${currentVersionCode}.apk`,
  );
});

test("the validated download plan contains every derived immutable release asset", () => {
  const plan = pagesCurrentReleaseDownloadPlan(descriptor);
  assert.equal(plan.currentVersionCode, currentVersionCode);
  assert.equal(plan.assets.length, descriptor.releases.length * 3);
  assert.deepEqual(
    plan.assets.map((asset) => asset.kind),
    descriptor.releases.flatMap(() => ["apk", "manifest", "receipt"]),
  );
  assert.ok(plan.assets.every((asset) => descriptorVersionCodes.includes(asset.versionCode)));
  assert.ok(plan.assets.every((asset) => asset.downloadUrl.startsWith(
    `https://github.com/savethebeesandseeds/caatuu/releases/download/caatuu-android-v${asset.versionCode}/`,
  )));
});

test("multiple releases retain every immutable path while only the newest receives stable aliases", () => {
  const stored = { ...structuredClone(descriptor), releases: [...descriptor.releases, futureRelease(nextVersionCode)] };
  const value = validatePagesCurrentReleaseDescriptor(stored);
  assert.equal(value.previousStableVersionCode, currentVersionCode);
  assert.deepEqual(
    value.releases.map((release) => release.apk.publicPaths),
    [...descriptorVersionCodes, nextVersionCode].map((versionCode) => [`android/releases/${versionCode}/caatuu.apk`]),
  );
  assert.deepEqual(value.stable.apk.publicPaths, [
    `android/releases/${nextVersionCode}/caatuu.apk`,
    "android/caatuu.apk",
  ]);
  assert.equal(value.stable.versionCode, nextVersionCode);
  assert.deepEqual(
    pagesCurrentReleaseDownloadPlan(stored).releases.map((release) => release.versionCode),
    [...descriptorVersionCodes, nextVersionCode],
  );
});

test("descriptor-controlled paths, URLs, and unordered releases are rejected", () => {
  const injected = structuredClone(descriptor);
  injected.releases[0].apk.sourcePath = "../outside.apk";
  assert.throws(() => validatePagesCurrentReleaseDescriptor(injected), /fields changed/u);
  const wrongRepository = { ...structuredClone(descriptor), repository: "attacker/example" };
  assert.throws(() => validatePagesCurrentReleaseDescriptor(wrongRepository));
  const repeated = structuredClone(descriptor);
  repeated.releases.push(structuredClone(repeated.releases[0]));
  assert.throws(() => validatePagesCurrentReleaseDescriptor(repeated), /must increase/u);
});

test("the initial immutable release cannot be removed, replaced, or hash-drifted", () => {
  const removed = structuredClone(descriptor);
  removed.releases = [];
  assert.throws(() => validatePagesCurrentReleaseDescriptor(removed), /release list is empty/u);

  const replaced = structuredClone(descriptor);
  replaced.releases[0].sourceRevision = "d".repeat(40);
  assert.throws(() => validatePagesCurrentReleaseDescriptor(replaced), /exact immutable Android 163 record/u);

  const hashDrift = structuredClone(descriptor);
  hashDrift.releases[0].apk.sha256 = "e".repeat(64);
  assert.throws(() => validatePagesCurrentReleaseDescriptor(hashDrift), /exact immutable Android 163 record/u);
});

test("release-history comparison accepts only an exact prefix plus appended releases", () => {
  const withNext = { ...structuredClone(descriptor), releases: [...descriptor.releases, futureRelease(nextVersionCode)] };
  const withFollowing = {
    ...structuredClone(withNext),
    releases: [...withNext.releases, futureRelease(followingVersionCode, 4)],
  };
  assert.deepEqual(assertPagesReleaseHistoryPrefix(descriptor, descriptor), {
    previousReleaseCount: descriptor.releases.length,
    nextReleaseCount: descriptor.releases.length,
    addedVersionCodes: [],
    currentVersionCode,
  });
  assert.deepEqual(assertPagesReleaseHistoryPrefix(descriptor, withFollowing), {
    previousReleaseCount: descriptor.releases.length,
    nextReleaseCount: descriptor.releases.length + 2,
    addedVersionCodes: [nextVersionCode, followingVersionCode],
    currentVersionCode: followingVersionCode,
  });
  assert.throws(
    () => assertPagesReleaseHistoryPrefix(withNext, descriptor),
    /dropped 1 immutable release/u,
  );
  const changedNext = structuredClone(withFollowing);
  changedNext.releases[descriptor.releases.length].apk.sha256 = "f".repeat(64);
  assert.throws(
    () => assertPagesReleaseHistoryPrefix(withNext, changedNext),
    new RegExp(`changed immutable Android ${nextVersionCode}`, "u"),
  );
});

test("a finalized newer release appends once and then reuses exact facts", async (context) => {
  const files = await candidateFixture();
  context.after(() => rm(files.workspaceRoot, { recursive: true, force: true }));
  const first = advancePagesCurrentReleaseDescriptor({ descriptor, ...files });
  assert.equal(first.action, "append");
  assert.equal(first.versionCode, nextVersionCode);
  assert.equal(first.tag, `caatuu-android-v${nextVersionCode}`);
  assert.deepEqual(first.descriptor.releases.map((release) => release.versionCode), [
    ...descriptorVersionCodes,
    nextVersionCode,
  ]);
  const second = advancePagesCurrentReleaseDescriptor({ descriptor: first.descriptor, ...files });
  assert.equal(second.action, "reuse");
  assert.deepEqual(second.descriptor, first.descriptor);
});

test("the shared file validator rejects release schema, source, signing, and audit drift", async (context) => {
  const files = await candidateFixture();
  context.after(() => rm(files.workspaceRoot, { recursive: true, force: true }));
  const valid = validatePagesReleaseFiles({ descriptor, ...files });
  assert.equal(valid.record.versionCode, nextVersionCode);

  const manifest = JSON.parse(await readFile(files.manifestPath, "utf8"));
  manifest.audit.bundletool = "failed";
  await writeFile(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => validatePagesReleaseFiles({ descriptor, ...files }));

  manifest.audit.bundletool = "passed";
  manifest.signing_lineage = "unexpected-lineage";
  await writeFile(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => validatePagesReleaseFiles({ descriptor, ...files }));

  manifest.signing_lineage = "direct-release-v1";
  manifest.source_url = "https://example.invalid/source";
  await writeFile(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => validatePagesReleaseFiles({ descriptor, ...files }));

  manifest.source_url = `https://github.com/${descriptor.repository}/tree/${manifest.source_revision}`;
  await writeFile(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const receipt = JSON.parse(await readFile(files.receiptPath, "utf8"));
  receipt.schema_version = 2;
  await writeFile(files.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.throws(() => validatePagesReleaseFiles({ descriptor, ...files }));
});

test("same-version drift and backward releases fail closed", async (context) => {
  const newer = await candidateFixture();
  const older = await candidateFixture(descriptor.baselineStableVersionCode);
  context.after(() => Promise.all([
    rm(newer.workspaceRoot, { recursive: true, force: true }),
    rm(older.workspaceRoot, { recursive: true, force: true }),
  ]));
  const appended = advancePagesCurrentReleaseDescriptor({ descriptor, ...newer });
  const changedManifest = JSON.parse(await readFile(newer.manifestPath, "utf8"));
  changedManifest.device_smoke = "not-run";
  await writeFile(newer.manifestPath, `${JSON.stringify(changedManifest, null, 2)}\n`);
  assert.throws(
    () => advancePagesCurrentReleaseDescriptor({ descriptor: appended.descriptor, ...newer }),
    /differs from its immutable Pages release/u,
  );
  assert.throws(
    () => advancePagesCurrentReleaseDescriptor({ descriptor, ...older }),
    /Refusing to move Pages backward/u,
  );
});

test("atomic descriptor writes refuse a concurrent file change and clean their temporary directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "caatuu-pages-cas-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const descriptorDirectory = join(root, "apps", "android", "tooling");
  const descriptorPath = join(descriptorDirectory, "pages-current-release.json");
  await mkdir(descriptorDirectory, { recursive: true });
  const initialRaw = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`);
  await writeFile(descriptorPath, initialRaw);
  const driftedRaw = Buffer.concat([initialRaw, Buffer.from("\n")]);
  await writeFile(descriptorPath, driftedRaw);

  assert.throws(
    () => writePagesCurrentReleaseDescriptor({
      path: descriptorPath,
      workspaceRoot: root,
      descriptor,
      expectedDescriptorIdentity: { bytes: initialRaw.length, sha256: sha256(initialRaw) },
    }),
    /changed since it was read/u,
  );
  assert.deepEqual(await readFile(descriptorPath), driftedRaw);
  assert.deepEqual(
    (await readdir(descriptorDirectory)).filter((name) => name.startsWith(".pages-current-release-write-")),
    [],
  );
  assert.equal((await readdir(descriptorDirectory)).includes(".pages-current-release.lock"), false);
});

test("descriptor writes respect the same-directory cooperative lock", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "caatuu-pages-lock-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const descriptorDirectory = join(root, "apps", "android", "tooling");
  const descriptorPath = join(descriptorDirectory, "pages-current-release.json");
  const lockPath = join(descriptorDirectory, ".pages-current-release.lock");
  await mkdir(descriptorDirectory, { recursive: true });
  const raw = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`);
  await writeFile(descriptorPath, raw);
  await writeFile(lockPath, "held by another cooperating writer\n");

  assert.throws(
    () => writePagesCurrentReleaseDescriptor({
      path: descriptorPath,
      workspaceRoot: root,
      descriptor,
      expectedDescriptorIdentity: { bytes: raw.length, sha256: sha256(raw) },
    }),
    /EEXIST/u,
  );
  assert.deepEqual(await readFile(descriptorPath), raw);
  assert.equal(await readFile(lockPath, "utf8"), "held by another cooperating writer\n");
});
