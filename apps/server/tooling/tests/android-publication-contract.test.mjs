import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../..", import.meta.url);
const toolingRoot = new URL("apps/android/tooling/", repoRoot);
const [releasePublisher, retiredDebugPublisher, releaseBuilder, productBuilder] = await Promise.all([
  readFile(new URL("publish-release.sh", toolingRoot), "utf8"),
  readFile(new URL("publish-public-debug.sh", toolingRoot), "utf8"),
  readFile(new URL("build-release-apk.sh", toolingRoot), "utf8"),
  readFile(new URL("build-release-aab.sh", toolingRoot), "utf8"),
]);

test("Caatuu has one canonical stable publication command", () => {
  assert.match(releasePublisher, /publication_contract_url=.*\/android\/releases\/status/);
  assert.match(releasePublisher, /public_manifest_url=.*\/android\/caatuu\.json/);
  assert.match(releasePublisher, /channel="stable"/);
  assert.match(releasePublisher, /profile="product"/);
  assert.match(releasePublisher, /versioned_relative_dir="releases\/\$version_code"/);
  assert.match(releasePublisher, /versioned_relative_apk="\$versioned_relative_dir\/caatuu\.apk"/);
  assert.doesNotMatch(releasePublisher, /channel=".*preview/);
});

test("the old public debug publisher cannot replace the product", () => {
  assert.match(retiredDebugPublisher, /The public debug channel is retired/);
  assert.match(retiredDebugPublisher, /publish-release\.sh/);
  assert.match(retiredDebugPublisher, /--local-build/);
  assert.doesNotMatch(retiredDebugPublisher, /publish-public-store/);
});

test("release builders construct the stripped product module", () => {
  assert.match(releaseBuilder, /build-release-aab\.sh/);
  assert.match(releaseBuilder, /caatuu-universal\.apk/);
  assert.match(productBuilder, /-PcaatuuDistributionProfile=product/);
  assert.match(productBuilder, /:product:bundleRelease/);
  assert.match(productBuilder, /validate-product-package\.mjs/);
  assert.doesNotMatch(productBuilder, /prepare-llama-vendor|:app:|:llamaLib:/);
});

test("stable publication fails closed on source, version, signing, and immutable bytes", () => {
  assert.match(releasePublisher, /required_tracked_files=/);
  assert.match(releasePublisher, /check_source_state/);
  assert.match(releasePublisher, /git ls-remote --exit-code origin/);
  assert.match(releasePublisher, /candidate_version_code <= stable_version_code/);
  assert.match(releasePublisher, /transition_version_code <= legacy_version_code/);
  assert.match(releasePublisher, /direct-release-certificate\.sha256/);
  assert.match(releasePublisher, /local_signer_sha.*expected_signer_sha/s);
  assert.match(releasePublisher, /\.artifact-publication\.lock/);
  assert.match(releasePublisher, /Refusing to replace immutable Caatuu APK bytes/);
  assert.match(releasePublisher, /Refusing to replace the immutable Caatuu manifest/);
  assert.match(releasePublisher, /validate-product-package\.mjs/);
});

test("the stable manifest records a real non-debuggable product", () => {
  for (const field of [
    "profile:", "channel:", "signing_lineage:", "package_name:", "version_code:",
    "version_name:", "apk_url:", "sha256:", "bytes:", "source_revision:",
    "source_url:", "capabilities:",
  ]) {
    assert.match(releasePublisher, new RegExp(field));
  }
  assert.match(releasePublisher, /build_type: "release", debuggable: false/);
  assert.match(releasePublisher, /capabilities: \{llm: false, godot: false, embeddings: true\}/);
  assert.match(releasePublisher, /product_package: "passed"/);
  assert.match(releasePublisher, /device_smoke: "not-run"/);
});

test("existing installations receive a narrow, explicit update bridge", () => {
  assert.match(releasePublisher, /legacy_manifest_url=.*\/android\/caatuu-debug\.json/);
  assert.match(releasePublisher, /transition_relative_dir="debug-releases\/product-transition\/\$transition_version_code"/);
  assert.match(releasePublisher, /channel: "legacy-update-bridge"/);
  assert.match(releasePublisher, /build_type: "debug", debuggable: true/);
  assert.match(releasePublisher, /releaseMigration: true/);
  assert.match(releasePublisher, /compatibility_for_version_codes_through: 144/);
  assert.match(releasePublisher, /-PcaatuuVersionCode="\$transition_version_code"/);
  assert.match(releasePublisher, /:product:assembleDebug/);
  assert.match(releasePublisher, /--allow-transition-debug/);
  assert.match(releasePublisher, /cp "\$transition_apk_path" "\$repo_root\/artifacts\/android\/caatuu-debug\.apk"/);
  assert.match(releasePublisher, /cp "\$staged_legacy_manifest" "\$repo_root\/artifacts\/android\/caatuu-debug\.json"/);
  assert.match(releasePublisher, /can migrate through transition code/);
});

test("publication verifies the exact public artifact and immutable cache policy", () => {
  assert.match(releasePublisher, /sha256sum "\$downloaded_apk"/);
  assert.match(releasePublisher, /wc -c < "\$downloaded_apk"/);
  assert.match(releasePublisher, /cmp -s "\$versioned_manifest_path" "\$downloaded_manifest"/);
  assert.match(releasePublisher, /max-age=31536000/);
  assert.match(releasePublisher, /immutable/);
  assert.match(releasePublisher, /read_signer_sha "\$downloaded_apk"/);
  assert.match(releasePublisher, /sha256sum "\$downloaded_transition_apk"/);
  assert.match(releasePublisher, /read_signer_sha "\$downloaded_transition_apk"/);
});
