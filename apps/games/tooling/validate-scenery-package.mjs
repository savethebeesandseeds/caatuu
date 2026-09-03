import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JsonSchemaSubsetError,
  validateJsonSchemaSubset
} from "./json-schema-subset.mjs";

export const SCENERY_ISSUE_CODES = Object.freeze({
  SCHEMA_UNSUPPORTED: "schema.unsupported",
  JSON_INVALID: "json.invalid",
  CATALOG_SCHEMA: "catalog.schema",
  CATALOG_GEOMETRY: "catalog.geometry",
  CATALOG_REFERENCE: "catalog.reference",
  WORLD_SCHEMA: "world.schema",
  WORLD_GEOMETRY: "world.geometry",
  WORLD_REFERENCE: "world.reference",
  WORLD_UNIQUENESS: "world.uniqueness",
  REGISTRY_SHAPE: "registry.shape",
  REGISTRY_REFERENCE: "registry.reference",
  REGISTRY_INVENTORY: "registry.inventory",
  MANIFEST_SHAPE: "manifest.shape",
  MANIFEST_REFERENCE: "manifest.reference",
  MANIFEST_COUNTS: "manifest.counts",
  PATH_INVALID: "path.invalid",
  PATH_MISSING: "path.missing",
  EVIDENCE_HASH: "evidence.hash",
  EVIDENCE_LENGTH: "evidence.length",
  EVIDENCE_IMAGE: "evidence.image",
  EVIDENCE_INVENTORY: "evidence.inventory",
  CHECKSUM_FORMAT: "checksum.format",
  CHECKSUM_DUPLICATE: "checksum.duplicate"
});

const SHA256 = /^[a-f0-9]{64}$/u;
const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pointer(base, token) {
  const escaped = String(token).replace(/~/gu, "~0").replace(/\//gu, "~1");
  return `${base}/${escaped}`;
}

function addIssue(issues, code, issuePath, message) {
  issues.push({ code, path: issuePath, message });
}

function finishReport(issues, facts = {}) {
  const unique = new Map();
  for (const issue of issues) {
    unique.set(`${issue.code}\u0000${issue.path}\u0000${issue.message}`, issue);
  }
  const sorted = [...unique.values()].sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
  ));
  return { valid: sorted.length === 0, issues: sorted, facts };
}

function sameJson(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && sameJson(left[key], right[key])
    ));
}

function sortedCountObject(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function deriveSceneryFacts({ catalog, world }) {
  const objects = isObject(catalog?.objects) ? catalog.objects : {};
  const floorTiles = isObject(catalog?.floor_atlas?.tiles) ? catalog.floor_atlas.tiles : {};
  const placements = Array.isArray(world?.placements) ? world.placements : [];
  const boundaries = Array.isArray(world?.boundaries) ? world.boundaries : [];
  const spawnPoints = Array.isArray(world?.spawn_points) ? world.spawn_points : [];
  const criticalRoutes = Array.isArray(world?.critical_routes) ? world.critical_routes : [];
  const terrain = isObject(world?.terrain) ? world.terrain : {};
  const renderTiles = isObject(terrain.render_tiles) ? terrain.render_tiles : null;
  const indexRows = Array.isArray(terrain.tile_index_rows) ? terrain.tile_index_rows : [];
  const flatIndices = indexRows.flatMap((row) => Array.isArray(row) ? row : []);
  const placementCounts = sortedCountObject(
    placements.map((placement) => placement?.object).filter((value) => typeof value === "string")
  );
  const solidProps = placements.filter((placement) => placement?.collision_enabled === true).length;

  let terrainAtlasTiles = 0;
  let terrainRenderTilesWithPadding = 0;
  let terrainChunks = 0;
  let maximumLoadedChunks = 0;
  if (renderTiles) {
    const mapColumns = Array.isArray(indexRows[0]) ? indexRows[0].length : 0;
    const padding = Number.isInteger(renderTiles.padding_tiles) ? renderTiles.padding_tiles : 0;
    const chunkSize = Number.isInteger(renderTiles.chunk_size_tiles) && renderTiles.chunk_size_tiles > 0
      ? renderTiles.chunk_size_tiles
      : 1;
    const streamRadius = Number.isInteger(renderTiles.stream_radius_chunks)
      ? renderTiles.stream_radius_chunks
      : 0;
    const paddedColumns = mapColumns + padding * 2;
    const paddedRows = indexRows.length + padding * 2;
    terrainAtlasTiles = Array.isArray(renderTiles.atlas_grid)
      ? Number(renderTiles.atlas_grid[0] ?? 0) * Number(renderTiles.atlas_grid[1] ?? 0)
      : 0;
    terrainRenderTilesWithPadding = paddedColumns * paddedRows;
    terrainChunks = Math.ceil(paddedColumns / chunkSize) * Math.ceil(paddedRows / chunkSize);
    maximumLoadedChunks = Math.min(terrainChunks, (streamRadius * 2 + 1) ** 2);
  }

  const objectTextureFiles = Object.values(objects)
    .map((object) => object?.texture)
    .filter((value) => typeof value === "string")
    .sort();
  const runtimeFiles = [...objectTextureFiles];
  if (typeof renderTiles?.texture === "string") runtimeFiles.push(renderTiles.texture);
  if (typeof terrain.ground_plate?.texture === "string") runtimeFiles.push(terrain.ground_plate.texture);

  return {
    catalogId: catalog?.catalog_id ?? null,
    catalogVersion: catalog?.catalog_version ?? null,
    projectionId: catalog?.projection?.id ?? null,
    worldId: world?.layout_id ?? null,
    catalogObjectIds: Object.keys(objects).sort(),
    floorTileIds: Object.keys(floorTiles).sort(),
    objectTextureFiles,
    runtimeFiles: [...new Set(runtimeFiles)].sort(),
    placementCounts,
    derivedCounts: {
      logical_navigation_cells: Number(terrain.columns ?? 0) * Number(terrain.rows ?? 0),
      terrain_atlas_tiles: terrainAtlasTiles,
      terrain_map_tiles: flatIndices.length,
      terrain_unique_tile_types: new Set(flatIndices).size,
      terrain_render_tiles_with_padding: terrainRenderTilesWithPadding,
      terrain_chunks: terrainChunks,
      maximum_loaded_chunks: maximumLoadedChunks,
      terrain_surfaces_per_chunk: renderTiles ? 1 : 0,
      legacy_ground_plates: terrain.ground_plate ? 1 : 0,
      catalog_objects: Object.keys(objects).length,
      placements: placements.length,
      back_placements: placements.filter((placement) => placement?.layer === "back").length,
      middle_placements: placements.filter((placement) => placement?.layer === "middle").length,
      front_placements: placements.filter((placement) => placement?.layer === "front").length,
      solid_props: solidProps,
      decorative_props: placements.length - solidProps,
      boundaries: boundaries.length,
      collision_objects: solidProps + boundaries.length,
      spawn_points: spawnPoints.length,
      critical_routes: criticalRoutes.length
    }
  };
}

function collectSchemaIssues(schema, value, basePath, schemaCode, issues) {
  try {
    const result = validateJsonSchemaSubset(schema, value, { instancePath: basePath });
    for (const error of result.errors) {
      const isPath = error.keyword === "pattern"
        && /\/(?:authority_path|texture)$/u.test(error.instancePath);
      addIssue(
        issues,
        isPath ? SCENERY_ISSUE_CODES.PATH_INVALID : schemaCode,
        error.instancePath,
        error.message
      );
    }
    return result.valid;
  } catch (caught) {
    if (caught instanceof JsonSchemaSubsetError) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.SCHEMA_UNSUPPORTED,
        `${basePath}Schema${caught.schemaPath}`,
        `${caught.code}: ${caught.message}`
      );
      return false;
    }
    throw caught;
  }
}

