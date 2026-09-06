extends Node3D

const TERRAIN_Y := -0.045

var failure_message := ""

var _render_tiles: Dictionary = {}
var _tile_index_rows: Array = []
var _texture: Texture2D
var _texture_path := ""
var _target: Node3D
var _material: StandardMaterial3D

var _atlas_size_px := Vector2i.ZERO
var _tile_size_px := Vector2i.ZERO
var _tile_content_size_px := Vector2i.ZERO
var _tile_gutter_px := 0
var _atlas_grid := Vector2i.ZERO
var _logical_size_tiles := Vector2i.ZERO
var _render_size_tiles := Vector2i.ZERO
var _chunk_grid := Vector2i.ZERO
var _world_tile_size := 0.0
var _chunk_size_tiles := 0
var _padding_tiles := 0
var _padding_tile_index := 0
var _stream_radius_chunks := 0
var _configured := false
var _focus_chunk := Vector2i(-1, -1)
var _loaded_chunks: Dictionary = {}


func configure(
	render_tiles: Dictionary,
	tile_index_rows: Array,
	texture: Texture2D,
	texture_path: String,
	initial_focus: Vector2,
) -> bool:
	_reset_configuration()
	failure_message = _validate_configuration(render_tiles, tile_index_rows, texture)
	if not failure_message.is_empty():
		set_meta("configured", false)
		set_meta("failure_message", failure_message)
		push_error("Terrain chunk streamer: %s" % failure_message)
		return false

	_render_tiles = render_tiles.duplicate(true)
	_tile_index_rows = tile_index_rows.duplicate(true)
	_texture = texture
	_texture_path = texture_path
	_atlas_size_px = _array_to_vector2i(_render_tiles["image_size_px"])
	_tile_size_px = _array_to_vector2i(_render_tiles["tile_size_px"])
	_tile_content_size_px = _array_to_vector2i(_render_tiles["tile_content_size_px"])
	_tile_gutter_px = int(_render_tiles["tile_gutter_px"])
	_atlas_grid = _array_to_vector2i(_render_tiles["atlas_grid"])
	_world_tile_size = float(_render_tiles["world_tile_size"])
	_chunk_size_tiles = int(_render_tiles["chunk_size_tiles"])
	_padding_tiles = int(_render_tiles["padding_tiles"])
	_padding_tile_index = int(_render_tiles["padding_tile_index"])
	_stream_radius_chunks = int(_render_tiles["stream_radius_chunks"])
	_logical_size_tiles = Vector2i((_tile_index_rows[0] as Array).size(), _tile_index_rows.size())
	_render_size_tiles = _logical_size_tiles + Vector2i.ONE * _padding_tiles * 2
	_chunk_grid = Vector2i(
		_ceiling_divide(_render_size_tiles.x, _chunk_size_tiles),
		_ceiling_divide(_render_size_tiles.y, _chunk_size_tiles),
	)
	_material = _create_material(_texture)
	_configured = true
	_publish_static_metadata()
	_stream_around(initial_focus, true)
	set_process(is_instance_valid(_target))
	return true


func set_target(target: Node3D) -> void:
	_target = target
	set_process(_configured and is_instance_valid(_target))
	if _configured and is_instance_valid(_target):
		_stream_around(_target_focus(), false)


func _process(_delta: float) -> void:
	if not _configured or not is_instance_valid(_target):
		set_process(false)
		return
	_stream_around(_target_focus(), false)


