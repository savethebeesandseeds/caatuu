#!/usr/bin/env node

import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readZipEntry, sha256Bytes, sha256File } from "./pages-baseline.mjs";
import { loadPagesCurrentRelease } from "./pages-current-release.mjs";

const bundlePath = "caatuu-web-bundle.json";
const digestPattern = /^[a-f0-9]{64}$/u;
const aliases = new Set(["android/caatuu.apk", "android/caatuu.json"]);
const comparePaths = (left, right) => left.localeCompare(right, "en");

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function safePath(path) {
  assert.equal(typeof path, "string", "Site path must be a string");
  assert.ok(path && !isAbsolute(path), `Site path must be relative: ${path}`);
  assert.doesNotMatch(path, /[\\\x00-\x1f:<>"|?*]/u, `Unsafe site path: ${path}`);
  assert.ok(path.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)), `Unsafe site path: ${path}`);
  return path;
}

function safeSiteDirectory(workspaceRoot, siteDir) {
  const workspace = resolve(workspaceRoot);
  const site = resolve(siteDir);
  assert.ok(["artifacts/web", "tmp"].some((parent) => inside(resolve(workspace, parent), site)),
    "Android overlay output must be a child of workspace artifacts/web or tmp");
  for (let path = site; ; path = dirname(path)) {
    if (existsSync(path)) assert.ok(!lstatSync(path).isSymbolicLink(), `Site uses a symbolic link: ${path}`);
    if (path === workspace) break;
  }
  assert.ok(existsSync(site) && lstatSync(site).isDirectory(), `Preserved site is missing: ${site}`);
  return site;
}

function assertPathCollisions(files) {
  const paths = new Map();
  for (const file of files) {
    const parts = safePath(file).split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const path = parts.slice(0, index).join("/");
      const kind = index === parts.length ? "file" : "directory";
      const key = path.toLowerCase();
      if (paths.has(key)) {
        assert.equal(paths.get(key).path, path, `Case-colliding site path: ${path}`);
        assert.equal(paths.get(key).kind, kind, `Site file/directory collision: ${path}`);
      } else paths.set(key, { path, kind });
    }
  }
}

function siteInventory(site) {
  const files = [];
  const paths = new Map();
  function visit(directory, prefix = "") {
    for (const name of readdirSync(directory).sort(comparePaths)) {
      const path = safePath(prefix ? `${prefix}/${name}` : name);
      const key = path.toLowerCase();
      assert.ok(!paths.has(key), `Case-colliding site path: ${path}`);
      paths.set(key, path);
      const absolute = resolve(site, path);
      const stat = lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink(), `Site contains a symbolic link: ${path}`);
      if (stat.isDirectory()) visit(absolute, path);
      else {
        assert.ok(stat.isFile(), `Site contains a non-regular file: ${path}`);
        if (path !== bundlePath) files.push({ path, bytes: stat.size, sha256: sha256File(absolute) });
      }
    }
  }
  visit(site);
  return files.sort((left, right) => comparePaths(left.path, right.path));
}

export function inventoryDigest(files) {
  return sha256Bytes(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join("\n"));
}

function validateIdentity(identity, label) {
  assert.ok(Number.isSafeInteger(identity?.bytes) && identity.bytes >= 0, `${label} has an invalid byte count`);
  assert.match(String(identity.sha256 || ""), digestPattern, `${label} has an invalid SHA-256`);
}

/** Validate transport integrity, not website wording, artwork or implementation. */
export function validatePreservedSite({ workspaceRoot, siteDir }) {
  const site = safeSiteDirectory(workspaceRoot, siteDir);
  const files = siteInventory(site);
  const manifest = JSON.parse(readFileSync(resolve(site, bundlePath), "utf8"));
  assert.equal(manifest.schema_name, "caatuu-web-bundle");
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.canonicalOrigin, "https://caatuu.waajacu.com");
  assert.ok(Array.isArray(manifest.files), "Preserved website has no file inventory");
  const seen = new Set();
  for (const file of manifest.files) {
    safePath(file.path);
    assert.notEqual(file.path, bundlePath, "Website inventory must not include itself");
    assert.ok(!seen.has(file.path), `Duplicate inventory path: ${file.path}`);
    seen.add(file.path);
    validateIdentity(file, file.path);
  }
  assertPathCollisions(manifest.files.map((file) => file.path));
  assert.deepEqual(files, manifest.files, "Preserved website file inventory differs (missing, extra or changed bytes)");
  assert.equal(manifest.payloadFileCount, files.length, "Website payload file count differs");
  assert.equal(manifest.payloadBytes, files.reduce((sum, file) => sum + file.bytes, 0), "Website payload byte count differs");
  assert.equal(manifest.payloadSha256, inventoryDigest(files), "Website payload digest differs");
  return { manifest, files };
}

