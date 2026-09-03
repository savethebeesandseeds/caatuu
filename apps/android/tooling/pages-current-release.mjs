#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readZipEntry, sha256Bytes, sha256File } from "./pages-baseline.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(modulePath), "../../..");
export const defaultPagesCurrentReleaseDescriptor = resolve(dirname(modulePath), "pages-current-release.json");
const canonicalOrigin = "https://caatuu.waajacu.com";
const canonicalRepository = "savethebeesandseeds/caatuu";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sourceRevisionPattern = /^[a-f0-9]{40}$/u;
const versionNamePattern = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u;
const initialReleaseRecordSha256 = "0e085b347390d76f0e320ef1deb46c80d6219a86ac3d5d5e4592509b8de83c5c";
const releaseKinds = Object.freeze(["apk", "manifest", "receipt"]);
const expectedSetupEntries = Object.freeze([
  "assets/courses/cz/setup-assets.json",
  "assets/courses/zh/setup-assets.json",
]);

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function samePath(left, right) {
  const first = resolve(left);
  const second = resolve(right);
  return process.platform === "win32" ? first.toLowerCase() === second.toLowerCase() : first === second;
}

function assertExactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields changed`);
}

function normalizedPath(value, label) {
  const path = String(value || "").replaceAll("\\", "/");
  assert.ok(path && !path.startsWith("/") && !isAbsolute(path), `${label} must be relative`);
  assert.ok(!path.includes("\0"), `${label} contains a NUL byte`);
  const parts = path.split("/");
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."), `${label} is unsafe`);
  assert.equal(parts.join("/"), path, `${label} is not normalized`);
  return path;
}

function assertNoSymlinkAncestors(path, boundary, label) {
  const root = resolve(boundary);
  let current = resolve(path);
  assert.ok(current === root || inside(root, current), `${label} escapes ${root}: ${current}`);
  while (current !== root) {
    if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(), `${label} uses a symbolic link: ${current}`);
    current = dirname(current);
  }
}

function assertRegularWorkspaceFile(path, workspaceRoot, label) {
  const workspace = resolve(workspaceRoot);
  const file = resolve(path);
  assert.ok(inside(workspace, file), `${label} escapes the workspace: ${file}`);
  assertNoSymlinkAncestors(file, workspace, label);
  assert.ok(existsSync(file), `${label} is missing: ${file}`);
  const stats = lstatSync(file);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `${label} is not a regular file: ${file}`);
  return { path: file, bytes: stats.size, sha256: sha256File(file) };
}

function validateDigestRecord(record, label) {
  assertExactKeys(record, ["bytes", "sha256"], label);
  assert.ok(Number.isSafeInteger(record.bytes) && record.bytes > 0, `${label}.bytes is invalid`);
  assert.match(String(record.sha256 || ""), sha256Pattern, `${label}.sha256 is invalid`);
  return { bytes: record.bytes, sha256: record.sha256 };
}

function validateStoredRelease(release, label) {
  assertExactKeys(release, ["versionCode", "versionName", "sourceRevision", "manifest", "apk", "receipt"], label);
  assert.ok(Number.isSafeInteger(release.versionCode) && release.versionCode > 0, `${label}.versionCode is invalid`);
  assert.match(String(release.versionName || ""), versionNamePattern, `${label}.versionName is invalid`);
  assert.match(String(release.sourceRevision || ""), sourceRevisionPattern, `${label}.sourceRevision is invalid`);
  return {
    versionCode: release.versionCode,
    versionName: release.versionName,
    sourceRevision: release.sourceRevision,
    manifest: validateDigestRecord(release.manifest, `${label}.manifest`),
    apk: validateDigestRecord(release.apk, `${label}.apk`),
    receipt: validateDigestRecord(release.receipt, `${label}.receipt`),
  };
}

function validateStoredDescriptor(value) {
  assertExactKeys(value, [
    "schemaName", "schemaVersion", "channel", "canonicalOrigin", "repository",
    "baselineStableVersionCode", "compatibilityVersionCode", "releases", "setupEntries",
  ], "Pages current-release descriptor");
  assert.equal(value.schemaName, "caatuu-pages-current-release");
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.channel, "stable-pages-overlay");
  assert.equal(value.canonicalOrigin, canonicalOrigin);
  assert.equal(value.repository, canonicalRepository);
  assert.equal(value.baselineStableVersionCode, 162);
  assert.equal(value.compatibilityVersionCode, 161);
  assert.ok(Array.isArray(value.releases) && value.releases.length > 0, "Pages release list is empty");
  const releases = value.releases.map((release, index) => validateStoredRelease(release, `releases[${index}]`));
  assert.equal(
    sha256Bytes(Buffer.from(JSON.stringify(releases[0]), "utf8")),
    initialReleaseRecordSha256,
    "Pages release history no longer begins with the exact immutable Android 163 record",
  );
  let previousVersionCode = value.baselineStableVersionCode;
  for (const release of releases) {
    assert.ok(
      release.versionCode > previousVersionCode,
      `Pages releases must increase after Android ${previousVersionCode}; found ${release.versionCode}`,
    );
    previousVersionCode = release.versionCode;
  }
  assert.ok(Array.isArray(value.setupEntries), "setupEntries must be an array");
  const setupEntries = value.setupEntries.map((entry, index) => normalizedPath(entry, `setupEntries[${index}]`));
  assert.deepEqual(setupEntries, [...expectedSetupEntries]);
  return {
    schemaName: value.schemaName,
    schemaVersion: value.schemaVersion,
    channel: value.channel,
    canonicalOrigin: value.canonicalOrigin,
    repository: value.repository,
    baselineStableVersionCode: value.baselineStableVersionCode,
    compatibilityVersionCode: value.compatibilityVersionCode,
    releases,
    setupEntries,
  };
}

function releaseTag(versionCode) {
  return `caatuu-android-v${versionCode}`;
}

function releaseArtifactName(versionCode, kind) {
  if (kind === "apk") return `caatuu-${versionCode}.apk`;
  if (kind === "manifest") return `caatuu-${versionCode}.json`;
  if (kind === "receipt") return `caatuu-${versionCode}-release-candidate.json`;
  throw new Error(`Unknown Android release artifact kind: ${kind}`);
}

function releaseSourcePath(versionCode, kind) {
  const filename = kind === "apk" ? "caatuu.apk" : kind === "manifest" ? "caatuu.json" : "caatuu-release-candidate.json";
  return `artifacts/android/releases/${versionCode}/${filename}`;
}

function releasePublicPath(versionCode, kind) {
  assert.ok(kind === "apk" || kind === "manifest", `${kind} is not a public Pages artifact`);
  return `android/releases/${versionCode}/caatuu.${kind === "apk" ? "apk" : "json"}`;
}

function expandRelease(release, repository) {
  const tag = releaseTag(release.versionCode);
  const expanded = {
    versionCode: release.versionCode,
    versionName: release.versionName,
    sourceRevision: release.sourceRevision,
    githubRelease: { tag },
  };
  for (const kind of releaseKinds) {
    const releaseAssetName = releaseArtifactName(release.versionCode, kind);
    expanded[kind] = {
      ...release[kind],
      sourcePath: releaseSourcePath(release.versionCode, kind),
      releaseAssetName,
      downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${releaseAssetName}`,
    };
    if (kind !== "receipt") expanded[kind].publicPaths = [releasePublicPath(release.versionCode, kind)];
  }
  return expanded;
}

