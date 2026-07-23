"""Render four fixed views of one verified AF-045 reconstruction proposal."""

from __future__ import annotations

import argparse
import math
import os
import platform
import shutil
import socket
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path

import bpy
from mathutils import Vector

_TRUSTED_SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_TRUSTED_SCRIPT_ROOT))

import actor_package  # noqa: E402
import evidence  # noqa: E402
import reconstruction_candidate_review as contract  # noqa: E402
from output_paths import resolve_output_path  # noqa: E402
from png_canonical import canonicalize_rgba_png  # noqa: E402

CANDIDATE_ROOT = Path("/candidate")
OUTPUT_ROOT_ENV = "ANIMATED_FABRIC_BLENDER_OUTPUT_ROOT"
FRAME_SIZE = (512, 512)
RENDER_ENGINE = "BLENDER_EEVEE_NEXT"
RENDER_SAMPLES = 16
MAX_FRAME_BYTES = 8 * 1024 * 1024
MAX_REVIEW_BYTES = 40 * 1024 * 1024
CONTAINER_IMAGE = "caatuu-animated-fabric-blender:4.5.12-cycles-cpu"


def _rounded(values: Sequence[float]) -> list[float]:
    return [round(float(value), 8) for value in values]


def _look_at(
    obj: bpy.types.Object,
    target: tuple[float, float, float],
) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _assert_runtime_network_isolated() -> None:
    interfaces = {name for _, name in socket.if_nameindex()}
    if not interfaces or interfaces - {"lo"}:
        raise RuntimeError("AF-045 candidate review requires a loopback-only network namespace.")


def _world_geometry(
    meshes: Sequence[bpy.types.Object],
) -> tuple[tuple[float, float, float], tuple[float, float, float], int, int]:
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    vertex_count = 0
    triangle_count = 0
    for obj in meshes:
        mesh = obj.data
        if not isinstance(mesh, bpy.types.Mesh):
            raise RuntimeError("AF-045 imported a non-mesh data block as review geometry.")
        mesh.calc_loop_triangles()
        vertex_count += len(mesh.vertices)
        triangle_count += len(mesh.loop_triangles)
        for vertex in mesh.vertices:
            point = obj.matrix_world @ vertex.co
            if not all(math.isfinite(float(point[index])) for index in range(3)):
                raise RuntimeError("AF-045 imported non-finite candidate geometry.")
            for index in range(3):
                value = float(point[index])
                minimum[index] = min(minimum[index], value)
                maximum[index] = max(maximum[index], value)
    if vertex_count == 0 or triangle_count == 0:
        raise RuntimeError("AF-045 candidate contains no renderable geometry.")
    return (
        (minimum[0], minimum[1], minimum[2]),
        (maximum[0], maximum[1], maximum[2]),
        vertex_count,
        triangle_count,
    )


def _assign_vertex_color_materials(
    meshes: Sequence[bpy.types.Object],
) -> dict[str, str]:
    color_attributes: dict[str, str] = {}
    for index, obj in enumerate(meshes):
        mesh = obj.data
        if not isinstance(mesh, bpy.types.Mesh):
            raise RuntimeError("AF-045 cannot assign a material to non-mesh data.")
        attributes = tuple(mesh.color_attributes)
        if len(attributes) != 1:
            raise RuntimeError(
                f"AF-045 mesh {obj.name!r} must expose exactly one vertex-color attribute."
            )
        attribute = attributes[0]
        if attribute.domain not in {"POINT", "CORNER"}:
            raise RuntimeError(
                f"AF-045 mesh {obj.name!r} uses an unsupported color-attribute domain."
            )
        if attribute.data_type not in {"BYTE_COLOR", "FLOAT_COLOR"} or len(attribute.data) == 0:
            raise RuntimeError(
                f"AF-045 mesh {obj.name!r} uses an unsupported or empty color attribute."
            )

        material = bpy.data.materials.new(name=f"AF045VertexColor{index + 1}")
        material.use_nodes = True
        if material.node_tree is None:
            raise RuntimeError("Blender did not create the AF-045 material node tree.")
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        output = nodes.new(type="ShaderNodeOutputMaterial")
        shader = nodes.new(type="ShaderNodeBsdfPrincipled")
        vertex_color = nodes.new(type="ShaderNodeVertexColor")
        vertex_color.layer_name = attribute.name
        shader.inputs["Roughness"].default_value = 0.72
        links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        mesh.materials.clear()
        mesh.materials.append(material)
        color_attributes[obj.name] = attribute.name
    return color_attributes


