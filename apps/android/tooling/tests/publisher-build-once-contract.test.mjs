import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publisher = await readFile(new URL("../publish-release.sh", import.meta.url), "utf8");
const builder = await readFile(new URL("../build-release-aab.sh", import.meta.url), "utf8");

test("publication can adopt or promote an exact signed candidate without an Android build", () => {
  assert.match(publisher, /--candidate-receipt/u);
  assert.match(publisher, /--adopt-existing/u);
  assert.match(publisher, /--expected-apk-sha256/u);
  assert.match(publisher, /It never starts an implicit Android build/u);
  assert.match(publisher, /Finalized Caatuu .* from a sealed candidate; no Gradle build ran/u);
});

test("a new release has one explicit build boundary and no regenerated transition", () => {
  assert.equal(publisher.match(/build-release-aab\.sh/gu)?.length, 1);
  assert.match(publisher, /if \[\[ "\$mode" == "build-once" \]\]; then/u);
  assert.doesNotMatch(publisher, /assembleDebug|caatuu-transition|transition_apk/u);
  assert.doesNotMatch(publisher, /android\/releases\/status|android\/debug-releases\/status/u);
});

test("build-once reuses a receipt only for the exact clean pushed source and declared version", () => {
  const buildOnceStart = publisher.indexOf('if [[ "$mode" == "build-once" ]]');
  const buildOnce = publisher.slice(buildOnceStart, publisher.indexOf("\nload_android_tools\n", buildOnceStart));
  const cleanGuard = buildOnce.indexOf("assert_clean_build_source");
  const currentRevision = buildOnce.indexOf('expected_source_revision="$(git -C "$repo_root" rev-parse HEAD)"');
  const receiptGuard = buildOnce.indexOf('if [[ -f "$candidate_receipt" ]]');
  assert.ok(cleanGuard >= 0 && cleanGuard < receiptGuard);
  assert.ok(currentRevision > cleanGuard && currentRevision < receiptGuard);
  assert.match(buildOnce, /\.identity\.version_code/u);
  assert.match(buildOnce, /\.identity\.version_name/u);
  assert.match(buildOnce, /does not match the Android version declared by current main/u);
  assert.match(publisher, /--expected-source-revision "\$expected_source_revision"/u);
  const finalization = publisher.slice(publisher.indexOf('start_phase "Finalize local immutable release"'));
  assert.ok(finalization.match(/assert_clean_build_source/gu)?.length >= 2);
  assert.match(finalization, /Current main changed after the build-once source was selected/u);
  assert.match(finalization, /Current main changed during candidate finalization/u);
});

