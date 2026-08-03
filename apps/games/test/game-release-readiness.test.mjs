import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findReleaseBlockers } from "../tooling/check-release-readiness.mjs";

const gamesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkerPath = path.join(gamesRoot, "tooling", "check-release-readiness.mjs");

function manifest({ gameId, releaseStatus, dependencies }) {
  return {
    schema_name: "caatuu-game-manifest",
    schema_version: 1,
    manifest_version: "1.0.0",
    id: gameId,
    version: "1.0.0",
    release_status: releaseStatus,
    interface_locales: ["en"],
    engine: {
      name: "godot",
      version: "4.7.1",
      renderer: "gl_compatibility",
      export_preset: "Web",
      threading: "single",
    },
    source: { project: `apps/games/${gameId}/project.godot` },
    delivery: {
      artifact_directory: `artifacts/games/${gameId}/web/v1`,
      public_entrypoint: `/games/${gameId}/v1/index.html`,
      compatibility_entrypoints: [],
    },
    platforms: { browser: true, android: true },
    host_contract: {
      message_source: gameId,
      ready_event: "ready",
      same_origin: true,
    },
    dependencies,
    notices: [`apps/games/${gameId}/THIRD_PARTY_NOTICES.md`],
    commands: { export: "fixture-export", validate: "fixture-validate" },
  };
}

async function fixture({
  gameId = "memory-moon",
  releaseStatus = "released",
  dependencyStatus = "active",
  emptyCatalog = false,
  malformedCatalog = false,
  emptyDependencies = false,
  malformedManifest = false,
  writeAuthority = true,
  authorityId = `${gameId}-assets`,
  authorityReleaseStatus = "released",
  authorityDistributionStatus = "distributed",
  omitAuthorityReleaseStatus = false,
} = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "caatuu-game-release-"));
  const fixtureGamesRoot = path.join(repoRoot, "apps", "games");
  const gameRoot = path.join(fixtureGamesRoot, gameId);
  const schemaRoot = path.join(fixtureGamesRoot, "schemas");
  const authorityRoot = path.join(repoRoot, "assets");
  await mkdir(gameRoot, { recursive: true });
  await mkdir(schemaRoot, { recursive: true });
  await mkdir(authorityRoot, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(gamesRoot, "schemas", "game-catalog.v1.schema.json"),
      path.join(schemaRoot, "game-catalog.v1.schema.json"),
    ),
    copyFile(
      path.join(gamesRoot, "schemas", "game-manifest.v1.schema.json"),
      path.join(schemaRoot, "game-manifest.v1.schema.json"),
    ),
  ]);
  await writeFile(
    path.join(fixtureGamesRoot, "catalog.json"),
    malformedCatalog
      ? "{not-json"
      : JSON.stringify({
          schema_name: "caatuu-game-catalog",
          schema_version: 1,
          catalog_version: "1.0.0",
          games: emptyCatalog ? [] : [{ id: gameId, manifest: `${gameId}/game.json` }],
        }),
  );

  const dependencyId = `${gameId}-assets`;
  if (malformedManifest) {
    await writeFile(path.join(gameRoot, "game.json"), "{not-json");
  } else {
    await writeFile(path.join(gameRoot, "game.json"), JSON.stringify(manifest({
      gameId,
      releaseStatus,
      dependencies: emptyDependencies ? [] : [{
        id: dependencyId,
        authority: `assets/${dependencyId}.json`,
        status: dependencyStatus,
      }],
    })));
  }

  if (writeAuthority) {
    const authority = {
      id: authorityId,
      distribution_status: authorityDistributionStatus,
    };
    if (!omitAuthorityReleaseStatus) authority.release_status = authorityReleaseStatus;
    await writeFile(path.join(authorityRoot, `${dependencyId}.json`), JSON.stringify(authority));
  }
  return repoRoot;
}

async function blockers(repoRoot, requiredGameIds = ["memory-moon"]) {
  return findReleaseBlockers({ repoRoot, requiredGameIds });
}

async function runChecker(repoRoot, extraArguments = []) {
  const arguments_ = [
    checkerPath,
    "--repo-root",
    repoRoot,
    "--surface",
    "test-release",
    "--require-game",
    "memory-moon",
    ...extraArguments,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("a schema-valid released game with released active dependencies passes", async () => {
  assert.deepEqual(await blockers(await fixture()), []);
});

test("preview games and dependencies fail public release readiness", async () => {
  const result = await blockers(await fixture({
    releaseStatus: "local-preview-only",
    dependencyStatus: "preview-only",
  }));
  assert.ok(result.some((blocker) => blocker.includes("release_status is local-preview-only")));
  assert.ok(result.some((blocker) => blocker.includes("dependency status is preview-only")));
});

test("authority identity, release, and distribution remain independent blockers", async () => {
  const result = await blockers(await fixture({
    authorityId: "wrong-assets",
    authorityReleaseStatus: "local-preview-only",
    authorityDistributionStatus: "not-distributed",
  }));
  assert.ok(result.some((blocker) => blocker.includes("authority identity is wrong-assets")));
  assert.ok(result.some((blocker) => blocker.includes("authority release_status is local-preview-only")));
  assert.ok(result.some((blocker) => blocker.includes("authority distribution_status is not-distributed")));
});

test("missing authority files and release status fail closed", async () => {
  const missing = await blockers(await fixture({ writeAuthority: false }));
  assert.ok(missing.some((blocker) => blocker.includes("authority is missing")));

  const unstated = await blockers(await fixture({ omitAuthorityReleaseStatus: true }));
  assert.ok(unstated.some((blocker) => blocker.includes("authority release_status is <missing>")));
});

test("empty or malformed catalog and manifest structures fail schema validation", async () => {
  const emptyCatalog = await blockers(await fixture({ emptyCatalog: true }));
  assert.ok(emptyCatalog.some((blocker) => blocker.includes("game catalog: schema minItems")));

  const malformedCatalog = await blockers(await fixture({ malformedCatalog: true }));
  assert.ok(malformedCatalog.some((blocker) => blocker.includes("game catalog is not valid JSON")));

  const emptyDependencies = await blockers(await fixture({ emptyDependencies: true }));
  assert.ok(emptyDependencies.some((blocker) => blocker.includes("manifest: schema minItems")));

  const malformedManifest = await blockers(await fixture({ malformedManifest: true }));
  assert.ok(malformedManifest.some((blocker) => blocker.includes("manifest is not valid JSON")));
});

test("every delivered game must appear exactly once in the catalog", async () => {
  const result = await blockers(await fixture({ gameId: "other-game" }));
  assert.ok(result.some((blocker) => blocker.includes(
    "memory-moon: delivered game must appear exactly once in the catalog; found 0",
  )));
});

test("the CLI returns success only for ready metadata and rejects invalid options", async () => {
  const ready = await runChecker(await fixture());
  assert.equal(ready.code, 0, ready.stderr);
  assert.match(ready.stdout, /release-ready for test-release/);

  const blocked = await runChecker(await fixture({ emptyCatalog: true }));
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /schema minItems/);

  const invalidOption = await runChecker(await fixture(), ["--unknown"]);
  assert.equal(invalidOption.code, 1);
  assert.match(invalidOption.stderr, /Unknown option: --unknown/);
});

test("the canonical catalog remains deliberately blocked while Memory Moon is preview-only", async () => {
  const result = await findReleaseBlockers();
  assert.ok(result.some((blocker) => blocker.startsWith("memory-moon:")));
});
