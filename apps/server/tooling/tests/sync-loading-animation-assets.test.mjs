import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  listLoadingAnimationSequences,
  synchronizeLoadingAnimationManifests
} from "../sync-loading-animation-assets.mjs";

const testPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(testPath), "..", "..", "..", "..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "caatuu-loading-animation-"));
  const frameDirectory = join(workspaceRoot, "apps/launcher/static/assets/loading-animation");
  const setupManifestPath = join(workspaceRoot, "apps/languages/czech/static/setup-assets.json");
  const animationManifestPath = join(frameDirectory, "animations_manifest.json");
  const backpackDirectory = join(frameDirectory, "animation-backpack");
  const walkingDirectory = join(frameDirectory, "animation-walking-arround");
  await mkdir(backpackDirectory, { recursive: true });
  await mkdir(walkingDirectory, { recursive: true });
  await mkdir(dirname(setupManifestPath), { recursive: true });
  await writeFile(join(backpackDirectory, "load-animation_1.png"), "pack-one");
  await writeFile(join(backpackDirectory, "load-animation_4.png"), "pack-four");
  await writeFile(join(walkingDirectory, "loading-animation (2).png"), "walk-two");
  await writeFile(join(walkingDirectory, "loading-animation (10).png"), "walk-ten");
  await writeFile(animationManifestPath, '{"schema_version":1,"animations":[]}\n');
  const before = { key: "before", url: "/cz/before.bin", bytes: 1, sha256: "a".repeat(64) };
  const after = { key: "after", url: "/cz/after.bin", bytes: 1, sha256: "b".repeat(64) };
  const legacyLoading = {
    key: "macaw-loading-002",
    url: "/assets/macaw/loading_animation/loading-animation_002.png",
    asset_path: "assets/macaw/loading_animation/loading-animation_002.png",
    bytes: 0,
    sha256: ""
  };
  await writeFile(setupManifestPath, `${JSON.stringify({
    version: 1,
    cache_name: "fixture",
    artifacts: [before, legacyLoading, after]
  }, null, 2)}\n`);
  return {
    workspaceRoot,
    frameDirectory,
    animationManifestPath,
    setupManifestPath,
    before,
    after,
    backpackDirectory
  };
}

test("animation folders use numeric filename order while preserving gaps", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const sequences = listLoadingAnimationSequences(paths.frameDirectory);
  assert.deepEqual(sequences.map((sequence) => sequence.id), ["backpack", "walking-arround"]);
  assert.deepEqual(sequences[0].sprites.map((frame) => frame.index), [1, 4]);
  assert.deepEqual(sequences[1].sprites.map((frame) => frame.index), [2, 10]);
});

test("sync catalogs every sequence frame and removes legacy flat entries", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const report = synchronizeLoadingAnimationManifests(paths);
  assert.equal(report.frameCount, 4);
  assert.deepEqual(report.sequences, [
    { id: "backpack", folder: "animation-backpack", count: 2, frameIndices: [1, 4] },
    { id: "walking-arround", folder: "animation-walking-arround", count: 2, frameIndices: [2, 10] }
  ]);

  const animationManifest = JSON.parse(await readFile(paths.animationManifestPath, "utf8"));
  assert.equal(animationManifest.animations[0].count, 2);
  assert.deepEqual(animationManifest.animations[1].sprites.map((frame) => frame.index), [2, 10]);

  const setupManifest = JSON.parse(await readFile(paths.setupManifestPath, "utf8"));
  assert.deepEqual(setupManifest.artifacts[0], paths.before);
  assert.deepEqual(setupManifest.artifacts.at(-1), paths.after);
  const loading = setupManifest.artifacts.slice(1, -1);
  assert.deepEqual(loading.map((artifact) => artifact.key), [
    "loading-animation-backpack-001",
    "loading-animation-backpack-004",
    "loading-animation-walking-arround-002",
    "loading-animation-walking-arround-010"
  ]);
  assert.equal(
    loading[0].url,
    "/assets/loading_animation/animation-backpack/load-animation_1.png"
  );
  assert.equal(loading[0].bytes, Buffer.byteLength("pack-one"));
  assert.equal(loading[0].sha256, sha256("pack-one"));
  assert.equal(
    loading[2].url,
    "/assets/loading_animation/animation-walking-arround/loading-animation%20(2).png"
  );
  assert.equal(
    loading[2].asset_path,
    "assets/loading_animation/animation-walking-arround/loading-animation (2).png"
  );
});

test("duplicate numeric indices inside one animation are rejected", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  await writeFile(join(paths.backpackDirectory, "another-frame-1.png"), "duplicate");

  assert.throws(
    () => listLoadingAnimationSequences(paths.frameDirectory),
    /Duplicate frame index 1 in animation-backpack/
  );
});

test("check mode reports drift without rewriting either manifest", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  synchronizeLoadingAnimationManifests(paths);
  const previousAnimation = await readFile(paths.animationManifestPath, "utf8");
  const previousSetup = await readFile(paths.setupManifestPath, "utf8");
  await unlink(join(paths.backpackDirectory, "load-animation_1.png"));

  const report = synchronizeLoadingAnimationManifests({ ...paths, check: true });
  assert.equal(report.frameCount, 3);
  assert.equal(report.animationManifestChanged, true);
  assert.equal(report.setupManifestChanged, true);
  assert.equal(await readFile(paths.animationManifestPath, "utf8"), previousAnimation);
  assert.equal(await readFile(paths.setupManifestPath, "utf8"), previousSetup);
});

test("repository loading-animation manifests match the animation folders", () => {
  const report = synchronizeLoadingAnimationManifests({ workspaceRoot: repositoryRoot, check: true });
  assert.equal(report.animationManifestChanged, false);
  assert.equal(report.setupManifestChanged, false);
  assert.ok(report.sequences.length >= 3);
  assert.ok(report.frameCount > 0);
});
