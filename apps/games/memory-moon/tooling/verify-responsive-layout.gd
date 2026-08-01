extends SceneTree

const LANDSCAPE_SIZE := Vector2(960.0, 540.0)
const PORTRAIT_SIZE := Vector2(390.0, 844.0)
const HIGH_DPI_DISPLAY_SIZE := Vector2(1920.0, 1080.0)
const CAMERA_PIXELS_PER_WORLD_UNIT := 62.0
const LANDSCAPE_CAMERA_HEIGHT := 540.0 / CAMERA_PIXELS_PER_WORLD_UNIT
const PORTRAIT_CAMERA_HEIGHT := 10.5
const CAMERA_FOCUS_HEIGHT := 0.9
const CAMERA_YAW_RADIANS := PI / 4.0
const CAMERA_ELEVATION_RADIANS := PI / 6.0
const CAMERA_OFFSET := Vector3(8.485281374, 6.928203230, 8.485281374)
const CAMERA_DEAD_ZONE := Vector2(1.35, 0.9)
const AXIS_TEST_DELTA := 0.4
const CAMERA_EPSILON := 0.0001

var _failures: Array[String] = []


func _init() -> void:
	call_deferred("_verify")


func _verify() -> void:
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
	var hud := instance.get_node_or_null("GameHud") as CanvasLayer
	var interface := instance.get_node_or_null("GameHud/GameInterface") as Control
	var status := instance.get_node_or_null("GameHud/GameInterface/StatusPanel") as Control
	var reset := instance.get_node_or_null("GameHud/GameInterface/ResetButton") as Control
	var appearance := instance.get_node_or_null("GameHud/GameInterface/AppearanceButton") as Control
	var engine_badge := instance.get_node_or_null("GameHud/GameInterface/EngineBadge") as Control
	var target_marker := instance.get_node_or_null("WalkTarget") as MeshInstance3D
	var boundary_label := world.get("_boundary_label") as Control if world != null else null
	var instruction_label := world.get("_instruction_label") as Control if world != null else null
	var camera := world.get_node_or_null("MoonCamera") as Camera3D if world != null else null
	_check(world != null, "the Memory Moon world must be the native scene root")
	_check(hud != null, "the native-resolution HUD canvas must exist")
	_check(interface != null, "the responsive interface must exist")
	_check(status != null, "the status panel must exist")
	_check(reset != null, "the reset action must exist")
	_check(appearance != null, "the appearance action must exist")
	_check(instance.get_node_or_null("GameHud/GameInterface/TouchPad") == null, "direction buttons must stay retired")
	_check(engine_badge != null, "the engine badge must exist")
	_check(target_marker != null, "click navigation must expose a world target marker")
	_check(boundary_label != null, "the boundary label must exist")
	_check(instruction_label != null, "the instruction label must exist")
	_check(camera != null, "the orthographic camera must exist")
	if (
		interface == null
		or world == null
		or hud == null
		or status == null
		or reset == null
		or appearance == null
		or engine_badge == null
		or target_marker == null
		or boundary_label == null
		or instruction_label == null
		or camera == null
	):
		_finish(instance)
		return

	_check(instance.find_children("*", "SubViewport", true, false).is_empty(), "the world must not render through a SubViewport")
	_check(instance.find_children("*", "TextureRect", true, false).is_empty(), "the world must not be resampled through a TextureRect")
	_check(instance.get_node_or_null("GameHud/GameInterface/PixelArtButton") == null, "the retired pixel-art action must stay absent")
	_check(interface.mouse_filter == Control.MOUSE_FILTER_IGNORE, "the world surface must receive click and tap input")
	_check(String(instruction_label.text) == "Click or tap the ground to walk", "the movement instruction must describe click navigation")
	var navigator: Variant = world.get("_navigator")
	_check(navigator != null and bool(navigator.call("is_configured")), "click navigation must configure from scenery metadata")
	_check(world.get_viewport() == get_root(), "the world must render directly in the native root viewport")
	_check(hud.custom_viewport == get_root(), "the HUD must render on the native root viewport")
	_check(hud.get_parent() == world, "the HUD must remain in the native world tree")
	_check(bool(hud.get_meta("native_resolution", false)), "the HUD must expose its native-resolution contract")
	_check(bool(hud.get_meta("native_input", false)), "the HUD must expose its native-input contract")
	_verify_isometric_camera(world, camera)
	var camera_basis := camera.global_transform.basis
	var grove := world.get_node_or_null("MemoryGrove")
	var grove_instance_id := grove.get_instance_id() if grove != null else 0

	world.call("_layout_interface_for_sizes", LANDSCAPE_SIZE, LANDSCAPE_SIZE)
	await process_frame
	_check_inside(status, LANDSCAPE_SIZE, "landscape status panel")
	_check_inside(reset, LANDSCAPE_SIZE, "landscape reset action")
	_check_inside(appearance, LANDSCAPE_SIZE, "landscape appearance action")
	_check(not engine_badge.visible, "the landscape engine badge must stay hidden")
	_check(boundary_label.visible, "the landscape boundary label must remain visible")
	_check(instruction_label.visible, "the landscape instruction label must remain visible")
	_check(not _rect(status).intersects(_rect(reset)), "landscape status and reset controls overlap")
	_check(
		absf(camera.size - LANDSCAPE_CAMERA_HEIGHT) < CAMERA_EPSILON,
		"the landscape camera height must follow the pixel-density contract",
	)
	_check(camera.keep_aspect == Camera3D.KEEP_HEIGHT, "the landscape camera must preserve height")

	world.call("_layout_interface_for_sizes", HIGH_DPI_DISPLAY_SIZE, LANDSCAPE_SIZE)
	await process_frame
	_check(status.position == Vector2(18.0, 18.0), "physical resolution must not move the logical HUD")
	_check(reset.position == Vector2(832.0, 18.0), "physical resolution must not move landscape actions")
	world.call("_layout_interface_for_sizes", LANDSCAPE_SIZE, LANDSCAPE_SIZE)
	await process_frame

	world.call("_layout_interface_for_sizes", PORTRAIT_SIZE, PORTRAIT_SIZE)
	await process_frame
	_check_inside(status, PORTRAIT_SIZE, "portrait status panel")
	_check_inside(reset, PORTRAIT_SIZE, "portrait reset action")
	_check_inside(appearance, PORTRAIT_SIZE, "portrait appearance action")
	_check(not engine_badge.visible, "the portrait engine badge must be hidden")
	_check(not boundary_label.visible, "the portrait boundary label must be hidden")
	_check(not instruction_label.visible, "the portrait instruction label must be hidden")
	_check(_rect(status) == Rect2(Vector2(12.0, 12.0), Vector2(250.0, 72.0)), "the portrait status panel must stay compact")
	_check(reset.position == Vector2(278.0, 12.0), "the portrait reset action position changed")
	_check(
		reset.size.x <= 100.0 and reset.size.y <= 40.0,
		"the portrait reset action must stay compact",
	)
	_check(appearance.position == Vector2(278.0, 50.0), "the portrait appearance action position changed")
	_check(
		appearance.size.x <= 100.0 and appearance.size.y <= 40.0,
		"the portrait appearance action must stay compact",
	)
	_check(not _rect(status).intersects(_rect(reset)), "portrait status and reset controls overlap")
	_check(not _rect(reset).intersects(_rect(appearance)), "portrait action controls overlap")
	_check(
		absf(camera.size - PORTRAIT_CAMERA_HEIGHT) < CAMERA_EPSILON,
		"the portrait camera height must follow the pixel-density contract",
	)
	_check(camera.keep_aspect == Camera3D.KEEP_HEIGHT, "the portrait camera must preserve height")
	_check(
		absf(float(camera.get_meta("responsive_height", 0.0)) - PORTRAIT_CAMERA_HEIGHT)
		< CAMERA_EPSILON,
		"the portrait camera metadata changed",
	)
	_check(
		absf(float(camera.get_meta("pixels_per_world_unit", 0.0)) - CAMERA_PIXELS_PER_WORLD_UNIT)
		< CAMERA_EPSILON,
		"the responsive camera pixel density changed",
	)
	_check(bool(camera.get_meta("subpixel_follow", false)), "the camera must expose smooth subpixel following")
	_check(
		camera.global_transform.basis.is_equal_approx(camera_basis),
		"responsive layout must not rotate the world camera",
	)
	_check(camera.projection == Camera3D.PROJECTION_ORTHOGONAL, "responsive layout must stay orthographic")
	_check(world.get_node_or_null("MemoryGrove") == grove, "responsive layout must not rebuild the grove")
	_check(grove_instance_id != 0 and grove.get_instance_id() == grove_instance_id, "the grove instance must survive responsive reflow")
	_verify_camera_axis_dead_zone(world, camera)
	_verify_smooth_camera_translation(world, camera)

	_finish(instance)


