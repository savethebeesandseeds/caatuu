class_name ClickNavigation
extends RefCounted

## Pure world-grid pathfinding for click and tap movement.
##
## The scenery builder owns navigation metadata. This helper deliberately has
## no scene, input, animation, rendering, or physics responsibilities, which
## keeps it usable by the current single-map prototype and future terrain
## chunks that publish the same metadata contract.

const META_COLUMNS := &"navigation_columns"
const META_ROWS := &"navigation_rows"
const META_CELL_SIZE := &"navigation_cell_size"
const META_ORIGIN := &"navigation_origin"
const META_BLOCKED_CELLS := &"navigation_blocked_cells"
const INVALID_CELL := Vector2i(-2147483648, -2147483648)
const WORLD_Y := 0.0
const DISTANCE_EPSILON := 0.000001
const GRID_TRAVERSAL_EPSILON := 0.000001
const ACTOR_CLEARANCE_RADIUS := 0.28

var _grid := AStarGrid2D.new()
var _configured := false
var _columns := 0
var _rows := 0
var _cell_size := 0.0
var _origin := Vector2.ZERO
var _blocked_cells: Array[Vector2i] = []


func configure(grove: Node) -> bool:
	_reset_configuration()
	if grove == null:
		return false
	for key in [META_COLUMNS, META_ROWS, META_CELL_SIZE, META_ORIGIN, META_BLOCKED_CELLS]:
		if not grove.has_meta(key):
			return false

	var columns_value: Variant = grove.get_meta(META_COLUMNS)
	var rows_value: Variant = grove.get_meta(META_ROWS)
	var cell_size_value: Variant = grove.get_meta(META_CELL_SIZE)
	if not _is_positive_integer(columns_value) or not _is_positive_integer(rows_value):
		return false
	if not _is_number(cell_size_value) or float(cell_size_value) <= 0.0:
		return false

	var parsed_origin: Variant = _parse_origin(grove.get_meta(META_ORIGIN))
	if parsed_origin == null:
		return false
	var columns := int(columns_value)
	var rows := int(rows_value)
	var blocked: Variant = _parse_blocked_cells(
		grove.get_meta(META_BLOCKED_CELLS),
		columns,
		rows,
	)
	if blocked == null:
		return false

	var grid := AStarGrid2D.new()
	grid.region = Rect2i(Vector2i.ZERO, Vector2i(columns, rows))
	grid.cell_size = Vector2.ONE * float(cell_size_value)
	grid.offset = parsed_origin + Vector2.ONE * float(cell_size_value) * 0.5
	grid.default_compute_heuristic = AStarGrid2D.HEURISTIC_OCTILE
	grid.default_estimate_heuristic = AStarGrid2D.HEURISTIC_OCTILE
	grid.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES
	grid.jumping_enabled = false
	grid.update()
	for cell in blocked as Array[Vector2i]:
		grid.set_point_solid(cell, true)

	_grid = grid
	_columns = columns
	_rows = rows
	_cell_size = float(cell_size_value)
	_origin = parsed_origin
	_blocked_cells = (blocked as Array[Vector2i]).duplicate()
	_configured = true
	return true


