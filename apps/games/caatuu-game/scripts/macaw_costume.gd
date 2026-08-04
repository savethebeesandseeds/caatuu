class_name MacawCostume
extends RefCounted

const ATLAS_PATH := "res://assets/macaw/macaw-parts.png"
const MAGENTA_MIN := 180
const GREEN_MAX := 112
const MAGENTA_DOMINANCE := 76

# The rectangles and pivots are the reviewed cells from the AF-054 parts atlas.
# Each card follows one bone from the hidden Quaternius motion donor.
const PARTS := [
	{
		"id": "tail",
		"bone": &"DEF-spine.001",
		"rect": Rect2i(829, 106, 311, 250),
		"pivot": Vector2(50.0, 125.0),
		"pixel_size": 0.0018,
		"position": Vector3(0.12, -0.08, -0.045),
		"priority": -4,
	},
	{
		"id": "arm_far_upper",
		"bone": &"DEF-upper_arm.R",
		"rect": Rect2i(116, 396, 210, 287),
		"pivot": Vector2(104.0, 35.0),
		"pixel_size": 0.00172,
		"position": Vector3(0.0, 0.0, -0.03),
		"priority": -3,
	},
	{
		"id": "arm_far_lower",
		"bone": &"DEF-forearm.R",
		"rect": Rect2i(407, 426, 308, 226),
		"pivot": Vector2(274.0, 113.0),
		"pixel_size": 0.00164,
		"position": Vector3(0.0, 0.0, -0.025),
		"priority": -2,
	},
	{
		"id": "leg_far",
		"bone": &"DEF-shin.R",
		"rect": Rect2i(75, 700, 238, 260),
		"pivot": Vector2(119.0, 35.0),
		"pixel_size": 0.0014,
		"position": Vector3(0.0, 0.0, -0.02),
		"priority": -1,
	},
	{
		"id": "torso",
		"bone": &"DEF-hips",
		"rect": Rect2i(377, 30, 415, 388),
		"pivot": Vector2(207.5, 356.0),
		"pixel_size": 0.00225,
		"position": Vector3(0.0, 0.0, 0.0),
		"priority": 0,
	},
	{
		"id": "leg_near",
		"bone": &"DEF-shin.L",
		"rect": Rect2i(435, 701, 229, 274),
		"pivot": Vector2(114.5, 35.0),
		"pixel_size": 0.00136,
		"position": Vector3(0.0, 0.0, 0.015),
		"priority": 1,
	},
	{
		"id": "head",
		"bone": &"DEF-head",
		"rect": Rect2i(91, 0, 300, 388),
		"pivot": Vector2(150.0, 350.0),
		"pixel_size": 0.002,
		"position": Vector3(0.0, 0.0, 0.025),
		"priority": 2,
	},
	{
		"id": "arm_near_upper",
		"bone": &"DEF-upper_arm.L",
		"rect": Rect2i(832, 396, 209, 271),
		"pivot": Vector2(100.0, 36.0),
		"pixel_size": 0.00176,
		"position": Vector3(0.0, 0.0, 0.035),
		"priority": 3,
	},
	{
		"id": "arm_near_lower",
		"bone": &"DEF-forearm.L",
		"rect": Rect2i(1138, 436, 256, 199),
		"pivot": Vector2(226.0, 100.0),
		"pixel_size": 0.00176,
		"position": Vector3(0.0, 0.0, 0.04),
		"priority": 4,
	},
]

var failure_message := ""
var _attachments: Array[BoneAttachment3D] = []
var _cards: Array[Dictionary] = []


func build(skeleton: Skeleton3D, atlas_path: String = ATLAS_PATH) -> bool:
	failure_message = ""
	_discard()

	for part in PARTS:
		var bone_name := StringName(part["bone"])
		if skeleton.find_bone(bone_name) < 0:
			failure_message = "Required motion bone '%s' is missing." % bone_name
			return false

	if not ResourceLoader.exists(atlas_path, "Texture2D"):
		failure_message = "The approved macaw parts atlas is unavailable."
		return false
	var atlas := load(atlas_path) as Texture2D
	if atlas == null:
		failure_message = "The approved macaw parts atlas is unavailable."
		return false
	var atlas_image := atlas.get_image()
	if atlas_image == null or atlas_image.is_empty():
		failure_message = "The approved macaw parts atlas could not be decoded."
		return false
	atlas_image.convert(Image.FORMAT_RGBA8)

	for part in PARTS:
		var rect: Rect2i = part["rect"]
		if not Rect2i(Vector2i.ZERO, atlas_image.get_size()).encloses(rect):
			failure_message = "Macaw atlas region '%s' is outside the source image." % part["id"]
			_discard()
			return false
		var texture := _extract_part(atlas_image, rect)
		if texture == null:
			failure_message = "Macaw atlas region '%s' could not be prepared." % part["id"]
			_discard()
			return false
		_add_part(skeleton, part, texture)

	set_visible(false)
	return true


func set_visible(value: bool) -> void:
	for attachment in _attachments:
		if is_instance_valid(attachment):
			attachment.visible = value


