extends SceneTree

const WorldScenery := preload("res://scripts/world_scenery.gd")
const ClickNavigationScript := preload("res://scripts/click_navigation.gd")
const CATALOG_PATH := "res://assets/scenery/memory-moon-style-v1/catalog.json"
const LAYOUT_PATH := "res://assets/scenery/memory-grove-v6/layout.json"
const LAYOUT_ROOT := "res://assets/scenery/memory-grove-v6/"
const STYLE_ROOT := "res://assets/scenery/memory-moon-style-v1/"
const EXPECTED_SCHEMA_VERSION := 2
const EXPECTED_CATALOG_ID := "memory-moon-style-v1"
const EXPECTED_LAYOUT_ID := "memory-grove-v6"
const EXPECTED_PROJECTION_ID := "isometric-orthographic-45-30"
const EXPECTED_TERRAIN_TEXTURE := "terrain/moonroot-reusable-tiles-v1.png"
const EXPECTED_TERRAIN_IMAGE_SIZE := Vector2i(832, 1040)
const EXPECTED_TERRAIN_TILE_SIZE := Vector2i(208, 208)
const EXPECTED_TERRAIN_TILE_CONTENT_SIZE := Vector2i(192, 192)
const EXPECTED_TERRAIN_TILE_GUTTER := 8
const EXPECTED_TERRAIN_ATLAS_GRID := Vector2i(4, 5)
const EXPECTED_TERRAIN_ATLAS_TILES := 20
const EXPECTED_TERRAIN_USED_TILE_TYPES := 16
const EXPECTED_TERRAIN_MAP_SIZE := Vector2i(12, 12)
const EXPECTED_TERRAIN_MAP_TILES := 144
const EXPECTED_TERRAIN_WORLD_TILE_SIZE := 1.0
const EXPECTED_TERRAIN_PADDING_TILES := 6
const EXPECTED_TERRAIN_PADDING_TILE_INDEX := 0
const EXPECTED_TERRAIN_CHUNK_SIZE_TILES := 3
const EXPECTED_TERRAIN_STREAM_RADIUS_CHUNKS := 2
const EXPECTED_TERRAIN_RENDER_SIZE := Vector2i(24, 24)
const EXPECTED_TERRAIN_CHUNK_GRID := Vector2i(8, 8)
const EXPECTED_TERRAIN_TOTAL_CHUNKS := 64
const EXPECTED_TERRAIN_LOADED_CHUNKS := 25
const EXPECTED_TERRAIN_TOTAL_RENDER_TILES := 576
const EXPECTED_TERRAIN_LOADED_RENDER_TILES := 225
const EXPECTED_TERRAIN_FOCUS_CHUNK := Vector2i(4, 5)
const EXPECTED_TERRAIN_PIXELS_PER_WORLD_UNIT := 192.0
const EXPECTED_TERRAIN_PROJECTION := "top-down"
const EXPECTED_TERRAIN_RENDER_ROLE := "streamed-reusable-tile-map"
const EXPECTED_PATH_FIRST_INDEX := 4
const EXPECTED_PATH_NORTH_BIT := 1
const EXPECTED_PATH_EAST_BIT := 2
const EXPECTED_PATH_SOUTH_BIT := 4
const EXPECTED_PATH_WEST_BIT := 8
const FORBIDDEN_PATH_PARTS := ["launcher", "originals", "miscellaneous", "visual-vocabulary"]
const EPSILON := 0.0001

var _catalog: Dictionary = {}
var _layout: Dictionary = {}
var _failures: Array[String] = []


func _init() -> void:
	call_deferred("_verify")


func _verify() -> void:
	_catalog = _read_json_object(CATALOG_PATH, "catalog")
	_layout = _read_json_object(LAYOUT_PATH, "layout")
	if not _catalog.is_empty() and not _layout.is_empty():
		_verify_data_contracts()
	if not _failures.is_empty():
		_finish(null)
		return

	var packed_scene := load("res://main.tscn") as PackedScene
	_check(packed_scene != null, "main.tscn must load as a PackedScene")
	if packed_scene == null:
		_finish(null)
		return
	var instance := packed_scene.instantiate()
	get_root().add_child(instance)
	await process_frame
	await process_frame

	var world := instance as Node3D
	_check(world != null, "MemoryMoon world must be the running scene root")
	if world == null:
		_finish(instance)
		return
	var grove := world.get_node_or_null("MemoryGrove") as Node3D
	_check(grove != null, "MemoryGrove must exist in the running scene")
	if grove == null:
		_finish(instance)
		return
	_check(WorldScenery.LAYOUT_ID == EXPECTED_LAYOUT_ID, "runtime layout constant must select v6")
	_check(WorldScenery.CATALOG_PATH == CATALOG_PATH, "runtime catalog path changed")
	_check(WorldScenery.LAYOUT_PATH == LAYOUT_PATH, "runtime layout path changed")
	_check(WorldScenery.STYLE_ROOT == STYLE_ROOT, "runtime style root changed")
	var grove_loaded := bool(grove.get_meta("loaded", false))
	_check(grove_loaded, "MemoryGrove must report a successful data load")
	_check(String(grove.get_meta("layout_id", "")) == EXPECTED_LAYOUT_ID, "MemoryGrove must expose the v6 layout id")
	_check(String(grove.get_meta("catalog_id", "")) == EXPECTED_CATALOG_ID, "MemoryGrove must expose the style catalog id")
	_check(
		int(grove.get_meta("catalog_version", 0)) == int(_catalog["catalog_version"]),
		"MemoryGrove catalog version must match catalog.json",
	)
	_check(
		String(grove.get_meta("projection_id", "")) == EXPECTED_PROJECTION_ID,
		"MemoryGrove projection metadata changed",
	)
	_check((grove.get_meta("validation_errors", []) as Array).is_empty(), "MemoryGrove must have no validation errors")
	_check((grove.get_meta("missing_assets", []) as Array).is_empty(), "MemoryGrove must have no missing assets")
	if not grove_loaded:
		_finish(instance)
		return

	var terrain_surface := grove.get_node_or_null("TerrainSurface") as Node3D
	var prop_layers := grove.get_node_or_null("PropLayers") as Node3D
	var solid_props := grove.get_node_or_null("SolidProps") as Node3D
	var boundary_colliders := grove.get_node_or_null("BoundaryColliders") as Node3D
	_check(terrain_surface != null, "MemoryGrove/TerrainSurface must exist")
	_check(prop_layers != null, "MemoryGrove/PropLayers must exist")
	_check(solid_props != null, "MemoryGrove/SolidProps must exist")
	_check(boundary_colliders != null, "MemoryGrove/BoundaryColliders must exist")
	if terrain_surface != null:
		_verify_terrain(grove, terrain_surface)
	if prop_layers != null:
		_verify_prop_layers(grove, prop_layers)
	if solid_props != null:
		_verify_solid_props(grove, solid_props)
	if boundary_colliders != null:
		_verify_boundaries(grove, boundary_colliders)
	_verify_navigation(grove)
	_verify_shadow_contract(grove)
	_finish(instance)


func _read_json_object(path: String, label: String) -> Dictionary:
	_check(FileAccess.file_exists(path), "%s JSON must exist at %s" % [label, path])
	if not FileAccess.file_exists(path):
		return {}
	var parser := JSON.new()
	var parse_result := parser.parse(FileAccess.get_file_as_string(path))
	_check(
		parse_result == OK,
		"%s JSON must parse at line %d: %s" % [label, parser.get_error_line(), parser.get_error_message()],
	)
	if parse_result != OK:
		return {}
	_check(typeof(parser.data) == TYPE_DICTIONARY, "%s JSON root must be an object" % label)
	if typeof(parser.data) != TYPE_DICTIONARY:
		return {}
	var parsed: Dictionary = parser.data
	_check(not parsed.is_empty(), "%s JSON root must not be empty" % label)
	return parsed


func _verify_data_contracts() -> void:
	var catalog_keys := [
		"schema_version",
		"catalog_id",
		"catalog_version",
		"release_status",
		"projection",
		"style_family",
		"floor_atlas",
		"collision_profiles",
		"objects",
	]
	var layout_keys := [
		"schema_version",
		"layout_id",
		"catalog_id",
		"catalog_version",
		"projection_id",
		"terrain",
		"placements",
		"boundaries",
		"spawn_points",
		"critical_routes",
	]
	_require_keys(_catalog, catalog_keys, "catalog")
	_require_keys(_layout, layout_keys, "layout")
	if not _has_keys(_catalog, catalog_keys) or not _has_keys(_layout, layout_keys):
		return
	_check(_is_integral_number(_catalog["schema_version"]) and int(_catalog["schema_version"]) == EXPECTED_SCHEMA_VERSION, "catalog schema_version must be integer 2")
	_check(_is_integral_number(_layout["schema_version"]) and int(_layout["schema_version"]) == EXPECTED_SCHEMA_VERSION, "layout schema_version must be integer 2")
	_check(String(_catalog["catalog_id"]) == EXPECTED_CATALOG_ID, "catalog id changed")
	_check(String(_layout["layout_id"]) == EXPECTED_LAYOUT_ID, "layout id changed")
	_check(String(_layout["catalog_id"]) == EXPECTED_CATALOG_ID, "layout catalog id changed")
	_check(_layout["catalog_version"] == _catalog["catalog_version"], "layout and catalog versions must match")
	_check(String(_layout["projection_id"]) == EXPECTED_PROJECTION_ID, "layout projection id changed")
	_check(typeof(_catalog["projection"]) == TYPE_DICTIONARY, "catalog projection must be an object")
	if typeof(_catalog["projection"]) == TYPE_DICTIONARY:
		var projection: Dictionary = _catalog["projection"]
		_check(String(projection.get("id", "")) == EXPECTED_PROJECTION_ID, "catalog projection id changed")
		_check(_number_matches(projection.get("yaw_degrees", null), 45.0), "catalog yaw must remain 45 degrees")
		_check(_number_matches(projection.get("elevation_degrees", null), 30.0), "catalog elevation must remain 30 degrees")
	_verify_floor_catalog()
	_verify_object_catalog()
	_verify_layout_data()


