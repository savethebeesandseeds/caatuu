import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertNewBuildVersion, assertStableAliasAdvance } from "../release-publication-state.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pagesDescriptor = JSON.parse(await readFile(new URL("../pages-current-release.json", import.meta.url), "utf8"));

async function fixture(stableVersion = 164, candidateVersion = 165, floorVersion = 164) {
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
  const durableFloor = structuredClone(pagesDescriptor);
  if (floorVersion !== 163) {
    assert.ok(floorVersion > 163);
    const floorBytes = candidateVersion === floorVersion ? candidateBytes : Buffer.from(`floor-${floorVersion}`);
    const floorManifestRaw = candidateVersion === floorVersion
      ? candidateManifestRaw
      : `${JSON.stringify({ version_code: floorVersion, bytes: floorBytes.length, sha256: sha256(floorBytes) })}\n`;
    durableFloor.releases.push({
      versionCode: floorVersion,
      versionName: `0.1.${floorVersion - 152}`,
      sourceRevision: "c".repeat(40),
      manifest: { bytes: Buffer.byteLength(floorManifestRaw), sha256: sha256(floorManifestRaw) },
      apk: { bytes: floorBytes.length, sha256: sha256(floorBytes) },
      receipt: { bytes: receiptBytes.length, sha256: sha256(receiptBytes) },
    });
  }
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
  const paths = await fixture(164, 165);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.deepEqual(assertStableAliasAdvance(paths), { action: "advance", versionCode: 165 });
});

test("stable Android aliases can idempotently reuse exact same-version bytes", async (context) => {
  const paths = await fixture(164, 164);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.deepEqual(assertStableAliasAdvance(paths), { action: "reuse", versionCode: 164 });
});

test("stable Android aliases never move backward", async (context) => {
  const paths = await fixture(164, 163);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.throws(
    () => assertStableAliasAdvance(paths),
    /durable release floor is 164/u,
  );
});

test("missing mutable aliases cannot lower the durable Pages release floor", async (context) => {
  const paths = await fixture(164, 163);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  await Promise.all([unlink(paths.stableManifest), unlink(paths.stableApk)]);
  assert.throws(() => assertStableAliasAdvance(paths), /durable release floor is 164/u);
});

test("a lost receipt cannot trigger a rebuild at the durable release floor", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  assert.throws(
    () => assertNewBuildVersion({ durableFloor: paths.durableFloor, candidateVersionCode: 164 }),
    /Refusing to rebuild Android version 164/u,
  );
  assert.deepEqual(
    assertNewBuildVersion({ durableFloor: paths.durableFloor, candidateVersionCode: 165 }),
    { candidateVersionCode: 165, floorVersionCode: 164 },
  );
});

test("same-version reuse requires the exact immutable receipt", async (context) => {
  const paths = await fixture(164, 164);
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  await writeFile(paths.versionedReceipt, "different-receipt\n");
  assert.throws(() => assertStableAliasAdvance(paths), /receipt differs/u);
});

test("the durable floor rejects schema downgrade and unordered releases", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  const value = JSON.parse(await readFile(paths.durableFloor, "utf8"));

  await writeFile(paths.durableFloor, `${JSON.stringify({ ...value, schemaVersion: 1 })}\n`);
  assert.throws(
    () => assertNewBuildVersion({ durableFloor: paths.durableFloor, candidateVersionCode: 165 }),
    /schemaVersion|Expected values to be strictly equal/u,
  );

  const unordered = structuredClone(value);
  unordered.releases.push({ ...structuredClone(unordered.releases.at(-1)), versionCode: 164 });
  await writeFile(paths.durableFloor, `${JSON.stringify(unordered)}\n`);
  assert.throws(
    () => assertNewBuildVersion({ durableFloor: paths.durableFloor, candidateVersionCode: 165 }),
    /must increase/u,
  );
});