func find_path(start: Vector3, target: Vector3) -> PackedVector3Array:
	var empty := PackedVector3Array()
	if not _configured:
		return empty

	var start_seed := _clamp_cell(_world_to_unclamped_cell(start))
	var target_seed := _clamp_cell(_world_to_unclamped_cell(target))
	var start_value: Variant = _nearest_walkable_cell(start_seed)
	var target_value: Variant = _nearest_walkable_cell(target_seed)
	if start_value == null or target_value == null:
		return empty
	var start_cell: Vector2i = start_value
	var target_cell: Vector2i = target_value

	# Partial paths make an unreachable island target degrade to the closest
	# reachable cell instead of leaving the actor stuck or walking into a wall.
	var cell_path: Array[Vector2i] = _grid.get_id_path(start_cell, target_cell, true)
	if cell_path.is_empty():
		return empty
	var raw_world_path := PackedVector3Array()
	for cell in cell_path:
		raw_world_path.append(cell_to_world(cell))

	# Preserve the actor's precise start when it is already in the route's first
	# walkable cell. Every later shortcut is checked from this exact point.
	if is_world_walkable(start) and cell_path[0] == world_to_cell(start):
		raw_world_path[0] = Vector3(start.x, WORLD_Y, start.z)

	# Exact destinations remain pleasant in open ground. Near a blocked cell or
	# map edge the target cell center is the safer authority: the navigation grid
	# is sampled at cell centers, so accepting an arbitrary edge click there can
	# disagree with the capsule's continuous physics footprint.
	var reached_requested_cell := cell_path[-1] == target_cell
	var resolved_target := cell_to_world(cell_path[-1])
	if (
		reached_requested_cell
		and target_cell == world_to_cell(target)
		and _can_preserve_precise_target(target, target_cell)
	):
		resolved_target = Vector3(target.x, WORLD_Y, target.z)
	# Replacing the only point with an exact start must never erase the resolved
	# destination. This matters when the requested point shares the actor's cell
	# but its blocked neighborhood requires a move back to the safe cell center.
	if raw_world_path[-1].distance_squared_to(resolved_target) <= DISTANCE_EPSILON:
		raw_world_path[-1] = resolved_target
	else:
		raw_world_path.append(resolved_target)

	# Greedy string-pulling removes grid stair-steps while the supercover test
	# preserves every blocked-cell and no-corner-cut guarantee from AStarGrid2D.
	return _string_pull_world_path(raw_world_path)


func is_world_walkable(world_position: Vector3) -> bool:
	if not _configured:
		return false
	var cell := _world_to_unclamped_cell(world_position)
	return _is_cell_in_bounds(cell) and not _grid.is_point_solid(cell)


func world_to_cell(world_position: Vector3) -> Vector2i:
	if not _configured:
		return INVALID_CELL
	return _clamp_cell(_world_to_unclamped_cell(world_position))


func cell_to_world(cell: Vector2i) -> Vector3:
	if not _configured:
		return Vector3.ZERO
	var safe_cell := _clamp_cell(cell)
	return Vector3(
		_origin.x + (float(safe_cell.x) + 0.5) * _cell_size,
		WORLD_Y,
		_origin.y + (float(safe_cell.y) + 0.5) * _cell_size,
	)


func is_configured() -> bool:
	return _configured


func get_columns() -> int:
	return _columns


func get_rows() -> int:
	return _rows


func get_cell_size() -> float:
	return _cell_size


func get_origin() -> Vector2:
	return _origin


func get_blocked_cells() -> Array[Vector2i]:
	return _blocked_cells.duplicate()


func _world_to_unclamped_cell(world_position: Vector3) -> Vector2i:
	return Vector2i(
		floori((world_position.x - _origin.x) / _cell_size),
		floori((world_position.z - _origin.y) / _cell_size),
	)


func _clamp_cell(cell: Vector2i) -> Vector2i:
	return Vector2i(
		clampi(cell.x, 0, _columns - 1),
		clampi(cell.y, 0, _rows - 1),
	)


func _is_cell_in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < _columns and cell.y < _rows


func _nearest_walkable_cell(seed: Vector2i) -> Variant:
	var safe_seed := _clamp_cell(seed)
	if not _grid.is_point_solid(safe_seed):
		return safe_seed
	var maximum_radius := maxi(_columns, _rows)
	for radius in range(1, maximum_radius + 1):
		var best := INVALID_CELL
		var best_distance := INF
		var minimum_x := maxi(0, safe_seed.x - radius)
		var maximum_x := mini(_columns - 1, safe_seed.x + radius)
		var minimum_y := maxi(0, safe_seed.y - radius)
		var maximum_y := mini(_rows - 1, safe_seed.y + radius)
		for y in range(minimum_y, maximum_y + 1):
			for x in range(minimum_x, maximum_x + 1):
				var cell := Vector2i(x, y)
				if maxi(absi(x - safe_seed.x), absi(y - safe_seed.y)) != radius:
					continue
				if _grid.is_point_solid(cell):
					continue
				var distance := Vector2(cell - safe_seed).length_squared()
				if (
					distance < best_distance
					or (
						is_equal_approx(distance, best_distance)
						and (best == INVALID_CELL or cell.y < best.y or (cell.y == best.y and cell.x < best.x))
					)
				):
					best = cell
					best_distance = distance
		if best != INVALID_CELL:
			return best
	return null


