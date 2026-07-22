"""Generate the deterministic AF-055 textured and skinned geometric actor package."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import struct
import sys
import tempfile
import zlib
from collections.abc import Mapping, Sequence
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from tools.blender import actor_package  # noqa: E402

PACKAGE_ID = "geometric-fixture-v1"
TEXTURE_ID = "albedo"
TEXTURE_PATH = f"textures/{TEXTURE_ID}.png"
TEXTURE_SIZE = (32, 32)
_REPARSE_ATTRIBUTE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(chunk_type)
    checksum = zlib.crc32(payload, checksum) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", checksum)


def _texture_png() -> bytes:
    width, height = TEXTURE_SIZE
    rows = bytearray()
    colors = ((30, 115, 190, 255), (245, 180, 45, 255))
    for y in range(height):
        rows.append(0)
        for x in range(width):
            color = colors[((x // 8) + (y // 8)) % 2]
            rows.extend(color)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)),
            _png_chunk(b"IEND", b""),
        )
    )


def _actor_to_storage(vector: tuple[float, float, float]) -> tuple[float, float, float]:
    x, forward, up = vector
    return x, up, -forward


def _geometry() -> tuple[
    list[tuple[float, float, float]],
    list[tuple[float, float, float]],
    list[tuple[float, float]],
    list[tuple[int, int, int, int]],
    list[tuple[float, float, float, float]],
    list[int],
]:
    width = 0.4
    depth = 0.25
    height = 1.8
    faces = (
        (
            (
                (-width, depth, 0.0),
                (-width, depth, height),
                (width, depth, height),
                (width, depth, 0.0),
            ),
            (0.0, 1.0, 0.0),
        ),
        (
            (
                (width, -depth, 0.0),
                (width, -depth, height),
                (-width, -depth, height),
                (-width, -depth, 0.0),
            ),
            (0.0, -1.0, 0.0),
        ),
        (
            (
                (width, depth, 0.0),
                (width, depth, height),
                (width, -depth, height),
                (width, -depth, 0.0),
            ),
            (1.0, 0.0, 0.0),
        ),
        (
            (
                (-width, -depth, 0.0),
                (-width, -depth, height),
                (-width, depth, height),
                (-width, depth, 0.0),
            ),
            (-1.0, 0.0, 0.0),
        ),
        (
            (
                (-width, depth, height),
                (-width, -depth, height),
                (width, -depth, height),
                (width, depth, height),
            ),
            (0.0, 0.0, 1.0),
        ),
        (
            (
                (-width, -depth, 0.0),
                (-width, depth, 0.0),
                (width, depth, 0.0),
                (width, -depth, 0.0),
            ),
            (0.0, 0.0, -1.0),
        ),
    )
    positions: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    texcoords: list[tuple[float, float]] = []
    joints: list[tuple[int, int, int, int]] = []
    weights: list[tuple[float, float, float, float]] = []
    indices: list[int] = []
    face_uvs = ((0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0))
    for corners, normal in faces:
        base = len(positions)
        for corner, uv in zip(corners, face_uvs, strict=True):
            positions.append(_actor_to_storage(corner))
            normals.append(_actor_to_storage(normal))
            texcoords.append(uv)
            if corner[2] < height * 0.5:
                joints.append((0, 0, 0, 0))
                weights.append((1.0, 0.0, 0.0, 0.0))
            else:
                joints.append((1, 0, 0, 0))
                weights.append((1.0, 0.0, 0.0, 0.0))
        indices.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    return positions, normals, texcoords, joints, weights, indices


def _pack_rows(format_string: str, rows: Sequence[Sequence[int | float]]) -> bytes:
    packer = struct.Struct("<" + format_string)
    return b"".join(packer.pack(*row) for row in rows)


def _add_buffer_view(
    binary: bytearray,
    views: list[dict[str, int]],
    payload: bytes,
    *,
    target: int | None = None,
) -> int:
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    binary.extend(payload)
    view = {"buffer": 0, "byteLength": len(payload), "byteOffset": offset}
    if target is not None:
        view["target"] = target
    views.append(view)
    return len(views) - 1


def _glb() -> tuple[bytes, int]:
    positions, normals, texcoords, joints, weights, indices = _geometry()
    binary = bytearray()
    views: list[dict[str, int]] = []
    accessors: list[dict[str, object]] = []

    def add_accessor(
        payload: bytes,
        *,
        component_type: int,
        count: int,
        value_type: str,
        target: int | None,
        minimum: list[float] | None = None,
        maximum: list[float] | None = None,
    ) -> int:
        view = _add_buffer_view(binary, views, payload, target=target)
        accessor: dict[str, object] = {
            "bufferView": view,
            "componentType": component_type,
            "count": count,
            "type": value_type,
        }
        if minimum is not None:
            accessor["min"] = minimum
        if maximum is not None:
            accessor["max"] = maximum
        accessors.append(accessor)
        return len(accessors) - 1

    position_accessor = add_accessor(
        _pack_rows("fff", positions),
        component_type=5126,
        count=len(positions),
        value_type="VEC3",
        target=34962,
        minimum=[-0.4, 0.0, -0.25],
        maximum=[0.4, 1.8, 0.25],
    )
    normal_accessor = add_accessor(
        _pack_rows("fff", normals),
        component_type=5126,
        count=len(normals),
        value_type="VEC3",
        target=34962,
    )
    uv_accessor = add_accessor(
        _pack_rows("ff", texcoords),
        component_type=5126,
        count=len(texcoords),
        value_type="VEC2",
        target=34962,
    )
    joint_accessor = add_accessor(
        _pack_rows("BBBB", joints),
        component_type=5121,
        count=len(joints),
        value_type="VEC4",
        target=34962,
    )
    weight_accessor = add_accessor(
        _pack_rows("ffff", weights),
        component_type=5126,
        count=len(weights),
        value_type="VEC4",
        target=34962,
    )
    index_accessor = add_accessor(
        _pack_rows("H", [(index,) for index in indices]),
        component_type=5123,
        count=len(indices),
        value_type="SCALAR",
        target=34963,
    )
    inverse_bind_matrices = (
        (1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        (1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -0.9, 0.0, 1.0),
    )
    inverse_bind_accessor = add_accessor(
        _pack_rows("f" * 16, inverse_bind_matrices),
        component_type=5126,
        count=2,
        value_type="MAT4",
        target=None,
    )
    buffer_length = len(binary)
    while len(binary) % 4:
        binary.append(0)

    document: dict[str, object] = {
        "accessors": accessors,
        "asset": {"generator": "Animated Fabric AF-055 geometric fixture", "version": "2.0"},
        "bufferViews": views,
        "buffers": [{"byteLength": buffer_length}],
        "images": [{"name": "albedo_image", "uri": TEXTURE_PATH}],
        "materials": [
            {
                "alphaMode": "OPAQUE",
                "doubleSided": False,
                "name": "fixture_material",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                    "baseColorTexture": {"index": 0, "texCoord": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.72,
                },
            }
        ],
        "meshes": [
            {
                "name": "fixture_mesh",
                "primitives": [
                    {
                        "attributes": {
                            "JOINTS_0": joint_accessor,
                            "NORMAL": normal_accessor,
                            "POSITION": position_accessor,
                            "TEXCOORD_0": uv_accessor,
                            "WEIGHTS_0": weight_accessor,
                        },
                        "indices": index_accessor,
                        "material": 0,
                        "mode": 4,
                    }
                ],
            }
        ],
        "nodes": [
            {"children": [1, 2], "name": "actor_root"},
            {"mesh": 0, "name": "fixture_mesh_node", "skin": 0},
            {"children": [3], "name": "joint_root"},
            {"name": "joint_tip", "translation": [0.0, 0.9, 0.0]},
        ],
        "samplers": [
            {
                "magFilter": 9729,
                "minFilter": 9987,
                "name": "albedo_sampler",
                "wrapS": 10497,
                "wrapT": 10497,
            }
        ],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "skins": [
            {
                "inverseBindMatrices": inverse_bind_accessor,
                "joints": [2, 3],
                "name": "fixture_skin",
                "skeleton": 2,
            }
        ],
        "textures": [{"name": "albedo_texture", "sampler": 0, "source": 0}],
    }
    json_payload = json.dumps(
        document, allow_nan=False, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    json_payload += b" " * ((-len(json_payload)) % 4)
    total_length = 12 + 8 + len(json_payload) + 8 + len(binary)
    glb = b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total_length),
            struct.pack("<II", len(json_payload), 0x4E4F534A),
            json_payload,
            struct.pack("<II", len(binary), 0x004E4942),
            bytes(binary),
        )
    )
    return glb, buffer_length


def _manifest(glb: bytes, texture: bytes, buffer_length: int) -> dict[str, object]:
    generator_path = Path(__file__).resolve()
    generator_sha256 = actor_package.sha256_bytes(generator_path.read_bytes())
    asset: dict[str, object] = {
        "bytes": len(glb),
        "media_type": "model/gltf-binary",
        "path": actor_package.GLB_FILENAME,
        "sha256": actor_package.sha256_bytes(glb),
    }
    texture_record: dict[str, object] = {
        "bytes": len(texture),
        "height_px": TEXTURE_SIZE[1],
        "id": TEXTURE_ID,
        "media_type": "image/png",
        "mode": "RGBA8",
        "path": TEXTURE_PATH,
        "sha256": actor_package.sha256_bytes(texture),
        "width_px": TEXTURE_SIZE[0],
    }
    content_records: list[Mapping[str, object]] = [asset, texture_record]
    observed: dict[str, object] = {
        "accessors": 7,
        "actor_bounds_m": {"max": [0.4, 0.25, 1.8], "min": [-0.4, -0.25, 0.0]},
        "buffer_bytes": buffer_length,
        "buffer_views": 7,
        "content_bytes": len(glb) + len(texture),
        "content_files": 2,
        "images": 1,
        "indices": 36,
        "joints": 2,
        "materials": 1,
        "max_influences_per_vertex": 1,
        "meshes": 1,
        "nodes": 4,
        "primitives": 1,
        "root_node_index": 0,
        "samplers": 1,
        "skins": 1,
        "texture_pixels": TEXTURE_SIZE[0] * TEXTURE_SIZE[1],
        "texture_properties": [
            {
                "height_px": TEXTURE_SIZE[1],
                "mode": "RGBA8",
                "path": TEXTURE_PATH,
                "pixels": TEXTURE_SIZE[0] * TEXTURE_SIZE[1],
                "width_px": TEXTURE_SIZE[0],
            }
        ],
        "textures": 1,
        "triangles": 12,
        "vertices": 24,
    }
    return {
        "actor": {"ground_z_m": 0.0, "neutral_pose": "rest", "root_node": "actor_root"},
        "asset": asset,
        "content_set": {
            "format": actor_package.CONTENT_SET_FORMAT,
            "order": [actor_package.GLB_FILENAME, TEXTURE_PATH],
            "sha256": actor_package.content_set_sha256(content_records),
        },
        "coordinates": {
            "actor_forward": "+Y",
            "actor_right": "+X",
            "actor_up": "+Z",
            "handedness": "right",
            "meters_per_unit": 1.0,
            "storage": "gltf-2.0-right-handed-y-up",
            "storage_to_actor": {"+X": "+X", "+Y": "+Z", "+Z": "-Y"},
        },
        "format": actor_package.ACTOR_PACKAGE_FORMAT,
        "limits": {"profile": actor_package.POLICY_PROFILE, "values": actor_package.LIMITS},
        "observed": observed,
        "package_id": PACKAGE_ID,
        "provenance": {
            "geometry_license": "CC0-1.0",
            "kind": "repository-generated-geometric-fixture",
            "sources": [
                {
                    "id": "fixture-generator",
                    "path": "scripts/generate_actor_package_fixture.py",
                    "sha256": generator_sha256,
                }
            ],
            "texture_license": "CC0-1.0",
            "ticket": "AF-055",
        },
        "schema_version": actor_package.SCHEMA_VERSION,
        "textures": [texture_record],
    }


def _repository_root(app_root: Path) -> Path:
    if app_root.name == "animated-fabric" and app_root.parent.name == "apps":
        return app_root.parent.parent
    return app_root


def _same_path(left: Path, right: Path) -> bool:
    return os.path.normcase(str(left)) == os.path.normcase(str(right))


def _reject_linked_path(path: Path) -> None:
    cursor = path
    while True:
        try:
            status_result = cursor.stat(follow_symlinks=False)
        except FileNotFoundError:
            pass
        except OSError as error:
            raise ValueError("Fixture destination cannot be safely inspected.") from error
        else:
            is_junction = getattr(cursor, "is_junction", lambda: False)
            attributes = getattr(status_result, "st_file_attributes", 0)
            if cursor.is_symlink() or is_junction() or attributes & _REPARSE_ATTRIBUTE:
                raise ValueError(
                    "Fixture destination and its ancestors must not be links or reparse points."
                )
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _is_generated_fixture_directory(destination: Path) -> bool:
    manifest_path = destination / actor_package.MANIFEST_FILENAME
    try:
        status_result = manifest_path.stat(follow_symlinks=False)
    except OSError:
        return False
    attributes = getattr(status_result, "st_file_attributes", 0)
    if (
        not stat.S_ISREG(status_result.st_mode)
        or status_result.st_nlink != 1
        or manifest_path.is_symlink()
        or getattr(manifest_path, "is_junction", lambda: False)()
        or attributes & _REPARSE_ATTRIBUTE
        or not 0 < status_result.st_size <= actor_package.MAX_MANIFEST_BYTES
    ):
        return False
    try:
        payload = manifest_path.read_bytes()
        document = json.loads(payload.decode("utf-8"))
        if not isinstance(document, dict) or payload != actor_package.canonical_json_bytes(
            document
        ):
            return False
        provenance = document.get("provenance")
        if not isinstance(provenance, dict):
            return False
        source_paths: set[str] = set()
        sources = provenance.get("sources")
        if isinstance(sources, list):
            for source in sources:
                if isinstance(source, dict):
                    source_path = source.get("path")
                    if isinstance(source_path, str):
                        source_paths.add(source_path)
        generator = provenance.get("generator")
        if isinstance(generator, dict) and isinstance(generator.get("path"), str):
            source_paths.add(generator["path"])
    except (OSError, UnicodeError, ValueError, TypeError):
        return False
    return (
        document.get("format") == actor_package.ACTOR_PACKAGE_FORMAT
        and document.get("schema_version") == actor_package.SCHEMA_VERSION
        and document.get("package_id") == PACKAGE_ID
        and provenance.get("kind") == "repository-generated-geometric-fixture"
        and "scripts/generate_actor_package_fixture.py" in source_paths
    )


def _validated_fixture_destination(destination: Path, *, app_root: Path = APP_ROOT) -> Path:
    destination = Path(os.path.abspath(destination))
    app_root = Path(os.path.abspath(app_root))
    repository_root = _repository_root(app_root)
    protected_roots = {
        app_root,
        repository_root,
        app_root / ".tmp",
        app_root / "workspaces",
        app_root / "workspaces/actor-packages",
    }
    if any(_same_path(destination, root) for root in protected_roots):
        raise ValueError(
            "Fixture output must be a child directory, not a protected workspace root."
        )
    _reject_linked_path(destination)
    if not destination.exists():
        return destination
    if not destination.is_dir():
        raise ValueError("Fixture destination must be a directory.")
    try:
        has_entries = next(destination.iterdir(), None) is not None
    except OSError as error:
        raise ValueError("Fixture destination cannot be safely inspected.") from error
    if has_entries and not _is_generated_fixture_directory(destination):
        raise ValueError(
            "Refusing to replace a non-empty directory that was not generated by this fixture."
        )
    return destination


def generate_actor_package_fixture(destination: Path) -> str:
    """Generate and atomically publish one complete actor-package fixture."""
    destination = _validated_fixture_destination(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".af055-fixture-", dir=destination.parent))
    backup: Path | None = None
    try:
        texture = _texture_png()
        glb, buffer_length = _glb()
        manifest = _manifest(glb, texture, buffer_length)
        manifest_payload = actor_package.canonical_json_bytes(manifest)
        (stage / "textures").mkdir()
        (stage / actor_package.GLB_FILENAME).write_bytes(glb)
        (stage / TEXTURE_PATH).write_bytes(texture)
        (stage / actor_package.MANIFEST_FILENAME).write_bytes(manifest_payload)
        manifest_sha256 = actor_package.sha256_bytes(manifest_payload)
        actor_package.verify_actor_package(
            stage,
            expected_manifest_sha256=manifest_sha256,
        )
        if destination.exists():
            _validated_fixture_destination(destination)
            backup = Path(tempfile.mkdtemp(prefix=".af055-fixture-backup-", dir=destination.parent))
            backup.rmdir()
            destination.replace(backup)
        stage.replace(destination)
        if backup is not None:
            shutil.rmtree(backup)
        return manifest_sha256
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        if backup is not None and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate the deterministic AF-055 actor package.")
    parser.add_argument("--out", required=True, type=Path, help="Destination package directory.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    manifest_sha256 = generate_actor_package_fixture(arguments.out)
    print(f"AF-055 geometric actor package: {arguments.out}")
    print(f"Manifest SHA-256: {manifest_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