func _verify_floor_catalog() -> void:
	_check(typeof(_catalog["floor_atlas"]) == TYPE_DICTIONARY, "catalog floor_atlas must be an object")
	if typeof(_catalog["floor_atlas"]) != TYPE_DICTIONARY:
		return
	var atlas: Dictionary = _catalog["floor_atlas"]
	_require_keys(atlas, ["texture", "size_px", "gutter_px", "tiles"], "catalog.floor_atlas")
	if not _has_keys(atlas, ["texture", "size_px", "gutter_px", "tiles"]):
		return
	var atlas_path := _verify_catalog_texture_path(String(atlas["texture"]), "floor atlas", "floor/")
	_check(_valid_number_array(atlas["size_px"], 2, true), "floor atlas size_px must contain two positive numbers")
	_check(_is_number(atlas["gutter_px"]) and float(atlas["gutter_px"]) >= 0.0, "floor atlas gutter must be non-negative")
	_check(typeof(atlas["tiles"]) == TYPE_DICTIONARY and not (atlas["tiles"] as Dictionary).is_empty(), "floor atlas tiles must be a non-empty object")
	# The style atlas remains a validated material-source contract, while v6
	# renders its separate layout-owned reusable terrain vocabulary.
	_check(not atlas_path.is_empty(), "floor atlas catalog path must remain safe")
	if typeof(atlas["tiles"]) != TYPE_DICTIONARY or not _valid_number_array(atlas["size_px"], 2, true):
		return
	var atlas_size := _array_to_vector2(atlas["size_px"])
	for tile_id_variant in (atlas["tiles"] as Dictionary).keys():
		var tile_id := String(tile_id_variant)
		var tile_value: Variant = (atlas["tiles"] as Dictionary)[tile_id]
		_check(typeof(tile_value) == TYPE_DICTIONARY, "floor tile '%s' must be an object" % tile_id)
		if typeof(tile_value) != TYPE_DICTIONARY:
			continue
		var tile: Dictionary = tile_value
		var required := ["kind", "tags", "uv_rect_px", "grid_size", "walkable", "edges", "allowed_rotations_degrees", "seam_contract"]
		_require_keys(tile, required, "floor tile '%s'" % tile_id)
		if not tile.has("uv_rect_px"):
			continue
		_check(_valid_number_array(tile["uv_rect_px"], 4, true), "floor tile '%s' UV rect must contain four positive numbers" % tile_id)
		if _valid_number_array(tile["uv_rect_px"], 4, true):
			var values: Array = tile["uv_rect_px"]
			var rect := Rect2(float(values[0]), float(values[1]), float(values[2]), float(values[3]))
			_check(rect.position.x >= 0.0 and rect.position.y >= 0.0 and rect.end.x <= atlas_size.x and rect.end.y <= atlas_size.y, "floor tile '%s' UV rect must stay inside atlas" % tile_id)
		_check(typeof(tile.get("walkable", null)) == TYPE_BOOL, "floor tile '%s' walkable must be boolean" % tile_id)
		_check(typeof(tile.get("edges", null)) == TYPE_DICTIONARY, "floor tile '%s' edges must be an object" % tile_id)
		if typeof(tile.get("edges", null)) == TYPE_DICTIONARY:
			_require_keys(tile["edges"], ["north", "east", "south", "west"], "floor tile '%s' edges" % tile_id)
		_check(String(tile.get("seam_contract", "")) == "opposite-edge-exact", "floor tile '%s' seam contract changed" % tile_id)


func _verify_object_catalog() -> void:
	_check(typeof(_catalog["collision_profiles"]) == TYPE_DICTIONARY, "collision_profiles must be an object")
	_check(typeof(_catalog["objects"]) == TYPE_DICTIONARY and not (_catalog["objects"] as Dictionary).is_empty(), "objects must be a non-empty object")
	if typeof(_catalog["collision_profiles"]) != TYPE_DICTIONARY or typeof(_catalog["objects"]) != TYPE_DICTIONARY:
		return
	var profiles: Dictionary = _catalog["collision_profiles"]
	for profile_id_variant in profiles.keys():
		var profile_id := String(profile_id_variant)
		var profile_value: Variant = profiles[profile_id]
		_check(typeof(profile_value) == TYPE_DICTIONARY, "collision profile '%s' must be an object" % profile_id)
		if typeof(profile_value) != TYPE_DICTIONARY:
			continue
		var profile: Dictionary = profile_value
		_check(typeof(profile.get("shapes", null)) == TYPE_ARRAY, "collision profile '%s' shapes must be an array" % profile_id)
		if typeof(profile.get("shapes", null)) != TYPE_ARRAY:
			continue
		for descriptor_index in (profile["shapes"] as Array).size():
			_verify_shape_descriptor((profile["shapes"] as Array)[descriptor_index], "collision profile '%s' shape %d" % [profile_id, descriptor_index])

	var required_object_keys := ["texture", "image_size_px", "anchor_px", "kind", "tags", "source_id", "default_world_height", "allowed_world_height", "collision_profile", "collision_scale_mode", "occlusion", "reuse"]
	for object_id_variant in (_catalog["objects"] as Dictionary).keys():
		var object_id := String(object_id_variant)
		var object_value: Variant = (_catalog["objects"] as Dictionary)[object_id]
		_check(typeof(object_value) == TYPE_DICTIONARY, "object '%s' must be an object" % object_id)
		if typeof(object_value) != TYPE_DICTIONARY:
			continue
		var definition: Dictionary = object_value
		_require_keys(definition, required_object_keys, "object '%s'" % object_id)
		if not _has_keys(definition, required_object_keys):
			continue
		var texture_path := _verify_catalog_texture_path(String(definition["texture"]), "object '%s'" % object_id, "objects/")
		_check(_valid_number_array(definition["image_size_px"], 2, true), "object '%s' image_size_px is invalid" % object_id)
		_check(_valid_number_array(definition["anchor_px"], 2, false), "object '%s' anchor_px is invalid" % object_id)
		if _valid_number_array(definition["image_size_px"], 2, true) and _valid_number_array(definition["anchor_px"], 2, false):
			var image_size := _array_to_vector2(definition["image_size_px"])
			var anchor := _array_to_vector2(definition["anchor_px"])
			_check(anchor.x >= 0.0 and anchor.y >= 0.0 and anchor.x <= image_size.x and anchor.y <= image_size.y, "object '%s' anchor must stay inside the image" % object_id)
			if not texture_path.is_empty():
				_verify_texture(texture_path, image_size, true)
		_check(profiles.has(String(definition["collision_profile"])), "object '%s' collision profile is unknown" % object_id)
		_check(String(definition["collision_scale_mode"]) in ["fixed", "with-visual"], "object '%s' collision scale mode is invalid" % object_id)
		_check(typeof(definition["occlusion"]) == TYPE_DICTIONARY and String((definition["occlusion"] as Dictionary).get("mode", "")) == "depth", "object '%s' must use depth-only occlusion" % object_id)
		_check(typeof(definition["reuse"]) == TYPE_DICTIONARY, "object '%s' reuse must be an object" % object_id)


func _verify_shape_descriptor(value: Variant, context: String) -> void:
	_check(typeof(value) == TYPE_DICTIONARY, "%s must be an object" % context)
	if typeof(value) != TYPE_DICTIONARY:
		return
	var descriptor: Dictionary = value
	var shape_type := String(descriptor.get("type", ""))
	if shape_type == "cylinder":
		_require_keys(descriptor, ["type", "radius", "height", "offset"], context)
		_check(_is_number(descriptor.get("radius", null)) and float(descriptor.get("radius", 0.0)) > 0.0, "%s cylinder radius is invalid" % context)
		_check(_is_number(descriptor.get("height", null)) and float(descriptor.get("height", 0.0)) > 0.0, "%s cylinder height is invalid" % context)
	elif shape_type == "box":
		_require_keys(descriptor, ["type", "size", "offset"], context)
		_check(_valid_number_array(descriptor.get("size", null), 3, true), "%s box size is invalid" % context)
	else:
		_check(false, "%s type must be cylinder or box" % context)
	_check(_valid_number_array(descriptor.get("offset", null), 3, false), "%s offset is invalid" % context)


