#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(modulePath), "../../..");
const sha256Pattern = /^[a-f0-9]{64}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
const repository = "savethebeesandseeds/caatuu";
const packageName = "com.waajacu.caatuu";
const signingLineage = "direct-release-v1";

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function slashPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function normalizeRelativePath(value, label) {
  const path = slashPath(value);
  assert.ok(path && !path.startsWith("/") && !isAbsolute(path), `${label} must be relative`);
  const parts = path.split("/");
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."), `${label} is unsafe: ${path}`);
  assert.equal(parts.join("/"), path, `${label} is not normalized: ${path}`);
  return path;
}

function assertNoSymlinkAncestors(path, boundary, label) {
  const root = resolve(boundary);
  let current = resolve(path);
  assert.ok(current === root || inside(root, current), `${label} escapes the repository`);
  while (current !== root) {
    if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(), `${label} uses a symbolic link`);
    current = dirname(current);
  }
}

function regularArtifact(repoRoot, value, label) {
  const root = resolve(repoRoot);
  const path = normalizeRelativePath(value, `${label}.path`);
  const absolute = resolve(root, ...path.split("/"));
  assert.ok(inside(root, absolute), `${label}.path escapes the repository`);
  assertNoSymlinkAncestors(absolute, root, label);
  assert.ok(existsSync(absolute), `${label} is missing: ${path}`);
  const stats = lstatSync(absolute);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `${label} is not a regular file: ${path}`);
  return { absolute, path, stats };
}

export function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function artifactRecord(repoRoot, value, label) {
  const artifact = regularArtifact(repoRoot, value, label);
  return {
    path: artifact.path,
    bytes: artifact.stats.size,
    sha256: sha256File(artifact.absolute),
  };
}

function assertHash(value, label) {
  assert.match(String(value || ""), sha256Pattern, `${label} must be a lowercase SHA-256 digest`);
}

function assertRevision(value, label = "source revision") {
  assert.match(String(value || ""), revisionPattern, `${label} must be a lowercase 40-character Git revision`);
}

function defaultCommitVerifier(repoRoot, revision) {
  const result = spawnSync("git", ["-C", resolve(repoRoot), "cat-file", "-e", `${revision}^{commit}`], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, `Source revision is not a local Git commit: ${revision}`);
}

function validateIdentity({ package_name, version_code, version_name, debuggable, signer_certificate_sha256 }) {
  assert.equal(package_name, packageName, `Candidate package must be ${packageName}`);
  assert.ok(Number.isSafeInteger(version_code) && version_code > 0, "Candidate version code must be a positive integer");
  assert.match(String(version_name || ""), /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u, "Candidate version name is invalid");
  assert.equal(debuggable, false, "A publishable candidate must be non-debuggable");
  assertHash(signer_certificate_sha256, "Candidate signer certificate");
}

function validateReceiptShape(receipt) {
  assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt), "Candidate receipt is not an object");
  assert.equal(receipt.schema_name, "caatuu-android-release-candidate");
  assert.equal(receipt.schema_version, 1);
  assert.ok(["adopted-existing", "builder-emitted"].includes(receipt.mode), "Candidate receipt mode is invalid");
  assert.equal(receipt.repository, repository);
  assertRevision(receipt.source_revision);
  assert.equal(receipt.source_url, `https://github.com/${repository}/tree/${receipt.source_revision}`);
  validateIdentity(receipt.identity || {});
  assert.equal(receipt.identity.build_type, "release");
  assert.equal(receipt.identity.signing_lineage, signingLineage);
  assert.ok(receipt.artifacts && typeof receipt.artifacts === "object", "Candidate artifacts are missing");
  for (const key of ["apk", "aab"]) {
    const artifact = receipt.artifacts[key];
    assert.ok(artifact && typeof artifact === "object", `Candidate ${key.toUpperCase()} record is missing`);
    normalizeRelativePath(artifact.path, `artifacts.${key}.path`);
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, `artifacts.${key}.bytes is invalid`);
    assertHash(artifact.sha256, `artifacts.${key}.sha256`);
  }
  assert.deepEqual(receipt.audit, { bundletool: "passed", product_package: "passed" });
  return receipt;
}

export function createCandidateReceipt({
  repoRoot = defaultRepoRoot,
  apk,
  aab,
  sourceRevision,
  packageName: candidatePackageName,
  versionCode,
  versionName,
  debuggable,
  signerSha256,
  mode,
  expectedApkSha256,
  verifyCommit = defaultCommitVerifier,
}) {
  const root = resolve(repoRoot);
  assertRevision(sourceRevision);
  verifyCommit(root, sourceRevision);
  assert.ok(["adopted-existing", "builder-emitted"].includes(mode), "Candidate mode is invalid");
  const identity = {
    package_name: candidatePackageName,
    version_code: Number(versionCode),
    version_name: versionName,
    build_type: "release",
    debuggable: debuggable === false || debuggable === "false" ? false : debuggable,
    signing_lineage: signingLineage,
    signer_certificate_sha256: String(signerSha256 || "").toLowerCase(),
  };
  validateIdentity(identity);
  const artifacts = {
    apk: artifactRecord(root, apk, "APK"),
    aab: artifactRecord(root, aab, "AAB"),
  };
  if (expectedApkSha256) {
    assertHash(expectedApkSha256, "Expected APK SHA-256");
    assert.equal(artifacts.apk.sha256, expectedApkSha256, "Existing APK does not match the explicitly approved SHA-256");
  }
  return validateReceiptShape({
    schema_name: "caatuu-android-release-candidate",
    schema_version: 1,
    mode,
    repository,
    source_revision: sourceRevision,
    source_url: `https://github.com/${repository}/tree/${sourceRevision}`,
    identity,
    artifacts,
    audit: { bundletool: "passed", product_package: "passed" },
  });
}