function stableReleaseFor(release) {
  const stable = structuredClone(release);
  stable.manifest.publicPaths.push("android/caatuu.json");
  stable.apk.publicPaths.push("android/caatuu.apk");
  return stable;
}

export function validatePagesCurrentReleaseDescriptor(value) {
  const stored = validateStoredDescriptor(structuredClone(value));
  const releases = stored.releases.map((release) => expandRelease(release, stored.repository));
  const stable = stableReleaseFor(releases.at(-1));
  return {
    ...stored,
    releases,
    stable,
    githubRelease: stable.githubRelease,
    previousStableVersionCode: releases.length > 1 ? releases.at(-2).versionCode : stored.baselineStableVersionCode,
  };
}

export function assertPagesReleaseHistoryPrefix(previousValue, nextValue) {
  const previous = validateStoredDescriptor(structuredClone(previousValue));
  const next = validateStoredDescriptor(structuredClone(nextValue));
  const { releases: previousReleases, ...previousMetadata } = previous;
  const { releases: nextReleases, ...nextMetadata } = next;
  assert.deepEqual(nextMetadata, previousMetadata, "Pages release-history metadata changed");
  assert.ok(
    nextReleases.length >= previousReleases.length,
    `Pages release history dropped ${previousReleases.length - nextReleases.length} immutable release(s)`,
  );
  for (let index = 0; index < previousReleases.length; index += 1) {
    assert.deepEqual(
      nextReleases[index],
      previousReleases[index],
      `Pages release history changed immutable Android ${previousReleases[index].versionCode}`,
    );
  }
  return {
    previousReleaseCount: previousReleases.length,
    nextReleaseCount: nextReleases.length,
    addedVersionCodes: nextReleases.slice(previousReleases.length).map((release) => release.versionCode),
    currentVersionCode: nextReleases.at(-1).versionCode,
  };
}