func _verify_layout_data() -> void:
	_check(typeof(_layout["terrain"]) == TYPE_DICTIONARY, "layout terrain must be an object")
	_check(typeof(_layout["placements"]) == TYPE_ARRAY, "layout placements must be an array")
	_check(typeof(_layout["boundaries"]) == TYPE_ARRAY, "layout boundaries must be an array")
	_check(typeof(_layout["spawn_points"]) == TYPE_ARRAY and not (_layout["spawn_points"] as Array).is_empty(), "layout spawn_points must be a non-empty array")
	_check(typeof(_layout["critical_routes"]) == TYPE_ARRAY and not (_layout["critical_routes"] as Array).is_empty(), "layout critical_routes must be a non-empty array")
	if typeof(_layout["terrain"]) != TYPE_DICTIONARY:
		return
	var terrain: Dictionary = _layout["terrain"]
	var required_terrain_keys := [
		"columns",
		"rows",
		"cell_size",
		"tile_legend",
		"tile_rows",
		"render_tiles",
		"tile_index_rows",
	]
	_require_keys(terrain, required_terrain_keys, "layout.terrain")
	if not _has_keys(terrain, required_terrain_keys):
		return
	_check(_is_integral_number(terrain["columns"]) and int(terrain["columns"]) > 0, "terrain columns must be a positive integer")
	_check(_is_integral_number(terrain["rows"]) and int(terrain["rows"]) > 0, "terrain rows must be a positive integer")
	_check(_is_number(terrain["cell_size"]) and float(terrain["cell_size"]) > 0.0, "terrain cell_size must be positive")
	_check(typeof(terrain["tile_legend"]) == TYPE_DICTIONARY, "terrain tile_legend must be an object")
	_check(typeof(terrain["tile_rows"]) == TYPE_ARRAY, "terrain tile_rows must be an array")
	_verify_render_tiles_data(terrain["render_tiles"], terrain["tile_index_rows"])
	if typeof(terrain["tile_legend"]) != TYPE_DICTIONARY or typeof(terrain["tile_rows"]) != TYPE_ARRAY:
		return
	var legend: Dictionary = terrain["tile_legend"]
	var tiles: Dictionary = (_catalog["floor_atlas"] as Dictionary)["tiles"]
	for symbol_variant in legend.keys():
		var symbol := String(symbol_variant)
		_check(symbol.length() == 1, "terrain legend symbol '%s' must be one character" % symbol)
		_check(tiles.has(String(legend[symbol_variant])), "terrain legend symbol '%s' references an unknown tile" % symbol)
	var tile_rows: Array = terrain["tile_rows"]
	_check(tile_rows.size() == int(terrain["rows"]), "terrain tile row count changed")
	for row_index in tile_rows.size():
		_check(typeof(tile_rows[row_index]) == TYPE_STRING, "terrain row %d must be a string" % row_index)
		if typeof(tile_rows[row_index]) != TYPE_STRING:
			continue
		var row_text := String(tile_rows[row_index])
		_check(row_text.length() == int(terrain["columns"]), "terrain row %d width changed" % row_index)
		for column in row_text.length():
			_check(legend.has(row_text.substr(column, 1)), "terrain row %d column %d uses an unknown symbol" % [row_index, column])
	_verify_placement_data()


func _verify_render_tiles_data(value: Variant, index_rows_value: Variant) -> void:
	_check(typeof(value) == TYPE_DICTIONARY, "layout terrain render_tiles must be an object")
	if typeof(value) != TYPE_DICTIONARY:
		return
	var render_tiles: Dictionary = value
	var required := [
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
		"pixels_per_world_unit",
		"projection",
		"render_role",
		"source_id",
		"tile_ids",
		"path_connectivity",
	]
	_require_keys(render_tiles, required, "layout.terrain.render_tiles")
	if not _has_keys(render_tiles, required):
		return

	var texture_path := _verify_layout_texture_path(
		String(render_tiles["texture"]),
		"terrain reusable-tile atlas",
		"terrain/",
	)
	_check(String(render_tiles["texture"]) == EXPECTED_TERRAIN_TEXTURE, "terrain must use the exact v6 reusable-tile atlas")
	_check(
		_valid_number_array(render_tiles["image_size_px"], 2, true),
		"render_tiles image_size_px must contain two positive numbers",
	)
	_check(
		_valid_number_array(render_tiles["tile_size_px"], 2, true),
		"render_tiles tile_size_px must contain two positive numbers",
	)
	_check(
		_valid_number_array(render_tiles["tile_content_size_px"], 2, true),
		"render_tiles tile_content_size_px must contain two positive numbers",
	)
	_check(
		_valid_number_array(render_tiles["atlas_grid"], 2, true),
		"render_tiles atlas_grid must contain two positive numbers",
	)
	_check(_is_integral_number(render_tiles["tile_gutter_px"]) and int(render_tiles["tile_gutter_px"]) == EXPECTED_TERRAIN_TILE_GUTTER, "terrain tile gutter must remain 8 texels")
	_check(_number_matches(render_tiles["world_tile_size"], EXPECTED_TERRAIN_WORLD_TILE_SIZE), "terrain world tile size must remain 1")
	_check(_is_integral_number(render_tiles["chunk_size_tiles"]) and int(render_tiles["chunk_size_tiles"]) == EXPECTED_TERRAIN_CHUNK_SIZE_TILES, "terrain chunk size must remain 3 tiles")
	_check(_is_integral_number(render_tiles["stream_radius_chunks"]) and int(render_tiles["stream_radius_chunks"]) == EXPECTED_TERRAIN_STREAM_RADIUS_CHUNKS, "terrain stream radius must remain 2 chunks")
	_check(_is_integral_number(render_tiles["padding_tiles"]) and int(render_tiles["padding_tiles"]) == EXPECTED_TERRAIN_PADDING_TILES, "terrain padding must remain 6 tiles")
	_check(_is_integral_number(render_tiles["padding_tile_index"]) and int(render_tiles["padding_tile_index"]) == EXPECTED_TERRAIN_PADDING_TILE_INDEX, "terrain padding must use reusable grass tile 0")
	_check(
		_number_matches(render_tiles["pixels_per_world_unit"], EXPECTED_TERRAIN_PIXELS_PER_WORLD_UNIT),
		"terrain content density must remain 192 pixels per world unit",
	)
	_check(
		String(render_tiles["projection"]) == EXPECTED_TERRAIN_PROJECTION,
		"terrain projection must remain top-down",
	)
	_check(String(render_tiles["render_role"]) == EXPECTED_TERRAIN_RENDER_ROLE, "terrain render role must remain streamed-reusable-tile-map")
	_check(not String(render_tiles["source_id"]).is_empty(), "terrain source_id must not be empty")

	var image_size := _array_to_vector2i(render_tiles["image_size_px"]) if _valid_number_array(render_tiles["image_size_px"], 2, true) else Vector2i.ZERO
	var tile_size := _array_to_vector2i(render_tiles["tile_size_px"]) if _valid_number_array(render_tiles["tile_size_px"], 2, true) else Vector2i.ZERO
	var content_size := _array_to_vector2i(render_tiles["tile_content_size_px"]) if _valid_number_array(render_tiles["tile_content_size_px"], 2, true) else Vector2i.ZERO
	var atlas_grid := _array_to_vector2i(render_tiles["atlas_grid"]) if _valid_number_array(render_tiles["atlas_grid"], 2, true) else Vector2i.ZERO
	var gutter := int(render_tiles["tile_gutter_px"]) if _is_integral_number(render_tiles["tile_gutter_px"]) else -1
	var atlas_tile_count := atlas_grid.x * atlas_grid.y
	_check(image_size == EXPECTED_TERRAIN_IMAGE_SIZE, "terrain atlas must remain 832x1040 texels")
	_check(tile_size == EXPECTED_TERRAIN_TILE_SIZE, "terrain atlas cells must remain 208x208 texels")
	_check(content_size == EXPECTED_TERRAIN_TILE_CONTENT_SIZE, "terrain tile content must remain 192x192 texels")
	_check(atlas_grid == EXPECTED_TERRAIN_ATLAS_GRID, "terrain atlas grid must remain 4x5")
	_check(atlas_tile_count == EXPECTED_TERRAIN_ATLAS_TILES, "terrain atlas must contain exactly 20 reusable tile types")
	_check(tile_size * atlas_grid == image_size, "terrain tile grid must exactly cover the atlas")
	_check(tile_size == content_size + Vector2i.ONE * gutter * 2, "terrain atlas cells must contain content plus an 8-texel gutter on every edge")
	if content_size != Vector2i.ZERO:
		_check(
			_number_matches(float(content_size.x) / float(render_tiles["world_tile_size"]), EXPECTED_TERRAIN_PIXELS_PER_WORLD_UNIT)
			and _number_matches(float(content_size.y) / float(render_tiles["world_tile_size"]), EXPECTED_TERRAIN_PIXELS_PER_WORLD_UNIT),
			"terrain tile content must render at its natural texel density",
		)
	if not texture_path.is_empty() and image_size != Vector2i.ZERO:
		_verify_texture(texture_path, Vector2(image_size), false)

	_check(typeof(render_tiles["tile_ids"]) == TYPE_ARRAY, "render_tiles tile_ids must be an array")
	var tile_ids: Array = render_tiles["tile_ids"] if typeof(render_tiles["tile_ids"]) == TYPE_ARRAY else []
	_check(tile_ids.size() == EXPECTED_TERRAIN_ATLAS_TILES, "render_tiles tile_ids must contain one id per atlas cell")
	var unique_tile_ids: Dictionary = {}
	for tile_id_variant in tile_ids:
		var tile_id := String(tile_id_variant)
		_check(not tile_id.is_empty(), "render_tiles tile_ids must not contain empty ids")
		_check(not unique_tile_ids.has(tile_id), "render_tiles tile_ids must be unique")
		unique_tile_ids[tile_id] = true
	if tile_ids.size() == EXPECTED_TERRAIN_ATLAS_TILES:
		_check(String(tile_ids[EXPECTED_PATH_FIRST_INDEX]) == "path-isolated", "path mask 0 must use the path-isolated tile")
		_check(String(tile_ids[EXPECTED_PATH_FIRST_INDEX + 15]) == "path-nesw", "path mask 15 must use the path-nesw tile")

	_check(typeof(index_rows_value) == TYPE_ARRAY, "terrain tile_index_rows must be an array")
	if typeof(index_rows_value) != TYPE_ARRAY:
		return
	var index_rows: Array = index_rows_value
	_check(index_rows.size() == EXPECTED_TERRAIN_MAP_SIZE.y, "terrain tile map must contain 12 rows")
	var used_indices: Dictionary = {}
	var map_entry_count := 0
	for row_index in index_rows.size():
		_check(typeof(index_rows[row_index]) == TYPE_ARRAY, "terrain tile-map row %d must be an array" % row_index)
		if typeof(index_rows[row_index]) != TYPE_ARRAY:
			continue
		var row: Array = index_rows[row_index]
		_check(row.size() == EXPECTED_TERRAIN_MAP_SIZE.x, "terrain tile-map row %d must contain 12 entries" % row_index)
		map_entry_count += row.size()
		for column_index in row.size():
			var value_at_cell: Variant = row[column_index]
			_check(_is_integral_number(value_at_cell), "terrain tile-map entry %d,%d must be an integer" % [column_index, row_index])
			if not _is_integral_number(value_at_cell):
				continue
			var atlas_index := int(value_at_cell)
			_check(atlas_index >= 0 and atlas_index < EXPECTED_TERRAIN_ATLAS_TILES, "terrain tile-map entry %d,%d must reference the reusable atlas" % [column_index, row_index])
			if atlas_index >= 0 and atlas_index < EXPECTED_TERRAIN_ATLAS_TILES:
				used_indices[atlas_index] = true
	_check(map_entry_count == EXPECTED_TERRAIN_MAP_TILES, "terrain tile map must contain exactly 144 authored entries")
	_check(EXPECTED_TERRAIN_ATLAS_TILES < map_entry_count, "terrain must reuse a smaller atlas vocabulary across the authored map")
	_check(used_indices.size() == EXPECTED_TERRAIN_USED_TILE_TYPES, "terrain map must use exactly 16 reusable tile types")
	_check(used_indices.size() < map_entry_count, "terrain map entries must repeat reusable atlas tiles")
	_verify_path_connectivity(index_rows, render_tiles)


