import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const toolingRoot = new URL("apps/android/tooling/", repoRoot);
const [
  debugBuild,
  releaseBuild,
  publicDebugBuild,
  publicDebugPublisher,
  storeMvpPublisher,
  certificatePin,
] =
  await Promise.all([
    readFile(new URL("build-debug-apk.sh", toolingRoot), "utf8"),
    readFile(new URL("build-release-apk.sh", toolingRoot), "utf8"),
    readFile(new URL("build-public-debug-apk.sh", toolingRoot), "utf8"),
    readFile(new URL("publish-public-debug.sh", toolingRoot), "utf8"),
    readFile(new URL("publish-public-store-mvp-preview.sh", toolingRoot), "utf8"),
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
  assert.doesNotMatch(publicDebugPublisher, /check-release-readiness|require-game/);
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

test("the canonical public publisher dispatches Store MVP without changing the default channel", () => {
  assert.match(publicDebugPublisher, /if \[\[ "\$\{1:-\}" == "--store-mvp" \]\]/);
  assert.match(
    publicDebugPublisher,
    /exec bash "\$repo_root\/apps\/android\/tooling\/publish-public-store-mvp-preview\.sh"/,
  );
  assert.match(publicDebugPublisher, /bash apps\/android\/tooling\/build-public-debug-apk\.sh/);
});

test("Store MVP preview publication uses the signed AAB-derived universal APK", () => {
  const focusedTestsIndex = storeMvpPublisher.indexOf(
    "node --test apps/android/tooling/tests/store-mvp-*.test.mjs",
  );
  const buildIndex = storeMvpPublisher.indexOf(
    "bash apps/android/tooling/build-release-aab.sh",
  );
  assert.ok(focusedTestsIndex >= 0 && buildIndex > focusedTestsIndex);
  assert.match(storeMvpPublisher, /bash apps\/android\/tooling\/build-release-aab\.sh/);
  assert.match(
    storeMvpPublisher,
    /source_apk="\$repo_root\/artifacts\/android\/caatuu-store-mvp-universal\.apk"/,
  );
  assert.match(
    storeMvpPublisher,
    /source_aab="\$repo_root\/artifacts\/android\/caatuu-store-mvp\.aab"/,
  );
  assert.doesNotMatch(storeMvpPublisher, /inspection-debug-signed/);
  assert.doesNotMatch(storeMvpPublisher, /source_apk=.*-direct\.apk/);
  assert.match(storeMvpPublisher, /validate-store-mvp-package\.mjs/);
});

test("Store MVP preview is signed by the persistent pinned preview lineage", () => {
  assert.match(
    storeMvpPublisher,
    /debug_keystore="\$repo_root\/artifacts\/android\/caatuu-debug\.keystore"/,
  );
  assert.match(storeMvpPublisher, /public-debug-certificate\.sha256/);
  for (const variable of [
    "CAATUU_ANDROID_KEYSTORE",
    "CAATUU_ANDROID_KEYSTORE_PASSWORD",
    "CAATUU_ANDROID_KEY_ALIAS",
    "CAATUU_ANDROID_KEY_PASSWORD",
  ]) {
    assert.match(storeMvpPublisher, new RegExp(`export ${variable}=`));
  }
  assert.match(storeMvpPublisher, /apksigner_bin.*verify --verbose --print-certs/s);
  assert.match(storeMvpPublisher, /local_signer_sha" != "\$expected_signer_sha"/);
  assert.match(storeMvpPublisher, /public_signer_sha" != "\$expected_signer_sha"/);
});

test("Store MVP preview source provenance fails closed", () => {
  assert.match(storeMvpPublisher, /required_tracked_files=/);
  assert.match(storeMvpPublisher, /git -C "\$repo_root" ls-files --error-unmatch/);
  assert.match(storeMvpPublisher, /git -C "\$repo_root" status --porcelain=v1 -z/);
  assert.match(storeMvpPublisher, /allowed_unrelated_dirty_paths=/);
  assert.match(storeMvpPublisher, /apps\/server\/tooling\/tests\/conjugation-comet-shell\.test\.mjs/);
  assert.match(storeMvpPublisher, /apps\/languages\/czech\/static\/conjugation-comet\.html/);
  const unrelatedException = storeMvpPublisher.indexOf(
    'if is_allowed_unrelated_dirty_path "$dirty_path"',
  );
  const consumedCheck = storeMvpPublisher.indexOf('elif is_store_source_path "$dirty_path"');
  assert.ok(unrelatedException >= 0 && consumedCheck > unrelatedException);
  assert.match(storeMvpPublisher, /HEAD changed during the Store MVP build/);
  assert.match(storeMvpPublisher, /git symbolic-ref --quiet --short HEAD/);
  assert.match(storeMvpPublisher, /git ls-remote --exit-code origin "refs\/heads\/\$source_branch"/);
  assert.match(storeMvpPublisher, /remote_source_revision" != "\$source_revision"/);
  assert.match(
    storeMvpPublisher,
    /source_url="https:\/\/github\.com\/savethebeesandseeds\/caatuu\/tree\/\$source_revision"/,
  );
});

test("Store MVP preview advances beyond the live same-package debug version", () => {
  assert.match(
    storeMvpPublisher,
    /public_debug_manifest_url="\$public_base_url\/android\/caatuu-debug\.json"/,
  );
  assert.match(storeMvpPublisher, /public_debug_package" != "com\.waajacu\.caatuu"/);
  assert.match(
    storeMvpPublisher,
    /candidate_version_code <= public_debug_version_code/,
  );
  assert.match(storeMvpPublisher, /version_code" != "\$candidate_version_code"/);
});

test("Store MVP preview owns an immutable nested path and no mutable alias", () => {
  assert.match(storeMvpPublisher, /channel="store-mvp-preview"/);
  assert.match(
    storeMvpPublisher,
    /versioned_relative_dir="debug-releases\/\$channel\/\$version_code"/,
  );
  assert.match(storeMvpPublisher, /artifact_name="caatuu-store-mvp\.apk"/);
  assert.match(storeMvpPublisher, /manifest_name="caatuu-store-mvp\.json"/);
  assert.doesNotMatch(
    storeMvpPublisher,
    /versioned_apk_path="\$repo_root\/artifacts\/android\/caatuu-store-mvp\.apk"/,
  );

  const lockIndex = storeMvpPublisher.indexOf(
    'exec {publication_lock_fd}>"$publication_lock"',
  );
  const immutableCheckIndex = storeMvpPublisher.indexOf(
    'if [[ -f "$versioned_apk_path" ]]',
  );
  assert.ok(lockIndex >= 0 && immutableCheckIndex > lockIndex);
  assert.match(storeMvpPublisher, /\.artifact-publication\.lock/);
  assert.match(storeMvpPublisher, /Refusing to replace changed Store MVP preview bytes/);
  assert.match(storeMvpPublisher, /Refusing to replace the immutable Store MVP preview manifest/);
  const manifestConflictIndex = storeMvpPublisher.indexOf(
    'if [[ -f "$versioned_manifest_path" ]]',
  );
  const firstApkMoveIndex = storeMvpPublisher.indexOf(
    'mv "$staged_apk" "$versioned_apk_path"',
  );
  assert.ok(manifestConflictIndex >= 0 && firstApkMoveIndex > manifestConflictIndex);
});

test("Store MVP preview manifest and public download preserve release evidence", () => {
  for (const field of [
    "profile",
    "channel",
    "signing_lineage",
    "source_revision",
    "source_url",
    "native_abis",
    "universal",
    "audit",
    "device_smoke",
  ]) {
    assert.match(storeMvpPublisher, new RegExp(`${field}:`));
  }
  assert.match(storeMvpPublisher, /device_smoke: "not-run"/);
  assert.match(storeMvpPublisher, /signing_lineage="public-debug-preview-v1"/);
  assert.match(storeMvpPublisher, /native_abis: \[\]/);
  assert.match(storeMvpPublisher, /universal: true/);
  assert.match(storeMvpPublisher, /store_mvp_package: "passed"/);
  assert.match(storeMvpPublisher, /download_sha" != "\$apk_sha"/);
  assert.match(storeMvpPublisher, /download_bytes" != "\$apk_bytes"/);
  assert.match(storeMvpPublisher, /cmp -s "\$versioned_manifest_path" "\$downloaded_manifest"/);
  assert.match(storeMvpPublisher, /max-age=31536000/);
  assert.match(storeMvpPublisher, /immutable/);
});
