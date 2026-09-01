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
  assert.match(publisher, /Finalized existing Caatuu .* without rebuilding it/u);
});

test("a new release has one explicit build boundary and no regenerated transition", () => {
  assert.equal(publisher.match(/build-release-aab\.sh/gu)?.length, 1);
  assert.match(publisher, /if \[\[ "\$mode" == "build-once" \]\]; then/u);
  assert.doesNotMatch(publisher, /assembleDebug|caatuu-transition|transition_apk/u);
  assert.doesNotMatch(publisher, /android\/releases\/status|android\/debug-releases\/status/u);
});

test("the builder reuses a sealed same-source candidate instead of launching Gradle", () => {
  const buildLock = builder.indexOf(".signed-release-build.lock");
  const receiptGuard = builder.indexOf("if [[ \"$signed\" == true && -f \"$candidate_receipt\" ]]");
  const durableFloorGuard = builder.indexOf("assert-new-build-version");
  const gradleInvocation = builder.indexOf("gradle --no-daemon");
  assert.ok(buildLock >= 0 && buildLock < receiptGuard);
  assert.match(builder, /flock -n "\$build_lock_fd"/u);
  assert.ok(receiptGuard >= 0 && receiptGuard < gradleInvocation);
  assert.ok(durableFloorGuard > receiptGuard && durableFloorGuard < gradleInvocation);
  assert.match(builder, /release-candidate\.mjs" verify/u);
  assert.match(builder, /no Android build was started/u);
  assert.match(builder, /release-candidate\.mjs" seal-existing/u);
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
});
