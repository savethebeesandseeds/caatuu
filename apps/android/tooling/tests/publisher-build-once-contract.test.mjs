import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publisher = await readFile(new URL("../publish-release.sh", import.meta.url), "utf8");
const builder = await readFile(new URL("../build-release-aab.sh", import.meta.url), "utf8");

function assertTimedCommand(source, command) {
  const operation = source.indexOf(command);
  assert.ok(operation >= 0, `missing operation: ${command}`);
  const starts = [...source.slice(0, operation).matchAll(/^\s*start_phase .+$/gmu)];
  const finishes = [...source.slice(0, operation).matchAll(/^\s*finish_phase\s*$/gmu)];
  assert.ok(starts.length > 0 && starts.at(-1).index > (finishes.at(-1)?.index ?? -1), `operation must begin inside a timed phase: ${command}`);
  const remainder = source.slice(operation);
  const finish = /^\s*finish_phase\s*$/mu.exec(remainder)?.index ?? -1;
  const nextStart = /^\s*start_phase .+$/mu.exec(remainder)?.index ?? Infinity;
  assert.ok(finish >= 0 && finish < nextStart, `operation must finish its timed phase: ${command}`);
}

test("publication can adopt or promote an exact signed candidate without an Android build", () => {
  assert.match(publisher, /--candidate-receipt/u);
  assert.match(publisher, /--adopt-existing/u);
  assert.match(publisher, /--expected-apk-sha256/u);
  const defaultMode = publisher.slice(publisher.indexOf('if [[ -z "$mode" ]]'), publisher.indexOf("\nassert_main_only()"));
  assert.match(defaultMode, /if \[\[ -f "\$default_candidate_receipt" \]\]/u);
  assert.match(defaultMode, /mode=receipt/u);
  assert.match(defaultMode, /exit 2/u);
  assert.doesNotMatch(defaultMode, /build-release-aab|mode=build-once/u);
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
  assert.ok(buildOnce.includes('"$receipt_version_code" == "$candidate_version_code" && "$receipt_version_name" == "$candidate_version_name"'));
  assert.match(publisher, /--expected-source-revision "\$expected_source_revision"/u);
  const finalization = publisher.slice(publisher.indexOf('publication_lock="$repo_root/artifacts/android/.artifact-publication.lock"'));
  assert.ok(finalization.match(/assert_clean_build_source/gu)?.length >= 2);
  assert.equal(finalization.split('[[ "$(git -C "$repo_root" rev-parse HEAD)" == "$expected_source_revision" ]] || {').length - 1, 2);
});

test("publisher preserves detached recovery registrations without building from them", () => {
  assert.ok(publisher.includes('$repo_root" == /workspace'));
  assert.ok(publisher.includes('${worktrees[0]-}" == "$repo_root'));
  assert.match(publisher, /detached_count/u);
  assert.ok(publisher.includes('[[ "$detached_count" -eq $((${#worktrees[@]} - 1)) ]] || {'));
  assert.doesNotMatch(publisher, /worktree (?:remove|prune|add)/u);
});

