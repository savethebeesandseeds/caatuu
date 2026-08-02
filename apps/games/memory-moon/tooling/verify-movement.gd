extends SceneTree

const ClickNavigationScript := preload("res://scripts/click_navigation.gd")
const MemoryMoonScript := preload("res://scripts/memory_moon.gd")
const TEST_RATES := [30, 60, 120]
const WALK_SPEED := 2.6
const CAPSULE_CLEARANCE_RADIUS := 0.28
const TARGET := Vector3(5.0, 0.0, 0.0)
const POSITION_EPSILON := 0.00001
const ARRIVAL_ERROR_LIMIT := 0.05001
const ARRIVAL_TIME_SPREAD_LIMIT := 0.12
const REVERSAL_TIME_SPREAD_LIMIT := 0.06
const CORNER_DRIFT_LIMIT := 0.16

var _failures: Array[String] = []


func _init() -> void:
	call_deferred("_verify")


func _verify() -> void:
	_verify_open_route_smoothing()
	_verify_supercover_safety_and_target_fallback()
	_verify_eased_arrival_across_rates()
	_verify_braked_retarget_across_rates()
	_verify_corner_steering_across_rates()
	_verify_stall_progress_uses_route_distance()
	_finish()


func _verify_open_route_smoothing() -> void:
	var navigator: Variant = _configured_navigator(12, 9, [])
	_check(navigator != null, "open-grid navigator must configure")
	if navigator == null:
		return
	var start := Vector3(0.35, 0.0, 0.45)
	var target := Vector3(10.25, 0.0, 6.35)
	var route: PackedVector3Array = navigator.find_path(start, target)
	var repeated: PackedVector3Array = navigator.find_path(start, target)
	_check(route.size() == 2, "an open arbitrary-slope route must string-pull to two points")
	_check(route == repeated, "repeated route planning must be deterministic")
	if route.size() == 2:
		_check(route[0].is_equal_approx(start), "string-pulled route must preserve the precise start")
		_check(route[-1].is_equal_approx(target), "open ground must preserve the precise target")
		var delta := route[-1] - route[0]
		_check(absf(delta.x) > POSITION_EPSILON, "arbitrary-slope route must move on x")
		_check(absf(delta.z) > POSITION_EPSILON, "arbitrary-slope route must move on z")
		_check(not is_equal_approx(absf(delta.x), absf(delta.z)), "route must not collapse to a 45-degree grid diagonal")
		_check(
			bool(navigator.call("_segment_is_walkable", route[0], route[-1])),
			"the pulled arbitrary-slope segment must retain line-of-sight clearance",
		)


