import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const sceneryRoot = new URL("apps/launcher/static/assets/scenery/", repoRoot);
const catalogUrl = new URL("metadata/catalog.json", sceneryRoot);
const layoutUrl = new URL("metadata/world.json", sceneryRoot);
const styleManifestUrl = new URL("metadata/catalog.manifest.json", sceneryRoot);
const layoutManifestUrl = new URL("metadata/world.manifest.json", sceneryRoot);
const layoutProvenanceUrl = new URL("metadata/world.provenance.md", sceneryRoot);
const styleSumsUrl = new URL("metadata/checksums.sha256", sceneryRoot);
const catalogSchemaUrl = new URL("metadata/catalog.schema.json", sceneryRoot);
const layoutSchemaUrl = new URL("metadata/world.schema.json", sceneryRoot);

const [catalogSchema, layoutSchema] = await Promise.all([
  readJson(catalogSchemaUrl),
  readJson(layoutSchemaUrl)
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MACHINE_KEY = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const ENTITY_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HEX_COLOR = /^#[a-f0-9]{6}$/i;
const RESERVED_RUNTIME_SEGMENTS = new Set(["launcher", "originals", "miscellaneous"]);

const CATALOG_KEYS = [
  "schema_version",
  "catalog_id",
  "catalog_version",
  "release_status",
  "projection",
  "scale_reference",
  "style_family",
  "floor_atlas",
  "collision_profiles",
  "objects"
];
const LAYOUT_KEYS = [
  "schema_version",
  "layout_id",
  "catalog_id",
  "catalog_version",
  "projection_id",
  "terrain",
  "placements",
  "boundaries",
  "spawn_points",
  "critical_routes"
];

const validCatalog = {
  schema_version: 2,
  catalog_id: "memory-moon-style-v1",
  catalog_version: 1,
  release_status: "local-preview-only",
  projection: {
    id: "memory-moon-isometric",
    yaw_degrees: 45,
    elevation_degrees: 30
  },
  scale_reference: {
    id: "memory-moon-humanoid-v1",
    visual_height_world: 1.4264,
    capsule_height_world: 1.45,
    capsule_radius_world: 0.28,
    model_runtime_scale: 0.78,
    measurement_basis: "visible-silhouette-above-ground-anchor"
  },
  style_family: {
    id: "memory-moon-hand-painted",
    authority_path: "docs/art-direction.md",
    palette: {
      ink: "#17150f",
      moss: "#4c5b1c",
      moonlight: "#31cdd0"
    },
    rules: ["Use one fixed three-quarter projection.", "Keep silhouettes readable at play scale."]
  },
  floor_atlas: {
    texture: "sources/floor-atlas.derived.png",
    size_px: [512, 256],
    gutter_px: 8,
    tiles: {
      "grass-moss-a": {
        kind: "ground",
        tags: ["grass", "walkable"],
        uv_rect_px: [8, 8, 128, 128],
        grid_size: [1, 1],
        walkable: true,
        edges: {
          north: "grass",
          east: "grass",
          south: "grass",
          west: "grass"
        },
        allowed_rotations_degrees: [0, 90, 180, 270],
        seam_contract: "Matching edge identifiers must meet."
      },
      "earth-path-a": {
        kind: "path",
        tags: ["earth", "walkable"],
        uv_rect_px: [152, 8, 128, 128],
        grid_size: [1, 1],
        walkable: true,
        edges: {
          north: "earth",
          east: "grass",
          south: "earth",
          west: "grass"
        },
        allowed_rotations_degrees: [0, 180],
        seam_contract: "Matching edge identifiers must meet."
      }
    }
  },
  collision_profiles: {
    none: {
      shapes: []
    },
    "tree-trunk": {
      shapes: [
        {
          type: "cylinder",
          radius: 0.24,
          height: 1.1,
          offset: [0, 0.55, 0]
        }
      ]
    }
  },
  objects: {
    "moon-sapling-a": {
      texture: "images/moon-sapling-a.png",
      image_size_px: [374, 452],
      anchor_px: [187, 436],
      kind: "tree",
      tags: ["nature", "tree"],
      source_id: "moon-sapling-a-generated",
      default_world_height: 2,
      allowed_world_height: [1.8, 2.2],
      collision_profile: "tree-trunk",
      collision_scale_mode: "with-visual",
      occlusion: {
        mode: "depth"
      },
      reuse: {
        single_object: true,
        allow_horizontal_flip: false,
        allowed_rotations_degrees: [0],
        minimum_repeat_distance: 0.5,
        maximum_placements_per_layout: 3
      }
    }
  }
};

const validLayout = {
  schema_version: 2,
  layout_id: "memory-grove-v6",
  catalog_id: "memory-moon-style-v1",
  catalog_version: 1,
  projection_id: "memory-moon-isometric",
  terrain: {
    columns: 3,
    rows: 2,
    cell_size: 0.5,
    render_tiles: {
      texture: "images/terrain-atlas.png",
      image_size_px: [400, 400],
      tile_size_px: [100, 100],
      tile_content_size_px: [96, 96],
      tile_gutter_px: 2,
      atlas_grid: [4, 4],
      world_tile_size: 0.5,
      chunk_size_tiles: 2,
      stream_radius_chunks: 1,
      padding_tiles: 1,
      padding_tile_index: 0,
      tile_ids: [
        "path-none",
        "path-n",
        "path-e",
        "path-ne",
        "path-s",
        "path-ns",
        "path-es",
        "path-nes",
        "path-w",
        "path-nw",
        "path-ew",
        "path-new",
        "path-sw",
        "path-nsw",
        "path-esw",
        "path-nesw"
      ],
      path_connectivity: {
        first_index: 0,
        north_bit: 1,
        east_bit: 2,
        south_bit: 4,
        west_bit: 8
      },
      terrain_regions: [],
      pixels_per_world_unit: 192,
      projection: "top-down",
      render_role: "streamed-reusable-tile-map",
      source_id: "generated-moonroot-reusable-tiles-20260801"
    },
    tile_index_rows: [
      [0, 5, 0],
      [10, 15, 10]
    ],
    tile_legend: {
      ".": "grass-moss-a",
      p: "earth-path-a"
    },
    tile_rows: [".p.", "..."]
  },
  placements: [
    {
      id: "sapling-one",
      object: "moon-sapling-a",
      layer: "middle",
      position: [0, 0.5],
      scale: 1,
      flip_horizontal: false,
      collision_enabled: true,
      tags: ["landmark"]
    }
  ],
  boundaries: [
    {
      id: "north-edge",
      position: [0, 0.5, -1],
      size: [3, 1, 0.1]
    }
  ],
  spawn_points: [
    {
      id: "player-start",
      position: [0, 0, 0]
    }
  ],
  critical_routes: [
    {
      id: "arrival-route",
      points: [
        [0, 0],
        [0, 0.5]
      ]
    }
  ]
};

const V6_STANDARD_SCALE_BY_OBJECT = {
  "community-tree-a": 1,
  "flower-patch-a": 1,
  "moon-bush-round-a": 1,
  "moon-sapling-a": 1,
  "moss-boulder-a": 1,
  "street-lamp-a": 1,
  "trail-sign-a": 1,
  "tree-birch-a": 1,
  "tree-maple-a": 1,
  "tree-oak-a": 1,
  "tree-pine-a": 1,
  "tree-poplar-a": 1,
  "tree-stump-a": 1,
  "tree-willow-a": 1,
  "village-well-a": 1
};

const V6_SCALE_REFERENCE = {
  id: "memory-moon-humanoid-v1",
  visual_height_world: 1.4264,
  capsule_height_world: 1.45,
  capsule_radius_world: 0.28,
  model_runtime_scale: 0.78,
  measurement_basis: "visible-silhouette-above-ground-anchor"
};

const V6_WORLD_HEIGHT_CONTRACT = {
  "community-tree-a": [4, [3.6, 4.6]],
  "flower-patch-a": [0.525, [0.45, 0.62]],
  "moon-bush-round-a": [1.2, [1, 1.4]],
  "moon-sapling-a": [3.45, [3, 3.8]],
  "moss-boulder-a": [0.98, [0.8, 1.15]],
  "street-lamp-a": [2.4, [2.15, 2.65]],
  "trail-sign-a": [1.8, [1.6, 2]],
  "tree-birch-a": [4.5, [4, 4.9]],
  "tree-maple-a": [4.2, [3.8, 4.6]],
  "tree-oak-a": [4.4, [4, 4.8]],
  "tree-pine-a": [5.1, [4.6, 5.6]],
  "tree-poplar-a": [5.2, [4.7, 5.8]],
  "tree-stump-a": [0.86, [0.75, 0.98]],
  "tree-willow-a": [4.3, [3.9, 4.8]],
  "village-well-a": [1.95, [1.75, 2.2]]
};

const V6_COLLISION_PROFILES = {
  none: { shapes: [] },
  "hero-tree-trunk": {
    shapes: [{ type: "cylinder", radius: 1.375, height: 0.525, offset: [0, 0.2625, 0] }]
  },
  "sapling-trunk": {
    shapes: [{ type: "cylinder", radius: 0.39, height: 1.105, offset: [0, 0.5525, 0] }]
  },
  "bush-footprint": {
    shapes: [{ type: "cylinder", radius: 0.456, height: 0.504, offset: [0, 0.252, 0] }]
  },
  "boulder-footprint": {
    shapes: [{ type: "box", size: [0.98, 0.7, 0.83], offset: [0, 0.35, 0] }]
  },
  "well-ring": {
    shapes: [{ type: "cylinder", radius: 0.65, height: 0.9, offset: [0, 0.45, 0] }]
  },
  "stump-footprint": {
    shapes: [{ type: "cylinder", radius: 0.378, height: 0.441, offset: [0, 0.2205, 0] }]
  },
  "lamp-post": {
    shapes: [{ type: "cylinder", radius: 0.169, height: 1.3, offset: [0, 0.65, 0] }]
  },
  "sign-post": {
    shapes: [{ type: "cylinder", radius: 0.18, height: 0.96, offset: [0, 0.48, 0] }]
  },
  "tree-trunk-broad": {
    shapes: [{ type: "cylinder", radius: 0.48, height: 1.2, offset: [0, 0.6, 0] }]
  },
  "tree-trunk-standard": {
    shapes: [{ type: "cylinder", radius: 0.38, height: 1.15, offset: [0, 0.575, 0] }]
  },
  "tree-trunk-slender": {
    shapes: [{ type: "cylinder", radius: 0.3, height: 1.25, offset: [0, 0.625, 0] }]
  }
};

const V6_OBJECT_COLLISION_CONTRACT = {
  "community-tree-a": ["hero-tree-trunk", "with-visual"],
  "flower-patch-a": ["none", "fixed"],
  "moon-bush-round-a": ["bush-footprint", "with-visual"],
  "moon-sapling-a": ["sapling-trunk", "with-visual"],
  "moss-boulder-a": ["boulder-footprint", "with-visual"],
  "street-lamp-a": ["lamp-post", "with-visual"],
  "trail-sign-a": ["sign-post", "with-visual"],
  "tree-birch-a": ["tree-trunk-standard", "with-visual"],
  "tree-maple-a": ["tree-trunk-standard", "with-visual"],
  "tree-oak-a": ["tree-trunk-broad", "with-visual"],
  "tree-pine-a": ["tree-trunk-slender", "with-visual"],
  "tree-poplar-a": ["tree-trunk-slender", "with-visual"],
  "tree-stump-a": ["stump-footprint", "with-visual"],
  "tree-willow-a": ["tree-trunk-broad", "with-visual"],
  "village-well-a": ["well-ring", "with-visual"]
};

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function assertPlainObject(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has an unexpected or missing key`);
}

function assertAllowedKeys(value, required, optional, label) {
  assertPlainObject(value, label);
  for (const key of required) {
    assert.ok(Object.hasOwn(value, key), `${label}.${key} is required`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    assert.ok(allowed.has(key), `${label}.${key} is not allowed`);
  }
}

function assertSlug(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, SLUG, `${label} must be a lowercase slug`);
}

function assertEntityId(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, ENTITY_ID, `${label} must be a stable identifier`);
}

function assertFiniteNumber(value, label, { positive = false, nonNegative = false } = {}) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  if (positive) assert.ok(value > 0, `${label} must be positive`);
  if (nonNegative) assert.ok(value >= 0, `${label} must be non-negative`);
}

function assertInteger(value, label, { positive = false, nonNegative = false } = {}) {
  assert.ok(Number.isInteger(value), `${label} must be an integer`);
  if (positive) assert.ok(value > 0, `${label} must be positive`);
  if (nonNegative) assert.ok(value >= 0, `${label} must be non-negative`);
}

function assertTuple(value, length, label, itemCheck) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.equal(value.length, length, `${label} must contain exactly ${length} values`);
  value.forEach((item, index) => itemCheck(item, `${label}[${index}]`));
}

function assertStringSet(value, label, { minimum = 0 } = {}) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length >= minimum, `${label} must contain at least ${minimum} value(s)`);
  value.forEach((item, index) => {
    assert.equal(typeof item, "string", `${label}[${index}] must be a string`);
    assert.ok(item.length > 0, `${label}[${index}] must not be empty`);
  });
  assert.equal(new Set(value).size, value.length, `${label} must not contain duplicates`);
}

function assertRotationSet(value, label) {
  assert.ok(Array.isArray(value) && value.length > 0, `${label} must not be empty`);
  assert.equal(new Set(value).size, value.length, `${label} must not contain duplicates`);
  for (const rotation of value) {
    assert.ok([0, 90, 180, 270].includes(rotation), `${label} contains unsupported rotation ${rotation}`);
  }
}

function pathSegments(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  assert.ok(!value.includes("\\"), `${label} must use forward slashes`);
  assert.ok(!value.startsWith("/"), `${label} must be relative`);
  assert.doesNotMatch(value, /^[a-z]:/i, `${label} must not use a drive letter`);
  assert.ok(!value.includes("://"), `${label} must not be a URL`);
  const segments = value.split("/");
  assert.ok(
    segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    `${label} must not escape its root`
  );
  return segments;
}

function assertSafeRelativePath(value, label) {
  pathSegments(value, label);
}

function assertSafeRuntimeTexture(value, label) {
  const segments = pathSegments(value, label);
  assert.match(value, /^[a-z0-9][a-z0-9._/-]*\.png$/, `${label} must be a lowercase PNG path`);
  for (const segment of segments.map((item) => item.toLowerCase())) {
    assert.ok(!RESERVED_RUNTIME_SEGMENTS.has(segment), `${label} uses isolated source segment ${segment}`);
  }
}

function assertFlatSceneryPngPath(value, directory, label) {
  assertSafeRuntimeTexture(value, label);
  const segments = value.split("/");
  assert.equal(segments.length, 2, `${label} must be flat under the shared ${directory} directory`);
  assert.equal(segments[0], directory, `${label} must be stored in the shared ${directory} directory`);
}

function assertUniqueIds(items, label) {
  const ids = items.map((item, index) => {
    assertPlainObject(item, `${label}[${index}]`);
    assertEntityId(item.id, `${label}[${index}].id`);
    return item.id;
  });
  assert.equal(new Set(ids).size, ids.length, `${label} ids must be unique`);
}

function assertSchemaContract(schema, expectedKeys, label) {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema_version.const, 2);
  assert.deepEqual([...schema.required].sort(), [...expectedKeys].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...expectedKeys].sort());

  const visit = (node, path) => {
    if (node === null || typeof node !== "object") return;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false, `${label} object schema ${path} must be strict`);
    }
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
      const definition = node.$ref.slice("#/$defs/".length);
      assert.ok(Object.hasOwn(schema.$defs, definition), `${label} has unresolved ref ${node.$ref}`);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "$ref") continue;
      if (Array.isArray(child)) {
        child.forEach((entry, index) => visit(entry, `${path}.${key}[${index}]`));
      } else {
        visit(child, `${path}.${key}`);
      }
    }
  };
  visit(schema, "$schema");
}

function validateCollisionProfiles(collisionProfiles) {
  assertPlainObject(collisionProfiles, "catalog.collision_profiles");
  assert.ok(Object.keys(collisionProfiles).length > 0, "catalog.collision_profiles must not be empty");
  for (const [profileId, profile] of Object.entries(collisionProfiles)) {
    assertSlug(profileId, `collision profile ${profileId}`);
    assertExactKeys(profile, ["shapes"], `collision profile ${profileId}`);
    assert.ok(Array.isArray(profile.shapes), `collision profile ${profileId}.shapes must be an array`);
    profile.shapes.forEach((shape, index) => {
      const label = `collision profile ${profileId}.shapes[${index}]`;
      assertPlainObject(shape, label);
      if (shape.type === "cylinder") {
        assertExactKeys(shape, ["type", "radius", "height", "offset"], label);
        assertFiniteNumber(shape.radius, `${label}.radius`, { positive: true });
        assertFiniteNumber(shape.height, `${label}.height`, { positive: true });
      } else if (shape.type === "box") {
        assertExactKeys(shape, ["type", "size", "offset"], label);
        assertTuple(shape.size, 3, `${label}.size`, (item, itemLabel) =>
          assertFiniteNumber(item, itemLabel, { positive: true })
        );
      } else {
        assert.fail(`${label}.type must be cylinder or box`);
      }
      assertTuple(shape.offset, 3, `${label}.offset`, assertFiniteNumber);
    });
  }
}

function validateCatalog(catalog) {
  assertExactKeys(catalog, CATALOG_KEYS, "catalog");
  assert.equal(catalog.schema_version, 2, "catalog.schema_version must be 2");
  assertSlug(catalog.catalog_id, "catalog.catalog_id");
  assertInteger(catalog.catalog_version, "catalog.catalog_version", { positive: true });
  assert.equal(typeof catalog.release_status, "string");
  assert.ok(catalog.release_status.length > 0, "catalog.release_status must not be empty");

  assertExactKeys(catalog.projection, ["id", "yaw_degrees", "elevation_degrees"], "catalog.projection");
  assertSlug(catalog.projection.id, "catalog.projection.id");
  assertFiniteNumber(catalog.projection.yaw_degrees, "catalog.projection.yaw_degrees", {
    nonNegative: true
  });
  assert.ok(catalog.projection.yaw_degrees < 360, "catalog projection yaw must be below 360 degrees");
  assertFiniteNumber(catalog.projection.elevation_degrees, "catalog.projection.elevation_degrees", {
    positive: true
  });
  assert.ok(catalog.projection.elevation_degrees < 90, "catalog projection elevation must be below 90 degrees");

  assertExactKeys(
    catalog.scale_reference,
    [
      "id",
      "visual_height_world",
      "capsule_height_world",
      "capsule_radius_world",
      "model_runtime_scale",
      "measurement_basis"
    ],
    "catalog.scale_reference"
  );
  assertSlug(catalog.scale_reference.id, "catalog.scale_reference.id");
  for (const key of [
    "visual_height_world",
    "capsule_height_world",
    "capsule_radius_world",
    "model_runtime_scale"
  ]) {
    assertFiniteNumber(catalog.scale_reference[key], `catalog.scale_reference.${key}`, { positive: true });
  }
  assert.equal(
    catalog.scale_reference.measurement_basis,
    "visible-silhouette-above-ground-anchor",
    "catalog.scale_reference.measurement_basis is invalid"
  );

  assertExactKeys(catalog.style_family, ["id", "authority_path", "palette", "rules"], "catalog.style_family");
  assertSlug(catalog.style_family.id, "catalog.style_family.id");
  assertSafeRelativePath(catalog.style_family.authority_path, "catalog.style_family.authority_path");
  assertPlainObject(catalog.style_family.palette, "catalog.style_family.palette");
  assert.ok(Object.keys(catalog.style_family.palette).length > 0, "catalog style palette must not be empty");
  for (const [name, color] of Object.entries(catalog.style_family.palette)) {
    assert.match(name, MACHINE_KEY, `catalog palette key ${name} must be a machine key`);
    assert.match(color, HEX_COLOR, `catalog palette ${name} must be a six-digit hex color`);
  }
  assertStringSet(catalog.style_family.rules, "catalog.style_family.rules", { minimum: 1 });

  assertExactKeys(catalog.floor_atlas, ["texture", "size_px", "gutter_px", "tiles"], "catalog.floor_atlas");
  assertFlatSceneryPngPath(catalog.floor_atlas.texture, "sources", "catalog.floor_atlas.texture");
  assert.equal(
    catalog.floor_atlas.texture,
    "sources/floor-atlas.derived.png",
    "catalog.floor_atlas.texture must identify the canonical non-runtime floor atlas"
  );
  assertTuple(catalog.floor_atlas.size_px, 2, "catalog.floor_atlas.size_px", (item, label) =>
    assertInteger(item, label, { positive: true })
  );
  assertInteger(catalog.floor_atlas.gutter_px, "catalog.floor_atlas.gutter_px", { nonNegative: true });
  assertPlainObject(catalog.floor_atlas.tiles, "catalog.floor_atlas.tiles");
  assert.ok(Object.keys(catalog.floor_atlas.tiles).length > 0, "catalog floor tiles must not be empty");

  const atlasRects = [];
  for (const [tileId, tile] of Object.entries(catalog.floor_atlas.tiles)) {
    const label = `catalog.floor_atlas.tiles.${tileId}`;
    assertSlug(tileId, `floor tile ${tileId}`);
    assertExactKeys(
      tile,
      [
        "kind",
        "tags",
        "uv_rect_px",
        "grid_size",
        "walkable",
        "edges",
        "allowed_rotations_degrees",
        "seam_contract"
      ],
      label
    );
    assertSlug(tile.kind, `${label}.kind`);
    assertStringSet(tile.tags, `${label}.tags`);
    assertTuple(tile.uv_rect_px, 4, `${label}.uv_rect_px`, (item, itemLabel) =>
      assertInteger(item, itemLabel, { nonNegative: true })
    );
    const [x, y, width, height] = tile.uv_rect_px;
    assert.ok(width > 0 && height > 0, `${label}.uv_rect_px width and height must be positive`);
    assert.ok(x + width <= catalog.floor_atlas.size_px[0], `${label} exceeds atlas width`);
    assert.ok(y + height <= catalog.floor_atlas.size_px[1], `${label} exceeds atlas height`);
    assertTuple(tile.grid_size, 2, `${label}.grid_size`, (item, itemLabel) =>
      assertInteger(item, itemLabel, { positive: true })
    );
    assert.equal(typeof tile.walkable, "boolean", `${label}.walkable must be boolean`);
    assertExactKeys(tile.edges, ["north", "east", "south", "west"], `${label}.edges`);
    for (const direction of ["north", "east", "south", "west"]) {
      assertSlug(tile.edges[direction], `${label}.edges.${direction}`);
    }
    assertRotationSet(tile.allowed_rotations_degrees, `${label}.allowed_rotations_degrees`);
    assert.equal(typeof tile.seam_contract, "string", `${label}.seam_contract must be a string`);
    assert.ok(tile.seam_contract.length > 0, `${label}.seam_contract must not be empty`);
    atlasRects.push({ tileId, x, y, width, height });
  }
  for (let first = 0; first < atlasRects.length; first += 1) {
    for (let second = first + 1; second < atlasRects.length; second += 1) {
      const a = atlasRects[first];
      const b = atlasRects[second];
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      assert.ok(!overlaps, `floor tile atlas rectangles ${a.tileId} and ${b.tileId} overlap`);
    }
  }

  validateCollisionProfiles(catalog.collision_profiles);

  assertPlainObject(catalog.objects, "catalog.objects");
  assert.ok(Object.keys(catalog.objects).length > 0, "catalog.objects must not be empty");
  for (const [objectId, object] of Object.entries(catalog.objects)) {
    const label = `catalog.objects.${objectId}`;
    assertSlug(objectId, `catalog object ${objectId}`);
    assertExactKeys(
      object,
      [
        "texture",
        "image_size_px",
        "anchor_px",
        "kind",
        "tags",
        "source_id",
        "default_world_height",
        "allowed_world_height",
        "collision_profile",
        "collision_scale_mode",
        "occlusion",
        "reuse"
      ],
      label
    );
    assertFlatSceneryPngPath(object.texture, "images", `${label}.texture`);
    assertTuple(object.image_size_px, 2, `${label}.image_size_px`, (item, itemLabel) =>
      assertInteger(item, itemLabel, { positive: true })
    );
    assertTuple(object.anchor_px, 2, `${label}.anchor_px`, (item, itemLabel) =>
      assertFiniteNumber(item, itemLabel, { nonNegative: true })
    );
    assert.ok(object.anchor_px[0] <= object.image_size_px[0], `${label}.anchor_px exceeds image width`);
    assert.ok(object.anchor_px[1] <= object.image_size_px[1], `${label}.anchor_px exceeds image height`);
    assertSlug(object.kind, `${label}.kind`);
    assertStringSet(object.tags, `${label}.tags`);
    assertSlug(object.source_id, `${label}.source_id`);
    assertFiniteNumber(object.default_world_height, `${label}.default_world_height`, { positive: true });
    assertTuple(object.allowed_world_height, 2, `${label}.allowed_world_height`, (item, itemLabel) =>
      assertFiniteNumber(item, itemLabel, { positive: true })
    );
    const [minimumHeight, maximumHeight] = object.allowed_world_height;
    assert.ok(minimumHeight <= maximumHeight, `${label}.allowed_world_height must be ascending`);
    assert.ok(
      object.default_world_height >= minimumHeight && object.default_world_height <= maximumHeight,
      `${label}.default_world_height must fall inside allowed_world_height`
    );
    assertSlug(object.collision_profile, `${label}.collision_profile`);
    assert.ok(
      Object.hasOwn(catalog.collision_profiles, object.collision_profile),
      `${label}.collision_profile references an unknown profile`
    );
    assert.ok(
      ["fixed", "with-visual"].includes(object.collision_scale_mode),
      `${label}.collision_scale_mode must be fixed or with-visual`
    );
    assertExactKeys(object.occlusion, ["mode"], `${label}.occlusion`);
    assert.equal(object.occlusion.mode, "depth", `${label}.occlusion.mode must be depth`);
    assertExactKeys(
      object.reuse,
      [
        "single_object",
        "allow_horizontal_flip",
        "allowed_rotations_degrees",
        "minimum_repeat_distance",
        "maximum_placements_per_layout"
      ],
      `${label}.reuse`
    );
    assert.equal(object.reuse.single_object, true, `${label}.reuse.single_object must be true`);
    assert.equal(typeof object.reuse.allow_horizontal_flip, "boolean");
    assertRotationSet(object.reuse.allowed_rotations_degrees, `${label}.reuse.allowed_rotations_degrees`);
    assertFiniteNumber(object.reuse.minimum_repeat_distance, `${label}.reuse.minimum_repeat_distance`, {
      nonNegative: true
    });
    assertInteger(object.reuse.maximum_placements_per_layout, `${label}.reuse.maximum_placements_per_layout`, {
      positive: true
    });
  }
}

function validateGroundPlate(groundPlate, terrain) {
  assertExactKeys(
    groundPlate,
    [
      "texture",
      "image_size_px",
      "world_size",
      "pixels_per_world_unit",
      "projection",
      "render_role",
      "source_id"
    ],
    "layout.terrain.ground_plate"
  );
  assertFlatSceneryPngPath(groundPlate.texture, "images", "layout.terrain.ground_plate.texture");
  assertTuple(groundPlate.image_size_px, 2, "layout.terrain.ground_plate.image_size_px", (item, label) =>
    assertInteger(item, label, { positive: true })
  );
  assertTuple(groundPlate.world_size, 2, "layout.terrain.ground_plate.world_size", (item, label) =>
    assertFiniteNumber(item, label, { positive: true })
  );
  assertFiniteNumber(groundPlate.pixels_per_world_unit, "layout.terrain.ground_plate.pixels_per_world_unit", {
    positive: true
  });
  assert.equal(groundPlate.projection, "top-down");
  assert.equal(groundPlate.render_role, "authored-map-plate");
  assertSlug(groundPlate.source_id, "layout.terrain.ground_plate.source_id");
  const [groundWidth, groundHeight] = groundPlate.image_size_px;
  const [groundWorldWidth, groundWorldHeight] = groundPlate.world_size;
  assert.equal(
    groundWidth / groundWorldWidth,
    groundPlate.pixels_per_world_unit,
    "ground plate horizontal texel density must match its declaration"
  );
  assert.equal(
    groundHeight / groundWorldHeight,
    groundPlate.pixels_per_world_unit,
    "ground plate vertical texel density must match its declaration"
  );
  assert.ok(
    Math.abs(groundWorldWidth - terrain.columns * terrain.cell_size) < 0.001 &&
      Math.abs(groundWorldHeight - terrain.rows * terrain.cell_size) < 0.001,
    "ground plate world size must match the logical grid extent"
  );
}

function validateRenderTiles(renderTiles, tileIndexRows, terrain) {
  assertExactKeys(
    renderTiles,
    [
      "texture",
      "image_size_px",
      "tile_size_px",
      "tile_content_size_px",
      "tile_gutter_px",
      "atlas_grid",
      "world_tile_size",
      "chunk_size_tiles",
      "stream_radius_chunks",
      "padding_tiles",
      "padding_tile_index",
      "tile_ids",
      "path_connectivity",
      "terrain_regions",
      "pixels_per_world_unit",
      "projection",
      "render_role",
      "source_id"
    ],
    "layout.terrain.render_tiles"
  );
  assertFlatSceneryPngPath(renderTiles.texture, "images", "layout.terrain.render_tiles.texture");
  for (const key of ["image_size_px", "tile_size_px", "tile_content_size_px", "atlas_grid"]) {
    assertTuple(renderTiles[key], 2, `layout.terrain.render_tiles.${key}`, (item, label) =>
      assertInteger(item, label, { positive: true })
    );
  }
  assertInteger(renderTiles.tile_gutter_px, "layout.terrain.render_tiles.tile_gutter_px", { nonNegative: true });
  assertFiniteNumber(renderTiles.world_tile_size, "layout.terrain.render_tiles.world_tile_size", { positive: true });
  assertInteger(renderTiles.chunk_size_tiles, "layout.terrain.render_tiles.chunk_size_tiles", { positive: true });
  assertInteger(renderTiles.stream_radius_chunks, "layout.terrain.render_tiles.stream_radius_chunks", { positive: true });
  assertInteger(renderTiles.padding_tiles, "layout.terrain.render_tiles.padding_tiles", { nonNegative: true });
  assertFiniteNumber(renderTiles.pixels_per_world_unit, "layout.terrain.render_tiles.pixels_per_world_unit", {
    positive: true
  });
  assert.equal(renderTiles.projection, "top-down");
  assert.equal(renderTiles.render_role, "streamed-reusable-tile-map");
  assertSlug(renderTiles.source_id, "layout.terrain.render_tiles.source_id");

  const [imageWidth, imageHeight] = renderTiles.image_size_px;
  const [tileWidth, tileHeight] = renderTiles.tile_size_px;
  const [contentWidth, contentHeight] = renderTiles.tile_content_size_px;
  const [atlasColumns, atlasRows] = renderTiles.atlas_grid;
  const atlasCapacity = atlasColumns * atlasRows;
  assert.equal(imageWidth, tileWidth * atlasColumns, "render tile atlas width must equal tile width times atlas columns");
  assert.equal(imageHeight, tileHeight * atlasRows, "render tile atlas height must equal tile height times atlas rows");
  assert.equal(
    tileWidth,
    contentWidth + renderTiles.tile_gutter_px * 2,
    "render tile cell width must equal content width plus two gutters"
  );
  assert.equal(
    tileHeight,
    contentHeight + renderTiles.tile_gutter_px * 2,
    "render tile cell height must equal content height plus two gutters"
  );
  assert.equal(
    contentWidth / renderTiles.world_tile_size,
    renderTiles.pixels_per_world_unit,
    "render tiles horizontal texel density must match its declaration"
  );
  assert.equal(
    contentHeight / renderTiles.world_tile_size,
    renderTiles.pixels_per_world_unit,
    "render tiles vertical texel density must match its declaration"
  );

  assertInteger(renderTiles.padding_tile_index, "layout.terrain.render_tiles.padding_tile_index", {
    nonNegative: true
  });
  assert.ok(renderTiles.padding_tile_index < atlasCapacity, "padding_tile_index exceeds the atlas");
  assert.ok(Array.isArray(renderTiles.tile_ids), "layout.terrain.render_tiles.tile_ids must be an array");
  assert.equal(renderTiles.tile_ids.length, atlasCapacity, "tile_ids must contain one id per atlas cell");
  assert.equal(new Set(renderTiles.tile_ids).size, atlasCapacity, "tile_ids must be unique");
  renderTiles.tile_ids.forEach((tileId, index) => assertSlug(tileId, `layout.terrain.render_tiles.tile_ids[${index}]`));

  assertExactKeys(
    renderTiles.path_connectivity,
    ["first_index", "north_bit", "east_bit", "south_bit", "west_bit"],
    "layout.terrain.render_tiles.path_connectivity"
  );
  const connectivity = renderTiles.path_connectivity;
  assertInteger(connectivity.first_index, "layout.terrain.render_tiles.path_connectivity.first_index", {
    nonNegative: true
  });
  assert.equal(connectivity.north_bit, 1);
  assert.equal(connectivity.east_bit, 2);
  assert.equal(connectivity.south_bit, 4);
  assert.equal(connectivity.west_bit, 8);
  assert.ok(connectivity.first_index + 15 < atlasCapacity, "path_connectivity must reserve 16 atlas cells");

  assert.ok(Array.isArray(renderTiles.terrain_regions), "layout.terrain.render_tiles.terrain_regions must be an array");
  const terrainRegionIds = new Set();
  const terrainRegionFirstIndices = [];
  const terrainRegionFullVariantIndices = new Set();
  const rangesOverlap = (firstIndex, otherFirstIndex) =>
    firstIndex <= otherFirstIndex + 15 && otherFirstIndex <= firstIndex + 15;
  renderTiles.terrain_regions.forEach((region, regionIndex) => {
    const context = `layout.terrain.render_tiles.terrain_regions[${regionIndex}]`;
    assertAllowedKeys(
      region,
      ["id", "first_index", "northwest_bit", "northeast_bit", "southeast_bit", "southwest_bit"],
      ["full_variant_indices"],
      context
    );
    assertSlug(region.id, `${context}.id`);
    assert.ok(!terrainRegionIds.has(region.id), "terrain_regions ids must be unique");
    terrainRegionIds.add(region.id);
    assertInteger(region.first_index, `${context}.first_index`, { nonNegative: true });
    assert.equal(region.northwest_bit, 1);
    assert.equal(region.northeast_bit, 2);
    assert.equal(region.southeast_bit, 4);
    assert.equal(region.southwest_bit, 8);
    assert.ok(region.first_index + 15 < atlasCapacity, `${context} must reserve 16 atlas cells`);
    assert.ok(
      !rangesOverlap(region.first_index, connectivity.first_index),
      `${context} must not overlap path_connectivity`
    );
    for (const occupiedFirstIndex of terrainRegionFirstIndices) {
      assert.ok(!rangesOverlap(region.first_index, occupiedFirstIndex), `${context} must not overlap another terrain region`);
    }
    terrainRegionFirstIndices.push(region.first_index);
    if (region.full_variant_indices !== undefined) {
      assert.ok(Array.isArray(region.full_variant_indices), `${context}.full_variant_indices must be an array`);
      assert.ok(region.full_variant_indices.length > 0, `${context}.full_variant_indices must not be empty`);
      for (const [variantIndex, atlasIndex] of region.full_variant_indices.entries()) {
        assertInteger(atlasIndex, `${context}.full_variant_indices[${variantIndex}]`, { nonNegative: true });
        assert.ok(atlasIndex < atlasCapacity, `${context}.full_variant_indices[${variantIndex}] exceeds the atlas`);
        assert.ok(
          !terrainRegionFullVariantIndices.has(atlasIndex),
          "terrain_regions full_variant_indices must be unique"
        );
        terrainRegionFullVariantIndices.add(atlasIndex);
      }
    }
  });
  for (const atlasIndex of terrainRegionFullVariantIndices) {
    assert.ok(
      atlasIndex < connectivity.first_index || atlasIndex > connectivity.first_index + 15,
      "terrain_regions full_variant_indices must not overlap path_connectivity"
    );
    for (const occupiedFirstIndex of terrainRegionFirstIndices) {
      assert.ok(
        atlasIndex < occupiedFirstIndex || atlasIndex > occupiedFirstIndex + 15,
        "terrain_regions full_variant_indices must not overlap a terrain region"
      );
    }
  }

  assert.ok(Array.isArray(tileIndexRows), "layout.terrain.tile_index_rows must be an array");
  assert.ok(tileIndexRows.length > 0, "layout.terrain.tile_index_rows must not be empty");
  let mapColumns = null;
  tileIndexRows.forEach((row, rowIndex) => {
    assert.ok(Array.isArray(row), `layout.terrain.tile_index_rows[${rowIndex}] must be an array`);
    assert.ok(row.length > 0, `layout.terrain.tile_index_rows[${rowIndex}] must not be empty`);
    mapColumns ??= row.length;
    assert.equal(row.length, mapColumns, "tile_index_rows rows must all have the same length");
    row.forEach((tileIndex, columnIndex) => {
      assertInteger(tileIndex, `tile_index_rows[${rowIndex}][${columnIndex}]`, { nonNegative: true });
      assert.ok(tileIndex < atlasCapacity, `tile_index_rows[${rowIndex}][${columnIndex}] exceeds the atlas`);
    });
  });
  assert.ok(
    Math.abs(mapColumns * renderTiles.world_tile_size - terrain.columns * terrain.cell_size) < 0.001 &&
      Math.abs(tileIndexRows.length * renderTiles.world_tile_size - terrain.rows * terrain.cell_size) < 0.001,
    "render tile world extent must match the navigation grid extent"
  );
}

function validateLayout(layout, catalog) {
  assertExactKeys(layout, LAYOUT_KEYS, "layout");
  assert.equal(layout.schema_version, 2, "layout.schema_version must be 2");
  assertSlug(layout.layout_id, "layout.layout_id");
  assertSlug(layout.catalog_id, "layout.catalog_id");
  assertInteger(layout.catalog_version, "layout.catalog_version", { positive: true });
  assertSlug(layout.projection_id, "layout.projection_id");
  assert.equal(layout.catalog_id, catalog.catalog_id, "layout catalog id must match the catalog");
  assert.equal(layout.catalog_version, catalog.catalog_version, "layout catalog version must match the catalog");
  assert.equal(layout.projection_id, catalog.projection.id, "layout projection id must match the catalog");

  assertPlainObject(layout.terrain, "layout.terrain");
  const hasGroundPlate = Object.hasOwn(layout.terrain, "ground_plate");
  const hasRenderTiles = Object.hasOwn(layout.terrain, "render_tiles");
  const hasTileIndexRows = Object.hasOwn(layout.terrain, "tile_index_rows");
  assert.equal(Number(hasGroundPlate) + Number(hasRenderTiles), 1, "layout terrain must select exactly one render contract");
  assert.equal(hasRenderTiles, hasTileIndexRows, "render_tiles and tile_index_rows must be declared together");
  assertExactKeys(
    layout.terrain,
    hasGroundPlate
      ? ["columns", "rows", "cell_size", "ground_plate", "tile_legend", "tile_rows"]
      : ["columns", "rows", "cell_size", "render_tiles", "tile_index_rows", "tile_legend", "tile_rows"],
    "layout.terrain"
  );
  assertInteger(layout.terrain.columns, "layout.terrain.columns", { positive: true });
  assertInteger(layout.terrain.rows, "layout.terrain.rows", { positive: true });
  assertFiniteNumber(layout.terrain.cell_size, "layout.terrain.cell_size", { positive: true });
  if (hasGroundPlate) validateGroundPlate(layout.terrain.ground_plate, layout.terrain);
  else validateRenderTiles(layout.terrain.render_tiles, layout.terrain.tile_index_rows, layout.terrain);
  assertPlainObject(layout.terrain.tile_legend, "layout.terrain.tile_legend");
  assert.ok(Object.keys(layout.terrain.tile_legend).length > 0, "layout tile legend must not be empty");
  for (const [symbol, tileId] of Object.entries(layout.terrain.tile_legend)) {
    assert.equal(Array.from(symbol).length, 1, `layout tile legend symbol ${symbol} must be exactly one character`);
    assertSlug(tileId, `layout tile legend ${symbol}`);
    assert.ok(Object.hasOwn(catalog.floor_atlas.tiles, tileId), `layout tile legend ${symbol} references unknown tile ${tileId}`);
  }
  assert.ok(Array.isArray(layout.terrain.tile_rows), "layout.terrain.tile_rows must be an array");
  assert.equal(layout.terrain.tile_rows.length, layout.terrain.rows, "layout tile row count must equal terrain.rows");
  layout.terrain.tile_rows.forEach((row, rowIndex) => {
    assert.equal(typeof row, "string", `layout tile row ${rowIndex} must be a string`);
    const symbols = Array.from(row);
    assert.equal(symbols.length, layout.terrain.columns, `layout tile row ${rowIndex} must have exactly terrain.columns symbols`);
    for (const symbol of symbols) {
      assert.ok(Object.hasOwn(layout.terrain.tile_legend, symbol), `layout tile row ${rowIndex} uses unresolved symbol ${symbol}`);
    }
  });

  for (const collection of ["placements", "boundaries", "spawn_points", "critical_routes"]) {
    assert.ok(Array.isArray(layout[collection]), `layout.${collection} must be an array`);
    assertUniqueIds(layout[collection], `layout.${collection}`);
  }
  assert.ok(layout.spawn_points.length > 0, "layout.spawn_points must not be empty");

  const placementsByObject = new Map();
  layout.placements.forEach((placement, index) => {
    const label = `layout.placements[${index}]`;
    assertExactKeys(
      placement,
      ["id", "object", "layer", "position", "scale", "flip_horizontal", "collision_enabled", "tags"],
      label
    );
    assertSlug(placement.object, `${label}.object`);
    assert.ok(Object.hasOwn(catalog.objects, placement.object), `${label}.object references unknown catalog object`);
    assert.ok(["back", "middle", "front"].includes(placement.layer), `${label}.layer is invalid`);
    assertTuple(placement.position, 2, `${label}.position`, assertFiniteNumber);
    assertFiniteNumber(placement.scale, `${label}.scale`, { positive: true });
    assert.equal(typeof placement.flip_horizontal, "boolean", `${label}.flip_horizontal must be boolean`);
    assert.equal(typeof placement.collision_enabled, "boolean", `${label}.collision_enabled must be boolean`);
    assertStringSet(placement.tags, `${label}.tags`);

    const object = catalog.objects[placement.object];
    const worldHeight = object.default_world_height * placement.scale;
    assert.ok(
      worldHeight >= object.allowed_world_height[0] && worldHeight <= object.allowed_world_height[1],
      `${label}.scale places the object outside allowed_world_height`
    );
    assert.ok(
      !placement.flip_horizontal || object.reuse.allow_horizontal_flip,
      `${label}.flip_horizontal violates the object reuse contract`
    );
    if (placement.collision_enabled) {
      assert.ok(
        catalog.collision_profiles[object.collision_profile].shapes.length > 0,
        `${label}.collision_enabled requires a non-empty collision profile`
      );
    }
    const matches = placementsByObject.get(placement.object) ?? [];
    matches.push(placement);
    placementsByObject.set(placement.object, matches);
  });

  for (const [objectId, placements] of placementsByObject) {
    const reuse = catalog.objects[objectId].reuse;
    assert.ok(
      placements.length <= reuse.maximum_placements_per_layout,
      `layout exceeds ${objectId} maximum_placements_per_layout`
    );
  }

  layout.boundaries.forEach((boundary, index) => {
    const label = `layout.boundaries[${index}]`;
    assertExactKeys(boundary, ["id", "position", "size"], label);
    assertTuple(boundary.position, 3, `${label}.position`, assertFiniteNumber);
    assertTuple(boundary.size, 3, `${label}.size`, (item, itemLabel) =>
      assertFiniteNumber(item, itemLabel, { positive: true })
    );
  });
  layout.spawn_points.forEach((spawnPoint, index) => {
    const label = `layout.spawn_points[${index}]`;
    assertExactKeys(spawnPoint, ["id", "position"], label);
    assertTuple(spawnPoint.position, 3, `${label}.position`, assertFiniteNumber);
  });
  layout.critical_routes.forEach((route, index) => {
    const label = `layout.critical_routes[${index}]`;
    assertExactKeys(route, ["id", "points"], label);
    assert.ok(Array.isArray(route.points) && route.points.length >= 2, `${label}.points must contain at least two points`);
    route.points.forEach((point, pointIndex) =>
      assertTuple(point, 2, `${label}.points[${pointIndex}]`, assertFiniteNumber)
    );
  });
}

function validateV6ScaleAndCollisionContract(catalog, layout) {
  assert.deepEqual(catalog.scale_reference, V6_SCALE_REFERENCE, "v6 humanoid scale reference changed");
  assert.deepEqual(catalog.collision_profiles, V6_COLLISION_PROFILES, "v6 collision footprints changed");
  assertExactKeys(catalog.objects, Object.keys(V6_OBJECT_COLLISION_CONTRACT), "v6 catalog objects");
  for (const [objectId, [profileId, scaleMode]] of Object.entries(V6_OBJECT_COLLISION_CONTRACT)) {
    const object = catalog.objects[objectId];
    assert.equal(object.collision_profile, profileId, `${objectId} collision profile changed`);
    assert.equal(object.collision_scale_mode, scaleMode, `${objectId} collision scale mode changed`);
    assert.deepEqual(
      [object.default_world_height, object.allowed_world_height],
      V6_WORLD_HEIGHT_CONTRACT[objectId],
      `${objectId} humanoid-relative world-height contract changed`
    );
  }
  for (const placement of layout.placements) {
    assert.ok(Object.hasOwn(V6_STANDARD_SCALE_BY_OBJECT, placement.object), `${placement.id} has no standardized scale`);
    assert.equal(
      placement.scale,
      V6_STANDARD_SCALE_BY_OBJECT[placement.object],
      `${placement.id} must use the standardized ${placement.object} scale`
    );
    const shouldCollide = catalog.objects[placement.object].collision_profile !== "none";
    assert.equal(placement.collision_enabled, shouldCollide, `${placement.id} collision flag disagrees with its footprint`);
  }
}

function pngDimensions(bytes, label) {
  assert.ok(bytes.length >= 24, `${label} is too short to be a PNG`);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${label} must be a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function validateArtifactBytes(artifact, rootUrl, expectedSize) {
  const bytes = await readFile(new URL(artifact.file, rootUrl));
  assert.equal(bytes.byteLength, artifact.byte_length, `manifest artifact ${artifact.id} byte_length mismatch`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    artifact.sha256,
    `manifest artifact ${artifact.id} sha256 mismatch`
  );
  assert.deepEqual(pngDimensions(bytes, `manifest artifact ${artifact.id}`), expectedSize);
}

async function validateStyleManifest(manifest, catalog) {
  assertAllowedKeys(
    manifest,
    [
      "schema_version",
      "catalog_id",
      "catalog_version",
      "release_status",
      "style_authority",
      "build_pipeline",
      "sources",
      "artifacts"
    ],
    ["auxiliary_files"],
    "style manifest"
  );
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.catalog_id, catalog.catalog_id, "style manifest catalog id mismatch");
  assert.equal(manifest.catalog_version, catalog.catalog_version, "style manifest catalog version mismatch");
  assert.equal(manifest.release_status, catalog.release_status, "style manifest release status mismatch");
  assert.ok(manifest.style_authority !== null, "style manifest style_authority is required");
  assertPlainObject(manifest.build_pipeline, "style manifest build_pipeline");
  assert.ok(Array.isArray(manifest.sources), "style manifest sources must be an array");
  assert.ok(Array.isArray(manifest.artifacts), "style manifest artifacts must be an array");
  if (manifest.auxiliary_files !== undefined) {
    assertStringSet(manifest.auxiliary_files, "style manifest auxiliary_files");
    for (const [index, file] of manifest.auxiliary_files.entries()) {
      assertSafeRelativePath(file, `style manifest auxiliary_files[${index}]`);
    }
  }

  const sourceRequired = ["id", "kind", "source_file", "source_sha256", "rights_status", "description"];
  const sourceOptional = [
    "authoritative_path",
    "authoritative_sha256",
    "reference_paths",
    "generator",
    "generated_on",
    "prompt_summary",
    "transform"
  ];
  assertUniqueIds(manifest.sources, "style manifest sources");
  const sourceIds = new Set();
  for (const [index, source] of manifest.sources.entries()) {
    const label = `style manifest sources[${index}]`;
    assertAllowedKeys(source, sourceRequired, sourceOptional, label);
    sourceIds.add(source.id);
    assert.ok(["copied", "generated", "derived"].includes(source.kind), `${label}.kind is invalid`);
    assertSafeRelativePath(source.source_file, `${label}.source_file`);
    assert.match(source.source_sha256, SHA256, `${label}.source_sha256 must be lowercase SHA256`);
    assert.equal(typeof source.rights_status, "string", `${label}.rights_status must be a string`);
    assert.ok(source.rights_status.length > 0, `${label}.rights_status must not be empty`);
    assert.equal(typeof source.description, "string", `${label}.description must be a string`);
    assert.ok(source.description.length > 0, `${label}.description must not be empty`);
    if (source.authoritative_path !== undefined) {
      assert.equal(typeof source.authoritative_path, "string", `${label}.authoritative_path must be a string`);
    }
    if (source.authoritative_sha256 !== undefined) {
      assert.match(source.authoritative_sha256, SHA256, `${label}.authoritative_sha256 must be lowercase SHA256`);
    }
    if (source.reference_paths !== undefined) {
      assertStringSet(source.reference_paths, `${label}.reference_paths`);
    }
    const sourceUrl = new URL(source.source_file, source.source_file.startsWith("apps/") ? repoRoot : sceneryRoot);
    assert.ok(existsSync(sourceUrl), `${label}.source_file must exist`);
    const sourceBytes = await readFile(sourceUrl);
    assert.equal(
      createHash("sha256").update(sourceBytes).digest("hex"),
      source.source_sha256,
      `${label}.source_sha256 mismatch`
    );
  }

  assertUniqueIds(manifest.artifacts, "style manifest artifacts");
  const artifactFiles = new Set();
  const runtimeArtifacts = new Map();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const label = `style manifest artifacts[${index}]`;
    assertExactKeys(
      artifact,
      ["id", "kind", "file", "source_id", "width", "height", "sha256", "byte_length", "runtime_used"],
      label
    );
    assertSlug(artifact.id, `${label}.id`);
    assertSlug(artifact.kind, `${label}.kind`);
    assertSafeRelativePath(artifact.file, `${label}.file`);
    assert.ok(!artifactFiles.has(artifact.file), `${label}.file must be unique`);
    artifactFiles.add(artifact.file);
    assert.ok(sourceIds.has(artifact.source_id), `${label}.source_id references an unknown source`);
    assertInteger(artifact.width, `${label}.width`, { positive: true });
    assertInteger(artifact.height, `${label}.height`, { positive: true });
    assert.match(artifact.sha256, SHA256, `${label}.sha256 must be lowercase SHA256`);
    assertInteger(artifact.byte_length, `${label}.byte_length`, { positive: true });
    assert.equal(typeof artifact.runtime_used, "boolean", `${label}.runtime_used must be boolean`);
    if (artifact.runtime_used) {
      assertFlatSceneryPngPath(artifact.file, "images", `${label}.file`);
      runtimeArtifacts.set(artifact.file, artifact);
    } else {
      assertFlatSceneryPngPath(artifact.file, "sources", `${label}.file`);
    }
  }

  const floorArtifact = manifest.artifacts.find((artifact) => artifact.file === catalog.floor_atlas.texture);
  assert.ok(floorArtifact, "style manifest must include the catalog floor atlas as a derived artifact");
  assert.equal(floorArtifact.id, "floor-atlas", "style manifest floor atlas id mismatch");
  assert.equal(floorArtifact.runtime_used, false, "catalog floor atlas must remain a non-runtime source artifact");
  assert.deepEqual(
    [floorArtifact.width, floorArtifact.height],
    catalog.floor_atlas.size_px,
    "style manifest floor atlas dimensions mismatch"
  );
  await validateArtifactBytes(floorArtifact, sceneryRoot, catalog.floor_atlas.size_px);

  const expectedRuntime = new Map([
    ...Object.entries(catalog.objects).map(([id, object]) => [
      object.texture,
      { id, size: object.image_size_px, sourceId: object.source_id }
    ])
  ]);
  assert.deepEqual(
    [...runtimeArtifacts.keys()].sort(),
    [...expectedRuntime.keys()].sort(),
    "style manifest runtime artifacts must exactly match catalog textures"
  );
  for (const [file, expectation] of expectedRuntime) {
    const artifact = runtimeArtifacts.get(file);
    assert.equal(artifact.id, expectation.id, `manifest artifact id mismatch for ${file}`);
    assert.deepEqual([artifact.width, artifact.height], expectation.size, `manifest dimensions mismatch for ${file}`);
    if (expectation.sourceId !== null) {
      assert.equal(artifact.source_id, expectation.sourceId, `manifest source id mismatch for ${file}`);
    }
    await validateArtifactBytes(artifact, sceneryRoot, expectation.size);
  }
}

function parseSha256Sums(text) {
  const sums = new Map();
  for (const [index, line] of text.trim().split(/\r?\n/).entries()) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match, `checksum line ${index + 1} is malformed`);
    assert.ok(!sums.has(match[2]), `checksum inventory repeats ${match[2]}`);
    sums.set(match[2], match[1]);
  }
  return sums;
}

async function validateSha256Sums(catalog, manifest) {
  if (!existsSync(styleSumsUrl)) return;
  const sums = parseSha256Sums(await readFile(styleSumsUrl, "utf8"));
  const runtimeFiles = Object.values(catalog.objects).map((object) => object.texture);
  const artifactByFile = new Map(manifest.artifacts.map((artifact) => [artifact.file, artifact]));
  for (const file of runtimeFiles) {
    assert.ok(sums.has(file), `checksum inventory is missing runtime file ${file}`);
    assert.equal(sums.get(file), artifactByFile.get(file).sha256, `checksum inventory disagrees with manifest for ${file}`);
  }
  for (const [file, expectedHash] of sums) {
    const directory = file.startsWith("images/") ? "images" : "sources";
    assertFlatSceneryPngPath(file, directory, `checksum path ${file}`);
    const bytes = await readFile(new URL(file, sceneryRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, `checksum mismatch for ${file}`);
  }
}

async function validateLayoutManifest(manifest, catalog, layout, catalogBytes, layoutBytes) {
  assertExactKeys(
    manifest,
    [
      "schema_version",
      "layout_id",
      "release_status",
      "catalog_id",
      "catalog_version",
      "catalog_file",
      "catalog_sha256",
      "catalog_byte_length",
      "layout_file",
      "layout_sha256",
      "layout_byte_length",
      "source_materials",
      "terrain_tileset",
      "derived_counts",
      "asset_placement_counts"
    ],
    "layout manifest"
  );
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.layout_id, layout.layout_id);
  assert.equal(manifest.catalog_id, catalog.catalog_id);
  assert.equal(manifest.catalog_version, catalog.catalog_version);
  assert.equal(manifest.release_status, "local-preview-only");
  assert.equal(manifest.catalog_file, "metadata/catalog.json");
  assert.equal(manifest.layout_file, "metadata/world.json");
  assert.match(manifest.catalog_sha256, SHA256);
  assert.match(manifest.layout_sha256, SHA256);
  assert.equal(
    manifest.catalog_sha256,
    createHash("sha256").update(catalogBytes).digest("hex"),
    "layout manifest catalog hash mismatch"
  );
  assert.equal(
    manifest.layout_sha256,
    createHash("sha256").update(layoutBytes).digest("hex"),
    "layout manifest layout hash mismatch"
  );
  assert.equal(manifest.catalog_byte_length, catalogBytes.byteLength, "layout manifest catalog byte length mismatch");
  assert.equal(manifest.layout_byte_length, layoutBytes.byteLength, "layout manifest layout byte length mismatch");

  assert.ok(Array.isArray(manifest.source_materials), "layout manifest source_materials must be an array");
  assert.equal(manifest.source_materials.length, 2, "layout manifest must lock the grass and earth source materials");
  const sourceRoles = new Set();
  for (const [index, source] of manifest.source_materials.entries()) {
    assertExactKeys(
      source,
      ["file", "source_id", "role", "width", "height", "sha256", "byte_length"],
      `layout manifest source_materials[${index}]`
    );
    assertFlatSceneryPngPath(source.file, "sources", `layout manifest source_materials[${index}].file`);
    assertSlug(source.source_id, `layout manifest source_materials[${index}].source_id`);
    assert.ok(["grass", "earth"].includes(source.role), `layout manifest source_materials[${index}].role is invalid`);
    assert.ok(!sourceRoles.has(source.role), `layout manifest source material role '${source.role}' is duplicated`);
    sourceRoles.add(source.role);
    assertInteger(source.width, `layout manifest source_materials[${index}].width`, { positive: true });
    assertInteger(source.height, `layout manifest source_materials[${index}].height`, { positive: true });
    assert.match(source.sha256, SHA256);
    assertInteger(source.byte_length, `layout manifest source_materials[${index}].byte_length`, { positive: true });
    const sourceBytes = await readFile(new URL(source.file, sceneryRoot));
    assert.equal(sourceBytes.byteLength, source.byte_length, `layout source material byte length mismatch: ${source.file}`);
    assert.equal(
      createHash("sha256").update(sourceBytes).digest("hex"),
      source.sha256,
      `layout source material hash mismatch: ${source.file}`
    );
    assert.deepEqual(
      pngDimensions(sourceBytes, `layout source material ${source.file}`),
      [source.width, source.height]
    );
  }
  assert.deepEqual([...sourceRoles].sort(), ["earth", "grass"]);

  assertExactKeys(
    manifest.terrain_tileset,
    [
      "file",
      "source_id",
      "width",
      "height",
      "tile_size_px",
      "tile_content_size_px",
      "tile_gutter_px",
      "atlas_grid",
      "world_tile_size",
      "chunk_size_tiles",
      "stream_radius_chunks",
      "padding_tiles",
      "padding_tile_index",
      "tile_ids",
      "path_connectivity",
      "terrain_regions",
      "pixels_per_world_unit",
      "projection",
      "render_role",
      "sha256",
      "byte_length"
    ],
    "layout manifest terrain_tileset"
  );
  assert.ok(Object.hasOwn(layout.terrain, "render_tiles"), "v6 manifest requires the render_tiles layout contract");
  assert.ok(!Object.hasOwn(layout.terrain, "ground_plate"), "v6 must not retain a legacy ground plate");
  const renderContract = layout.terrain.render_tiles;
  const terrainTileset = manifest.terrain_tileset;
  assert.equal(terrainTileset.file, renderContract.texture);
  assert.equal(terrainTileset.source_id, renderContract.source_id);
  assert.deepEqual([terrainTileset.width, terrainTileset.height], renderContract.image_size_px);
  for (const key of [
    "tile_size_px",
    "tile_content_size_px",
    "tile_gutter_px",
    "atlas_grid",
    "world_tile_size",
    "chunk_size_tiles",
    "stream_radius_chunks",
    "padding_tiles",
    "padding_tile_index",
    "tile_ids",
    "path_connectivity",
    "terrain_regions",
    "pixels_per_world_unit",
    "projection",
    "render_role"
  ]) {
    assert.deepEqual(terrainTileset[key], renderContract[key], `layout manifest terrain_tileset.${key} mismatch`);
  }
  assert.match(terrainTileset.sha256, SHA256);
  assertInteger(terrainTileset.byte_length, "layout manifest terrain_tileset.byte_length", { positive: true });
  const terrainBytes = await readFile(new URL(terrainTileset.file, sceneryRoot));
  assert.equal(terrainBytes.byteLength, terrainTileset.byte_length, "terrain tileset byte length mismatch");
  assert.equal(
    createHash("sha256").update(terrainBytes).digest("hex"),
    terrainTileset.sha256,
    "terrain tileset hash mismatch"
  );
  assert.deepEqual(pngDimensions(terrainBytes, "layout terrain tileset"), renderContract.image_size_px);

  const mapRows = layout.terrain.tile_index_rows;
  const mapColumns = mapRows[0].length;
  const paddedColumns = mapColumns + renderContract.padding_tiles * 2;
  const paddedRows = mapRows.length + renderContract.padding_tiles * 2;
  const chunkColumns = Math.ceil(paddedColumns / renderContract.chunk_size_tiles);
  const chunkRows = Math.ceil(paddedRows / renderContract.chunk_size_tiles);
  const terrainChunks = chunkColumns * chunkRows;
  const streamWindow = (renderContract.stream_radius_chunks * 2 + 1) ** 2;
  const solidProps = layout.placements.filter((placement) => placement.collision_enabled).length;
  const expectedCounts = {
    logical_navigation_cells: layout.terrain.columns * layout.terrain.rows,
    terrain_atlas_tiles: renderContract.atlas_grid[0] * renderContract.atlas_grid[1],
    terrain_map_tiles: layout.terrain.tile_index_rows.flat().length,
    terrain_unique_tile_types: new Set(layout.terrain.tile_index_rows.flat()).size,
    terrain_render_tiles_with_padding: paddedColumns * paddedRows,
    terrain_chunks: terrainChunks,
    maximum_loaded_chunks: Math.min(terrainChunks, streamWindow),
    terrain_surfaces_per_chunk: 1,
    legacy_ground_plates: 0,
    catalog_objects: Object.keys(catalog.objects).length,
    placements: layout.placements.length,
    back_placements: layout.placements.filter((placement) => placement.layer === "back").length,
    middle_placements: layout.placements.filter((placement) => placement.layer === "middle").length,
    front_placements: layout.placements.filter((placement) => placement.layer === "front").length,
    solid_props: solidProps,
    decorative_props: layout.placements.length - solidProps,
    boundaries: layout.boundaries.length,
    collision_objects: solidProps + layout.boundaries.length,
    spawn_points: layout.spawn_points.length,
    critical_routes: layout.critical_routes.length
  };
  assertExactKeys(manifest.derived_counts, Object.keys(expectedCounts), "layout manifest derived_counts");
  assert.deepEqual(manifest.derived_counts, expectedCounts, "layout manifest derived counts mismatch");

  const expectedPlacementCounts = {};
  for (const placement of layout.placements) {
    expectedPlacementCounts[placement.object] = (expectedPlacementCounts[placement.object] ?? 0) + 1;
  }
  assertExactKeys(
    manifest.asset_placement_counts,
    Object.keys(expectedPlacementCounts),
    "layout manifest asset_placement_counts"
  );
  assert.deepEqual(manifest.asset_placement_counts, expectedPlacementCounts, "layout manifest placement counts mismatch");
}

test("the v2 catalog and layout schemas are strict, self-contained Draft 2020-12 contracts", () => {
  assertSchemaContract(catalogSchema, CATALOG_KEYS, "catalog schema");
  assertSchemaContract(layoutSchema, LAYOUT_KEYS, "layout schema");
  assert.ok(layoutSchema.$defs.renderTiles.required.includes("terrain_regions"));
  assert.deepEqual(layoutSchema.$defs.terrainRegion.required, [
    "id",
    "first_index",
    "northwest_bit",
    "northeast_bit",
    "southeast_bit",
    "southwest_bit"
  ]);
  assert.equal(layoutSchema.$defs.terrainRegion.additionalProperties, false);
  assert.equal(layoutSchema.$defs.terrainRegion.properties.full_variant_indices.uniqueItems, true);
  assert.equal(layoutSchema.$defs.terrainRegion.properties.full_variant_indices.minItems, 1);
  assert.deepEqual(catalogSchema.$defs.object.properties.collision_scale_mode.enum, ["fixed", "with-visual"]);
  assert.equal(
    catalogSchema.$defs.scaleReference.properties.measurement_basis.const,
    "visible-silhouette-above-ground-anchor"
  );
  validateCatalog(validCatalog);
  validateLayout(validLayout, validCatalog);
});

test("the catalog contract rejects unsafe runtime paths, loose metadata, bad geometry, and broken refs", () => {
  const schemaPathPattern = new RegExp(catalogSchema.$defs.safePngPath.pattern);
  const runtimeImagePattern = new RegExp(catalogSchema.$defs.runtimeImagePath.pattern);
  const sourceImagePattern = new RegExp(catalogSchema.$defs.sourceImagePath.pattern);
  for (const unsafePath of [
    "../images/tree.png",
    "C:/images/tree.png",
    "/images/tree.png",
    "images\\tree.png",
    "launcher/tree.png",
    "originals/tree.png",
    "miscellaneous/tree.png",
    "images/tree.jpg"
  ]) {
    assert.equal(schemaPathPattern.test(unsafePath), false, `catalog schema must reject ${unsafePath}`);
    const catalog = clone(validCatalog);
    catalog.objects["moon-sapling-a"].texture = unsafePath;
    assert.throws(() => validateCatalog(catalog), /texture|path|relative|root|drive|isolated|PNG|slashes/);
  }
  assert.equal(schemaPathPattern.test("images/tree.png"), true);
  assert.equal(schemaPathPattern.test("sources/floor-atlas.derived.png"), true);
  assert.equal(runtimeImagePattern.test("images/tree.png"), true);
  assert.equal(runtimeImagePattern.test("objects/tree.png"), false);
  assert.equal(sourceImagePattern.test("sources/floor-atlas.derived.png"), true);
  assert.equal(sourceImagePattern.test("floor/floor-atlas.png"), false);

  const misplacedObjectTexture = clone(validCatalog);
  misplacedObjectTexture.objects["moon-sapling-a"].texture = "objects/tree.png";
  assert.throws(() => validateCatalog(misplacedObjectTexture), /shared images directory/);

  const misplacedFloorAtlas = clone(validCatalog);
  misplacedFloorAtlas.floor_atlas.texture = "images/floor-atlas.derived.png";
  assert.throws(() => validateCatalog(misplacedFloorAtlas), /shared sources directory/);

  const loose = clone(validCatalog);
  loose.objects["moon-sapling-a"].runtime_note = "not part of v2";
  assert.throws(() => validateCatalog(loose), /unexpected or missing key/);

  const outsideAtlas = clone(validCatalog);
  outsideAtlas.floor_atlas.tiles["grass-moss-a"].uv_rect_px = [500, 8, 128, 128];
  assert.throws(() => validateCatalog(outsideAtlas), /exceeds atlas width/);

  const overlappingAtlas = clone(validCatalog);
  overlappingAtlas.floor_atlas.tiles["earth-path-a"].uv_rect_px = [100, 8, 128, 128];
  assert.throws(() => validateCatalog(overlappingAtlas), /overlap/);

  const badAnchor = clone(validCatalog);
  badAnchor.objects["moon-sapling-a"].anchor_px[1] = 453;
  assert.throws(() => validateCatalog(badAnchor), /anchor_px exceeds image height/);

  const badHeight = clone(validCatalog);
  badHeight.objects["moon-sapling-a"].default_world_height = 2.3;
  assert.throws(() => validateCatalog(badHeight), /inside allowed_world_height/);

  const badProfile = clone(validCatalog);
  badProfile.objects["moon-sapling-a"].collision_profile = "missing-profile";
  assert.throws(() => validateCatalog(badProfile), /unknown profile/);

  const badScaleReference = clone(validCatalog);
  badScaleReference.scale_reference.visual_height_world = 0;
  assert.throws(() => validateCatalog(badScaleReference), /scale_reference\.visual_height_world must be positive/);
});

test("the layout contract accepts reusable indices and rejects unsafe tiles, malformed maps, bad grids, and invalid scale", () => {
  const repeatedTileIndices = clone(validLayout);
  assert.ok(
    new Set(repeatedTileIndices.terrain.tile_index_rows.flat()).size <
      repeatedTileIndices.terrain.tile_index_rows.flat().length,
    "the fixture must prove that reusable atlas indices can repeat in the visual map"
  );
  validateLayout(repeatedTileIndices, validCatalog);

  const terrainRegionLayout = clone(validLayout);
  terrainRegionLayout.terrain.render_tiles.image_size_px = [400, 1200];
  terrainRegionLayout.terrain.render_tiles.atlas_grid = [4, 12];
  terrainRegionLayout.terrain.render_tiles.tile_ids.push(
    ...Array.from({ length: 16 }, (_, index) => `region-${index}`),
    ...Array.from({ length: 16 }, (_, index) => `reserved-${index}`)
  );
  terrainRegionLayout.terrain.render_tiles.terrain_regions = [
    {
      id: "grove-floor",
      first_index: 16,
      northwest_bit: 1,
      northeast_bit: 2,
      southeast_bit: 4,
      southwest_bit: 8
    }
  ];
  validateLayout(terrainRegionLayout, validCatalog);

  const fullVariantRegion = clone(terrainRegionLayout);
  fullVariantRegion.terrain.render_tiles.terrain_regions[0].full_variant_indices = [32, 33];
  validateLayout(fullVariantRegion, validCatalog);

  const overlappingFullVariant = clone(fullVariantRegion);
  overlappingFullVariant.terrain.render_tiles.terrain_regions[0].full_variant_indices = [31];
  assert.throws(() => validateLayout(overlappingFullVariant, validCatalog), /must not overlap a terrain region/);

  const duplicateFullVariant = clone(fullVariantRegion);
  duplicateFullVariant.terrain.render_tiles.terrain_regions[0].full_variant_indices = [32, 32];
  assert.throws(() => validateLayout(duplicateFullVariant, validCatalog), /must be unique/);

  const outsideFullVariant = clone(fullVariantRegion);
  outsideFullVariant.terrain.render_tiles.terrain_regions[0].full_variant_indices = [48];
  assert.throws(() => validateLayout(outsideFullVariant, validCatalog), /exceeds the atlas/);

  const looseTerrainRegion = clone(terrainRegionLayout);
  looseTerrainRegion.terrain.render_tiles.terrain_regions[0].variant_count = 16;
  assert.throws(() => validateLayout(looseTerrainRegion, validCatalog), /not allowed/);

  const badTerrainRegionId = clone(terrainRegionLayout);
  badTerrainRegionId.terrain.render_tiles.terrain_regions[0].id = "Grove Floor";
  assert.throws(() => validateLayout(badTerrainRegionId, validCatalog), /slug/);

  const duplicateTerrainRegionId = clone(terrainRegionLayout);
  duplicateTerrainRegionId.terrain.render_tiles.terrain_regions.push({
    ...clone(duplicateTerrainRegionId.terrain.render_tiles.terrain_regions[0]),
    first_index: 32
  });
  assert.throws(() => validateLayout(duplicateTerrainRegionId, validCatalog), /ids must be unique/);

  const outOfBoundsTerrainRegion = clone(terrainRegionLayout);
  outOfBoundsTerrainRegion.terrain.render_tiles.terrain_regions[0].first_index = 40;
  assert.throws(() => validateLayout(outOfBoundsTerrainRegion, validCatalog), /reserve 16 atlas cells/);

  const pathOverlappingTerrainRegion = clone(terrainRegionLayout);
  pathOverlappingTerrainRegion.terrain.render_tiles.terrain_regions[0].first_index = 8;
  assert.throws(() => validateLayout(pathOverlappingTerrainRegion, validCatalog), /overlap path_connectivity/);

  const mutuallyOverlappingTerrainRegions = clone(terrainRegionLayout);
  mutuallyOverlappingTerrainRegions.terrain.render_tiles.terrain_regions.push({
    ...clone(mutuallyOverlappingTerrainRegions.terrain.render_tiles.terrain_regions[0]),
    id: "grove-floor-edge",
    first_index: 24
  });
  assert.throws(() => validateLayout(mutuallyOverlappingTerrainRegions, validCatalog), /overlap another terrain region/);

  const badTerrainRegionBits = clone(terrainRegionLayout);
  badTerrainRegionBits.terrain.render_tiles.terrain_regions[0].northeast_bit = 4;
  assert.throws(() => validateLayout(badTerrainRegionBits, validCatalog), /4 !== 2/);

  const unsafeTiles = clone(validLayout);
  unsafeTiles.terrain.render_tiles.texture = "../visual-vocabulary/floor.png";
  assert.throws(() => validateLayout(unsafeTiles, validCatalog), /relative|root|escape|images directory/);

  const badTileDensity = clone(validLayout);
  badTileDensity.terrain.render_tiles.pixels_per_world_unit = 64;
  assert.throws(() => validateLayout(badTileDensity, validCatalog), /texel density/);

  const shortIndexRow = clone(validLayout);
  shortIndexRow.terrain.tile_index_rows[0].pop();
  assert.throws(() => validateLayout(shortIndexRow, validCatalog), /same length/);

  const outOfRangeTileIndex = clone(validLayout);
  outOfRangeTileIndex.terrain.tile_index_rows[1][2] = 16;
  assert.throws(() => validateLayout(outOfRangeTileIndex, validCatalog), /exceeds the atlas/);

  const extentMismatch = clone(validLayout);
  extentMismatch.terrain.tile_index_rows.forEach((row) => row.push(0));
  assert.throws(() => validateLayout(extentMismatch, validCatalog), /world extent.*navigation grid extent/);

  const orphanIndexRows = clone(validLayout);
  delete orphanIndexRows.terrain.render_tiles;
  assert.throws(() => validateLayout(orphanIndexRows, validCatalog), /select exactly one render contract|declared together/);

  const duplicate = clone(validLayout);
  duplicate.placements.push(clone(duplicate.placements[0]));
  assert.throws(() => validateLayout(duplicate, validCatalog), /ids must be unique/);

  const shortRow = clone(validLayout);
  shortRow.terrain.tile_rows[0] = ".p";
  assert.throws(() => validateLayout(shortRow, validCatalog), /exactly terrain.columns symbols/);

  const unresolvedSymbol = clone(validLayout);
  unresolvedSymbol.terrain.tile_rows[0] = ".x.";
  assert.throws(() => validateLayout(unresolvedSymbol, validCatalog), /unresolved symbol/);

  const unresolvedTile = clone(validLayout);
  unresolvedTile.terrain.tile_legend.p = "missing-tile";
  assert.throws(() => validateLayout(unresolvedTile, validCatalog), /references unknown tile/);

  const unresolvedObject = clone(validLayout);
  unresolvedObject.placements[0].object = "missing-object";
  assert.throws(() => validateLayout(unresolvedObject, validCatalog), /unknown catalog object/);

  const invalidScale = clone(validLayout);
  invalidScale.placements[0].scale = 1.2;
  assert.throws(() => validateLayout(invalidScale, validCatalog), /outside allowed_world_height/);

  const emptyProfileCatalog = clone(validCatalog);
  emptyProfileCatalog.objects["moon-sapling-a"].collision_profile = "none";
  assert.throws(() => validateLayout(validLayout, emptyProfileCatalog), /non-empty collision profile/);

  const legacyGroundPlate = clone(validLayout);
  delete legacyGroundPlate.terrain.render_tiles;
  delete legacyGroundPlate.terrain.tile_index_rows;
  legacyGroundPlate.terrain.ground_plate = {
    texture: "images/legacy-ground-plate.png",
    image_size_px: [300, 200],
    world_size: [1.5, 1],
    pixels_per_world_unit: 200,
    projection: "top-down",
    render_role: "authored-map-plate",
    source_id: "imagegen-moonroot-ground-plate-20260801"
  };
  validateLayout(legacyGroundPlate, validCatalog);
});

test("the real Memory Grove v6 reusable tiles, scales, collisions, hashes, and manifests remain mutually consistent", async () => {
  const catalogExists = existsSync(catalogUrl);
  const layoutExists = existsSync(layoutUrl);
  if (!catalogExists && !layoutExists) return;

  assert.ok(catalogExists, "Memory Grove v6 layout exists without its v3 catalog");
  assert.ok(layoutExists, "Memory Moon v3 catalog exists without its v6 layout");

  const [catalogBytes, layoutBytes] = await Promise.all([
    readFile(catalogUrl),
    readFile(layoutUrl)
  ]);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const layout = JSON.parse(layoutBytes.toString("utf8"));
  validateCatalog(catalog);
  validateLayout(layout, catalog);
  assert.equal(layout.layout_id, "memory-grove-v6");
  assert.equal(catalog.catalog_version, 3, "Memory Moon scale calibration requires catalog version 3");
  assert.equal(layout.catalog_version, 3, "Memory Grove v6 must consume catalog version 3");
  validateV6ScaleAndCollisionContract(catalog, layout);

  assert.ok(existsSync(styleManifestUrl), "Memory Grove v6 requires the style package manifest");
  const styleManifest = await readJson(styleManifestUrl);
  await validateStyleManifest(styleManifest, catalog);
  await validateSha256Sums(catalog, styleManifest);

  assert.ok(existsSync(layoutManifestUrl), "Memory Grove v6 requires the layout lock manifest");
  assert.ok(existsSync(layoutProvenanceUrl), "Memory Grove v6 requires macro-tile provenance");
  const layoutManifest = await readJson(layoutManifestUrl);
  await validateLayoutManifest(layoutManifest, catalog, layout, catalogBytes, layoutBytes);
});