func _verify_path_connectivity(index_rows: Array, render_tiles: Dictionary) -> void:
	_check(typeof(render_tiles["path_connectivity"]) == TYPE_DICTIONARY, "render_tiles path_connectivity must be an object")
	if typeof(render_tiles["path_connectivity"]) != TYPE_DICTIONARY:
		return
	var connectivity: Dictionary = render_tiles["path_connectivity"]
	var required := ["first_index", "north_bit", "east_bit", "south_bit", "west_bit"]
	_require_keys(connectivity, required, "layout.terrain.render_tiles.path_connectivity")
	if not _has_keys(connectivity, required):
		return
	_check(_is_integral_number(connectivity["first_index"]) and int(connectivity["first_index"]) == EXPECTED_PATH_FIRST_INDEX, "path tiles must begin at atlas index 4")
	_check(_is_integral_number(connectivity["north_bit"]) and int(connectivity["north_bit"]) == EXPECTED_PATH_NORTH_BIT, "path north bit must remain 1")
	_check(_is_integral_number(connectivity["east_bit"]) and int(connectivity["east_bit"]) == EXPECTED_PATH_EAST_BIT, "path east bit must remain 2")
	_check(_is_integral_number(connectivity["south_bit"]) and int(connectivity["south_bit"]) == EXPECTED_PATH_SOUTH_BIT, "path south bit must remain 4")
	_check(_is_integral_number(connectivity["west_bit"]) and int(connectivity["west_bit"]) == EXPECTED_PATH_WEST_BIT, "path west bit must remain 8")

	for row_index in index_rows.size():
		if typeof(index_rows[row_index]) != TYPE_ARRAY:
			continue
		var row: Array = index_rows[row_index]
		for column_index in row.size():
			if not _is_integral_number(row[column_index]):
				continue
			var atlas_index := int(row[column_index])
			var mask := _terrain_path_mask(atlas_index)
			if atlas_index >= EXPECTED_PATH_FIRST_INDEX:
				_check(atlas_index < EXPECTED_PATH_FIRST_INDEX + 16, "path tile %d,%d must fit the four-bit topology vocabulary" % [column_index, row_index])

			if column_index + 1 < row.size() and _is_integral_number(row[column_index + 1]):
				var east_mask := _terrain_path_mask(int(row[column_index + 1]))
				_check(
					bool(mask & EXPECTED_PATH_EAST_BIT) == bool(east_mask & EXPECTED_PATH_WEST_BIT),
					"path connectivity must agree east/west at %d,%d" % [column_index, row_index],
				)
			else:
				_check((mask & EXPECTED_PATH_EAST_BIT) == 0, "path must not exit the east map edge at %d,%d" % [column_index, row_index])

			if row_index + 1 < index_rows.size() and typeof(index_rows[row_index + 1]) == TYPE_ARRAY:
				var south_row: Array = index_rows[row_index + 1]
				if column_index < south_row.size() and _is_integral_number(south_row[column_index]):
					var south_mask := _terrain_path_mask(int(south_row[column_index]))
					_check(
						bool(mask & EXPECTED_PATH_SOUTH_BIT) == bool(south_mask & EXPECTED_PATH_NORTH_BIT),
						"path connectivity must agree north/south at %d,%d" % [column_index, row_index],
					)
			else:
				_check((mask & EXPECTED_PATH_SOUTH_BIT) == 0, "path must not exit the south map edge at %d,%d" % [column_index, row_index])

			if column_index == 0:
				_check((mask & EXPECTED_PATH_WEST_BIT) == 0, "path must not exit the west map edge at %d,%d" % [column_index, row_index])
			if row_index == 0:
				_check((mask & EXPECTED_PATH_NORTH_BIT) == 0, "path must not exit the north map edge at %d,%d" % [column_index, row_index])


func _terrain_path_mask(atlas_index: int) -> int:
	if atlas_index < EXPECTED_PATH_FIRST_INDEX or atlas_index >= EXPECTED_PATH_FIRST_INDEX + 16:
		return 0
	return atlas_index - EXPECTED_PATH_FIRST_INDEX


func _verify_placement_data() -> void:
	if typeof(_layout["placements"]) != TYPE_ARRAY:
		return
	var objects: Dictionary = _catalog["objects"]
	var ids: Dictionary = {}
	for placement_index in (_layout["placements"] as Array).size():
		var placement_value: Variant = (_layout["placements"] as Array)[placement_index]
		_check(typeof(placement_value) == TYPE_DICTIONARY, "placement %d must be an object" % placement_index)
		if typeof(placement_value) != TYPE_DICTIONARY:
			continue
		var placement: Dictionary = placement_value
		var required := ["id", "object", "position", "scale", "layer", "flip_horizontal", "collision_enabled", "tags"]
		_require_keys(placement, required, "placement %d" % placement_index)
		if not _has_keys(placement, required):
			continue
		var placement_id := String(placement["id"])
		_check(not placement_id.is_empty() and not ids.has(placement_id), "placement id '%s' must be non-empty and unique" % placement_id)
		ids[placement_id] = true
		_check(objects.has(String(placement["object"])), "placement '%s' references an unknown object" % placement_id)
		_check(_valid_number_array(placement["position"], 2, false), "placement '%s' position is invalid" % placement_id)
		_check(_is_number(placement["scale"]) and float(placement["scale"]) > 0.0, "placement '%s' scale is invalid" % placement_id)
		_check(String(placement["layer"]) in ["back", "middle", "front"], "placement '%s' layer is invalid" % placement_id)
		_check(typeof(placement["flip_horizontal"]) == TYPE_BOOL, "placement '%s' flip must be boolean" % placement_id)
		_check(typeof(placement["collision_enabled"]) == TYPE_BOOL, "placement '%s' collision flag must be boolean" % placement_id)
		if objects.has(String(placement["object"])):
			var definition: Dictionary = objects[String(placement["object"])]
			var desired_height := float(definition["default_world_height"]) * float(placement["scale"])
			var allowed: Array = definition["allowed_world_height"]
			_check(desired_height >= float(allowed[0]) - EPSILON and desired_height <= float(allowed[1]) + EPSILON, "placement '%s' visual height violates its catalog range" % placement_id)