func _verify_supercover_safety_and_target_fallback() -> void:
	var corner_navigator: Variant = _configured_navigator(6, 6, [Vector2i(1, 0)])
	_check(corner_navigator != null, "corner-safety navigator must configure")
	if corner_navigator == null:
		return
	var corner_start := Vector3(0.5, 0.0, 0.5)
	var corner_target := Vector3(1.5, 0.0, 1.5)
	_check(
		not bool(corner_navigator.call("_segment_is_walkable", corner_start, corner_target)),
		"supercover must reject a diagonal that touches a blocked corner neighbor",
	)
	var corner_route: PackedVector3Array = corner_navigator.find_path(corner_start, corner_target)
	var repeated_corner_route: PackedVector3Array = corner_navigator.find_path(
		corner_start,
		corner_target,
	)
	_check(corner_route.size() >= 3, "corner-safe routing must retain a detour waypoint")
	_check(corner_route == repeated_corner_route, "corner detours must be deterministic")
	_verify_route_segments(corner_navigator, corner_route, "corner detour")

	var requested_near_blocker := Vector3(1.78, 0.0, 1.72)
	var safe_center := Vector3(1.5, 0.0, 1.5)
	var fallback_route: PackedVector3Array = corner_navigator.find_path(
		corner_start,
		requested_near_blocker,
	)
	_check(not fallback_route.is_empty(), "near-blocker destination must remain reachable")
	if not fallback_route.is_empty():
		_check(
			fallback_route[-1].is_equal_approx(safe_center),
			"a precise target beside a blocker must fall back to its safe cell center",
		)
		_check(
			not fallback_route[-1].is_equal_approx(requested_near_blocker),
			"near-blocker fallback must not retain the unsafe precise edge click",
		)
	_verify_route_segments(corner_navigator, fallback_route, "precise-target fallback")

	var same_cell_start := Vector3(1.22, 0.0, 1.22)
	var same_cell_request := Vector3(1.78, 0.0, 1.72)
	var same_cell_route: PackedVector3Array = corner_navigator.find_path(
		same_cell_start,
		same_cell_request,
	)
	_check(same_cell_route.size() == 2, "unsafe same-cell target must retain a movement segment")
	if same_cell_route.size() == 2:
		_check(
			same_cell_route[0].is_equal_approx(same_cell_start),
			"same-cell fallback must preserve the precise actor start",
		)
		_check(
			same_cell_route[-1].is_equal_approx(safe_center),
			"unsafe same-cell target must resolve to the safe center",
		)
		var same_cell_result := _simulate_route_arrival(
			60,
			same_cell_start,
			same_cell_route,
			0.0,
		)
		_check(bool(same_cell_result["arrived"]), "same-cell fallback movement must arrive")
		_check(
			float(same_cell_result["arrival_error"]) <= ARRIVAL_ERROR_LIMIT,
			"same-cell fallback movement must finish at the safe center",
		)
		_check(
			float(same_cell_result["distance_moved"]) > 0.1,
			"same-cell fallback must move instead of treating the precise start as its target",
		)

	var obstacle_navigator: Variant = _configured_navigator(6, 6, [Vector2i(2, 2)])
	_check(obstacle_navigator != null, "blocked-cell navigator must configure")
	if obstacle_navigator != null:
		_check(
			not bool(
				obstacle_navigator.call(
					"_segment_is_walkable",
					Vector3(0.5, 0.0, 0.5),
					Vector3(4.5, 0.0, 4.5),
				)
			),
			"supercover must reject a segment that crosses a blocked cell",
		)

	var fine_cell_size := 1.0 / 3.0
	var grazing_navigator: Variant = _configured_navigator(
		6,
		6,
		[Vector2i(2, 2)],
		fine_cell_size,
	)
	_check(grazing_navigator != null, "capsule-clearance navigator must configure")
	if grazing_navigator != null:
		var blocked_center_y := 2.5 * fine_cell_size
		var segment_start_x := 0.5 * fine_cell_size
		var segment_end_x := 4.5 * fine_cell_size
		var safe_y := blocked_center_y - (CAPSULE_CLEARANCE_RADIUS + 0.01)
		var grazing_y := blocked_center_y - (CAPSULE_CLEARANCE_RADIUS - 0.01)
		_check(
			bool(
				grazing_navigator.call(
					"_segment_is_walkable",
					Vector3(segment_start_x, 0.0, safe_y),
					Vector3(segment_end_x, 0.0, safe_y),
				)
			),
			"a segment outside the 0.28 capsule radius must remain eligible",
		)
		_check(
			not bool(
				grazing_navigator.call(
					"_segment_is_walkable",
					Vector3(segment_start_x, 0.0, grazing_y),
					Vector3(segment_end_x, 0.0, grazing_y),
				)
			),
			"LOS smoothing must reject a zero-width-clear segment that grazes the 0.28 capsule radius",
		)


