import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { sha256Bytes } from "../pages-baseline.mjs";
import {
  createOverlayManifest,
  inventoryDigest,
  overlayAndroidReleaseSite,
  planAndroidReleaseOverlay,
  validatePreservedSite,
} from "../pages-android-overlay.mjs";

const origin = "https://caatuu.waajacu.com";
const identity = (content) => ({ bytes: Buffer.byteLength(content), sha256: sha256Bytes(content) });
const file = (path, content) => ({ path, ...identity(content) });
const byPath = (left, right) => left.path.localeCompare(right.path, "en");

function siteFixture(t, extra = {}) {
  const workspaceRoot = mkdtempSync(resolve(tmpdir(), "caatuu-overlay-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const siteDir = resolve(workspaceRoot, "artifacts/web/preserved");
  const payload = {
    "index.html": "<h1>Any interface wording can change independently.</h1>",
    "assets/artwork-new-name.png": "arbitrary artwork",
    "course-anything/index.html": "arbitrary language course",
    "sw.js": "const CACHE_NAME = 'preserve-this-exactly';",
    "android/caatuu.apk": "old apk",
    "android/caatuu.json": "old manifest",
    "android/releases/20/caatuu.apk": "old apk",
    ...extra,
  };
  for (const [path, content] of Object.entries(payload)) {
    const absolute = resolve(siteDir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  const files = Object.entries(payload).map(([path, content]) => file(path, content)).sort(byPath);
  const manifest = {
    schema_name: "caatuu-web-bundle",
    schema_version: 1,
    canonicalOrigin: origin,
    profile: "existing-published-profile",
    entrypoints: ["/", "/course-anything/"],
    serviceWorkerCache: "preserve-this-exactly",
    customWebsiteMetadata: { wording: "not a release contract", assetName: "anything.png" },
    android: { stableVersionCode: 20, stableVersionName: "2.0", previousStableVersionCode: 19, previousStableVersionName: "1.9", compatibilityVersionCode: 18 },
    currentAndroidRelease: { tag: "release-20" },
    payloadFileCount: files.length,
    payloadBytes: files.reduce((sum, item) => sum + item.bytes, 0),
    payloadSha256: inventoryDigest(files),
    files,
  };
  const manifestPath = resolve(siteDir, "caatuu-web-bundle.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { workspaceRoot, siteDir, files, manifest, manifestPath, payload };
}

function releaseFixture(setupArtifacts = []) {
  const release = {
    versionCode: 21, versionName: "2.1",
    apk: identity("sealed apk"), manifest: identity("sealed manifest"), receipt: identity("sealed receipt"),
  };
  const current = { release, apkPath: "/sealed/caatuu.apk", manifestPath: "/sealed/caatuu.json", receiptPath: "/sealed/receipt.json" };
  return {
    descriptor: { canonicalOrigin: origin, compatibilityVersionCode: 18, baselineStableVersionCode: 20, releases: [release], githubRelease: { tag: "release-21" } },
    current,
    releases: [current],
    setupManifests: new Map([["assets/courses/any/setup-assets.json", { artifacts: setupArtifacts }]]),
  };
}

function snapshot(manifest) {
  const sourceRevision = "a".repeat(40);
  const tag = `caatuu-web-${sourceRevision}`;
  return { schemaVersion: 1, sourceRevision, tag, downloadUrl: `https://github.com/savethebeesandseeds/caatuu/releases/download/${tag}/caatuu-website.tar`, ...identity("archive"), payloadSha256: manifest.payloadSha256 };
}

function outputFiles(preservedSite, plan) {
  const result = new Map(preservedSite.files.map((item) => [item.path, item]));
  for (const { path, bytes, sha256 } of plan.writes) result.set(path, { path, bytes, sha256 });
  return [...result.values()].sort(byPath);
}

test("preserved-site validation checks bytes without interpreting interface text, artwork or courses", (t) => {
  const fixture = siteFixture(t);
  const result = validatePreservedSite(fixture);
  assert.deepEqual(result.files, fixture.files);
  assert.deepEqual(result.manifest.customWebsiteMetadata, fixture.manifest.customWebsiteMetadata);
});

test("missing, extra, modified and incorrectly hashed website inventory all fail closed", async (t) => {
  for (const mode of ["missing", "extra", "modified", "digest", "bytes", "count", "duplicate", "traversal"]) {
    await t.test(mode, (caseTest) => {
      const fixture = siteFixture(caseTest);
      if (mode === "missing") rmSync(resolve(fixture.siteDir, "index.html"));
      if (mode === "extra") writeFileSync(resolve(fixture.siteDir, "surprise.html"), "surprise");
      if (mode === "modified") writeFileSync(resolve(fixture.siteDir, "sw.js"), "changed");
      if (mode === "digest") fixture.manifest.payloadSha256 = "0".repeat(64);
      if (mode === "bytes") fixture.manifest.payloadBytes += 1;
      if (mode === "count") fixture.manifest.payloadFileCount += 1;
      if (mode === "duplicate") fixture.manifest.files.push(fixture.manifest.files[0]);
      if (mode === "traversal") fixture.manifest.files[0].path = "../escape";
      writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
      assert.throws(() => validatePreservedSite(fixture));
    });
  }
});

test("site root, symlink ancestors, file links and case-colliding paths are rejected", async (t) => {
  const fixture = siteFixture(t);
  assert.throws(() => validatePreservedSite({ ...fixture, siteDir: fixture.workspaceRoot }), /must be a child/u);
  assert.throws(() => validatePreservedSite({ ...fixture, siteDir: resolve(fixture.workspaceRoot, "artifacts/web") }), /must be a child/u);
  for (const mode of ["file-link", "directory-link", "case-file", "case-directory"]) {
    await t.test(mode, (caseTest) => {
      const f = siteFixture(caseTest);
      if (mode === "file-link") symlinkSync(resolve(f.siteDir, "index.html"), resolve(f.siteDir, "link.html"));
      if (mode === "directory-link") symlinkSync(resolve(f.siteDir, "assets"), resolve(f.siteDir, "alias"), "dir");
      if (mode === "case-file") writeFileSync(resolve(f.siteDir, "INDEX.html"), "case collision");
      if (mode === "case-directory") mkdirSync(resolve(f.siteDir, "ASSETS"));
      assert.throws(() => validatePreservedSite(f), /symbolic link|Case-colliding/u);
    });
  }
});

test("planning preserves all website files and old versions, changes only stable aliases, adds sealed release files", (t) => {
  const fixture = siteFixture(t);
  const preservedSite = validatePreservedSite(fixture);
  const currentRelease = releaseFixture();
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease });
  assert.deepEqual(plan.writes.map((item) => item.path).sort(), [
    "android/caatuu.apk", "android/caatuu.json", "android/releases/21/caatuu.apk", "android/releases/21/caatuu.json", "android/releases/21/caatuu-release-candidate.json",
  ].sort());
  const manifest = createOverlayManifest({ preservedSite, plan, files: outputFiles(preservedSite, plan), websiteSnapshot: snapshot(preservedSite.manifest) });
  assert.equal(manifest.android.stableVersionCode, 21);
  assert.equal(manifest.android.previousStableVersionCode, 20);
  assert.equal(manifest.android.previousStableVersionName, "2.0");
  assert.equal(manifest.android.compatibilityVersionCode, 18);
  assert.deepEqual(manifest.entrypoints, fixture.manifest.entrypoints);
  assert.equal(manifest.serviceWorkerCache, fixture.manifest.serviceWorkerCache);
  assert.deepEqual(manifest.customWebsiteMetadata, fixture.manifest.customWebsiteMetadata);
  assert.equal(manifest.payloadSha256, inventoryDigest(manifest.files));
  for (const [path, content] of Object.entries(fixture.payload)) assert.equal(readFileSync(resolve(fixture.siteDir, path), "utf8"), content, "Pure planning must never mutate files");
});

test("an existing immutable release mismatch and a version rollback stop planning", (t) => {
  const fixture = siteFixture(t, { "android/releases/21/caatuu.apk": "different published APK" });
  const preservedSite = validatePreservedSite(fixture);
  assert.throws(() => planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture() }), /overwrite immutable/u);
  const rollback = releaseFixture();
  rollback.current.release.versionCode = 19;
  assert.throws(() => planAndroidReleaseOverlay({ preservedSite, currentRelease: rollback }), /roll back/u);
});

test("existing matching sealed bytes are reused, including older Android paths", (t) => {
  const fixture = siteFixture(t, { "android/releases/21/caatuu.apk": "sealed apk" });
  const preservedSite = validatePreservedSite(fixture);
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture() });
  assert.ok(!plan.writes.some((item) => item.path === "android/releases/21/caatuu.apk"));
  assert.ok(!plan.writes.some((item) => item.path === "android/releases/20/caatuu.apk"));
});