export function pagesCurrentReleaseDownloadPlan(value) {
  const descriptor = validatePagesCurrentReleaseDescriptor(value);
  return {
    schemaName: "caatuu-pages-release-download-plan",
    schemaVersion: 1,
    repository: descriptor.repository,
    currentVersionCode: descriptor.stable.versionCode,
    releases: descriptor.releases.map((release) => ({
      versionCode: release.versionCode,
      versionName: release.versionName,
      tag: release.githubRelease.tag,
    })),
    assets: descriptor.releases.flatMap((release) => releaseKinds.map((kind) => ({
      versionCode: release.versionCode,
      kind,
      sourcePath: release[kind].sourcePath,
      releaseAssetName: release[kind].releaseAssetName,
      downloadUrl: release[kind].downloadUrl,
      bytes: release[kind].bytes,
      sha256: release[kind].sha256,
    }))),
  };
}

function readStoredDescriptorFile({ workspaceRoot, descriptorPath }) {
  const file = assertRegularWorkspaceFile(descriptorPath, workspaceRoot, "Pages current-release descriptor");
  const raw = readFileSync(file.path);
  return {
    descriptor: validateStoredDescriptor(JSON.parse(raw.toString("utf8"))),
    descriptorPath: file.path,
    identity: { bytes: raw.length, sha256: sha256Bytes(raw) },
  };
}

function readJsonFile(path, workspaceRoot, label) {
  const file = assertRegularWorkspaceFile(path, workspaceRoot, label);
  return { file, value: JSON.parse(readFileSync(file.path, "utf8")) };
}

function assertExpectedArtifactPath(path, workspaceRoot, versionCode, kind, label) {
  const expected = resolve(workspaceRoot, ...releaseSourcePath(versionCode, kind).split("/"));
  assert.ok(samePath(path, expected), `${label} must use the finalized release path: ${releaseSourcePath(versionCode, kind)}`);
}

