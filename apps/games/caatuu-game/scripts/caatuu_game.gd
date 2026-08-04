extends Node3D

const MacawCostumeController := preload("res://scripts/macaw_costume.gd")
const WorldSceneryBuilder := preload("res://scripts/world_scenery.gd")
const ClickNavigation := preload("res://scripts/click_navigation.gd")
const MODEL_PATH := "res://assets/humanoid.glb"
const MACAW_SMOKE_ARGUMENT := "--require-macaw-costume"
const ARTICULATED_PART_IDS: Array[StringName] = [
	&"arm_far_upper",
	&"arm_far_lower",
	&"leg_far",
	&"leg_near",
	&"arm_near_upper",
	&"arm_near_lower",
]
const ARTICULATION_SAMPLE_SECONDS := [0.15, 0.35, 0.6, 0.85]
const ARTICULATION_POSITION_EPSILON := 0.002
const ARTICULATION_UP_EPSILON := 0.01
const ACTOR_VISUAL_TURNAROUND := PI
const WALK_SPEED := 2.6
const WALK_ACCELERATION := 8.0
const WALK_BRAKING := 11.0
const WALK_ANIMATION_MIN_SCALE := 0.35
const WALK_ANIMATION_IDLE_SPEED := 0.08
const WAYPOINT_REACHED_DISTANCE := 0.04
const TARGET_REACHED_DISTANCE := 0.05
const CORNER_APPROACH_DISTANCE := 0.55
const CORNER_SPEED := 1.35
const CORNER_DOT_THRESHOLD := 0.85
const TURN_RESPONSE := 14.0
const VELOCITY_STOP_EPSILON := 0.0001
const REPLAN_STALL_SECONDS := 0.45
const REPLAN_PROGRESS_DISTANCE := 0.04
const CAMERA_FOCUS_HEIGHT := 0.9
const CAMERA_YAW_RADIANS := PI / 4.0
const CAMERA_ELEVATION_RADIANS := PI / 6.0
const CAMERA_OFFSET := Vector3(8.485281374, 6.928203230, 8.485281374)
const CAMERA_PIXELS_PER_WORLD_UNIT := 62.0
const CAMERA_HEIGHT_MIN := 8.5
const CAMERA_HEIGHT_MAX := 10.5
const CAMERA_FOLLOW_SPEED := 5.2
const CAMERA_SETTLE_EPSILON := 0.002
const CAMERA_DEAD_ZONE := Vector2(1.35, 0.9)
const MAP_GROUND_SIZE := Vector2(64.0, 64.0)

var _actor: CharacterBody3D
var _actor_visual: Node3D
var _animation_player: AnimationPlayer
var _skeleton: Skeleton3D
var _human_meshes: Array[MeshInstance3D] = []
var _macaw_costume: MacawCostume
var _macaw_available := false
var _showing_macaw := false
var _camera: Camera3D
var _camera_focus := Vector3(0.0, CAMERA_FOCUS_HEIGHT, 0.0)
var _world_scenery: Node3D
var _navigator
var _movement_path := PackedVector3Array()
var _movement_path_index := 0
var _move_target := Vector3.ZERO
var _has_move_target := false
var _target_marker: MeshInstance3D
var _move_speed := 0.0
var _stalled_seconds := 0.0
var _stall_reference_remaining := INF
var _title_label: Label
var _boundary_label: Label
var _appearance_label: Label
var _instruction_label: Label
var _appearance_button: Button
var _interface: Control
var _status_panel: PanelContainer
var _reset_button: Button
var _engine_badge: Label
var _portrait_layout := false
var _current_clip := ""


func _ready() -> void:
	_build_environment()
	_build_actor()
	_configure_navigation()
	_build_target_marker()
	_verify_macaw_smoke_contract()
	_build_interface()
	var display_viewport := get_tree().root
	if not display_viewport.size_changed.is_connected(_layout_interface):
		display_viewport.size_changed.connect(_layout_interface)
	_layout_interface()
	_play_clip("Idle")


func _exit_tree() -> void:
	var display_viewport := get_tree().root
	if display_viewport.size_changed.is_connected(_layout_interface):
		display_viewport.size_changed.disconnect(_layout_interface)


func _process(_delta: float) -> void:
	if _macaw_costume != null:
		_macaw_costume.update_camera_facing(_camera)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mouse_event := event as InputEventMouseButton
		if mouse_event.button_index == MOUSE_BUTTON_LEFT and mouse_event.pressed:
			_request_move_to_screen_position(mouse_event.position)
			get_viewport().set_input_as_handled()
	elif event is InputEventScreenTouch:
		var touch_event := event as InputEventScreenTouch
		if touch_event.pressed:
			_request_move_to_screen_position(touch_event.position)
			get_viewport().set_input_as_handled()


