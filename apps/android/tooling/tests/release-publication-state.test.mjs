import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertNewBuildVersion, assertStableAliasAdvance } from "../release-publication-state.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(stableVersion = 163, candidateVersion = 164, floorVersion = 163) {
  const root = await mkdtemp(join(tmpdir(), "caatuu-release-state-"));
  const stableBytes = Buffer.from(`stable-${stableVersion}`);
  const candidateBytes = candidateVersion === stableVersion ? stableBytes : Buffer.from(`candidate-${candidateVersion}`);
  const stableManifestValue = {
    version_code: stableVersion,
    bytes: stableBytes.length,
    sha256: sha256(stableBytes),
  };
  const candidateManifestValue = {
    version_code: candidateVersion,
    bytes: candidateBytes.length,
    sha256: sha256(candidateBytes),
  };
  const stableManifestRaw = `${JSON.stringify(stableManifestValue)}\n`;
  const candidateManifestRaw = `${JSON.stringify(candidateManifestValue)}\n`;
  const receiptBytes = Buffer.from("sealed-receipt\n");
  const paths = Object.fromEntries(
    ["stableManifest", "stableApk", "candidateManifest", "candidateApk", "candidateReceipt", "versionedReceipt", "durableFloor"]
      .map((name) => [name, join(root, name)]),
  );
  paths.root = root;
  const durableFloor = {
    schemaName: "caatuu-pages-current-release",
    schemaVersion: 1,
    canonicalOrigin: "https://caatuu.waajacu.com",
    stable: {
      versionCode: floorVersion,
      manifest: { bytes: Buffer.byteLength(stableManifestRaw), sha256: sha256(stableManifestRaw) },
      apk: { bytes: stableBytes.length, sha256: sha256(stableBytes) },
      receipt: { bytes: receiptBytes.length, sha256: sha256(receiptBytes) },
    },
  };
  await Promise.all([
    writeFile(paths.stableManifest, stableManifestRaw),
    writeFile(paths.stableApk, stableBytes),
    writeFile(paths.candidateManifest, candidateManifestRaw),
    writeFile(paths.candidateApk, candidateBytes),
    writeFile(paths.candidateReceipt, receiptBytes),
    writeFile(paths.versionedReceipt, receiptBytes),
    writeFile(paths.durableFloor, `${JSON.stringify(durableFloor)}\n`),
  ]);
  return paths;
}

test("stable Android aliases advance to a newer sealed version", async (context) => {
  const paths = await fixture(163, 164);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.deepEqual(assertStableAliasAdvance(paths), { action: "advance", versionCode: 164 });
});

test("stable Android aliases can idempotently reuse exact same-version bytes", async (context) => {
  const paths = await fixture(163, 163);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.deepEqual(assertStableAliasAdvance(paths), { action: "reuse", versionCode: 163 });
});

test("stable Android aliases never move backward", async (context) => {
  const paths = await fixture(163, 162, 160);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.throws(
    () => assertStableAliasAdvance(paths),
    /Refusing to move stable Android aliases backward from 163 to 162/u,
  );
});

test("missing mutable aliases cannot lower the durable Pages release floor", async (context) => {
  const paths = await fixture(163, 162);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  await Promise.all([unlink(paths.stableManifest), unlink(paths.stableApk)]);
  assert.throws(() => assertStableAliasAdvance(paths), /durable release floor is 163/u);
});

test("a lost receipt cannot trigger a rebuild at the durable release floor", async (context) => {
  const paths = await fixture(163, 164);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.throws(
    () => assertNewBuildVersion({ durableFloor: paths.durableFloor, candidateVersionCode: 163 }),
    /Refusing to rebuild Android version 163/u,
  );
  assert.deepEqual(
    assertNewBuildVersion({ durableFloor: paths.durableFloor, candidateVersionCode: 164 }),
    { candidateVersionCode: 164, floorVersionCode: 163 },
  );
});

test("same-version reuse requires the exact immutable receipt", async (context) => {
  const paths = await fixture(163, 163);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  await writeFile(paths.versionedReceipt, "different-receipt\n");
  assert.throws(() => assertStableAliasAdvance(paths), /receipt differs/u);
});