func _verify_isometric_camera(instance: Node, camera: Camera3D) -> void:
	var camera_focus: Vector3 = instance.get("_camera_focus")
	var camera_offset := camera.position - camera_focus
	var horizontal_distance := Vector2(camera_offset.x, camera_offset.z).length()
	var yaw := atan2(camera_offset.x, camera_offset.z)
	var elevation := atan2(camera_offset.y, horizontal_distance)
	_check(camera_offset.is_equal_approx(CAMERA_OFFSET), "the isometric camera offset changed")
	_check(absf(yaw - CAMERA_YAW_RADIANS) < CAMERA_EPSILON, "camera yaw must remain 45 degrees")
	_check(
		absf(elevation - CAMERA_ELEVATION_RADIANS) < CAMERA_EPSILON,
		"camera elevation must remain 30 degrees",
	)
	_check(
		String(camera.get_meta("presentation_mode", "")) == "isometric-orthographic",
		"the camera must expose the isometric presentation mode",
	)
	_check(
		absf(float(camera.get_meta("yaw_degrees", 0.0)) - 45.0) < CAMERA_EPSILON,
		"the camera yaw metadata changed",
	)
	_check(
		absf(float(camera.get_meta("elevation_degrees", 0.0)) - 30.0) < CAMERA_EPSILON,
		"the camera elevation metadata changed",
	)
	_check(bool(camera.get_meta("large_world_follow", false)), "the camera must support streamed large-world traversal")
	var camera_right: Vector3 = instance.call("_camera_ground_right")
	var camera_forward: Vector3 = instance.call("_camera_ground_forward")
	_check(absf(camera_right.y) < CAMERA_EPSILON, "camera-right must stay on the ground plane")
	_check(absf(camera_forward.y) < CAMERA_EPSILON, "camera-forward must stay on the ground plane")
	_check(
		absf(camera_right.dot(camera_forward)) < CAMERA_EPSILON,
		"camera ground axes must remain orthogonal",
	)