test("native setup closure reuses exact website bytes without reading live source or APK assets", (t) => {
  const fixture = siteFixture(t);
  const path = "assets/artwork-new-name.png";
  const artifact = { key: "anything", native_required: true, url: `/${path}`, ...identity(fixture.payload[path]) };
  const plan = planAndroidReleaseOverlay({ preservedSite: validatePreservedSite(fixture), currentRelease: releaseFixture([artifact]), readApkAsset() { throw new Error("must not read"); } });
  assert.equal(plan.nativeArtifactCount, 1);
  assert.deepEqual(plan.addedSetupPaths, []);
});

test("native setup cache-busting queries retain exact pathname and byte checks", (t) => {
  const fixture = siteFixture(t);
  const path = "assets/artwork-new-name.png";
  const artifact = { key: "anything", native_required: true, url: `/${path}?v=any-cache-key`, ...identity(fixture.payload[path]) };
  const preservedSite = validatePreservedSite(fixture);
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture([artifact]), readApkAsset() { throw new Error("must not read"); } });
  assert.equal(plan.nativeArtifactCount, 1);
  assert.deepEqual(plan.addedSetupPaths, []);
  assert.throws(() => planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture([{ ...artifact, ...identity("different bytes") }]) }), /replace website bytes/u);
  assert.throws(() => planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture([{ ...artifact, url: `${artifact.url}#fragment` }]) }), /fragment/u);
});