func _verify_terrain(grove: Node3D, terrain_surface: Node3D) -> void:
	var terrain: Dictionary = _layout["terrain"]
	var render_tiles: Dictionary = terrain["render_tiles"]
	var logical_cells := int(terrain["columns"]) * int(terrain["rows"])
	var expected_texture_path := _resolve_layout_path(EXPECTED_TERRAIN_TEXTURE)
	_check(terrain_surface.has_method("configure") and terrain_surface.has_method("set_target"), "TerrainSurface must use the chunk streamer contract")
	_check(bool(terrain_surface.get_meta("configured", false)), "terrain chunk streamer must configure successfully")
	_check(String(terrain_surface.get_meta("failure_message", "")).is_empty(), "terrain chunk streamer must not report a failure")
	_check(String(terrain_surface.get_meta("render_role", "")) == EXPECTED_TERRAIN_RENDER_ROLE, "terrain stream render-role metadata changed")
	_check(String(terrain_surface.get_meta("projection", "")) == EXPECTED_TERRAIN_PROJECTION, "terrain stream projection metadata changed")
	_check(String(terrain_surface.get_meta("source_id", "")) == String(render_tiles["source_id"]), "terrain stream source metadata changed")
	_check(String(terrain_surface.get_meta("texture_path", "")) == expected_texture_path, "terrain stream must expose the exact atlas path")
	_check(terrain_surface.get_meta("image_size_px", Vector2i.ZERO) == EXPECTED_TERRAIN_IMAGE_SIZE, "terrain stream image-size metadata changed")
	_check(terrain_surface.get_meta("tile_size_px", Vector2i.ZERO) == EXPECTED_TERRAIN_TILE_SIZE, "terrain stream tile-size metadata changed")
	_check(terrain_surface.get_meta("tile_content_size_px", Vector2i.ZERO) == EXPECTED_TERRAIN_TILE_CONTENT_SIZE, "terrain stream tile-content metadata changed")
	_check(int(terrain_surface.get_meta("tile_gutter_px", -1)) == EXPECTED_TERRAIN_TILE_GUTTER, "terrain stream tile-gutter metadata changed")
	_check(terrain_surface.get_meta("atlas_grid", Vector2i.ZERO) == EXPECTED_TERRAIN_ATLAS_GRID, "terrain stream atlas-grid metadata changed")
	_check(_number_matches(terrain_surface.get_meta("world_tile_size", null), EXPECTED_TERRAIN_WORLD_TILE_SIZE), "terrain stream world-tile metadata changed")
	_check(_number_matches(terrain_surface.get_meta("pixels_per_world_unit", null), EXPECTED_TERRAIN_PIXELS_PER_WORLD_UNIT), "terrain stream density metadata changed")
	_check(int(terrain_surface.get_meta("chunk_size_tiles", 0)) == EXPECTED_TERRAIN_CHUNK_SIZE_TILES, "terrain stream chunk-size metadata changed")
	_check(int(terrain_surface.get_meta("padding_tiles", -1)) == EXPECTED_TERRAIN_PADDING_TILES, "terrain stream padding metadata changed")
	_check(int(terrain_surface.get_meta("padding_tile_index", -1)) == EXPECTED_TERRAIN_PADDING_TILE_INDEX, "terrain stream padding-tile metadata changed")
	_check(terrain_surface.get_meta("tile_ids", []) == render_tiles["tile_ids"], "terrain stream tile-id vocabulary metadata changed")
	_check(terrain_surface.get_meta("path_connectivity", {}) == render_tiles["path_connectivity"], "terrain stream path-connectivity metadata changed")
	_check(int(terrain_surface.get_meta("stream_radius_chunks", -1)) == EXPECTED_TERRAIN_STREAM_RADIUS_CHUNKS, "terrain stream radius metadata changed")
	_check(terrain_surface.get_meta("logical_size_tiles", Vector2i.ZERO) == EXPECTED_TERRAIN_MAP_SIZE, "terrain stream authored-map metadata changed")
	_check(terrain_surface.get_meta("render_size_tiles", Vector2i.ZERO) == EXPECTED_TERRAIN_RENDER_SIZE, "terrain stream padded-grid metadata changed")
	_check(terrain_surface.get_meta("chunk_grid", Vector2i.ZERO) == EXPECTED_TERRAIN_CHUNK_GRID, "terrain stream chunk-grid metadata changed")
	_check(int(terrain_surface.get_meta("total_chunk_count", 0)) == EXPECTED_TERRAIN_TOTAL_CHUNKS, "terrain stream must expose 64 total chunks")
	_check(int(terrain_surface.get_meta("loaded_chunk_count", 0)) == EXPECTED_TERRAIN_LOADED_CHUNKS, "terrain stream must load the 25-chunk focus window")
	_check(int(terrain_surface.get_meta("total_tile_count", 0)) == EXPECTED_TERRAIN_TOTAL_RENDER_TILES, "terrain stream must expose 576 padded render tiles")
	_check(int(terrain_surface.get_meta("loaded_tile_count", 0)) == EXPECTED_TERRAIN_LOADED_RENDER_TILES, "terrain stream must load 225 render tiles")
	_check(int(terrain_surface.get_meta("logical_tile_count", 0)) == EXPECTED_TERRAIN_MAP_TILES, "terrain stream must expose 144 authored map entries")
	_check(int(terrain_surface.get_meta("surfaces_per_chunk", 0)) == 1, "terrain stream must use one surface per chunk")
	_check(int(terrain_surface.get_meta("loaded_surface_count", 0)) == EXPECTED_TERRAIN_LOADED_CHUNKS, "terrain stream must expose 25 loaded surfaces")
	_check(int(terrain_surface.get_meta("maximum_loaded_chunk_count", 0)) == EXPECTED_TERRAIN_LOADED_CHUNKS, "terrain stream loaded-window cap must remain 25")
	_check(int(terrain_surface.get_meta("shadow_passes", -1)) == 0, "terrain stream must expose zero shadow passes")
	_check(terrain_surface.get_meta("focus_chunk", Vector2i(-1, -1)) == EXPECTED_TERRAIN_FOCUS_CHUNK, "terrain stream focus chunk must match the walker spawn")
	_check(terrain_surface.get_child_count() == EXPECTED_TERRAIN_LOADED_CHUNKS, "terrain stream must contain exactly 25 loaded chunk nodes")

	var chunk_coordinates: Dictionary = {}
	var rendered_tile_count := 0
	var shared_material: StandardMaterial3D
	var expected_uv_span := Vector2(EXPECTED_TERRAIN_TILE_CONTENT_SIZE) / Vector2(EXPECTED_TERRAIN_IMAGE_SIZE)
	for child in terrain_surface.get_children():
		var chunk := child as MeshInstance3D
		_check(chunk != null, "every TerrainSurface child must be a MeshInstance3D chunk")
		if chunk == null:
			continue
		var coordinate: Vector2i = chunk.get_meta("chunk_coordinate", Vector2i(-1, -1))
		_check(
			absi(coordinate.x - EXPECTED_TERRAIN_FOCUS_CHUNK.x) <= EXPECTED_TERRAIN_STREAM_RADIUS_CHUNKS
			and absi(coordinate.y - EXPECTED_TERRAIN_FOCUS_CHUNK.y) <= EXPECTED_TERRAIN_STREAM_RADIUS_CHUNKS,
			"terrain chunk coordinate must remain inside the walker-centered 5x5 window",
		)
		_check(not chunk_coordinates.has(coordinate), "terrain chunk coordinates must be unique")
		chunk_coordinates[coordinate] = true
		var expected_width := mini(EXPECTED_TERRAIN_CHUNK_SIZE_TILES, EXPECTED_TERRAIN_RENDER_SIZE.x - coordinate.x * EXPECTED_TERRAIN_CHUNK_SIZE_TILES)
		var expected_height := mini(EXPECTED_TERRAIN_CHUNK_SIZE_TILES, EXPECTED_TERRAIN_RENDER_SIZE.y - coordinate.y * EXPECTED_TERRAIN_CHUNK_SIZE_TILES)
		var expected_tile_count := expected_width * expected_height
		var tile_count := int(chunk.get_meta("tile_count", 0))
		_check(tile_count == expected_tile_count, "terrain chunk %s tile count changed" % coordinate)
		rendered_tile_count += tile_count
		_check(chunk.mesh is ArrayMesh, "terrain chunk %s must use an ArrayMesh" % coordinate)
		if not chunk.mesh is ArrayMesh:
			continue
		var mesh := chunk.mesh as ArrayMesh
		_check(mesh.get_surface_count() == 1, "terrain chunk %s must contain exactly one surface" % coordinate)
		_check(int(chunk.get_meta("surface_count", 0)) == 1, "terrain chunk %s surface metadata changed" % coordinate)
		if mesh.get_surface_count() != 1:
			continue
		var arrays := mesh.surface_get_arrays(0)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
		var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		_check(vertices.size() == tile_count * 4, "terrain chunk %s vertex count must be four per tile" % coordinate)
		_check(colors.size() == tile_count * 4, "terrain chunk %s color count must be four per tile" % coordinate)
		_check(uvs.size() == tile_count * 4, "terrain chunk %s UV count must be four per tile" % coordinate)
		_check(indices.size() == tile_count * 6, "terrain chunk %s index count must be six per tile" % coordinate)
		_check(int(chunk.get_meta("vertex_count", 0)) == vertices.size(), "terrain chunk %s vertex metadata changed" % coordinate)
		_check(int(chunk.get_meta("index_count", 0)) == indices.size(), "terrain chunk %s index metadata changed" % coordinate)
		for tile_index in tile_count:
			var vertex_offset := tile_index * 4
			if vertices.size() >= vertex_offset + 4:
				_check(_number_matches(vertices[vertex_offset + 1].x - vertices[vertex_offset].x, EXPECTED_TERRAIN_WORLD_TILE_SIZE), "terrain tile world width must remain 1")
				_check(_number_matches(vertices[vertex_offset + 3].z - vertices[vertex_offset].z, EXPECTED_TERRAIN_WORLD_TILE_SIZE), "terrain tile world depth must remain 1")
				for vertex_index in range(vertex_offset, vertex_offset + 4):
					_check(_number_matches(vertices[vertex_index].y, WorldScenery.TERRAIN_Y), "terrain vertices must remain on the terrain plane")
			if uvs.size() >= vertex_offset + 4:
				var tile_uvs := [uvs[vertex_offset], uvs[vertex_offset + 1], uvs[vertex_offset + 2], uvs[vertex_offset + 3]]
				var min_u := minf(minf(tile_uvs[0].x, tile_uvs[1].x), minf(tile_uvs[2].x, tile_uvs[3].x))
				var max_u := maxf(maxf(tile_uvs[0].x, tile_uvs[1].x), maxf(tile_uvs[2].x, tile_uvs[3].x))
				var min_v := minf(minf(tile_uvs[0].y, tile_uvs[1].y), minf(tile_uvs[2].y, tile_uvs[3].y))
				var max_v := maxf(maxf(tile_uvs[0].y, tile_uvs[1].y), maxf(tile_uvs[2].y, tile_uvs[3].y))
				_check(_number_matches(max_u - min_u, expected_uv_span.x), "terrain tile U span must sample content without its gutters")
				_check(_number_matches(max_v - min_v, expected_uv_span.y), "terrain tile V span must sample content without its gutters")
				_check(_number_matches(fposmod(min_u * EXPECTED_TERRAIN_IMAGE_SIZE.x, EXPECTED_TERRAIN_TILE_SIZE.x), EXPECTED_TERRAIN_TILE_GUTTER), "terrain tile U minimum must begin after the atlas gutter")
				_check(_number_matches(fposmod(max_u * EXPECTED_TERRAIN_IMAGE_SIZE.x, EXPECTED_TERRAIN_TILE_SIZE.x), EXPECTED_TERRAIN_TILE_GUTTER + EXPECTED_TERRAIN_TILE_CONTENT_SIZE.x), "terrain tile U maximum must end before the atlas gutter")
				_check(_number_matches(fposmod(min_v * EXPECTED_TERRAIN_IMAGE_SIZE.y, EXPECTED_TERRAIN_TILE_SIZE.y), EXPECTED_TERRAIN_TILE_GUTTER), "terrain tile V minimum must begin after the atlas gutter")
				_check(_number_matches(fposmod(max_v * EXPECTED_TERRAIN_IMAGE_SIZE.y, EXPECTED_TERRAIN_TILE_SIZE.y), EXPECTED_TERRAIN_TILE_GUTTER + EXPECTED_TERRAIN_TILE_CONTENT_SIZE.y), "terrain tile V maximum must end before the atlas gutter")
		for color in colors:
			_check(color.is_equal_approx(Color.WHITE), "terrain chunk vertex colors must remain white")
		var material := mesh.surface_get_material(0) as StandardMaterial3D
		_check(material != null, "terrain chunk %s must use a StandardMaterial3D" % coordinate)
		if material != null:
			if shared_material == null:
				shared_material = material
			else:
				_check(material == shared_material, "all terrain chunks must share one material")
			_check(material.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED, "terrain chunk material must be unshaded")
			_check(material.vertex_color_use_as_albedo, "terrain chunk material must preserve vertex colors")
			_check(material.albedo_texture != null and material.albedo_texture.resource_path == expected_texture_path, "terrain chunk material must use the exact v6 atlas")
			_check(material.texture_filter == BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC, "terrain chunk material must use anisotropic mip filtering")
			_check(not material.no_depth_test, "terrain chunk material must retain depth testing")
			_check(material.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED, "terrain chunk material must remain opaque")
		_check(chunk.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF, "terrain chunk %s must not cast shadows" % coordinate)
		_check(chunk.is_in_group("memory_grove_terrain_chunk"), "terrain chunk %s must be in the terrain-chunk group" % coordinate)
		_check(String(chunk.get_meta("texture_path", "")) == expected_texture_path, "terrain chunk %s texture metadata changed" % coordinate)
		_check(int(chunk.get_meta("shadow_passes", -1)) == 0, "terrain chunk %s shadow metadata changed" % coordinate)

	_check(chunk_coordinates.size() == EXPECTED_TERRAIN_LOADED_CHUNKS, "terrain stream must load every coordinate in the walker-centered 5x5 window")
	_check(rendered_tile_count == EXPECTED_TERRAIN_LOADED_RENDER_TILES, "loaded terrain chunks must render exactly 225 tiles")
	_check(terrain_surface.find_children("*", "CollisionObject3D", true, false).is_empty(), "terrain must remain presentation-only")
	_check(int(grove.get_meta("terrain_render_batch_count", 0)) == EXPECTED_TERRAIN_LOADED_CHUNKS, "grove terrain batch metadata must report 25 loaded chunks")
	_check(int(grove.get_meta("terrain_total_chunk_count", 0)) == EXPECTED_TERRAIN_TOTAL_CHUNKS, "grove total terrain chunk metadata must report 64")
	_check(int(grove.get_meta("terrain_loaded_chunk_count", 0)) == EXPECTED_TERRAIN_LOADED_CHUNKS, "grove loaded terrain chunk metadata must report 25")
	_check(int(grove.get_meta("terrain_source_tile_count", 0)) == EXPECTED_TERRAIN_MAP_TILES, "grove authored terrain map-entry metadata changed")
	_check(int(grove.get_meta("terrain_render_tile_count", 0)) == EXPECTED_TERRAIN_TOTAL_RENDER_TILES, "grove total rendered terrain tile metadata must report 576")
	_check(int(grove.get_meta("logical_ground_cell_count", 0)) == logical_cells, "grove logical cell metadata changed")
	_check(absf(float(grove.get_meta("logical_ground_cell_size", 0.0)) - float(terrain["cell_size"])) < EPSILON, "grove cell size metadata changed")
	_check(String(grove.get_meta("ground_render_mode", "")) == EXPECTED_TERRAIN_RENDER_ROLE, "grove terrain-render metadata changed")
	_check(_number_matches(grove.get_meta("ground_pixels_per_world_unit", null), EXPECTED_TERRAIN_PIXELS_PER_WORLD_UNIT), "grove terrain-density metadata changed")


