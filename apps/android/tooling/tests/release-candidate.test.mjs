import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createCandidateReceipt,
  sealCandidateReceipt,
  verifyCandidateReceipt,
} from "../release-candidate.mjs";

const revision = "91ba021979275160ca30cacabe8a954aa1bf2341";
const signer = "c663bdec81ef8876f261ebbc3ab95d96789972eb8bc1b22e8e17acf44469af55";
const verifyCommit = () => {};

function fixture(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), "caatuu-release-candidate-"));
  const artifactDir = join(repoRoot, "artifacts/android");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "caatuu-universal.apk"), "approved-apk-bytes");
  writeFileSync(join(artifactDir, "caatuu.aab"), "approved-aab-bytes");
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  return repoRoot;
}

function options(repoRoot) {
  return {
    repoRoot,
    apk: "artifacts/android/caatuu-universal.apk",
    aab: "artifacts/android/caatuu.aab",
    sourceRevision: revision,
    packageName: "com.waajacu.caatuu",
    versionCode: 163,
    versionName: "0.1.11",
    debuggable: false,
    signerSha256: signer,
    mode: "adopted-existing",
    verifyCommit,
  };
}

test("a candidate receipt deterministically binds the approved APK and AAB", (t) => {
  const repoRoot = fixture(t);
  const first = createCandidateReceipt(options(repoRoot));
  const second = createCandidateReceipt(options(repoRoot));
  assert.deepEqual(first, second);
  assert.equal(first.identity.version_code, 163);
  assert.equal(first.artifacts.apk.bytes, 18);
  assert.match(first.artifacts.apk.sha256, /^[a-f0-9]{64}$/u);
});

test("sealing is idempotent but refuses a different existing receipt", (t) => {
  const repoRoot = fixture(t);
  const output = "artifacts/android/release-candidates/163.json";
  const first = sealCandidateReceipt({ ...options(repoRoot), output });
  const second = sealCandidateReceipt({ ...options(repoRoot), output });
  assert.deepEqual(second, first);
  const path = join(repoRoot, output);
  const changed = JSON.parse(readFileSync(path, "utf8"));
  changed.identity.version_name = "0.1.11-replaced";
  writeFileSync(path, `${JSON.stringify(changed, null, 2)}\n`);
  assert.throws(() => sealCandidateReceipt({ ...options(repoRoot), output }), /Refusing to replace a different candidate receipt/u);
});

test("verification rejects APK mutation after sealing", (t) => {
  const repoRoot = fixture(t);
  const receipt = createCandidateReceipt(options(repoRoot));
  verifyCandidateReceipt({ repoRoot, receipt, verifyCommit });
  writeFileSync(join(repoRoot, "artifacts/android/caatuu-universal.apk"), "mutated-apk-bytes");
  assert.throws(
    () => verifyCandidateReceipt({ repoRoot, receipt, verifyCommit }),
    /APK bytes changed after sealing/u,
  );
});
test("unsafe paths and an unapproved APK hash fail closed", (t) => {
  const repoRoot = fixture(t);
  assert.throws(() => createCandidateReceipt({ ...options(repoRoot), apk: "../outside.apk" }), /unsafe|escapes/u);
  assert.throws(
    () => createCandidateReceipt({ ...options(repoRoot), expectedApkSha256: "0".repeat(64) }),
    /does not match the explicitly approved SHA-256/u,
  );
});
