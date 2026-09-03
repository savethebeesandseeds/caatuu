#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePagesCurrentReleaseDescriptor } from "./pages-current-release.mjs";

const modulePath = fileURLToPath(import.meta.url);
const sha256Pattern = /^[a-f0-9]{64}$/u;

function regularFile(path, label) {
  const absolute = resolve(path);
  assert.ok(existsSync(absolute), `${label} is missing: ${absolute}`);
  const stats = lstatSync(absolute);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `${label} is not a regular file: ${absolute}`);
  return { absolute, bytes: stats.size };
}

function fileRecord(path, label) {
  const file = regularFile(path, label);
  return {
    ...file,
    sha256: createHash("sha256").update(readFileSync(file.absolute)).digest("hex"),
  };
}

function readManifest(path, label) {
  const file = regularFile(path, label);
  const raw = readFileSync(file.absolute);
  const value = JSON.parse(raw.toString("utf8"));
  assert.ok(Number.isSafeInteger(value.version_code) && value.version_code > 0, `${label} version_code is invalid`);
  assert.ok(Number.isSafeInteger(value.bytes) && value.bytes > 0, `${label} bytes is invalid`);
  assert.match(String(value.sha256 || ""), sha256Pattern, `${label} sha256 is invalid`);
  return { file, raw, sha256: createHash("sha256").update(raw).digest("hex"), value };
}

function assertManifestMatchesApk(manifest, apk, label) {
  assert.equal(apk.bytes, manifest.value.bytes, `${label} APK byte count differs from its manifest`);
  assert.equal(apk.sha256, manifest.value.sha256, `${label} APK hash differs from its manifest`);
}

function readDurableFloor(path) {
  const file = regularFile(path, "Durable Pages release floor");
  const value = JSON.parse(readFileSync(file.absolute, "utf8"));
  const descriptor = validatePagesCurrentReleaseDescriptor(value);
  assert.equal(descriptor.schemaVersion, 2, "Durable release floor schema is unsupported");
  return descriptor.stable;
}

export function assertNewBuildVersion({ durableFloor, candidateVersionCode }) {
  const floor = readDurableFloor(durableFloor);
  const candidate = Number(candidateVersionCode);
  assert.ok(Number.isSafeInteger(candidate) && candidate > 0, "Candidate build version is invalid");
  assert.ok(
    candidate > floor.versionCode,
    `Refusing to rebuild Android version ${candidate}; the durable release floor is already ${floor.versionCode}`,
  );
  return { candidateVersionCode: candidate, floorVersionCode: floor.versionCode };
}

export function assertStableAliasAdvance({
  stableManifest,
  stableApk,
  candidateManifest,
  candidateApk,
  candidateReceipt,
  versionedReceipt,
  durableFloor,
}) {
  const candidate = readManifest(candidateManifest, "Candidate manifest");
  const candidateArtifact = fileRecord(candidateApk, "Candidate APK");
  assertManifestMatchesApk(candidate, candidateArtifact, "Candidate");
  const candidateReceiptFile = fileRecord(candidateReceipt, "Candidate receipt");
  const floor = readDurableFloor(durableFloor);
  assert.ok(
    candidate.value.version_code >= floor.versionCode,
    `Refusing Android version ${candidate.value.version_code}; the durable release floor is ${floor.versionCode}`,
  );
  if (candidate.value.version_code === floor.versionCode) {
    assert.equal(candidate.file.bytes, floor.manifest.bytes, "Floor-version manifest byte count differs from Pages");
    assert.equal(candidate.sha256, floor.manifest.sha256, "Floor-version manifest hash differs from Pages");
    assert.equal(candidateArtifact.bytes, floor.apk.bytes, "Floor-version APK byte count differs from Pages");
    assert.equal(candidateArtifact.sha256, floor.apk.sha256, "Floor-version APK hash differs from Pages");
    assert.equal(candidateReceiptFile.bytes, floor.receipt.bytes, "Floor-version receipt byte count differs from Pages");
    assert.equal(candidateReceiptFile.sha256, floor.receipt.sha256, "Floor-version receipt hash differs from Pages");
  }

  const stableManifestExists = existsSync(resolve(stableManifest));
  const stableApkExists = existsSync(resolve(stableApk));
  assert.equal(stableManifestExists, stableApkExists, "Stable Android aliases are incomplete");
  if (!stableManifestExists) return { action: "initialize", versionCode: candidate.value.version_code };

  const stable = readManifest(stableManifest, "Stable manifest");
  const stableArtifact = fileRecord(stableApk, "Stable APK");
  assertManifestMatchesApk(stable, stableArtifact, "Stable");
  assert.ok(
    candidate.value.version_code >= stable.value.version_code,
    `Refusing to move stable Android aliases backward from ${stable.value.version_code} to ${candidate.value.version_code}`,
  );
  if (candidate.value.version_code > stable.value.version_code) {
    return { action: "advance", versionCode: candidate.value.version_code };
  }

  assert.ok(stable.raw.equals(candidate.raw), "Same-version stable manifest differs from the sealed candidate");
  assert.equal(stableArtifact.sha256, candidateArtifact.sha256, "Same-version stable APK differs from the sealed candidate");
  assert.equal(stableArtifact.bytes, candidateArtifact.bytes, "Same-version stable APK size differs from the sealed candidate");
  const versionedReceiptFile = regularFile(versionedReceipt, "Versioned candidate receipt");
  assert.ok(
    readFileSync(candidateReceiptFile.absolute).equals(readFileSync(versionedReceiptFile.absolute)),
    "Same-version candidate receipt differs from the immutable versioned receipt",
  );
  return { action: "reuse", versionCode: candidate.value.version_code };
}

function parseArguments(argv) {
  const [command, ...argumentsList] = argv;
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    assert.ok(key?.startsWith("--") && value !== undefined, `Invalid argument near ${key || "<end>"}`);
    options[key.slice(2).replaceAll("-", "_")] = value;
  }
  return { command, options };
}

function required(options, name) {
  assert.ok(options[name], `Missing --${name.replaceAll("_", "-")}`);
  return options[name];
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  let result;
  if (command === "assert-alias-update") {
    result = assertStableAliasAdvance({
      stableManifest: required(options, "stable_manifest"),
      stableApk: required(options, "stable_apk"),
      candidateManifest: required(options, "candidate_manifest"),
      candidateApk: required(options, "candidate_apk"),
      candidateReceipt: required(options, "candidate_receipt"),
      versionedReceipt: required(options, "versioned_receipt"),
      durableFloor: required(options, "durable_floor"),
    });
  } else if (command === "assert-new-build-version") {
    result = assertNewBuildVersion({
      durableFloor: required(options, "durable_floor"),
      candidateVersionCode: required(options, "candidate_version_code"),
    });
  } else {
    throw new Error("Usage: release-publication-state.mjs assert-alias-update|assert-new-build-version [options]");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
