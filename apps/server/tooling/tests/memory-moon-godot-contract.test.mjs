import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const gameRoot = new URL("apps/games/memory-moon/", repoRoot);
const sceneryRoot = new URL("apps/launcher/static/assets/scenery/", repoRoot);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);
const runtimeImageNames = [
  "community-tree.png",
  "flower-patch.png",
  "moon-bush.png",
  "moon-sapling.png",
  "moss-boulder.png",
  "street-lamp.png",
  "terrain-atlas.png",
  "trail-sign.png",
  "tree-birch.png",
  "tree-maple.png",
  "tree-oak.png",
  "tree-pine.png",
  "tree-poplar.png",
  "tree-stump.png",
  "tree-willow.png",
  "village-well.png"
];
const catalogObjectTextures = {
  "community-tree-a": "images/community-tree.png",
  "flower-patch-a": "images/flower-patch.png",
  "moon-bush-round-a": "images/moon-bush.png",
  "moon-sapling-a": "images/moon-sapling.png",
  "moss-boulder-a": "images/moss-boulder.png",
  "street-lamp-a": "images/street-lamp.png",
  "trail-sign-a": "images/trail-sign.png",
  "tree-birch-a": "images/tree-birch.png",
  "tree-maple-a": "images/tree-maple.png",
  "tree-oak-a": "images/tree-oak.png",
  "tree-pine-a": "images/tree-pine.png",
  "tree-poplar-a": "images/tree-poplar.png",
  "tree-stump-a": "images/tree-stump.png",
  "tree-willow-a": "images/tree-willow.png",
  "village-well-a": "images/village-well.png"
};

