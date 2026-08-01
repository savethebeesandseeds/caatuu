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
	var simplified_cells := _simplify_cell_path(cell_path)
	var world_path := PackedVector3Array()
	for cell in simplified_cells:
		world_path.append(cell_to_world(cell))

	# Preserve precise clicks inside the first and last walkable cells. When a
	# click was clamped, blocked, or only partially reachable, keep the safe cell
	# center returned by the grid.
	if is_world_walkable(start) and cell_path[0] == world_to_cell(start):
		world_path[0] = Vector3(start.x, WORLD_Y, start.z)
	var reached_requested_cell := cell_path[-1] == target_cell
	if reached_requested_cell and is_world_walkable(target) and target_cell == world_to_cell(target):
		var exact_target := Vector3(target.x, WORLD_Y, target.z)
		if world_path[-1].distance_squared_to(exact_target) <= DISTANCE_EPSILON:
			world_path[-1] = exact_target
		else:
			world_path.append(exact_target)
	return world_path


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


func _simplify_cell_path(cell_path: Array[Vector2i]) -> Array[Vector2i]:
	if cell_path.size() <= 2:
		return cell_path.duplicate()
	var simplified: Array[Vector2i] = [cell_path[0]]
	var previous_direction := _cell_direction(cell_path[0], cell_path[1])
	for index in range(2, cell_path.size()):
		var direction := _cell_direction(cell_path[index - 1], cell_path[index])
		if direction != previous_direction:
			simplified.append(cell_path[index - 1])
			previous_direction = direction
	simplified.append(cell_path[-1])
	return simplified


func _cell_direction(from: Vector2i, to: Vector2i) -> Vector2i:
	var delta := to - from
	return Vector2i(clampi(delta.x, -1, 1), clampi(delta.y, -1, 1))


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