func _validate_configuration(
	render_tiles: Dictionary,
	tile_index_rows: Array,
	texture: Texture2D,
) -> String:
	var required_keys := [
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
		"render_role",
	]
	for key in required_keys:
		if not render_tiles.has(key):
			return "render_tiles is missing '%s'." % key
	if not _is_positive_pair(render_tiles["image_size_px"]):
		return "render_tiles.image_size_px must contain two positive integers."
	if not _is_positive_pair(render_tiles["tile_size_px"]):
		return "render_tiles.tile_size_px must contain two positive integers."
	if not _is_positive_pair(render_tiles["tile_content_size_px"]):
		return "render_tiles.tile_content_size_px must contain two positive integers."
	if not _is_nonnegative_integer(render_tiles["tile_gutter_px"]):
		return "render_tiles.tile_gutter_px must be a non-negative integer."
	if not _is_positive_pair(render_tiles["atlas_grid"]):
		return "render_tiles.atlas_grid must contain two positive integers."
	if not _is_positive_number(render_tiles["world_tile_size"]):
		return "render_tiles.world_tile_size must be positive."
	if not _is_positive_integer(render_tiles["chunk_size_tiles"]):
		return "render_tiles.chunk_size_tiles must be a positive integer."
	if not _is_nonnegative_integer(render_tiles["stream_radius_chunks"]):
		return "render_tiles.stream_radius_chunks must be a non-negative integer."
	if not _is_nonnegative_integer(render_tiles["padding_tiles"]):
		return "render_tiles.padding_tiles must be a non-negative integer."
	if not _is_nonnegative_integer(render_tiles["padding_tile_index"]):
		return "render_tiles.padding_tile_index must be a non-negative integer."
	if not _is_positive_number(render_tiles["pixels_per_world_unit"]):
		return "render_tiles.pixels_per_world_unit must be positive."
	if typeof(render_tiles["render_role"]) != TYPE_STRING or String(render_tiles["render_role"]) != "streamed-reusable-tile-map":
		return "render_tiles.render_role must be 'streamed-reusable-tile-map'."
	if texture == null:
		return "The terrain atlas texture is unavailable."

	var atlas_size := _array_to_vector2i(render_tiles["image_size_px"])
	var tile_size := _array_to_vector2i(render_tiles["tile_size_px"])
	var content_size := _array_to_vector2i(render_tiles["tile_content_size_px"])
	var gutter := int(render_tiles["tile_gutter_px"])
	var atlas_grid := _array_to_vector2i(render_tiles["atlas_grid"])
	if tile_size != content_size + Vector2i.ONE * gutter * 2:
		return "tile_size_px must equal tile_content_size_px plus two tile gutters."
	var declared_density := float(render_tiles["pixels_per_world_unit"])
	var density_x := float(content_size.x) / float(render_tiles["world_tile_size"])
	var density_y := float(content_size.y) / float(render_tiles["world_tile_size"])
	if not is_equal_approx(density_x, declared_density) or not is_equal_approx(density_y, declared_density):
		return "pixels_per_world_unit must match tile_content_size_px divided by world_tile_size."
	if tile_size.x * atlas_grid.x != atlas_size.x or tile_size.y * atlas_grid.y != atlas_size.y:
		return "The tile size and atlas grid must exactly cover image_size_px."
	if texture.get_width() != atlas_size.x or texture.get_height() != atlas_size.y:
		return "The terrain atlas dimensions do not match image_size_px."
	if tile_index_rows.is_empty():
		return "tile_index_rows must not be empty."
	if typeof(tile_index_rows[0]) != TYPE_ARRAY or (tile_index_rows[0] as Array).is_empty():
		return "tile_index_rows must contain non-empty rows."

	var column_count := (tile_index_rows[0] as Array).size()
	var atlas_tile_count := atlas_grid.x * atlas_grid.y
	if int(render_tiles["padding_tile_index"]) >= atlas_tile_count:
		return "render_tiles.padding_tile_index is outside the atlas grid."
	if typeof(render_tiles["tile_ids"]) != TYPE_ARRAY:
		return "render_tiles.tile_ids must be an array."
	var tile_ids: Array = render_tiles["tile_ids"]
	if tile_ids.size() != atlas_tile_count:
		return "render_tiles.tile_ids must contain one id per atlas cell."
	var seen_tile_ids: Dictionary = {}
	for tile_id_variant in tile_ids:
		if not _is_slug(tile_id_variant):
			return "render_tiles.tile_ids must contain non-empty slugs."
		var tile_id := String(tile_id_variant)
		if seen_tile_ids.has(tile_id):
			return "render_tiles.tile_ids must be unique."
		seen_tile_ids[tile_id] = true
	var connectivity_value: Variant = render_tiles["path_connectivity"]
	if typeof(connectivity_value) != TYPE_DICTIONARY:
		return "render_tiles.path_connectivity must be an object."
	var connectivity: Dictionary = connectivity_value
	var connectivity_bits := {
		"north_bit": 1,
		"east_bit": 2,
		"south_bit": 4,
		"west_bit": 8,
	}
	if not connectivity.has("first_index") or not _is_nonnegative_integer(connectivity["first_index"]):
		return "render_tiles.path_connectivity.first_index must be a non-negative integer."
	if int(connectivity["first_index"]) + 15 >= atlas_tile_count:
		return "render_tiles.path_connectivity must reserve 16 consecutive atlas cells."
	for bit_name_variant in connectivity_bits.keys():
		var bit_name := String(bit_name_variant)
		if not connectivity.has(bit_name) or not _is_integer(connectivity[bit_name]) or int(connectivity[bit_name]) != int(connectivity_bits[bit_name]):
			return "render_tiles.path_connectivity.%s has an invalid bit value." % bit_name
	var terrain_regions_error := _validate_terrain_regions(
		render_tiles["terrain_regions"],
		int(connectivity["first_index"]),
		atlas_tile_count,
	)
	if not terrain_regions_error.is_empty():
		return terrain_regions_error
	for row_index in tile_index_rows.size():
		if typeof(tile_index_rows[row_index]) != TYPE_ARRAY:
			return "tile_index_rows[%d] must be an array." % row_index
		var row: Array = tile_index_rows[row_index]
		if row.size() != column_count:
			return "Every tile_index_rows row must have the same length."
		for column_index in row.size():
			var value: Variant = row[column_index]
			if not _is_integer(value):
				return "tile_index_rows[%d][%d] must be an integer." % [row_index, column_index]
			var atlas_index := int(value)
			if atlas_index < 0 or atlas_index >= atlas_tile_count:
				return "tile_index_rows[%d][%d] is outside the atlas grid." % [row_index, column_index]
	return ""


