"""Validate and render the fixed AF-056 skinned macaw deformation review."""

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
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

_TRUSTED_SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_TRUSTED_SCRIPT_ROOT))

import actor_package  # noqa: E402
import avian_contract  # noqa: E402
import evidence  # noqa: E402
import render_actor_package as base_worker  # noqa: E402
from output_paths import resolve_output_path  # noqa: E402
from png_canonical import canonicalize_rgba_png  # noqa: E402

ACTOR_INPUT_ROOT = Path("/actor-package")
MAPPING_PATH = Path("/opt/animated-fabric/macaw-rig-mapping.json")
OUTPUT_ROOT_ENV = "ANIMATED_FABRIC_BLENDER_OUTPUT_ROOT"

EXPECTED_MANIFEST_SHA256 = "a26e95456963af80d2d468af19680855dd3c9fbe176d7c3bb0ceb4943ea759c7"
EXPECTED_MAPPING_SHA256 = "245b90ee0c71a9a001121939bdfbabaf34ed3c7c59e1060f0deb6669cf13296f"
EXPECTED_RIG_CONTRACT_SHA256 = "b8b4fe43bdb20c41870785df7aee2e315001cd9dcfd09df3e59ee308437169ec"
EXPECTED_POSE_CONTRACT_SHA256 = "8c192d6814505dd9699cc067611fa7137944605dc36f1133a4d10d43b57a8138"

VALIDATION_FORMAT = "animated-fabric.macaw-deformation-validation.v1"
VALIDATION_SCHEMA_VERSION = "0.1.0"
FRAME_SIZE = (256, 256)
RENDER_ENGINE = "BLENDER_EEVEE_NEXT"
RENDER_SAMPLES = 8
CAMERA_TARGET = (0.0, 0.0, 1.02)
CAMERA_ORTHO_SCALE = 2.75
CAMERA_DISTANCE = 5.0
VIEW_ORDER = ("front", "left", "back", "right")
VIEW_LOCATIONS: Mapping[str, tuple[float, float, float]] = {
    "front": (0.0, CAMERA_DISTANCE, CAMERA_TARGET[2]),
    "left": (-CAMERA_DISTANCE, 0.0, CAMERA_TARGET[2]),
    "back": (0.0, -CAMERA_DISTANCE, CAMERA_TARGET[2]),
    "right": (CAMERA_DISTANCE, 0.0, CAMERA_TARGET[2]),
}
MAX_FRAME_BYTES = 2 * 1024 * 1024
MAX_EVIDENCE_BYTES = 32 * 1024 * 1024
GROUND_TOLERANCE_M = 0.0002
REST_TOLERANCE_M = 0.0001


@dataclass(frozen=True, slots=True)
class PoseGeometry:
    bounds_m: dict[str, list[float]]
    geometry_sha256: str
    max_vertex_displacement_m: float
    maximum_displacement_by_bone_m: dict[str, float]
    minimum_z_by_bone_m: dict[str, float]
    minimum_z_m: float
    topology: dict[str, int]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_json(path: Path, payload: Mapping[str, object]) -> None:
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
) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = (1.0, 0.96, 0.9)
    light = bpy.data.objects.new(name=name, object_data=data)
    bpy.context.collection.objects.link(light)
    light.location = location
    _look_at(light, CAMERA_TARGET)