func _physics_process(delta: float) -> void:
	if _actor == null:
		return

	var direction := _path_direction()
	_advance_movement_velocity(direction, delta)
	_update_actor_facing(direction, delta)
	_sync_locomotion_animation(_actor.velocity)
	var position_before_move := _actor.position
	_actor.move_and_slide()
	_update_path_progress(position_before_move, delta)

	var desired_focus := _camera_target_focus()
	var next_focus := _camera_focus.lerp(
		desired_focus,
		1.0 - exp(-delta * CAMERA_FOLLOW_SPEED),
	)
	if (
		next_focus.distance_squared_to(desired_focus)
		<= CAMERA_SETTLE_EPSILON * CAMERA_SETTLE_EPSILON
		):
		next_focus = desired_focus
	_camera_focus = next_focus
	_apply_camera_position()


func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	var sky_material := ProceduralSkyMaterial.new()
	var sky := Sky.new()
	sky_material.sky_top_color = Color("#030811")
	sky_material.sky_horizon_color = Color("#17343a")
	sky_material.ground_bottom_color = Color("#02030b")
	sky_material.ground_horizon_color = Color("#102629")
	sky.sky_material = sky_material
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#91b4b5")
	environment.ambient_light_energy = 0.52
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	# The scenery is authored in final display colors; linear tonemapping keeps
	# the painted palette faithful instead of applying a cinematic contrast curve.
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	world_environment.environment = environment
	add_child(world_environment)

	var moon_light := DirectionalLight3D.new()
	moon_light.name = "MoonLight"
	moon_light.rotation_degrees = Vector3(-52.0, -28.0, 0.0)
	moon_light.light_color = Color("#d8f1ec")
	moon_light.light_energy = 1.2
	moon_light.shadow_enabled = false
	add_child(moon_light)

	var floor := MeshInstance3D.new()
	floor.name = "MoonGroveGround"
	var floor_mesh := PlaneMesh.new()
	floor_mesh.size = MAP_GROUND_SIZE
	floor.mesh = floor_mesh
	# Safety underlay beneath streamed terrain; authored macro-tiles remain the
	# visible ground authority throughout the playable area.
	var floor_material := _material(Color("#4a4b16"), Color.BLACK, 0.0)
	floor_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	floor.material_override = floor_material
	floor.position.y = -0.06
	floor.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(floor)

	var scenery_builder := WorldSceneryBuilder.new()
	_world_scenery = scenery_builder.build(self)
	if not scenery_builder.failure_message.is_empty():
		push_warning(scenery_builder.failure_message)

	_camera = Camera3D.new()
	_camera.name = "MoonCamera"
	_camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	_camera.size = CAMERA_HEIGHT_MIN
	_camera.keep_aspect = Camera3D.KEEP_HEIGHT
	_camera.near = 0.1
	_camera.far = 50.0
	_camera.position = _camera_focus + CAMERA_OFFSET
	_camera.current = true
	_camera.set_meta("presentation_mode", "isometric-orthographic")
	_camera.set_meta("yaw_degrees", rad_to_deg(CAMERA_YAW_RADIANS))
	_camera.set_meta("elevation_degrees", rad_to_deg(CAMERA_ELEVATION_RADIANS))
	_camera.set_meta("translation_only_follow", true)
	_camera.set_meta("subpixel_follow", true)
	_camera.set_meta("dead_zone", CAMERA_DEAD_ZONE)
	_camera.set_meta("large_world_follow", true)
	add_child(_camera)
	_camera.look_at(_camera_focus, Vector3.UP)
	_layout_camera_for_size(get_viewport().get_visible_rect().size)
	_apply_camera_position()