export function validatePagesReleaseFiles({ workspaceRoot, descriptor, manifestPath, apkPath, receiptPath }) {
  assert.equal(descriptor?.canonicalOrigin, canonicalOrigin);
  assert.equal(descriptor?.repository, canonicalRepository);
  const manifest = readJsonFile(manifestPath, workspaceRoot, "Android release manifest");
  const value = manifest.value;
  assert.ok(Number.isSafeInteger(value.version_code) && value.version_code > 0, "Android release version_code is invalid");
  assert.match(String(value.version_name || ""), versionNamePattern, "Android release version_name is invalid");
  assert.match(String(value.source_revision || ""), sourceRevisionPattern, "Android release source_revision is invalid");
  assert.equal(value.schema_version, 1);
  assert.equal(value.profile, "product");
  assert.equal(value.channel, "stable");
  assert.equal(value.package_name, "com.waajacu.caatuu");
  assert.equal(value.build_type, "release");
  assert.equal(value.debuggable, false);
  assert.equal(value.signing_lineage, "direct-release-v1");
  assert.equal(value.apk_url, `${descriptor.canonicalOrigin}/${releasePublicPath(value.version_code, "apk")}`);
  assert.equal(value.source_url, `https://github.com/${descriptor.repository}/tree/${value.source_revision}`);
  assert.match(String(value.signer_certificate_sha256 || ""), sha256Pattern, "Android release signer digest is invalid");
  assert.equal(value.audit?.bundletool, "passed");
  assert.equal(value.audit?.product_package, "passed");
  assertExpectedArtifactPath(manifest.file.path, workspaceRoot, value.version_code, "manifest", "Android release manifest");

  const apk = assertRegularWorkspaceFile(apkPath, workspaceRoot, "Android release APK");
  assertExpectedArtifactPath(apk.path, workspaceRoot, value.version_code, "apk", "Android release APK");
  assert.equal(apk.bytes, value.bytes, "Android release APK byte count differs from its manifest");
  assert.equal(apk.sha256, value.sha256, "Android release APK hash differs from its manifest");

  const receipt = readJsonFile(receiptPath, workspaceRoot, "Android release receipt");
  assertExpectedArtifactPath(receipt.file.path, workspaceRoot, value.version_code, "receipt", "Android release receipt");
  assert.equal(receipt.value.schema_name, "caatuu-android-release-candidate");
  assert.equal(receipt.value.schema_version, 1);
  assert.ok(["builder-emitted", "adopted-existing"].includes(receipt.value.mode), "Android release receipt mode is invalid");
  assert.equal(receipt.value.repository, descriptor.repository);
  assert.equal(receipt.value.source_revision, value.source_revision);
  assert.equal(receipt.value.source_url, value.source_url);
  assert.equal(receipt.value.identity?.package_name, value.package_name);
  assert.equal(receipt.value.identity?.version_code, value.version_code);
  assert.equal(receipt.value.identity?.version_name, value.version_name);
  assert.equal(receipt.value.identity?.build_type, value.build_type);
  assert.equal(receipt.value.identity?.debuggable, false);
  assert.equal(receipt.value.identity?.signing_lineage, value.signing_lineage);
  assert.equal(receipt.value.identity?.signer_certificate_sha256, value.signer_certificate_sha256);
  assert.equal(receipt.value.artifacts?.apk?.bytes, apk.bytes);
  assert.equal(receipt.value.artifacts?.apk?.sha256, apk.sha256);
  assert.ok(Number.isSafeInteger(receipt.value.artifacts?.aab?.bytes) && receipt.value.artifacts.aab.bytes > 0);
  assert.match(String(receipt.value.artifacts?.aab?.sha256 || ""), sha256Pattern);
  assert.equal(receipt.value.audit?.bundletool, "passed");
  assert.equal(receipt.value.audit?.product_package, "passed");
  assert.equal(value.audit?.candidate_receipt_sha256, receipt.file.sha256);

  return {
    record: {
      versionCode: value.version_code,
      versionName: value.version_name,
      sourceRevision: value.source_revision,
      manifest: { bytes: manifest.file.bytes, sha256: manifest.file.sha256 },
      apk: { bytes: apk.bytes, sha256: apk.sha256 },
      receipt: { bytes: receipt.file.bytes, sha256: receipt.file.sha256 },
    },
    manifest: value,
    receipt: receipt.value,
    manifestPath: manifest.file.path,
    apkPath: apk.path,
    receiptPath: receipt.file.path,
  };
}

export function advancePagesCurrentReleaseDescriptor({
  descriptor,
  workspaceRoot = defaultWorkspaceRoot,
  manifestPath,
  apkPath,
  receiptPath,
}) {
  const stored = validateStoredDescriptor(structuredClone(descriptor));
  const inspected = validatePagesReleaseFiles({
    workspaceRoot: resolve(workspaceRoot), descriptor: stored, manifestPath, apkPath, receiptPath,
  });
  const candidate = inspected.record;
  const current = stored.releases.at(-1);
  assert.ok(
    candidate.versionCode >= current.versionCode,
    `Refusing to move Pages backward from Android ${current.versionCode} to ${candidate.versionCode}`,
  );
  let action;
  let updated;
  if (candidate.versionCode === current.versionCode) {
    assert.deepEqual(candidate, current, `Android ${candidate.versionCode} differs from its immutable Pages release`);
    action = "reuse";
    updated = stored;
  } else {
    action = "append";
    updated = validateStoredDescriptor({ ...stored, releases: [...stored.releases, candidate] });
  }
  const expanded = validatePagesCurrentReleaseDescriptor(updated);
  const plan = pagesCurrentReleaseDownloadPlan(updated);
  return {
    action,
    versionCode: candidate.versionCode,
    versionName: candidate.versionName,
    tag: expanded.githubRelease.tag,
    assets: plan.assets.filter((asset) => asset.versionCode === candidate.versionCode),
    descriptor: updated,
  };
}

