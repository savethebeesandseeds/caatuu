import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateJsonSchemaSubset } from "../tooling/json-schema-subset.mjs";

const gamesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(gamesRoot, "..", "..");
const catalogPath = path.join(gamesRoot, "catalog.json");
const catalogSchemaPath = path.join(gamesRoot, "schemas", "game-catalog.v1.schema.json");
const manifestSchemaPath = path.join(gamesRoot, "schemas", "game-manifest.v2.schema.json");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assertSchemaValid(schema, instance, label) {
  const result = validateJsonSchemaSubset(schema, instance);
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.errors)}`);
}

function assertSchemaInvalid(schema, instance, expected) {
  const result = validateJsonSchemaSubset(schema, instance);
  assert.equal(result.valid, false, "invalid fixture unexpectedly passed its schema");
  assert.ok(
    result.errors.some((error) => (
      error.keyword === expected.keyword && error.instancePath === expected.instancePath
    )),
    `missing ${expected.keyword} error at ${expected.instancePath}: ${JSON.stringify(result.errors)}`,
  );
}

function assertSafeRelativePath(value, label) {
  assert.equal(path.isAbsolute(value), false, `${label} must be relative`);
  assert.equal(value.includes("\\"), false, `${label} must use forward slashes`);
  assert.equal(value.split("/").includes(".."), false, `${label} must not traverse`);
}

function assertReleasedDependenciesActive(manifest) {
  if (manifest.release_status !== "released") return;
  const inactive = manifest.dependencies
    .filter(({ status }) => status !== "active")
    .map(({ id, status }) => `${id}=${status}`);
  assert.deepEqual(
    inactive,
    [],
    `${manifest.id} cannot be released with inactive dependencies: ${inactive.join(", ")}`,
  );
}

test("the catalog indexes unique standalone manifests with matching identities", async () => {
  const [catalog, catalogSchema, manifestSchema] = await Promise.all([
    readJson(catalogPath),
    readJson(catalogSchemaPath),
    readJson(manifestSchemaPath),
  ]);
  assertSchemaValid(catalogSchema, catalog, "game catalog");
  assert.equal(catalog.schema_name, "caatuu-game-catalog");
  assert.equal(catalog.schema_version, 1);

  const ids = new Set();
  for (const entry of catalog.games) {
    assert.equal(ids.has(entry.id), false, `duplicate game id: ${entry.id}`);
    ids.add(entry.id);
    assertSafeRelativePath(entry.manifest, `${entry.id} manifest`);

    const manifest = await readJson(path.join(gamesRoot, entry.manifest));
    assertSchemaValid(manifestSchema, manifest, `${entry.id} manifest`);
    assert.equal(manifest.schema_name, "caatuu-game-manifest");
    assert.equal(manifest.schema_version, 2);
    assert.equal(manifest.id, entry.id);
    assert.equal(manifest.browser_mode, "standalone");
    assert.equal(manifest.platforms.browser, true);
    assert.equal(manifest.platforms.android, false);
    assert.equal(Object.hasOwn(manifest, "host_contract"), false);
    assert.deepEqual(manifest.delivery.compatibility_entrypoints, []);
    assert.ok(manifest.delivery.artifact_directory.startsWith(`artifacts/games/${entry.id}/`));
    assert.ok(manifest.delivery.public_entrypoint.startsWith(`/games/${entry.id}/`));
    assert.equal(manifest.source.project.startsWith(`apps/games/${entry.id}/`), true);
    assertReleasedDependenciesActive(manifest);

    for (const dependency of manifest.dependencies) {
      assertSafeRelativePath(dependency.authority, `${entry.id} dependency`);
      const authorityPath = path.join(repoRoot, dependency.authority);
      const authoritySource = await readFile(authorityPath, "utf8");
      if (dependency.authority.endsWith("/manifest.json")) {
        const authorityManifest = JSON.parse(authoritySource);
        assert.equal(dependency.id, authorityManifest.id);
      }
      assert.equal(
        dependency.authority.startsWith("demos/") || dependency.authority.startsWith("archive/"),
        false,
      );
    }
    for (const notice of manifest.notices) {
      assertSafeRelativePath(notice, `${entry.id} notice`);
      await readFile(path.join(repoRoot, notice));
    }
  }
  assert.deepEqual([...ids], ["caatuu-game"]);
});

test("Caatuu Game has no language adapter or application embedding contract", async () => {
  for (const name of ["caatuu-game.v1.json", "memory-moon.v1.json"]) {
    const adapterPath = path.join(
      repoRoot,
      "apps",
      "languages",
      "czech",
      "static",
      "data",
      "game-adapters",
      name,
    );
    await assert.rejects(access(adapterPath));
  }
});

test("the manifest schema distinguishes standalone and embedded browser games", async () => {
  const [catalog, manifestSchema] = await Promise.all([
    readJson(catalogPath),
    readJson(manifestSchemaPath),
  ]);
  const manifest = await readJson(path.join(gamesRoot, catalog.games[0].manifest));

  const standaloneWithHost = structuredClone(manifest);
  standaloneWithHost.host_contract = {
    message_source: "caatuu-game",
    ready_event: "ready",
    same_origin: true,
  };
  assertSchemaInvalid(manifestSchema, standaloneWithHost, {
    keyword: "oneOf",
    instancePath: "",
  });

  const embeddedWithoutHost = structuredClone(manifest);
  embeddedWithoutHost.browser_mode = "embedded";
  assertSchemaInvalid(manifestSchema, embeddedWithoutHost, {
    keyword: "oneOf",
    instancePath: "",
  });
});

test("schemas reject traversal, ownership leaks, and unsafe release promotion", async () => {
  const [catalog, catalogSchema, manifestSchema] = await Promise.all([
    readJson(catalogPath),
    readJson(catalogSchemaPath),
    readJson(manifestSchemaPath),
  ]);
  const manifest = await readJson(path.join(gamesRoot, catalog.games[0].manifest));

  const traversingCatalog = structuredClone(catalog);
  traversingCatalog.games[0].manifest = "caatuu-game/../other.json";
  assertSchemaInvalid(catalogSchema, traversingCatalog, {
    keyword: "pattern",
    instancePath: "/games/0/manifest",
  });

  const traversingDependency = structuredClone(manifest);
  traversingDependency.dependencies[0].authority = "apps/games/../secrets/key.json";
  assertSchemaInvalid(manifestSchema, traversingDependency, {
    keyword: "pattern",
    instancePath: "/dependencies/0/authority",
  });

  const engineLeak = structuredClone(manifest);
  engineLeak.engine.container = "independent-game-environment";
  assertSchemaInvalid(manifestSchema, engineLeak, {
    keyword: "additionalProperties",
    instancePath: "/engine/container",
  });

  const unsafeRelease = structuredClone(manifest);
  unsafeRelease.release_status = "released";
  assertSchemaInvalid(manifestSchema, unsafeRelease, {
    keyword: "const",
    instancePath: "/dependencies/0/status",
  });
});