func _build_actor() -> void:
	_actor = CharacterBody3D.new()
	_actor.name = "MoonWalker"
	_actor.motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	_actor.add_to_group("caatuu_game_walker")
	add_child(_actor)

	var actor_collision := CollisionShape3D.new()
	actor_collision.name = "WalkerCollision"
	var actor_shape := CapsuleShape3D.new()
	actor_shape.radius = 0.28
	actor_shape.height = 1.45
	actor_collision.shape = actor_shape
	actor_collision.position.y = 0.72
	_actor.add_child(actor_collision)

	var model_resource := load(MODEL_PATH)
	if model_resource is PackedScene:
		_actor_visual = model_resource.instantiate()
		_actor_visual.name = "QuaterniusHumanoid"
		_actor_visual.scale = Vector3.ONE * 0.78
		# The imported donor already received one half-turn for its source axes.
		# A second permanent half-turn corrects the observed reverse walk.
		_actor_visual.rotation.y = PI + ACTOR_VISUAL_TURNAROUND
		_actor_visual.set_meta("turnaround_yaw", ACTOR_VISUAL_TURNAROUND)
		_actor.add_child(_actor_visual)
		var animation_players := _actor_visual.find_children("*", "AnimationPlayer", true, false)
		if not animation_players.is_empty():
			_animation_player = animation_players[0] as AnimationPlayer
		var skeletons := _actor_visual.find_children("*", "Skeleton3D", true, false)
		if not skeletons.is_empty():
			_skeleton = skeletons[0] as Skeleton3D
		for node in _actor_visual.find_children("*", "MeshInstance3D", true, false):
			var mesh := node as MeshInstance3D
			if mesh != null:
				mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				_human_meshes.append(mesh)
		if _skeleton != null:
			_macaw_costume = MacawCostumeController.new()
			_macaw_available = _macaw_costume.build(_skeleton)
			if _macaw_available:
				_set_appearance(MACAW_SMOKE_ARGUMENT in OS.get_cmdline_user_args())
				_macaw_costume.update_camera_facing(_camera)
			else:
				push_warning("Macaw shell unavailable: %s" % _macaw_costume.failure_message)
	else:
		push_warning("Caatuu Game humanoid could not be loaded; using the geometric fallback.")
		var fallback := MeshInstance3D.new()
		var capsule := CapsuleMesh.new()
		capsule.height = 1.65
		capsule.radius = 0.34
		fallback.mesh = capsule
		fallback.position.y = 0.82
		fallback.material_override = _material(Color("#f4cf63"), Color("#513e08"), 0.18)
		fallback.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_actor.add_child(fallback)


func _configure_navigation() -> void:
	_navigator = ClickNavigation.new()
	if _world_scenery == null or not _navigator.configure(_world_scenery):
		push_warning("Caatuu Game click navigation could not be configured.")
		_navigator = null
		return
	var spawn: Vector3 = _world_scenery.get_meta("default_spawn", Vector3.ZERO)
	_actor.position = spawn
	_camera_focus = spawn + Vector3(0.0, CAMERA_FOCUS_HEIGHT, 0.0)
	_apply_camera_position()
	var terrain_surface := _world_scenery.get_node_or_null("TerrainSurface")
	if terrain_surface != null and terrain_surface.has_method("set_target"):
		terrain_surface.call("set_target", _actor)


func _build_target_marker() -> void:
	_target_marker = MeshInstance3D.new()
	_target_marker.name = "WalkTarget"
	var marker_mesh := CylinderMesh.new()
	marker_mesh.top_radius = 0.17
	marker_mesh.bottom_radius = 0.17
	marker_mesh.height = 0.018
	marker_mesh.radial_segments = 24
	_target_marker.mesh = marker_mesh
	var marker_material := StandardMaterial3D.new()
	marker_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	marker_material.albedo_color = Color(0.35, 0.92, 0.86, 0.78)
	marker_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	marker_material.no_depth_test = false
	marker_material.roughness = 1.0
	_target_marker.material_override = marker_material
	_target_marker.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_target_marker.visible = false
	add_child(_target_marker)


func _request_move_to_screen_position(screen_position: Vector2) -> void:
	if _navigator == null or _camera == null or _actor == null:
		return
	var ray_origin := _camera.project_ray_origin(screen_position)
	var ray_direction := _camera.project_ray_normal(screen_position)
	if absf(ray_direction.y) < 0.0001:
		return
	var distance := -ray_origin.y / ray_direction.y
	if distance <= 0.0:
		return
	var requested_target := ray_origin + ray_direction * distance
	requested_target.y = 0.0
	var path: PackedVector3Array = _navigator.find_path(_actor.position, requested_target)
	if path.is_empty():
		# A missed or invalid click should not cancel a valid order already in
		# progress. The existing safe route remains authoritative.
		return
	_set_move_path(path)


func _set_move_path(path: PackedVector3Array) -> void:
	_movement_path = path
	_movement_path_index = 0
	_move_target = path[-1]
	_has_move_target = true
	_stalled_seconds = 0.0
	_stall_reference_remaining = _remaining_path_distance()
	if _target_marker != null:
		_target_marker.position = Vector3(_move_target.x, 0.012, _move_target.z)
		_target_marker.visible = true


func _path_direction() -> Vector3:
	if not _has_move_target or _movement_path.is_empty():
		return Vector3.ZERO
	while _movement_path_index < _movement_path.size():
		var waypoint := _movement_path[_movement_path_index]
		var offset := waypoint - _actor.position
		offset.y = 0.0
		if offset.length() > WAYPOINT_REACHED_DISTANCE:
			return offset.normalized()
		_movement_path_index += 1
	_clear_move_path()
	return Vector3.ZERO


