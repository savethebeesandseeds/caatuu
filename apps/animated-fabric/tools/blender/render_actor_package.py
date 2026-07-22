"""Render one fixed neutral view from the externally pinned AF-055 actor fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import socket
import struct
import sys
import tempfile
from array import array
from collections.abc import Mapping, Sequence
from pathlib import Path

import bpy
from mathutils import Vector

_TRUSTED_SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_TRUSTED_SCRIPT_ROOT))

import actor_package  # noqa: E402
import evidence  # noqa: E402
from output_paths import resolve_output_path  # noqa: E402
from png_canonical import canonicalize_rgba_png  # noqa: E402

ACTOR_INPUT_ROOT = Path("/actor-package")
OUTPUT_ROOT_ENV = "ANIMATED_FABRIC_BLENDER_OUTPUT_ROOT"
EXPECTED_MANIFEST_SHA256 = actor_package.AF055_FIXTURE_MANIFEST_SHA256
VALIDATION_FORMAT = "animated-fabric.actor-validation.v1"
VALIDATION_SCHEMA_VERSION = "0.1.0"
FRAME_SIZE = (192, 192)
RENDER_ENGINE = "BLENDER_EEVEE_NEXT"
RENDER_SAMPLES = 16
CAMERA_LOCATION = (3.2, 5.2, 2.7)
CAMERA_TARGET = (0.0, 0.0, 0.9)
CAMERA_ORTHO_SCALE = 2.45
MAX_OUTPUT_BYTES = 1024 * 1024


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, allow_nan=False, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
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
    _look_at(light, CAMERA_TARGET)


def _configure_worker_scene(scene: bpy.types.Scene) -> None:
    scene.render.engine = RENDER_ENGINE
    scene.render.resolution_x = FRAME_SIZE[0]
    scene.render.resolution_y = FRAME_SIZE[1]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    scene.render.use_file_extension = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 1
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.engine = RENDER_ENGINE
    scene.eevee.taa_render_samples = RENDER_SAMPLES

    world = bpy.data.worlds.new("AF055World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        raise RuntimeError("Blender did not create the worker world background node.")
    background.inputs["Color"].default_value = (0.025, 0.035, 0.055, 1.0)
    background.inputs["Strength"].default_value = 0.35
    scene.world = world

    camera_data = bpy.data.cameras.new("AF055Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = CAMERA_ORTHO_SCALE
    camera = bpy.data.objects.new("AF055Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = CAMERA_LOCATION
    _look_at(camera, CAMERA_TARGET)
    scene.camera = camera

    _add_area_light("AF055Key", (4.0, 4.5, 6.0), 680.0, 4.0, (1.0, 0.83, 0.68))
    _add_area_light("AF055Fill", (-4.0, 2.0, 3.5), 340.0, 4.5, (0.52, 0.72, 1.0))
    _add_area_light("AF055Rim", (0.0, -4.5, 4.5), 420.0, 3.5, (0.70, 0.86, 1.0))


def _assert_no_animation_data(owner: object, label: str) -> None:
    animation_data = getattr(owner, "animation_data", None)
    if animation_data is None:
        return
    if animation_data.action is not None or animation_data.drivers or animation_data.nla_tracks:
        raise RuntimeError(f"Imported actor contains animation behavior at {label}.")


def _expected_count(observations: Mapping[str, object], key: str) -> int:
    value = observations.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise RuntimeError(f"Verified actor observation {key} is not a count.")
    return value


def _mesh_topology(meshes: Sequence[bpy.types.Mesh]) -> dict[str, int]:
    vertices = 0
    indices = 0
    triangles = 0
    for mesh in meshes:
        if any(polygon.loop_total != 3 for polygon in mesh.polygons):
            raise RuntimeError("Imported actor mesh topology is not triangular.")
        mesh.calc_loop_triangles()
        if len(mesh.loop_triangles) != len(mesh.polygons):
            raise RuntimeError("Imported actor triangulation disagrees with mesh polygons.")
        vertices += len(mesh.vertices)
        indices += len(mesh.loops)
        triangles += len(mesh.polygons)
    return {"indices": indices, "triangles": triangles, "vertices": vertices}


def _world_coordinates(
    obj: bpy.types.Object, mesh: bpy.types.Mesh
) -> list[tuple[float, float, float]]:
    coordinates: list[tuple[float, float, float]] = []
    for vertex in mesh.vertices:
        world = obj.matrix_world @ vertex.co
        point = (float(world[0]), float(world[1]), float(world[2]))
        if not all(math.isfinite(component) for component in point):
            raise RuntimeError("Imported actor deformation produced a non-finite vertex.")
        coordinates.append(point)
    return coordinates


def _rounded_bounds(
    coordinates: Sequence[tuple[float, float, float]],
) -> dict[str, list[float]]:
    if not coordinates:
        raise RuntimeError("Imported actor contains no renderable vertices.")
    minimum = [round(min(point[axis] for point in coordinates), 5) for axis in range(3)]
    maximum = [round(max(point[axis] for point in coordinates), 5) for axis in range(3)]
    return {"max": maximum, "min": minimum}


def _assert_declared_bounds(
    bounds: dict[str, list[float]], observations: Mapping[str, object], label: str
) -> None:
    declared = observations.get("actor_bounds_m")
    if not isinstance(declared, dict) or bounds != declared:
        raise RuntimeError(f"Blender actor {label} bounds disagree with preflight geometry.")


def _assert_armature_bindings(
    mesh_objects: Sequence[bpy.types.Object],
    armature_objects: Sequence[bpy.types.Object],
    observations: Mapping[str, object],
) -> None:
    expected_joints = _expected_count(observations, "joints")
    expected_influences = _expected_count(observations, "max_influences_per_vertex")
    joint_count = 0
    for armature in armature_objects:
        bones = armature.data.bones
        if len(armature.pose.bones) != len(bones):
            raise RuntimeError("Imported actor pose-bone count disagrees with its armature.")
        joint_count += len(bones)
    if joint_count != expected_joints:
        raise RuntimeError("Imported actor joint count disagrees with preflight observations.")

    armature_by_pointer = {armature.as_pointer(): armature for armature in armature_objects}
    bound_armatures: set[int] = set()
    modifier_count = 0
    observed_max_influences = 0
    for mesh_object in mesh_objects:
        modifiers = tuple(mesh_object.modifiers)
        if len(modifiers) > 1 or any(modifier.type != "ARMATURE" for modifier in modifiers):
            raise RuntimeError("Imported actor mesh must have at most one armature modifier.")
        groups = tuple(mesh_object.vertex_groups)
        if not modifiers:
            if groups:
                raise RuntimeError("Imported actor has vertex groups without an armature modifier.")
            continue

        modifier = modifiers[0]
        target = modifier.object
        if target is None or target.as_pointer() not in armature_by_pointer:
            raise RuntimeError("Imported actor armature modifier targets an unexpected object.")
        if (
            not modifier.show_viewport
            or not modifier.show_render
            or not modifier.use_vertex_groups
            or modifier.use_bone_envelopes
            or modifier.vertex_group != ""
            or modifier.invert_vertex_group
            or modifier.use_multi_modifier
            or modifier.use_deform_preserve_volume
        ):
            raise RuntimeError("Imported actor armature modifier settings are not the fixed path.")
        if not groups:
            raise RuntimeError("Imported actor armature modifier has no vertex groups.")
        modifier_count += 1
        bound_armatures.add(target.as_pointer())

        bone_names = {bone.name for bone in target.data.bones}
        group_names = {group.name for group in groups}
        if not group_names <= bone_names:
            raise RuntimeError("Imported actor vertex groups do not map to bound armature joints.")
        for vertex in mesh_object.data.vertices:
            weights = [float(element.weight) for element in vertex.groups]
            if any(not math.isfinite(weight) or not 0.0 <= weight <= 1.0 for weight in weights):
                raise RuntimeError("Imported actor contains an invalid vertex-group weight.")
            active = [weight for weight in weights if weight > 0.0]
            if not active or abs(sum(active) - 1.0) > 1e-5:
                raise RuntimeError("Imported actor vertex-group weights are not normalized.")
            observed_max_influences = max(observed_max_influences, len(active))

    grouped_meshes = sum(1 for mesh in mesh_objects if len(mesh.vertex_groups) > 0)
    if modifier_count != grouped_meshes:
        raise RuntimeError("Imported actor armature modifier count is inconsistent.")
    if bound_armatures != set(armature_by_pointer):
        raise RuntimeError("Imported actor armatures are not bound to geometry.")
    if observed_max_influences != expected_influences:
        raise RuntimeError("Imported actor influence count disagrees with preflight observations.")


def _post_import_gate(verified: actor_package.VerifiedActorPackage) -> dict[str, object]:
    if bpy.data.actions or bpy.data.cameras or bpy.data.lights or bpy.data.speakers:
        raise RuntimeError("Imported actor created forbidden scene-level datablocks.")
    if bpy.data.libraries:
        raise RuntimeError("Imported actor created linked library data.")
    allowed_types = {"ARMATURE", "EMPTY", "MESH"}
    if any(obj.type not in allowed_types for obj in bpy.data.objects):
        raise RuntimeError("Imported actor created an unsupported Blender object type.")
    if verified.root_node not in bpy.data.objects:
        raise RuntimeError("Imported actor root is missing after Blender ingestion.")
    mesh_objects = tuple(obj for obj in bpy.data.objects if obj.type == "MESH")
    armature_objects = tuple(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    if len(mesh_objects) != len(bpy.data.meshes) or {
        obj.data.as_pointer() for obj in mesh_objects
    } != {mesh.as_pointer() for mesh in bpy.data.meshes}:
        raise RuntimeError("Imported actor mesh datablocks are not bound one-to-one to objects.")
    if len(armature_objects) != len(bpy.data.armatures) or {
        obj.data.as_pointer() for obj in armature_objects
    } != {armature.as_pointer() for armature in bpy.data.armatures}:
        raise RuntimeError(
            "Imported actor armature datablocks are not bound one-to-one to objects."
        )
    for obj in bpy.data.objects:
        _assert_no_animation_data(obj, f"object {obj.name}")
        if obj.constraints:
            raise RuntimeError("Imported actor contains object constraints.")
        if obj.type == "ARMATURE":
            for bone in obj.pose.bones:
                if bone.constraints:
                    raise RuntimeError("Imported actor contains pose-bone constraints.")
    for data_collection, label in (
        (bpy.data.armatures, "armature"),
        (bpy.data.materials, "material"),
        (bpy.data.meshes, "mesh"),
        (bpy.data.node_groups, "node group"),
    ):
        for data in data_collection:
            _assert_no_animation_data(data, f"{label} {data.name}")
    expected_images = {path.resolve() for path in verified.texture_paths}
    observed_images: set[Path] = set()
    for image in bpy.data.images:
        if image.source != "FILE" or image.packed_file is not None:
            raise RuntimeError("Imported actor image must remain an unpacked verified file.")
        observed_images.add(Path(bpy.path.abspath(image.filepath)).resolve())
    if observed_images != expected_images:
        raise RuntimeError("Blender imported image paths outside the verified snapshot.")
    expected = verified.observations
    actual_counts = {
        "armatures": len(bpy.data.armatures),
        "images": len(bpy.data.images),
        "materials": len(bpy.data.materials),
        "meshes": len(bpy.data.meshes),
    }
    expected_counts = {
        "armatures": expected["skins"],
        "images": expected["images"],
        "materials": expected["materials"],
        "meshes": expected["meshes"],
    }
    if actual_counts != expected_counts:
        raise RuntimeError(
            "Blender imported content counts disagree with preflight observations: "
            f"actual={actual_counts}, expected={expected_counts}."
        )
    expected_topology = {
        "indices": _expected_count(expected, "indices"),
        "triangles": _expected_count(expected, "triangles"),
        "vertices": _expected_count(expected, "vertices"),
    }
    if _mesh_topology(tuple(bpy.data.meshes)) != expected_topology:
        raise RuntimeError("Imported actor mesh topology disagrees with preflight observations.")
    _assert_armature_bindings(mesh_objects, armature_objects, expected)

    source_coordinates = [
        coordinate
        for mesh_object in mesh_objects
        for coordinate in _world_coordinates(mesh_object, mesh_object.data)
    ]
    _assert_declared_bounds(_rounded_bounds(source_coordinates), expected, "source")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    evaluated_coordinates: list[tuple[float, float, float]] = []
    evaluated_meshes: list[bpy.types.Mesh] = []
    evaluated_objects: list[bpy.types.Object] = []
    evaluated_bounds: dict[str, list[float]] | None = None
    try:
        for mesh_object in mesh_objects:
            evaluated_object = mesh_object.evaluated_get(depsgraph)
            evaluated_mesh = evaluated_object.to_mesh(
                preserve_all_data_layers=False,
                depsgraph=depsgraph,
            )
            evaluated_objects.append(evaluated_object)
            evaluated_meshes.append(evaluated_mesh)
            evaluated_coordinates.extend(_world_coordinates(evaluated_object, evaluated_mesh))
        if _mesh_topology(evaluated_meshes) != expected_topology:
            raise RuntimeError("Evaluated actor topology disagrees with preflight observations.")
        evaluated_bounds = _rounded_bounds(evaluated_coordinates)
        _assert_declared_bounds(evaluated_bounds, expected, "deformed")
        if min(point[2] for point in evaluated_coordinates) < -1e-5 or not any(
            abs(point[2]) <= 1e-5 for point in evaluated_coordinates
        ):
            raise RuntimeError("Evaluated actor does not preserve neutral ground contact.")
    finally:
        for evaluated_object in evaluated_objects:
            evaluated_object.to_mesh_clear()
    if evaluated_bounds is None:
        raise RuntimeError("Evaluated actor bounds were not produced.")
    return {
        "armatures": len(bpy.data.armatures),
        "images": len(bpy.data.images),
        "materials": len(bpy.data.materials),
        "meshes": len(bpy.data.meshes),
        "objects": len(bpy.data.objects),
        "world_bounds_m": evaluated_bounds,
    }


def _decode_render(path: Path) -> dict[str, object]:
    with path.open("rb") as stream:
        header = stream.read(26)
    if len(header) != 26 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise RuntimeError("Neutral validation output is not a PNG with IHDR.")
    width, height, depth, color_type = struct.unpack(">IIBB", header[16:26])
    if (width, height) != FRAME_SIZE or depth != 8 or color_type != 6:
        raise RuntimeError("Neutral validation output is not 192x192 RGBA8.")
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        pixels = array("f", [0.0]) * (width * height * 4)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    alpha = pixels[3::4]
    opaque = [index for index, value in enumerate(alpha) if value > 1e-6]
    if not opaque:
        raise RuntimeError("Neutral validation render is fully transparent.")
    xs = [index % width for index in opaque]
    ys = [index // width for index in opaque]
    bounds = [min(xs), height - 1 - max(ys), max(xs), height - 1 - min(ys)]
    if bounds[0] <= 0 or bounds[1] <= 0 or bounds[2] >= width - 1 or bounds[3] >= height - 1:
        raise RuntimeError("Neutral validation render touches a frame edge.")
    return {
        "alpha_bounds_xyxy": bounds,
        "height_px": height,
        "mode": "RGBA8",
        "nontransparent_pixels": len(opaque),
        "width_px": width,
    }


def _trusted_source_hashes() -> dict[str, str]:
    names = (
        "actor_package.py",
        "evidence.py",
        "motion.py",
        "output_paths.py",
        "render_actor_package.py",
        "png_canonical.py",
        "container.Dockerfile",
        "compose.yaml",
    )
    return {name: _sha256(_TRUSTED_SCRIPT_ROOT / name) for name in names}


def _assert_runtime_network_isolated() -> None:
    interfaces = {name for _, name in socket.if_nameindex()}
    if not interfaces or interfaces - {"lo"}:
        raise RuntimeError("AF-055 actor validation requires a loopback-only network namespace.")


def _render_stage(stage: Path) -> None:
    if bpy.app.version_string != evidence.BLENDER_VERSION:
        raise RuntimeError("Blender runtime version disagrees with the pinned evidence contract.")
    if platform.system() != "Linux" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("AF-055 neutral evidence requires Linux x86-64.")
    _assert_runtime_network_isolated()
    actor_package.assert_linux_read_only_mount(ACTOR_INPUT_ROOT)
    with actor_package.private_verified_snapshot(
        ACTOR_INPUT_ROOT,
        Path("/tmp"),
        expected_manifest_sha256=EXPECTED_MANIFEST_SHA256,
    ) as verified:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        result = bpy.ops.import_scene.gltf(
            filepath=str(verified.glb_path),
            disable_bone_shape=True,
            import_pack_images=False,
            import_scene_extras=False,
            import_unused_materials=False,
            import_webp_texture=False,
            merge_vertices=False,
        )
        if "FINISHED" not in result:
            raise RuntimeError("Blender did not finish importing the verified actor snapshot.")
        imported = _post_import_gate(verified)
        scene = bpy.context.scene
        _configure_worker_scene(scene)
        destination = stage / "neutral.png"
        scene.render.filepath = str(destination)
        bpy.ops.render.render(write_still=True)
        if not destination.is_file():
            raise RuntimeError("Blender did not produce the neutral validation frame.")
        canonicalize_rgba_png(destination, expected_size=FRAME_SIZE)
        render_observations = _decode_render(destination)
        if destination.stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeError("Neutral validation render exceeds its output ceiling.")
        package_files = {path: digest for path, digest in verified.file_sha256}
        validation: dict[str, object] = {
            "blender": {
                "archive_sha256": evidence.BLENDER_ARCHIVE_SHA256,
                "color_transform": "AgX Medium High Contrast",
                "render_engine": RENDER_ENGINE,
                "samples": RENDER_SAMPLES,
                "threads": 1,
                "version": bpy.app.version_string,
            },
            "container": {
                "image": "caatuu-animated-fabric-blender-actor-validator:4.5.12",
                "input_mount": "read-only",
                "platform": evidence.CONTAINER_PLATFORM,
                "private_snapshot": True,
                "runtime_network": "none",
            },
            "format": VALIDATION_FORMAT,
            "imported": imported,
            "output": {
                "bytes": destination.stat().st_size,
                "path": destination.name,
                "sha256": _sha256(destination),
                **render_observations,
            },
            "package": {
                "content_set_sha256": verified.content_set_sha256,
                "expected_manifest_sha256": EXPECTED_MANIFEST_SHA256,
                "files": package_files,
                "id": verified.actor_id,
                "manifest_sha256": verified.manifest_sha256,
                "observed": dict(verified.observations),
            },
            "render": {
                "camera_location": list(CAMERA_LOCATION),
                "camera_orthographic_scale": CAMERA_ORTHO_SCALE,
                "camera_target": list(CAMERA_TARGET),
                "frame_size": list(FRAME_SIZE),
                "pose": "rest",
                "transparent": True,
            },
            "schema_version": VALIDATION_SCHEMA_VERSION,
            "ticket": "AF-055",
            "trusted_sources": _trusted_source_hashes(),
        }
        _write_json(stage / "validation.json", validation)


def _resolve_output(raw_output: Path) -> tuple[Path, Path]:
    return resolve_output_path(raw_output, Path(os.environ.get(OUTPUT_ROOT_ENV, "/output")))


def _publish(output_root: Path, destination: Path) -> None:
    stage = Path(tempfile.mkdtemp(prefix=".af055-neutral-stage-", dir=output_root))
    backup: Path | None = None
    try:
        _render_stage(stage)
        if destination.exists():
            if not destination.is_dir():
                raise ValueError("Existing AF-055 output destination must be a directory.")
            backup = Path(tempfile.mkdtemp(prefix=".af055-neutral-backup-", dir=output_root))
            backup.rmdir()
            destination.replace(backup)
        stage.replace(destination)
        if backup is not None:
            shutil.rmtree(backup)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        if backup is not None and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and neutrally render the externally pinned AF-055 actor fixture."
    )
    parser.add_argument("--out", required=True, type=Path, help="Child of the fixed output root.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    output_root, destination = _resolve_output(arguments.out)
    _publish(output_root, destination)
    print(f"AF-055 validated and rendered the pinned actor package to {destination}.")
    return 0


if __name__ == "__main__":
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    raise SystemExit(main(sys.argv[separator + 1 :]))