test("the builder reuses a sealed same-source candidate instead of launching Gradle", () => {
  const buildLock = builder.indexOf(".signed-release-build.lock");
  const receiptGuard = builder.indexOf("if [[ \"$signed\" == true && -f \"$candidate_receipt\" ]]");
  const durableFloorGuard = builder.indexOf("assert-new-build-version");
  const languageCourseValidation = builder.indexOf('node "$repo_root/tools/language-packs/validate.mjs" --check-views');
  const gradleInvocation = builder.indexOf("gradle --no-daemon");
  assert.equal(builder.match(/^[ \t]*(?:gradle|(?:\.\/)?gradlew)(?=[ \t])/gmu)?.length, 1);
  assert.ok(buildLock >= 0 && buildLock < receiptGuard);
  assert.match(builder, /flock -n "\$build_lock_fd"/u);
  assert.ok(receiptGuard >= 0 && receiptGuard < gradleInvocation);
  assert.ok(durableFloorGuard > receiptGuard && durableFloorGuard < gradleInvocation);
  assert.ok(languageCourseValidation > durableFloorGuard && languageCourseValidation < gradleInvocation);
  assert.match(builder, /release-candidate\.mjs" verify/u);
  assert.match(builder.slice(receiptGuard, durableFloorGuard), /--expected-source-revision "\$source_revision"[\s\S]*exit 0/u);
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
});

test("new signed builds capture public native-asset receipts under the lock before Gradle", () => {
  const lock = builder.indexOf('flock -n "$build_lock_fd"');
  const receiptReuse = builder.indexOf('if [[ "$signed" == true && -f "$candidate_receipt" ]]');
  const inventory = builder.indexOf('inventory_dir="$repo_root/artifacts/android/release-preflight"');
  const gradle = builder.indexOf("gradle --no-daemon");
  assert.ok(lock >= 0 && receiptReuse > lock && inventory > receiptReuse && gradle > inventory);
  assert.match(builder, /export CAATUU_RELEASE_PUBLIC_INVENTORY="\$inventory_file"/u);
  assert.match(builder, /assertPublicSetupDependencies\(\{ artifacts: \[\] \}/u);
  assert.doesNotMatch(builder, /build-pages-site|build-static-site/u);
});

test("the authoritative APK is derived once from the release bundle", () => {
  const gradleBlock = /gradle --no-daemon \\\n([\s\S]*?)\n\nsource_aab=/u.exec(builder)?.[1] ?? "";
  assert.deepEqual(
    [...gradleBlock.matchAll(/^\s+(:product:[A-Za-z]+)(?: \\)?$/gmu)].map((match) => match[1]),
    [":product:generateProductAssets", ":product:lintRelease", ":product:bundleRelease"],
  );
  assert.doesNotMatch(
    builder,
    /:product:assembleRelease|product\/build\/outputs\/apk\/|product-release(?:-unsigned)?\.apk|source_direct_apk|output_direct_apk|-direct\.apk/u,
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
  for (const command of [
    'node "$repo_root/tools/language-packs/validate.mjs" --check-views',
    "gradle --no-daemon",
    'validate --bundle="$output_aab"',
    'unzip -q -o "$output_apks" universal.apk',
    'node "$repo_root/apps/android/tooling/validate-product-package.mjs"',
    'release-candidate.mjs" seal-existing',
  ]) {
    assertTimedCommand(builder, command);
  }
});

test("the canonical publisher reports source, build, verification, finalization, and total time", () => {
  assert.match(publisher, /pipeline_started_at=\$SECONDS/u);
  assert.match(publisher, /\$\(\(SECONDS - phase_started_at\)\)/u);
  for (const command of [
    'node "$repo_root/tools/language-content/validate.mjs" --release',
    'bash "$repo_root/apps/android/tooling/build-release-aab.sh"',
    'validate_and_read_existing_candidate "$source_apk" "$source_aab"',
    'cp "$candidate_receipt" "$staged_receipt"',
    'flock -n "$publication_lock_fd"',
  ]) {
    assertTimedCommand(publisher, command);
  }
  assert.match(publisher, /printf[^\n]+"\$\(\(SECONDS - pipeline_started_at\)\)"/u);
});

test("release preflight checks cheap Android safety contracts without rebuilding product or website fixtures", () => {
  const sourceValidation = publisher.indexOf('node "$repo_root/tools/language-content/validate.mjs" --release');
  const signedBuild = publisher.indexOf('bash "$repo_root/apps/android/tooling/build-release-aab.sh"');
  const preflightSource = publisher.slice(sourceValidation, signedBuild);
  assert.match(preflightSource, /tools\/language-content\/validate\.mjs" --release/u);
  for (const contract of ["android-artifact-contract", "product-package-contract", "product-interface-catalog", "product-index-transform", "publisher-build-once-contract"]) {
    const preflight = publisher.indexOf(`${contract}.test.mjs`);
    assert.ok(preflight > sourceValidation && preflight < signedBuild,
      `${contract} must validate the Android boundary before signing`);
  }
  assert.doesNotMatch(preflightSource, /product-\*|product-assets-contract|product-word-world-startup|apps\/launcher\/tooling|build-product-assets\.mjs|build-static-site\.mjs|build-pages-site\.mjs/u);
  assert.match(builder, /:product:generateProductAssets/u);
  assert.match(builder, /validate-product-package\.mjs/u);
});

test("a newly sealed signed candidate must come from clean pushed main", () => {
  const cleanGuard = builder.indexOf('[[ -z "$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)" ]] || {');
  const pushedGuard = builder.indexOf('[[ "$source_revision" == "$(git -C "$repo_root" rev-parse --verify refs/remotes/origin/main)" ]] || {');
  const gradleInvocation = builder.indexOf("gradle --no-daemon");
  assert.ok(cleanGuard >= 0 && cleanGuard < gradleInvocation);
  assert.ok(pushedGuard >= 0 && pushedGuard < gradleInvocation);
  const postBuildGuard = builder.indexOf('[[ "$current_source_revision" == "$source_revision" && "$current_origin_revision" == "$source_revision" ]] || {');
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
  assert.ok(publisher.includes('[[ "$public_base_url" == "$canonical_public_base_url" ]] || {'));
  const manifestInstall = publisher.indexOf('mv "$install_manifest_tmp" "$versioned_manifest"');
  const receiptInstall = publisher.indexOf('mv "$install_receipt_tmp" "$versioned_receipt"');
  assert.ok(manifestInstall >= 0 && manifestInstall < receiptInstall);
});

test("only a fresh successful builder invocation can reuse its full package audit", () => {
  const capture = builder.indexOf('release-candidate.mjs" capture-audit-input');
  const fullAudit = builder.indexOf('node "$repo_root/apps/android/tooling/validate-product-package.mjs"');
  const seal = builder.lastIndexOf('release-candidate.mjs" seal-existing');
  const proof = builder.indexOf('release-candidate.mjs" emit-audit-proof');
  assert.ok(capture > 0 && capture < fullAudit && fullAudit < seal && seal < proof);
  assert.match(publisher, /randomBytes\(32\)/u);
  assert.match(publisher, /trap cleanup_invocation_audit EXIT/u);
  assert.match(publisher, /verify-audit-proof/u);
  const adoption = publisher.slice(publisher.indexOf('if [[ "$mode" == "adopt-existing" ]]'), publisher.indexOf('[[ "$mode" == "receipt"'));
  assert.match(adoption, /validate_and_read_existing_candidate "\$source_apk" "\$source_aab"/u);
  assert.doesNotMatch(adoption, /invocation_audit|emit-audit-proof/u);
});