func _advance_movement_velocity(direction: Vector3, delta: float) -> Vector3:
	if _actor == null:
		return Vector3.ZERO
	var desired_speed := _desired_move_speed(direction)
	var waypoint_distance := INF
	if direction.length_squared() > 0.0:
		waypoint_distance = _distance_to_current_waypoint()
	var next_velocity := _steer_movement_velocity(
		_actor.velocity,
		direction,
		desired_speed,
		waypoint_distance,
		delta,
	)
	_actor.velocity = next_velocity
	_move_speed = next_velocity.length()
	return next_velocity


func _steer_movement_velocity(
	current_velocity: Vector3,
	direction: Vector3,
	desired_speed: float,
	waypoint_distance: float,
	delta: float,
) -> Vector3:
	var current := current_velocity
	current.y = 0.0
	if delta <= 0.0:
		return current
	var desired_direction := direction
	desired_direction.y = 0.0
	if desired_direction.length_squared() > 0.0:
		desired_direction = desired_direction.normalized()
	if desired_direction.length_squared() <= 0.0 or desired_speed <= 0.0:
		return current.move_toward(Vector3.ZERO, WALK_BRAKING * delta)

	var current_speed := current.length()
	if (
		current_speed > VELOCITY_STOP_EPSILON
		and current.normalized().dot(desired_direction) < 0.0
	):
		# A sharp retarget must dissipate the old velocity before applying force
		# along the opposite route. Reassigning a speed scalar to the new direction
		# would reverse the complete velocity vector in a single physics frame.
		return current.move_toward(Vector3.ZERO, WALK_BRAKING * delta)

	var desired_velocity := desired_direction * minf(desired_speed, WALK_SPEED)
	var alignment := 1.0
	if current_speed > VELOCITY_STOP_EPSILON:
		alignment = current.normalized().dot(desired_direction)
	var steering_rate := (
		WALK_BRAKING
		if desired_speed < current_speed or alignment < CORNER_DOT_THRESHOLD
		else WALK_ACCELERATION
	)
	var next_velocity := current.move_toward(desired_velocity, steering_rate * delta)
	if next_velocity.length() > WALK_SPEED:
		next_velocity = next_velocity.normalized() * WALK_SPEED

	# Limit only the component aimed through the waypoint. Lateral velocity is
	# steered down instead of being teleported into the new direction, while the
	# forward component remains unable to cross a waypoint in one Web frame.
	if waypoint_distance < INF and delta > 0.0:
		var maximum_forward_speed := waypoint_distance / delta
		var forward_speed := next_velocity.dot(desired_direction)
		if forward_speed > maximum_forward_speed:
			next_velocity -= desired_direction * (forward_speed - maximum_forward_speed)
	next_velocity.y = 0.0
	return next_velocity


func _update_actor_facing(direction: Vector3, delta: float) -> void:
	if _actor == null:
		return
	var facing_direction := _actor.velocity
	facing_direction.y = 0.0
	if facing_direction.length_squared() <= WALK_ANIMATION_IDLE_SPEED * WALK_ANIMATION_IDLE_SPEED:
		facing_direction = direction
		facing_direction.y = 0.0
	if facing_direction.length_squared() <= 0.0:
		return
	var facing := atan2(facing_direction.x, facing_direction.z)
	_actor.rotation.y = lerp_angle(
		_actor.rotation.y,
		facing,
		1.0 - exp(-delta * TURN_RESPONSE),
	)


func _desired_move_speed(direction: Vector3) -> float:
	if direction.length_squared() <= 0.0 or not _has_move_target:
		return 0.0
	var remaining_after_stop := maxf(
		_remaining_path_distance() - TARGET_REACHED_DISTANCE,
		0.0,
	)
	var arrival_limit := sqrt(2.0 * WALK_BRAKING * remaining_after_stop)
	var desired_speed := minf(WALK_SPEED, arrival_limit)
	desired_speed = minf(desired_speed, _corner_speed_limit(direction))

	# A new route can reverse the actor before it reaches its first authored
	# corner. Keep that turn deliberate instead of sliding sideways at full pace.
	var actor_forward := Vector3(sin(_actor.rotation.y), 0.0, cos(_actor.rotation.y))
	if actor_forward.dot(direction) < CORNER_DOT_THRESHOLD:
		desired_speed = minf(desired_speed, CORNER_SPEED)
	return desired_speed