function validateCatalogSemantics(catalog, issues) {
  const atlas = catalog.floor_atlas;
  const [atlasWidth, atlasHeight] = atlas.size_px;
  const rectangles = [];
  for (const [tileId, tile] of Object.entries(atlas.tiles)) {
    const [x, y, width, height] = tile.uv_rect_px;
    const tilePath = pointer("/catalog/floor_atlas/tiles", tileId);
    if (x + width > atlasWidth || y + height > atlasHeight) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.CATALOG_GEOMETRY,
        `${tilePath}/uv_rect_px`,
        "Tile rectangle exceeds the declared atlas size."
      );
    }
    rectangles.push({ tileId, x, y, width, height });
  }
  for (let first = 0; first < rectangles.length; first += 1) {
    for (let second = first + 1; second < rectangles.length; second += 1) {
      const left = rectangles[first];
      const right = rectangles[second];
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      if (overlaps) {
        addIssue(
          issues,
          SCENERY_ISSUE_CODES.CATALOG_GEOMETRY,
          "/catalog/floor_atlas/tiles",
          `Atlas rectangles ${left.tileId} and ${right.tileId} overlap.`
        );
      }
    }
  }

  for (const [objectId, object] of Object.entries(catalog.objects)) {
    const objectPath = pointer("/catalog/objects", objectId);
    if (object.anchor_px[0] > object.image_size_px[0]
        || object.anchor_px[1] > object.image_size_px[1]) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.CATALOG_GEOMETRY,
        `${objectPath}/anchor_px`,
        "Anchor must remain inside the declared image bounds."
      );
    }
    const [minimumHeight, maximumHeight] = object.allowed_world_height;
    if (minimumHeight > maximumHeight
        || object.default_world_height < minimumHeight
        || object.default_world_height > maximumHeight) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.CATALOG_GEOMETRY,
        `${objectPath}/allowed_world_height`,
        "Allowed world height must be ascending and contain the default height."
      );
    }
    if (!Object.hasOwn(catalog.collision_profiles, object.collision_profile)) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.CATALOG_REFERENCE,
        `${objectPath}/collision_profile`,
        `Unknown collision profile ${JSON.stringify(object.collision_profile)}.`
      );
    }
  }
}

function addDuplicateIdIssues(items, basePath, issues) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index].id;
    if (seen.has(id)) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_UNIQUENESS,
        `${basePath}/${index}/id`,
        `Duplicate id ${JSON.stringify(id)}.`
      );
    }
    seen.add(id);
  }
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) < 0.001;
}

