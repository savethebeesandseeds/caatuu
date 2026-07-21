"""Render the owned AF-044 articulated humanoid through Blender's Python API."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import struct
import sys
import tempfile
import time
from array import array
from collections.abc import Sequence
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

_TRUSTED_SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_TRUSTED_SCRIPT_ROOT))

import evidence  # noqa: E402
import motion  # noqa: E402
from motion import ArmPose, LegPose, Vec3, WalkPose  # noqa: E402
from output_paths import resolve_output_path  # noqa: E402
from png_canonical import canonicalize_rgba_png  # noqa: E402

OUTPUT_ROOT_ENV = "ANIMATED_FABRIC_BLENDER_OUTPUT_ROOT"
RENDER_ENGINE = "CYCLES"
RENDER_SAMPLES = 32
RENDER_THREADS = 2
CAMERA_ORTHO_SCALE = 3.0
CAMERA_TARGET = Vec3(0.0, 0.0, 1.301)
CAMERA_OFFSET = Vec3(6.0, -6.0, 6.0)

Color = tuple[float, float, float, float]

PALETTE: dict[str, Color] = {
    "skin": (0.76, 0.39, 0.23, 1.0),
    "skin_light": (0.95, 0.65, 0.42, 1.0),
    "shirt": (0.04, 0.42, 0.48, 1.0),
    "shirt_light": (0.08, 0.59, 0.61, 1.0),
    "pants": (0.07, 0.12, 0.24, 1.0),
    "boots": (0.26, 0.10, 0.07, 1.0),
    "belt": (0.91, 0.58, 0.12, 1.0),
    "hair": (0.055, 0.035, 0.045, 1.0),
    "eyes": (0.015, 0.02, 0.025, 1.0),
    "shadow": (0.018, 0.025, 0.045, 0.22),
}


def _vector(value: Vec3) -> Vector:
    return Vector((value.x, value.y, value.z))


def _material(name: str, color: Color) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    if color[3] >= 1.0:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Roughness"].default_value = 0.88
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    else:
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        diffuse = nodes.new("ShaderNodeBsdfDiffuse")
        diffuse.inputs["Color"].default_value = (*color[:3], 1.0)
        diffuse.inputs["Roughness"].default_value = 1.0
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = color[3]
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(transparent.outputs["BSDF"], mix.inputs[1])
        links.new(diffuse.outputs["BSDF"], mix.inputs[2])
        links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def _assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    if obj.data is None or not hasattr(obj.data, "materials"):
        raise RuntimeError(f"Object '{obj.name}' cannot receive a material.")
    obj.data.materials.append(material)


def _parent_to_actor(obj: bpy.types.Object, actor: bpy.types.Object) -> bpy.types.Object:
    obj.parent = actor
    obj.matrix_parent_inverse = Matrix.Identity(4)
    return obj


def _new_cylinder(
    name: str,
    material: bpy.types.Material,
    actor: bpy.types.Object,
    *,
    vertices: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=1.0, depth=2.0)
    obj = bpy.context.object
    obj.name = name
    _assign_material(obj, material)
    return _parent_to_actor(obj, actor)


def _new_sphere(
    name: str,
    material: bpy.types.Material,
    actor: bpy.types.Object,
    *,
    subdivisions: int = 2,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0)
    obj = bpy.context.object
    obj.name = name
    _assign_material(obj, material)
    return _parent_to_actor(obj, actor)


def _new_cube(
    name: str,
    material: bpy.types.Material,
    actor: bpy.types.Object,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=2.0)
    obj = bpy.context.object
    obj.name = name
    _assign_material(obj, material)
    return _parent_to_actor(obj, actor)


def _new_cone(
    name: str,
    material: bpy.types.Material,
    actor: bpy.types.Object,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=1.0, radius2=0.0, depth=2.0)
    obj = bpy.context.object
    obj.name = name
    _assign_material(obj, material)
    return _parent_to_actor(obj, actor)


def _set_ellipsoid(
    obj: bpy.types.Object,
    center: Vec3,
    scale: tuple[float, float, float],
    *,
    yaw_deg: float = 0.0,
) -> None:
    obj.matrix_local = (
        Matrix.Translation(_vector(center))
        @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
        @ Matrix.Diagonal((*scale, 1.0))
    )


def _set_segment(
    obj: bpy.types.Object,
    start: Vec3,
    end: Vec3,
    radius: float,
) -> None:
    start_vector = _vector(start)
    delta = _vector(end) - start_vector
    length = delta.length
    if length <= 0.0:
        raise RuntimeError(f"Segment '{obj.name}' has no length.")
    midpoint = start_vector + delta * 0.5
    rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(delta.normalized())
    obj.matrix_local = (
        Matrix.Translation(midpoint)
        @ rotation.to_matrix().to_4x4()
        @ Matrix.Diagonal((radius, radius, length * 0.5, 1.0))
    )


def _set_foot(obj: bpy.types.Object, leg: LegPose) -> None:
    heel = _vector(leg.foot.heel)
    toe = _vector(leg.foot.toe)
    forward = (toe - heel).normalized()
    side = Vector((1.0, 0.0, 0.0))
    up = side.cross(forward).normalized()
    center = (heel + toe) * 0.5 + up * 0.055
    orientation = Matrix(
        (
            (side.x, forward.x, up.x, 0.0),
            (side.y, forward.y, up.y, 0.0),
            (side.z, forward.z, up.z, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
    )
    obj.matrix_local = (
        Matrix.Translation(center)
        @ orientation
        @ Matrix.Diagonal((0.105, (toe - heel).length * 0.5, 0.055, 1.0))
    )


def _scene_parts(
    actor: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> dict[str, bpy.types.Object]:
    parts: dict[str, bpy.types.Object] = {}
    for side in ("left", "right"):
        parts[f"thigh_{side}"] = _new_cylinder(f"thigh_{side}", materials["pants"], actor)
        parts[f"shin_{side}"] = _new_cylinder(f"shin_{side}", materials["pants"], actor)
        parts[f"knee_{side}"] = _new_sphere(f"knee_{side}", materials["pants"], actor)
        parts[f"foot_{side}"] = _new_cube(f"foot_{side}", materials["boots"], actor)
        parts[f"upper_arm_{side}"] = _new_cylinder(
            f"upper_arm_{side}", materials["shirt_light"], actor
        )
        parts[f"lower_arm_{side}"] = _new_cylinder(f"lower_arm_{side}", materials["skin"], actor)
        parts[f"elbow_{side}"] = _new_sphere(f"elbow_{side}", materials["skin"], actor)
        parts[f"hand_{side}"] = _new_sphere(f"hand_{side}", materials["skin"], actor)

    parts["pelvis"] = _new_sphere("pelvis", materials["pants"], actor)
    parts["torso"] = _new_sphere("torso", materials["shirt"], actor)
    parts["belt"] = _new_cube("belt", materials["belt"], actor)
    parts["head"] = _new_sphere("head", materials["skin_light"], actor)
    parts["hair"] = _new_sphere("hair", materials["hair"], actor)
    parts["eye_left"] = _new_sphere("eye_left", materials["eyes"], actor, subdivisions=1)
    parts["eye_right"] = _new_sphere("eye_right", materials["eyes"], actor, subdivisions=1)
    parts["nose"] = _new_cone("nose", materials["skin"], actor)
    parts["shadow"] = _new_cylinder("shadow", materials["shadow"], actor, vertices=32)
    return parts


def _set_arm(parts: dict[str, bpy.types.Object], side: str, arm: ArmPose) -> None:
    _set_segment(parts[f"upper_arm_{side}"], arm.shoulder, arm.elbow, 0.095)
    _set_segment(parts[f"lower_arm_{side}"], arm.elbow, arm.wrist, 0.078)
    _set_ellipsoid(parts[f"elbow_{side}"], arm.elbow, (0.105, 0.105, 0.105))
    _set_ellipsoid(parts[f"hand_{side}"], arm.wrist, (0.105, 0.09, 0.13))


def _set_leg(parts: dict[str, bpy.types.Object], side: str, leg: LegPose) -> None:
    _set_segment(parts[f"thigh_{side}"], leg.hip, leg.knee, 0.135)
    _set_segment(parts[f"shin_{side}"], leg.knee, leg.ankle, 0.115)
    _set_ellipsoid(parts[f"knee_{side}"], leg.knee, (0.14, 0.14, 0.14))
    _set_foot(parts[f"foot_{side}"], leg)


def _apply_pose(parts: dict[str, bpy.types.Object], pose: WalkPose) -> None:
    _set_leg(parts, "left", pose.left_leg)
    _set_leg(parts, "right", pose.right_leg)
    _set_arm(parts, "left", pose.left_arm)
    _set_arm(parts, "right", pose.right_arm)

    torso_center = pose.pelvis + (pose.chest - pose.pelvis) * 0.56
    _set_ellipsoid(parts["pelvis"], pose.pelvis, (0.31, 0.235, 0.22), yaw_deg=pose.pelvis_yaw_deg)
    _set_ellipsoid(parts["torso"], torso_center, (0.37, 0.25, 0.40), yaw_deg=pose.chest_yaw_deg)
    _set_ellipsoid(
        parts["belt"],
        Vec3(pose.pelvis.x, pose.pelvis.y, pose.pelvis.z + 0.20),
        (0.32, 0.24, 0.045),
        yaw_deg=pose.pelvis_yaw_deg,
    )
    _set_ellipsoid(parts["head"], pose.head, (0.265, 0.245, 0.285))
    _set_ellipsoid(
        parts["hair"],
        Vec3(pose.head.x, pose.head.y - 0.085, pose.head.z + 0.095),
        (0.275, 0.225, 0.225),
    )
    for side, x_offset in (("left", -0.09), ("right", 0.09)):
        _set_ellipsoid(
            parts[f"eye_{side}"],
            Vec3(pose.head.x + x_offset, pose.head.y + 0.232, pose.head.z + 0.055),
            (0.028, 0.018, 0.038),
        )
    nose_center = Vec3(pose.head.x, pose.head.y + 0.278, pose.head.z - 0.015)
    nose_rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(Vector((0.0, 1.0, 0.0)))
    parts["nose"].matrix_local = (
        Matrix.Translation(_vector(nose_center))
        @ nose_rotation.to_matrix().to_4x4()
        @ Matrix.Diagonal((0.055, 0.055, 0.105, 1.0))
    )
    _set_ellipsoid(parts["shadow"], Vec3(0.0, 0.0, 0.008), (0.49, 0.34, 0.008))


def _look_at(obj: bpy.types.Object, target: Vec3) -> None:
    direction = _vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _add_area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name=name, object_data=data)
    bpy.context.collection.objects.link(light)
    light.location = location
    _look_at(light, Vec3(0.0, 0.0, 1.0))


def _configure_scene() -> tuple[bpy.types.Scene, bpy.types.Object, dict[str, bpy.types.Object]]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = RENDER_ENGINE
    scene.cycles.device = "CPU"
    scene.cycles.samples = RENDER_SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.seed = 0
    scene.render.threads_mode = "FIXED"
    scene.render.threads = RENDER_THREADS
    scene.render.resolution_x = motion.FRAME_SIZE[0]
    scene.render.resolution_y = motion.FRAME_SIZE[1]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    scene.render.use_file_extension = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    world = bpy.data.worlds.new("AF044World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        raise RuntimeError("Blender did not create a world Background node.")
    background.inputs["Color"].default_value = (0.035, 0.045, 0.07, 1.0)
    background.inputs["Strength"].default_value = 0.42
    scene.world = world

    actor = bpy.data.objects.new("AF044ActorRoot", None)
    bpy.context.collection.objects.link(actor)
    materials = {name: _material(f"AF044_{name}", color) for name, color in PALETTE.items()}
    parts = _scene_parts(actor, materials)

    camera_data = bpy.data.cameras.new("AF044Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = CAMERA_ORTHO_SCALE
    camera = bpy.data.objects.new("AF044Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = _vector(CAMERA_TARGET + CAMERA_OFFSET)
    _look_at(camera, CAMERA_TARGET)
    scene.camera = camera

    _add_area_light("AF044Key", (4.5, -4.0, 7.0), 720.0, 4.0, (1.0, 0.82, 0.67))
    _add_area_light("AF044Fill", (-4.0, -1.5, 4.0), 430.0, 4.5, (0.52, 0.72, 1.0))
    _add_area_light("AF044Rim", (0.0, 5.0, 5.5), 520.0, 3.5, (0.72, 0.86, 1.0))

    bpy.context.view_layer.update()
    projected = world_to_camera_view(scene, camera, Vector((0.0, 0.0, 0.0)))
    actual_origin = (
        projected.x * motion.FRAME_SIZE[0],
        (1.0 - projected.y) * motion.FRAME_SIZE[1],
    )
    if any(
        abs(actual - expected) > 0.75
        for actual, expected in zip(actual_origin, motion.GROUND_ORIGIN, strict=True)
    ):
        raise RuntimeError(
            "Camera projection disagrees with the declared ground origin: "
            f"actual={actual_origin}, expected={motion.GROUND_ORIGIN}."
        )
    return scene, actor, parts


def _decode_rgba(path: Path) -> tuple[int, int, array[float]]:
    with path.open("rb") as stream:
        header = stream.read(26)
    if len(header) != 26 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise RuntimeError(f"Rendered frame is not a PNG with an IHDR chunk: {path.name}")
    width, height, bit_depth, color_type = struct.unpack(">IIBB", header[16:26])
    if (width, height) != motion.FRAME_SIZE or bit_depth != 8 or color_type != 6:
        raise RuntimeError(
            "Rendered frame is not "
            f"{motion.FRAME_SIZE[0]}x{motion.FRAME_SIZE[1]} RGBA8: {path.name}"
        )
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        if tuple(image.size) != motion.FRAME_SIZE or image.channels != 4:
            raise RuntimeError(f"Blender decoded unexpected frame structure: {path.name}")
        pixels = array("f", [0.0]) * (width * height * 4)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    alpha = pixels[3::4]
    if max(alpha, default=0.0) <= 0.0:
        raise RuntimeError(f"Rendered frame is completely transparent: {path.name}")
    edge_indices = [
        *(x for x in range(width)),
        *((height - 1) * width + x for x in range(width)),
        *(y * width for y in range(1, height - 1)),
        *(y * width + width - 1 for y in range(1, height - 1)),
    ]
    if any(alpha[index] > 1e-6 for index in edge_indices):
        raise RuntimeError(f"Rendered alpha touches the frame edge: {path.name}")
    return width, height, pixels


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _comparison(
    decoded: dict[tuple[str, int], array[float]],
    direct: str,
    source: str,
) -> dict[str, float]:
    width, height = motion.FRAME_SIZE
    absolute_total = 0.0
    maximum = 0.0
    different_pixels = 0
    pixel_count = width * height * motion.FRAME_COUNT
    for index in range(motion.FRAME_COUNT):
        direct_pixels = decoded[(direct, index)]
        source_pixels = decoded[(source, index)]
        for y in range(height):
            for x in range(width):
                direct_offset = (y * width + x) * 4
                source_offset = (y * width + (width - 1 - x)) * 4
                pixel_different = False
                for channel in range(4):
                    difference = abs(
                        direct_pixels[direct_offset + channel]
                        - source_pixels[source_offset + channel]
                    )
                    absolute_total += difference
                    maximum = max(maximum, difference)
                    if difference > 1.0 / 255.0:
                        pixel_different = True
                different_pixels += int(pixel_different)
    return {
        "mean_absolute_rgba": round(absolute_total / (pixel_count * 4), 8),
        "maximum_absolute_rgba": round(maximum, 8),
        "different_pixel_fraction": round(different_pixels / pixel_count, 8),
    }


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, allow_nan=False, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _render_stage(stage: Path) -> None:
    if bpy.app.version_string != evidence.BLENDER_VERSION:
        raise RuntimeError("Blender runtime version disagrees with the pinned evidence contract.")
    if platform.system() != "Linux" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("AF-044 evidence must run on Linux x86-64.")
    scene, actor, parts = _configure_scene()
    scene_object_count = len(bpy.data.objects)
    if not 1 <= scene_object_count <= evidence.MAX_SCENE_OBJECTS:
        raise RuntimeError("Procedural scene exceeds the AF-044 object bound.")
    animation_root = stage / "walk"
    animation_root.mkdir()
    decoded: dict[tuple[str, int], array[float]] = {}
    output_hashes: dict[str, str] = {}
    first_hashes: dict[str, str] = {}
    frames = motion.walk_frames()
    shared_motion_sha256 = motion.motion_sha256(frames)

    for direction in motion.DIRECTIONS:
        (animation_root / direction).mkdir()

    for frame in frames:
        _apply_pose(parts, frame.pose)
        scene.frame_set(frame.index + 1)
        for direction in motion.DIRECTIONS:
            actor.rotation_euler = (
                0.0,
                0.0,
                math.radians(motion.direction_yaw_degrees(direction)),
            )
            bpy.context.view_layer.update()
            destination = animation_root / direction / f"{frame.index:03d}.png"
            scene.render.filepath = str(destination)
            bpy.ops.render.render(write_still=True)
            if not destination.is_file():
                raise RuntimeError(f"Blender did not write {destination.name}.")
            canonicalize_rgba_png(destination, expected_size=motion.FRAME_SIZE)
            _, _, pixels = _decode_rgba(destination)
            decoded[(direction, frame.index)] = pixels
            relative = destination.relative_to(stage).as_posix()
            output_hashes[relative] = _sha256(destination)
            if frame.index == 0:
                first_hashes[direction] = output_hashes[relative]

    if len(set(first_hashes.values())) != len(motion.DIRECTIONS):
        raise RuntimeError("The four direct directions did not produce distinct first frames.")

    metadata_path = animation_root / "animation.json"
    metadata_path.write_text(
        motion.canonical_manifest_json(),
        encoding="utf-8",
        newline="\n",
    )
    output_hashes[metadata_path.relative_to(stage).as_posix()] = _sha256(metadata_path)
    directional_path = stage / motion.DIRECTIONAL_PRERENDER_FILENAME
    directional_path.write_text(
        motion.canonical_directional_prerender_json(frames),
        encoding="utf-8",
        newline="\n",
    )
    output_hashes[directional_path.relative_to(stage).as_posix()] = _sha256(directional_path)
    total_output_bytes = sum((stage / relative).stat().st_size for relative in output_hashes)
    if total_output_bytes > evidence.MAX_OUTPUT_BYTES:
        raise RuntimeError("Rendered evidence exceeds the AF-044 output-byte bound.")
    source_identities = evidence.source_hashes(
        _TRUSTED_SCRIPT_ROOT,
        _TRUSTED_SCRIPT_ROOT / "container.Dockerfile",
        _TRUSTED_SCRIPT_ROOT / "compose.yaml",
    )
    provenance = {
        "format": evidence.EVIDENCE_FORMAT,
        "schema_version": evidence.EVIDENCE_SCHEMA_VERSION,
        "ticket": "AF-044",
        "source": {
            "kind": "owned_procedural_humanoid",
            "animation": "one_in_place_walk",
            **source_identities,
        },
        "container": {
            "image": evidence.CONTAINER_IMAGE,
            "platform": evidence.CONTAINER_PLATFORM,
            "runtime_network": "none",
        },
        "blender": {
            "version": bpy.app.version_string,
            "archive_sha256": evidence.BLENDER_ARCHIVE_SHA256,
            "render_engine": RENDER_ENGINE,
            "device": "CPU",
            "samples": RENDER_SAMPLES,
            "threads": RENDER_THREADS,
            "seed": 0,
        },
        "motion": {
            "stance_ratio": motion.STANCE_RATIO,
            "stride_length": motion.STRIDE_LENGTH,
            "foot_lift": motion.FOOT_LIFT,
            "stance_width": motion.STANCE_WIDTH,
            "pelvis_base_height": motion.PELVIS_BASE_HEIGHT,
            "pelvis_bob": motion.PELVIS_BOB,
            "pelvis_sway": motion.PELVIS_SWAY,
            "arm_swing": motion.ARM_SWING,
            "sha256": shared_motion_sha256,
        },
        "render": {
            "frame_size": list(motion.FRAME_SIZE),
            "ground_origin": list(motion.GROUND_ORIGIN),
            "fps": motion.FPS,
            "duration_ms": motion.DURATION_MS,
            "frames_per_direction": motion.FRAME_COUNT,
            "directions": list(motion.DIRECTIONS),
            "direction_yaw_degrees": dict(motion.DIRECTION_YAW_DEGREES),
            "camera_location": list(CAMERA_TARGET + CAMERA_OFFSET),
            "camera_target": list(CAMERA_TARGET),
            "camera_orthographic_scale": CAMERA_ORTHO_SCALE,
            "transparent": True,
            "color_transform": "Standard",
            "scene_objects": scene_object_count,
            "scene_objects_max": evidence.MAX_SCENE_OBJECTS,
        },
        "mirror_comparison": {
            "direct_SW_vs_mirrored_SE": _comparison(decoded, "SW", "SE"),
            "direct_NW_vs_mirrored_NE": _comparison(decoded, "NW", "NE"),
        },
        "outputs": {
            "file_count": len(output_hashes),
            "total_bytes": total_output_bytes,
            "max_bytes": evidence.MAX_OUTPUT_BYTES,
            "sha256": output_hashes,
        },
    }
    _write_json(stage / "provenance.json", provenance)


def _resolve_output(raw_output: Path) -> tuple[Path, Path]:
    return resolve_output_path(
        raw_output,
        Path(os.environ.get(OUTPUT_ROOT_ENV, "/output")),
    )


def _publish(output_root: Path, destination: Path) -> None:
    stage = Path(tempfile.mkdtemp(prefix=".af044-stage-", dir=output_root))
    backup: Path | None = None
    try:
        _render_stage(stage)
        if destination.exists():
            if not destination.is_dir():
                raise ValueError("Existing output destination must be a directory.")
            backup = Path(tempfile.mkdtemp(prefix=".af044-backup-", dir=output_root))
            backup.rmdir()
            destination.replace(backup)
        stage.replace(destination)
        if backup is not None:
            shutil.rmtree(backup)
    except Exception:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        if backup is not None and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise


def build_parser() -> argparse.ArgumentParser:
    """Build the fixed procedural worker parser."""
    parser = argparse.ArgumentParser(
        description="Render the owned AF-044 humanoid walk in four direct directions."
    )
    parser.add_argument(
        "--out", required=True, type=Path, help="Child of the approved output root."
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Build, render, validate, and transactionally publish the AF-044 evidence."""
    arguments = build_parser().parse_args(argv)
    started = time.monotonic()
    output_root, destination = _resolve_output(arguments.out)
    _publish(output_root, destination)
    elapsed = time.monotonic() - started
    print(
        f"AF-044 rendered {len(motion.DIRECTIONS) * motion.FRAME_COUNT} RGBA frames "
        f"to {destination} in {elapsed:.2f} seconds."
    )
    return 0


if __name__ == "__main__":
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    raise SystemExit(main(sys.argv[separator + 1 :]))
