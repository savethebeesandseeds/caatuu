import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const toolingRoot = new URL("apps/android/tooling/", repoRoot);
const [debugBuild, releaseBuild, publicDebugBuild, certificatePin] = await Promise.all([
  readFile(new URL("build-debug-apk.sh", toolingRoot), "utf8"),
  readFile(new URL("build-release-apk.sh", toolingRoot), "utf8"),
  readFile(new URL("build-public-debug-apk.sh", toolingRoot), "utf8"),
  readFile(new URL("public-debug-certificate.sha256", toolingRoot), "utf8"),
]);

test("Android artifact finalization is serialized before immutable paths are checked", () => {
  for (const [name, source] of [
    ["debug", debugBuild],
    ["release", releaseBuild],
  ]) {
    const lockIndex = source.indexOf('exec {publication_lock_fd}>"$publication_lock"');
    const immutableCheckIndex = source.indexOf('if [[ -f "$versioned_apk_path" ]]');
    assert.ok(lockIndex >= 0, `${name} build must acquire a publication lock`);
    assert.ok(
      immutableCheckIndex > lockIndex,
      `${name} build must lock before checking its immutable artifact`,
    );
    assert.match(source, /flock -w "\$\{CAATUU_ANDROID_PUBLICATION_LOCK_TIMEOUT_SECONDS:-120\}"/);
    assert.match(source, /\.artifact-publication\.lock/);
  }
});

test("public debug publication is pinned to the installed signing lineage", () => {
  assert.match(certificatePin.trim(), /^[a-f0-9]{64}$/);
  assert.match(publicDebugBuild, /public-debug-certificate\.sha256/);
  assert.match(publicDebugBuild, /CAATUU_REQUIRE_EXISTING_DEBUG_KEYSTORE=1/);
  assert.match(publicDebugBuild, /CAATUU_EXPECTED_DEBUG_CERT_SHA256="\$expected_signer_sha"/);
  assert.match(debugBuild, /CAATUU_REQUIRE_EXISTING_DEBUG_KEYSTORE:-0/);
  assert.match(debugBuild, /Refusing to create a new signing lineage/);
  assert.match(debugBuild, /Signer #1 certificate SHA-256 digest:/);
  assert.match(debugBuild, /signer_sha" != "\$expected_signer_sha"/);
  assert.match(debugBuild, /installed Caatuu clients cannot update to/);
});
