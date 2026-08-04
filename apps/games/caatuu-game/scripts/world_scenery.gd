class_name CaatuuGameScenery
extends RefCounted

const TerrainChunkStreamer := preload("res://scripts/terrain_chunk_streamer.gd")
const SCHEMA_VERSION := 2
const LAYOUT_ID := "memory-grove-v6"
const CATALOG_ID := "caatuu-game-style-v1"
const SCENERY_ROOT := "res://assets/scenery/"
const CATALOG_PATH := SCENERY_ROOT + "metadata/catalog.json"
const LAYOUT_PATH := SCENERY_ROOT + "metadata/world.json"
const PROJECTION_ID := "isometric-orthographic-45-30"
const TERRAIN_Y := -0.045
const CARD_GROUND_Y := 0.02
const CARD_YAW_RADIANS := PI * 0.25
const CARD_Y_SCALE_COMPENSATION := 1.154700538
const NAVIGATION_CLEARANCE := 0.3
const FORBIDDEN_TEXTURE_SEGMENTS := [
	"launcher",
	"originals",
	"miscellaneous",
	"visual-vocabulary",
]
const REQUIRED_CATALOG_KEYS := [
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
const REQUIRED_LAYOUT_KEYS := [
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
const REQUIRED_OBJECT_KEYS := [
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
	"reuse",
]
const REQUIRED_PLACEMENT_KEYS := [
	"id",
	"object",
	"position",
	"scale",
	"layer",
	"flip_horizontal",
	"collision_enabled",
	"tags",
]

var failure_message := ""
var _catalog: Dictionary = {}
var _layout: Dictionary = {}
var _validation_errors: Array[String] = []
var _missing_assets: Array[String] = []


func build(parent: Node3D) -> Node3D:
	failure_message = ""
	_catalog = {}
	_layout = {}
	_validation_errors.clear()
	_missing_assets.clear()

	var grove := Node3D.new()
	grove.name = "MemoryGrove"
	grove.set_meta("layout_id", LAYOUT_ID)
	grove.set_meta("catalog_id", CATALOG_ID)
	grove.set_meta("schema_version", SCHEMA_VERSION)
	grove.set_meta("loaded", false)
	parent.add_child(grove)

	var terrain_surface := TerrainChunkStreamer.new()
	terrain_surface.name = "TerrainSurface"
	grove.add_child(terrain_surface)

	var prop_layers := Node3D.new()
	prop_layers.name = "PropLayers"
	grove.add_child(prop_layers)
	var layer_nodes: Dictionary = {}
	for layer_name in ["Back", "Middle", "Front"]:
		var layer := Node3D.new()
		layer.name = layer_name
		prop_layers.add_child(layer)
		layer_nodes[layer_name.to_lower()] = layer

	var solid_props := Node3D.new()
	solid_props.name = "SolidProps"
	grove.add_child(solid_props)

	var boundary_colliders := Node3D.new()
	boundary_colliders.name = "BoundaryColliders"
	grove.add_child(boundary_colliders)

	_catalog = _read_json_object(CATALOG_PATH, "catalog")
	_layout = _read_json_object(LAYOUT_PATH, "layout")
	if not _catalog.is_empty():
		_validate_catalog()
	if not _layout.is_empty():
		_validate_layout()
	if _validation_errors.is_empty() and not _catalog.is_empty() and not _layout.is_empty():
		_validate_layout_against_catalog()
	if not _validation_errors.is_empty():
		_finalize_failed_build(grove)
		return grove

	var texture_cache: Dictionary = {}
	var terrain: Dictionary = _layout["terrain"]
	var render_tiles: Dictionary = terrain["render_tiles"]
	var terrain_path := _resolve_scenery_texture(String(render_tiles["texture"]), "terrain tileset")
	var terrain_texture := _load_texture(terrain_path, texture_cache)
	if terrain_texture == null:
		_record_missing_asset(terrain_path)
	else:
		var declared_terrain_size := _array_to_vector2(render_tiles["image_size_px"])
		if Vector2(terrain_texture.get_width(), terrain_texture.get_height()) != declared_terrain_size:
			_add_error(
				"Terrain tileset dimensions %dx%d do not match layout size %dx%d: %s"
				% [
					terrain_texture.get_width(),
					terrain_texture.get_height(),
					int(declared_terrain_size.x),
					int(declared_terrain_size.y),
					terrain_path,
				]
			)
	var objects: Dictionary = _catalog["objects"]
	for object_id_variant in objects.keys():
		var object_id := String(object_id_variant)
		var definition: Dictionary = objects[object_id]
		var texture_path := _resolve_scenery_texture(String(definition["texture"]), "object %s" % object_id)
		var object_texture := _load_texture(texture_path, texture_cache)
		if object_texture == null:
			_record_missing_asset(texture_path)
		else:
			var declared_size := _array_to_vector2(definition["image_size_px"])
			if Vector2(object_texture.get_width(), object_texture.get_height()) != declared_size:
				_add_error(
					"Object '%s' dimensions %dx%d do not match catalog size %dx%d: %s"
					% [
						object_id,
						object_texture.get_width(),
						object_texture.get_height(),
						int(declared_size.x),
						int(declared_size.y),
						texture_path,
					]
				)
	if not _validation_errors.is_empty() or not _missing_assets.is_empty() or terrain_texture == null:
		_finalize_failed_build(grove)
		return grove

	var spawn_position := _array_to_vector3((_layout["spawn_points"] as Array)[0]["position"])
	terrain_surface.configure(
		render_tiles,
		terrain["tile_index_rows"],
		terrain_texture,
		terrain_path,
		Vector2(spawn_position.x, spawn_position.z),
	)
	var placement_counts := _placement_counts_by_object()
	for placement_variant in _layout["placements"]:
		var placement: Dictionary = placement_variant
		var object_id := String(placement["object"])
		var definition: Dictionary = objects[object_id]
		var texture_path := _resolve_scenery_texture(String(definition["texture"]), "object %s" % object_id)
		var texture := _load_texture(texture_path, texture_cache)
		var layer_id := String(placement["layer"])
		var layer := layer_nodes[layer_id] as Node3D
		_add_prop_card(
			layer,
			placement,
			definition,
			texture,
			texture_path,
			int(placement_counts.get(object_id, 0)),
		)
		if bool(placement["collision_enabled"]):
			_add_solid_prop(solid_props, placement, definition)

	_add_boundary_colliders(boundary_colliders)
	_finalize_successful_build(
		grove,
		terrain_surface,
		layer_nodes,
		solid_props,
		boundary_colliders,
	)
	return grove


func _read_json_object(path: String, label: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		_add_error("Missing %s JSON: %s" % [label, path])
		return {}
	var parser := JSON.new()
	var result := parser.parse(FileAccess.get_file_as_string(path))
	if result != OK:
		_add_error(
			"Invalid %s JSON at %s:%d: %s"
			% [label, path, parser.get_error_line(), parser.get_error_message()]
		)
		return {}
	if typeof(parser.data) != TYPE_DICTIONARY:
		_add_error("The %s JSON root must be an object: %s" % [label, path])
		return {}
	var parsed: Dictionary = parser.data
	if parsed.is_empty():
		_add_error("The %s JSON root must not be empty: %s" % [label, path])
	return parsed


func _validate_catalog() -> void:
	_require_keys(_catalog, REQUIRED_CATALOG_KEYS, "catalog")
	if not _has_keys(_catalog, REQUIRED_CATALOG_KEYS):
		return
	_expect_int(_catalog["schema_version"], "catalog.schema_version", SCHEMA_VERSION)
	_expect_string(_catalog["catalog_id"], "catalog.catalog_id", CATALOG_ID)
	_expect_positive_int(_catalog["catalog_version"], "catalog.catalog_version")
	_expect_nonempty_string(_catalog["release_status"], "catalog.release_status")

	if typeof(_catalog["projection"]) != TYPE_DICTIONARY:
		_add_error("catalog.projection must be an object")
	else:
		var projection: Dictionary = _catalog["projection"]
		_require_keys(projection, ["id", "yaw_degrees", "elevation_degrees"], "catalog.projection")
		if projection.has("id"):
			_expect_string(projection["id"], "catalog.projection.id", PROJECTION_ID)
		if projection.has("yaw_degrees"):
			_expect_number_value(projection["yaw_degrees"], "catalog.projection.yaw_degrees", 45.0)
		if projection.has("elevation_degrees"):
			_expect_number_value(projection["elevation_degrees"], "catalog.projection.elevation_degrees", 30.0)

	if typeof(_catalog["style_family"]) != TYPE_DICTIONARY:
		_add_error("catalog.style_family must be an object")
	else:
		var style_family: Dictionary = _catalog["style_family"]
		_require_keys(style_family, ["id", "authority_path", "palette", "rules"], "catalog.style_family")
		if style_family.has("id"):
			_expect_nonempty_string(style_family["id"], "catalog.style_family.id")
		if style_family.has("authority_path"):
			_expect_nonempty_string(style_family["authority_path"], "catalog.style_family.authority_path")
		if style_family.has("palette") and typeof(style_family["palette"]) != TYPE_DICTIONARY:
			_add_error("catalog.style_family.palette must be an object")
		if style_family.has("rules"):
			_validate_string_array(style_family["rules"], "catalog.style_family.rules", false)

	_validate_floor_atlas(_catalog["floor_atlas"])
	_validate_collision_profiles(_catalog["collision_profiles"])
	_validate_objects(_catalog["objects"])


func _validate_floor_atlas(value: Variant) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("catalog.floor_atlas must be an object")
		return
	var atlas: Dictionary = value
	_require_keys(atlas, ["texture", "size_px", "gutter_px", "tiles"], "catalog.floor_atlas")
	if not _has_keys(atlas, ["texture", "size_px", "gutter_px", "tiles"]):
		return
	_expect_safe_texture(atlas["texture"], "catalog.floor_atlas.texture", "sources/")
	_validate_number_array(atlas["size_px"], 2, "catalog.floor_atlas.size_px", true)
	if not _is_number(atlas["gutter_px"]) or float(atlas["gutter_px"]) < 0.0:
		_add_error("catalog.floor_atlas.gutter_px must be a non-negative number")
	if typeof(atlas["tiles"]) != TYPE_DICTIONARY or (atlas["tiles"] as Dictionary).is_empty():
		_add_error("catalog.floor_atlas.tiles must be a non-empty object")
		return
	var atlas_size_is_valid := _valid_number_array(atlas["size_px"], 2, true)
	var atlas_size := _array_to_vector2(atlas["size_px"]) if atlas_size_is_valid else Vector2.ZERO
	for tile_id_variant in (atlas["tiles"] as Dictionary).keys():
		var tile_id := String(tile_id_variant)
		var context := "catalog.floor_atlas.tiles.%s" % tile_id
		if tile_id.is_empty():
			_add_error("catalog.floor_atlas.tiles cannot contain an empty id")
		var tile_value: Variant = (atlas["tiles"] as Dictionary)[tile_id]
		if typeof(tile_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var tile: Dictionary = tile_value
		var required := [
			"kind",
			"tags",
			"uv_rect_px",
			"grid_size",
			"walkable",
			"edges",
			"allowed_rotations_degrees",
			"seam_contract",
		]
		_require_keys(tile, required, context)
		if tile.has("kind"):
			_expect_nonempty_string(tile["kind"], "%s.kind" % context)
		if tile.has("tags"):
			_validate_string_array(tile["tags"], "%s.tags" % context, false)
		if tile.has("uv_rect_px"):
			_validate_number_array(tile["uv_rect_px"], 4, "%s.uv_rect_px" % context, true)
			if _valid_number_array(tile["uv_rect_px"], 4, true) and atlas_size_is_valid:
				var rect_values: Array = tile["uv_rect_px"]
				var rect := Rect2(
					float(rect_values[0]),
					float(rect_values[1]),
					float(rect_values[2]),
					float(rect_values[3]),
				)
				if rect.position.x < 0.0 or rect.position.y < 0.0 or rect.end.x > atlas_size.x or rect.end.y > atlas_size.y:
					_add_error("%s.uv_rect_px must remain inside the atlas" % context)
		if tile.has("grid_size"):
			_validate_number_array(tile["grid_size"], 2, "%s.grid_size" % context, true)
		if tile.has("walkable") and typeof(tile["walkable"]) != TYPE_BOOL:
			_add_error("%s.walkable must be a boolean" % context)
		if tile.has("edges"):
			_validate_tile_edges(tile["edges"], "%s.edges" % context)
		if tile.has("allowed_rotations_degrees"):
			_validate_number_array_any_length(
				tile["allowed_rotations_degrees"],
				"%s.allowed_rotations_degrees" % context,
				false,
			)
		if tile.has("seam_contract"):
			_expect_nonempty_string(tile["seam_contract"], "%s.seam_contract" % context)


func _validate_tile_edges(value: Variant, context: String) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("%s must be an object" % context)
		return
	var edges: Dictionary = value
	_require_keys(edges, ["north", "east", "south", "west"], context)
	for direction in ["north", "east", "south", "west"]:
		if edges.has(direction):
			_expect_nonempty_string(edges[direction], "%s.%s" % [context, direction])


func _validate_collision_profiles(value: Variant) -> void:
	if typeof(value) != TYPE_DICTIONARY or (value as Dictionary).is_empty():
		_add_error("catalog.collision_profiles must be a non-empty object")
		return
	for profile_id_variant in (value as Dictionary).keys():
		var profile_id := String(profile_id_variant)
		var context := "catalog.collision_profiles.%s" % profile_id
		var profile_value: Variant = (value as Dictionary)[profile_id]
		if typeof(profile_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var profile: Dictionary = profile_value
		_require_keys(profile, ["shapes"], context)
		if not profile.has("shapes"):
			continue
		if typeof(profile["shapes"]) != TYPE_ARRAY:
			_add_error("%s.shapes must be an array" % context)
			continue
		for shape_index in (profile["shapes"] as Array).size():
			_validate_collision_shape(
				(profile["shapes"] as Array)[shape_index],
				"%s.shapes[%d]" % [context, shape_index],
			)


func _validate_collision_shape(value: Variant, context: String) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("%s must be an object" % context)
		return
	var descriptor: Dictionary = value
	if not descriptor.has("type"):
		_add_error("%s is missing required key 'type'" % context)
		return
	var shape_type := String(descriptor["type"])
	match shape_type:
		"cylinder":
			_require_keys(descriptor, ["type", "radius", "height", "offset"], context)
			if descriptor.has("radius"):
				_expect_positive_number(descriptor["radius"], "%s.radius" % context)
			if descriptor.has("height"):
				_expect_positive_number(descriptor["height"], "%s.height" % context)
			if descriptor.has("offset"):
				_validate_number_array(descriptor["offset"], 3, "%s.offset" % context, false)
		"box":
			_require_keys(descriptor, ["type", "size", "offset"], context)
			if descriptor.has("size"):
				_validate_number_array(descriptor["size"], 3, "%s.size" % context, true)
			if descriptor.has("offset"):
				_validate_number_array(descriptor["offset"], 3, "%s.offset" % context, false)
		_:
			_add_error("%s.type must be 'cylinder' or 'box'" % context)


func _validate_objects(value: Variant) -> void:
	if typeof(value) != TYPE_DICTIONARY or (value as Dictionary).is_empty():
		_add_error("catalog.objects must be a non-empty object")
		return
	var profiles: Dictionary = {}
	if typeof(_catalog.get("collision_profiles", null)) == TYPE_DICTIONARY:
		profiles = _catalog["collision_profiles"]
	for object_id_variant in (value as Dictionary).keys():
		var object_id := String(object_id_variant)
		var context := "catalog.objects.%s" % object_id
		var object_value: Variant = (value as Dictionary)[object_id]
		if typeof(object_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var definition: Dictionary = object_value
		_require_keys(definition, REQUIRED_OBJECT_KEYS, context)
		if not _has_keys(definition, REQUIRED_OBJECT_KEYS):
			continue
		_expect_safe_texture(definition["texture"], "%s.texture" % context, "images/")
		_validate_number_array(definition["image_size_px"], 2, "%s.image_size_px" % context, true)
		_validate_number_array(definition["anchor_px"], 2, "%s.anchor_px" % context, false)
		if _valid_number_array(definition["image_size_px"], 2, true) and _valid_number_array(definition["anchor_px"], 2, false):
			var image_size := _array_to_vector2(definition["image_size_px"])
			var anchor := _array_to_vector2(definition["anchor_px"])
			if anchor.x < 0.0 or anchor.y < 0.0 or anchor.x > image_size.x or anchor.y > image_size.y:
				_add_error("%s.anchor_px must remain inside image_size_px" % context)
		_expect_nonempty_string(definition["kind"], "%s.kind" % context)
		_validate_string_array(definition["tags"], "%s.tags" % context, false)
		_expect_nonempty_string(definition["source_id"], "%s.source_id" % context)
		_expect_positive_number(definition["default_world_height"], "%s.default_world_height" % context)
		_validate_number_array(definition["allowed_world_height"], 2, "%s.allowed_world_height" % context, true)
		if _valid_number_array(definition["allowed_world_height"], 2, true) and _is_number(definition["default_world_height"]):
			var allowed: Array = definition["allowed_world_height"]
			var minimum := float(allowed[0])
			var maximum := float(allowed[1])
			var default_height := float(definition["default_world_height"])
			if minimum > maximum:
				_add_error("%s.allowed_world_height must be ordered [minimum, maximum]" % context)
			elif default_height < minimum or default_height > maximum:
				_add_error("%s.default_world_height must fall inside allowed_world_height" % context)
		var profile_id := String(definition["collision_profile"])
		if profile_id.is_empty() or not profiles.has(profile_id):
			_add_error("%s.collision_profile references unknown profile '%s'" % [context, profile_id])
		var scale_mode := String(definition["collision_scale_mode"])
		if scale_mode not in ["fixed", "with-visual"]:
			_add_error("%s.collision_scale_mode must be 'fixed' or 'with-visual'" % context)
		_validate_occlusion(definition["occlusion"], "%s.occlusion" % context)
		_validate_reuse(definition["reuse"], "%s.reuse" % context)


func _validate_occlusion(value: Variant, context: String) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("%s must be an object" % context)
		return
	var occlusion: Dictionary = value
	_require_keys(occlusion, ["mode"], context)
	if occlusion.has("mode") and String(occlusion["mode"]) != "depth":
		_add_error("%s.mode must be 'depth'; fading is outside v6" % context)


func _validate_reuse(value: Variant, context: String) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("%s must be an object" % context)
		return
	var reuse: Dictionary = value
	var required := [
		"single_object",
		"allow_horizontal_flip",
		"allowed_rotations_degrees",
		"minimum_repeat_distance",
		"maximum_placements_per_layout",
	]
	_require_keys(reuse, required, context)
	if reuse.has("single_object") and typeof(reuse["single_object"]) != TYPE_BOOL:
		_add_error("%s.single_object must be a boolean" % context)
	if reuse.has("allow_horizontal_flip") and typeof(reuse["allow_horizontal_flip"]) != TYPE_BOOL:
		_add_error("%s.allow_horizontal_flip must be a boolean" % context)
	if reuse.has("allowed_rotations_degrees"):
		_validate_number_array_any_length(
			reuse["allowed_rotations_degrees"],
			"%s.allowed_rotations_degrees" % context,
			false,
		)
	if reuse.has("minimum_repeat_distance"):
		if not _is_number(reuse["minimum_repeat_distance"]) or float(reuse["minimum_repeat_distance"]) < 0.0:
			_add_error("%s.minimum_repeat_distance must be a non-negative number" % context)
	if reuse.has("maximum_placements_per_layout"):
		_expect_positive_int(reuse["maximum_placements_per_layout"], "%s.maximum_placements_per_layout" % context)


func _validate_layout() -> void:
	_require_keys(_layout, REQUIRED_LAYOUT_KEYS, "layout")
	if not _has_keys(_layout, REQUIRED_LAYOUT_KEYS):
		return
	_expect_int(_layout["schema_version"], "layout.schema_version", SCHEMA_VERSION)
	_expect_string(_layout["layout_id"], "layout.layout_id", LAYOUT_ID)
	_expect_string(_layout["catalog_id"], "layout.catalog_id", CATALOG_ID)
	_expect_positive_int(_layout["catalog_version"], "layout.catalog_version")
	_expect_string(_layout["projection_id"], "layout.projection_id", PROJECTION_ID)
	_validate_terrain(_layout["terrain"])
	_validate_boundaries(_layout["boundaries"])
	_validate_spawn_points(_layout["spawn_points"])
	_validate_critical_routes(_layout["critical_routes"])
	if typeof(_layout["placements"]) != TYPE_ARRAY:
		_add_error("layout.placements must be an array")


func _validate_terrain(value: Variant) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("layout.terrain must be an object")
		return
	var terrain: Dictionary = value
	var required := [
		"columns",
		"rows",
		"cell_size",
		"render_tiles",
		"tile_index_rows",
		"tile_legend",
		"tile_rows",
	]
	_require_keys(terrain, required, "layout.terrain")
	if not _has_keys(terrain, required):
		return
	_expect_positive_int(terrain["columns"], "layout.terrain.columns")
	_expect_positive_int(terrain["rows"], "layout.terrain.rows")
	_expect_positive_number(terrain["cell_size"], "layout.terrain.cell_size")
	_validate_render_tiles(terrain["render_tiles"], terrain["tile_index_rows"], terrain)
	if typeof(terrain["tile_legend"]) != TYPE_DICTIONARY or (terrain["tile_legend"] as Dictionary).is_empty():
		_add_error("layout.terrain.tile_legend must be a non-empty object")
	if typeof(terrain["tile_rows"]) != TYPE_ARRAY:
		_add_error("layout.terrain.tile_rows must be an array")
	if not _is_integral_number(terrain["columns"]) or not _is_integral_number(terrain["rows"]) or typeof(terrain["tile_rows"]) != TYPE_ARRAY:
		return
	var columns := int(terrain["columns"])
	var rows := int(terrain["rows"])
	if columns * rows > 65536:
		_add_error("layout.terrain is too large; maximum logical cell count is 65536")
	var tile_rows: Array = terrain["tile_rows"]
	if tile_rows.size() != rows:
		_add_error("layout.terrain.tile_rows must contain exactly %d rows" % rows)
	for row_index in tile_rows.size():
		if typeof(tile_rows[row_index]) != TYPE_STRING:
			_add_error("layout.terrain.tile_rows[%d] must be a string" % row_index)
			continue
		if String(tile_rows[row_index]).length() != columns:
			_add_error("layout.terrain.tile_rows[%d] must contain exactly %d symbols" % [row_index, columns])


func _validate_render_tiles(value: Variant, rows_value: Variant, terrain: Dictionary) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("layout.terrain.render_tiles must be an object")
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
		"tile_ids",
		"path_connectivity",
		"terrain_regions",
		"pixels_per_world_unit",
		"projection",
		"render_role",
		"source_id",
	]
	_require_keys(render_tiles, required, "layout.terrain.render_tiles")
	if not _has_keys(render_tiles, required):
		return
	_expect_safe_texture(render_tiles["texture"], "layout.terrain.render_tiles.texture", "images/")
	_validate_positive_integer_pair(render_tiles["image_size_px"], "layout.terrain.render_tiles.image_size_px")
	_validate_positive_integer_pair(render_tiles["tile_size_px"], "layout.terrain.render_tiles.tile_size_px")
	_validate_positive_integer_pair(
		render_tiles["tile_content_size_px"],
		"layout.terrain.render_tiles.tile_content_size_px",
	)
	_validate_positive_integer_pair(render_tiles["atlas_grid"], "layout.terrain.render_tiles.atlas_grid")
	if not _is_integral_number(render_tiles["tile_gutter_px"]) or int(render_tiles["tile_gutter_px"]) < 0:
		_add_error("layout.terrain.render_tiles.tile_gutter_px must be a non-negative integer")
	_expect_positive_number(render_tiles["world_tile_size"], "layout.terrain.render_tiles.world_tile_size")
	_expect_positive_int(render_tiles["chunk_size_tiles"], "layout.terrain.render_tiles.chunk_size_tiles")
	_expect_positive_int(render_tiles["stream_radius_chunks"], "layout.terrain.render_tiles.stream_radius_chunks")
	if not _is_integral_number(render_tiles["padding_tiles"]) or int(render_tiles["padding_tiles"]) < 0:
		_add_error("layout.terrain.render_tiles.padding_tiles must be a non-negative integer")
	_expect_positive_number(render_tiles["pixels_per_world_unit"], "layout.terrain.render_tiles.pixels_per_world_unit")
	_expect_string(render_tiles["projection"], "layout.terrain.render_tiles.projection", "top-down")
	_expect_string(
		render_tiles["render_role"],
		"layout.terrain.render_tiles.render_role",
		"streamed-reusable-tile-map",
	)
	_expect_nonempty_string(render_tiles["source_id"], "layout.terrain.render_tiles.source_id")
	var atlas_capacity := -1
	if _valid_positive_integer_pair(render_tiles["atlas_grid"]):
		var atlas_grid := _array_to_vector2(render_tiles["atlas_grid"])
		atlas_capacity = int(atlas_grid.x * atlas_grid.y)
	_validate_bounded_atlas_index(
		render_tiles["padding_tile_index"],
		atlas_capacity,
		"layout.terrain.render_tiles.padding_tile_index",
	)
	_validate_tile_ids(render_tiles["tile_ids"], atlas_capacity)
	_validate_path_connectivity(render_tiles["path_connectivity"], atlas_capacity)
	_validate_terrain_regions(
		render_tiles["terrain_regions"],
		render_tiles["path_connectivity"],
		atlas_capacity,
	)
	if (
		_valid_positive_integer_pair(render_tiles["image_size_px"])
		and _valid_positive_integer_pair(render_tiles["tile_size_px"])
		and _valid_positive_integer_pair(render_tiles["tile_content_size_px"])
		and _valid_positive_integer_pair(render_tiles["atlas_grid"])
		and _is_integral_number(render_tiles["tile_gutter_px"])
		and int(render_tiles["tile_gutter_px"]) >= 0
		and _is_number(render_tiles["pixels_per_world_unit"])
	):
		var image_size := _array_to_vector2(render_tiles["image_size_px"])
		var tile_size := _array_to_vector2(render_tiles["tile_size_px"])
		var content_size := _array_to_vector2(render_tiles["tile_content_size_px"])
		var atlas_grid := _array_to_vector2(render_tiles["atlas_grid"])
		var gutter := float(render_tiles["tile_gutter_px"])
		if image_size != tile_size * atlas_grid:
			_add_error("layout.terrain.render_tiles image_size_px must equal tile_size_px multiplied by atlas_grid")
		if tile_size != content_size + Vector2.ONE * gutter * 2.0:
			_add_error("layout.terrain.render_tiles tile_size_px must equal tile_content_size_px plus two gutters")
		if _is_number(render_tiles["world_tile_size"]) and float(render_tiles["world_tile_size"]) > 0.0:
			var declared_density := float(render_tiles["pixels_per_world_unit"])
			var density_x := content_size.x / float(render_tiles["world_tile_size"])
			var density_y := content_size.y / float(render_tiles["world_tile_size"])
			if not is_equal_approx(density_x, declared_density) or not is_equal_approx(density_y, declared_density):
				_add_error("layout.terrain.render_tiles pixels_per_world_unit must match tile_content_size_px / world_tile_size")
	if typeof(rows_value) != TYPE_ARRAY:
		_add_error("layout.terrain.tile_index_rows must be an array")
		return
	var tile_index_rows: Array = rows_value
	if tile_index_rows.is_empty():
		_add_error("layout.terrain.tile_index_rows must not be empty")
		return
	var map_columns := -1
	var rows_are_rectangular := true
	for row_index in tile_index_rows.size():
		if typeof(tile_index_rows[row_index]) != TYPE_ARRAY:
			_add_error("layout.terrain.tile_index_rows[%d] must be an array" % row_index)
			rows_are_rectangular = false
			continue
		var row: Array = tile_index_rows[row_index]
		if row.is_empty():
			_add_error("layout.terrain.tile_index_rows[%d] must not be empty" % row_index)
			rows_are_rectangular = false
		elif map_columns < 0:
			map_columns = row.size()
		elif row.size() != map_columns:
			_add_error("layout.terrain.tile_index_rows rows must all have the same length")
			rows_are_rectangular = false
		for column in row.size():
			_validate_bounded_atlas_index(
				row[column],
				atlas_capacity,
				"layout.terrain.tile_index_rows[%d][%d]" % [row_index, column],
			)
	if (
		rows_are_rectangular
		and map_columns > 0
		and _is_number(render_tiles["world_tile_size"])
		and float(render_tiles["world_tile_size"]) > 0.0
		and _is_integral_number(terrain["columns"])
		and int(terrain["columns"]) > 0
		and _is_integral_number(terrain["rows"])
		and int(terrain["rows"]) > 0
		and _is_number(terrain["cell_size"])
		and float(terrain["cell_size"]) > 0.0
	):
		var visual_width := float(map_columns) * float(render_tiles["world_tile_size"])
		var visual_height := float(tile_index_rows.size()) * float(render_tiles["world_tile_size"])
		var navigation_width := float(terrain["columns"]) * float(terrain["cell_size"])
		var navigation_height := float(terrain["rows"]) * float(terrain["cell_size"])
		if absf(visual_width - navigation_width) > 0.001 or absf(visual_height - navigation_height) > 0.001:
			_add_error("layout.terrain render tile world extent must match the navigation grid extent")


func _validate_bounded_atlas_index(value: Variant, atlas_capacity: int, context: String) -> void:
	if not _is_integral_number(value) or int(value) < 0:
		_add_error("%s must be a non-negative integer atlas index" % context)
		return
	if atlas_capacity > 0 and int(value) >= atlas_capacity:
		_add_error("%s must reference atlas index 0..%d" % [context, atlas_capacity - 1])


func _validate_tile_ids(value: Variant, atlas_capacity: int) -> void:
	var context := "layout.terrain.render_tiles.tile_ids"
	if typeof(value) != TYPE_ARRAY or (value as Array).is_empty():
		_add_error("%s must be a non-empty array" % context)
		return
	var tile_ids: Array = value
	if atlas_capacity > 0 and tile_ids.size() != atlas_capacity:
		_add_error("%s must contain exactly one id per atlas cell" % context)
	var seen: Dictionary = {}
	for index in tile_ids.size():
		var tile_id: Variant = tile_ids[index]
		if not _is_slug(tile_id):
			_add_error("%s[%d] must be a non-empty slug" % [context, index])
			continue
		if seen.has(String(tile_id)):
			_add_error("%s must contain unique ids" % context)
		else:
			seen[String(tile_id)] = true


func _validate_path_connectivity(value: Variant, atlas_capacity: int) -> void:
	var context := "layout.terrain.render_tiles.path_connectivity"
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("%s must be an object" % context)
		return
	var connectivity: Dictionary = value
	var required := ["first_index", "north_bit", "east_bit", "south_bit", "west_bit"]
	_require_keys(connectivity, required, context)
	if not _has_keys(connectivity, required):
		return
	_validate_bounded_atlas_index(connectivity["first_index"], atlas_capacity, "%s.first_index" % context)
	_expect_int(connectivity["north_bit"], "%s.north_bit" % context, 1)
	_expect_int(connectivity["east_bit"], "%s.east_bit" % context, 2)
	_expect_int(connectivity["south_bit"], "%s.south_bit" % context, 4)
	_expect_int(connectivity["west_bit"], "%s.west_bit" % context, 8)
	if (
		atlas_capacity > 0
		and _is_integral_number(connectivity["first_index"])
		and int(connectivity["first_index"]) >= 0
		and int(connectivity["first_index"]) + 15 >= atlas_capacity
	):
		_add_error("%s must reserve 16 consecutive atlas cells from first_index" % context)


func _validate_terrain_regions(
	value: Variant,
	path_connectivity_value: Variant,
	atlas_capacity: int,
) -> void:
	var context := "layout.terrain.render_tiles.terrain_regions"
	if typeof(value) != TYPE_ARRAY:
		_add_error("%s must be an array" % context)
		return
	var path_first_index := -1
	if (
		typeof(path_connectivity_value) == TYPE_DICTIONARY
		and _is_integral_number((path_connectivity_value as Dictionary).get("first_index"))
	):
		path_first_index = int((path_connectivity_value as Dictionary)["first_index"])
	var seen_ids: Dictionary = {}
	var occupied_ranges: Array[Vector2i] = []
	var full_variant_indices: Array[int] = []
	var seen_full_variant_indices: Dictionary = {}
	var required := [
		"id",
		"first_index",
		"northwest_bit",
		"northeast_bit",
		"southeast_bit",
		"southwest_bit",
	]
	for region_index in (value as Array).size():
		var region_value: Variant = (value as Array)[region_index]
		var region_context := "%s[%d]" % [context, region_index]
		if typeof(region_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % region_context)
			continue
		var region: Dictionary = region_value
		_require_keys(region, required, region_context)
		if not _has_keys(region, required):
			continue
		if not _is_slug(region["id"]):
			_add_error("%s.id must be a non-empty slug" % region_context)
		else:
			var region_id := String(region["id"])
			if seen_ids.has(region_id):
				_add_error("%s ids must be unique" % context)
			else:
				seen_ids[region_id] = true
		_validate_bounded_atlas_index(region["first_index"], atlas_capacity, "%s.first_index" % region_context)
		_expect_int(region["northwest_bit"], "%s.northwest_bit" % region_context, 1)
		_expect_int(region["northeast_bit"], "%s.northeast_bit" % region_context, 2)
		_expect_int(region["southeast_bit"], "%s.southeast_bit" % region_context, 4)
		_expect_int(region["southwest_bit"], "%s.southwest_bit" % region_context, 8)
		if not _is_integral_number(region["first_index"]) or int(region["first_index"]) < 0:
			continue
		var first_index := int(region["first_index"])
		if atlas_capacity > 0 and first_index + 15 >= atlas_capacity:
			_add_error("%s must reserve 16 consecutive atlas cells from first_index" % region_context)
		if path_first_index >= 0 and _atlas_ranges_overlap(first_index, path_first_index):
			_add_error("%s must not overlap the 16-cell path topology range" % region_context)
		for occupied_range in occupied_ranges:
			if _atlas_ranges_overlap(first_index, occupied_range.x):
				_add_error("%s must not overlap another terrain region" % region_context)
		occupied_ranges.append(Vector2i(first_index, first_index + 15))
		if region.has("full_variant_indices"):
			var variants_value: Variant = region["full_variant_indices"]
			if typeof(variants_value) != TYPE_ARRAY or (variants_value as Array).is_empty():
				_add_error("%s.full_variant_indices must be a non-empty array" % region_context)
				continue
			for variant_value in (variants_value as Array):
				if not _is_integral_number(variant_value) or int(variant_value) < 0:
					_add_error("%s.full_variant_indices must contain non-negative integers" % region_context)
					continue
				var variant_index := int(variant_value)
				if atlas_capacity > 0 and variant_index >= atlas_capacity:
					_add_error("%s.full_variant_indices contains an index outside the atlas" % region_context)
				if seen_full_variant_indices.has(variant_index):
					_add_error("%s full_variant_indices must be unique" % context)
					continue
				seen_full_variant_indices[variant_index] = true
				full_variant_indices.append(variant_index)
	for variant_index in full_variant_indices:
		if path_first_index >= 0 and variant_index >= path_first_index and variant_index <= path_first_index + 15:
			_add_error("%s full_variant_indices must not overlap the path topology range" % context)
		for occupied_range in occupied_ranges:
			if variant_index >= occupied_range.x and variant_index <= occupied_range.y:
				_add_error("%s full_variant_indices must not overlap a terrain-region topology range" % context)


func _atlas_ranges_overlap(first_index: int, other_first_index: int) -> bool:
	return first_index <= other_first_index + 15 and other_first_index <= first_index + 15


func _validate_ground_plate(value: Variant) -> void:
	if typeof(value) != TYPE_DICTIONARY:
		_add_error("layout.terrain.ground_plate must be an object")
		return
	var ground_plate: Dictionary = value
	var required := [
		"texture",
		"image_size_px",
		"world_size",
		"pixels_per_world_unit",
		"projection",
		"render_role",
		"source_id",
	]
	_require_keys(ground_plate, required, "layout.terrain.ground_plate")
	if not _has_keys(ground_plate, required):
		return
	_expect_safe_texture(ground_plate["texture"], "layout.terrain.ground_plate.texture", "images/")
	_validate_number_array(ground_plate["image_size_px"], 2, "layout.terrain.ground_plate.image_size_px", true)
	_validate_number_array(ground_plate["world_size"], 2, "layout.terrain.ground_plate.world_size", true)
	_expect_positive_number(ground_plate["pixels_per_world_unit"], "layout.terrain.ground_plate.pixels_per_world_unit")
	_expect_string(ground_plate["projection"], "layout.terrain.ground_plate.projection", "top-down")
	_expect_string(ground_plate["render_role"], "layout.terrain.ground_plate.render_role", "authored-map-plate")
	_expect_nonempty_string(ground_plate["source_id"], "layout.terrain.ground_plate.source_id")
	if _valid_number_array(ground_plate["image_size_px"], 2, true) and _valid_number_array(ground_plate["world_size"], 2, true):
		var image_size := _array_to_vector2(ground_plate["image_size_px"])
		var world_size := _array_to_vector2(ground_plate["world_size"])
		var declared_density := float(ground_plate["pixels_per_world_unit"])
		var density_x := image_size.x / world_size.x
		var density_y := image_size.y / world_size.y
		if not is_equal_approx(density_x, declared_density) or not is_equal_approx(density_y, declared_density):
			_add_error("layout.terrain.ground_plate pixels_per_world_unit must match image_size_px / world_size")


func _validate_boundaries(value: Variant) -> void:
	if typeof(value) != TYPE_ARRAY:
		_add_error("layout.boundaries must be an array")
		return
	var ids: Dictionary = {}
	for index in (value as Array).size():
		var context := "layout.boundaries[%d]" % index
		var entry_value: Variant = (value as Array)[index]
		if typeof(entry_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var boundary: Dictionary = entry_value
		_require_keys(boundary, ["id", "position", "size"], context)
		if boundary.has("id"):
			var boundary_id := String(boundary["id"])
			_expect_nonempty_string(boundary["id"], "%s.id" % context)
			if ids.has(boundary_id):
				_add_error("%s.id duplicates boundary '%s'" % [context, boundary_id])
			ids[boundary_id] = true
		if boundary.has("position"):
			_validate_number_array(boundary["position"], 3, "%s.position" % context, false)
		if boundary.has("size"):
			_validate_number_array(boundary["size"], 3, "%s.size" % context, true)


func _validate_spawn_points(value: Variant) -> void:
	if typeof(value) != TYPE_ARRAY:
		_add_error("layout.spawn_points must be an array")
		return
	if (value as Array).is_empty():
		_add_error("layout.spawn_points must not be empty")
		return
	var ids: Dictionary = {}
	for spawn_index in (value as Array).size():
		var context := "layout.spawn_points[%d]" % spawn_index
		var spawn_value: Variant = (value as Array)[spawn_index]
		if typeof(spawn_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var spawn: Dictionary = spawn_value
		_require_keys(spawn, ["id", "position"], context)
		if spawn.has("id"):
			var spawn_id := String(spawn["id"])
			_expect_nonempty_string(spawn["id"], "%s.id" % context)
			if ids.has(spawn_id):
				_add_error("%s.id duplicates spawn point '%s'" % [context, spawn_id])
			ids[spawn_id] = true
		if spawn.has("position"):
			_validate_number_array(spawn["position"], 3, "%s.position" % context, false)


func _validate_critical_routes(value: Variant) -> void:
	if typeof(value) != TYPE_ARRAY:
		_add_error("layout.critical_routes must be an array")
		return
	if (value as Array).is_empty():
		_add_error("layout.critical_routes must not be empty")
		return
	for route_index in (value as Array).size():
		var context := "layout.critical_routes[%d]" % route_index
		var route_value: Variant = (value as Array)[route_index]
		if typeof(route_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var route: Dictionary = route_value
		_require_keys(route, ["id", "points"], context)
		if route.has("id"):
			_expect_nonempty_string(route["id"], "%s.id" % context)
		if route.has("points"):
			if typeof(route["points"]) != TYPE_ARRAY or (route["points"] as Array).size() < 2:
				_add_error("%s.points must contain at least two positions" % context)
			else:
				for point_index in (route["points"] as Array).size():
					_validate_number_array(
						(route["points"] as Array)[point_index],
						2,
						"%s.points[%d]" % [context, point_index],
						false,
					)


func _validate_layout_against_catalog() -> void:
	if not _catalog.has("catalog_version") or not _layout.has("catalog_version"):
		return
	if _layout["catalog_version"] != _catalog["catalog_version"]:
		_add_error(
			"layout.catalog_version (%s) must match catalog.catalog_version (%s)"
			% [str(_layout["catalog_version"]), str(_catalog["catalog_version"])]
		)
	if not _catalog.has("projection") or typeof(_catalog["projection"]) != TYPE_DICTIONARY:
		return
	var projection: Dictionary = _catalog["projection"]
	if projection.has("id") and _layout.has("projection_id") and _layout["projection_id"] != projection["id"]:
		_add_error("layout.projection_id must match catalog.projection.id")
	_validate_terrain_catalog_references()
	_validate_placements()


func _validate_terrain_catalog_references() -> void:
	if not _layout.has("terrain") or typeof(_layout["terrain"]) != TYPE_DICTIONARY:
		return
	if not _catalog.has("floor_atlas") or typeof(_catalog["floor_atlas"]) != TYPE_DICTIONARY:
		return
	var terrain: Dictionary = _layout["terrain"]
	var floor_atlas: Dictionary = _catalog["floor_atlas"]
	if not terrain.has("tile_legend") or typeof(terrain["tile_legend"]) != TYPE_DICTIONARY:
		return
	if not terrain.has("tile_rows") or typeof(terrain["tile_rows"]) != TYPE_ARRAY:
		return
	if not floor_atlas.has("tiles") or typeof(floor_atlas["tiles"]) != TYPE_DICTIONARY:
		return
	var legend: Dictionary = terrain["tile_legend"]
	var tiles: Dictionary = floor_atlas["tiles"]
	for symbol_variant in legend.keys():
		var symbol := String(symbol_variant)
		var tile_id := String(legend[symbol_variant])
		if symbol.length() != 1:
			_add_error("layout.terrain.tile_legend key '%s' must be one character" % symbol)
		if not tiles.has(tile_id):
			_add_error("layout.terrain.tile_legend '%s' references unknown tile '%s'" % [symbol, tile_id])
	for row_index in (terrain["tile_rows"] as Array).size():
		if typeof((terrain["tile_rows"] as Array)[row_index]) != TYPE_STRING:
			continue
		var row_text := String((terrain["tile_rows"] as Array)[row_index])
		for column in row_text.length():
			var symbol := row_text.substr(column, 1)
			if not legend.has(symbol):
				_add_error("layout.terrain.tile_rows[%d][%d] uses undefined symbol '%s'" % [row_index, column, symbol])


func _validate_placements() -> void:
	if not _layout.has("placements") or typeof(_layout["placements"]) != TYPE_ARRAY:
		return
	if not _catalog.has("objects") or typeof(_catalog["objects"]) != TYPE_DICTIONARY:
		return
	var objects: Dictionary = _catalog["objects"]
	var profiles: Dictionary = _catalog.get("collision_profiles", {})
	var placement_ids: Dictionary = {}
	var placements_by_object: Dictionary = {}
	for index in (_layout["placements"] as Array).size():
		var context := "layout.placements[%d]" % index
		var placement_value: Variant = (_layout["placements"] as Array)[index]
		if typeof(placement_value) != TYPE_DICTIONARY:
			_add_error("%s must be an object" % context)
			continue
		var placement: Dictionary = placement_value
		_require_keys(placement, REQUIRED_PLACEMENT_KEYS, context)
		if not _has_keys(placement, REQUIRED_PLACEMENT_KEYS):
			continue
		var placement_id := String(placement["id"])
		_expect_nonempty_string(placement["id"], "%s.id" % context)
		if placement_ids.has(placement_id):
			_add_error("%s.id duplicates placement '%s'" % [context, placement_id])
		placement_ids[placement_id] = true
		var object_id := String(placement["object"])
		if object_id.is_empty() or not objects.has(object_id):
			_add_error("%s.object references unknown object '%s'" % [context, object_id])
			continue
		_validate_number_array(placement["position"], 2, "%s.position" % context, false)
		_expect_positive_number(placement["scale"], "%s.scale" % context)
		var layer := String(placement["layer"])
		if layer not in ["back", "middle", "front"]:
			_add_error("%s.layer must be 'back', 'middle', or 'front'" % context)
		if typeof(placement["flip_horizontal"]) != TYPE_BOOL:
			_add_error("%s.flip_horizontal must be a boolean" % context)
		if typeof(placement["collision_enabled"]) != TYPE_BOOL:
			_add_error("%s.collision_enabled must be a boolean" % context)
		_validate_string_array(placement["tags"], "%s.tags" % context, false)
		var definition: Dictionary = objects[object_id]
		var desired_height := float(definition["default_world_height"]) * float(placement["scale"])
		var allowed: Array = definition["allowed_world_height"]
		if desired_height < float(allowed[0]) - 0.0001 or desired_height > float(allowed[1]) + 0.0001:
			_add_error("%s.scale produces height %.3f outside %s.allowed_world_height" % [context, desired_height, object_id])
		var reuse: Dictionary = definition["reuse"]
		if bool(placement["flip_horizontal"]) and not bool(reuse["allow_horizontal_flip"]):
			_add_error("%s flips object '%s', but its reuse contract forbids flipping" % [context, object_id])
		if bool(placement["collision_enabled"]):
			var profile_id := String(definition["collision_profile"])
			if not profiles.has(profile_id) or ((profiles[profile_id] as Dictionary).get("shapes", []) as Array).is_empty():
				_add_error("%s enables collision, but object '%s' has no collision shapes" % [context, object_id])
		if not placements_by_object.has(object_id):
			placements_by_object[object_id] = []
		(placements_by_object[object_id] as Array).append(placement)
	_validate_reuse_limits(placements_by_object, objects)


func _validate_reuse_limits(placements_by_object: Dictionary, objects: Dictionary) -> void:
	for object_id_variant in placements_by_object.keys():
		var object_id := String(object_id_variant)
		var placements: Array = placements_by_object[object_id]
		var definition: Dictionary = objects[object_id]
		var reuse: Dictionary = definition["reuse"]
		var maximum := int(reuse["maximum_placements_per_layout"])
		if placements.size() > maximum:
			_add_error("layout uses '%s' %d times; catalog maximum is %d" % [object_id, placements.size(), maximum])


func _add_prop_card(
	parent: Node3D,
	placement: Dictionary,
	definition: Dictionary,
	texture: Texture2D,
	texture_path: String,
	asset_placement_count: int,
) -> void:
	var sprite := Sprite3D.new()
	var placement_id := String(placement["id"])
	var object_id := String(placement["object"])
	var anchor := _array_to_vector2(definition["anchor_px"])
	var desired_height := float(definition["default_world_height"]) * float(placement["scale"])
	var pixel_size := desired_height / (float(texture.get_height()) * CARD_Y_SCALE_COMPENSATION)
	var flip_horizontal := bool(placement["flip_horizontal"])
	var effective_anchor_x := float(texture.get_width()) - anchor.x if flip_horizontal else anchor.x
	var anchor_from_center_x := effective_anchor_x - float(texture.get_width()) * 0.5
	var anchor_from_center_y := anchor.y - float(texture.get_height()) * 0.5
	var position_2d := _array_to_vector2(placement["position"])
	var card_right := Vector3(cos(CARD_YAW_RADIANS), 0.0, -sin(CARD_YAW_RADIANS))
	var world_anchor := Vector3(position_2d.x, CARD_GROUND_Y, position_2d.y)
	var sprite_position := world_anchor - card_right * anchor_from_center_x * pixel_size
	sprite_position.y = CARD_GROUND_Y + anchor_from_center_y * pixel_size * CARD_Y_SCALE_COMPENSATION

	sprite.name = placement_id
	sprite.texture = texture
	sprite.pixel_size = pixel_size
	sprite.scale.y = CARD_Y_SCALE_COMPENSATION
	sprite.flip_h = flip_horizontal
	sprite.position = sprite_position
	sprite.rotation.y = CARD_YAW_RADIANS
	sprite.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_OPAQUE_PREPASS
	sprite.alpha_scissor_threshold = 0.08
	sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	sprite.shaded = false
	sprite.double_sided = true
	sprite.no_depth_test = false
	sprite.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sprite.render_priority = 0
	sprite.set_meta("catalog_id", String(_catalog["catalog_id"]))
	sprite.set_meta("catalog_version", int(_catalog["catalog_version"]))
	sprite.set_meta("asset_id", object_id)
	sprite.set_meta("object_id", object_id)
	sprite.set_meta("placement_id", placement_id)
	sprite.set_meta("layer", String(placement["layer"]))
	sprite.set_meta("ground_anchor_px", anchor)
	sprite.set_meta("effective_ground_anchor_px", Vector2(effective_anchor_x, anchor.y))
	sprite.set_meta("world_ground_anchor", world_anchor)
	sprite.set_meta("world_height", desired_height)
	sprite.set_meta("placement_scale", float(placement["scale"]))
	sprite.set_meta("flip_horizontal", flip_horizontal)
	sprite.set_meta("collision_profile", String(definition["collision_profile"]))
	sprite.set_meta("collision_enabled", bool(placement["collision_enabled"]))
	sprite.set_meta("collision_scale_mode", String(definition["collision_scale_mode"]))
	sprite.set_meta("reusable_object", bool((definition["reuse"] as Dictionary)["single_object"]))
	sprite.set_meta("object_count", 1)
	sprite.set_meta("asset_placement_count", asset_placement_count)
	sprite.set_meta("occlusion_mode", String((definition["occlusion"] as Dictionary)["mode"]))
	sprite.set_meta("object_tags", definition["tags"])
	sprite.set_meta("placement_tags", placement["tags"])
	sprite.set_meta("source_id", String(definition["source_id"]))
	sprite.set_meta("texture_path", texture_path)
	sprite.add_to_group("memory_grove_prop_card")
	parent.add_child(sprite)


func _add_solid_prop(parent: Node3D, placement: Dictionary, definition: Dictionary) -> void:
	var body := StaticBody3D.new()
	body.name = "%sCollider" % String(placement["id"])
	var position_2d := _array_to_vector2(placement["position"])
	body.position = Vector3(position_2d.x, 0.0, position_2d.y)
	body.collision_layer = 1
	body.collision_mask = 1
	var profile_id := String(definition["collision_profile"])
	body.set_meta("placement_id", String(placement["id"]))
	body.set_meta("object_id", String(placement["object"]))
	body.set_meta("collision_profile", profile_id)
	body.set_meta("collision_scale_mode", String(definition["collision_scale_mode"]))
	body.add_to_group("memory_grove_solid_prop")
	var profile: Dictionary = (_catalog["collision_profiles"] as Dictionary)[profile_id]
	var scale_factor := float(placement["scale"]) if String(definition["collision_scale_mode"]) == "with-visual" else 1.0
	for shape_index in (profile["shapes"] as Array).size():
		_add_descriptor_shape(
			body,
			(profile["shapes"] as Array)[shape_index],
			shape_index,
			scale_factor,
		)
	parent.add_child(body)


func _add_descriptor_shape(
	parent: StaticBody3D,
	descriptor: Dictionary,
	shape_index: int,
	scale_factor: float,
) -> void:
	var collision := CollisionShape3D.new()
	collision.name = "Shape%d" % (shape_index + 1)
	var shape_type := String(descriptor["type"])
	if shape_type == "cylinder":
		var cylinder := CylinderShape3D.new()
		cylinder.radius = float(descriptor["radius"]) * scale_factor
		cylinder.height = float(descriptor["height"]) * scale_factor
		collision.shape = cylinder
	else:
		var box := BoxShape3D.new()
		box.size = _array_to_vector3(descriptor["size"]) * scale_factor
		collision.shape = box
	var local_offset := _array_to_vector3(descriptor["offset"]) * scale_factor
	var card_right := Vector3(cos(CARD_YAW_RADIANS), 0.0, -sin(CARD_YAW_RADIANS))
	var card_depth := Vector3(sin(CARD_YAW_RADIANS), 0.0, cos(CARD_YAW_RADIANS))
	collision.position = card_right * local_offset.x + Vector3.UP * local_offset.y + card_depth * local_offset.z
	collision.set_meta("descriptor_index", shape_index)
	collision.set_meta("descriptor_type", shape_type)
	parent.add_child(collision)


func _add_boundary_colliders(parent: Node3D) -> void:
	for boundary_variant in _layout["boundaries"]:
		var boundary: Dictionary = boundary_variant
		var body := StaticBody3D.new()
		body.name = String(boundary["id"])
		body.position = _array_to_vector3(boundary["position"])
		body.collision_layer = 1
		body.collision_mask = 1
		body.set_meta("collision_role", "walkable-boundary")
		body.set_meta("boundary_id", String(boundary["id"]))
		body.add_to_group("memory_grove_boundary")
		var collision := CollisionShape3D.new()
		collision.name = "BoundaryShape"
		var shape := BoxShape3D.new()
		shape.size = _array_to_vector3(boundary["size"])
		collision.shape = shape
		body.add_child(collision)
		parent.add_child(body)


func _build_navigation_blocked_cells() -> Array[Vector2i]:
	var terrain: Dictionary = _layout["terrain"]
	var columns := int(terrain["columns"])
	var rows := int(terrain["rows"])
	var cell_size := float(terrain["cell_size"])
	var origin := Vector2(
		-float(columns) * cell_size * 0.5,
		-float(rows) * cell_size * 0.5,
	)
	var blocked: Array[Vector2i] = []
	for row in rows:
		for column in columns:
			var point := origin + Vector2(float(column) + 0.5, float(row) + 0.5) * cell_size
			if _navigation_point_is_blocked(point):
				blocked.append(Vector2i(column, row))
	return blocked


func _navigation_point_is_blocked(point: Vector2) -> bool:
	for boundary_variant in _layout["boundaries"]:
		var boundary: Dictionary = boundary_variant
		var position := _array_to_vector3(boundary["position"])
		var boundary_size := _array_to_vector3(boundary["size"])
		if (
			absf(point.x - position.x) <= boundary_size.x * 0.5 + NAVIGATION_CLEARANCE
			and absf(point.y - position.z) <= boundary_size.z * 0.5 + NAVIGATION_CLEARANCE
		):
			return true
	var objects: Dictionary = _catalog["objects"]
	var profiles: Dictionary = _catalog["collision_profiles"]
	for placement_variant in _layout["placements"]:
		var placement: Dictionary = placement_variant
		if not bool(placement["collision_enabled"]):
			continue
		var definition: Dictionary = objects[String(placement["object"])]
		var scale_factor := (
			float(placement["scale"])
			if String(definition["collision_scale_mode"]) == "with-visual"
			else 1.0
		)
		var placement_position := _array_to_vector2(placement["position"])
		var profile: Dictionary = profiles[String(definition["collision_profile"])]
		for shape_variant in profile["shapes"]:
			var descriptor: Dictionary = shape_variant
			var offset := _array_to_vector3(descriptor["offset"]) * scale_factor
			var center := placement_position + Vector2(offset.x, offset.z)
			if String(descriptor["type"]) == "cylinder":
				var radius := float(descriptor["radius"]) * scale_factor + NAVIGATION_CLEARANCE
				if point.distance_squared_to(center) <= radius * radius:
					return true
			elif String(descriptor["type"]) == "box":
				var box_size := _array_to_vector3(descriptor["size"]) * scale_factor
				if (
					absf(point.x - center.x) <= box_size.x * 0.5 + NAVIGATION_CLEARANCE
					and absf(point.y - center.y) <= box_size.z * 0.5 + NAVIGATION_CLEARANCE
				):
					return true
	return false


func _finalize_successful_build(
	grove: Node3D,
	terrain_surface: Node3D,
	layer_nodes: Dictionary,
	solid_props: Node3D,
	boundary_colliders: Node3D,
) -> void:
	var terrain: Dictionary = _layout["terrain"]
	grove.set_meta("layout_id", String(_layout["layout_id"]))
	grove.set_meta("catalog_id", String(_catalog["catalog_id"]))
	grove.set_meta("catalog_version", int(_catalog["catalog_version"]))
	grove.set_meta("projection_id", String(_layout["projection_id"]))
	grove.set_meta("loaded", true)
	grove.set_meta("validation_errors", [])
	grove.set_meta("terrain_render_batch_count", terrain_surface.get_child_count())
	grove.set_meta("terrain_total_chunk_count", int(terrain_surface.get_meta("total_chunk_count", 0)))
	grove.set_meta("terrain_loaded_chunk_count", int(terrain_surface.get_meta("loaded_chunk_count", 0)))
	grove.set_meta("terrain_source_tile_count", int(terrain_surface.get_meta("logical_tile_count", 0)))
	grove.set_meta("terrain_render_tile_count", int(terrain_surface.get_meta("total_tile_count", 0)))
	grove.set_meta("logical_ground_cell_count", int(terrain["columns"]) * int(terrain["rows"]))
	grove.set_meta("logical_ground_cell_size", float(terrain["cell_size"]))
	grove.set_meta("ground_render_mode", String((terrain["render_tiles"] as Dictionary)["render_role"]))
	grove.set_meta("ground_pixels_per_world_unit", float((terrain["render_tiles"] as Dictionary)["pixels_per_world_unit"]))
	var navigation_origin := Vector2(
		-float(terrain["columns"]) * float(terrain["cell_size"]) * 0.5,
		-float(terrain["rows"]) * float(terrain["cell_size"]) * 0.5,
	)
	grove.set_meta("navigation_columns", int(terrain["columns"]))
	grove.set_meta("navigation_rows", int(terrain["rows"]))
	grove.set_meta("navigation_cell_size", float(terrain["cell_size"]))
	grove.set_meta("navigation_origin", navigation_origin)
	grove.set_meta("navigation_clearance", NAVIGATION_CLEARANCE)
	grove.set_meta("navigation_blocked_cells", _build_navigation_blocked_cells())
	grove.set_meta("default_spawn", _array_to_vector3((_layout["spawn_points"] as Array)[0]["position"]))
	grove.set_meta("prop_asset_count", (_catalog["objects"] as Dictionary).size())
	grove.set_meta("prop_placement_count", (_layout["placements"] as Array).size())
	grove.set_meta("back_prop_count", (layer_nodes["back"] as Node3D).get_child_count())
	grove.set_meta("middle_prop_count", (layer_nodes["middle"] as Node3D).get_child_count())
	grove.set_meta("front_prop_count", (layer_nodes["front"] as Node3D).get_child_count())
	grove.set_meta("solid_prop_count", solid_props.get_child_count())
	grove.set_meta("boundary_collider_count", boundary_colliders.get_child_count())
	grove.set_meta("collision_object_count", solid_props.get_child_count() + boundary_colliders.get_child_count())
	grove.set_meta("shadow_pass_count", 0)
	grove.set_meta("missing_assets", [])
	failure_message = ""


func _finalize_failed_build(grove: Node3D) -> void:
	var messages: Array[String] = _validation_errors.duplicate()
	if not _missing_assets.is_empty():
		messages.append("Missing scenery textures: %s" % ", ".join(_missing_assets))
	failure_message = "Memory Grove v6 could not be built:\n- %s" % "\n- ".join(messages)
	grove.set_meta("loaded", false)
	grove.set_meta("validation_errors", messages)
	grove.set_meta("missing_assets", _missing_assets.duplicate())
	grove.set_meta("terrain_render_batch_count", 0)
	grove.set_meta("prop_placement_count", 0)
	grove.set_meta("solid_prop_count", 0)
	grove.set_meta("boundary_collider_count", 0)
	grove.set_meta("collision_object_count", 0)
	grove.set_meta("shadow_pass_count", 0)
	for message in messages:
		push_error("Memory Grove v6: %s" % message)


func _load_texture(path: String, cache: Dictionary) -> Texture2D:
	if path.is_empty():
		return null
	if cache.has(path):
		return cache[path] as Texture2D
	if not ResourceLoader.exists(path, "Texture2D"):
		return null
	var texture := load(path) as Texture2D
	if texture != null:
		cache[path] = texture
	return texture


func _resolve_scenery_texture(raw_path: String, context: String) -> String:
	var normalized := raw_path.strip_edges().replace("\\", "/")
	if normalized.is_empty():
		return ""
	var lower_raw := normalized.to_lower()
	if (
		not normalized.begins_with("res://")
		and (normalized.is_absolute_path() or normalized.begins_with("/") or ":" in normalized)
	):
		_add_error("%s texture must use a project-relative or res:// path: %s" % [context, raw_path])
		return ""
	if ".." in normalized.split("/", false):
		_add_error("%s texture cannot traverse parent directories: %s" % [context, raw_path])
		return ""
	for forbidden in FORBIDDEN_TEXTURE_SEGMENTS:
		if String(forbidden) in lower_raw:
			_add_error("%s texture references forbidden source segment '%s': %s" % [context, forbidden, raw_path])
			return ""
	var resolved := normalized if normalized.begins_with("res://") else SCENERY_ROOT + normalized
	resolved = resolved.simplify_path()
	if not resolved.begins_with(SCENERY_ROOT):
		_add_error("%s texture escaped %s: %s" % [context, SCENERY_ROOT, raw_path])
		return ""
	return resolved


func _expect_safe_texture(value: Variant, context: String, required_subdirectory: String) -> void:
	if typeof(value) != TYPE_STRING or String(value).is_empty():
		_add_error("%s must be a non-empty string" % context)
		return
	var path := _resolve_scenery_texture(String(value), context)
	if path.is_empty():
		return
	if not path.begins_with(SCENERY_ROOT + required_subdirectory):
		_add_error("%s must remain under %s%s" % [context, SCENERY_ROOT, required_subdirectory])


func _placement_counts_by_object() -> Dictionary:
	var counts: Dictionary = {}
	for placement_variant in _layout["placements"]:
		var placement: Dictionary = placement_variant
		var object_id := String(placement["object"])
		counts[object_id] = int(counts.get(object_id, 0)) + 1
	return counts


func _record_missing_asset(path: String) -> void:
	if path.is_empty():
		return
	if path not in _missing_assets:
		_missing_assets.append(path)


func _require_keys(dictionary: Dictionary, keys: Array, context: String) -> void:
	for key_variant in keys:
		var key := String(key_variant)
		if not dictionary.has(key):
			_add_error("%s is missing required key '%s'" % [context, key])


func _has_keys(dictionary: Dictionary, keys: Array) -> bool:
	for key_variant in keys:
		if not dictionary.has(String(key_variant)):
			return false
	return true


func _expect_int(value: Variant, context: String, expected: int) -> void:
	if not _is_integral_number(value) or int(value) != expected:
		_add_error("%s must be integer %d" % [context, expected])


func _expect_positive_int(value: Variant, context: String) -> void:
	if not _is_integral_number(value) or int(value) <= 0:
		_add_error("%s must be a positive integer" % context)


func _expect_nonempty_string(value: Variant, context: String) -> void:
	if typeof(value) != TYPE_STRING or String(value).is_empty():
		_add_error("%s must be a non-empty string" % context)


func _expect_string(value: Variant, context: String, expected: String) -> void:
	if typeof(value) != TYPE_STRING or String(value) != expected:
		_add_error("%s must be '%s'" % [context, expected])


func _expect_number_value(value: Variant, context: String, expected: float) -> void:
	if not _is_number(value) or not is_equal_approx(float(value), expected):
		_add_error("%s must be %.3f" % [context, expected])


func _expect_positive_number(value: Variant, context: String) -> void:
	if not _is_number(value) or float(value) <= 0.0:
		_add_error("%s must be a positive number" % context)


func _validate_number_array(value: Variant, length: int, context: String, positive: bool) -> void:
	if not _valid_number_array(value, length, positive):
		var qualifier := "positive " if positive else ""
		_add_error("%s must be an array of %d %snumbers" % [context, length, qualifier])


func _validate_positive_integer_pair(value: Variant, context: String) -> void:
	if not _valid_positive_integer_pair(value):
		_add_error("%s must contain two positive integers" % context)


func _valid_positive_integer_pair(value: Variant) -> bool:
	if typeof(value) != TYPE_ARRAY or (value as Array).size() != 2:
		return false
	for item in value as Array:
		if not _is_integral_number(item) or int(item) <= 0:
			return false
	return true


func _valid_number_array(value: Variant, length: int, positive: bool) -> bool:
	if typeof(value) != TYPE_ARRAY or (value as Array).size() != length:
		return false
	for item in value as Array:
		if not _is_number(item):
			return false
		if positive and float(item) <= 0.0:
			return false
	return true


func _validate_number_array_any_length(value: Variant, context: String, positive: bool) -> void:
	if typeof(value) != TYPE_ARRAY or (value as Array).is_empty():
		_add_error("%s must be a non-empty numeric array" % context)
		return
	for item in value as Array:
		if not _is_number(item) or (positive and float(item) <= 0.0):
			_add_error("%s must contain only valid numbers" % context)
			return


func _validate_string_array(value: Variant, context: String, allow_empty: bool) -> void:
	if typeof(value) != TYPE_ARRAY:
		_add_error("%s must be an array of strings" % context)
		return
	if not allow_empty and (value as Array).is_empty():
		_add_error("%s must not be empty" % context)
		return
	for item in value as Array:
		if typeof(item) != TYPE_STRING or String(item).is_empty():
			_add_error("%s must contain only non-empty strings" % context)
			return


func _array_to_vector2(value: Variant) -> Vector2:
	var values: Array = value
	return Vector2(float(values[0]), float(values[1]))


func _array_to_vector3(value: Variant) -> Vector3:
	var values: Array = value
	return Vector3(float(values[0]), float(values[1]), float(values[2]))


func _is_number(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT


func _is_integral_number(value: Variant) -> bool:
	return _is_number(value) and is_equal_approx(float(value), roundf(float(value)))


func _is_slug(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING:
		return false
	var text := String(value)
	if text.is_empty() or text.begins_with("-") or text.ends_with("-") or text.contains("--"):
		return false
	for index in text.length():
		var codepoint := text.unicode_at(index)
		if codepoint == 45:
			continue
		if codepoint >= 48 and codepoint <= 57:
			continue
		if codepoint >= 97 and codepoint <= 122:
			continue
		return false
	return true


func _add_error(message: String) -> void:
	if message not in _validation_errors:
		_validation_errors.append(message)