func _verify_prop_layers(grove: Node3D, prop_layers: Node3D) -> void:
	_check(prop_layers.get_child_count() == 3, "PropLayers must contain Back, Middle, and Front only")
	var objects: Dictionary = _catalog["objects"]
	var expected_counts := {"back": 0, "middle": 0, "front": 0}
	var object_counts: Dictionary = {}
	for placement_variant in _layout["placements"]:
		var placement: Dictionary = placement_variant
		var object_id := String(placement["object"])
		expected_counts[String(placement["layer"])] += 1
		object_counts[object_id] = int(object_counts.get(object_id, 0)) + 1
	for layer_id in ["back", "middle", "front"]:
		var layer_name := String(layer_id).capitalize()
		var layer := prop_layers.get_node_or_null(layer_name) as Node3D
		_check(layer != null, "PropLayers/%s must exist" % layer_name)
		if layer != null:
			_check(layer.get_child_count() == int(expected_counts[layer_id]), "%s placement count must match layout" % layer_name)
	for placement_variant in _layout["placements"]:
		var placement: Dictionary = placement_variant
		var placement_id := String(placement["id"])
		var layer_name := String(placement["layer"]).capitalize()
		var sprite := prop_layers.get_node_or_null("%s/%s" % [layer_name, placement_id]) as Sprite3D
		_check(sprite != null, "placement '%s' must create a Sprite3D in %s" % [placement_id, layer_name])
		if sprite == null:
			continue
		var object_id := String(placement["object"])
		var definition: Dictionary = objects[object_id]
		var texture_path := _resolve_style_path(String(definition["texture"]))
		var anchor := _array_to_vector2(definition["anchor_px"])
		var desired_height := float(definition["default_world_height"]) * float(placement["scale"])
		var expected_pixel_size := desired_height / (float(sprite.texture.get_height()) * WorldScenery.CARD_Y_SCALE_COMPENSATION)
		var flip_horizontal := bool(placement["flip_horizontal"])
		var effective_anchor_x := float(sprite.texture.get_width()) - anchor.x if flip_horizontal else anchor.x
		var center_x_offset := (effective_anchor_x - float(sprite.texture.get_width()) * 0.5) * expected_pixel_size
		var center_y_offset := (anchor.y - float(sprite.texture.get_height()) * 0.5) * expected_pixel_size * WorldScenery.CARD_Y_SCALE_COMPENSATION
		var point := _array_to_vector2(placement["position"])
		var card_right := Vector3(cos(WorldScenery.CARD_YAW_RADIANS), 0.0, -sin(WorldScenery.CARD_YAW_RADIANS))
		var world_anchor := Vector3(point.x, WorldScenery.CARD_GROUND_Y, point.y)
		var expected_position := world_anchor - card_right * center_x_offset
		expected_position.y = WorldScenery.CARD_GROUND_Y + center_y_offset
		_check(sprite.texture != null, "placement '%s' must have a decoded texture" % placement_id)
		_check(sprite.texture.resource_path == texture_path, "placement '%s' texture must match catalog" % placement_id)
		_check(absf(sprite.pixel_size - expected_pixel_size) < EPSILON, "placement '%s' visual height must derive from catalog and scale" % placement_id)
		_check(sprite.position.is_equal_approx(expected_position), "placement '%s' must apply both anchor coordinates" % placement_id)
		_check(sprite.flip_h == flip_horizontal, "placement '%s' horizontal flip must match layout" % placement_id)
		_check(sprite.get_meta("ground_anchor_px", Vector2.ZERO) == anchor, "placement '%s' source anchor metadata changed" % placement_id)
		_check(sprite.get_meta("effective_ground_anchor_px", Vector2.ZERO) == Vector2(effective_anchor_x, anchor.y), "placement '%s' effective anchor metadata changed" % placement_id)
		_check((sprite.get_meta("world_ground_anchor", Vector3.ZERO) as Vector3).is_equal_approx(world_anchor), "placement '%s' world anchor metadata changed" % placement_id)
		_check(String(sprite.get_meta("asset_id", "")) == object_id, "placement '%s' object id metadata changed" % placement_id)
		_check(String(sprite.get_meta("placement_id", "")) == placement_id, "placement '%s' id metadata changed" % placement_id)
		_check(String(sprite.get_meta("layer", "")) == String(placement["layer"]), "placement '%s' layer metadata changed" % placement_id)
		_check(int(sprite.get_meta("asset_placement_count", 0)) == int(object_counts[object_id]), "placement '%s' reuse count metadata changed" % placement_id)
		_check(String(sprite.get_meta("occlusion_mode", "")) == "depth", "placement '%s' must use depth-only occlusion" % placement_id)
		_check(sprite.billboard == BaseMaterial3D.BILLBOARD_DISABLED, "placement '%s' must not billboard" % placement_id)
		_check(absf(sprite.rotation.y - WorldScenery.CARD_YAW_RADIANS) < EPSILON, "placement '%s' card yaw changed" % placement_id)
		_check(absf(sprite.scale.y - WorldScenery.CARD_Y_SCALE_COMPENSATION) < EPSILON, "placement '%s' vertical camera compensation changed" % placement_id)
		_check(
			sprite.alpha_cut == SpriteBase3D.ALPHA_CUT_OPAQUE_PREPASS,
			"placement '%s' must use opaque alpha prepass" % placement_id,
		)
		_check(sprite.texture_filter == BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC, "placement '%s' filtering changed" % placement_id)
		_check(not sprite.shaded and not sprite.no_depth_test, "placement '%s' must preserve authored color and depth testing" % placement_id)
		_check(sprite.render_priority == 0, "placement '%s' must not fake depth with render priority" % placement_id)
		_check(sprite.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF, "placement '%s' must not cast shadows" % placement_id)
	_check(prop_layers.find_children("*", "CollisionObject3D", true, false).is_empty(), "prop cards must remain presentation-only")
	_check(int(grove.get_meta("prop_asset_count", 0)) == objects.size(), "grove object catalog count metadata changed")
	_check(int(grove.get_meta("prop_placement_count", 0)) == (_layout["placements"] as Array).size(), "grove placement count metadata changed")
	_check(int(grove.get_meta("back_prop_count", 0)) == int(expected_counts["back"]), "grove back layer metadata changed")
	_check(int(grove.get_meta("middle_prop_count", 0)) == int(expected_counts["middle"]), "grove middle layer metadata changed")
	_check(int(grove.get_meta("front_prop_count", 0)) == int(expected_counts["front"]), "grove front layer metadata changed")


