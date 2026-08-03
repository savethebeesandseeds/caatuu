import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(
  new URL("../../../../apps/languages/czech/static/setup-progress.js", import.meta.url),
  "utf8"
);
const context = { window: {} };
runInNewContext(source, context, { filename: "setup-progress.js" });
const progress = context.window.CaatuuSetupProgress;

test("download completion remains below 100 until verification succeeds", () => {
  const pending = progress.totalsFromArtifacts([
    { ready: true, bytes: 40, expectedBytes: 40 },
    { ready: false, bytes: 60, expectedBytes: 60 }
  ]);

  assert.equal(pending.progress, 99);
  assert.equal(pending.allReady, false);
  assert.equal(pending.verifying, true);
  assert.equal(progress.artifactPercent({ ready: false, bytes: 60, expectedBytes: 60 }), 99);
});

test("100 percent is reserved for a fully verified artifact set", () => {
  const ready = progress.totalsFromArtifacts([
    { ready: true, bytes: 40, expectedBytes: 40 },
    { ready: true, bytes: 60, expectedBytes: 60 }
  ]);

  assert.equal(ready.progress, 100);
  assert.equal(ready.allReady, true);
  assert.equal(ready.remainingArtifacts, 0);
});

test("the final setup acknowledgement owns 100 percent", () => {
  const waitingForSetup = progress.totalsFromArtifacts([
    { ready: true, bytes: 100, expectedBytes: 100 }
  ], { setupReady: false });

  assert.equal(waitingForSetup.allReady, true);
  assert.equal(waitingForSetup.complete, false);
  assert.equal(waitingForSetup.progress, 99);
});

test("download progress does not imply readiness", () => {
  assert.equal(progress.messageMarksReady({ kind: "progress", phase: "asset_download", bytes: 10, totalBytes: 10 }), false);
  assert.equal(progress.messageMarksReady({ kind: "status", phase: "asset_ready" }), true);
  assert.equal(progress.messageMarksReady({ kind: "status", phase: "browser_cached" }), true);
  assert.equal(progress.messageMarksReady({ kind: "status", phase: "hash_verified" }), true);
  assert.equal(progress.messageMarksReady({ kind: "status", phase: "not_ready" }), false);
});

test("unknown pending items keep the aggregate below complete", () => {
  const totals = progress.totalsFromArtifacts([
    { ready: true, bytes: 100, expectedBytes: 100 },
    { ready: false, bytes: 0, expectedBytes: 0 }
  ]);

  assert.equal(totals.progress, 99);
  assert.equal(totals.readyArtifacts, 1);
  assert.equal(totals.artifactCount, 2);
});

test("the final browser-manifest tail cannot round up while files remain unverified", () => {
  const artifacts = Array.from({ length: 526 }, (_, index) => ({
    ready: index < 517,
    bytes: 100,
    expectedBytes: 100
  }));
  const totals = progress.totalsFromArtifacts(artifacts);

  assert.equal(totals.readyArtifacts, 517);
  assert.equal(totals.remainingArtifacts, 9);
  assert.equal(totals.verifyingArtifacts, 9);
  assert.equal(totals.progress, 99);
});