test("missing content-addressed setup bytes are recovered only from the sealed APK with exact hash verification", (t) => {
  const fixture = siteFixture(t);
  const content = Buffer.from("brand new immutable artifact");
  const digest = identity(content);
  const path = `assets/releases/${digest.sha256.slice(0, 16)}/anything.bin`;
  const artifact = { key: "arbitrary", native_required: true, url: `/${path}`, asset_path: "assets/source.bin", ...digest };
  const currentRelease = releaseFixture([artifact]);
  const readApkAsset = (apk, entry) => {
    assert.equal(apk, currentRelease.current.apkPath);
    assert.equal(entry, "assets/assets/source.bin");
    return content;
  };
  const plan = planAndroidReleaseOverlay({ preservedSite: validatePreservedSite(fixture), currentRelease, readApkAsset });
  assert.deepEqual(plan.addedSetupPaths, [path]);
  assert.ok(plan.writes.find((item) => item.path === path).content.equals(content));
  assert.throws(() => planAndroidReleaseOverlay({ preservedSite: validatePreservedSite(fixture), currentRelease, readApkAsset: () => Buffer.from("wrong") }), /Embedded Android setup bytes differ/u);
  assert.throws(() => planAndroidReleaseOverlay({ preservedSite: validatePreservedSite(fixture), currentRelease, readApkAsset() { throw new Error("not packaged"); } }), /cannot be recovered/u);
});

test("setup closure rejects external origins, mutable missing paths, mismatches and conflicting declarations", async (t) => {
  for (const mode of ["external", "mutable", "mismatch", "conflict", "unsafe-asset"]) {
    await t.test(mode, (caseTest) => {
      const fixture = siteFixture(caseTest);
      const digest = identity("new data");
      const artifact = { key: "arbitrary", native_required: true, asset_path: "assets/whatever.bin", url: `/assets/releases/${digest.sha256.slice(0, 16)}/file.bin`, ...digest };
      let artifacts = [artifact];
      if (mode === "external") artifact.url = "https://example.com/file.bin";
      if (mode === "mutable") artifact.url = "/assets/whatever.bin";
      if (mode === "mismatch") artifact.url = "/assets/artwork-new-name.png";
      if (mode === "conflict") artifacts = [{ ...artifact, url: "/assets/artwork-new-name.png", ...identity(fixture.payload["assets/artwork-new-name.png"]) }, { ...artifact, url: "/assets/artwork-new-name.png" }];
      if (mode === "unsafe-asset") artifact.asset_path = "../outside";
      assert.throws(() => planAndroidReleaseOverlay({ preservedSite: validatePreservedSite(fixture), currentRelease: releaseFixture(artifacts) }));
    });
  }
});