func _corner_speed_limit(incoming_direction: Vector3) -> float:
	if _movement_path_index + 1 >= _movement_path.size():
		return WALK_SPEED
	var waypoint_distance := _distance_to_current_waypoint()
	if waypoint_distance >= CORNER_APPROACH_DISTANCE:
		return WALK_SPEED
	var outgoing := _movement_path[_movement_path_index + 1] - _movement_path[_movement_path_index]
	outgoing.y = 0.0
	if outgoing.length_squared() <= 0.0:
		return WALK_SPEED
	var turn_alignment := incoming_direction.dot(outgoing.normalized())
	if turn_alignment >= CORNER_DOT_THRESHOLD:
		return WALK_SPEED
	var approach_weight := smoothstep(
		0.0,
		1.0,
		clampf(waypoint_distance / CORNER_APPROACH_DISTANCE, 0.0, 1.0),
	)
	return lerpf(CORNER_SPEED, WALK_SPEED, approach_weight)


func _remaining_path_distance() -> float:
	if not _has_move_target or _movement_path_index >= _movement_path.size():
		return 0.0
	var cursor := _actor.position
	cursor.y = 0.0
	var remaining := 0.0
	for index in range(_movement_path_index, _movement_path.size()):
		var waypoint := _movement_path[index]
		waypoint.y = 0.0
		remaining += cursor.distance_to(waypoint)
		cursor = waypoint
	return remaining


func _distance_to_current_waypoint() -> float:
	if _movement_path_index >= _movement_path.size():
		return 0.0
	var offset := _movement_path[_movement_path_index] - _actor.position
	offset.y = 0.0
	return offset.length()


func _update_path_progress(_position_before_move: Vector3, delta: float) -> void:
	if not _has_move_target:
		return
	var remaining := _move_target - _actor.position
	remaining.y = 0.0
	if remaining.length() <= TARGET_REACHED_DISTANCE:
		_clear_move_path()
		return
	var route_remaining := _remaining_path_distance()
	if _stall_reference_remaining == INF:
		_stall_reference_remaining = route_remaining
	_stalled_seconds += delta
	if _stall_reference_remaining - route_remaining >= REPLAN_PROGRESS_DISTANCE:
		_stalled_seconds = 0.0
		_stall_reference_remaining = route_remaining
		return
	if _stalled_seconds < REPLAN_STALL_SECONDS or _navigator == null:
		return
	_stalled_seconds = 0.0
	_stall_reference_remaining = route_remaining
	var replanned: PackedVector3Array = _navigator.find_path(_actor.position, _move_target)
	if replanned.is_empty():
		_clear_move_path()
	else:
		_set_move_path(replanned)


func _clear_move_path() -> void:
	_movement_path = PackedVector3Array()
	_movement_path_index = 0
	_has_move_target = false
	_move_speed = 0.0
	_stalled_seconds = 0.0
	_stall_reference_remaining = INF
	if _actor != null:
		_actor.velocity = Vector3.ZERO
	if _target_marker != null:
		_target_marker.visible = false


func _verify_macaw_smoke_contract() -> void:
	if MACAW_SMOKE_ARGUMENT not in OS.get_cmdline_user_args():
		return
	if (
		not _macaw_available
		or _macaw_costume == null
		or not _macaw_costume.has_complete_attachment_set()
		or not _macaw_costume.all_attachments_visible(true)
		or not _human_meshes.all(func(mesh: MeshInstance3D) -> bool: return not mesh.visible)
	):
		var attachment_count := (
			_macaw_costume.attachment_count() if _macaw_costume != null else 0
		)
		push_error(
			"Macaw costume smoke contract failed: expected 9 attachments, found %d."
			% attachment_count
		)
		get_tree().quit(1)
		return
	_set_appearance(false)
	if (
		not _macaw_costume.all_attachments_visible(false)
		or not _human_meshes.all(func(mesh: MeshInstance3D) -> bool: return mesh.visible)
	):
		push_error("Macaw costume smoke contract failed while switching to the human donor.")
		get_tree().quit(1)
		return
	_set_appearance(true)
	var articulated_count := _count_articulated_costume_parts()
	if articulated_count != ARTICULATED_PART_IDS.size():
		push_error(
			"Macaw costume smoke contract failed: expected %d articulated limbs, found %d."
			% [ARTICULATED_PART_IDS.size(), articulated_count]
		)
		get_tree().quit(1)
		return
	print(
		"MACAW_COSTUME_SMOKE_OK attachments=%d articulated=%d"
		% [_macaw_costume.attachment_count(), articulated_count]
	)