func _validate_terrain_regions(
	value: Variant,
	path_first_index: int,
	atlas_tile_count: int,
) -> String:
	if typeof(value) != TYPE_ARRAY:
		return "render_tiles.terrain_regions must be an array."
	var required_bits := {
		"northwest_bit": 1,
		"northeast_bit": 2,
		"southeast_bit": 4,
		"southwest_bit": 8,
	}
	var seen_ids: Dictionary = {}
	var first_indices: Array[int] = []
	var full_variant_indices: Array[int] = []
	var seen_full_variant_indices: Dictionary = {}
	for region_index in (value as Array).size():
		var region_value: Variant = (value as Array)[region_index]
		if typeof(region_value) != TYPE_DICTIONARY:
			return "render_tiles.terrain_regions[%d] must be an object." % region_index
		var region: Dictionary = region_value
		if not region.has("id") or not _is_slug(region["id"]):
			return "render_tiles.terrain_regions[%d].id must be a non-empty slug." % region_index
		var region_id := String(region["id"])
		if seen_ids.has(region_id):
			return "render_tiles.terrain_regions ids must be unique."
		seen_ids[region_id] = true
		if not region.has("first_index") or not _is_nonnegative_integer(region["first_index"]):
			return "render_tiles.terrain_regions[%d].first_index must be a non-negative integer." % region_index
		var first_index := int(region["first_index"])
		if first_index + 15 >= atlas_tile_count:
			return "render_tiles.terrain_regions[%d] must reserve 16 consecutive atlas cells." % region_index
		if _atlas_ranges_overlap(first_index, path_first_index):
			return "render_tiles.terrain_regions[%d] overlaps the path topology range." % region_index
		for occupied_first_index in first_indices:
			if _atlas_ranges_overlap(first_index, occupied_first_index):
				return "render_tiles.terrain_regions[%d] overlaps another terrain region." % region_index
		first_indices.append(first_index)
		for bit_name_variant in required_bits.keys():
			var bit_name := String(bit_name_variant)
			if not region.has(bit_name) or not _is_integer(region[bit_name]) or int(region[bit_name]) != int(required_bits[bit_name]):
				return "render_tiles.terrain_regions[%d].%s has an invalid bit value." % [region_index, bit_name]
		if region.has("full_variant_indices"):
			var variants_value: Variant = region["full_variant_indices"]
			if typeof(variants_value) != TYPE_ARRAY or (variants_value as Array).is_empty():
				return "render_tiles.terrain_regions[%d].full_variant_indices must be a non-empty array." % region_index
			for variant_value in (variants_value as Array):
				if not _is_nonnegative_integer(variant_value):
					return "render_tiles.terrain_regions[%d].full_variant_indices must contain non-negative integers." % region_index
				var variant_index := int(variant_value)
				if variant_index >= atlas_tile_count:
					return "render_tiles.terrain_regions[%d].full_variant_indices contains an index outside the atlas." % region_index
				if seen_full_variant_indices.has(variant_index):
					return "render_tiles.terrain_regions full_variant_indices must be unique."
				seen_full_variant_indices[variant_index] = true
				full_variant_indices.append(variant_index)
	for variant_index in full_variant_indices:
		if variant_index >= path_first_index and variant_index <= path_first_index + 15:
			return "render_tiles.terrain_regions full_variant_indices overlap the path topology range."
		for first_index in first_indices:
			if variant_index >= first_index and variant_index <= first_index + 15:
				return "render_tiles.terrain_regions full_variant_indices overlap a terrain-region topology range."
	return ""