function validateRenderTiles(terrain, issues) {
  const renderTiles = terrain.render_tiles;
  const basePath = "/world/terrain/render_tiles";
  const [imageWidth, imageHeight] = renderTiles.image_size_px;
  const [tileWidth, tileHeight] = renderTiles.tile_size_px;
  const [contentWidth, contentHeight] = renderTiles.tile_content_size_px;
  const [atlasColumns, atlasRows] = renderTiles.atlas_grid;
  const capacity = atlasColumns * atlasRows;

  const geometryChecks = [
    [imageWidth === tileWidth * atlasColumns, "/image_size_px", "Atlas width must equal tile width times columns."],
    [imageHeight === tileHeight * atlasRows, "/image_size_px", "Atlas height must equal tile height times rows."],
    [tileWidth === contentWidth + renderTiles.tile_gutter_px * 2, "/tile_size_px", "Tile width must include two gutters."],
    [tileHeight === contentHeight + renderTiles.tile_gutter_px * 2, "/tile_size_px", "Tile height must include two gutters."],
    [contentWidth / renderTiles.world_tile_size === renderTiles.pixels_per_world_unit, "/pixels_per_world_unit", "Horizontal texel density is inconsistent."],
    [contentHeight / renderTiles.world_tile_size === renderTiles.pixels_per_world_unit, "/pixels_per_world_unit", "Vertical texel density is inconsistent."],
    [renderTiles.tile_ids.length === capacity, "/tile_ids", "tile_ids must contain one id per atlas cell."],
    [renderTiles.padding_tile_index < capacity, "/padding_tile_index", "Padding tile index exceeds the atlas."]
  ];
  for (const [valid, suffix, message] of geometryChecks) {
    if (!valid) addIssue(issues, SCENERY_ISSUE_CODES.WORLD_GEOMETRY, `${basePath}${suffix}`, message);
  }

  const pathFirstIndex = renderTiles.path_connectivity.first_index;
  if (pathFirstIndex + 15 >= capacity) {
    addIssue(
      issues,
      SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
      `${basePath}/path_connectivity/first_index`,
      "Path connectivity must reserve sixteen atlas cells."
    );
  }
  const occupiedRanges = [{ id: "path_connectivity", first: pathFirstIndex }];
  const fullVariants = new Set();
  const regionIds = new Set();
  const overlaps = (left, right) => left <= right + 15 && right <= left + 15;
  renderTiles.terrain_regions.forEach((region, regionIndex) => {
    const regionPath = `${basePath}/terrain_regions/${regionIndex}`;
    if (regionIds.has(region.id)) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_UNIQUENESS,
        `${regionPath}/id`,
        `Duplicate terrain region id ${JSON.stringify(region.id)}.`
      );
    }
    regionIds.add(region.id);
    if (region.first_index + 15 >= capacity) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
        `${regionPath}/first_index`,
        "Terrain region must reserve sixteen atlas cells."
      );
    }
    for (const occupied of occupiedRanges) {
      if (overlaps(region.first_index, occupied.first)) {
        addIssue(
          issues,
          SCENERY_ISSUE_CODES.WORLD_UNIQUENESS,
          `${regionPath}/first_index`,
          `Terrain region overlaps ${occupied.id}.`
        );
      }
    }
    occupiedRanges.push({ id: region.id, first: region.first_index });
    for (const [variantIndex, atlasIndex] of (region.full_variant_indices ?? []).entries()) {
      const variantPath = `${regionPath}/full_variant_indices/${variantIndex}`;
      if (atlasIndex >= capacity) {
        addIssue(issues, SCENERY_ISSUE_CODES.WORLD_GEOMETRY, variantPath, "Variant index exceeds the atlas.");
      }
      if (fullVariants.has(atlasIndex)) {
        addIssue(issues, SCENERY_ISSUE_CODES.WORLD_UNIQUENESS, variantPath, "Variant index is duplicated.");
      }
      fullVariants.add(atlasIndex);
      for (const occupied of occupiedRanges) {
        if (atlasIndex >= occupied.first && atlasIndex <= occupied.first + 15) {
          addIssue(
            issues,
            SCENERY_ISSUE_CODES.WORLD_UNIQUENESS,
            variantPath,
            `Variant index overlaps ${occupied.id}.`
          );
        }
      }
    }
  });

  const indexRows = terrain.tile_index_rows;
  const mapColumns = indexRows[0].length;
  indexRows.forEach((row, rowIndex) => {
    if (row.length !== mapColumns) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
        `/world/terrain/tile_index_rows/${rowIndex}`,
        "Tile index rows must all have the same length."
      );
    }
    row.forEach((tileIndex, columnIndex) => {
      if (tileIndex >= capacity) {
        addIssue(
          issues,
          SCENERY_ISSUE_CODES.WORLD_REFERENCE,
          `/world/terrain/tile_index_rows/${rowIndex}/${columnIndex}`,
          "Tile index exceeds the atlas."
        );
      }
    });
  });
  if (!nearlyEqual(mapColumns * renderTiles.world_tile_size, terrain.columns * terrain.cell_size)
      || !nearlyEqual(indexRows.length * renderTiles.world_tile_size, terrain.rows * terrain.cell_size)) {
    addIssue(
      issues,
      SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
      "/world/terrain/tile_index_rows",
      "Render-tile world extent must match the navigation grid extent."
    );
  }
}