func _count_articulated_costume_parts() -> int:
	if _animation_player == null:
		return -1
	var walk_animation := _find_animation("Walk")
	var idle_animation := _find_animation("Idle")
	if walk_animation.is_empty() or idle_animation.is_empty():
		return -1

	_animation_player.play(idle_animation)
	_animation_player.seek(0.0, true)
	_macaw_costume.update_camera_facing(_camera)
	var idle_signature := _macaw_costume.pose_signature(ARTICULATED_PART_IDS)
	if idle_signature.size() != ARTICULATED_PART_IDS.size():
		return -1

	var articulated_parts: Dictionary = {}
	for sample_seconds in ARTICULATION_SAMPLE_SECONDS:
		_animation_player.play(walk_animation)
		_animation_player.seek(float(sample_seconds), true)
		_macaw_costume.update_camera_facing(_camera)
		var walk_signature := _macaw_costume.pose_signature(ARTICULATED_PART_IDS)
		if walk_signature.size() != ARTICULATED_PART_IDS.size():
			return -1
		for part_id in ARTICULATED_PART_IDS:
			if articulated_parts.has(part_id):
				continue
			var idle_pose: Dictionary = idle_signature[part_id]
			var walk_pose: Dictionary = walk_signature[part_id]
			var position_delta: float = idle_pose["position"].distance_to(walk_pose["position"])
			var up_delta: float = idle_pose["up"].distance_to(walk_pose["up"])
			if (
				position_delta > ARTICULATION_POSITION_EPSILON
				or up_delta > ARTICULATION_UP_EPSILON
			):
				articulated_parts[part_id] = true

	_animation_player.play(idle_animation)
	_animation_player.seek(0.0, true)
	_macaw_costume.update_camera_facing(_camera)
	return articulated_parts.size()


func _build_interface() -> void:
	var canvas := CanvasLayer.new()
	canvas.name = "GameHud"
	canvas.layer = 10
	canvas.custom_viewport = get_tree().root
	canvas.set_meta("native_resolution", true)
	canvas.set_meta("native_input", true)
	add_child(canvas)

	_interface = Control.new()
	_interface.name = "GameInterface"
	_interface.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_interface.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(_interface)

	_status_panel = PanelContainer.new()
	_status_panel.name = "StatusPanel"
	_status_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.055, 0.105, 0.153, 0.86)))
	_interface.add_child(_status_panel)

	var status_stack := VBoxContainer.new()
	status_stack.add_theme_constant_override("separation", 1)
	_status_panel.add_child(status_stack)

	_title_label = Label.new()
	_title_label.text = "MEMORY GROVE"
	_title_label.add_theme_font_size_override("font_size", 18)
	_title_label.add_theme_color_override("font_color", Color("#f2be5e"))
	status_stack.add_child(_title_label)

	_boundary_label = Label.new()
	_boundary_label.text = "Follow the paths between the landmark trees"
	_boundary_label.add_theme_font_size_override("font_size", 12)
	_boundary_label.add_theme_color_override("font_color", Color("#eaf1e8"))
	status_stack.add_child(_boundary_label)

	_appearance_label = Label.new()
	_appearance_label.text = _appearance_copy()
	_appearance_label.add_theme_font_size_override("font_size", 11)
	_appearance_label.add_theme_color_override("font_color", Color("#65d9d3"))
	status_stack.add_child(_appearance_label)

	_instruction_label = Label.new()
	_instruction_label.text = "Click or tap the ground to walk"
	_instruction_label.add_theme_font_size_override("font_size", 11)
	_instruction_label.add_theme_color_override("font_color", Color("#b8c9c3"))
	status_stack.add_child(_instruction_label)

	_engine_badge = Label.new()
	_engine_badge.name = "EngineBadge"
	_engine_badge.text = "GODOT / WEB"
	_engine_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_engine_badge.anchor_left = 0.5
	_engine_badge.anchor_right = 0.5
	_engine_badge.offset_left = -58.0
	_engine_badge.offset_right = 58.0
	_engine_badge.offset_top = 16.0
	_engine_badge.offset_bottom = 42.0
	_engine_badge.add_theme_font_size_override("font_size", 11)
	_engine_badge.add_theme_color_override("font_color", Color("#8293bd"))
	_interface.add_child(_engine_badge)

	_reset_button = Button.new()
	_reset_button.name = "ResetButton"
	_reset_button.text = "RESET GROVE"
	_reset_button.clip_text = true
	_reset_button.focus_mode = Control.FOCUS_NONE
	_reset_button.add_theme_font_size_override("font_size", 12)
	_style_button(_reset_button, Color(0.055, 0.105, 0.153, 0.84))
	_reset_button.pressed.connect(_reset_grove)
	_interface.add_child(_reset_button)

	_appearance_button = Button.new()
	_appearance_button.name = "AppearanceButton"
	_appearance_button.text = _appearance_button_copy()
	_appearance_button.clip_text = true
	_appearance_button.tooltip_text = "Compare one motion donor with its experimental macaw shell."
	_appearance_button.disabled = not _macaw_available
	_appearance_button.focus_mode = Control.FOCUS_NONE
	_appearance_button.add_theme_font_size_override("font_size", 12)
	_style_button(_appearance_button, Color(0.055, 0.15, 0.16, 0.86))
	_appearance_button.pressed.connect(_toggle_appearance)
	_interface.add_child(_appearance_button)

