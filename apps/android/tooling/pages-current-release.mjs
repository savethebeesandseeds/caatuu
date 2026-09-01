import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readZipEntry, sha256File } from "./pages-baseline.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(modulePath), "../../..");
export const defaultPagesCurrentReleaseDescriptor = resolve(dirname(modulePath), "pages-current-release.json");
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sourceRevisionPattern = /^[a-f0-9]{40}$/u;

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function normalizedPath(value, label) {
  const path = String(value || "").replaceAll("\\", "/");
  assert.ok(path && !path.startsWith("/") && !isAbsolute(path), `${label} must be relative`);
  const parts = path.split("/");
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."), `${label} is unsafe`);
  assert.equal(parts.join("/"), path, `${label} is not normalized`);
  return path;
}

function validateFileRecord(record, label, { publicPaths = false } = {}) {
  assert.ok(record && typeof record === "object" && !Array.isArray(record), `${label} is missing`);
  record.sourcePath = normalizedPath(record.sourcePath, `${label}.sourcePath`);
  assert.match(record.releaseAssetName, /^[a-z0-9][a-z0-9.-]+$/u, `${label}.releaseAssetName is invalid`);
  assert.ok(Number.isSafeInteger(record.bytes) && record.bytes > 0, `${label}.bytes is invalid`);
  assert.match(record.sha256, sha256Pattern, `${label}.sha256 is invalid`);
  if (publicPaths) {
    assert.ok(Array.isArray(record.publicPaths) && record.publicPaths.length > 0, `${label}.publicPaths is empty`);
    record.publicPaths = record.publicPaths.map((path, index) => normalizedPath(path, `${label}.publicPaths[${index}]`));
    assert.equal(new Set(record.publicPaths).size, record.publicPaths.length, `${label}.publicPaths repeats a path`);
  } else {
    assert.equal(record.publicPaths, undefined, `${label} must not be a Pages file`);
  }
  return record;
}

export function validatePagesCurrentReleaseDescriptor(value) {
  const descriptor = structuredClone(value);
  assert.equal(descriptor.schemaName, "caatuu-pages-current-release");
  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.channel, "stable-pages-overlay");
  assert.equal(descriptor.canonicalOrigin, "https://caatuu.waajacu.com");
  assert.equal(descriptor.repository, "savethebeesandseeds/caatuu");
  assert.equal(descriptor.githubRelease?.tag, "caatuu-android-v163");
  assert.equal(descriptor.stable?.versionCode, 163);
  assert.equal(descriptor.stable?.versionName, "0.1.11");
  assert.match(descriptor.stable?.sourceRevision || "", sourceRevisionPattern);
  descriptor.stable.manifest = validateFileRecord(descriptor.stable.manifest, "stable.manifest", { publicPaths: true });
  descriptor.stable.apk = validateFileRecord(descriptor.stable.apk, "stable.apk", { publicPaths: true });
  descriptor.stable.receipt = validateFileRecord(descriptor.stable.receipt, "stable.receipt");
  for (const record of [descriptor.stable.manifest, descriptor.stable.apk, descriptor.stable.receipt]) {
    assert.equal(
      record.downloadUrl,
      `https://github.com/${descriptor.repository}/releases/download/${descriptor.githubRelease.tag}/${record.releaseAssetName}`,
      `${record.releaseAssetName} download URL changed`,
    );
  }
  assert.deepEqual(descriptor.stable.manifest.publicPaths, [
    "android/releases/163/caatuu.json",
    "android/caatuu.json",
  ]);
  assert.deepEqual(descriptor.stable.apk.publicPaths, [
    "android/releases/163/caatuu.apk",
    "android/caatuu.apk",
  ]);
  assert.equal(descriptor.previousStableVersionCode, 162);
  assert.equal(descriptor.compatibilityVersionCode, 161);
  descriptor.setupEntries = descriptor.setupEntries.map((entry, index) => normalizedPath(entry, `setupEntries[${index}]`));
  assert.deepEqual(descriptor.setupEntries, [
    "assets/courses/cz/setup-assets.json",
    "assets/courses/zh/setup-assets.json",
  ]);
  return descriptor;
}

