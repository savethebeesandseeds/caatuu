import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SCENERY_ISSUE_CODES,
  deriveSceneryFacts,
  validateSceneryPackage,
  validateSceneryPair
} from "../tooling/validate-scenery-package.mjs";

const sceneryRoot = new URL("../../launcher/static/assets/scenery/", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, sceneryRoot), "utf8"));
}

const [catalogSchema, catalog, worldSchema, world] = await Promise.all([
  readJson("metadata/catalog.schema.json"),
  readJson("metadata/catalog.json"),
  readJson("metadata/world.schema.json"),
  readJson("metadata/world.json")
]);

function validatePair(catalogValue = catalog, worldValue = world) {
  return validateSceneryPair({
    catalogSchema,
    catalog: catalogValue,
    worldSchema,
    world: worldValue
  });
}

test("the canonical schemas and semantic validator accept the real catalog/world pair", () => {
  const report = validatePair();

  assert.equal(report.valid, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.facts.catalogObjectIds.length, 15);
  assert.equal(report.facts.derivedCounts.terrain_atlas_tiles, 48);
  assert.equal(report.facts.derivedCounts.terrain_map_tiles, 144);
  assert.equal(report.facts.derivedCounts.collision_objects, 18);
});

test("the schemas own tuple, path, and exclusive-bound validation", () => {
  const invalidCatalog = structuredClone(catalog);
  invalidCatalog.objects["moon-sapling-a"].anchor_px[0] = -1;
  invalidCatalog.projection.yaw_degrees = 360;
  const invalidWorld = structuredClone(world);
  invalidWorld.terrain.render_tiles.texture = "images/Terrain-Atlas.png";

  const report = validatePair(invalidCatalog, invalidWorld);
  const issueCodes = new Set(report.issues.map((issue) => issue.code));

  assert.equal(report.valid, false);
  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.CATALOG_SCHEMA), true);
  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.PATH_INVALID), true);
});

test("catalog semantic checks cover geometry and references without pinning v6 content", () => {
  const invalidCatalog = structuredClone(catalog);
  invalidCatalog.floor_atlas.tiles["earth-packed-a"].uv_rect_px = [8, 8, 256, 256];
  invalidCatalog.objects["moon-sapling-a"].default_world_height = 99;
  invalidCatalog.objects["tree-oak-a"].collision_profile = "missing-profile";

  const report = validatePair(invalidCatalog);
  const issueCodes = new Set(report.issues.map((issue) => issue.code));

  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.CATALOG_GEOMETRY), true);
  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.CATALOG_REFERENCE), true);
  assert.equal(
    report.issues.some((issue) => issue.message.includes("v6") || issue.message.includes("standardized")),
    false
  );
});

test("world semantic checks distinguish broken references, geometry, and uniqueness", () => {
  const invalidWorld = structuredClone(world);
  invalidWorld.placements[1].id = invalidWorld.placements[0].id;
  invalidWorld.placements[2].object = "missing-object";
  invalidWorld.terrain.tile_rows[0] = invalidWorld.terrain.tile_rows[0].slice(1);
  invalidWorld.terrain.render_tiles.terrain_regions[0].first_index = 20;

  const report = validatePair(catalog, invalidWorld);
  const issueCodes = new Set(report.issues.map((issue) => issue.code));

  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.WORLD_REFERENCE), true);
  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.WORLD_GEOMETRY), true);
  assert.equal(issueCodes.has(SCENERY_ISSUE_CODES.WORLD_UNIQUENESS), true);
});

test("contract package validation reuses the same facts without reading image payloads", async () => {
  const directFacts = deriveSceneryFacts({ catalog, world });
  const report = await validateSceneryPackage();

  assert.equal(Object.keys(SCENERY_ISSUE_CODES).length, 23);
  assert.equal(new Set(Object.values(SCENERY_ISSUE_CODES)).size, 23);
  assert.equal(report.valid, true, JSON.stringify(report.issues, null, 2));
  assert.deepEqual(report.facts, directFacts);
  await assert.rejects(
    validateSceneryPackage({ profile: "everything" }),
    /Unknown scenery validation profile/u
  );
});