func _verify_eased_arrival_across_rates() -> void:
	var results: Array[Dictionary] = []
	for rate in TEST_RATES:
		var result := _simulate_direct_arrival(rate)
		results.append(result)
		if result.is_empty():
			_check(false, "%d Hz movement simulation must initialize" % rate)
			continue
		_check(bool(result["arrived"]), "%d Hz movement must reach the destination" % rate)
		_check(not bool(result["overshot"]), "%d Hz movement must not overshoot" % rate)
		_check(float(result["max_speed"]) <= WALK_SPEED + POSITION_EPSILON, "%d Hz movement must respect the 2.6 speed cap" % rate)
		_check(float(result["max_speed"]) >= WALK_SPEED - 0.02, "%d Hz route must reach cruising speed" % rate)
		_check(float(result["first_speed"]) < WALK_SPEED * 0.5, "%d Hz movement must ease in" % rate)
		_check(bool(result["accelerated"]), "%d Hz movement must visibly accelerate" % rate)
		_check(bool(result["braked"]), "%d Hz movement must visibly brake" % rate)
		_check(float(result["arrival_error"]) <= ARRIVAL_ERROR_LIMIT, "%d Hz arrival must settle inside the target tolerance" % rate)

	var minimum_time := INF
	var maximum_time := 0.0
	for result in results:
		minimum_time = minf(minimum_time, float(result["arrival_time"]))
		maximum_time = maxf(maximum_time, float(result["arrival_time"]))
	_check(
		maximum_time - minimum_time <= ARRIVAL_TIME_SPREAD_LIMIT,
		"30/60/120 Hz arrival times must remain within %.2f seconds" % ARRIVAL_TIME_SPREAD_LIMIT,
	)


func _simulate_direct_arrival(rate: int) -> Dictionary:
	var world := MemoryMoonScript.new()
	if world == null:
		return {}
	var actor := CharacterBody3D.new()
	world.set("_actor", actor)
	actor.position = Vector3.ZERO
	actor.rotation.y = 0.0
	world.call("_set_move_path", PackedVector3Array([Vector3.ZERO, TARGET]))

	var delta := 1.0 / float(rate)
	var elapsed := 0.0
	var maximum_speed := 0.0
	var first_speed := -1.0
	var previous_speed := 0.0
	var accelerated := false
	var braked := false
	var overshot := false
	var maximum_steps := rate * 8
	for _step in maximum_steps:
		if not bool(world.get("_has_move_target")):
			break
		var step_result := _production_step(world, actor, delta)
		var speed := (step_result["velocity"] as Vector3).length()
		elapsed += delta
		if first_speed < 0.0:
			first_speed = speed
		maximum_speed = maxf(maximum_speed, speed)
		if speed > previous_speed + POSITION_EPSILON:
			accelerated = true
		if speed < previous_speed - POSITION_EPSILON:
			braked = true
		previous_speed = speed
		if actor.position.x > TARGET.x + POSITION_EPSILON:
			overshot = true

	var arrived := not bool(world.get("_has_move_target"))
	var arrival_error := actor.position.distance_to(TARGET)
	world.free()
	actor.free()
	return {
		"arrived": arrived,
		"arrival_error": arrival_error,
		"arrival_time": elapsed,
		"max_speed": maximum_speed,
		"first_speed": first_speed,
		"accelerated": accelerated,
		"braked": braked,
		"overshot": overshot,
	}


func _simulate_route_arrival(
	rate: int,
	start: Vector3,
	path: PackedVector3Array,
	initial_rotation_y: float,
) -> Dictionary:
	var world := MemoryMoonScript.new()
	if world == null or path.is_empty():
		return {}
	var actor := CharacterBody3D.new()
	world.set("_actor", actor)
	actor.position = start
	actor.rotation.y = initial_rotation_y
	world.call("_set_move_path", path)
	var target := path[-1]
	var delta := 1.0 / float(rate)
	var elapsed := 0.0
	var maximum_speed := 0.0
	var maximum_steps := rate * 8
	for _step in maximum_steps:
		if not bool(world.get("_has_move_target")):
			break
		var step_result := _production_step(world, actor, delta)
		maximum_speed = maxf(maximum_speed, (step_result["velocity"] as Vector3).length())
		elapsed += delta
	var arrived := not bool(world.get("_has_move_target"))
	var arrival_error := actor.position.distance_to(target)
	var distance_moved := actor.position.distance_to(start)
	world.free()
	actor.free()
	return {
		"arrived": arrived,
		"arrival_error": arrival_error,
		"arrival_time": elapsed,
		"distance_moved": distance_moved,
		"max_speed": maximum_speed,
	}