func _atlas_ranges_overlap(first_index: int, other_first_index: int) -> bool:
	return first_index <= other_first_index + 15 and other_first_index <= first_index + 15


func _reset_configuration() -> void:
	set_process(false)
	for chunk_variant in _loaded_chunks.values():
		var chunk := chunk_variant as MeshInstance3D
		if is_instance_valid(chunk):
			remove_child(chunk)
			chunk.queue_free()
	_loaded_chunks.clear()
	_render_tiles.clear()
	_tile_index_rows.clear()
	_texture = null
	_texture_path = ""
	_material = null
	_atlas_size_px = Vector2i.ZERO
	_tile_size_px = Vector2i.ZERO
	_tile_content_size_px = Vector2i.ZERO
	_tile_gutter_px = 0
	_atlas_grid = Vector2i.ZERO
	_logical_size_tiles = Vector2i.ZERO
	_render_size_tiles = Vector2i.ZERO
	_chunk_grid = Vector2i.ZERO
	_world_tile_size = 0.0
	_chunk_size_tiles = 0
	_padding_tiles = 0
	_padding_tile_index = 0
	_stream_radius_chunks = 0
	_configured = false
	_focus_chunk = Vector2i(-1, -1)
	_publish_dynamic_metadata()


func _create_material(texture: Texture2D) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.albedo_color = Color.WHITE
	material.albedo_texture = texture
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	material.roughness = 1.0
	material.metallic = 0.0
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.no_depth_test = false
	material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
	return material


func _stream_around(focus: Vector2, force: bool) -> void:
	var next_focus_chunk := _focus_to_chunk(focus)
	if not force and next_focus_chunk == _focus_chunk:
		return
	_focus_chunk = next_focus_chunk

	var minimum_chunk := Vector2i(
		maxi(0, _focus_chunk.x - _stream_radius_chunks),
		maxi(0, _focus_chunk.y - _stream_radius_chunks),
	)
	var maximum_chunk := Vector2i(
		mini(_chunk_grid.x - 1, _focus_chunk.x + _stream_radius_chunks),
		mini(_chunk_grid.y - 1, _focus_chunk.y + _stream_radius_chunks),
	)
	var desired_chunks: Dictionary = {}
	for chunk_y in range(minimum_chunk.y, maximum_chunk.y + 1):
		for chunk_x in range(minimum_chunk.x, maximum_chunk.x + 1):
			desired_chunks[Vector2i(chunk_x, chunk_y)] = true

	for coordinate_variant in _loaded_chunks.keys():
		var coordinate: Vector2i = coordinate_variant
		if desired_chunks.has(coordinate):
			continue
		var stale_chunk := _loaded_chunks[coordinate] as MeshInstance3D
		_loaded_chunks.erase(coordinate)
		if is_instance_valid(stale_chunk):
			remove_child(stale_chunk)
			stale_chunk.queue_free()

	for chunk_y in range(minimum_chunk.y, maximum_chunk.y + 1):
		for chunk_x in range(minimum_chunk.x, maximum_chunk.x + 1):
			var coordinate := Vector2i(chunk_x, chunk_y)
			if _loaded_chunks.has(coordinate):
				continue
			var chunk := _build_chunk(coordinate)
			_loaded_chunks[coordinate] = chunk
			add_child(chunk)
	_publish_dynamic_metadata()


func _focus_to_chunk(focus: Vector2) -> Vector2i:
	var padded_half_size := Vector2(_logical_size_tiles) * _world_tile_size * 0.5
	padded_half_size += Vector2.ONE * _padding_tiles * _world_tile_size
	var render_tile := Vector2i(
		floori((focus.x + padded_half_size.x) / _world_tile_size),
		floori((focus.y + padded_half_size.y) / _world_tile_size),
	)
	render_tile.x = clampi(render_tile.x, 0, _render_size_tiles.x - 1)
	render_tile.y = clampi(render_tile.y, 0, _render_size_tiles.y - 1)
	return Vector2i(
		floori(float(render_tile.x) / float(_chunk_size_tiles)),
		floori(float(render_tile.y) / float(_chunk_size_tiles)),
	)


func _target_focus() -> Vector2:
	var target_local_position := to_local(_target.global_position)
	return Vector2(target_local_position.x, target_local_position.z)