test("the builder reuses a sealed same-source candidate instead of launching Gradle", () => {
  const buildLock = builder.indexOf(".signed-release-build.lock");
  const receiptGuard = builder.indexOf("if [[ \"$signed\" == true && -f \"$candidate_receipt\" ]]");
  const durableFloorGuard = builder.indexOf("assert-new-build-version");
  const gradleInvocation = builder.indexOf("gradle --no-daemon");
  assert.equal(builder.match(/^[ \t]*(?:gradle|(?:\.\/)?gradlew)(?=[ \t])/gmu)?.length, 1);
  assert.ok(buildLock >= 0 && buildLock < receiptGuard);
  assert.match(builder, /flock -n "\$build_lock_fd"/u);
  assert.ok(receiptGuard >= 0 && receiptGuard < gradleInvocation);
  assert.ok(durableFloorGuard > receiptGuard && durableFloorGuard < gradleInvocation);
  assert.match(builder, /release-candidate\.mjs" verify/u);
  assert.match(builder, /no Android build was started/u);
  assert.match(builder, /release-candidate\.mjs" seal-existing/u);
});

test("signed and unsigned release builds share one global Gradle-output lock", () => {
  const buildLock = builder.indexOf('build_lock="$repo_root/artifacts/android/.signed-release-build.lock"');
  const signedReceiptReuse = builder.indexOf('if [[ "$signed" == true && -f "$candidate_receipt" ]]');
  const gradleInvocation = builder.indexOf("gradle --no-daemon");
  assert.ok(buildLock >= 0 && buildLock < signedReceiptReuse && signedReceiptReuse < gradleInvocation);
  assert.match(builder, /flock -n "\$build_lock_fd"/u);
  assert.doesNotMatch(
    builder,
    /if \[\[ "\$signed" == true \]\]; then\s*\n\s*for command in git node flock mkdir/u,
  );
  assert.match(builder, /Signed and unsigned invocations share the same Gradle tree/u);
});

test("the authoritative APK is derived once from the release bundle", () => {
  const gradleBlock = /gradle --no-daemon \\\n([\s\S]*?)\n\nsource_aab=/u.exec(builder)?.[1] ?? "";
  assert.deepEqual(
    [...gradleBlock.matchAll(/^\s+(:product:[A-Za-z]+)(?: \\)?$/gmu)].map((match) => match[1]),
    [":product:generateProductAssets", ":product:lintRelease", ":product:bundleRelease"],
  );
  assert.doesNotMatch(
    builder,
    /:product:assembleRelease|product\/build\/outputs\/apk\/|product-release(?:-unsigned)?\.apk|source_direct_apk|output_direct_apk|-direct\.apk|direct build; diagnostic only/u,
  );

  const sourceBundle = builder.indexOf('source_aab="$repo_root/apps/android/product/build/outputs/bundle/release/product-release.aab"');
  const copyBundle = builder.indexOf('cp "$source_aab" "$output_aab"');
  const validateBundle = builder.indexOf('validate --bundle="$output_aab"');
  const buildUniversal = builder.indexOf("build-apks");
  const extractUniversal = builder.indexOf('unzip -q -o "$output_apks" universal.apk');
  const copyUniversal = builder.indexOf('cp "$temporary_dir/universal/universal.apk" "$output_universal_apk"');
  const validatePackage = builder.indexOf("validate-product-package.mjs");
  const sealCandidate = builder.lastIndexOf('release-candidate.mjs" seal-existing');
  assert.ok(
    sourceBundle >= 0
      && sourceBundle < copyBundle
      && copyBundle < validateBundle
      && validateBundle < buildUniversal
      && buildUniversal < extractUniversal
      && extractUniversal < copyUniversal
      && copyUniversal < validatePackage
      && validatePackage < sealCandidate,
  );
  assert.match(builder, /--mode=universal/u);
  assert.match(builder, /"--bundle=\$output_aab"/u);
  assert.match(builder, /"--output=\$output_apks"/u);
  for (const signingArgument of [
    '"--ks=$CAATUU_ANDROID_KEYSTORE"',
    '"--ks-key-alias=$CAATUU_ANDROID_KEY_ALIAS"',
    '"--ks-pass=file:$keystore_password_file"',
    '"--key-pass=file:$key_password_file"',
  ]) {
    assert.ok(builder.includes(signingArgument), `missing signing argument: ${signingArgument}`);
  }
  assert.match(builder, /keytool -genkeypair/u);
  assert.match(builder, /"--ks=\$inspection_keystore"/u);
  assert.match(builder, /apksigner_path verify --print-certs "\$output_universal_apk"[\s\S]*CN=Caatuu package inspection/u);
  assert.match(builder, /--aab "\$output_aab"[\s\S]*--apk "\$output_universal_apk"/u);
  assert.match(builder, /apksigner_path" verify --verbose --print-certs/u);
  assert.match(builder, /--apk "artifacts\/android\/caatuu-universal\.apk"/u);
  assert.match(builder, /--aab "artifacts\/android\/caatuu\.aab"/u);
  assert.match(builder, /--signer-sha256 "\$signer_sha256"/u);
  assert.match(builder, /--mode builder-emitted/u);
});

test("meaningful build and validation stages report elapsed time", () => {
  assert.match(builder, /phase_started_at=\$SECONDS/u);
  assert.match(builder, /\$\(\(SECONDS - phase_started_at\)\)/u);
  for (const phase of [
    "Gradle release bundle",
    "Validate release bundle",
    "Create universal APK",
    "Validate package boundary",
    "Seal release candidate",
  ]) {
    assert.ok(builder.includes(`start_phase "${phase}"`), `missing timed phase: ${phase}`);
  }
});

test("the canonical publisher reports source, build, verification, finalization, and total time", () => {
  assert.match(publisher, /pipeline_started_at=\$SECONDS/u);
  assert.match(publisher, /\$\(\(SECONDS - phase_started_at\)\)/u);
  for (const phase of [
    "Validate release source",
    "Build one signed release candidate",
    "Adopt existing signed candidate",
    "Verify sealed release candidate",
    "Finalize local immutable release",
  ]) {
    assert.ok(publisher.includes(`start_phase "${phase}"`), `missing timed publisher phase: ${phase}`);
  }
  assert.match(publisher, /Local release pipeline completed in %ss/u);
  assert.match(publisher, /Built once and finalized Caatuu/u);
  assert.match(publisher, /Reused the exact current-source candidate/u);
  assert.doesNotMatch(publisher, /Finalized existing Caatuu .* without rebuilding it/u);
});

test("a newly sealed signed candidate must come from clean pushed main", () => {
  const cleanGuard = builder.indexOf("A signed release candidate requires a clean canonical worktree");
  const pushedGuard = builder.indexOf("Push main before building a signed release candidate");
  const gradleInvocation = builder.indexOf("gradle --no-daemon");
  assert.ok(cleanGuard >= 0 && cleanGuard < gradleInvocation);
  assert.ok(pushedGuard >= 0 && pushedGuard < gradleInvocation);
  const postBuildGuard = builder.indexOf("changed while the signed candidate was building");
  const receiptSeal = builder.lastIndexOf("release-candidate.mjs\" seal-existing");
  assert.ok(postBuildGuard > gradleInvocation && postBuildGuard < receiptSeal);
});

test("publication snapshots verified candidate bytes and never installs from mutable build outputs", () => {
  const snapshotApk = publisher.indexOf('cp "$receipt_apk" "$staged_candidate_apk"');
  const snapshotCheck = publisher.indexOf('assert_file_identity "$staged_candidate_apk"');
  const immutableInstall = publisher.indexOf('cp "$staged_candidate_apk" "$install_apk_tmp"');
  assert.ok(snapshotApk >= 0 && snapshotApk < snapshotCheck && snapshotCheck < immutableInstall);
  assert.doesNotMatch(publisher.slice(immutableInstall), /cp "\$receipt_apk"/u);
  assert.doesNotMatch(publisher.slice(immutableInstall), /cp "\$candidate_receipt"/u);
  assert.match(publisher, /release-publication-state\.mjs" assert-alias-update/u);
  assert.match(publisher, /--durable-floor/u);
  assert.match(publisher, /Stable Android releases must use exactly/u);
  const manifestInstall = publisher.indexOf('mv "$install_manifest_tmp" "$versioned_manifest"');
  const receiptInstall = publisher.indexOf('mv "$install_receipt_tmp" "$versioned_receipt"');
  assert.ok(manifestInstall >= 0 && manifestInstall < receiptInstall);
  assert.match(publisher, /Install the receipt only after the APK and manifest/u);
});