function validateWorldSemantics(world, catalog, issues) {
  const catalogReferences = [
    [world.catalog_id === catalog.catalog_id, "/world/catalog_id", "World catalog id does not match the catalog."],
    [world.catalog_version === catalog.catalog_version, "/world/catalog_version", "World catalog version does not match the catalog."],
    [world.projection_id === catalog.projection.id, "/world/projection_id", "World projection does not match the catalog."]
  ];
  for (const [valid, issuePath, message] of catalogReferences) {
    if (!valid) addIssue(issues, SCENERY_ISSUE_CODES.WORLD_REFERENCE, issuePath, message);
  }

  const terrain = world.terrain;
  if (terrain.ground_plate) {
    const plate = terrain.ground_plate;
    const [imageWidth, imageHeight] = plate.image_size_px;
    const [worldWidth, worldHeight] = plate.world_size;
    if (imageWidth / worldWidth !== plate.pixels_per_world_unit
        || imageHeight / worldHeight !== plate.pixels_per_world_unit
        || !nearlyEqual(worldWidth, terrain.columns * terrain.cell_size)
        || !nearlyEqual(worldHeight, terrain.rows * terrain.cell_size)) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
        "/world/terrain/ground_plate",
        "Ground plate density and extent must match the navigation grid."
      );
    }
  } else {
    validateRenderTiles(terrain, issues);
  }

  for (const [symbol, tileId] of Object.entries(terrain.tile_legend)) {
    if (!Object.hasOwn(catalog.floor_atlas.tiles, tileId)) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_REFERENCE,
        pointer("/world/terrain/tile_legend", symbol),
        `Unknown floor tile ${JSON.stringify(tileId)}.`
      );
    }
  }
  terrain.tile_rows.forEach((row, rowIndex) => {
    const symbols = [...row];
    if (symbols.length !== terrain.columns) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
        `/world/terrain/tile_rows/${rowIndex}`,
        "Tile row width must equal terrain columns."
      );
    }
    for (const symbol of symbols) {
      if (!Object.hasOwn(terrain.tile_legend, symbol)) {
        addIssue(
          issues,
          SCENERY_ISSUE_CODES.WORLD_REFERENCE,
          `/world/terrain/tile_rows/${rowIndex}`,
          `Tile row uses unresolved symbol ${JSON.stringify(symbol)}.`
        );
      }
    }
  });

  for (const collection of ["placements", "boundaries", "spawn_points", "critical_routes"]) {
    addDuplicateIdIssues(world[collection], `/world/${collection}`, issues);
  }

  const placementsByObject = new Map();
  world.placements.forEach((placement, index) => {
    const placementPath = `/world/placements/${index}`;
    const object = catalog.objects[placement.object];
    if (!object) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_REFERENCE,
        `${placementPath}/object`,
        `Unknown catalog object ${JSON.stringify(placement.object)}.`
      );
      return;
    }
    const worldHeight = object.default_world_height * placement.scale;
    if (worldHeight < object.allowed_world_height[0] || worldHeight > object.allowed_world_height[1]) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
        `${placementPath}/scale`,
        "Placement scale puts the object outside its allowed world-height range."
      );
    }
    if (placement.flip_horizontal && !object.reuse.allow_horizontal_flip) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_REFERENCE,
        `${placementPath}/flip_horizontal`,
        "Placement violates the object's horizontal-flip contract."
      );
    }
    if (placement.collision_enabled
        && catalog.collision_profiles[object.collision_profile]?.shapes.length === 0) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_REFERENCE,
        `${placementPath}/collision_enabled`,
        "A colliding placement requires a non-empty collision profile."
      );
    }
    const placements = placementsByObject.get(placement.object) ?? [];
    placements.push(placement);
    placementsByObject.set(placement.object, placements);
  });
  for (const [objectId, placements] of placementsByObject) {
    if (placements.length > catalog.objects[objectId].reuse.maximum_placements_per_layout) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.WORLD_GEOMETRY,
        "/world/placements",
        `Placement count exceeds ${objectId}'s reuse limit.`
      );
    }
  }
}

export function validateSceneryPair({ catalogSchema, catalog, worldSchema, world }) {
  const issues = [];
  const catalogSchemaValid = collectSchemaIssues(
    catalogSchema,
    catalog,
    "/catalog",
    SCENERY_ISSUE_CODES.CATALOG_SCHEMA,
    issues
  );
  const worldSchemaValid = collectSchemaIssues(
    worldSchema,
    world,
    "/world",
    SCENERY_ISSUE_CODES.WORLD_SCHEMA,
    issues
  );
  if (catalogSchemaValid) validateCatalogSemantics(catalog, issues);
  if (catalogSchemaValid && worldSchemaValid) validateWorldSemantics(world, catalog, issues);
  const facts = catalogSchemaValid && worldSchemaValid ? deriveSceneryFacts({ catalog, world }) : {};
  return finishReport(issues, facts);
}

function checkKeys(value, required, optional, issuePath, code, issues) {
  if (!isObject(value)) {
    addIssue(issues, code, issuePath, "Expected an object.");
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    addIssue(
      issues,
      code,
      issuePath,
      `Object keys differ (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`
    );
    return false;
  }
  return true;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")
      || value.startsWith("/") || /^[a-z]:/iu.test(value) || value.includes("://")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function normalizeDirectory(value, fallback) {
  if (value instanceof URL) return path.resolve(fileURLToPath(value));
  return path.resolve(value === undefined ? fallback : String(value));
}

function resolvePackagePath(relativePath, repoRoot, sceneryRoot, issues, issuePath) {
  if (!isSafeRelativePath(relativePath)) {
    addIssue(issues, SCENERY_ISSUE_CODES.PATH_INVALID, issuePath, "Path must be a safe relative path.");
    return null;
  }
  const usesRepositoryRoot = relativePath.startsWith("apps/");
  const root = usesRepositoryRoot ? repoRoot : sceneryRoot;
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    addIssue(issues, SCENERY_ISSUE_CODES.PATH_INVALID, issuePath, "Path escapes its approved root.");
    return null;
  }
  return resolved;
}