const [
  project,
  mainScene,
  exportPresets,
  gameScript,
  costumeScript,
  costumeVerifier,
  exporter,
  provisioner,
  dockerfile,
  compose,
  gitignore,
  index,
  app,
  styles,
  serviceWorker,
  sceneryScript,
  terrainChunkStreamer,
  clickNavigation,
  sceneryVerifier,
  movementVerifier,
  responsiveVerifier,
  activeSceneryCatalog,
  activeSceneryLayout,
  activeSceneryRegistry,
  memoryMoonReadme,
  thirdPartyNotices,
  androidActivity
] =
  await Promise.all([
    readFile(new URL("project.godot", gameRoot), "utf8"),
    readFile(new URL("main.tscn", gameRoot), "utf8"),
    readFile(new URL("export_presets.cfg", gameRoot), "utf8"),
    readFile(new URL("scripts/memory_moon.gd", gameRoot), "utf8"),
    readFile(new URL("scripts/macaw_costume.gd", gameRoot), "utf8"),
    readFile(new URL("tooling/verify-macaw-costume.gd", gameRoot), "utf8"),
    readFile(new URL("tooling/export-web.sh", gameRoot), "utf8"),
    readFile(new URL("tooling/provision-toolchain.sh", gameRoot), "utf8"),
    readFile(new URL("tooling/Dockerfile", gameRoot), "utf8"),
    readFile(new URL("compose.yaml", repoRoot), "utf8"),
    readFile(new URL(".gitignore", repoRoot), "utf8"),
    readFile(new URL("index.html", staticRoot), "utf8"),
    readFile(new URL("app.js", staticRoot), "utf8"),
    readFile(new URL("app.css", staticRoot), "utf8"),
    readFile(new URL("sw.js", staticRoot), "utf8"),
    readFile(new URL("scripts/world_scenery.gd", gameRoot), "utf8"),
    readFile(new URL("scripts/terrain_chunk_streamer.gd", gameRoot), "utf8"),
    readFile(new URL("scripts/click_navigation.gd", gameRoot), "utf8"),
    readFile(new URL("tooling/verify-world-scenery.gd", gameRoot), "utf8"),
    readFile(new URL("tooling/verify-movement.gd", gameRoot), "utf8"),
    readFile(new URL("tooling/verify-responsive-layout.gd", gameRoot), "utf8"),
    readFile(new URL("metadata/catalog.json", sceneryRoot), "utf8"),
    readFile(new URL("metadata/world.json", sceneryRoot), "utf8"),
    readFile(new URL("metadata/registry.json", sceneryRoot), "utf8"),
    readFile(new URL("README.md", gameRoot), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", gameRoot), "utf8"),
    readFile(
      new URL("apps/android/app/src/main/java/com/caatuu/android/MainActivity.kt", repoRoot),
      "utf8"
    )
  ]);

test("Memory Moon has one browser-first Godot project using the Web-compatible renderer", () => {
  assert.match(project, /run\/main_scene="res:\/\/main\.tscn"/);
  assert.match(project, /renderer\/rendering_method="gl_compatibility"/);
  assert.match(project, /window\/size\/viewport_width=540/);
  assert.match(project, /window\/size\/viewport_height=540/);
  assert.match(project, /window\/size\/window_width_override=960/);
  assert.match(project, /window\/size\/window_height_override=540/);
  assert.match(project, /window\/stretch\/aspect="expand"/);
  assert.match(exportPresets, /name="Web"[\s\S]*?platform="Web"/);
  assert.match(exportPresets, /variant\/thread_support=false/);
  assert.match(exportPresets, /progressive_web_app\/enabled=false/);
});

test("Memory Moon renders the world and HUD directly at native root resolution", () => {
  assert.match(mainScene, /node name="MemoryMoon" type="Node3D"/);
  assert.doesNotMatch(mainScene, /SubViewport|TextureRect|memory_moon_screen/);
  assert.match(gameScript, /canvas\.custom_viewport = get_tree\(\)\.root/);
  assert.match(gameScript, /canvas\.set_meta\("native_resolution", true\)/);
  assert.match(gameScript, /canvas\.set_meta\("native_input", true\)/);
  assert.match(gameScript, /display_viewport\.size_changed\.connect\(_layout_interface\)/);
  assert.match(gameScript, /func _logical_interface_size\(display_size: Vector2\)/);
  assert.match(gameScript, /_camera\.set_meta\("subpixel_follow", true\)/);
  assert.match(gameScript, /_camera\.position = _camera_focus \+ CAMERA_OFFSET/);
  assert.doesNotMatch(gameScript, /PixelArtButton|pixel_art|pixel_snap|SCREEN_GROUP/);
  assert.match(
    responsiveVerifier,
    /smooth_follow=true large_world_follow=true native_root=true native_hud=true/
  );
});

test("the Godot exporter is pinned, isolated, non-root, and verifies its shared motion source", () => {
  assert.match(dockerfile, /AS godot-provisioner/);
  assert.match(dockerfile, /AS godot-exporter/);
  assert.match(dockerfile, /USER godot/);
  assert.match(provisioner, /Godot_v4\.7\.1-stable_linux\.x86_64\.zip/);
  assert.match(provisioner, /c7ff14fd28472c8d4f193043de30278dcf7e5241a1dcf7566b02e27addaa33ba/);
  assert.match(provisioner, /web_nothreads_release\.zip/);
  assert.match(provisioner, /b7b7d7da29fc6cc2f4934fdd26cc571a40e7af57f716ea3eb7e18da720dae28a/);
  assert.match(exporter, /engine_archive_sha256="c7ff14fd28472c8d4f193043de30278dcf7e5241a1dcf7566b02e27addaa33ba"/);
  assert.match(exporter, /Godot executable does not match the pinned editor archive/);
  assert.match(exporter, /1b7bf67866360665426bb99e4c71bd619f19b408453c24e30f0c3071601eee5c/);
  assert.match(exporter, /8761ea535ad5d5550989a9c2b9c92e7b163af032f6ed952b3b15024d16378419/);
  assert.match(exporter, /3185a4005a31eb8aabed1b0e3936a49115c9909cb9987f780c145f79ba141f08/);
  assert.match(exporter, /sha256sum --check --strict/);
  assert.match(exporter, /run_godot_checked import/);
  assert.match(exporter, /run_godot_checked responsive/);
  assert.match(exporter, /run_godot_checked movement/);
  assert.match(
    exporter,
    /MEMORY_MOON_MOVEMENT_SMOKE_OK rates=30\/60\/120 acceleration=true braking=true arrival=true overshoot=false reversal=brake-first corner_drift_max=0\.16 speed_cap=2\.6 arrival_spread_max=0\.12 los=string-pulled capsule_clearance=0\.28 supercover=safe deterministic=true precise_target=fallback same_cell=move-to-center stall_progress=route-distance/
  );
  assert.match(
    exporter,
    /MEMORY_MOON_RESPONSIVE_SMOKE_OK landscape=960x540 landscape_camera_height=8\.7097 portrait=390x844 portrait_camera_height=10\.5000 click_navigation=true direction_buttons=false compact=true camera=isometric-orthographic yaw=45 elevation=30 axis_dead_zone=true smooth_follow=true large_world_follow=true native_root=true native_hud=true/
  );
  assert.match(exporter, /run_godot_checked costume-fallback/);
  assert.match(exporter, /MACAW_COSTUME_FALLBACK_OK zero_orphans=true/);
  assert.match(exporter, /run_godot_checked smoke/);
  assert.match(exporter, /--require-macaw-costume/);
  assert.match(exporter, /MACAW_COSTUME_SMOKE_OK attachments=9 articulated=6/);
  assert.match(exporter, /run_godot_checked export/);
  assert.match(exporter, /\(SCRIPT ERROR\|ERROR\):/);
  assert.match(compose, /memory-moon-godot-provision:/);
  assert.match(compose, /memory-moon-godot-export:[\s\S]*?network_mode: none/);
  assert.match(compose, /memory-moon-godot-export:[\s\S]*?read_only: true/);
  assert.match(compose, /\.\/apps\/games\/memory-moon:\/project:ro/);
  assert.match(
    compose,
    /\.\/apps\/launcher\/static\/assets\/scenery:\/scenery-source:ro/
  );
  assert.match(
    compose,
    /\.\/apps\/launcher\/static\/assets\/motion\/quaternius-standard-v1\/source:\/reference:ro/
  );
  assert.match(
    compose,
    /\.\/apps\/animated-fabric\/assets\/reference-packages\/macaw-traveler-v1:\/macaw-reference:ro/
  );
  assert.match(compose, /caatuu-memory-moon-godot-toolchain:\/toolchain:ro/);
  assert.match(
    compose,
    /\.\/artifacts\/games\/memory-moon\/web\/godot-v1:\/output/
  );
});

test("the shared scenery registry exposes the reusable catalog and active placement counts", async () => {
  const registry = JSON.parse(activeSceneryRegistry);
  const catalog = JSON.parse(activeSceneryCatalog);
  const layout = JSON.parse(activeSceneryLayout);

  assert.deepEqual(Object.keys(registry).sort(), [
    "catalog",
    "history_policy",
    "release_status",
    "runtime_images",
    "schema_version",
    "support",
    "world"
  ]);
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.release_status, "local-preview-only");
  assert.equal(registry.history_policy, "superseded-assets-live-in-git");

  const catalogRef = registry.catalog;
  const worldRef = registry.world;

  assert.equal(catalogRef.id, catalog.catalog_id);
  assert.equal(catalogRef.version, catalog.catalog_version);
  assert.equal(catalogRef.file, "metadata/catalog.json");
  assert.equal(Object.hasOwn(catalogRef, "root"), false);

  assert.equal(worldRef.id, layout.layout_id);
  assert.equal(worldRef.file, "metadata/world.json");
  assert.equal(Object.hasOwn(worldRef, "root"), false);
  assert.equal(worldRef.catalog_id, layout.catalog_id);
  assert.equal(worldRef.catalog_version, layout.catalog_version);
  assert.deepEqual(registry.support, {
    source_glob: "sources/*.png",
    checksum_file: "metadata/checksums.sha256",
    processing_file: "metadata/floor.processing.json"
  });

  for (const file of [
    catalogRef.file,
    catalogRef.manifest,
    catalogRef.provenance,
    catalogRef.schema,
    worldRef.file,
    worldRef.manifest,
    worldRef.provenance,
    worldRef.schema,
    registry.support.checksum_file,
    registry.support.processing_file,
    "metadata/registry.json"
  ]) {
    assert.doesNotMatch(file, /(^\/|\\|\.\.)/);
    assert.equal(existsSync(new URL(file, sceneryRoot)), true, `missing active metadata: ${file}`);
  }

  assert.ok(
    sceneryScript.includes(`CATALOG_PATH := SCENERY_ROOT + "${catalogRef.file}"`)
  );
  assert.ok(
    sceneryScript.includes(`LAYOUT_PATH := SCENERY_ROOT + "${worldRef.file}"`)
  );
  assert.ok(exportPresets.includes(`assets/scenery/${catalogRef.file}`));
  assert.ok(exportPresets.includes(`assets/scenery/${worldRef.file}`));
  assert.ok(exportPresets.includes("assets/scenery/images/*.png"));

  const placementCounts = new Map();
  for (const placement of layout.placements) {
    placementCounts.set(placement.object, (placementCounts.get(placement.object) ?? 0) + 1);
  }
  const usedObjectIds = [...placementCounts.keys()].sort();
  for (const objectId of usedObjectIds) {
    assert.ok(Object.hasOwn(catalog.objects, objectId), `layout uses unknown object: ${objectId}`);
  }
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(catalog.objects).map(([objectId, object]) => [objectId, object.texture])
    ),
    catalogObjectTextures
  );
  for (const [objectId, object] of Object.entries(catalog.objects)) {
    assert.match(object.texture, /^images\/[^/]+\.png$/);
    assert.equal(
      existsSync(new URL(object.texture, sceneryRoot)),
      true,
      `missing active object sprite: ${objectId}`
    );
  }
  assert.equal(
    [...placementCounts.values()].reduce((total, count) => total + count, 0),
    layout.placements.length
  );

  const terrainTexture = layout.terrain.render_tiles.texture;
  assert.equal(terrainTexture, "images/terrain-atlas.png");
  assert.equal(
    existsSync(new URL(terrainTexture, sceneryRoot)),
    true
  );
  assert.equal(layout.terrain.render_tiles.tile_ids.length, 48);
  assert.equal(layout.terrain.tile_index_rows.flat().length, 144);

  assert.equal(registry.runtime_images.length, runtimeImageNames.length);
  assert.deepEqual(
    registry.runtime_images.map((image) => image.file).sort(),
    runtimeImageNames.map((name) => `images/${name}`)
  );
  assert.deepEqual(
    [
      ...Object.values(catalog.objects).map((object) => object.texture),
      terrainTexture
    ].sort(),
    registry.runtime_images.map((image) => image.file).sort()
  );
  assert.ok(
    registry.runtime_images.every((image) => !image.file.includes("sources/")),
    "runtime registry must exclude source images"
  );
  const registryObjects = new Map(
    registry.runtime_images
      .filter((image) => image.kind === "object")
      .map((image) => [image.id, image])
  );
  assert.equal(registryObjects.size, Object.keys(catalog.objects).length);
  for (const objectId of Object.keys(catalog.objects)) {
    const registryObject = registryObjects.get(objectId);
    assert.ok(registryObject, `registry is missing catalog object: ${objectId}`);
    assert.equal(registryObject.placement_count, placementCounts.get(objectId) ?? 0);
  }

  const rootEntries = await readdir(sceneryRoot, { withFileTypes: true });
  assert.deepEqual(
    rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort(),
    ["README.md"]
  );
  assert.deepEqual(
    rootEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    ["images", "metadata", "sources"]
  );
  for (const directory of ["images", "metadata", "sources"]) {
    const entries = await readdir(new URL(`${directory}/`, sceneryRoot), {
      withFileTypes: true
    });
    assert.ok(
      entries.every((entry) => entry.isFile()),
      `${directory}/ must not contain nested directories`
    );
    if (directory === "images") {
      assert.deepEqual(entries.map((entry) => entry.name).sort(), runtimeImageNames);
    }
  }
});