func _verify_braked_retarget_across_rates() -> void:
	var results: Array[Dictionary] = []
	for rate in TEST_RATES:
		var result := _simulate_sharp_retarget(rate)
		results.append(result)
		_check(bool(result["reversed"]), "%d Hz sharp retarget must eventually reverse" % rate)
		_check(bool(result["stopped_first"]), "%d Hz reversal must pass through zero velocity" % rate)
		_check(not bool(result["instant_flip"]), "%d Hz retarget must not flip the velocity vector in one step" % rate)
		_check(float(result["first_velocity_x"]) > 0.0, "%d Hz first retarget step must retain the old velocity direction" % rate)
		_check(float(result["first_velocity_x"]) < WALK_SPEED, "%d Hz first retarget step must brake" % rate)

	var minimum_time := INF
	var maximum_time := 0.0
	for result in results:
		minimum_time = minf(minimum_time, float(result["reversal_time"]))
		maximum_time = maxf(maximum_time, float(result["reversal_time"]))
	_check(
		maximum_time - minimum_time <= REVERSAL_TIME_SPREAD_LIMIT,
		"30/60/120 Hz reversal timing must remain frame-rate consistent",
	)


func _simulate_sharp_retarget(rate: int) -> Dictionary:
	var world := MemoryMoonScript.new()
	if world == null:
		return {}
	var actor := CharacterBody3D.new()
	world.set("_actor", actor)
	actor.position = Vector3.ZERO
	actor.rotation.y = PI * 0.5
	actor.velocity = Vector3(WALK_SPEED, 0.0, 0.0)
	world.set("_move_speed", WALK_SPEED)
	world.call(
		"_set_move_path",
		PackedVector3Array([Vector3.ZERO, Vector3(-3.0, 0.0, 0.0)]),
	)
	var delta := 1.0 / float(rate)
	var elapsed := 0.0
	var previous_velocity_x := WALK_SPEED
	var first_velocity_x := WALK_SPEED
	var stopped_first := false
	var instant_flip := false
	var reversed := false
	for step_index in rate * 2:
		var step_result := _production_step(world, actor, delta)
		var velocity: Vector3 = step_result["velocity"]
		elapsed += delta
		if step_index == 0:
			first_velocity_x = velocity.x
		if previous_velocity_x > POSITION_EPSILON and velocity.x < -POSITION_EPSILON:
			instant_flip = true
		if absf(velocity.x) <= POSITION_EPSILON:
			stopped_first = true
		if velocity.x < -POSITION_EPSILON:
			reversed = true
			break
		previous_velocity_x = velocity.x
	world.free()
	actor.free()
	return {
		"reversed": reversed,
		"stopped_first": stopped_first,
		"instant_flip": instant_flip,
		"first_velocity_x": first_velocity_x,
		"reversal_time": elapsed,
	}


func _verify_corner_steering_across_rates() -> void:
	for rate in TEST_RATES:
		var result := _simulate_right_angle_corner(rate)
		_check(bool(result["arrived"]), "%d Hz corner route must arrive" % rate)
		_check(bool(result["outgoing_seen"]), "%d Hz corner route must enter its outgoing segment" % rate)
		_check(
			float(result["maximum_drift"]) <= CORNER_DRIFT_LIMIT,
			"%d Hz corner steering must stay inside the %.2f-unit drift budget" % [rate, CORNER_DRIFT_LIMIT],
		)
		_check(
			float(result["arrival_error"]) <= ARRIVAL_ERROR_LIMIT,
			"%d Hz corner route must settle at its destination" % rate,
		)