async function readRegularFile(filePath, issuePath, issues) {
  try {
    const status = await lstat(filePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      addIssue(issues, SCENERY_ISSUE_CODES.PATH_INVALID, issuePath, "Expected a regular, non-linked file.");
      return null;
    }
    return await readFile(filePath);
  } catch (caught) {
    if (caught?.code === "ENOENT") {
      addIssue(issues, SCENERY_ISSUE_CODES.PATH_MISSING, issuePath, "Required file is missing.");
      return null;
    }
    throw caught;
  }
}

async function readJsonDocument(relativePath, repoRoot, sceneryRoot, issues) {
  const issuePath = `/files/${relativePath}`;
  const filePath = resolvePackagePath(relativePath, repoRoot, sceneryRoot, issues, issuePath);
  if (!filePath) return null;
  const bytes = await readRegularFile(filePath, issuePath, issues);
  if (!bytes) return null;
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch (caught) {
    addIssue(issues, SCENERY_ISSUE_CODES.JSON_INVALID, issuePath, caught.message);
    return null;
  }
}

function validateRegistry(registry, catalog, world, facts, issues) {
  if (!checkKeys(
    registry,
    ["schema_version", "release_status", "history_policy", "catalog", "world", "runtime_images", "support"],
    [],
    "/registry",
    SCENERY_ISSUE_CODES.REGISTRY_SHAPE,
    issues
  )) return;
  checkKeys(registry.catalog, ["id", "version", "file", "manifest", "provenance", "schema"], [], "/registry/catalog", SCENERY_ISSUE_CODES.REGISTRY_SHAPE, issues);
  checkKeys(registry.world, ["id", "file", "manifest", "provenance", "schema", "catalog_id", "catalog_version"], [], "/registry/world", SCENERY_ISSUE_CODES.REGISTRY_SHAPE, issues);
  checkKeys(registry.support, ["source_glob", "checksum_file", "processing_file"], [], "/registry/support", SCENERY_ISSUE_CODES.REGISTRY_SHAPE, issues);
  if (!Array.isArray(registry.runtime_images)) {
    addIssue(issues, SCENERY_ISSUE_CODES.REGISTRY_SHAPE, "/registry/runtime_images", "Expected an array.");
    return;
  }

  const expectedReferences = [
    [registry.catalog.id, catalog.catalog_id, "/registry/catalog/id"],
    [registry.catalog.version, catalog.catalog_version, "/registry/catalog/version"],
    [registry.world.id, world.layout_id, "/registry/world/id"],
    [registry.world.catalog_id, catalog.catalog_id, "/registry/world/catalog_id"],
    [registry.world.catalog_version, catalog.catalog_version, "/registry/world/catalog_version"]
  ];
  for (const [actual, expected, issuePath] of expectedReferences) {
    if (actual !== expected) {
      addIssue(issues, SCENERY_ISSUE_CODES.REGISTRY_REFERENCE, issuePath, "Registry reference does not match package metadata.");
    }
  }

  const entriesById = new Map();
  for (const [index, entry] of registry.runtime_images.entries()) {
    const entryPath = `/registry/runtime_images/${index}`;
    if (!isObject(entry) || typeof entry.id !== "string" || typeof entry.file !== "string") {
      addIssue(issues, SCENERY_ISSUE_CODES.REGISTRY_SHAPE, entryPath, "Runtime entry requires id and file strings.");
      continue;
    }
    if (entriesById.has(entry.id)) {
      addIssue(issues, SCENERY_ISSUE_CODES.REGISTRY_INVENTORY, `${entryPath}/id`, "Runtime id is duplicated.");
    }
    entriesById.set(entry.id, entry);
  }
  for (const objectId of facts.catalogObjectIds) {
    const entry = entriesById.get(objectId);
    const object = catalog.objects[objectId];
    if (!entry || entry.kind !== "object" || entry.file !== object.texture
        || entry.placement_count !== (facts.placementCounts[objectId] ?? 0)) {
      addIssue(
        issues,
        SCENERY_ISSUE_CODES.REGISTRY_INVENTORY,
        `/registry/runtime_images/${objectId}`,
        "Object runtime inventory does not match catalog and placement facts."
      );
    }
  }
  const expectedIds = new Set(facts.catalogObjectIds);
  if (world.terrain.render_tiles) {
    const terrainEntries = registry.runtime_images.filter((entry) => entry?.kind === "terrain-atlas");
    if (terrainEntries.length !== 1
        || terrainEntries[0].file !== world.terrain.render_tiles.texture
        || terrainEntries[0].map_cell_count !== facts.derivedCounts.terrain_map_tiles
        || terrainEntries[0].atlas_tile_count !== facts.derivedCounts.terrain_atlas_tiles) {
      addIssue(issues, SCENERY_ISSUE_CODES.REGISTRY_INVENTORY, "/registry/runtime_images", "Terrain runtime inventory is inconsistent.");
    } else {
      expectedIds.add(terrainEntries[0].id);
    }
  }
  const actualIds = new Set(registry.runtime_images.map((entry) => entry?.id).filter(Boolean));
  if (!sameJson([...actualIds].sort(), [...expectedIds].sort())) {
    addIssue(issues, SCENERY_ISSUE_CODES.REGISTRY_INVENTORY, "/registry/runtime_images", "Runtime inventory contains missing or unexpected ids.");
  }
}