func _verify_solid_props(grove: Node3D, solid_props: Node3D) -> void:
	var objects: Dictionary = _catalog["objects"]
	var profiles: Dictionary = _catalog["collision_profiles"]
	var expected_solid_count := 0
	for placement_variant in _layout["placements"]:
		var placement: Dictionary = placement_variant
		var body_name := "%sCollider" % String(placement["id"])
		var body := solid_props.get_node_or_null(body_name) as StaticBody3D
		if not bool(placement["collision_enabled"]):
			_check(body == null, "collision-disabled placement '%s' must not create a body" % String(placement["id"]))
			continue
		expected_solid_count += 1
		_check(body != null, "collision-enabled placement '%s' must create a body" % String(placement["id"]))
		if body == null:
			continue
		var definition: Dictionary = objects[String(placement["object"])]
		var profile_id := String(definition["collision_profile"])
		var profile: Dictionary = profiles[profile_id]
		var descriptors: Array = profile["shapes"]
		var point := _array_to_vector2(placement["position"])
		_check(body.position.is_equal_approx(Vector3(point.x, 0.0, point.y)), "body '%s' must use placement ground anchor" % body_name)
		_check(body.is_in_group("memory_grove_solid_prop"), "body '%s' must be in solid-prop group" % body_name)
		_check(String(body.get_meta("placement_id", "")) == String(placement["id"]), "body '%s' placement metadata changed" % body_name)
		_check(String(body.get_meta("collision_profile", "")) == profile_id, "body '%s' profile metadata changed" % body_name)
		_check(body.get_child_count() == descriptors.size(), "body '%s' shape count must match its descriptor" % body_name)
		var scale_factor := float(placement["scale"]) if String(definition["collision_scale_mode"]) == "with-visual" else 1.0
		for shape_index in mini(body.get_child_count(), descriptors.size()):
			var collision := body.get_child(shape_index) as CollisionShape3D
			_check(collision != null, "body '%s' child %d must be a CollisionShape3D" % [body_name, shape_index])
			if collision != null:
				_verify_runtime_shape(collision, descriptors[shape_index], scale_factor, body_name)
	_check(solid_props.get_child_count() == expected_solid_count, "solid prop count must match collision-enabled placements")
	_check(int(grove.get_meta("solid_prop_count", 0)) == expected_solid_count, "grove solid prop metadata changed")


func _verify_runtime_shape(collision: CollisionShape3D, descriptor: Dictionary, scale_factor: float, body_name: String) -> void:
	var shape_type := String(descriptor["type"])
	if shape_type == "cylinder":
		_check(collision.shape is CylinderShape3D, "body '%s' descriptor requires a cylinder" % body_name)
		if collision.shape is CylinderShape3D:
			var cylinder := collision.shape as CylinderShape3D
			_check(absf(cylinder.radius - float(descriptor["radius"]) * scale_factor) < EPSILON, "body '%s' cylinder radius must match descriptor" % body_name)
			_check(absf(cylinder.height - float(descriptor["height"]) * scale_factor) < EPSILON, "body '%s' cylinder height must match descriptor" % body_name)
	else:
		_check(collision.shape is BoxShape3D, "body '%s' descriptor requires a box" % body_name)
		if collision.shape is BoxShape3D:
			_check((collision.shape as BoxShape3D).size.is_equal_approx(_array_to_vector3(descriptor["size"]) * scale_factor), "body '%s' box size must match descriptor" % body_name)
	var offset := _array_to_vector3(descriptor["offset"]) * scale_factor
	var card_right := Vector3(cos(WorldScenery.CARD_YAW_RADIANS), 0.0, -sin(WorldScenery.CARD_YAW_RADIANS))
	var card_depth := Vector3(sin(WorldScenery.CARD_YAW_RADIANS), 0.0, cos(WorldScenery.CARD_YAW_RADIANS))
	var expected_offset := card_right * offset.x + Vector3.UP * offset.y + card_depth * offset.z
	_check(collision.position.is_equal_approx(expected_offset), "body '%s' collision offset must match descriptor" % body_name)


func _verify_boundaries(grove: Node3D, boundary_colliders: Node3D) -> void:
	var boundaries: Array = _layout["boundaries"]
	_check(boundary_colliders.get_child_count() == boundaries.size(), "boundary body count must match layout")
	for boundary_variant in boundaries:
		var boundary: Dictionary = boundary_variant
		var boundary_id := String(boundary["id"])
		var body := boundary_colliders.get_node_or_null(boundary_id) as StaticBody3D
		_check(body != null, "boundary '%s' must create a StaticBody3D" % boundary_id)
		if body == null:
			continue
		_check(body.position.is_equal_approx(_array_to_vector3(boundary["position"])), "boundary '%s' position must match layout" % boundary_id)
		_check(body.is_in_group("memory_grove_boundary"), "boundary '%s' must be in boundary group" % boundary_id)
		_check(String(body.get_meta("collision_role", "")) == "walkable-boundary", "boundary '%s' collision role changed" % boundary_id)
		_check(body.get_child_count() == 1, "boundary '%s' must contain one shape" % boundary_id)
		if body.get_child_count() == 1:
			var collision := body.get_child(0) as CollisionShape3D
			_check(collision != null and collision.shape is BoxShape3D, "boundary '%s' must use a box shape" % boundary_id)
			if collision != null and collision.shape is BoxShape3D:
				_check((collision.shape as BoxShape3D).size.is_equal_approx(_array_to_vector3(boundary["size"])), "boundary '%s' size must match layout" % boundary_id)
	_check(int(grove.get_meta("boundary_collider_count", 0)) == boundaries.size(), "grove boundary count metadata changed")
	_check(int(grove.get_meta("collision_object_count", 0)) == grove.find_children("*", "CollisionObject3D", true, false).size(), "grove collision count metadata changed")


