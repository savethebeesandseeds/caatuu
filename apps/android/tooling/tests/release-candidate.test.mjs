import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  createCandidateReceipt,
  capturePackageAuditInput,
  createInvocationAuditProof,
  sealCandidateReceipt,
  verifyCandidateReceipt,
  verifyInvocationAuditProof,
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

function auditFixture(t) {
  const repoRoot = fixture(t);
  const tooling = join(repoRoot, "apps/android/tooling");
  const bin = join(repoRoot, "bin");
  mkdirSync(tooling, { recursive: true });
  mkdirSync(bin);
  copyFileSync(new URL("../release-candidate.mjs", import.meta.url), join(tooling, "release-candidate.mjs"));
  writeFileSync(join(tooling, "validate-product-package.mjs"), 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.AUDIT_LOG, "full\\n");\n');
  writeFileSync(join(tooling, "direct-release-certificate.sha256"), signer);
  const executable = (name, source) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${source}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const apkanalyzer = executable("apkanalyzer", `case "$2" in\napplication-id) printf '%s' "\${TEST_PACKAGE_NAME:-com.waajacu.caatuu}" ;;\nversion-code) printf '163' ;;\nversion-name) printf '0.1.11' ;;\ndebuggable) printf 'false' ;;\nesac`);
  const unzip = executable("unzip", "exit 0");
  const apksigner = executable("apksigner", `printf 'Signer #1 certificate SHA-256 digest: %s\\n' "\${TEST_SIGNER:-${signer}}"`);
  executable("git", `case "$3" in\nrev-parse) printf '${revision}\\n' ;;\nstatus) exit 0 ;;\n*) exit 1 ;;\nesac`);
  const context = { apkanalyzer, unzip, verifySource: () => {} };
  const auditInput = capturePackageAuditInput({ ...options(repoRoot), ...context });
  const receiptPath = "artifacts/android/release-candidates/163.json";
  sealCandidateReceipt({ ...options(repoRoot), mode: "builder-emitted", output: receiptPath });
  const challenge = "a".repeat(64);
  const proof = createInvocationAuditProof({ repoRoot, receiptPath, auditInput, challenge, verifyCommit, ...context });
  const proofPath = "artifacts/android/invocation-proof.json";
  writeFileSync(join(repoRoot, proofPath), JSON.stringify(proof));
  const verify = { repoRoot, receiptPath, proofPath, challenge, apk: options(repoRoot).apk, aab: options(repoRoot).aab, ...context };
  return { repoRoot, bin, tooling, apksigner, receiptPath, proofPath, challenge, context, auditInput, proof, verify };
}

test("same-invocation audit proof binds exact audited inputs, receipt, source and verifier", (t) => {
  const f = auditFixture(t);
  assert.deepEqual(verifyInvocationAuditProof(f.verify), { reused: true, source_revision: revision });
  assert.throws(() => verifyInvocationAuditProof({ ...f.verify, challenge: "b".repeat(64) }), /another invocation/u);
  assert.throws(() => verifyInvocationAuditProof({ ...f.verify, proofPath: "artifacts/android/missing.json" }), /missing/u);
  assert.throws(() => verifyInvocationAuditProof({ ...f.verify, verifySource() { throw new Error("dependency changed"); } }), /dependency changed/u);
});

test("audit reuse rejects tampered artifacts, receipts and changed verifier tools", async (t) => {
  for (const mode of ["apk", "aab", "receipt", "validator", "tool", "proof"]) {
    await t.test(mode, (caseTest) => {
      const f = auditFixture(caseTest);
      if (mode === "apk") writeFileSync(join(f.repoRoot, f.verify.apk), "mutated APK");
      if (mode === "aab") writeFileSync(join(f.repoRoot, f.verify.aab), "mutated AAB");
      if (mode === "receipt") writeFileSync(join(f.repoRoot, f.receiptPath), `${readFileSync(join(f.repoRoot, f.receiptPath), "utf8")}\n`);
      if (mode === "validator") writeFileSync(join(f.tooling, "validate-product-package.mjs"), "changed verifier");
      if (mode === "tool") writeFileSync(f.context.unzip, "changed tool");
      if (mode === "proof") {
        f.proof.artifacts.apk.sha256 = "b".repeat(64);
        writeFileSync(join(f.repoRoot, f.proofPath), JSON.stringify(f.proof));
      }
      assert.throws(() => verifyInvocationAuditProof(f.verify));
    });
  }
});

test("artifact changes between the audit and sealing cannot produce reuse proof", (t) => {
  const f = auditFixture(t);
  writeFileSync(join(f.repoRoot, f.verify.apk), "different candidate");
  const receiptPath = "artifacts/android/release-candidates/other.json";
  sealCandidateReceipt({ ...options(f.repoRoot), mode: "builder-emitted", output: receiptPath });
  assert.throws(() => createInvocationAuditProof({ repoRoot: f.repoRoot, receiptPath, auditInput: f.auditInput, challenge: f.challenge, verifyCommit, ...f.context }), /between package audit and sealing/u);
});