function validateLoadedRelease({ workspaceRoot, descriptor, release }) {
  const inspected = validatePagesReleaseFiles({
    workspaceRoot,
    descriptor,
    manifestPath: resolve(workspaceRoot, ...release.manifest.sourcePath.split("/")),
    apkPath: resolve(workspaceRoot, ...release.apk.sourcePath.split("/")),
    receiptPath: resolve(workspaceRoot, ...release.receipt.sourcePath.split("/")),
  });
  assert.deepEqual(
    inspected.record,
    {
      versionCode: release.versionCode,
      versionName: release.versionName,
      sourceRevision: release.sourceRevision,
      manifest: { bytes: release.manifest.bytes, sha256: release.manifest.sha256 },
      apk: { bytes: release.apk.bytes, sha256: release.apk.sha256 },
      receipt: { bytes: release.receipt.bytes, sha256: release.receipt.sha256 },
    },
    `Android ${release.versionCode} downloaded files differ from the stored descriptor`,
  );
  return {
    release,
    manifest: inspected.manifest,
    receipt: inspected.receipt,
    manifestPath: inspected.manifestPath,
    apkPath: inspected.apkPath,
    receiptPath: inspected.receiptPath,
  };
}

function validateCurrentSetupManifests(descriptor, current) {
  const setupManifests = new Map(descriptor.setupEntries.map((entry) => {
    const value = JSON.parse(readZipEntry(current.apkPath, entry).toString("utf8"));
    assert.ok(Array.isArray(value.artifacts), `${entry} does not contain an artifact list`);
    return [entry, value];
  }));
  const czechSetup = setupManifests.get("assets/courses/cz/setup-assets.json");
  const agreement = czechSetup.artifacts.filter((artifact) => artifact.key === "planet-agreement-aurora");
  assert.equal(agreement.length, 1, `Android ${current.release.versionCode} Czech setup is missing Agreement Aurora`);
  const artwork = agreement[0];
  assert.equal(artwork.asset_path, "assets/planets/agreement-aurora.png");
  assert.ok(Number.isSafeInteger(artwork.bytes) && artwork.bytes > 0, "Agreement Aurora byte count is invalid");
  assert.match(String(artwork.sha256 || ""), sha256Pattern, "Agreement Aurora SHA-256 is invalid");
  assert.equal(artwork.url, `/assets/planets/releases/${artwork.sha256.slice(0, 16)}/agreement-aurora.png`);
  return setupManifests;
}