def _configure_scene(scene: bpy.types.Scene) -> bpy.types.Object:
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
    scene.eevee.taa_render_samples = RENDER_SAMPLES
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    world = bpy.data.worlds.new("AF056World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        raise RuntimeError("Blender did not create the AF-056 world background node.")
    background.inputs["Color"].default_value = (0.045, 0.045, 0.045, 1.0)
    background.inputs["Strength"].default_value = 0.48
    scene.world = world

    camera_data = bpy.data.cameras.new("AF056Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = CAMERA_ORTHO_SCALE
    camera = bpy.data.objects.new("AF056Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    for index, location in enumerate(
        ((4.2, 4.2, 5.2), (-4.2, 4.2, 5.2), (-4.2, -4.2, 5.2), (4.2, -4.2, 5.2))
    ):
        _add_area_light(f"AF056Light{index + 1}", location, 360.0, 4.0)
    return camera


def _objects(value: object, label: str) -> tuple[Mapping[str, object], ...]:
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise RuntimeError(f"Verified AF-056 mapping {label} is malformed.")
    return tuple(value)


def _string(record: Mapping[str, object], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str):
        raise RuntimeError(f"Verified AF-056 mapping {key} is malformed.")
    return value


def _vector3(record: Mapping[str, object], key: str) -> tuple[float, float, float]:
    value = record.get(key)
    if (
        not isinstance(value, list)
        or len(value) != 3
        or any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value)
    ):
        raise RuntimeError(f"Verified AF-056 mapping {key} is malformed.")
    result = (float(value[0]), float(value[1]), float(value[2]))
    if not all(math.isfinite(item) for item in result):
        raise RuntimeError(f"Verified AF-056 mapping {key} is non-finite.")
    return result


def _rest_world_translation(record: Mapping[str, object]) -> tuple[float, float, float]:
    value = record.get("rest_world_matrix_actor")
    if (
        not isinstance(value, list)
        or len(value) != 16
        or any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value)
    ):
        raise RuntimeError("Verified AF-056 rest-world matrix is malformed.")
    result = (float(value[3]), float(value[7]), float(value[11]))
    if not all(math.isfinite(item) for item in result):
        raise RuntimeError("Verified AF-056 rest-world translation is non-finite.")
    return result


def _mapping_records(mapping: Mapping[str, object]) -> dict[str, Mapping[str, object]]:
    root = mapping.get("root")
    if not isinstance(root, dict):
        raise RuntimeError("Verified AF-056 mapping root is malformed.")
    records = (root, *_objects(mapping.get("joints"), "joints"))
    result = {_string(record, "bone_id"): record for record in records}
    if tuple(result) != avian_contract.BONE_ORDER:
        raise RuntimeError("Verified AF-056 mapping bone order is not canonical.")
    return result


def _world_point(obj: bpy.types.Object, point: Vector) -> tuple[float, float, float]:
    world = obj.matrix_world @ point
    result = (float(world[0]), float(world[1]), float(world[2]))
    if not all(math.isfinite(item) for item in result):
        raise RuntimeError("AF-056 imported geometry contains a non-finite coordinate.")
    return result


def _distance(left: Sequence[float], right: Sequence[float]) -> float:
    return math.sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(left, right, strict=True)))


def _matrix_distance(left: Matrix, right: Matrix) -> float:
    return max(
        abs(float(left[row][column]) - float(right[row][column]))
        for row in range(4)
        for column in range(4)
    )