func _can_preserve_precise_target(target: Vector3, target_cell: Vector2i) -> bool:
	if not is_world_walkable(target):
		return false
	for y_offset in range(-1, 2):
		for x_offset in range(-1, 2):
			var neighbor := target_cell + Vector2i(x_offset, y_offset)
			if not _is_cell_walkable(neighbor):
				return false
	return true


func _string_pull_world_path(raw_path: PackedVector3Array) -> PackedVector3Array:
	if raw_path.size() <= 1:
		return raw_path
	var pulled := PackedVector3Array([raw_path[0]])
	var anchor_index := 0
	while anchor_index < raw_path.size() - 1:
		var next_index := anchor_index + 1
		for candidate_index in range(raw_path.size() - 1, anchor_index, -1):
			if _segment_is_walkable(raw_path[anchor_index], raw_path[candidate_index]):
				next_index = candidate_index
				break
		pulled.append(raw_path[next_index])
		anchor_index = next_index
	return pulled


func _segment_is_walkable(from: Vector3, to: Vector3) -> bool:
	var from_grid := Vector2(
		(from.x - _origin.x) / _cell_size,
		(from.z - _origin.y) / _cell_size,
	)
	var to_grid := Vector2(
		(to.x - _origin.x) / _cell_size,
		(to.z - _origin.y) / _cell_size,
	)
	var current := Vector2i(floori(from_grid.x), floori(from_grid.y))
	var destination := Vector2i(floori(to_grid.x), floori(to_grid.y))
	if not _is_cell_walkable(current) or not _is_cell_walkable(destination):
		return false
	if not _segment_has_capsule_clearance(from, to):
		return false
	if current == destination:
		return true

	var delta := to_grid - from_grid
	var step_x := int(signf(delta.x))
	var step_y := int(signf(delta.y))
	var t_delta_x := INF if step_x == 0 else absf(1.0 / delta.x)
	var t_delta_y := INF if step_y == 0 else absf(1.0 / delta.y)
	var next_boundary_x := float(current.x + 1) if step_x > 0 else float(current.x)
	var next_boundary_y := float(current.y + 1) if step_y > 0 else float(current.y)
	var t_max_x := INF if step_x == 0 else (next_boundary_x - from_grid.x) / delta.x
	var t_max_y := INF if step_y == 0 else (next_boundary_y - from_grid.y) / delta.y

	while current != destination:
		if absf(t_max_x - t_max_y) <= GRID_TRAVERSAL_EPSILON:
			# A segment touching a grid corner must not squeeze diagonally between
			# two solids. Requiring both side cells matches ONLY_IF_NO_OBSTACLES.
			var horizontal_neighbor := current + Vector2i(step_x, 0)
			var vertical_neighbor := current + Vector2i(0, step_y)
			if (
				not _is_cell_walkable(horizontal_neighbor)
				or not _is_cell_walkable(vertical_neighbor)
			):
				return false
			current += Vector2i(step_x, step_y)
			t_max_x += t_delta_x
			t_max_y += t_delta_y
		elif t_max_x < t_max_y:
			current.x += step_x
			t_max_x += t_delta_x
		else:
			current.y += step_y
			t_max_y += t_delta_y
		if not _is_cell_walkable(current):
			return false
	return true


