import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateJsonSchemaSubset } from "../../curriculum/src/json-schema-subset.mjs";

const gamesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(gamesRoot, "..", "..");
const catalogPath = path.join(gamesRoot, "catalog.json");
const catalogSchemaPath = path.join(gamesRoot, "schemas", "game-catalog.v1.schema.json");
const manifestSchemaPath = path.join(gamesRoot, "schemas", "game-manifest.v1.schema.json");
const adapterSchemaPath = path.join(
  gamesRoot,
  "schemas",
  "language-game-adapter.v1.schema.json",
);
const adapterPath = path.join(
  repoRoot,
  "apps",
  "languages",
  "czech",
  "static",
  "data",
  "game-adapters",
  "memory-moon.v1.json",
);

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

test("the catalog indexes unique manifests with matching game identities", async () => {
  const catalog = await readJson(catalogPath);
  const catalogSchema = await readJson(catalogSchemaPath);
  const manifestSchema = await readJson(manifestSchemaPath);
  assertSchemaValid(catalogSchema, catalog, "game catalog");
  assert.equal(catalog.schema_name, "caatuu-game-catalog");
  assert.equal(catalog.schema_version, 1);
  assert.match(catalog.catalog_version, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(catalog.games) && catalog.games.length > 0);

  const ids = new Set();
  for (const entry of catalog.games) {
    assert.deepEqual(Object.keys(entry).sort(), ["id", "manifest"]);
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(ids.has(entry.id), false, `duplicate game id: ${entry.id}`);
    ids.add(entry.id);
    assertSafeRelativePath(entry.manifest, `${entry.id} manifest`);

    const manifest = await readJson(path.join(gamesRoot, entry.manifest));
    assertSchemaValid(manifestSchema, manifest, `${entry.id} manifest`);
    assert.equal(manifest.schema_name, "caatuu-game-manifest");
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.id, entry.id);
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
        assert.equal(
          dependency.id,
          authorityManifest.id,
          `${entry.id} dependency ${dependency.id} must use its authority manifest identity`,
        );
      }
      assert.equal(
        dependency.authority.startsWith("demos/") || dependency.authority.startsWith("archive/"),
        false,
        `${entry.id} dependency ${dependency.id} must use an active catalog authority`,
      );
    }
    for (const notice of manifest.notices) {
      assertSafeRelativePath(notice, `${entry.id} notice`);
      await readFile(path.join(repoRoot, notice));
    }
  }
});

test("released game metadata requires every dependency to be active", () => {
  assert.doesNotThrow(() => assertReleasedDependenciesActive({
    id: "ready-game",
    release_status: "released",
    dependencies: [{ id: "ready-asset", status: "active" }],
  }));
  assert.throws(
    () => assertReleasedDependenciesActive({
      id: "unsafe-game",
      release_status: "released",
      dependencies: [{ id: "preview-motion", status: "preview-only" }],
    }),
    /unsafe-game cannot be released with inactive dependencies: preview-motion=preview-only/,
  );
  assert.doesNotThrow(() => assertReleasedDependenciesActive({
    id: "preview-game",
    release_status: "local-preview-only",
    dependencies: [{ id: "preview-motion", status: "preview-only" }],
  }));
});

test("the Czech adapter contains presentation concerns only", async () => {
  const adapter = await readJson(adapterPath);
  const adapterSchema = await readJson(adapterSchemaPath);
  assertSchemaValid(adapterSchema, adapter, "Czech Memory Moon adapter");
  assert.deepEqual(Object.keys(adapter).sort(), [
    "adapter_version",
    "curriculum_bindings",
    "enabled_platforms",
    "game_id",
    "language_id",
    "placement",
    "presentation",
    "schema_name",
    "schema_version",
    "scope",
    "target_locale",
  ]);
  assert.equal(adapter.schema_name, "caatuu-language-game-adapter");
  assert.equal(adapter.scope, "host-presentation-only");
  assert.equal(adapter.language_id, "cz");
  assert.equal(adapter.target_locale, "cs-CZ");
  assert.equal(adapter.game_id, "memory-moon");

  const serialized = JSON.stringify(adapter);
  for (const forbidden of ["artifact_directory", "docker", "engine", "source"]) {
    assert.equal(serialized.includes(forbidden), false, `adapter must not own ${forbidden}`);
  }
});

test("schemas reject traversal and nested ownership leaks", async () => {
  const catalog = await readJson(catalogPath);
  const manifest = await readJson(path.join(gamesRoot, catalog.games[0].manifest));
  const adapter = await readJson(adapterPath);
  const catalogSchema = await readJson(catalogSchemaPath);
  const manifestSchema = await readJson(manifestSchemaPath);
  const adapterSchema = await readJson(adapterSchemaPath);

  const traversingCatalog = structuredClone(catalog);
  traversingCatalog.games[0].manifest = "memory-moon/../other.json";
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

  const missingDeliveryContract = structuredClone(manifest);
  delete missingDeliveryContract.delivery.public_entrypoint;
  assertSchemaInvalid(manifestSchema, missingDeliveryContract, {
    keyword: "required",
    instancePath: "/delivery/public_entrypoint",
  });

  const unsafeRelease = structuredClone(manifest);
  unsafeRelease.release_status = "released";
  assertSchemaInvalid(manifestSchema, unsafeRelease, {
    keyword: "const",
    instancePath: "/dependencies/0/status",
  });

  const adapterImplementationLeak = structuredClone(adapter);
  adapterImplementationLeak.presentation.artifact_directory = "artifacts/games/memory-moon";
  assertSchemaInvalid(adapterSchema, adapterImplementationLeak, {
    keyword: "additionalProperties",
    instancePath: "/presentation/artifact_directory",
  });

  const unsupportedPlatform = structuredClone(adapter);
  unsupportedPlatform.enabled_platforms.push("windows-host");
  assertSchemaInvalid(adapterSchema, unsupportedPlatform, {
    keyword: "enum",
    instancePath: "/enabled_platforms/2",
  });
});
