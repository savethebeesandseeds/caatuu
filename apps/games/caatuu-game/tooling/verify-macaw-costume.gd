extends SceneTree

const MacawCostumeController := preload("res://scripts/macaw_costume.gd")
const REQUIRED_BONES := [
	&"DEF-spine.001",
	&"DEF-upper_arm.R",
	&"DEF-forearm.R",
	&"DEF-shin.R",
	&"DEF-hips",
	&"DEF-shin.L",
	&"DEF-head",
	&"DEF-upper_arm.L",
	&"DEF-forearm.L",
]


func _init() -> void:
	if not _verify_missing_bone_fallback():
		return
	if not _verify_missing_atlas_fallback():
		return
	print("MACAW_COSTUME_FALLBACK_OK zero_orphans=true")
	quit(0)


func _verify_missing_bone_fallback() -> bool:
	var skeleton := Skeleton3D.new()
	var costume: MacawCostume = MacawCostumeController.new()
	var built := costume.build(skeleton)
	var passed := (
		not built
		and costume.attachment_count() == 0
		and skeleton.get_child_count() == 0
		and costume.failure_message.begins_with("Required motion bone")
	)
	skeleton.free()
	if not passed:
		_fail("Missing-bone fallback left costume nodes behind or returned success.")
	return passed


func _verify_missing_atlas_fallback() -> bool:
	var skeleton := Skeleton3D.new()
	for bone_name in REQUIRED_BONES:
		skeleton.add_bone(bone_name)
	var costume: MacawCostume = MacawCostumeController.new()
	var built := costume.build(skeleton, "res://assets/macaw/intentionally-missing.png")
	var passed := (
		not built
		and costume.attachment_count() == 0
		and skeleton.get_child_count() == 0
		and costume.failure_message == "The approved macaw parts atlas is unavailable."
	)
	skeleton.free()
	if not passed:
		_fail("Missing-atlas fallback left costume nodes behind or returned success.")
	return passed


func _fail(message: String) -> void:
	push_error(message)
	quit(1)