func all_attachments_visible(expected: bool) -> bool:
	for attachment in _attachments:
		if not is_instance_valid(attachment) or attachment.visible != expected:
			return false
	return true


func attachment_count() -> int:
	return _attachments.size()


func has_complete_attachment_set() -> bool:
	if _attachments.size() != PARTS.size():
		return false
	for attachment in _attachments:
		if not is_instance_valid(attachment):
			return false
		if attachment.get_child_count() != 1 or not attachment.get_child(0) is Sprite3D:
			return false
	return true


func pose_signature(part_ids: Array[StringName]) -> Dictionary:
	var signature: Dictionary = {}
	for card in _cards:
		var part_id: StringName = card["id"]
		if part_id not in part_ids:
			continue
		var sprite: Sprite3D = card["sprite"]
		if is_instance_valid(sprite):
			signature[part_id] = {
				"position": sprite.global_position,
				"up": sprite.global_transform.basis.y.normalized(),
			}
	return signature


func update_camera_facing(camera: Camera3D) -> void:
	if not is_instance_valid(camera):
		return
	var camera_basis := camera.global_transform.basis.orthonormalized()
	var camera_inverse := camera_basis.inverse()
	for card in _cards:
		var skeleton: Skeleton3D = card["skeleton"]
		var sprite: Sprite3D = card["sprite"]
		if not is_instance_valid(skeleton) or not is_instance_valid(sprite):
			continue

		var bone_index: int = card["bone_index"]
		var rest_local_up: Vector3 = card["rest_local_up"]
		var animated_up := (
			skeleton.get_bone_global_pose(bone_index).basis.orthonormalized()
			* rest_local_up
		)
		var world_up := skeleton.global_transform.basis.orthonormalized() * animated_up
		var view_up := camera_inverse * world_up
		var projected_up := Vector2(view_up.x, view_up.y)
		if projected_up.length_squared() < 0.0001:
			projected_up = Vector2.UP
		projected_up = projected_up.normalized()

		var card_up := (
			camera_basis.x * projected_up.x + camera_basis.y * projected_up.y
		).normalized()
		var card_normal := camera_basis.z
		var card_right := card_up.cross(card_normal).normalized()
		var inherited_scale := skeleton.global_transform.basis.get_scale()
		sprite.global_basis = Basis(
			card_right * inherited_scale.x,
			card_up * inherited_scale.y,
			card_normal * inherited_scale.z,
		)


func _add_part(
	skeleton: Skeleton3D,
	part: Dictionary,
	texture: ImageTexture,
) -> void:
	var attachment := BoneAttachment3D.new()
	attachment.name = "Macaw_%s" % String(part["id"])
	attachment.bone_name = StringName(part["bone"])
	skeleton.add_child(attachment)

	var sprite := Sprite3D.new()
	sprite.name = "Card"
	sprite.texture = texture
	sprite.pixel_size = float(part["pixel_size"])
	sprite.offset = _pivot_offset(texture.get_size(), part["pivot"])
	sprite.position = part["position"]
	sprite.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_DISABLED
	sprite.shaded = false
	sprite.double_sided = true
	sprite.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sprite.render_priority = int(part["priority"])
	attachment.add_child(sprite)
	_attachments.append(attachment)

	var bone_index := skeleton.find_bone(StringName(part["bone"]))
	var rest_basis := skeleton.get_bone_global_rest(bone_index).basis.orthonormalized()
	_cards.append(
		{
			"id": StringName(part["id"]),
			"skeleton": skeleton,
			"bone_index": bone_index,
			"rest_local_up": rest_basis.inverse() * Vector3.UP,
			"sprite": sprite,
		}
	)


func _extract_part(atlas: Image, rect: Rect2i) -> ImageTexture:
	var image := atlas.get_region(rect)
	if image.is_empty():
		return null
	image.convert(Image.FORMAT_RGBA8)
	var bytes := image.get_data()
	for offset in range(0, bytes.size(), 4):
		var red := int(bytes[offset])
		var green := int(bytes[offset + 1])
		var blue := int(bytes[offset + 2])
		if (
			red >= MAGENTA_MIN
			and blue >= MAGENTA_MIN
			and green <= GREEN_MAX
			and min(red, blue) - green >= MAGENTA_DOMINANCE
		):
			bytes[offset] = 0
			bytes[offset + 1] = 0
			bytes[offset + 2] = 0
			bytes[offset + 3] = 0
	image.set_data(image.get_width(), image.get_height(), false, Image.FORMAT_RGBA8, bytes)
	image.generate_mipmaps()
	return ImageTexture.create_from_image(image)


func _pivot_offset(size: Vector2i, pivot: Vector2) -> Vector2:
	return Vector2(float(size.x) * 0.5 - pivot.x, pivot.y - float(size.y) * 0.5)


func _discard() -> void:
	for attachment in _attachments:
		if is_instance_valid(attachment):
			attachment.free()
	_attachments.clear()
	_cards.clear()