test("Memory Grove v6 streams a reusable terrain tile map and navigation into the Web export", () => {
  const sceneryMarker =
    "MEMORY_MOON_SCENERY_SMOKE_OK layout=memory-grove-v6 terrain=chunk-stream chunks=49/144 tiles=441/1296 map_tiles=144 atlas_tiles=48 used_tile_types=32 navigation=true prop_placements=18 collision_objects=18 shadows=0";
  const catalog = JSON.parse(activeSceneryCatalog);
  const layout = JSON.parse(activeSceneryLayout);
  const renderTiles = layout.terrain.render_tiles;

  assert.equal(
    existsSync(new URL("assets/scenery/", gameRoot)),
    false,
    "Memory Moon must consume the canonical scenery catalog instead of keeping a game-local copy"
  );
  assert.match(gameScript, /WorldSceneryBuilder := preload/);
  assert.match(gameScript, /scenery_builder\.build\(self\)/);
  assert.match(sceneryScript, /class_name MemoryMoonScenery/);
  assert.match(sceneryScript, /TerrainChunkStreamer := preload\("res:\/\/scripts\/terrain_chunk_streamer\.gd"\)/);
  assert.match(sceneryScript, /SCHEMA_VERSION := 2/);
  assert.match(sceneryScript, /LAYOUT_ID := "memory-grove-v6"/);
  assert.match(sceneryScript, /CATALOG_ID := "memory-moon-style-v1"/);
  assert.match(sceneryScript, /SCENERY_ROOT := "res:\/\/assets\/scenery\/"/);
  assert.match(
    sceneryScript,
    /CATALOG_PATH := SCENERY_ROOT \+ "metadata\/catalog\.json"/
  );
  assert.match(
    sceneryScript,
    /LAYOUT_PATH := SCENERY_ROOT \+ "metadata\/world\.json"/
  );
  assert.doesNotMatch(sceneryScript, /STYLE_ROOT|LAYOUT_ROOT|ASSET_ROOT/);
  assert.match(sceneryScript, /_read_json_object\(CATALOG_PATH, "catalog"\)/);
  assert.match(sceneryScript, /_read_json_object\(LAYOUT_PATH, "layout"\)/);
  assert.match(sceneryScript, /terrain_surface := TerrainChunkStreamer\.new\(\)/);
  assert.match(sceneryScript, /terrain_surface\.name = "TerrainSurface"/);
  assert.match(sceneryScript, /terrain_surface\.configure\(/);
  assert.match(sceneryScript, /"navigation_blocked_cells"/);
  assert.doesNotMatch(sceneryScript, /func _add_ground_plate\(/);
  assert.match(sceneryScript, /StaticBody3D\.new\(\)/);
  assert.match(sceneryScript, /CylinderShape3D\.new\(\)/);
  assert.match(sceneryScript, /BoxShape3D\.new\(\)/);
  assert.doesNotMatch(sceneryScript, /memory-grove-v[13]|apps\/launcher|res:\/\/[^"\n]*launcher/);
  assert.doesNotMatch(gameScript, /apps\/launcher|res:\/\/[^"\n]*launcher/);

  assert.equal(layout.layout_id, "memory-grove-v6");
  assert.equal(layout.catalog_id, "memory-moon-style-v1");
  assert.equal(catalog.catalog_version, 3);
  assert.equal(layout.catalog_version, 3);
  assert.deepEqual(catalog.scale_reference, {
    id: "memory-moon-humanoid-v1",
    visual_height_world: 1.4264,
    capsule_height_world: 1.45,
    capsule_radius_world: 0.28,
    model_runtime_scale: 0.78,
    measurement_basis: "visible-silhouette-above-ground-anchor"
  });
  assert.equal(layout.terrain.columns, 36);
  assert.equal(layout.terrain.rows, 36);
  assert.equal(renderTiles.texture, "images/terrain-atlas.png");
  assert.equal(
    existsSync(new URL(renderTiles.texture, sceneryRoot)),
    true,
    "the reusable terrain atlas must live in the canonical flat image directory"
  );
  assert.deepEqual(renderTiles.image_size_px, [832, 2496]);
  assert.deepEqual(renderTiles.tile_size_px, [208, 208]);
  assert.deepEqual(renderTiles.tile_content_size_px, [192, 192]);
  assert.equal(renderTiles.tile_gutter_px, 8);
  assert.deepEqual(renderTiles.atlas_grid, [4, 12]);
  assert.equal(renderTiles.world_tile_size, 1);
  assert.equal(renderTiles.chunk_size_tiles, 3);
  assert.equal(renderTiles.stream_radius_chunks, 3);
  assert.equal(renderTiles.padding_tiles, 12);
  assert.equal(renderTiles.padding_tile_index, 0);
  assert.equal(renderTiles.pixels_per_world_unit, 192);
  assert.equal(renderTiles.render_role, "streamed-reusable-tile-map");
  assert.equal(renderTiles.tile_ids.length, 48);
  assert.equal(new Set(renderTiles.tile_ids).size, 48);
  assert.deepEqual(renderTiles.tile_ids.slice(4, 12), [
    "grass-flowers-cream-a",
    "grass-flowers-amber-a",
    "grass-leaf-litter-a",
    "grass-pebbles-a",
    "grass-worn-small-a",
    "grass-worn-large-a",
    "grass-moss-cool-a",
    "grass-moss-warm-a"
  ]);
  assert.deepEqual(renderTiles.path_connectivity, {
    first_index: 12,
    north_bit: 1,
    east_bit: 2,
    south_bit: 4,
    west_bit: 8
  });
  assert.deepEqual(renderTiles.terrain_regions, [
    {
      id: "moonstone-court",
      first_index: 28,
      northwest_bit: 1,
      northeast_bit: 2,
      southeast_bit: 4,
      southwest_bit: 8,
      full_variant_indices: [44, 45, 46, 47]
    }
  ]);
  assert.deepEqual(renderTiles.tile_ids.slice(28), [
    "moonstone-none",
    "moonstone-nw",
    "moonstone-ne",
    "moonstone-nw-ne",
    "moonstone-se",
    "moonstone-nw-se",
    "moonstone-ne-se",
    "moonstone-nw-ne-se",
    "moonstone-sw",
    "moonstone-nw-sw",
    "moonstone-ne-sw",
    "moonstone-nw-ne-sw",
    "moonstone-se-sw",
    "moonstone-nw-se-sw",
    "moonstone-ne-se-sw",
    "moonstone-full",
    "moonstone-full-b",
    "moonstone-full-c",
    "moonstone-full-d",
    "moonstone-full-e"
  ]);

  const tileRows = layout.terrain.tile_index_rows;
  const mapEntries = tileRows.flat();
  const usedTileTypes = new Set(mapEntries);
  assert.equal(tileRows.length, 12);
  assert.ok(tileRows.every((row) => row.length === 12), "the tile map must be rectangular");
  assert.equal(mapEntries.length, 144);
  assert.equal(usedTileTypes.size, 32);
  assert.ok(renderTiles.tile_ids.length < mapEntries.length, "map cells must reuse atlas tiles");

  const topology = renderTiles.path_connectivity;
  const region = renderTiles.terrain_regions[0];
  const isPathIndex = (atlasIndex) =>
    atlasIndex >= topology.first_index && atlasIndex < topology.first_index + 16;
  const isRegionIndex = (atlasIndex) =>
    atlasIndex >= region.first_index && atlasIndex < region.first_index + 16;
  const maskFor = (atlasIndex) =>
    isPathIndex(atlasIndex) ? atlasIndex - topology.first_index : 0;
  const regionMaskFor = (atlasIndex) =>
    isRegionIndex(atlasIndex) ? atlasIndex - region.first_index : 0;
  for (let rowIndex = 0; rowIndex < tileRows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < tileRows[rowIndex].length; columnIndex += 1) {
      const atlasIndex = tileRows[rowIndex][columnIndex];
      const mask = maskFor(atlasIndex);
      if (columnIndex + 1 < tileRows[rowIndex].length) {
        const eastIndex = tileRows[rowIndex][columnIndex + 1];
        if (!isRegionIndex(atlasIndex) && !isRegionIndex(eastIndex)) {
          const eastMask = maskFor(eastIndex);
          assert.equal(
            Boolean(mask & topology.east_bit),
            Boolean(eastMask & topology.west_bit),
            `east/west path mismatch at ${columnIndex},${rowIndex}`
          );
        }
      } else {
        assert.equal(mask & topology.east_bit, 0);
      }
      if (rowIndex + 1 < tileRows.length) {
        const southIndex = tileRows[rowIndex + 1][columnIndex];
        if (!isRegionIndex(atlasIndex) && !isRegionIndex(southIndex)) {
          const southMask = maskFor(southIndex);
          assert.equal(
            Boolean(mask & topology.south_bit),
            Boolean(southMask & topology.north_bit),
            `north/south path mismatch at ${columnIndex},${rowIndex}`
          );
        }
      } else {
        assert.equal(mask & topology.south_bit, 0);
      }
      if (columnIndex === 0) assert.equal(mask & topology.west_bit, 0);
      if (rowIndex === 0) assert.equal(mask & topology.north_bit, 0);

      const regionMask = regionMaskFor(atlasIndex);
      if (columnIndex + 1 < tileRows[rowIndex].length) {
        const eastIndex = tileRows[rowIndex][columnIndex + 1];
        if (!isPathIndex(atlasIndex) && !isPathIndex(eastIndex)) {
          const eastMask = regionMaskFor(eastIndex);
          assert.equal(
            Boolean(regionMask & region.northeast_bit),
            Boolean(eastMask & region.northwest_bit),
            `east/west north-corner region mismatch at ${columnIndex},${rowIndex}`
          );
          assert.equal(
            Boolean(regionMask & region.southeast_bit),
            Boolean(eastMask & region.southwest_bit),
            `east/west south-corner region mismatch at ${columnIndex},${rowIndex}`
          );
        }
      }
      if (rowIndex + 1 < tileRows.length) {
        const southIndex = tileRows[rowIndex + 1][columnIndex];
        if (!isPathIndex(atlasIndex) && !isPathIndex(southIndex)) {
          const southMask = regionMaskFor(southIndex);
          assert.equal(
            Boolean(regionMask & region.southwest_bit),
            Boolean(southMask & region.northwest_bit),
            `north/south west-corner region mismatch at ${columnIndex},${rowIndex}`
          );
          assert.equal(
            Boolean(regionMask & region.southeast_bit),
            Boolean(southMask & region.northeast_bit),
            `north/south east-corner region mismatch at ${columnIndex},${rowIndex}`
          );
        }
      }
    }
  }

  assert.match(terrainChunkStreamer, /extends Node3D/);
  assert.match(terrainChunkStreamer, /func configure\(/);
  assert.match(terrainChunkStreamer, /func set_target\(target: Node3D\)/);
  assert.match(terrainChunkStreamer, /func _stream_around\(focus: Vector2, force: bool\)/);
  assert.match(terrainChunkStreamer, /func _visual_atlas_index\(/);
  assert.match(terrainChunkStreamer, /var mesh := ArrayMesh\.new\(\)/);
  assert.match(terrainChunkStreamer, /chunk\.name = "TerrainChunk_%d_%d"/);
  assert.match(terrainChunkStreamer, /set_meta\("total_chunk_count", _chunk_grid\.x \* _chunk_grid\.y\)/);
  assert.match(terrainChunkStreamer, /set_meta\("total_tile_count", _render_size_tiles\.x \* _render_size_tiles\.y\)/);
  assert.match(terrainChunkStreamer, /set_meta\("logical_tile_count", _logical_size_tiles\.x \* _logical_size_tiles\.y\)/);
  assert.match(terrainChunkStreamer, /\(_stream_radius_chunks \* 2 \+ 1\) \* \(_stream_radius_chunks \* 2 \+ 1\)/);

  assert.match(
    sceneryVerifier,
    /SCENERY_ROOT := "res:\/\/assets\/scenery\/"/
  );
  assert.match(sceneryVerifier, /CATALOG_PATH := SCENERY_ROOT \+ "metadata\/catalog\.json"/);
  assert.doesNotMatch(sceneryVerifier, /_verify_texture\(atlas_path/);
  assert.match(
    sceneryVerifier,
    /LAYOUT_PATH := SCENERY_ROOT \+ "metadata\/world\.json"/
  );
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_TEXTURE := "images\/terrain-atlas\.png"/);
  assert.doesNotMatch(sceneryVerifier, /STYLE_ROOT|LAYOUT_ROOT/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_IMAGE_SIZE := Vector2i\(832, 2496\)/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_TILE_SIZE := Vector2i\(208, 208\)/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_TILE_CONTENT_SIZE := Vector2i\(192, 192\)/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_TILE_GUTTER := 8/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_ATLAS_GRID := Vector2i\(4, 12\)/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_CHUNK_SIZE_TILES := 3/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_STREAM_RADIUS_CHUNKS := 3/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_PADDING_TILES := 12/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_RENDER_SIZE := Vector2i\(36, 36\)/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_CHUNK_GRID := Vector2i\(12, 12\)/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_TOTAL_CHUNKS := 144/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_LOADED_CHUNKS := 49/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_TOTAL_RENDER_TILES := 1296/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_LOADED_RENDER_TILES := 441/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_MAP_TILES := 144/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_ATLAS_TILES := 48/);
  assert.match(sceneryVerifier, /EXPECTED_TERRAIN_USED_TILE_TYPES := 32/);
  assert.match(sceneryVerifier, /EXPECTED_PATH_FIRST_INDEX := 12/);
  assert.match(sceneryVerifier, /EXPECTED_REGION_FIRST_INDEX := 28/);
  assert.match(sceneryVerifier, /EXPECTED_CATALOG_VERSION := 3/);
  assert.match(sceneryVerifier, /EXPECTED_SCALE_REFERENCE/);
  assert.match(sceneryVerifier, /placement[^\n]+canonical humanoid-relative scale/);
  assert.match(sceneryVerifier, /func _verify_path_connectivity\(/);
  assert.match(sceneryVerifier, /func _verify_terrain_regions\(/);
  assert.match(
    sceneryVerifier,
    /MEMORY_MOON_SCENERY_SMOKE_OK layout=%s terrain=chunk-stream chunks=%d\/%d tiles=%d\/%d map_tiles=%d atlas_tiles=%d used_tile_types=%d navigation=true prop_placements=%d collision_objects=%d shadows=0/
  );

  assert.match(
    exportPresets,
    /include_filter="assets\/scenery\/metadata\/catalog\.json,assets\/scenery\/metadata\/world\.json,assets\/scenery\/images\/\*\.png"/
  );
  assert.match(exporter, /scenery_source_root="\/scenery-source"/);
  assert.match(exporter, /scenery_metadata_root="\$\{scenery_source_root\}\/metadata"/);
  assert.match(exporter, /scenery_images_root="\$\{scenery_source_root\}\/images"/);
  assert.match(exporter, /test ! -e "\$\{project_source\}\/assets\/scenery"/);
  const runtimeImageArray = /readonly -a scenery_image_names=\(([\s\S]*?)\n\)/.exec(exporter);
  assert.ok(runtimeImageArray, "exporter must declare the canonical runtime image set");
  assert.deepEqual(
    [...runtimeImageArray[1].matchAll(/"([^"]+\.png)"/g)].map((match) => match[1]).sort(),
    runtimeImageNames
  );
  assert.match(
    exporter,
    /"\$\{scenery_metadata_root\}\/catalog\.json"\s*\\\s*"\$\{scenery_metadata_root\}\/world\.json"\s*\\\s*"\$\{work_root\}\/assets\/scenery\/metadata\/"/
  );
  assert.match(
    exporter,
    /for scenery_image_name in "\$\{scenery_image_names\[@\]\}"; do[\s\S]*?"\$\{scenery_images_root\}\/\$\{scenery_image_name\}"[\s\S]*?"\$\{work_root\}\/assets\/scenery\/images\/\$\{scenery_image_name\}"[\s\S]*?done/
  );
  assert.doesNotMatch(exporter, /cp -R[^\n]*\$\{scenery_(?:source|metadata|images)_root\}/);
  assert.doesNotMatch(exporter, /\$\{work_root\}\/assets\/scenery\/sources/);
  assert.doesNotMatch(exporter, /\$\{scenery_source_root\}\/sources/);
  assert.doesNotMatch(exporter, /memory-grove-v(?:1|3|4|5)/);
  assert.match(exporter, /"\$\{scenery_metadata_root\}\/catalog\.json"/);
  assert.match(exporter, /"\$\{scenery_metadata_root\}\/world\.json"/);
  assert.match(exporter, /scenery_catalog_sha256=/);
  assert.match(exporter, /scenery_layout_sha256=/);
  assert.match(exporter, /scenery_tileset_sha256=/);
  assert.match(exporter, /images_root\}\/terrain-atlas\.png/);
  assert.match(exporter, /sha256sum --check --strict metadata\/checksums\.sha256/);
  assert.match(exporter, /run_godot_checked scenery/);
  assert.ok(exporter.includes(sceneryMarker));
  assert.match(exporter, /LICENSES\/Memory-Grove-Provenance\.md/);
  assert.match(exporter, /LICENSES\/Memory-Moon-Style-Provenance\.md/);
  assert.match(exporter, /metadata_root\}\/catalog\.provenance\.md/);
  assert.match(exporter, /metadata_root\}\/world\.provenance\.md/);
  assert.doesNotMatch(exporter, /apps\/launcher|visual-vocabulary/);

  for (const document of [memoryMoonReadme, thirdPartyNotices]) {
    assert.match(document, /metadata\/catalog\.json/);
    assert.match(document, /metadata\/world\.json/);
  }
  assert.match(memoryMoonReadme, /local-preview\s+rights/);
  assert.match(thirdPartyNotices, /local-preview-only/);
  assert.match(memoryMoonReadme, /apps\/launcher\/static\/assets\/scenery\//);
  assert.match(memoryMoonReadme, /consumer[^.]+no canonical scenery copy/is);
  assert.match(memoryMoonReadme, /Physical storage is intentionally unversioned and shallow/i);
  assert.match(
    memoryMoonReadme,
    /exporter\s+stages\s+the\s+minimum active, hash-verified subset/
  );
  assert.match(memoryMoonReadme, /copy is disposable build output/);
  assert.match(
    memoryMoonReadme,
    /superseded scenery packages are preserved in Git history rather than the served\s+asset tree/i
  );
  assert.match(thirdPartyNotices, /apps\/launcher\/static\/assets\/scenery\//);
  assert.match(
    thirdPartyNotices,
    /location[^.]+does not imply launcher\s+ownership/is
  );
  assert.match(
    thirdPartyNotices,
    /superseded scenery packages are preserved in Git history rather than the active\s+asset tree or Web export/i
  );
});

test("one real humanoid motion donor drives a reversible macaw costume shell", () => {
  assert.match(gameScript, /_play_clip\("Idle"\)/);
  assert.match(gameScript, /_play_clip\("Walk"\)/);
  assert.match(gameScript, /find_children\("\*", "Skeleton3D", true, false\)/);
  assert.match(gameScript, /mesh\.visible = not _showing_macaw/);
  assert.match(gameScript, /_macaw_costume\.set_visible\(_showing_macaw\)/);
  assert.match(gameScript, /VIEW HUMAN/);
  assert.match(gameScript, /VIEW MACAW/);
  assert.match(costumeScript, /class_name MacawCostume/);
  assert.match(costumeScript, /res:\/\/assets\/macaw\/macaw-parts\.png/);
  assert.match(costumeScript, /BoneAttachment3D\.new\(\)/);
  assert.match(costumeScript, /Sprite3D\.new\(\)/);
  assert.match(costumeScript, /BILLBOARD_DISABLED/);
  assert.match(costumeScript, /get_bone_global_pose\(bone_index\)/);
  assert.match(costumeScript, /sprite\.global_basis = Basis/);
  assert.match(costumeScript, /pose_signature\(part_ids: Array\[StringName\]\)/);
  assert.match(costumeScript, /ResourceLoader\.exists\(atlas_path, "Texture2D"\)/);
  assert.match(costumeScript, /DEF-head/);
  assert.match(costumeScript, /DEF-hips/);
  assert.match(costumeScript, /DEF-upper_arm\.L/);
  assert.match(costumeScript, /"id": "leg_far",[\s\S]*?"bone": &"DEF-shin\.R"/);
  assert.match(costumeScript, /"id": "leg_near",[\s\S]*?"bone": &"DEF-shin\.L"/);
  assert.match(costumeScript, /failure_message = "Required motion bone/);
  assert.match(costumeScript, /has_complete_attachment_set\(\)/);
  assert.match(costumeScript, /_attachments\.size\(\) != PARTS\.size\(\)/);
  assert.match(gameScript, /_verify_macaw_smoke_contract\(\)/);
  assert.match(gameScript, /not _macaw_costume\.has_complete_attachment_set\(\)/);
  assert.match(gameScript, /_set_appearance\(false\)/);
  assert.match(gameScript, /_macaw_costume\.update_camera_facing\(_camera\)/);
  assert.match(gameScript, /ARTICULATED_PART_IDS: Array\[StringName\]/);
  assert.match(gameScript, /_count_articulated_costume_parts\(\)/);
  assert.match(gameScript, /ARTICULATION_SAMPLE_SECONDS/);
  assert.match(gameScript, /_animation_player\.seek\(float\(sample_seconds\), true\)/);
  assert.match(gameScript, /articulated_count != ARTICULATED_PART_IDS\.size\(\)/);
  assert.match(costumeVerifier, /_verify_missing_bone_fallback\(\)/);
  assert.match(costumeVerifier, /_verify_missing_atlas_fallback\(\)/);
  assert.match(costumeVerifier, /costume\.attachment_count\(\) == 0/);
  assert.match(costumeVerifier, /skeleton\.get_child_count\(\) == 0/);
  assert.match(exporter, /LICENSES\/Macaw-Parts-CC0\.md/);
});

test("the world uses one fixed 2:1 isometric camera instead of an orbiting perspective", () => {
  assert.match(gameScript, /CAMERA_PIXELS_PER_WORLD_UNIT := 62\.0/);
  assert.match(gameScript, /CAMERA_HEIGHT_MIN := 8\.5/);
  assert.match(gameScript, /CAMERA_HEIGHT_MAX := 10\.5/);
  assert.match(gameScript, /CAMERA_DEAD_ZONE := Vector2\(1\.35, 0\.9\)/);
  assert.match(gameScript, /CAMERA_YAW_RADIANS := PI \/ 4\.0/);
  assert.match(gameScript, /CAMERA_ELEVATION_RADIANS := PI \/ 6\.0/);
  assert.match(
    gameScript,
    /CAMERA_OFFSET := Vector3\(8\.485281374, 6\.928203230, 8\.485281374\)/
  );
  assert.match(gameScript, /projection = Camera3D\.PROJECTION_ORTHOGONAL/);
  assert.match(gameScript, /keep_aspect = Camera3D\.KEEP_HEIGHT/);
  assert.match(gameScript, /viewport_size\.y \/ CAMERA_PIXELS_PER_WORLD_UNIT/);
  assert.match(gameScript, /presentation_mode", "isometric-orthographic"/);
  assert.match(gameScript, /yaw_degrees", rad_to_deg\(CAMERA_YAW_RADIANS\)/);
  assert.match(gameScript, /elevation_degrees", rad_to_deg\(CAMERA_ELEVATION_RADIANS\)/);
  assert.match(gameScript, /translation_only_follow", true/);
  assert.match(gameScript, /large_world_follow", true/);
  assert.match(gameScript, /func _camera_ground_right\(\)/);
  assert.match(gameScript, /func _camera_ground_forward\(\)/);
  assert.match(gameScript, /func _camera_target_focus\(\)/);
  assert.match(gameScript, /actor_delta\.dot\(camera_right\)/);
  assert.match(gameScript, /actor_delta\.dot\(camera_forward\)/);
  assert.match(gameScript, /_camera\.position = _camera_focus \+ CAMERA_OFFSET/);
  assert.match(gameScript, /subpixel_follow", true/);
  assert.match(gameScript, /tonemap_mode = Environment\.TONE_MAPPER_LINEAR/);
  assert.match(gameScript, /Color\("#4a4b16"\)/);
  assert.match(gameScript, /shadow_enabled = false/);
  assert.match(gameScript, /SHADOW_CASTING_SETTING_OFF/);
  assert.doesNotMatch(gameScript, /MEMORY_POSITIONS/);
  assert.doesNotMatch(gameScript, /CRATERS/);
  assert.doesNotMatch(gameScript, /MemoryShard/);
  assert.doesNotMatch(gameScript, /BoxMesh\.new\(\)/);
  assert.doesNotMatch(gameScript, /_camera\.look_at\(_actor\.position/);
  assert.doesNotMatch(gameScript, /RESET ORBIT/);
  assert.match(gameScript, /RESET GROVE/);
});

test("click or tap drives the walker through AStarGrid2D without directional controls", () => {
  assert.match(gameScript, /ACTOR_VISUAL_TURNAROUND := PI/);
  assert.match(gameScript, /_actor_visual\.rotation\.y = PI \+ ACTOR_VISUAL_TURNAROUND/);
  assert.match(gameScript, /CharacterBody3D\.new\(\)/);
  assert.match(gameScript, /WalkerCollision/);
  assert.match(gameScript, /CapsuleShape3D\.new\(\)/);
  assert.match(gameScript, /ClickNavigation := preload\("res:\/\/scripts\/click_navigation\.gd"\)/);
  assert.match(gameScript, /func _unhandled_input\(event: InputEvent\)/);
  assert.match(gameScript, /event is InputEventMouseButton/);
  assert.match(gameScript, /event is InputEventScreenTouch/);
  assert.match(gameScript, /_request_move_to_screen_position\(touch_event\.position\)/);
  assert.match(gameScript, /_navigator\.find_path\(_actor\.position, requested_target\)/);
  assert.match(gameScript, /_target_marker\.name = "WalkTarget"/);
  assert.match(gameScript, /var marker_mesh := CylinderMesh\.new\(\)/);
  assert.match(gameScript, /WALK_ACCELERATION := 8\.0/);
  assert.match(gameScript, /WALK_BRAKING := 11\.0/);
  assert.match(gameScript, /CORNER_APPROACH_DISTANCE := 0\.55/);
  assert.match(gameScript, /CORNER_SPEED := 1\.35/);
  assert.match(gameScript, /_advance_movement_velocity\(direction, delta\)/);
  assert.match(gameScript, /func _steer_movement_velocity\(/);
  assert.match(gameScript, /return current\.move_toward\(Vector3\.ZERO, WALK_BRAKING \* delta\)/);
  assert.match(gameScript, /sqrt\(2\.0 \* WALK_BRAKING \* remaining_after_stop\)/);
  assert.match(gameScript, /_actor\.velocity = next_velocity/);
  assert.match(gameScript, /_animation_player\.speed_scale = clampf\(/);
  assert.match(gameScript, /_stall_reference_remaining - route_remaining >= REPLAN_PROGRESS_DISTANCE/);
  assert.match(gameScript, /_actor\.move_and_slide\(\)/);
  assert.match(gameScript, /_instruction_label\.text = "Click or tap the ground to walk"/);
  assert.doesNotMatch(
    gameScript,
    /Input\.is_action_pressed|Input\.get_vector|KEY_[WASD]|ui_(?:left|right|up|down)|TouchScreenButton|DirectionButton|MovementPad/
  );

  assert.match(clickNavigation, /class_name ClickNavigation/);
  assert.match(clickNavigation, /var _grid := AStarGrid2D\.new\(\)/);
  assert.match(clickNavigation, /grid\.region = Rect2i\(Vector2i\.ZERO, Vector2i\(columns, rows\)\)/);
  assert.match(clickNavigation, /grid\.diagonal_mode = AStarGrid2D\.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES/);
  assert.match(clickNavigation, /grid\.set_point_solid\(cell, true\)/);
  assert.match(clickNavigation, /_grid\.get_id_path\(start_cell, target_cell, true\)/);
  assert.match(clickNavigation, /func _string_pull_world_path\(/);
  assert.match(clickNavigation, /func _segment_is_walkable\(/);
  assert.match(clickNavigation, /ACTOR_CLEARANCE_RADIUS := 0\.28/);
  assert.match(clickNavigation, /func _segment_has_capsule_clearance\(/);
  assert.match(clickNavigation, /func _can_preserve_precise_target\(/);
  assert.match(clickNavigation, /horizontal_neighbor/);
  assert.match(clickNavigation, /vertical_neighbor/);
  assert.match(movementVerifier, /TEST_RATES := \[30, 60, 120\]/);
  assert.match(movementVerifier, /_verify_open_route_smoothing\(/);
  assert.match(movementVerifier, /_verify_supercover_safety_and_target_fallback\(/);
  assert.match(movementVerifier, /_verify_eased_arrival_across_rates\(/);
  assert.match(movementVerifier, /_verify_braked_retarget_across_rates\(/);
  assert.match(movementVerifier, /_verify_corner_steering_across_rates\(/);
  assert.match(movementVerifier, /_verify_stall_progress_uses_route_distance\(/);
  assert.match(movementVerifier, /_segment_is_walkable/);
  assert.match(
    movementVerifier,
    /MEMORY_MOON_MOVEMENT_SMOKE_OK rates=30\/60\/120 acceleration=true braking=true arrival=true overshoot=false reversal=brake-first corner_drift_max=0\.16 speed_cap=2\.6 arrival_spread_max=0\.12 los=string-pulled capsule_clearance=0\.28 supercover=safe deterministic=true precise_target=fallback same_cell=move-to-center stall_progress=route-distance/
  );
  assert.match(clickNavigation, /func is_world_walkable\(world_position: Vector3\)/);

  assert.match(gameScript, /func _layout_interface_for_size\(viewport_size: Vector2\)/);
  assert.match(gameScript, /portrait := viewport_size\.y > viewport_size\.x \* 1\.12/);
  assert.doesNotMatch(gameScript, /Vector2\(56\.0, 56\.0\)/);
  assert.match(responsiveVerifier, /LANDSCAPE_SIZE := Vector2\(960\.0, 540\.0\)/);
  assert.match(responsiveVerifier, /PORTRAIT_SIZE := Vector2\(390\.0, 844\.0\)/);
  assert.match(responsiveVerifier, /LANDSCAPE_CAMERA_HEIGHT := 540\.0 \/ CAMERA_PIXELS_PER_WORLD_UNIT/);
  assert.match(responsiveVerifier, /PORTRAIT_CAMERA_HEIGHT := 10\.5/);
  assert.match(responsiveVerifier, /the portrait status panel must stay compact/);
  assert.match(responsiveVerifier, /responsive layout must not rotate the world camera/);
  assert.match(responsiveVerifier, /large_world_follow/);
  assert.match(responsiveVerifier, /click_navigation=true direction_buttons=false/);
  assert.match(app, /document\.body\.classList\.toggle\("memory-moon-active", activeTab === "memory-moon"\)/);
  assert.match(styles, /\.memory-moon-stage[\s\S]*?aspect-ratio: 16 \/ 9/);
  assert.match(styles, /body\.memory-moon-active \.app-shell[\s\S]*?height: 100dvh/);
  assert.match(styles, /body\.memory-moon-active \.memory-moon-stage[\s\S]*?aspect-ratio: auto/);
  assert.match(styles, /body\.memory-moon-active \.bottom-app-nav[\s\S]*?display: none/);
  assert.match(androidActivity, /useWideViewPort = true/);
  assert.match(androidActivity, /loadWithOverviewMode = false/);
});

test("the Czech shell lazy-loads the versioned Godot bundle through a same-origin host contract", () => {
  assert.match(index, /id="memoryMoonGame"[\s\S]*?data-src="\/games\/memory-moon\/godot-v1\/index\.html"/);
  assert.doesNotMatch(index, /<iframe[\s\S]*?\ssrc="\/games\/memory-moon\//);
  assert.match(index, /id="memoryMoonGame"[\s\S]*?aria-hidden="true"[\s\S]*?tabindex="-1"/);
  assert.match(index, /id="memoryMoonStage" aria-busy="true"/);
  assert.match(app, /function ensureMemoryMoonLoaded\(\)/);
  assert.match(app, /event\.origin !== window\.location\.origin/);
  assert.match(app, /event\.source !== frame\.contentWindow/);
  assert.match(app, /event\.data\?\.source !== "caatuu-memory-moon"/);
  assert.match(app, /frame\.removeAttribute\("aria-hidden"\)/);
  assert.match(app, /stage\?\.setAttribute\("aria-busy", "false"\)/);
  assert.match(app, /activeTab === "memory-moon"[\s\S]*?ensureMemoryMoonLoaded\(\)/);
  assert.match(gameScript, /JavaScriptBridge\.eval/);
  assert.match(gameScript, /"source": "caatuu-memory-moon"/);
  assert.match(styles, /\.memory-moon-game\.is-ready/);
  assert.match(styles, /prefers-reduced-motion[\s\S]*?\.memory-moon-loader[\s\S]*?animation: none/);
  assert.match(
    serviceWorker,
    /url\.pathname\.includes\("\/games\/memory-moon\/"\)[\s\S]*?networkThenCache\(request\)/
  );
});

test("generated engine payloads stay reproducible and untracked", () => {
  assert.match(gitignore, /\*\*\/\.godot\//);
  assert.match(gitignore, /^artifacts\/$/m);
  assert.match(exporter, /for artifact in index\.html index\.js index\.pck index\.wasm/);
});