function readVerifiedFile(workspaceRoot, record, label) {
  const workspace = resolve(workspaceRoot);
  const path = resolve(workspace, ...record.sourcePath.split("/"));
  assert.ok(inside(workspace, path), `${label} escapes the workspace`);
  assert.ok(existsSync(path), `${label} is missing: ${record.sourcePath}`);
  const stats = lstatSync(path);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `${label} is not a regular file`);
  assert.equal(statSync(path).size, record.bytes, `${label} byte count changed`);
  assert.equal(sha256File(path), record.sha256, `${label} SHA-256 changed`);
  return path;
}

export function loadPagesCurrentRelease({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesCurrentReleaseDescriptor,
} = {}) {
  const workspace = resolve(workspaceRoot);
  const descriptorFile = resolve(descriptorPath);
  assert.ok(inside(workspace, descriptorFile), "Current-release descriptor escapes the workspace");
  const descriptor = validatePagesCurrentReleaseDescriptor(JSON.parse(readFileSync(descriptorFile, "utf8")));
  const manifestPath = readVerifiedFile(workspace, descriptor.stable.manifest, "Stable 163 manifest");
  const apkPath = readVerifiedFile(workspace, descriptor.stable.apk, "Stable 163 APK");
  const receiptPath = readVerifiedFile(workspace, descriptor.stable.receipt, "Stable 163 receipt");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(manifest.version_code, descriptor.stable.versionCode);
  assert.equal(manifest.version_name, descriptor.stable.versionName);
  assert.equal(manifest.source_revision, descriptor.stable.sourceRevision);
  assert.equal(manifest.package_name, "com.waajacu.caatuu");
  assert.equal(manifest.debuggable, false);
  assert.equal(manifest.apk_url, `${descriptor.canonicalOrigin}/${descriptor.stable.apk.publicPaths[0]}`);
  assert.equal(manifest.bytes, descriptor.stable.apk.bytes);
  assert.equal(manifest.sha256, descriptor.stable.apk.sha256);
  assert.equal(manifest.audit?.candidate_receipt_sha256, descriptor.stable.receipt.sha256);
  assert.equal(receipt.source_revision, descriptor.stable.sourceRevision);
  assert.equal(receipt.identity?.package_name, manifest.package_name);
  assert.equal(receipt.identity?.version_code, manifest.version_code);
  assert.equal(receipt.identity?.version_name, manifest.version_name);
  assert.equal(receipt.identity?.debuggable, false);
  assert.equal(receipt.identity?.signer_certificate_sha256, manifest.signer_certificate_sha256);
  assert.equal(receipt.artifacts?.apk?.bytes, descriptor.stable.apk.bytes);
  assert.equal(receipt.artifacts?.apk?.sha256, descriptor.stable.apk.sha256);
  const setupManifests = new Map(descriptor.setupEntries.map((entry) => {
    const manifestValue = JSON.parse(readZipEntry(apkPath, entry).toString("utf8"));
    assert.ok(Array.isArray(manifestValue.artifacts), `${entry} does not contain an artifact list`);
    return [entry, manifestValue];
  }));
  const czechSetup = setupManifests.get("assets/courses/cz/setup-assets.json");
  const agreement = czechSetup.artifacts.filter((artifact) => artifact.key === "planet-agreement-aurora");
  assert.equal(agreement.length, 1, "Android 163 Czech setup is missing Agreement Aurora");
  assert.equal(
    agreement[0].url,
    "/assets/planets/releases/5fe5c25467d51dbe/agreement-aurora.png",
    "Android 163 Agreement Aurora URL is not content-addressed",
  );
  assert.equal(agreement[0].asset_path, "assets/planets/agreement-aurora.png");
  assert.equal(agreement[0].bytes, 1258690);
  assert.equal(agreement[0].sha256, "5fe5c25467d51dbec0c7e6600f187a685ccb0d42c34a47c3d1a737d2b6051966");
  return { descriptor, manifest, receipt, manifestPath, apkPath, receiptPath, setupManifests };
}