func _camera_target_focus() -> Vector3:
	var actor_focus := _actor.position + Vector3(0.0, CAMERA_FOCUS_HEIGHT, 0.0)
	var target := _camera_focus
	var camera_right := _camera_ground_right()
	var camera_forward := _camera_ground_forward()
	var actor_delta := actor_focus - _camera_focus
	var horizontal_delta := actor_delta.dot(camera_right)
	var depth_delta := actor_delta.dot(camera_forward)
	if horizontal_delta > CAMERA_DEAD_ZONE.x:
		target += camera_right * (horizontal_delta - CAMERA_DEAD_ZONE.x)
	elif horizontal_delta < -CAMERA_DEAD_ZONE.x:
		target += camera_right * (horizontal_delta + CAMERA_DEAD_ZONE.x)
	if depth_delta > CAMERA_DEAD_ZONE.y:
		target += camera_forward * (depth_delta - CAMERA_DEAD_ZONE.y)
	elif depth_delta < -CAMERA_DEAD_ZONE.y:
		target += camera_forward * (depth_delta + CAMERA_DEAD_ZONE.y)
	target.y = CAMERA_FOCUS_HEIGHT
	return target


func _layout_camera_for_size(viewport_size: Vector2) -> void:
	if _camera == null:
		return
	_camera.keep_aspect = Camera3D.KEEP_HEIGHT
	_camera.size = clampf(
		viewport_size.y / CAMERA_PIXELS_PER_WORLD_UNIT,
		CAMERA_HEIGHT_MIN,
		CAMERA_HEIGHT_MAX,
	)
	_camera.set_meta("responsive_height", _camera.size)
	_camera.set_meta("pixels_per_world_unit", CAMERA_PIXELS_PER_WORLD_UNIT)
	_apply_camera_position()


func _apply_camera_position() -> void:
	if _camera == null:
		return
	_camera.position = _camera_focus + CAMERA_OFFSET


func _camera_ground_right() -> Vector3:
	var camera_right := _camera.global_transform.basis.x
	camera_right.y = 0.0
	return camera_right.normalized()


func _camera_ground_forward() -> Vector3:
	var camera_forward := -_camera.global_transform.basis.z
	camera_forward.y = 0.0
	return camera_forward.normalized()


func _sync_locomotion_animation(direction: Vector3) -> void:
	if _animation_player == null:
		return
	if direction.length_squared() > 0.0 and _move_speed > WALK_ANIMATION_IDLE_SPEED:
		_play_clip("Walk")
		_animation_player.speed_scale = clampf(
			_move_speed / WALK_SPEED,
			WALK_ANIMATION_MIN_SCALE,
			1.0,
		)
	else:
		_animation_player.speed_scale = 1.0
		_play_clip("Idle")


func _play_clip(clip_name: String) -> void:
	if _animation_player == null or _current_clip == clip_name:
		return
	var animation_name := _find_animation(clip_name)
	if animation_name.is_empty():
		return
	_current_clip = clip_name
	_animation_player.play(animation_name, 0.18)


func _find_animation(clip_name: String) -> StringName:
	for animation_name in _animation_player.get_animation_list():
		if String(animation_name) == clip_name or String(animation_name).ends_with("/" + clip_name):
			return animation_name
	var alias := clip_name.trim_suffix("_Loop") if clip_name.ends_with("_Loop") else clip_name + "_Loop"
	for animation_name in _animation_player.get_animation_list():
		if String(animation_name) == alias or String(animation_name).ends_with("/" + alias):
			return animation_name
	return &""


func _layout_interface() -> void:
	var display_size := get_tree().root.get_visible_rect().size
	_layout_interface_for_sizes(display_size, _logical_interface_size(display_size))


func _layout_interface_for_size(viewport_size: Vector2) -> void:
	_layout_interface_for_sizes(viewport_size, viewport_size)