def _assert_imported_avian(
    mapping: Mapping[str, object],
) -> tuple[
    bpy.types.Object, tuple[bpy.types.Object, ...], dict[str, list[tuple[float, float, float]]]
]:
    armatures = tuple(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    meshes = tuple(
        sorted((obj for obj in bpy.data.objects if obj.type == "MESH"), key=lambda item: item.name)
    )
    if len(armatures) != 1 or not meshes:
        raise RuntimeError("AF-056 requires exactly one imported armature and visible geometry.")
    armature = armatures[0]
    records = _mapping_records(mapping)
    actor_root = bpy.data.objects.get(avian_contract.ACTOR_ROOT_BONE_ID)
    if (
        actor_root is None
        or actor_root.as_pointer() != armature.as_pointer()
        or _matrix_distance(actor_root.matrix_world, Matrix.Identity(4)) > REST_TOLERANCE_M
    ):
        raise RuntimeError("Blender imported a non-identity AF-056 actor root armature.")
    bones = tuple(armature.data.bones)
    if tuple(bone.name for bone in bones) != avian_contract.BONE_ORDER[1:]:
        raise RuntimeError("Blender imported avian bones outside canonical order.")
    for bone in bones:
        expected_parent = avian_contract.PARENT_BY_BONE[bone.name]
        imported_parent = None if bone.parent is None else bone.parent.name
        if imported_parent != (None if expected_parent == "root" else expected_parent):
            raise RuntimeError(f"Blender imported an invalid parent for {bone.name}.")
        expected_world = _rest_world_translation(records[bone.name])
        actual_world = _world_point(armature, bone.head_local)
        if _distance(actual_world, expected_world) > REST_TOLERANCE_M:
            raise RuntimeError(f"Blender rest position disagrees with mapping for {bone.name}.")

    expected_coverage = {
        _string(record, "bone_id"): record.get("positive_vertex_count")
        for record in _objects(mapping.get("weight_coverage"), "weight_coverage")
    }
    if set(expected_coverage) != set(avian_contract.BONE_ORDER[1:]) or any(
        not isinstance(value, int) or isinstance(value, bool) or value <= 0
        for value in expected_coverage.values()
    ):
        raise RuntimeError("Verified AF-056 weight coverage is malformed.")

    coverage = {bone_id: 0 for bone_id in avian_contract.BONE_ORDER[1:]}
    records_for_digest: list[bytes] = []
    rest_by_bone: dict[str, list[tuple[float, float, float]]] = {
        bone_id: [] for bone_id in avian_contract.BONE_ORDER[1:]
    }
    for mesh in meshes:
        group_by_index = {group.index: group.name for group in mesh.vertex_groups}
        if set(group_by_index.values()) != set(avian_contract.BONE_ORDER[1:]):
            raise RuntimeError("Blender imported vertex groups outside canonical avian_v1.")
        for vertex in mesh.data.vertices:
            point = _world_point(mesh, vertex.co)
            influences: list[tuple[str, float]] = []
            for element in vertex.groups:
                weight = float(element.weight)
                if weight <= 0.0:
                    continue
                bone_id = group_by_index.get(element.group)
                if bone_id is None:
                    raise RuntimeError("Blender imported an unknown avian vertex group.")
                coverage[bone_id] += 1
                rest_by_bone[bone_id].append(point)
                influences.append((bone_id, weight))
            records_for_digest.append(avian_contract._skin_record(point, influences))
    if coverage != expected_coverage:
        raise RuntimeError("Blender imported avian weight coverage disagrees with the mapping.")
    expected_digest = mapping.get("vertex_skin_sha256")
    observed_digest = avian_contract.vertex_skin_sha256(records_for_digest)
    if not isinstance(expected_digest, str) or observed_digest != expected_digest:
        raise RuntimeError(
            "Blender imported vertex/skin data disagrees with the mapping: "
            f"observed={observed_digest}, expected={expected_digest}."
        )
    return armature, meshes, rest_by_bone


def _rotation_by_bone(pose: avian_contract.ReviewPose) -> dict[str, tuple[float, float, float]]:
    return {rotation.bone_id: rotation.local_euler_xyz_deg for rotation in pose.rotations}


def _apply_pose(
    armature: bpy.types.Object,
    mapping: Mapping[str, object],
    pose: avian_contract.ReviewPose,
) -> None:
    records = _mapping_records(mapping)
    rotations = _rotation_by_bone(pose)
    desired_world: dict[str, Matrix] = {"root": Matrix.Identity(4)}
    armature_world_inverse = armature.matrix_world.inverted_safe()
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    expected_bone_world: dict[str, Matrix] = {}
    for bone_id in avian_contract.BONE_ORDER[1:]:
        parent_id = avian_contract.PARENT_BY_BONE[bone_id]
        if parent_id is None:
            raise RuntimeError("Canonical avian skin joint has no parent.")
        local_translation = _vector3(records[bone_id], "rest_local_translation_m")
        degrees = rotations.get(bone_id, (0.0, 0.0, 0.0))
        rotation = (
            Euler(tuple(math.radians(value) for value in degrees), "XYZ").to_matrix().to_4x4()
        )
        desired = (
            desired_world[parent_id] @ Matrix.Translation(Vector(local_translation)) @ rotation
        )
        desired_world[bone_id] = desired

        data_bone = armature.data.bones[bone_id]
        rest_world_translation = _rest_world_translation(records[bone_id])
        rest_node_world = Matrix.Translation(Vector(rest_world_translation))
        rest_bone_world = armature.matrix_world @ data_bone.matrix_local
        orientation_offset = rest_node_world.inverted_safe() @ rest_bone_world
        target_world = desired @ orientation_offset
        expected_bone_world[bone_id] = target_world
        armature.pose.bones[bone_id].matrix = armature_world_inverse @ target_world
        bpy.context.view_layer.update()
        immediate_world = armature.matrix_world @ armature.pose.bones[bone_id].matrix
        immediate_difference = _matrix_distance(immediate_world, target_world)
        if immediate_difference > REST_TOLERANCE_M:
            raise RuntimeError(
                f"Blender immediately rejected the canonical {bone_id} pose matrix in "
                f"{pose.pose_id}: maximum component delta={immediate_difference}; "
                f"expected={[[float(value) for value in row] for row in target_world]}; "
                f"actual={[[float(value) for value in row] for row in immediate_world]}."
            )
    bpy.context.view_layer.update()
    for bone_id, expected_world in expected_bone_world.items():
        actual_world = armature.matrix_world @ armature.pose.bones[bone_id].matrix
        difference = _matrix_distance(actual_world, expected_world)
        if difference > REST_TOLERANCE_M:
            raise RuntimeError(
                f"Blender did not apply the canonical {bone_id} pose matrix: "
                f"maximum component delta={difference}."
            )


def _topology(meshes: Sequence[bpy.types.Mesh]) -> dict[str, int]:
    vertices = indices = triangles = 0
    for mesh in meshes:
        if any(polygon.loop_total != 3 for polygon in mesh.polygons):
            raise RuntimeError("AF-056 evaluated topology is not triangular.")
        mesh.calc_loop_triangles()
        if len(mesh.loop_triangles) != len(mesh.polygons):
            raise RuntimeError("AF-056 evaluated triangulation is inconsistent.")
        vertices += len(mesh.vertices)
        indices += len(mesh.loops)
        triangles += len(mesh.polygons)
    return {"indices": indices, "triangles": triangles, "vertices": vertices}


def _rounded_bounds(points: Sequence[tuple[float, float, float]]) -> dict[str, list[float]]:
    if not points:
        raise RuntimeError("AF-056 pose contains no evaluated vertices.")
    return {
        "max": [round(max(point[axis] for point in points), 5) for axis in range(3)],
        "min": [round(min(point[axis] for point in points), 5) for axis in range(3)],
    }


def _evaluate_pose(
    meshes: Sequence[bpy.types.Object],
    rest_by_bone: Mapping[str, Sequence[tuple[float, float, float]]],
    expected_topology: Mapping[str, int],
) -> PoseGeometry:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    evaluated_objects: list[bpy.types.Object] = []
    evaluated_meshes: list[bpy.types.Mesh] = []
    all_points: list[tuple[float, float, float]] = []
    points_by_bone: dict[str, list[tuple[float, float, float]]] = {
        bone_id: [] for bone_id in avian_contract.BONE_ORDER[1:]
    }
    try:
        for source in meshes:
            evaluated_object = source.evaluated_get(depsgraph)
            evaluated_mesh = evaluated_object.to_mesh(
                preserve_all_data_layers=False,
                depsgraph=depsgraph,
            )
            if len(evaluated_mesh.vertices) != len(source.data.vertices):
                raise RuntimeError("AF-056 deformation changed vertex correspondence.")
            evaluated_objects.append(evaluated_object)
            evaluated_meshes.append(evaluated_mesh)
            group_by_index = {group.index: group.name for group in source.vertex_groups}
            for source_vertex, vertex in zip(
                source.data.vertices, evaluated_mesh.vertices, strict=True
            ):
                point = _world_point(evaluated_object, vertex.co)
                all_points.append(point)
                for element in source_vertex.groups:
                    if element.weight > 0.0:
                        points_by_bone[group_by_index[element.group]].append(point)
        topology = _topology(evaluated_meshes)
        if topology != expected_topology:
            raise RuntimeError("AF-056 deformation changed the verified topology.")
    finally:
        for evaluated_object in evaluated_objects:
            evaluated_object.to_mesh_clear()

    maximum_by_bone: dict[str, float] = {}
    all_displacements: list[float] = []
    for bone_id in avian_contract.BONE_ORDER[1:]:
        rest = rest_by_bone[bone_id]
        posed = points_by_bone[bone_id]
        if len(rest) != len(posed) or not posed:
            raise RuntimeError(f"AF-056 lost weighted vertices for {bone_id}.")
        displacements = [_distance(left, right) for left, right in zip(rest, posed, strict=True)]
        maximum_by_bone[bone_id] = max(displacements)
        all_displacements.extend(displacements)
    minimum_by_bone = {
        bone_id: min(point[2] for point in points) for bone_id, points in points_by_bone.items()
    }
    geometry_digest = hashlib.sha256()
    for point in all_points:
        geometry_digest.update(struct.pack("<fff", *point))
    return PoseGeometry(
        bounds_m=_rounded_bounds(all_points),
        geometry_sha256=geometry_digest.hexdigest(),
        max_vertex_displacement_m=max(all_displacements),
        maximum_displacement_by_bone_m=maximum_by_bone,
        minimum_z_by_bone_m=minimum_by_bone,
        minimum_z_m=min(point[2] for point in all_points),
        topology=topology,
    )


def _assert_pose_geometry(pose: avian_contract.ReviewPose, geometry: PoseGeometry) -> None:
    if geometry.minimum_z_m < -GROUND_TOLERANCE_M:
        raise RuntimeError(f"AF-056 {pose.pose_id} pose penetrates the ground plane.")
    planted = ("foot_l", "foot_r") if pose.pose_id != "limb-extreme" else ("foot_r",)
    for bone_id in planted:
        if abs(geometry.minimum_z_by_bone_m[bone_id]) > GROUND_TOLERANCE_M:
            raise RuntimeError(f"AF-056 {pose.pose_id} loses planted contact at {bone_id}.")
    if pose.pose_id == "neutral":
        if geometry.max_vertex_displacement_m > REST_TOLERANCE_M:
            raise RuntimeError("AF-056 neutral pose does not preserve the bind geometry.")
        return
    if geometry.max_vertex_displacement_m < 0.02:
        raise RuntimeError(f"AF-056 {pose.pose_id} does not exercise visible deformation.")
    for rotation in pose.rotations:
        if geometry.maximum_displacement_by_bone_m[rotation.bone_id] < 0.002:
            raise RuntimeError(
                f"AF-056 {pose.pose_id} does not deform weighted {rotation.bone_id} geometry."
            )
    fixed_feet = ("foot_r",) if pose.pose_id == "limb-extreme" else ("foot_l", "foot_r")
    for bone_id in fixed_feet:
        if geometry.maximum_displacement_by_bone_m[bone_id] > REST_TOLERANCE_M:
            raise RuntimeError(f"AF-056 {pose.pose_id} unexpectedly moves {bone_id}.")


def _decode_render(path: Path) -> dict[str, object]:
    with path.open("rb") as stream:
        header = stream.read(26)
    if len(header) != 26 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise RuntimeError("AF-056 review output is not a PNG with IHDR.")
    width, height, depth, color_type = struct.unpack(">IIBB", header[16:26])
    if (width, height) != FRAME_SIZE or depth != 8 or color_type != 6:
        raise RuntimeError("AF-056 review output is not canonical 256x256 RGBA8.")
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        pixels = array("f", [0.0]) * (width * height * 4)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    alpha = pixels[3::4]
    opaque = [index for index, value in enumerate(alpha) if value > 1e-6]
    if not opaque:
        raise RuntimeError("AF-056 review render is fully transparent.")
    xs = [index % width for index in opaque]
    ys = [index // width for index in opaque]
    bounds = [min(xs), height - 1 - max(ys), max(xs), height - 1 - min(ys)]
    if bounds[0] <= 0 or bounds[1] <= 0 or bounds[2] >= width - 1 or bounds[3] >= height - 1:
        raise RuntimeError("AF-056 review render touches a frame edge.")
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
        "avian_contract.py",
        "evidence.py",
        "output_paths.py",
        "png_canonical.py",
        "render_actor_package.py",
        "render_macaw_actor_review.py",
        "contracts/avian_v1.json",
        "contracts/af056_review_poses.json",
        "container.Dockerfile",
        "compose.yaml",
    )
    return {name: _sha256(_TRUSTED_SCRIPT_ROOT / name) for name in names}


def _assert_runtime_network_isolated() -> None:
    interfaces = {name for _, name in socket.if_nameindex()}
    if not interfaces or interfaces - {"lo"}:
        raise RuntimeError("AF-056 actor review requires a loopback-only network namespace.")


def _geometry_document(
    pose: avian_contract.ReviewPose, geometry: PoseGeometry
) -> dict[str, object]:
    return {
        "bounds_m": geometry.bounds_m,
        "geometry_sha256": geometry.geometry_sha256,
        "max_vertex_displacement_m": geometry.max_vertex_displacement_m,
        "maximum_displacement_by_bone_m": geometry.maximum_displacement_by_bone_m,
        "minimum_z_by_bone_m": geometry.minimum_z_by_bone_m,
        "minimum_z_m": geometry.minimum_z_m,
        "rotations": [
            {
                "bone_id": rotation.bone_id,
                "local_euler_xyz_deg": list(rotation.local_euler_xyz_deg),
            }
            for rotation in pose.rotations
        ],
        "topology": geometry.topology,
    }


def _assert_no_authored_behavior() -> None:
    if bpy.data.actions:
        raise RuntimeError("AF-056 diagnostic posing created an action.")
    for obj in bpy.data.objects:
        base_worker._assert_no_animation_data(obj, f"object {obj.name}")
        if obj.type == "ARMATURE" and any(bone.constraints for bone in obj.pose.bones):
            raise RuntimeError("AF-056 diagnostic posing created a pose-bone constraint.")


def _render_stage(stage: Path) -> None:
    if bpy.app.version_string != evidence.BLENDER_VERSION:
        raise RuntimeError("Blender runtime version disagrees with the pinned AF-056 contract.")
    if platform.system() != "Linux" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("AF-056 deformation evidence requires Linux x86-64.")
    _assert_runtime_network_isolated()
    rig = avian_contract.load_rig_contract()
    poses = avian_contract.load_review_poses()
    if rig.sha256 != EXPECTED_RIG_CONTRACT_SHA256:
        raise RuntimeError("The baked avian_v1 contract is not the pinned AF-056 contract.")
    if poses.sha256 != EXPECTED_POSE_CONTRACT_SHA256:
        raise RuntimeError("The baked deformation poses are not the pinned AF-056 contract.")
    if _sha256(MAPPING_PATH) != EXPECTED_MAPPING_SHA256:
        raise RuntimeError("The baked avian mapping is not the pinned AF-056 mapping.")

    actor_package.assert_linux_read_only_mount(ACTOR_INPUT_ROOT)
    with actor_package.private_verified_snapshot(
        ACTOR_INPUT_ROOT,
        Path("/tmp"),
        expected_manifest_sha256=EXPECTED_MANIFEST_SHA256,
    ) as verified:
        mapping, mapping_sha256 = avian_contract.verify_mapping_document(
            MAPPING_PATH, verified, rig
        )
        if mapping_sha256 != EXPECTED_MAPPING_SHA256:
            raise RuntimeError("Fresh AF-056 mapping verification changed its identity.")

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
            raise RuntimeError("Blender did not finish importing the verified AF-056 actor.")
        try:
            imported = base_worker._post_import_gate(verified)
        except RuntimeError as error:
            debug_meshes = tuple(obj for obj in bpy.data.objects if obj.type == "MESH")
            debug_points = [
                point
                for mesh in debug_meshes
                for point in base_worker._world_coordinates(mesh, mesh.data)
            ]
            raise RuntimeError(
                f"{error} AF-056 source bounds={_rounded_bounds(debug_points)}, "
                f"declared={verified.observations.get('actor_bounds_m')}."
            ) from error
        armature, meshes, rest_by_bone = _assert_imported_avian(mapping)
        expected_topology = {
            key: int(verified.observations[key]) for key in ("indices", "triangles", "vertices")
        }

        scene = bpy.context.scene
        camera = _configure_scene(scene)
        geometries: dict[str, PoseGeometry] = {}
        for pose in poses.poses:
            _apply_pose(armature, mapping, pose)
            geometry = _evaluate_pose(meshes, rest_by_bone, expected_topology)
            _assert_pose_geometry(pose, geometry)
            geometries[pose.pose_id] = geometry

        frames: list[dict[str, object]] = []
        deformation = {
            pose.pose_id: _geometry_document(pose, geometries[pose.pose_id]) for pose in poses.poses
        }
        frame_hashes: dict[str, str] = {}
        total_frame_bytes = 0
        for pose in poses.poses:
            _apply_pose(armature, mapping, pose)
            for view_id in VIEW_ORDER:
                camera.location = VIEW_LOCATIONS[view_id]
                _look_at(camera, CAMERA_TARGET)
                destination = stage / f"{pose.pose_id}--{view_id}.png"
                scene.render.filepath = str(destination)
                bpy.ops.render.render(write_still=True)
                if not destination.is_file():
                    raise RuntimeError("Blender did not produce an AF-056 deformation frame.")
                canonicalize_rgba_png(destination, expected_size=FRAME_SIZE)
                observations = _decode_render(destination)
                size = destination.stat().st_size
                if size > MAX_FRAME_BYTES:
                    raise RuntimeError("AF-056 deformation frame exceeds its byte ceiling.")
                digest = _sha256(destination)
                frame_hashes[destination.name] = digest
                total_frame_bytes += size
                frames.append(
                    {
                        "bytes": size,
                        "camera_location": list(VIEW_LOCATIONS[view_id]),
                        "path": destination.name,
                        "pose_id": pose.pose_id,
                        "sha256": digest,
                        "view_id": view_id,
                        **observations,
                    }
                )

        expected_frame_count = len(avian_contract.POSE_ORDER) * len(VIEW_ORDER)
        if len(frames) != expected_frame_count or set(frame_hashes) != {
            f"{pose_id}--{view_id}.png"
            for pose_id in avian_contract.POSE_ORDER
            for view_id in VIEW_ORDER
        }:
            raise RuntimeError("AF-056 deformation evidence file set is not exact.")
        if total_frame_bytes > MAX_EVIDENCE_BYTES:
            raise RuntimeError("AF-056 deformation evidence exceeds its byte ceiling.")
        _assert_no_authored_behavior()

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
                "image": "caatuu-animated-fabric-blender-macaw-actor-validator:4.5.12",
                "input_mount": "read-only",
                "platform": evidence.CONTAINER_PLATFORM,
                "private_snapshot": True,
                "runtime_network": "none",
            },
            "deformation": deformation,
            "format": VALIDATION_FORMAT,
            "imported": imported,
            "outputs": {
                "frame_count": len(frames),
                "frame_sha256": frame_hashes,
                "frame_total_bytes": total_frame_bytes,
                "max_evidence_bytes": MAX_EVIDENCE_BYTES,
                "max_frame_bytes": MAX_FRAME_BYTES,
            },
            "package": {
                "content_set_sha256": verified.content_set_sha256,
                "expected_manifest_sha256": EXPECTED_MANIFEST_SHA256,
                "files": package_files,
                "id": verified.actor_id,
                "manifest_sha256": verified.manifest_sha256,
                "observed": dict(verified.observations),
            },
            "reference": {
                "approval_sha256": avian_contract.REFERENCE_APPROVAL_SHA256,
                "manifest_sha256": avian_contract.REFERENCE_MANIFEST_SHA256,
                "ordered_view_set_sha256": avian_contract.REFERENCE_VIEW_SET_SHA256,
                "package_id": avian_contract.REFERENCE_PACKAGE_ID,
                "source_approval_sha256": avian_contract.REFERENCE_SOURCE_APPROVAL_SHA256,
            },
            "review": {
                "camera_orthographic_scale": CAMERA_ORTHO_SCALE,
                "camera_target": list(CAMERA_TARGET),
                "frame_size": list(FRAME_SIZE),
                "frames": frames,
                "pose_contract_sha256": poses.sha256,
                "pose_order": list(avian_contract.POSE_ORDER),
                "transparent": True,
                "view_order": list(VIEW_ORDER),
            },
            "rig": {
                "contract_sha256": rig.sha256,
                "id": avian_contract.RIG_ID,
                "mapping_sha256": mapping_sha256,
                "vertex_skin_sha256": mapping["vertex_skin_sha256"],
            },
            "schema_version": VALIDATION_SCHEMA_VERSION,
            "ticket": "AF-056",
            "trusted_sources": _trusted_source_hashes(),
        }
        _write_json(stage / "validation.json", validation)
        if sum(path.stat().st_size for path in stage.iterdir()) > MAX_EVIDENCE_BYTES:
            raise RuntimeError("Complete AF-056 evidence exceeds its byte ceiling.")


def _resolve_output(raw_output: Path) -> tuple[Path, Path]:
    return resolve_output_path(raw_output, Path(os.environ.get(OUTPUT_ROOT_ENV, "/output")))


def _publish(output_root: Path, destination: Path) -> None:
    stage = Path(tempfile.mkdtemp(prefix=".af056-review-stage-", dir=output_root))
    backup: Path | None = None
    try:
        _render_stage(stage)
        if destination.exists():
            if not destination.is_dir():
                raise ValueError("Existing AF-056 output destination must be a directory.")
            backup = Path(tempfile.mkdtemp(prefix=".af056-review-backup-", dir=output_root))
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
        description="Validate and render the pinned AF-056 skinned macaw deformation review."
    )
    parser.add_argument("--out", required=True, type=Path, help="Child of the fixed output root.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    output_root, destination = _resolve_output(arguments.out)
    _publish(output_root, destination)
    print(f"AF-056 validated and rendered the pinned skinned macaw to {destination}.")
    return 0


if __name__ == "__main__":
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    raise SystemExit(main(sys.argv[separator + 1 :]))