function validateCatalogManifest(manifest, catalog, facts, issues) {
  if (!checkKeys(
    manifest,
    ["schema_version", "catalog_id", "catalog_version", "release_status", "style_authority", "build_pipeline", "sources", "artifacts"],
    ["auxiliary_files"],
    "/catalogManifest",
    SCENERY_ISSUE_CODES.MANIFEST_SHAPE,
    issues
  )) return;
  if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.artifacts)) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_SHAPE, "/catalogManifest", "sources and artifacts must be arrays.");
    return;
  }
  if (manifest.catalog_id !== catalog.catalog_id
      || manifest.catalog_version !== catalog.catalog_version
      || manifest.release_status !== catalog.release_status) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, "/catalogManifest", "Catalog manifest identity does not match the catalog.");
  }

  const sourceIds = new Set();
  for (const [index, source] of manifest.sources.entries()) {
    const sourcePath = `/catalogManifest/sources/${index}`;
    if (!isObject(source) || typeof source.id !== "string" || !isSafeRelativePath(source.source_file)
        || !SHA256.test(source.source_sha256)) {
      addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_SHAPE, sourcePath, "Source identity, path, or hash is malformed.");
      continue;
    }
    if (sourceIds.has(source.id)) addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_INVENTORY, `${sourcePath}/id`, "Source id is duplicated.");
    sourceIds.add(source.id);
  }

  const artifactsByFile = new Map();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const artifactPath = `/catalogManifest/artifacts/${index}`;
    if (!isObject(artifact) || typeof artifact.id !== "string" || !isSafeRelativePath(artifact.file)
        || !SHA256.test(artifact.sha256) || !Number.isInteger(artifact.byte_length)
        || artifact.byte_length <= 0 || !Number.isInteger(artifact.width)
        || !Number.isInteger(artifact.height) || typeof artifact.runtime_used !== "boolean") {
      addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_SHAPE, artifactPath, "Artifact contract is malformed.");
      continue;
    }
    if (!sourceIds.has(artifact.source_id)) {
      addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, `${artifactPath}/source_id`, "Artifact references an unknown source.");
    }
    if (artifactsByFile.has(artifact.file)) {
      addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_INVENTORY, `${artifactPath}/file`, "Artifact file is duplicated.");
    }
    artifactsByFile.set(artifact.file, artifact);
  }

  const runtimeFiles = manifest.artifacts.filter((artifact) => artifact?.runtime_used === true).map((artifact) => artifact.file).sort();
  if (!sameJson(runtimeFiles, facts.objectTextureFiles)) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, "/catalogManifest/artifacts", "Runtime artifacts must exactly match catalog object textures.");
  }
  for (const [objectId, object] of Object.entries(catalog.objects)) {
    const artifact = artifactsByFile.get(object.texture);
    if (!artifact || artifact.id !== objectId || artifact.source_id !== object.source_id
        || !sameJson([artifact.width, artifact.height], object.image_size_px)) {
      addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, `/catalogManifest/artifacts/${objectId}`, "Object artifact does not match the catalog.");
    }
  }
  const floorArtifact = artifactsByFile.get(catalog.floor_atlas.texture);
  if (!floorArtifact || floorArtifact.runtime_used !== false
      || !sameJson([floorArtifact.width, floorArtifact.height], catalog.floor_atlas.size_px)) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, "/catalogManifest/artifacts/floor-atlas", "Floor atlas artifact does not match the catalog.");
  }
}