function validateWebsiteSnapshot(snapshot, manifest) {
  assert.ok(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot), "Verified websiteSnapshot metadata is required");
  assert.equal(snapshot.schemaVersion, 1);
  assert.match(String(snapshot.sourceRevision || ""), /^[a-f0-9]{40}$/u);
  assert.equal(snapshot.tag, `caatuu-web-${snapshot.sourceRevision}`);
  assert.equal(snapshot.downloadUrl, `https://github.com/savethebeesandseeds/caatuu/releases/download/${snapshot.tag}/caatuu-website.tar`);
  validateIdentity(snapshot, "Website snapshot");
  assert.ok(snapshot.bytes > 0, "Website snapshot archive is empty");
  assert.match(String(snapshot.payloadSha256 || ""), digestPattern);
  if (manifest.websiteSnapshot) {
    // The authenticated loader replays the current published inventory on its
    // website snapshot, retaining intermediate Android releases/setup assets.
    assert.deepEqual(snapshot, manifest.websiteSnapshot, "Published website snapshot provenance differs from the verified snapshot");
  } else {
    assert.equal(snapshot.payloadSha256, manifest.payloadSha256, "Restored website differs from the verified snapshot payload");
  }
}

function identityMatches(left, right) {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

/** Pure planning seam: currentRelease is the result of loadPagesCurrentRelease. */
export function planAndroidReleaseOverlay({ preservedSite, currentRelease, readApkAsset = readZipEntry }) {
  const { descriptor, current, releases, setupManifests } = currentRelease;
  const { manifest, files } = preservedSite;
  assert.equal(descriptor.canonicalOrigin, manifest.canonicalOrigin, "Release and website origins differ");
  assert.ok(Number.isSafeInteger(manifest.android?.stableVersionCode), "Preserved website has no Android stable version");
  assert.ok(current.release.versionCode >= manifest.android.stableVersionCode, "Android overlay would roll back the published version");
  assert.ok([descriptor.baselineStableVersionCode, ...descriptor.releases.map((release) => release.versionCode)].includes(manifest.android.stableVersionCode),
    "Published Android version is missing from the immutable release history");
  assert.equal(manifest.android.compatibilityVersionCode, descriptor.compatibilityVersionCode, "Android compatibility baseline changed");
  const inventory = new Map(files.map((file) => [file.path, file]));
  const writes = new Map();
  const addedSetupPaths = [];
  function add(path, identity, source) {
    safePath(path);
    validateIdentity(identity, path);
    if (writes.has(path)) {
      assert.ok(identityMatches(writes.get(path), identity), `Conflicting release bytes: ${path}`);
      return;
    }
    const existing = inventory.get(path);
    if (existing && !aliases.has(path)) {
      assert.ok(identityMatches(existing, identity), `Refusing to overwrite immutable published bytes: ${path}`);
      return;
    }
    if (existing && identityMatches(existing, identity)) return;
    writes.set(path, { path, bytes: identity.bytes, sha256: identity.sha256, ...source });
  }
  for (const loaded of releases) {
    for (const kind of ["apk", "manifest", "receipt"]) {
      const artifact = loaded.release[kind];
      const filename = kind === "apk" ? "caatuu.apk" : kind === "manifest" ? "caatuu.json" : "caatuu-release-candidate.json";
      add(`android/releases/${loaded.release.versionCode}/${filename}`, artifact, { sourcePath: loaded[`${kind}Path`] });
    }
  }
  add("android/caatuu.apk", current.release.apk, { sourcePath: current.apkPath });
  add("android/caatuu.json", current.release.manifest, { sourcePath: current.manifestPath });

  const setupPaths = new Map();
  let nativeArtifactCount = 0;
  for (const [entry, setup] of setupManifests) {
    assert.ok(Array.isArray(setup.artifacts), `Setup catalog has no artifacts: ${entry}`);
    for (const artifact of setup.artifacts.filter((item) => item.native_required === true)) {
      nativeArtifactCount += 1;
      validateIdentity(artifact, `${entry}:${artifact.key}`);
      assert.equal(typeof artifact.url, "string", `Setup artifact has no URL: ${entry}:${artifact.key}`);
      const url = new URL(artifact.url, descriptor.canonicalOrigin);
      assert.equal(url.origin, descriptor.canonicalOrigin, `Setup artifact must remain same-origin: ${artifact.url}`);
      // A cache-busting query does not change the static Pages file. Its
      // pathname must still resolve to the exact bytes required by the APK.
      assert.ok(!url.username && !url.password && !url.hash, `Setup URL must name a public file without userinfo or a fragment: ${artifact.url}`);
      const path = safePath(decodeURIComponent(url.pathname.slice(1)));
      if (setupPaths.has(path)) {
        assert.ok(identityMatches(setupPaths.get(path), artifact), `Conflicting setup bytes: ${path}`);
        continue;
      }
      setupPaths.set(path, artifact);
      const existing = inventory.get(path);
      if (existing) {
        assert.ok(identityMatches(existing, artifact), `Refusing to replace website bytes for Android setup: ${path}`);
        continue;
      }
      assert.ok(!path.startsWith("android/") && path.split("/").some((part) => /^[a-f0-9]{16,64}$/u.test(part) && artifact.sha256.startsWith(part)),
        `Missing Android setup artifact is not content-addressed; publish its exact immutable bytes first: ${path}`);
      assert.ok(artifact.asset_path, `Missing Android setup artifact is not embedded in the sealed APK: ${path}`);
      const assetPath = safePath(artifact.asset_path);
      let content;
      try {
        content = readApkAsset(current.apkPath, `assets/${assetPath}`);
      } catch (error) {
        throw new Error(`Missing Android setup artifact cannot be recovered from the sealed APK: ${path}`, { cause: error });
      }
      assert.ok(identityMatches({ bytes: content.length, sha256: sha256Bytes(content) }, artifact), `Embedded Android setup bytes differ: ${path}`);
      add(path, artifact, { content });
      addedSetupPaths.push(path);
    }
  }
  assertPathCollisions([...inventory.keys(), ...writes.keys(), bundlePath]);
  const previous = descriptor.releases.at(-2);
  const android = {
    ...manifest.android,
    stableVersionCode: current.release.versionCode,
    stableVersionName: current.release.versionName,
    previousStableVersionCode: previous?.versionCode ?? descriptor.baselineStableVersionCode,
    previousStableVersionName: previous?.versionName ?? (manifest.android.stableVersionCode === descriptor.baselineStableVersionCode
      ? manifest.android.stableVersionName : manifest.android.previousStableVersionName),
  };
  return { writes: [...writes.values()], android, currentAndroidRelease: descriptor.githubRelease, addedSetupPaths, nativeArtifactCount };
}

export function createOverlayManifest({ preservedSite, plan, files, websiteSnapshot }) {
  validateWebsiteSnapshot(websiteSnapshot, preservedSite.manifest);
  const finalFiles = new Map(files.map((file) => [file.path, file]));
  assert.equal(finalFiles.size, files.length, "Overlay inventory contains duplicate files");
  const expectedPaths = new Set([...preservedSite.files.map((file) => file.path), ...plan.writes.map((file) => file.path)]);
  assert.deepEqual([...finalFiles.keys()].sort(comparePaths), [...expectedPaths].sort(comparePaths), "Overlay added or removed unplanned files");
  const replacedAliases = new Set(plan.writes.filter((file) => aliases.has(file.path)).map((file) => file.path));
  for (const file of preservedSite.files.filter((item) => !replacedAliases.has(item.path))) {
    assert.deepEqual(finalFiles.get(file.path), file, `Overlay changed preserved website bytes: ${file.path}`);
  }
  for (const file of plan.writes) assert.ok(identityMatches(finalFiles.get(file.path), file), `Overlay output differs: ${file.path}`);
  const payloadBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  assert.ok(Number.isSafeInteger(payloadBytes) && payloadBytes <= 1_000_000_000,
    "Android overlay exceeds the 1 GB GitHub Pages hosting limit");
  return {
    ...preservedSite.manifest,
    currentAndroidRelease: plan.currentAndroidRelease,
    android: plan.android,
    websiteSnapshot: structuredClone(websiteSnapshot),
    payloadFileCount: files.length,
    payloadBytes,
    payloadSha256: inventoryDigest(files),
    files,
  };
}

/** Overlay only sealed release bytes onto an authenticated, already-published website. */
export function overlayAndroidReleaseSite({ workspaceRoot, siteDir, descriptorPath, websiteSnapshot }) {
  const site = safeSiteDirectory(workspaceRoot, siteDir);
  const preservedSite = validatePreservedSite({ workspaceRoot, siteDir: site });
  validateWebsiteSnapshot(websiteSnapshot, preservedSite.manifest);
  const currentRelease = loadPagesCurrentRelease({ workspaceRoot, descriptorPath });
  const plan = planAndroidReleaseOverlay({ preservedSite, currentRelease });
  const plannedFiles = new Map(preservedSite.files.map((file) => [file.path, file]));
  for (const { path, bytes, sha256 } of plan.writes) plannedFiles.set(path, { path, bytes, sha256 });
  createOverlayManifest({
    preservedSite, plan, websiteSnapshot,
    files: [...plannedFiles.values()].sort((left, right) => comparePaths(left.path, right.path)),
  });
  // Finish all source, destination and closure checks before writing any file.
  for (const file of plan.writes) {
    if (file.sourcePath) {
      assert.ok(lstatSync(file.sourcePath).isFile() && !lstatSync(file.sourcePath).isSymbolicLink(), `Release source is not a regular file: ${file.sourcePath}`);
      assert.ok(identityMatches({ bytes: lstatSync(file.sourcePath).size, sha256: sha256File(file.sourcePath) }, file), `Sealed release source changed: ${file.path}`);
    }
    const target = resolve(site, file.path);
    for (let path = target; path !== site; path = dirname(path)) {
      const parent = dirname(path);
      if (existsSync(parent) && lstatSync(parent).isDirectory()) {
        const name = basename(path);
        assert.ok(!readdirSync(parent).some((sibling) => sibling.toLowerCase() === name.toLowerCase() && sibling !== name),
          `Overlay target has a case-colliding path: ${file.path}`);
      }
      if (existsSync(path)) {
        const stat = lstatSync(path);
        assert.ok(!stat.isSymbolicLink(), `Overlay target uses a symbolic link: ${file.path}`);
        assert.ok(path === target ? stat.isFile() : stat.isDirectory(), `Overlay target type differs: ${file.path}`);
      }
    }
  }
  for (const file of plan.writes) {
    const target = resolve(site, file.path);
    mkdirSync(dirname(target), { recursive: true });
    if (file.sourcePath) copyFileSync(file.sourcePath, target, aliases.has(file.path) ? 0 : constants.COPYFILE_EXCL);
    else writeFileSync(target, file.content, { flag: "wx" });
  }
  const files = siteInventory(site);
  const manifest = createOverlayManifest({ preservedSite, plan, files, websiteSnapshot });
  writeFileSync(resolve(site, bundlePath), `${JSON.stringify(manifest, null, 2)}\n`);
  validatePreservedSite({ workspaceRoot, siteDir: site });
  return { manifest, versionCode: plan.android.stableVersionCode, addedSetupPaths: plan.addedSetupPaths, preservedFileCount: preservedSite.files.filter((file) => !aliases.has(file.path)).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [workspaceRoot, siteDir, descriptorPath, snapshotPath] = process.argv.slice(2);
    assert.ok(workspaceRoot && siteDir && descriptorPath && snapshotPath, "Usage: pages-android-overlay.mjs WORKSPACE SITE DESCRIPTOR WEBSITE_SNAPSHOT_JSON");
    const result = overlayAndroidReleaseSite({ workspaceRoot, siteDir, descriptorPath, websiteSnapshot: JSON.parse(readFileSync(snapshotPath, "utf8")) });
    process.stdout.write(`${JSON.stringify({ versionCode: result.versionCode, preservedFileCount: result.preservedFileCount, addedSetupPaths: result.addedSetupPaths })}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