func _segment_has_capsule_clearance(from: Vector3, to: Vector3) -> bool:
	var segment_start := Vector2(from.x, from.z)
	var segment_end := Vector2(to.x, to.z)
	var segment := segment_end - segment_start
	var segment_length_squared := segment.length_squared()
	var minimum := Vector2(
		minf(segment_start.x, segment_end.x) - ACTOR_CLEARANCE_RADIUS,
		minf(segment_start.y, segment_end.y) - ACTOR_CLEARANCE_RADIUS,
	)
	var maximum := Vector2(
		maxf(segment_start.x, segment_end.x) + ACTOR_CLEARANCE_RADIUS,
		maxf(segment_start.y, segment_end.y) + ACTOR_CLEARANCE_RADIUS,
	)
	var clearance_squared := ACTOR_CLEARANCE_RADIUS * ACTOR_CLEARANCE_RADIUS
	for blocked_cell in _blocked_cells:
		var blocked_center := (
			_origin
			+ (Vector2(blocked_cell) + Vector2.ONE * 0.5) * _cell_size
		)
		if (
			blocked_center.x < minimum.x
			or blocked_center.x > maximum.x
			or blocked_center.y < minimum.y
			or blocked_center.y > maximum.y
		):
			continue
		var closest_weight := 0.0
		if segment_length_squared > DISTANCE_EPSILON:
			closest_weight = clampf(
				(blocked_center - segment_start).dot(segment) / segment_length_squared,
				0.0,
				1.0,
			)
		var closest_point := segment_start + segment * closest_weight
		if (
			closest_point.distance_squared_to(blocked_center)
			<= clearance_squared + DISTANCE_EPSILON
		):
			return false
	return true


func _is_cell_walkable(cell: Vector2i) -> bool:
	return _is_cell_in_bounds(cell) and not _grid.is_point_solid(cell)


func _parse_origin(value: Variant) -> Variant:
	match typeof(value):
		TYPE_VECTOR2:
			return value as Vector2
		TYPE_VECTOR3:
			var position: Vector3 = value
			return Vector2(position.x, position.z)
		TYPE_ARRAY:
			var values: Array = value
			if values.size() == 2 and _is_number(values[0]) and _is_number(values[1]):
				return Vector2(float(values[0]), float(values[1]))
	return null


func _parse_blocked_cells(value: Variant, columns: int, rows: int) -> Variant:
	var entries: Array = []
	if typeof(value) == TYPE_ARRAY:
		entries = value
	elif typeof(value) == TYPE_PACKED_VECTOR2_ARRAY:
		for entry in value as PackedVector2Array:
			entries.append(entry)
	else:
		return null
	var parsed: Array[Vector2i] = []
	var seen: Dictionary = {}
	for entry in entries:
		var cell_value: Variant = _parse_cell(entry)
		if cell_value == null:
			return null
		var cell: Vector2i = cell_value
		if cell.x < 0 or cell.y < 0 or cell.x >= columns or cell.y >= rows:
			return null
		if not seen.has(cell):
			seen[cell] = true
			parsed.append(cell)
	return parsed


func _parse_cell(value: Variant) -> Variant:
	match typeof(value):
		TYPE_VECTOR2I:
			return value as Vector2i
		TYPE_VECTOR2:
			var point: Vector2 = value
			if is_equal_approx(point.x, roundf(point.x)) and is_equal_approx(point.y, roundf(point.y)):
				return Vector2i(int(roundf(point.x)), int(roundf(point.y)))
		TYPE_ARRAY:
			var values: Array = value
			if (
				values.size() == 2
				and _is_integral_number(values[0])
				and _is_integral_number(values[1])
			):
				return Vector2i(int(values[0]), int(values[1]))
	return null


func _is_number(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT


func _is_integral_number(value: Variant) -> bool:
	return _is_number(value) and is_equal_approx(float(value), roundf(float(value)))


func _is_positive_integer(value: Variant) -> bool:
	return _is_integral_number(value) and int(value) > 0


func _reset_configuration() -> void:
	_grid = AStarGrid2D.new()
	_configured = false
	_columns = 0
	_rows = 0
	_cell_size = 0.0
	_origin = Vector2.ZERO
	_blocked_cells.clear()