def _assert_import_subset() -> tuple[bpy.types.Object, ...]:
    if bpy.data.actions or bpy.data.armatures or bpy.data.cameras or bpy.data.lights:
        raise RuntimeError("AF-045 candidate GLB contains authored behavior or scene equipment.")
    if bpy.data.images or bpy.data.textures:
        raise RuntimeError("AF-045 candidate GLB must use vertex colors, not image textures.")
    unsupported = tuple(obj.name for obj in bpy.data.objects if obj.type not in {"EMPTY", "MESH"})
    if unsupported:
        raise RuntimeError("AF-045 candidate GLB contains unsupported object types.")
    meshes = tuple(obj for obj in bpy.data.objects if obj.type == "MESH")
    if not meshes:
        raise RuntimeError("AF-045 candidate GLB contains no mesh objects.")
    return meshes


def _add_area_light(
    name: str,
    location: tuple[float, float, float],
    target: tuple[float, float, float],
    *,
    energy: float,
    size: float,
) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = (1.0, 0.96, 0.90)
    light = bpy.data.objects.new(name=name, object_data=data)
    bpy.context.collection.objects.link(light)
    light.location = location
    _look_at(light, target)


def _configure_scene(
    scene: bpy.types.Scene,
    framing: contract.Framing,
) -> bpy.types.Object:
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

    world = bpy.data.worlds.new("AF045ReviewWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        raise RuntimeError("Blender did not create the AF-045 world background node.")
    background.inputs["Color"].default_value = (0.035, 0.035, 0.035, 1.0)
    background.inputs["Strength"].default_value = 0.45
    scene.world = world

    camera_data = bpy.data.cameras.new("AF045ReviewCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = framing.ortho_scale
    camera_data.clip_start = framing.clip_start
    camera_data.clip_end = framing.clip_end
    camera = bpy.data.objects.new("AF045ReviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    target = framing.target
    radius = framing.radius
    light_distance = max(radius * 4.0, 0.01)
    light_height = max(radius * 4.5, 0.01)
    light_size = max(radius * 2.5, 0.01)
    light_energy = max(180.0, 700.0 * radius * radius)
    for index, (x_sign, y_sign) in enumerate(((1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0), (1.0, -1.0))):
        location = (
            target[0] + x_sign * light_distance,
            target[1] + y_sign * light_distance,
            target[2] + light_height,
        )
        _add_area_light(
            f"AF045ReviewLight{index + 1}",
            location,
            target,
            energy=light_energy,
            size=light_size,
        )
    return camera


def _render_result_observations() -> dict[str, object]:
    result = bpy.data.images.get("Render Result")
    if result is None or tuple(result.size) != FRAME_SIZE:
        raise RuntimeError("Blender did not retain the expected AF-045 render result.")
    pixels = result.pixels[:]
    expected_values = FRAME_SIZE[0] * FRAME_SIZE[1] * 4
    if len(pixels) != expected_values:
        raise RuntimeError("Blender returned a malformed AF-045 render buffer.")

    minimum_x = FRAME_SIZE[0]
    minimum_y = FRAME_SIZE[1]
    maximum_x = -1
    maximum_y = -1
    visible_pixels = 0
    for pixel_index in range(FRAME_SIZE[0] * FRAME_SIZE[1]):
        if float(pixels[pixel_index * 4 + 3]) <= 0.00001:
            continue
        x = pixel_index % FRAME_SIZE[0]
        y = pixel_index // FRAME_SIZE[0]
        minimum_x = min(minimum_x, x)
        minimum_y = min(minimum_y, y)
        maximum_x = max(maximum_x, x)
        maximum_y = max(maximum_y, y)
        visible_pixels += 1
    if visible_pixels == 0:
        raise RuntimeError("AF-045 candidate review is fully transparent.")
    if (
        minimum_x == 0
        or minimum_y == 0
        or maximum_x == FRAME_SIZE[0] - 1
        or maximum_y == FRAME_SIZE[1] - 1
    ):
        raise RuntimeError("AF-045 candidate review touches a frame edge.")
    return {
        "alpha_bounds_bottom_left": [minimum_x, minimum_y, maximum_x + 1, maximum_y + 1],
        "visible_pixels": visible_pixels,
    }


def _source_hashes() -> dict[str, str]:
    names = (
        "actor_package.py",
        "evidence.py",
        "output_paths.py",
        "png_canonical.py",
        "reconstruction_candidate_review.py",
        "render_reconstruction_candidate.py",
    )
    return {name: contract.sha256_file(_TRUSTED_SCRIPT_ROOT / name) for name in names}


def _write_json(path: Path, document: Mapping[str, object]) -> None:
    path.write_bytes(contract.canonical_json_bytes(document))


def _render_stage(stage: Path, expected_candidate_id: str) -> None:
    if bpy.app.version_string != evidence.BLENDER_VERSION:
        raise RuntimeError("Blender runtime version disagrees with the pinned AF-045 contract.")
    if platform.system() != "Linux" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("AF-045 candidate review requires Linux x86-64.")
    _assert_runtime_network_isolated()
    actor_package.assert_linux_read_only_mount(CANDIDATE_ROOT)
    proposal = contract.verify_candidate(
        CANDIDATE_ROOT,
        expected_candidate_id=expected_candidate_id,
    )

    private_root = Path(tempfile.mkdtemp(prefix=".af045-candidate-", dir="/tmp"))
    private_mesh = private_root / "mesh.glb"
    try:
        shutil.copyfile(proposal.mesh_path, private_mesh)
        private_mesh.chmod(0o400)
        if contract.sha256_file(private_mesh) != proposal.mesh_sha256:
            raise RuntimeError("AF-045 private GLB snapshot changed during copying.")

        bpy.ops.wm.read_factory_settings(use_empty=True)
        result = bpy.ops.import_scene.gltf(
            filepath=str(private_mesh),
            disable_bone_shape=True,
            import_pack_images=False,
            import_scene_extras=False,
            import_unused_materials=False,
            import_webp_texture=False,
            merge_vertices=False,
        )
        if "FINISHED" not in result:
            raise RuntimeError("Blender did not finish importing the AF-045 candidate.")
        meshes = _assert_import_subset()
        minimum, maximum, vertices, triangles = _world_geometry(meshes)
        if vertices != proposal.vertices or triangles != proposal.triangles:
            raise RuntimeError("Imported AF-045 topology disagrees with candidate.json.")
        color_attributes = _assign_vertex_color_materials(meshes)
        framing = contract.framing_from_bounds(minimum, maximum)
        scene = bpy.context.scene
        camera = _configure_scene(scene, framing)

        frames: list[dict[str, object]] = []
        frame_total_bytes = 0
        for view in contract.VIEW_SPECS:
            location = contract.camera_location(framing, view)
            camera.location = location
            _look_at(camera, framing.target)
            destination = stage / f"{view.view_id}.png"
            scene.render.filepath = str(destination)
            bpy.ops.render.render(write_still=True)
            observations = _render_result_observations()
            if not destination.is_file():
                raise RuntimeError("Blender did not publish an AF-045 review frame.")
            canonicalize_rgba_png(destination, expected_size=FRAME_SIZE)
            frame_bytes = destination.stat().st_size
            if not 0 < frame_bytes <= MAX_FRAME_BYTES:
                raise RuntimeError("AF-045 candidate review frame exceeds its byte ceiling.")
            frame_total_bytes += frame_bytes
            frames.append(
                {
                    "bytes": frame_bytes,
                    "camera_direction": _rounded(view.direction),
                    "camera_location": _rounded(location),
                    "path": destination.name,
                    "sha256": contract.sha256_file(destination),
                    "view_id": view.view_id,
                    **observations,
                }
            )

        if (
            contract.verify_candidate(
                CANDIDATE_ROOT,
                expected_candidate_id=expected_candidate_id,
            )
            != proposal
        ):
            raise RuntimeError("AF-045 candidate changed while Blender reviewed its private copy.")
        if frame_total_bytes > MAX_REVIEW_BYTES:
            raise RuntimeError("AF-045 candidate review exceeds its byte ceiling.")

        review: dict[str, object] = {
            "blender": {
                "archive_sha256": evidence.BLENDER_ARCHIVE_SHA256,
                "color_transform": "AgX Medium High Contrast",
                "render_engine": RENDER_ENGINE,
                "samples": RENDER_SAMPLES,
                "threads": 1,
                "version": bpy.app.version_string,
            },
            "candidate": {
                "candidate_id": proposal.candidate_id,
                "input_bytes": proposal.input_bytes,
                "input_sha256": proposal.input_sha256,
                "manifest_sha256": proposal.manifest_sha256,
                "mesh_bytes": proposal.mesh_bytes,
                "mesh_sha256": proposal.mesh_sha256,
                "parameters": {
                    "chunk_size": proposal.chunk_size,
                    "device": "cuda:0",
                    "foreground_ratio": proposal.foreground_ratio,
                    "mc_resolution": proposal.mc_resolution,
                    "vertex_colors": True,
                },
                "provider": dict(proposal.provider),
                "triangles": proposal.triangles,
                "vertices": proposal.vertices,
            },
            "container": {
                "candidate_mount": "read-only",
                "image": CONTAINER_IMAGE,
                "platform": evidence.CONTAINER_PLATFORM,
                "private_mesh_snapshot": True,
                "runtime_network": "none",
            },
            "format": contract.REVIEW_FORMAT,
            "imported": {
                "color_attributes": color_attributes,
                "mesh_objects": len(meshes),
                "triangles": triangles,
                "vertices": vertices,
                "world_bounds": {
                    "maximum": _rounded(maximum),
                    "minimum": _rounded(minimum),
                },
            },
            "review": {
                "camera_distance": round(framing.camera_distance, 8),
                "camera_orthographic_scale": round(framing.ortho_scale, 8),
                "camera_target": _rounded(framing.target),
                "coordinate_frame": {
                    "handedness": "right",
                    "x": "back",
                    "y": "right",
                    "z": "up",
                },
                "frame_count": len(frames),
                "frame_size": list(FRAME_SIZE),
                "frame_total_bytes": frame_total_bytes,
                "frames": frames,
                "transparent": True,
                "view_order": [view.view_id for view in contract.VIEW_SPECS],
            },
            "schema_version": contract.REVIEW_SCHEMA_VERSION,
            "ticket": "AF-045",
            "trusted_sources": _source_hashes(),
        }
        _write_json(stage / "review.json", review)
        total_bytes = sum(path.stat().st_size for path in stage.iterdir())
        if total_bytes > MAX_REVIEW_BYTES:
            raise RuntimeError("Complete AF-045 review exceeds its byte ceiling.")
    finally:
        shutil.rmtree(private_root, ignore_errors=True)


def _publish(
    output_root: Path,
    destination: Path,
    expected_candidate_id: str,
) -> None:
    if destination.exists() or destination.is_symlink():
        raise ValueError("AF-045 review output is immutable; choose a new destination.")
    stage = Path(tempfile.mkdtemp(prefix=".af045-review-stage-", dir=output_root))
    try:
        _render_stage(stage, expected_candidate_id)
        stage.replace(destination)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render four fixed Blender views of one verified AF-045 proposal."
    )
    parser.add_argument(
        "--expected-candidate-id",
        required=True,
        help="Portable candidate ID selected by the bounded host runner.",
    )
    parser.add_argument("--out", required=True, type=Path, help="Child of the fixed output root.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    expected_candidate_id = contract.validate_candidate_id(arguments.expected_candidate_id)
    output_root, destination = resolve_output_path(
        arguments.out,
        Path(os.environ.get(OUTPUT_ROOT_ENV, "/output")),
    )
    _publish(output_root, destination, expected_candidate_id)
    print(f"AF-045 rendered four fixed candidate views to {destination}.")
    return 0


if __name__ == "__main__":
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    raise SystemExit(main(sys.argv[separator + 1 :]))