func _build_chunk(chunk_coordinate: Vector2i) -> MeshInstance3D:
	var render_start := chunk_coordinate * _chunk_size_tiles
	var render_end := Vector2i(
		mini(render_start.x + _chunk_size_tiles, _render_size_tiles.x),
		mini(render_start.y + _chunk_size_tiles, _render_size_tiles.y),
	)
	var vertices := PackedVector3Array()
	var colors := PackedColorArray()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()

	for render_y in range(render_start.y, render_end.y):
		var logical_y := render_y - _padding_tiles
		for render_x in range(render_start.x, render_end.x):
			var logical_x := render_x - _padding_tiles
			var atlas_index := _padding_tile_index
			if (
				logical_x >= 0
				and logical_x < _logical_size_tiles.x
				and logical_y >= 0
				and logical_y < _logical_size_tiles.y
			):
				var source_row: Array = _tile_index_rows[logical_y]
				atlas_index = int(source_row[logical_x])
			var visual_atlas_index := _visual_atlas_index(
				logical_x,
				logical_y,
				atlas_index,
			)
			_append_tile(
				vertices,
				colors,
				uvs,
				indices,
				logical_x,
				logical_y,
				visual_atlas_index,
			)

	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, _material)

	var chunk := MeshInstance3D.new()
	chunk.name = "TerrainChunk_%d_%d" % [chunk_coordinate.x, chunk_coordinate.y]
	chunk.mesh = mesh
	chunk.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	chunk.set_meta("chunk_coordinate", chunk_coordinate)
	chunk.set_meta("render_tile_origin", render_start)
	chunk.set_meta("logical_tile_origin", render_start - Vector2i.ONE * _padding_tiles)
	chunk.set_meta("tile_count", (render_end.x - render_start.x) * (render_end.y - render_start.y))
	chunk.set_meta("surface_count", mesh.get_surface_count())
	chunk.set_meta("vertex_count", vertices.size())
	chunk.set_meta("index_count", indices.size())
	chunk.set_meta("texture_path", _texture_path)
	chunk.set_meta("shadow_passes", 0)
	chunk.add_to_group("memory_grove_terrain_chunk")
	return chunk


func _visual_atlas_index(
	logical_x: int,
	logical_y: int,
	authored_index: int,
) -> int:
	for region_value in _render_tiles.get("terrain_regions", []):
		if typeof(region_value) != TYPE_DICTIONARY:
			continue
		var region: Dictionary = region_value
		if not _is_nonnegative_integer(region.get("first_index")):
			continue
		var canonical_full_index := int(region["first_index"]) + 15
		if authored_index != canonical_full_index:
			continue
		var candidates: Array[int] = [canonical_full_index]
		var extra_indices_value: Variant = region.get("full_variant_indices", [])
		if typeof(extra_indices_value) == TYPE_ARRAY:
			for extra_index_value in (extra_indices_value as Array):
				if _is_nonnegative_integer(extra_index_value):
					candidates.append(int(extra_index_value))
		var stable_value := (
			logical_x * 7
			+ logical_y * 11
			+ logical_x * logical_y * 3
		)
		return candidates[posmod(stable_value, candidates.size())]
	return authored_index


func _append_tile(
	vertices: PackedVector3Array,
	colors: PackedColorArray,
	uvs: PackedVector2Array,
	indices: PackedInt32Array,
	logical_x: int,
	logical_y: int,
	atlas_index: int,
) -> void:
	var half_logical_width := float(_logical_size_tiles.x) * 0.5
	var half_logical_height := float(_logical_size_tiles.y) * 0.5
	var x0 := (float(logical_x) - half_logical_width) * _world_tile_size
	var x1 := x0 + _world_tile_size
	var z0 := (float(logical_y) - half_logical_height) * _world_tile_size
	var z1 := z0 + _world_tile_size

	var atlas_column := atlas_index % _atlas_grid.x
	var atlas_row := floori(float(atlas_index) / float(_atlas_grid.x))
	var content_origin_px := Vector2i(
		atlas_column * _tile_size_px.x + _tile_gutter_px,
		atlas_row * _tile_size_px.y + _tile_gutter_px,
	)
	var content_end_px := content_origin_px + _tile_content_size_px
	var uv_min := Vector2(
		float(content_origin_px.x) / float(_atlas_size_px.x),
		float(content_origin_px.y) / float(_atlas_size_px.y),
	)
	var uv_max := Vector2(
		float(content_end_px.x) / float(_atlas_size_px.x),
		float(content_end_px.y) / float(_atlas_size_px.y),
	)

	var base_index := vertices.size()
	vertices.append(Vector3(x0, TERRAIN_Y, z0))
	vertices.append(Vector3(x1, TERRAIN_Y, z0))
	vertices.append(Vector3(x1, TERRAIN_Y, z1))
	vertices.append(Vector3(x0, TERRAIN_Y, z1))
	uvs.append(Vector2(uv_min.x, uv_min.y))
	uvs.append(Vector2(uv_max.x, uv_min.y))
	uvs.append(Vector2(uv_max.x, uv_max.y))
	uvs.append(Vector2(uv_min.x, uv_max.y))
	for _vertex_index in 4:
		colors.append(Color.WHITE)
	indices.append(base_index)
	indices.append(base_index + 2)
	indices.append(base_index + 1)
	indices.append(base_index)
	indices.append(base_index + 3)
	indices.append(base_index + 2)