func _simulate_right_angle_corner(rate: int) -> Dictionary:
	var world := MemoryMoonScript.new()
	if world == null:
		return {}
	var actor := CharacterBody3D.new()
	world.set("_actor", actor)
	actor.position = Vector3.ZERO
	actor.rotation.y = PI * 0.5
	var target := Vector3(1.0, 0.0, 1.5)
	world.call(
		"_set_move_path",
		PackedVector3Array([Vector3.ZERO, Vector3(1.0, 0.0, 0.0), target]),
	)
	var delta := 1.0 / float(rate)
	var maximum_drift := 0.0
	var outgoing_seen := false
	for _step in rate * 8:
		if not bool(world.get("_has_move_target")):
			break
		var step_result := _production_step(world, actor, delta)
		if int(step_result["path_index"]) >= 2:
			outgoing_seen = true
			maximum_drift = maxf(maximum_drift, absf(actor.position.x - 1.0))
	var arrived := not bool(world.get("_has_move_target"))
	var arrival_error := actor.position.distance_to(target)
	world.free()
	actor.free()
	return {
		"arrived": arrived,
		"arrival_error": arrival_error,
		"maximum_drift": maximum_drift,
		"outgoing_seen": outgoing_seen,
	}


func _verify_stall_progress_uses_route_distance() -> void:
	var world := MemoryMoonScript.new()
	var actor := CharacterBody3D.new()
	world.set("_actor", actor)
	actor.position = Vector3.ZERO
	world.call("_set_move_path", PackedVector3Array([Vector3.ZERO, Vector3(3.0, 0.0, 0.0)]))
	world.call("_path_direction")
	var delta := 1.0 / 60.0
	for _step in 30:
		var before := actor.position
		actor.position.z += 0.01
		world.call("_update_path_progress", before, delta)
	_check(
		float(world.get("_stalled_seconds")) >= 0.49,
		"sideways travel that does not reduce route distance must not reset stall progress",
	)
	world.free()
	actor.free()


func _production_step(world: Node, actor: CharacterBody3D, delta: float) -> Dictionary:
	var direction: Vector3 = world.call("_path_direction")
	var velocity: Vector3 = world.call("_advance_movement_velocity", direction, delta)
	world.call("_update_actor_facing", direction, delta)
	var path_index := int(world.get("_movement_path_index"))
	var position_before_move := actor.position
	actor.position += velocity * delta
	world.call("_update_path_progress", position_before_move, delta)
	return {
		"direction": direction,
		"velocity": velocity,
		"path_index": path_index,
	}


func _configured_navigator(
	columns: int,
	rows: int,
	blocked_cells: Array[Vector2i],
	cell_size: float = 1.0,
) -> Variant:
	var grove := Node.new()
	grove.set_meta("navigation_columns", columns)
	grove.set_meta("navigation_rows", rows)
	grove.set_meta("navigation_cell_size", cell_size)
	grove.set_meta("navigation_origin", Vector2.ZERO)
	grove.set_meta("navigation_blocked_cells", blocked_cells.duplicate())
	var navigator := ClickNavigationScript.new()
	if not navigator.configure(grove):
		grove.free()
		return null
	grove.free()
	return navigator


func _verify_route_segments(navigator: Variant, route: PackedVector3Array, label: String) -> void:
	for point in route:
		_check(navigator.is_world_walkable(point), "%s waypoints must remain walkable" % label)
	for index in range(1, route.size()):
		_check(
			bool(navigator.call("_segment_is_walkable", route[index - 1], route[index])),
			"%s segments must retain supercover clearance" % label,
		)


func _check(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)


func _finish() -> void:
	if not _failures.is_empty():
		for failure in _failures:
			push_error("Memory Moon movement verification failed: %s" % failure)
		quit(1)
		return
	print(
		"MEMORY_MOON_MOVEMENT_SMOKE_OK rates=30/60/120 acceleration=true braking=true arrival=true overshoot=false reversal=brake-first corner_drift_max=0.16 speed_cap=2.6 arrival_spread_max=0.12 los=string-pulled capsule_clearance=0.28 supercover=safe deterministic=true precise_target=fallback same_cell=move-to-center stall_progress=route-distance"
	)
	quit()