func _verify_camera_axis_dead_zone(instance: Node, camera: Camera3D) -> void:
	var actor := instance.get_node_or_null("MoonWalker") as CharacterBody3D
	_check(actor != null, "the camera dead-zone verifier requires the walker")
	if actor == null:
		return
	var original_actor_position := actor.position
	var original_focus: Vector3 = instance.get("_camera_focus")
	var camera_basis := camera.global_transform.basis
	var center_focus := Vector3(0.0, CAMERA_FOCUS_HEIGHT, 0.0)
	var camera_right: Vector3 = instance.call("_camera_ground_right")
	var camera_forward: Vector3 = instance.call("_camera_ground_forward")

	instance.set("_camera_focus", center_focus)
	actor.position = camera_right * (CAMERA_DEAD_ZONE.x + AXIS_TEST_DELTA)
	var right_target: Vector3 = instance.call("_camera_target_focus")
	_check(
		right_target.distance_to(center_focus + camera_right * AXIS_TEST_DELTA)
		< CAMERA_EPSILON,
		"the horizontal dead zone must follow the camera-right ground axis",
	)

	instance.set("_camera_focus", center_focus)
	actor.position = camera_forward * (CAMERA_DEAD_ZONE.y + AXIS_TEST_DELTA)
	var forward_target: Vector3 = instance.call("_camera_target_focus")
	_check(
		forward_target.distance_to(center_focus + camera_forward * AXIS_TEST_DELTA)
		< CAMERA_EPSILON,
		"the vertical dead zone must follow the camera-forward ground axis",
	)

	actor.position = original_actor_position
	instance.set("_camera_focus", original_focus)
	instance.call("_apply_camera_position")
	_check(
		camera.global_transform.basis.is_equal_approx(camera_basis),
		"dead-zone verification must preserve the camera basis",
	)


func _verify_smooth_camera_translation(instance: Node, camera: Camera3D) -> void:
	var original_focus: Vector3 = instance.get("_camera_focus")
	var camera_basis := camera.global_transform.basis
	var camera_right: Vector3 = instance.call("_camera_ground_right")
	var camera_forward: Vector3 = instance.call("_camera_ground_forward")
	var test_focus := (
		Vector3(0.0, CAMERA_FOCUS_HEIGHT, 0.0)
		+ camera_right * 0.173
		+ camera_forward * 0.257
	)
	instance.set("_camera_focus", test_focus)
	instance.call("_apply_camera_position")
	_check(
		camera.position.is_equal_approx(test_focus + CAMERA_OFFSET),
		"camera translation must retain the smooth subpixel focus",
	)
	_check(
		camera.global_transform.basis.is_equal_approx(camera_basis),
		"smooth camera translation must preserve the camera basis",
	)
	instance.set("_camera_focus", original_focus)
	instance.call("_apply_camera_position")


func _rect(control: Control) -> Rect2:
	return Rect2(control.position, control.size)


func _check_inside(control: Control, viewport_size: Vector2, label: String) -> void:
	var rect := _rect(control)
	_check(rect.position.x >= 0.0 and rect.position.y >= 0.0, "%s starts outside the viewport" % label)
	_check(rect.end.x <= viewport_size.x and rect.end.y <= viewport_size.y, "%s ends outside the viewport" % label)


func _check(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)


func _finish(instance: Node) -> void:
	if instance != null:
		instance.queue_free()
	if not _failures.is_empty():
		for failure in _failures:
			push_error("Memory Moon responsive verification failed: %s" % failure)
		quit(1)
		return
	print(
		"MEMORY_MOON_RESPONSIVE_SMOKE_OK landscape=960x540 landscape_camera_height=%.4f portrait=390x844 portrait_camera_height=%.4f click_navigation=true direction_buttons=false compact=true camera=isometric-orthographic yaw=45 elevation=30 axis_dead_zone=true smooth_follow=true large_world_follow=true native_root=true native_hud=true"
		% [LANDSCAPE_CAMERA_HEIGHT, PORTRAIT_CAMERA_HEIGHT]
	)
	quit()