test("same-invocation proof seals and rechecks downloadable setup bytes", (t) => {
  const f = auditFixture(t);
  const setup = "artifacts/android/setup.tar";
  writeFileSync(join(f.repoRoot, setup), "original downloadable content");
  const setupOptions = { ...options(f.repoRoot), setup, mode: "builder-emitted" };
  const input = capturePackageAuditInput({ ...setupOptions, ...f.context });
  const receiptPath = "artifacts/android/release-candidates/with-setup.json";
  sealCandidateReceipt({ ...setupOptions, output: receiptPath });
  const proof = createInvocationAuditProof({ repoRoot: f.repoRoot, receiptPath, auditInput: input, challenge: f.challenge, verifyCommit, ...f.context });
  writeFileSync(join(f.repoRoot, f.proofPath), JSON.stringify(proof));
  verifyInvocationAuditProof({ ...f.verify, receiptPath, setup });
  writeFileSync(join(f.repoRoot, setup), "mutated downloadable content");
  assert.throws(() => verifyInvocationAuditProof({ ...f.verify, receiptPath, setup }), /SETUP.*changed/u);
  assert.throws(() => createInvocationAuditProof({ repoRoot: f.repoRoot, receiptPath, auditInput: input, challenge: f.challenge, verifyCommit, ...f.context }), /SETUP bytes changed/u);
});

test("adoption cannot create same-invocation builder audit proof", (t) => {
  const f = auditFixture(t);
  const receiptPath = "artifacts/android/release-candidates/adopted.json";
  sealCandidateReceipt({ ...options(f.repoRoot), output: receiptPath });
  assert.throws(() => createInvocationAuditProof({ repoRoot: f.repoRoot, receiptPath, auditInput: f.auditInput, challenge: f.challenge, verifyCommit, ...f.context }), /Adopted candidates require a full/u);
});

const publisher = readFileSync(new URL("../publish-release.sh", import.meta.url), "utf8");
function publisherAuditFunctions() {
  return publisher.slice(publisher.indexOf("read_signer_sha() {"), publisher.indexOf("\nassert_main_only\n"));
}

test("publisher behavior audits once for a fresh proof and fully audits stale, missing, adopted or changed-verifier candidates", async (t) => {
  for (const mode of ["fresh", "stale", "missing", "adopted", "changed-verifier", "changed-apk"]) {
    await t.test(mode, (caseTest) => {
      const f = auditFixture(caseTest);
      const auditLog = join(f.repoRoot, "audit.log");
      if (mode === "fresh") writeFileSync(auditLog, "full\n"); // The builder's successful full audit.
      if (mode === "missing") rmSync(join(f.repoRoot, f.proofPath));
      if (mode === "adopted") {
        const receipt = JSON.parse(readFileSync(join(f.repoRoot, f.receiptPath), "utf8"));
        receipt.mode = "adopted-existing";
        writeFileSync(join(f.repoRoot, f.receiptPath), JSON.stringify(receipt));
      }
      if (mode === "changed-verifier") writeFileSync(join(f.tooling, "validate-product-package.mjs"), `${readFileSync(join(f.tooling, "validate-product-package.mjs"), "utf8")}\n// new policy\n`);
      if (mode === "changed-apk") writeFileSync(join(f.repoRoot, f.verify.apk), "changed staged APK");
      const result = spawnSync("bash", ["-c", `set -euo pipefail\nrepo_root="$1"\ncertificate_pin_path="$repo_root/apps/android/tooling/direct-release-certificate.sha256"\napksigner_bin="$repo_root/bin/apksigner"\n${publisherAuditFunctions()}\nvalidate_and_read_existing_candidate "$repo_root/${f.verify.apk}" "$repo_root/${f.verify.aab}" "$repo_root/${f.proofPath}" "$2" "$repo_root/${f.receiptPath}"`, "audit-test", f.repoRoot, mode === "stale" ? "b".repeat(64) : f.challenge], {
        encoding: "utf8", env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, AUDIT_LOG: auditLog },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(auditLog, "utf8"), "full\n", "A fresh builder audit is reused; all other candidates receive a full audit");
    });
  }
});

test("a reused package audit still enforces the package identity and signer pin", async (t) => {
  for (const extra of [{ TEST_PACKAGE_NAME: "com.other.app" }, { TEST_SIGNER: "0".repeat(64) }]) {
    await t.test(Object.keys(extra)[0], (caseTest) => {
      const f = auditFixture(caseTest);
      const auditLog = join(f.repoRoot, "audit.log");
      const result = spawnSync("bash", ["-c", `set -euo pipefail\nrepo_root="$1"\ncertificate_pin_path="$repo_root/apps/android/tooling/direct-release-certificate.sha256"\napksigner_bin="$repo_root/bin/apksigner"\n${publisherAuditFunctions()}\nvalidate_and_read_existing_candidate "$repo_root/${f.verify.apk}" "$repo_root/${f.verify.aab}" "$repo_root/${f.proofPath}" "${f.challenge}" "$repo_root/${f.receiptPath}"`, "audit-test", f.repoRoot], {
        encoding: "utf8", env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, AUDIT_LOG: auditLog, ...extra },
      });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(auditLog), false, "The already passed full audit need not repeat to reject an invalid identity");
    });
  }
});