export function loadPagesCurrentRelease({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesCurrentReleaseDescriptor,
} = {}) {
  const workspace = resolve(workspaceRoot);
  const stored = readStoredDescriptorFile({ workspaceRoot: workspace, descriptorPath }).descriptor;
  const descriptor = validatePagesCurrentReleaseDescriptor(stored);
  const releases = descriptor.releases.map((release) => validateLoadedRelease({ workspaceRoot: workspace, descriptor, release }));
  const current = releases.at(-1);
  const setupManifests = validateCurrentSetupManifests(descriptor, current);
  return { descriptor, releases, current, setupManifests };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { write: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    assert.ok(argument.startsWith("--"), `Invalid argument: ${argument}`);
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const value = rest[index + 1];
    assert.ok(value && !value.startsWith("--"), `${argument} requires a value`);
    options[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  assert.ok(options[name], `Missing --${name.replaceAll("_", "-")}`);
  return options[name];
}

export function writePagesCurrentReleaseDescriptor({
  path,
  workspaceRoot = defaultWorkspaceRoot,
  descriptor,
  expectedDescriptorIdentity,
}) {
  const file = assertRegularWorkspaceFile(path, workspaceRoot, "Pages current-release descriptor");
  const expected = validateStoredDescriptor(descriptor);
  assertExactKeys(expectedDescriptorIdentity, ["bytes", "sha256"], "Expected descriptor identity");
  assert.ok(
    Number.isSafeInteger(expectedDescriptorIdentity.bytes) && expectedDescriptorIdentity.bytes > 0,
    "Expected descriptor byte count is invalid",
  );
  assert.match(String(expectedDescriptorIdentity.sha256 || ""), sha256Pattern, "Expected descriptor SHA-256 is invalid");
  const lockPath = resolve(dirname(file.path), ".pages-current-release.lock");
  let lockFd = null;
  let temporaryDirectory = null;
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
    temporaryDirectory = mkdtempSync(resolve(dirname(file.path), ".pages-current-release-write-"));
    const temporaryPath = resolve(temporaryDirectory, "pages-current-release.json");
    writeFileSync(temporaryPath, `${JSON.stringify(expected, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    const currentFile = assertRegularWorkspaceFile(file.path, workspaceRoot, "Pages current-release descriptor");
    const currentRaw = readFileSync(currentFile.path);
    assert.deepEqual(
      { bytes: currentRaw.length, sha256: sha256Bytes(currentRaw) },
      expectedDescriptorIdentity,
      "Pages current-release descriptor changed since it was read; refusing to overwrite concurrent work",
    );
    renameSync(temporaryPath, file.path);
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    if (lockFd !== null) {
      try {
        closeSync(lockFd);
      } finally {
        rmSync(lockPath, { force: true });
      }
    }
  }
  assert.deepEqual(validateStoredDescriptor(JSON.parse(readFileSync(file.path, "utf8"))), expected);
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  const workspaceRoot = resolve(options.workspace_root || defaultWorkspaceRoot);
  const descriptorPath = resolve(options.descriptor || defaultPagesCurrentReleaseDescriptor);
  if (command === "download-plan") {
    assert.equal(options.write, false, "download-plan does not accept --write");
    const { descriptor } = readStoredDescriptorFile({ workspaceRoot, descriptorPath });
    process.stdout.write(`${JSON.stringify(pagesCurrentReleaseDownloadPlan(descriptor), null, 2)}\n`);
    return;
  }
  if (command === "verify") {
    assert.equal(options.write, false, "verify does not accept --write");
    const loaded = loadPagesCurrentRelease({ workspaceRoot, descriptorPath });
    process.stdout.write(`${JSON.stringify({
      action: "verified",
      releaseCount: loaded.releases.length,
      versionCode: loaded.current.release.versionCode,
      versionName: loaded.current.release.versionName,
      tag: loaded.current.release.githubRelease.tag,
    })}\n`);
    return;
  }
  if (command === "assert-prefix") {
    assert.equal(options.write, false, "assert-prefix does not accept --write");
    const previous = readStoredDescriptorFile({
      workspaceRoot,
      descriptorPath: resolve(required(options, "previous_descriptor")),
    }).descriptor;
    const next = readStoredDescriptorFile({
      workspaceRoot,
      descriptorPath: resolve(required(options, "next_descriptor")),
    }).descriptor;
    process.stdout.write(`${JSON.stringify(assertPagesReleaseHistoryPrefix(previous, next))}\n`);
    return;
  }
  if (command === "advance") {
    const { descriptor, identity } = readStoredDescriptorFile({ workspaceRoot, descriptorPath });
    const result = advancePagesCurrentReleaseDescriptor({
      descriptor,
      workspaceRoot,
      manifestPath: resolve(required(options, "manifest")),
      apkPath: resolve(required(options, "apk")),
      receiptPath: resolve(required(options, "receipt")),
    });
    if (options.write && result.action === "append") {
      writePagesCurrentReleaseDescriptor({
        path: descriptorPath,
        workspaceRoot,
        descriptor: result.descriptor,
        expectedDescriptorIdentity: identity,
      });
    }
    process.stdout.write(`${JSON.stringify({
      action: result.action,
      wrote: options.write && result.action === "append",
      versionCode: result.versionCode,
      versionName: result.versionName,
      tag: result.tag,
      assets: result.assets,
    })}\n`);
    return;
  }
  throw new Error("Usage: pages-current-release.mjs download-plan|verify|assert-prefix|advance [options]");
}

if (process.argv[1] && samePath(process.argv[1], modulePath)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