function readReceiptFile(repoRoot, receiptPath) {
  const root = resolve(repoRoot);
  const relativePath = isAbsolute(receiptPath)
    ? slashPath(relative(root, resolve(receiptPath)))
    : normalizeRelativePath(receiptPath, "Receipt path");
  const receiptFile = regularArtifact(root, relativePath, "Candidate receipt");
  return { receipt: JSON.parse(readFileSync(receiptFile.absolute, "utf8")), absolute: receiptFile.absolute };
}

export function verifyCandidateReceipt({
  repoRoot = defaultRepoRoot,
  receipt,
  receiptPath,
  expectedApkSha256,
  expectedSourceRevision,
  verifyCommit = defaultCommitVerifier,
}) {
  const root = resolve(repoRoot);
  const value = receipt || readReceiptFile(root, receiptPath).receipt;
  validateReceiptShape(value);
  verifyCommit(root, value.source_revision);
  if (expectedSourceRevision) {
    assertRevision(expectedSourceRevision, "Expected source revision");
    assert.equal(value.source_revision, expectedSourceRevision, "Candidate source revision changed");
  }
  if (expectedApkSha256) {
    assertHash(expectedApkSha256, "Expected APK SHA-256");
    assert.equal(value.artifacts.apk.sha256, expectedApkSha256, "Candidate receipt has the wrong APK SHA-256");
  }
  for (const key of ["apk", "aab"]) {
    const actual = artifactRecord(root, value.artifacts[key].path, key.toUpperCase());
    assert.deepEqual(actual, value.artifacts[key], `Candidate ${key.toUpperCase()} bytes changed after sealing`);
  }
  return value;
}

export function sealCandidateReceipt({ repoRoot = defaultRepoRoot, output, ...options }) {
  const root = resolve(repoRoot);
  const relativeOutput = isAbsolute(output)
    ? slashPath(relative(root, resolve(output)))
    : normalizeRelativePath(output, "Receipt output");
  const absoluteOutput = resolve(root, ...relativeOutput.split("/"));
  assert.ok(inside(root, absoluteOutput), "Receipt output escapes the repository");
  assertNoSymlinkAncestors(dirname(absoluteOutput), root, "Receipt output");
  const receipt = createCandidateReceipt({ repoRoot: root, ...options });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (existsSync(absoluteOutput)) {
    const existingFile = regularArtifact(root, relativeOutput, "Candidate receipt");
    const existing = validateReceiptShape(JSON.parse(readFileSync(existingFile.absolute, "utf8")));
    assert.deepEqual(existing, receipt, `Refusing to replace a different candidate receipt: ${relativeOutput}`);
    return receipt;
  }
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  const temporary = `${absoluteOutput}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, absoluteOutput);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existingFile = regularArtifact(root, relativeOutput, "Candidate receipt");
      const existing = validateReceiptShape(JSON.parse(readFileSync(existingFile.absolute, "utf8")));
      assert.deepEqual(existing, receipt, `Refusing to replace a different candidate receipt: ${relativeOutput}`);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  return receipt;
}

function parseArguments(argv) {
  const [command, ...argumentsList] = argv;
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    assert.ok(key?.startsWith("--") && value !== undefined && !value.startsWith("--"), `Invalid argument near ${key || "<end>"}`);
    const name = key.slice(2).replaceAll("-", "_");
    assert.equal(options[name], undefined, `Repeated argument: ${key}`);
    options[name] = value;
  }
  return { command, options };
}

function required(options, name) {
  assert.ok(options[name], `Missing --${name.replaceAll("_", "-")}`);
  return options[name];
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  const repoRoot = resolve(options.repo_root || defaultRepoRoot);
  let receipt;
  if (command === "seal-existing") {
    receipt = sealCandidateReceipt({
      repoRoot,
      output: required(options, "output"),
      apk: required(options, "apk"),
      aab: required(options, "aab"),
      sourceRevision: required(options, "source_revision"),
      packageName: required(options, "package_name"),
      versionCode: Number(required(options, "version_code")),
      versionName: required(options, "version_name"),
      debuggable: required(options, "debuggable"),
      signerSha256: required(options, "signer_sha256").toLowerCase(),
      mode: required(options, "mode"),
      expectedApkSha256: options.expected_apk_sha256?.toLowerCase(),
    });
  } else if (command === "verify") {
    receipt = verifyCandidateReceipt({
      repoRoot,
      receiptPath: required(options, "receipt"),
      expectedApkSha256: options.expected_apk_sha256?.toLowerCase(),
      expectedSourceRevision: options.expected_source_revision?.toLowerCase(),
    });
  } else {
    throw new Error("Usage: release-candidate.mjs seal-existing|verify [options]");
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