function validateWorldManifest(manifest, catalog, world, facts, issues) {
  const keys = [
    "schema_version", "layout_id", "release_status", "catalog_id", "catalog_version",
    "catalog_file", "catalog_sha256", "catalog_byte_length", "layout_file", "layout_sha256",
    "layout_byte_length", "source_materials", "terrain_tileset", "derived_counts",
    "asset_placement_counts"
  ];
  if (!checkKeys(manifest, keys, [], "/worldManifest", SCENERY_ISSUE_CODES.MANIFEST_SHAPE, issues)) return;
  if (!SHA256.test(manifest.catalog_sha256) || !SHA256.test(manifest.layout_sha256)
      || !Number.isInteger(manifest.catalog_byte_length) || !Number.isInteger(manifest.layout_byte_length)
      || !Array.isArray(manifest.source_materials) || !isObject(manifest.terrain_tileset)
      || !isObject(manifest.derived_counts) || !isObject(manifest.asset_placement_counts)) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_SHAPE, "/worldManifest", "World manifest fields are malformed.");
    return;
  }
  if (manifest.layout_id !== world.layout_id || manifest.catalog_id !== catalog.catalog_id
      || manifest.catalog_version !== catalog.catalog_version
      || manifest.release_status !== catalog.release_status
      || manifest.catalog_file !== "metadata/catalog.json"
      || manifest.layout_file !== "metadata/world.json") {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, "/worldManifest", "World manifest identity does not match the package.");
  }
  if (!sameJson(manifest.derived_counts, facts.derivedCounts)) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_COUNTS, "/worldManifest/derived_counts", "Derived counts do not match catalog and world facts.");
  }
  if (!sameJson(manifest.asset_placement_counts, facts.placementCounts)) {
    addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_COUNTS, "/worldManifest/asset_placement_counts", "Placement counts do not match the world.");
  }
  if (world.terrain.render_tiles) {
    const renderTiles = world.terrain.render_tiles;
    const terrainManifest = manifest.terrain_tileset;
    const sharedKeys = [
      "tile_size_px", "tile_content_size_px", "tile_gutter_px", "atlas_grid", "world_tile_size",
      "chunk_size_tiles", "stream_radius_chunks", "padding_tiles", "padding_tile_index", "tile_ids",
      "path_connectivity", "terrain_regions", "pixels_per_world_unit", "projection", "render_role"
    ];
    const sharedMatches = sharedKeys.every((key) => sameJson(terrainManifest[key], renderTiles[key]));
    if (terrainManifest.file !== renderTiles.texture || terrainManifest.source_id !== renderTiles.source_id
        || !sameJson([terrainManifest.width, terrainManifest.height], renderTiles.image_size_px)
        || !sharedMatches) {
      addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_REFERENCE, "/worldManifest/terrain_tileset", "Terrain manifest does not match the render-tile contract.");
    }
  }
  const roles = new Set();
  for (const [index, source] of manifest.source_materials.entries()) {
    const sourcePath = `/worldManifest/source_materials/${index}`;
    if (!isObject(source) || !isSafeRelativePath(source.file) || typeof source.role !== "string"
        || roles.has(source.role) || !SHA256.test(source.sha256)
        || !Number.isInteger(source.byte_length)) {
      addIssue(issues, SCENERY_ISSUE_CODES.MANIFEST_SHAPE, sourcePath, "Source-material contract is malformed or duplicated.");
    }
    roles.add(source?.role);
  }
}

function parseChecksums(text, issues) {
  const checksums = new Map();
  const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length === 0) {
    addIssue(issues, SCENERY_ISSUE_CODES.CHECKSUM_FORMAT, "/checksums", "Checksum inventory is empty.");
    return checksums;
  }
  lines.forEach((line, index) => {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match || !isSafeRelativePath(match[2])) {
      addIssue(issues, SCENERY_ISSUE_CODES.CHECKSUM_FORMAT, `/checksums/${index}`, "Checksum line is malformed.");
      return;
    }
    if (checksums.has(match[2])) {
      addIssue(issues, SCENERY_ISSUE_CODES.CHECKSUM_DUPLICATE, `/checksums/${index}`, `Checksum path ${match[2]} is duplicated.`);
    }
    checksums.set(match[2], match[1]);
  });
  return checksums;
}

function validateChecksumContract(checksums, facts, catalogManifest, worldManifest, issues) {
  for (const file of facts.runtimeFiles) {
    if (!checksums.has(file)) {
      addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_INVENTORY, "/checksums", `Runtime file ${file} is missing from checksums.`);
    }
  }
  for (const artifact of catalogManifest?.artifacts ?? []) {
    if (checksums.has(artifact.file) && checksums.get(artifact.file) !== artifact.sha256) {
      addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_HASH, `/checksums/${artifact.file}`, "Checksum disagrees with catalog manifest.");
    }
  }
  const terrain = worldManifest?.terrain_tileset;
  if (terrain && checksums.has(terrain.file) && checksums.get(terrain.file) !== terrain.sha256) {
    addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_HASH, `/checksums/${terrain.file}`, "Checksum disagrees with world manifest.");
  }
}

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function verifyEvidenceFile({
  relativePath,
  expectedHash,
  expectedLength,
  expectedSize,
  repoRoot,
  sceneryRoot,
  issuePath,
  issues
}) {
  const filePath = resolvePackagePath(relativePath, repoRoot, sceneryRoot, issues, issuePath);
  if (!filePath) return;
  const bytes = await readRegularFile(filePath, issuePath, issues);
  if (!bytes) return;
  if (Number.isInteger(expectedLength) && bytes.length !== expectedLength) {
    addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_LENGTH, issuePath, "Byte length does not match the manifest.");
  }
  if (SHA256.test(expectedHash ?? "")
      && createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
    addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_HASH, issuePath, "SHA-256 does not match the manifest.");
  }
  if (expectedSize) {
    const size = pngSize(bytes);
    if (!size || !sameJson(size, expectedSize)) {
      addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_IMAGE, issuePath, "PNG dimensions do not match the manifest.");
    }
  }
}