test("manifest creation rejects changes to website bytes, unplanned files and invalid snapshot provenance", (t) => {
  const fixture = siteFixture(t);
  const preservedSite = validatePreservedSite(fixture);
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture() });
  const files = outputFiles(preservedSite, plan);
  const websiteSnapshot = snapshot(preservedSite.manifest);
  const options = { preservedSite, plan, files, websiteSnapshot };
  assert.throws(() => createOverlayManifest({ ...options, files: [...files, file("new-ui.html", "oops")] }), /unplanned/u);
  assert.throws(() => createOverlayManifest({ ...options, files: files.map((item) => item.path === "index.html" ? file(item.path, "changed UI") : item) }), /changed preserved website/u);
  assert.throws(() => createOverlayManifest({ ...options, websiteSnapshot: { ...websiteSnapshot, payloadSha256: "b".repeat(64) } }), /snapshot payload/u);
  assert.throws(() => createOverlayManifest({ ...options, websiteSnapshot: { ...websiteSnapshot, downloadUrl: "https://example.com/archive" } }));
});

test("public overlay validates preserved inventory and provenance before loading any release or writing", (t) => {
  const fixture = siteFixture(t);
  const before = readFileSync(fixture.manifestPath);
  assert.throws(() => overlayAndroidReleaseSite({ ...fixture, descriptorPath: "/nonexistent", websiteSnapshot: { ...snapshot(fixture.manifest), payloadSha256: "b".repeat(64) } }), /snapshot payload/u);
  assert.ok(readFileSync(fixture.manifestPath).equals(before));
  writeFileSync(resolve(fixture.siteDir, "sw.js"), "bad transport");
  assert.throws(() => overlayAndroidReleaseSite({ ...fixture, descriptorPath: "/nonexistent", websiteSnapshot: snapshot(fixture.manifest) }), /file inventory differs/u);
  assert.ok(readFileSync(fixture.manifestPath).equals(before));
});

test("live inventories retain an older website snapshot only with identical verified provenance", (t) => {
  const fixture = siteFixture(t);
  const websiteSnapshot = { ...snapshot(fixture.manifest), payloadSha256: "c".repeat(64) };
  fixture.manifest.websiteSnapshot = structuredClone(websiteSnapshot);
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  const preservedSite = validatePreservedSite(fixture);
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture() });
  const options = { preservedSite, plan, files: outputFiles(preservedSite, plan), websiteSnapshot };
  const manifest = createOverlayManifest(options);
  assert.deepEqual(manifest.websiteSnapshot, websiteSnapshot);
  assert.notEqual(manifest.payloadSha256, websiteSnapshot.payloadSha256);
  assert.throws(() => createOverlayManifest({ ...options, websiteSnapshot: { ...websiteSnapshot, sha256: "d".repeat(64) } }), /provenance differs/u);
  assert.throws(() => createOverlayManifest({ ...options, websiteSnapshot: { ...websiteSnapshot, payloadSha256: fixture.manifest.payloadSha256 } }), /provenance differs/u);
});

test("final payload respects the hosting size limit without presentation-specific asset budgets", (t) => {
  const fixture = siteFixture(t);
  const preservedSite = validatePreservedSite(fixture);
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease: releaseFixture() });
  for (const file of plan.writes) file.bytes = 300_000_000;
  assert.throws(() => createOverlayManifest({ preservedSite, plan, files: outputFiles(preservedSite, plan), websiteSnapshot: snapshot(fixture.manifest) }), /1 GB GitHub Pages hosting limit/u);
});