func _verify_navigation(grove: Node3D) -> void:
	var terrain: Dictionary = _layout["terrain"]
	var required_metadata := [
		"navigation_columns",
		"navigation_rows",
		"navigation_cell_size",
		"navigation_origin",
		"navigation_blocked_cells",
	]
	for key in required_metadata:
		_check(grove.has_meta(key), "MemoryGrove must expose %s for ClickNavigation" % key)
	if not grove.has_meta("navigation_blocked_cells"):
		return
	var expected_origin := Vector2(
		-float(terrain["columns"]) * float(terrain["cell_size"]) * 0.5,
		-float(terrain["rows"]) * float(terrain["cell_size"]) * 0.5,
	)
	_check(int(grove.get_meta("navigation_columns", 0)) == int(terrain["columns"]), "navigation column metadata changed")
	_check(int(grove.get_meta("navigation_rows", 0)) == int(terrain["rows"]), "navigation row metadata changed")
	_check(_number_matches(grove.get_meta("navigation_cell_size", null), float(terrain["cell_size"])), "navigation cell-size metadata changed")
	_check(grove.get_meta("navigation_origin", Vector2.INF) == expected_origin, "navigation origin metadata changed")
	_check(_number_matches(grove.get_meta("navigation_clearance", null), WorldScenery.NAVIGATION_CLEARANCE), "navigation clearance metadata changed")
	var blocked_value: Variant = grove.get_meta("navigation_blocked_cells")
	_check(typeof(blocked_value) == TYPE_ARRAY, "navigation blocked cells must be an array")
	if typeof(blocked_value) != TYPE_ARRAY:
		return
	var blocked_cells: Array = blocked_value
	_check(not blocked_cells.is_empty(), "navigation must mark boundary and solid-prop cells")
	var unique_blocked_cells: Dictionary = {}
	for cell_variant in blocked_cells:
		_check(typeof(cell_variant) == TYPE_VECTOR2I, "navigation blocked entries must be Vector2i cells")
		if typeof(cell_variant) != TYPE_VECTOR2I:
			continue
		var cell: Vector2i = cell_variant
		_check(cell.x >= 0 and cell.y >= 0 and cell.x < int(terrain["columns"]) and cell.y < int(terrain["rows"]), "navigation blocked cells must stay inside the grid")
		_check(not unique_blocked_cells.has(cell), "navigation blocked cells must be unique")
		unique_blocked_cells[cell] = true

	var navigator := ClickNavigationScript.new()
	_check(navigator.configure(grove), "ClickNavigation must configure from MemoryGrove metadata")
	if not navigator.is_configured():
		return
	_check(navigator.get_columns() == int(terrain["columns"]), "ClickNavigation column count changed")
	_check(navigator.get_rows() == int(terrain["rows"]), "ClickNavigation row count changed")
	_check(_number_matches(navigator.get_cell_size(), float(terrain["cell_size"])), "ClickNavigation cell size changed")
	_check(navigator.get_origin() == expected_origin, "ClickNavigation origin changed")
	_check(navigator.get_blocked_cells().size() == unique_blocked_cells.size(), "ClickNavigation must consume every unique blocked cell")

	for route_variant in _layout["critical_routes"]:
		var route: Dictionary = route_variant
		var points: Array = route["points"]
		if points.size() < 2:
			continue
		var first := _array_to_vector2(points[0])
		var last := _array_to_vector2(points[-1])
		var start := Vector3(first.x, 0.0, first.y)
		var target := Vector3(last.x, 0.0, last.y)
		var path: PackedVector3Array = navigator.find_path(start, target)
		_check(not path.is_empty(), "critical route '%s' must produce a navigation path" % String(route["id"]))
		if path.is_empty():
			continue
		_check(path[-1].distance_to(target) <= 1.0, "critical route '%s' must reach the destination's walkable neighborhood" % String(route["id"]))
		for point in path:
			_check(navigator.is_world_walkable(point), "critical route '%s' path must avoid solid cells" % String(route["id"]))

	var well_center := Vector3(-3.1, 0.0, 0.4)
	var detour_start := Vector3(-5.0, 0.0, 0.4)
	var detour_target := Vector3(-1.2, 0.0, 0.4)
	_check(not navigator.is_world_walkable(well_center), "the village well footprint must block click navigation")
	var detour: PackedVector3Array = navigator.find_path(detour_start, detour_target)
	_check(detour.size() >= 3, "ClickNavigation must route around the village well")
	if not detour.is_empty():
		_check(detour[-1].distance_squared_to(detour_target) < EPSILON, "the well detour must reach its destination")
		var leaves_direct_line := false
		for point in detour:
			_check(navigator.is_world_walkable(point), "the well detour must never enter a solid cell")
			if absf(point.z - well_center.z) > float(terrain["cell_size"]):
				leaves_direct_line = true
		_check(leaves_direct_line, "the well detour must leave the blocked direct line")


func _verify_shadow_contract(grove: Node3D) -> void:
	for geometry_node in grove.find_children("*", "GeometryInstance3D", true, false):
		var geometry := geometry_node as GeometryInstance3D
		_check(geometry.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF, "%s must not add a shadow pass" % geometry.name)
	_check(int(grove.get_meta("shadow_pass_count", -1)) == 0, "shadow-pass metadata changed")


func _verify_catalog_texture_path(raw_path: String, context: String, required_subdirectory: String) -> String:
	var lower := raw_path.to_lower().replace("\\", "/")
	_check(not raw_path.is_empty(), "%s texture path must not be empty" % context)
	_check(".." not in lower.split("/", false), "%s texture path must not traverse parents" % context)
	for forbidden in FORBIDDEN_PATH_PARTS:
		_check(String(forbidden) not in lower, "%s texture path must not reference '%s'" % [context, forbidden])
	var resolved := _resolve_style_path(raw_path)
	_check(resolved.begins_with(STYLE_ROOT + required_subdirectory), "%s texture must remain under %s%s" % [context, STYLE_ROOT, required_subdirectory])
	return resolved


func _verify_layout_texture_path(raw_path: String, context: String, required_subdirectory: String) -> String:
	var normalized := raw_path.strip_edges().replace("\\", "/")
	var lower := normalized.to_lower()
	_check(not normalized.is_empty(), "%s texture path must not be empty" % context)
	_check(
		normalized.begins_with("res://")
		or (not normalized.is_absolute_path() and not normalized.begins_with("/") and ":" not in normalized),
		"%s texture path must be project-relative or res://" % context,
	)
	_check(".." not in normalized.split("/", false), "%s texture path must not traverse parents" % context)
	for forbidden in FORBIDDEN_PATH_PARTS:
		_check(String(forbidden) not in lower, "%s texture path must not reference '%s'" % [context, forbidden])
	var resolved := _resolve_layout_path(normalized)
	_check(
		resolved.begins_with(LAYOUT_ROOT + required_subdirectory),
		"%s texture must remain under %s%s" % [context, LAYOUT_ROOT, required_subdirectory],
	)
	return resolved


func _resolve_style_path(raw_path: String) -> String:
	var normalized := raw_path.strip_edges().replace("\\", "/")
	var resolved := normalized if normalized.begins_with("res://") else STYLE_ROOT + normalized
	return resolved.simplify_path()


func _resolve_layout_path(raw_path: String) -> String:
	var normalized := raw_path.strip_edges().replace("\\", "/")
	var resolved := normalized if normalized.begins_with("res://") else LAYOUT_ROOT + normalized
	return resolved.simplify_path()


func _verify_texture(path: String, expected_size: Vector2, require_alpha: bool) -> void:
	_check(ResourceLoader.exists(path, "Texture2D"), "missing texture resource: %s" % path)
	if not ResourceLoader.exists(path, "Texture2D"):
		return
	var texture := load(path) as Texture2D
	_check(texture != null, "texture must decode: %s" % path)
	if texture == null:
		return
	_check(Vector2(texture.get_width(), texture.get_height()) == expected_size, "texture dimensions must match catalog: %s" % path)
	var image := texture.get_image()
	_check(image != null and not image.is_empty(), "texture image must not be empty: %s" % path)
	if require_alpha and image != null and not image.is_empty():
		_check(image.detect_alpha() != Image.ALPHA_NONE, "object texture must retain transparency: %s" % path)
		_check(image.get_pixel(0, 0).a < 0.01, "object texture corner must remain transparent: %s" % path)


func _require_keys(dictionary: Dictionary, keys: Array, context: String) -> void:
	for key_variant in keys:
		var key := String(key_variant)
		_check(dictionary.has(key), "%s is missing required key '%s'" % [context, key])


func _has_keys(dictionary: Dictionary, keys: Array) -> bool:
	for key_variant in keys:
		if not dictionary.has(String(key_variant)):
			return false
	return true


func _valid_number_array(value: Variant, expected_length: int, positive: bool) -> bool:
	if typeof(value) != TYPE_ARRAY or (value as Array).size() != expected_length:
		return false
	for item in value as Array:
		if not _is_number(item):
			return false
		if positive and float(item) <= 0.0:
			return false
	return true


func _number_matches(value: Variant, expected: float) -> bool:
	return _is_number(value) and absf(float(value) - expected) < EPSILON


func _array_to_vector2(value: Variant) -> Vector2:
	var values: Array = value
	return Vector2(float(values[0]), float(values[1]))


func _array_to_vector2i(value: Variant) -> Vector2i:
	var values: Array = value
	return Vector2i(int(values[0]), int(values[1]))


func _array_to_vector3(value: Variant) -> Vector3:
	var values: Array = value
	return Vector3(float(values[0]), float(values[1]), float(values[2]))


func _is_number(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT


func _is_integral_number(value: Variant) -> bool:
	return _is_number(value) and is_equal_approx(float(value), roundf(float(value)))


func _check(condition: bool, message: String) -> void:
	if not condition and message not in _failures:
		_failures.append(message)


func _finish(instance: Node) -> void:
	if instance != null:
		instance.queue_free()
	if not _failures.is_empty():
		for failure in _failures:
			push_error("Memory Grove verification failed: %s" % failure)
		quit(1)
		return
	var placements: Array = _layout["placements"]
	var solid_count := 0
	for placement_variant in placements:
		var placement: Dictionary = placement_variant
		if bool(placement["collision_enabled"]):
			solid_count += 1
	print(
		"MEMORY_MOON_SCENERY_SMOKE_OK layout=%s terrain=chunk-stream chunks=%d/%d tiles=%d/%d map_tiles=%d atlas_tiles=%d used_tile_types=%d navigation=true prop_placements=%d collision_objects=%d shadows=0"
		% [
			String(_layout["layout_id"]),
			EXPECTED_TERRAIN_LOADED_CHUNKS,
			EXPECTED_TERRAIN_TOTAL_CHUNKS,
			EXPECTED_TERRAIN_LOADED_RENDER_TILES,
			EXPECTED_TERRAIN_TOTAL_RENDER_TILES,
			EXPECTED_TERRAIN_MAP_TILES,
			EXPECTED_TERRAIN_ATLAS_TILES,
			EXPECTED_TERRAIN_USED_TILE_TYPES,
			placements.size(),
			solid_count + (_layout["boundaries"] as Array).size(),
		]
	)
	quit()