async function validateEvidence({
  catalogDocument,
  worldDocument,
  catalogManifest,
  worldManifest,
  checksums,
  repoRoot,
  sceneryRoot,
  issues
}) {
  if (worldManifest) {
    const jsonEvidence = [
      ["metadata/catalog.json", worldManifest.catalog_sha256, worldManifest.catalog_byte_length, catalogDocument?.bytes],
      ["metadata/world.json", worldManifest.layout_sha256, worldManifest.layout_byte_length, worldDocument?.bytes]
    ];
    for (const [relativePath, expectedHash, expectedLength, bytes] of jsonEvidence) {
      const issuePath = `/evidence/${relativePath}`;
      if (!bytes) continue;
      if (bytes.length !== expectedLength) addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_LENGTH, issuePath, "JSON byte length does not match the manifest.");
      if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) addIssue(issues, SCENERY_ISSUE_CODES.EVIDENCE_HASH, issuePath, "JSON hash does not match the manifest.");
    }
  }

  for (const [index, source] of (catalogManifest?.sources ?? []).entries()) {
    await verifyEvidenceFile({
      relativePath: source.source_file,
      expectedHash: source.source_sha256,
      repoRoot,
      sceneryRoot,
      issuePath: `/catalogManifest/sources/${index}/source_file`,
      issues
    });
  }
  for (const [index, artifact] of (catalogManifest?.artifacts ?? []).entries()) {
    await verifyEvidenceFile({
      relativePath: artifact.file,
      expectedHash: artifact.sha256,
      expectedLength: artifact.byte_length,
      expectedSize: [artifact.width, artifact.height],
      repoRoot,
      sceneryRoot,
      issuePath: `/catalogManifest/artifacts/${index}/file`,
      issues
    });
  }
  for (const [index, source] of (worldManifest?.source_materials ?? []).entries()) {
    await verifyEvidenceFile({
      relativePath: source.file,
      expectedHash: source.sha256,
      expectedLength: source.byte_length,
      expectedSize: [source.width, source.height],
      repoRoot,
      sceneryRoot,
      issuePath: `/worldManifest/source_materials/${index}/file`,
      issues
    });
  }
  if (worldManifest?.terrain_tileset) {
    const terrain = worldManifest.terrain_tileset;
    await verifyEvidenceFile({
      relativePath: terrain.file,
      expectedHash: terrain.sha256,
      expectedLength: terrain.byte_length,
      expectedSize: [terrain.width, terrain.height],
      repoRoot,
      sceneryRoot,
      issuePath: "/worldManifest/terrain_tileset/file",
      issues
    });
  }
  for (const [relativePath, expectedHash] of checksums) {
    await verifyEvidenceFile({
      relativePath,
      expectedHash,
      repoRoot,
      sceneryRoot,
      issuePath: `/checksums/${relativePath}`,
      issues
    });
  }
}

export async function validateSceneryPackage({
  repoRoot,
  sceneryRoot,
  profile = "contract"
} = {}) {
  if (!new Set(["contract", "evidence"]).has(profile)) {
    throw new TypeError(`Unknown scenery validation profile: ${profile}`);
  }
  const resolvedRepoRoot = normalizeDirectory(repoRoot, DEFAULT_REPO_ROOT);
  const resolvedSceneryRoot = normalizeDirectory(
    sceneryRoot,
    path.join(resolvedRepoRoot, "apps/launcher/static/assets/scenery")
  );
  const issues = [];
  const [catalogSchemaDocument, catalogDocument, worldSchemaDocument, worldDocument] = await Promise.all([
    readJsonDocument("metadata/catalog.schema.json", resolvedRepoRoot, resolvedSceneryRoot, issues),
    readJsonDocument("metadata/catalog.json", resolvedRepoRoot, resolvedSceneryRoot, issues),
    readJsonDocument("metadata/world.schema.json", resolvedRepoRoot, resolvedSceneryRoot, issues),
    readJsonDocument("metadata/world.json", resolvedRepoRoot, resolvedSceneryRoot, issues)
  ]);

  let facts = {};
  let pairValid = false;
  if (catalogSchemaDocument && catalogDocument && worldSchemaDocument && worldDocument) {
    const pairReport = validateSceneryPair({
      catalogSchema: catalogSchemaDocument.value,
      catalog: catalogDocument.value,
      worldSchema: worldSchemaDocument.value,
      world: worldDocument.value
    });
    issues.push(...pairReport.issues);
    facts = pairReport.facts;
    pairValid = pairReport.valid;
  }

  const [registryDocument, catalogManifestDocument, worldManifestDocument] = await Promise.all([
    readJsonDocument("metadata/registry.json", resolvedRepoRoot, resolvedSceneryRoot, issues),
    readJsonDocument("metadata/catalog.manifest.json", resolvedRepoRoot, resolvedSceneryRoot, issues),
    readJsonDocument("metadata/world.manifest.json", resolvedRepoRoot, resolvedSceneryRoot, issues)
  ]);
  const checksumPath = path.join(resolvedSceneryRoot, "metadata", "checksums.sha256");
  const checksumBytes = await readRegularFile(checksumPath, "/files/metadata/checksums.sha256", issues);
  const checksums = checksumBytes ? parseChecksums(checksumBytes.toString("utf8"), issues) : new Map();

  if (pairValid) {
    if (registryDocument) validateRegistry(registryDocument.value, catalogDocument.value, worldDocument.value, facts, issues);
    if (catalogManifestDocument) validateCatalogManifest(catalogManifestDocument.value, catalogDocument.value, facts, issues);
    if (worldManifestDocument) validateWorldManifest(worldManifestDocument.value, catalogDocument.value, worldDocument.value, facts, issues);
    validateChecksumContract(
      checksums,
      facts,
      catalogManifestDocument?.value,
      worldManifestDocument?.value,
      issues
    );
  }

  if (profile === "evidence") {
    await validateEvidence({
      catalogDocument,
      worldDocument,
      catalogManifest: catalogManifestDocument?.value,
      worldManifest: worldManifestDocument?.value,
      checksums,
      repoRoot: resolvedRepoRoot,
      sceneryRoot: resolvedSceneryRoot,
      issues
    });
  }
  return finishReport(issues, facts);
}