func _layout_interface_for_sizes(display_size: Vector2, interface_size: Vector2) -> void:
	_layout_camera_for_size(display_size)
	if (
		_status_panel == null
		or _reset_button == null
		or _appearance_button == null
	):
		return
	var viewport_size := interface_size
	var portrait := viewport_size.y > viewport_size.x * 1.12
	_portrait_layout = portrait
	_boundary_label.visible = not portrait
	_instruction_label.visible = not portrait
	_appearance_label.text = _appearance_copy()
	_reset_button.text = "RESET" if portrait else "RESET GROVE"
	_appearance_button.text = _appearance_button_copy()
	if portrait:
		_set_control_rect(
			_status_panel,
			Vector2(12.0, 12.0),
			Vector2(maxf(viewport_size.x - 140.0, 190.0), 72.0),
		)
		_set_control_rect(
			_reset_button,
			Vector2(viewport_size.x - 112.0, 12.0),
			Vector2(100.0, 32.0),
		)
		_set_control_rect(
			_appearance_button,
			Vector2(viewport_size.x - 112.0, 50.0),
			Vector2(100.0, 34.0),
		)
		_engine_badge.visible = false
	else:
		_set_control_rect(_status_panel, Vector2(18.0, 18.0), Vector2(270.0, 88.0))
		_set_control_rect(
			_reset_button,
			Vector2(viewport_size.x - 128.0, 18.0),
			Vector2(110.0, 36.0),
		)
		_set_control_rect(
			_appearance_button,
			Vector2(viewport_size.x - 144.0, 60.0),
			Vector2(126.0, 36.0),
		)
		_engine_badge.visible = false


func _logical_interface_size(display_size: Vector2) -> Vector2:
	var canvas_scale := get_tree().root.get_canvas_transform().get_scale().abs()
	return Vector2(
		display_size.x / maxf(canvas_scale.x, 0.001),
		display_size.y / maxf(canvas_scale.y, 0.001),
	)


func _set_control_rect(control: Control, position: Vector2, size: Vector2) -> void:
	control.set_anchors_preset(Control.PRESET_TOP_LEFT)
	control.position = position
	control.size = size


func _style_button(button: Button, color: Color) -> void:
	var normal := _panel_style(color, 13.0)
	var hover := _panel_style(color.lightened(0.12), 13.0)
	var pressed := _panel_style(Color("#6d78cf"), 13.0)
	button.add_theme_stylebox_override("normal", normal)
	button.add_theme_stylebox_override("hover", hover)
	button.add_theme_stylebox_override("pressed", pressed)
	button.add_theme_stylebox_override("focus", hover)
	button.add_theme_color_override("font_color", Color("#eef3ff"))


func _panel_style(color: Color, radius: float = 16.0) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = Color(0.45, 0.55, 0.86, 0.28)
	style.set_border_width_all(1)
	style.set_corner_radius_all(int(radius))
	style.content_margin_left = 16.0
	style.content_margin_right = 16.0
	style.content_margin_top = 10.0
	style.content_margin_bottom = 10.0
	return style


func _material(color: Color, emission: Color, emission_energy: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.82
	if emission_energy > 0.0:
		material.emission_enabled = true
		material.emission = emission
		material.emission_energy_multiplier = emission_energy
	return material


func _reset_grove() -> void:
	_clear_move_path()
	var spawn := Vector3.ZERO
	if _world_scenery != null:
		spawn = _world_scenery.get_meta("default_spawn", Vector3.ZERO) as Vector3
	_actor.position = spawn
	_actor.velocity = Vector3.ZERO
	_actor.rotation = Vector3.ZERO
	_camera_focus = spawn + Vector3(0.0, CAMERA_FOCUS_HEIGHT, 0.0)
	_apply_camera_position()


func _toggle_appearance() -> void:
	if not _macaw_available:
		return
	_set_appearance(not _showing_macaw)


func _set_appearance(show_macaw: bool) -> void:
	_showing_macaw = show_macaw and _macaw_available
	for mesh in _human_meshes:
		if is_instance_valid(mesh):
			mesh.visible = not _showing_macaw
	if _macaw_costume != null:
		_macaw_costume.set_visible(_showing_macaw)
	if _appearance_label != null:
		_appearance_label.text = _appearance_copy()
	if _appearance_button != null:
		_appearance_button.text = _appearance_button_copy()


func _appearance_copy() -> String:
	if not _macaw_available:
		return "HUMAN ONLY" if _portrait_layout else "APPEARANCE  HUMAN / shell unavailable"
	if _showing_macaw:
		if _portrait_layout:
			return "MACAW SHELL / HUMAN MOTION"
		return "APPEARANCE  MACAW SHELL / HUMAN MOTION"
	if _portrait_layout:
		return "HUMAN MOTION"
	return "APPEARANCE  HUMAN MOTION DONOR"


func _appearance_button_copy() -> String:
	if not _macaw_available:
		return "NO MACAW" if _portrait_layout else "MACAW UNAVAILABLE"
	if _showing_macaw:
		return "HUMAN" if _portrait_layout else "VIEW HUMAN"
	return "MACAW" if _portrait_layout else "VIEW MACAW"