func _publish_static_metadata() -> void:
	set_meta("configured", true)
	set_meta("failure_message", "")
	set_meta("render_role", String(_render_tiles.get("render_role", "atlas-chunk-stream")))
	set_meta("projection", String(_render_tiles.get("projection", "top-down")))
	set_meta("source_id", String(_render_tiles.get("source_id", "")))
	set_meta("texture_path", _texture_path)
	set_meta("image_size_px", _atlas_size_px)
	set_meta("tile_size_px", _tile_size_px)
	set_meta("tile_content_size_px", _tile_content_size_px)
	set_meta("tile_gutter_px", _tile_gutter_px)
	set_meta("atlas_grid", _atlas_grid)
	set_meta("world_tile_size", _world_tile_size)
	set_meta("pixels_per_world_unit", float(_render_tiles.get("pixels_per_world_unit", 0.0)))
	set_meta("chunk_size_tiles", _chunk_size_tiles)
	set_meta("padding_tiles", _padding_tiles)
	set_meta("padding_tile_index", _padding_tile_index)
	set_meta("tile_ids", _render_tiles.get("tile_ids", []))
	set_meta("path_connectivity", _render_tiles.get("path_connectivity", {}))
	set_meta("terrain_regions", _render_tiles.get("terrain_regions", []))
	set_meta("stream_radius_chunks", _stream_radius_chunks)
	set_meta("logical_size_tiles", _logical_size_tiles)
	set_meta("render_size_tiles", _render_size_tiles)
	set_meta("chunk_grid", _chunk_grid)
	set_meta("total_chunk_count", _chunk_grid.x * _chunk_grid.y)
	set_meta("total_tile_count", _render_size_tiles.x * _render_size_tiles.y)
	set_meta("logical_tile_count", _logical_size_tiles.x * _logical_size_tiles.y)
	set_meta("surfaces_per_chunk", 1)
	set_meta("shadow_passes", 0)
	set_meta(
		"maximum_loaded_chunk_count",
		mini(
			_chunk_grid.x * _chunk_grid.y,
			(_stream_radius_chunks * 2 + 1) * (_stream_radius_chunks * 2 + 1),
		),
	)


func _publish_dynamic_metadata() -> void:
	var loaded_tile_count := 0
	for chunk_variant in _loaded_chunks.values():
		var chunk := chunk_variant as MeshInstance3D
		if is_instance_valid(chunk):
			loaded_tile_count += int(chunk.get_meta("tile_count", 0))
	set_meta("focus_chunk", _focus_chunk)
	set_meta("loaded_chunk_count", _loaded_chunks.size())
	set_meta("loaded_tile_count", loaded_tile_count)
	set_meta("loaded_surface_count", _loaded_chunks.size())


func _array_to_vector2i(value: Variant) -> Vector2i:
	var values: Array = value
	return Vector2i(int(values[0]), int(values[1]))


func _ceiling_divide(value: int, divisor: int) -> int:
	return floori(float(value + divisor - 1) / float(divisor))


func _is_positive_pair(value: Variant) -> bool:
	if typeof(value) != TYPE_ARRAY or (value as Array).size() != 2:
		return false
	var values: Array = value
	return _is_positive_integer(values[0]) and _is_positive_integer(values[1])


func _is_positive_number(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and float(value) > 0.0


func _is_integer(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_equal_approx(float(value), float(int(value)))


func _is_positive_integer(value: Variant) -> bool:
	return _is_integer(value) and int(value) > 0


func _is_nonnegative_integer(value: Variant) -> bool:
	return _is_integer(value) and int(value) >= 0


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
