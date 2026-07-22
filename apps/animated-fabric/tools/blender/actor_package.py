"""Strict data-only actor-package verification for the isolated Blender plane.

This module intentionally uses only the Python standard library so the same
preflight runs in the development container and Blender's bundled Python.  It
does not import ``bpy`` and it never asks Blender to interpret unverified data.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import re
import shutil
import stat
import struct
import tempfile
import zlib
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, TypedDict

MANIFEST_FILENAME: Final = "actor-package.json"
ACTOR_PACKAGE_FORMAT: Final = "animated-fabric.actor-package.v1"
SCHEMA_VERSION: Final = "0.1.0"
CONTENT_SET_FORMAT: Final = "animated-fabric.actor-content-set.v1"
POLICY_PROFILE: Final = "af055-bounded-core-gltf-v1"
GLB_FILENAME: Final = "actor.glb"
AF055_FIXTURE_MANIFEST_SHA256: Final = (
    "1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c"
)

MAX_PACKAGE_FILES: Final = 10
MAX_PACKAGE_BYTES: Final = 32 * 1024 * 1024
MAX_MANIFEST_BYTES: Final = 256 * 1024
MAX_GLB_BYTES: Final = 24 * 1024 * 1024
MAX_GLB_JSON_BYTES: Final = 1024 * 1024
MAX_BUFFER_BYTES: Final = 24 * 1024 * 1024
MAX_TEXTURE_FILES: Final = 8
MAX_TEXTURE_BYTES: Final = 4 * 1024 * 1024
MAX_TEXTURE_DIMENSION: Final = 2048
MAX_TEXTURE_PIXELS: Final = 4 * 1024 * 1024
MAX_TOTAL_TEXTURE_PIXELS: Final = 16 * 1024 * 1024
MAX_NODES: Final = 128
MAX_MESHES: Final = 16
MAX_PRIMITIVES: Final = 32
MAX_ACCESSORS: Final = 256
MAX_BUFFER_VIEWS: Final = 256
MAX_VERTICES: Final = 100_000
MAX_INDICES: Final = 600_000
MAX_TRIANGLES: Final = 200_000
MAX_MATERIALS: Final = 16
MAX_SKINS: Final = 1
MAX_JOINTS: Final = 64
MAX_INFLUENCES: Final = 4
MAX_NAME_LENGTH: Final = 64
MAX_ABSOLUTE_COORDINATE_M: Final = 10.0

LIMITS: Final[dict[str, int | float]] = {
    "accessors": MAX_ACCESSORS,
    "absolute_coordinate_m": MAX_ABSOLUTE_COORDINATE_M,
    "buffer_bytes": MAX_BUFFER_BYTES,
    "buffer_views": MAX_BUFFER_VIEWS,
    "glb_bytes": MAX_GLB_BYTES,
    "glb_json_bytes": MAX_GLB_JSON_BYTES,
    "influences_per_vertex": MAX_INFLUENCES,
    "indices": MAX_INDICES,
    "joints": MAX_JOINTS,
    "manifest_bytes": MAX_MANIFEST_BYTES,
    "materials": MAX_MATERIALS,
    "meshes": MAX_MESHES,
    "nodes": MAX_NODES,
    "package_bytes": MAX_PACKAGE_BYTES,
    "package_files": MAX_PACKAGE_FILES,
    "primitives": MAX_PRIMITIVES,
    "skins": MAX_SKINS,
    "texture_bytes_each": MAX_TEXTURE_BYTES,
    "texture_dimension_px": MAX_TEXTURE_DIMENSION,
    "texture_files": MAX_TEXTURE_FILES,
    "texture_pixels_each": MAX_TEXTURE_PIXELS,
    "texture_pixels_total": MAX_TOTAL_TEXTURE_PIXELS,
    "triangles": MAX_TRIANGLES,
    "vertices": MAX_VERTICES,
}

_IDENTIFIER = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.-]*\Z")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_SPDX_EXPRESSION = re.compile(r"[A-Za-z0-9.-]+\Z")
_TICKET = re.compile(r"AF-[0-9]{3}\Z")
_GLB_MAGIC = b"glTF"
_GLB_VERSION = 2
_JSON_CHUNK = 0x4E4F534A
_BIN_CHUNK = 0x004E4942
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_REPARSE_ATTRIBUTE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_WINDOWS_DEVICE_NAMES: Final = {
    "aux",
    "con",
    "nul",
    "prn",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}
_IDENTITY_MATRIX4: Final = (
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
)

_COMPONENTS: Final[dict[str, int]] = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT4": 16,
}
_COMPONENT_FORMATS: Final[dict[int, tuple[str, int]]] = {
    5121: ("B", 1),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}


@dataclass(frozen=True, slots=True)
class VerifiedActorPackage:
    """Immutable identities and observations for a verified package snapshot."""

    root: Path
    actor_id: str
    root_node: str
    manifest_sha256: str
    content_set_sha256: str
    glb_sha256: str
    glb_path: Path
    texture_paths: tuple[Path, ...]
    file_sha256: tuple[tuple[str, str], ...]
    observations: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class _Accessor:
    index: int
    buffer_view: int
    component_type: int
    count: int
    value_type: str
    values: tuple[tuple[int | float, ...], ...]


class _ActorBounds(TypedDict):
    max: list[float]
    min: list[float]


class _GeometryObservation(TypedDict):
    actor_bounds_m: _ActorBounds
    indices: int
    max_influences_per_vertex: int
    primitives: int
    triangles: int
    used_accessors: set[int]
    vertices: int


class _PngObservation(TypedDict):
    height_px: int
    mode: str
    pixels: int
    width_px: int


def canonical_json_bytes(document: Mapping[str, object]) -> bytes:
    """Encode one canonical actor-package JSON document."""
    return (
        json.dumps(
            document,
            allow_nan=False,
            ensure_ascii=True,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    """Return a lowercase SHA-256 identity."""
    return hashlib.sha256(payload).hexdigest()


def content_set_sha256(records: Sequence[Mapping[str, object]]) -> str:
    """Hash an ordered set of declared content identities."""
    digest = hashlib.sha256()
    digest.update(f"{CONTENT_SET_FORMAT}\n".encode())
    for record in records:
        path = _string(record, "path")
        file_sha256 = _sha256_value(record, "sha256")
        size = _integer(record, "bytes")
        digest.update(path.encode("ascii"))
        digest.update(b"\0")
        digest.update(file_sha256.encode("ascii"))
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def verify_actor_package(
    root: Path,
    *,
    expected_manifest_sha256: str,
) -> VerifiedActorPackage:
    """Verify a closed actor-package tree without invoking Blender."""
    _require_sha256(expected_manifest_sha256, "expected manifest SHA-256")
    files = _inventory_regular_files(root)
    if MANIFEST_FILENAME not in files:
        raise ValueError(f"Actor package is missing {MANIFEST_FILENAME}.")
    manifest_payload = _read_regular_file(files[MANIFEST_FILENAME], MAX_MANIFEST_BYTES)
    manifest_sha256 = sha256_bytes(manifest_payload)
    if manifest_sha256 != expected_manifest_sha256:
        raise ValueError("Actor package manifest does not match the external trust anchor.")
    manifest = _canonical_json_object(MANIFEST_FILENAME, manifest_payload)
    declared = _validate_manifest(manifest)
    expected_paths = {MANIFEST_FILENAME, *(_string(record, "path") for record in declared)}
    if set(files) != expected_paths:
        raise ValueError(
            "Actor package file tree is not closed; "
            f"missing={sorted(expected_paths - set(files))}, "
            f"extra={sorted(set(files) - expected_paths)}."
        )

    payloads: dict[str, bytes] = {}
    total_bytes = len(manifest_payload)
    for record in declared:
        path = _string(record, "path")
        limit = MAX_GLB_BYTES if path == GLB_FILENAME else MAX_TEXTURE_BYTES
        payload = _read_regular_file(files[path], limit)
        payloads[path] = payload
        total_bytes += len(payload)
        if len(payload) != _integer(record, "bytes"):
            raise ValueError(f"Declared byte size disagrees with {path}.")
        if sha256_bytes(payload) != _sha256_value(record, "sha256"):
            raise ValueError(f"Declared SHA-256 disagrees with {path}.")
    if total_bytes > MAX_PACKAGE_BYTES:
        raise ValueError("Actor package exceeds the total byte ceiling.")

    content = _object(manifest, "content_set")
    expected_content_sha256 = content_set_sha256(declared)
    if _sha256_value(content, "sha256") != expected_content_sha256:
        raise ValueError("Actor package content-set digest is invalid.")

    texture_records = _object_list(manifest, "textures")
    texture_observations: list[dict[str, object]] = []
    total_pixels = 0
    for record in texture_records:
        path = _string(record, "path")
        png = _validate_png(payloads[path])
        if (
            png["width_px"] != _integer(record, "width_px")
            or png["height_px"] != _integer(record, "height_px")
            or png["mode"] != _string(record, "mode")
        ):
            raise ValueError(f"Declared PNG properties disagree with {path}.")
        total_pixels += int(png["pixels"])
        texture_observations.append({"path": path, **png})
    if total_pixels > MAX_TOTAL_TEXTURE_PIXELS:
        raise ValueError("Actor package textures exceed the total pixel ceiling.")

    glb_observations = _validate_glb(
        payloads[GLB_FILENAME],
        manifest=manifest,
        declared_texture_paths=tuple(_string(record, "path") for record in texture_records),
    )
    observations = {
        **glb_observations,
        "content_bytes": sum(len(payload) for payload in payloads.values()),
        "content_files": len(payloads),
        "texture_pixels": total_pixels,
        "texture_properties": texture_observations,
    }
    if not _json_exact_equal(observations, _object(manifest, "observed")):
        raise ValueError("Manifest observations disagree with decoded package content.")

    actor = _object(manifest, "actor")
    asset = _object(manifest, "asset")
    return VerifiedActorPackage(
        root=root,
        actor_id=_string(manifest, "package_id"),
        root_node=_string(actor, "root_node"),
        manifest_sha256=manifest_sha256,
        content_set_sha256=expected_content_sha256,
        glb_sha256=_sha256_value(asset, "sha256"),
        glb_path=files[GLB_FILENAME],
        texture_paths=tuple(files[_string(record, "path")] for record in texture_records),
        file_sha256=tuple(
            (
                path,
                sha256_bytes(manifest_payload)
                if path == MANIFEST_FILENAME
                else sha256_bytes(payloads[path]),
            )
            for path in sorted(files)
        ),
        observations=observations,
    )


@contextlib.contextmanager
def private_verified_snapshot(
    source_root: Path,
    scratch_root: Path,
    *,
    expected_manifest_sha256: str,
) -> Iterator[VerifiedActorPackage]:
    """Copy bounded no-follow bytes into private storage and verify only that copy."""
    scratch_root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".af055-actor-snapshot-", dir=scratch_root))
    try:
        source_files = _inventory_regular_files(source_root)
        source_identities: dict[str, tuple[int, int, str]] = {}
        for relative, source in source_files.items():
            limit = _limit_for_relative_path(relative)
            payload = _read_regular_file(source, limit)
            source_identities[relative] = (
                len(payload),
                source.stat(follow_symlinks=False).st_mtime_ns,
                sha256_bytes(payload),
            )
            destination = stage.joinpath(*PurePosixPath(relative).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(payload)
            destination.chmod(0o400)
        verified = verify_actor_package(
            stage,
            expected_manifest_sha256=expected_manifest_sha256,
        )
        _recheck_source_tree(source_root, source_identities)
        _seal_snapshot_tree(stage)
        yield verified
        _recheck_verified_snapshot(verified)
    finally:
        _remove_snapshot_tree(stage)


def assert_linux_read_only_mount(path: Path) -> None:
    """Require the fixed actor input to be a read-only Linux mount."""
    if os.name != "posix" or not Path("/proc/self/mountinfo").is_file():
        raise RuntimeError("Actor-package rendering requires Linux mount isolation.")
    target = path.resolve(strict=True)
    matches: list[tuple[int, set[str], set[str]]] = []
    for line in Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines():
        before, separator, after = line.partition(" - ")
        if not separator:
            continue
        fields = before.split()
        after_fields = after.split()
        if len(fields) < 6 or len(after_fields) < 3:
            continue
        mount_point = Path(_unescape_mount_field(fields[4]))
        try:
            target.relative_to(mount_point)
        except ValueError:
            continue
        matches.append(
            (len(mount_point.parts), set(fields[5].split(",")), set(after_fields[2].split(",")))
        )
    if not matches:
        raise RuntimeError("Actor-package input is not backed by an identifiable mount.")
    _depth, mount_options, super_options = max(matches, key=lambda item: item[0])
    if "ro" not in mount_options and "ro" not in super_options:
        raise RuntimeError("Actor-package input mount must be read-only.")


def _validate_manifest(manifest: Mapping[str, object]) -> list[dict[str, object]]:
    _expect_keys(
        manifest,
        {
            "actor",
            "asset",
            "content_set",
            "coordinates",
            "format",
            "limits",
            "observed",
            "package_id",
            "provenance",
            "schema_version",
            "textures",
        },
        "manifest",
    )
    if _string(manifest, "format") != ACTOR_PACKAGE_FORMAT:
        raise ValueError("Actor package format is unsupported.")
    if _string(manifest, "schema_version") != SCHEMA_VERSION:
        raise ValueError("Actor package schema version is unsupported.")
    _identifier(_string(manifest, "package_id"), "package_id")

    coordinates = _object(manifest, "coordinates")
    _expect_keys(
        coordinates,
        {
            "actor_forward",
            "actor_right",
            "actor_up",
            "handedness",
            "meters_per_unit",
            "storage",
            "storage_to_actor",
        },
        "coordinates",
    )
    if not _json_exact_equal(
        coordinates,
        {
            "actor_forward": "+Y",
            "actor_right": "+X",
            "actor_up": "+Z",
            "handedness": "right",
            "meters_per_unit": 1.0,
            "storage": "gltf-2.0-right-handed-y-up",
            "storage_to_actor": {"+X": "+X", "+Y": "+Z", "+Z": "-Y"},
        },
    ):
        raise ValueError("Actor package coordinate contract is not canonical.")

    limits = _object(manifest, "limits")
    _expect_keys(limits, {"profile", "values"}, "limits")
    if _string(limits, "profile") != POLICY_PROFILE or not _json_exact_equal(
        _object(limits, "values"), LIMITS
    ):
        raise ValueError("Actor package limits do not match the compiled policy ceiling.")

    actor = _object(manifest, "actor")
    _expect_keys(actor, {"ground_z_m", "neutral_pose", "root_node"}, "actor")
    _name(_string(actor, "root_node"), "actor root node")
    if _string(actor, "neutral_pose") != "rest" or not _json_exact_equal(
        actor.get("ground_z_m"), 0.0
    ):
        raise ValueError("Actor package neutral-pose contract is invalid.")

    asset = _object(manifest, "asset")
    _expect_keys(asset, {"bytes", "media_type", "path", "sha256"}, "asset")
    if (
        _safe_relative_path(_string(asset, "path")).as_posix() != GLB_FILENAME
        or _string(asset, "media_type") != "model/gltf-binary"
    ):
        raise ValueError("Actor package must declare exactly actor.glb.")
    _bounded_positive(_integer(asset, "bytes"), MAX_GLB_BYTES, "asset bytes")
    _sha256_value(asset, "sha256")

    texture_records = _object_list(manifest, "textures")
    if not 1 <= len(texture_records) <= MAX_TEXTURE_FILES:
        raise ValueError("Actor package texture count is outside policy.")
    paths: list[str] = []
    identifiers: list[str] = []
    for index, record in enumerate(texture_records):
        _expect_keys(
            record,
            {
                "bytes",
                "height_px",
                "id",
                "media_type",
                "mode",
                "path",
                "sha256",
                "width_px",
            },
            f"textures[{index}]",
        )
        texture_id = _identifier(_string(record, "id"), f"textures[{index}].id")
        path = _safe_relative_path(_string(record, "path")).as_posix()
        if path != f"textures/{texture_id}.png":
            raise ValueError("Texture paths must be canonical and identity-derived.")
        if _string(record, "media_type") != "image/png" or _string(record, "mode") != "RGBA8":
            raise ValueError("Only declared RGBA8 PNG textures are supported.")
        _bounded_positive(_integer(record, "bytes"), MAX_TEXTURE_BYTES, "texture bytes")
        width = _bounded_positive(
            _integer(record, "width_px"), MAX_TEXTURE_DIMENSION, "texture width"
        )
        height = _bounded_positive(
            _integer(record, "height_px"), MAX_TEXTURE_DIMENSION, "texture height"
        )
        if width * height > MAX_TEXTURE_PIXELS:
            raise ValueError("Texture exceeds the per-image pixel ceiling.")
        _sha256_value(record, "sha256")
        paths.append(path)
        identifiers.append(texture_id)
    if (
        paths != sorted(paths)
        or len(set(paths)) != len(paths)
        or len(set(identifiers)) != len(identifiers)
    ):
        raise ValueError("Texture inventory must be unique and sorted by path.")

    content = _object(manifest, "content_set")
    _expect_keys(content, {"format", "order", "sha256"}, "content_set")
    declared_order = _string_list(content, "order")
    expected_order = [GLB_FILENAME, *paths]
    if _string(content, "format") != CONTENT_SET_FORMAT or declared_order != expected_order:
        raise ValueError("Actor package content-set order is invalid.")
    _sha256_value(content, "sha256")

    provenance = _object(manifest, "provenance")
    _expect_keys(
        provenance,
        {"geometry_license", "kind", "sources", "texture_license", "ticket"},
        "provenance",
    )
    if _string(provenance, "kind") not in {
        "repository-generated-geometric-fixture",
        "reviewed-authored-actor",
    }:
        raise ValueError("Actor package provenance kind is unsupported.")
    if not _TICKET.fullmatch(_string(provenance, "ticket")):
        raise ValueError("Actor package provenance ticket is invalid.")
    for key in ("geometry_license", "texture_license"):
        if not _SPDX_EXPRESSION.fullmatch(_string(provenance, key)):
            raise ValueError("Actor package provenance license identity is invalid.")
    source_records = _object_list(provenance, "sources")
    if not 1 <= len(source_records) <= 32:
        raise ValueError("Actor package provenance source inventory is outside policy.")
    source_ids: list[str] = []
    for index, source in enumerate(source_records):
        _expect_keys(source, {"id", "path", "sha256"}, f"provenance.sources[{index}]")
        source_ids.append(_identifier(_string(source, "id"), "provenance source id"))
        _safe_relative_path(_string(source, "path"))
        _sha256_value(source, "sha256")
    if source_ids != sorted(source_ids) or len(source_ids) != len(set(source_ids)):
        raise ValueError("Actor package provenance sources must be unique and sorted by id.")

    declared: list[dict[str, object]] = [dict(asset), *texture_records]
    return declared


def _validate_glb(
    payload: bytes,
    *,
    manifest: Mapping[str, object],
    declared_texture_paths: tuple[str, ...],
) -> dict[str, object]:
    document, binary = _decode_glb(payload)
    _expect_keys(
        document,
        {
            "accessors",
            "asset",
            "bufferViews",
            "buffers",
            "images",
            "materials",
            "meshes",
            "nodes",
            "samplers",
            "scene",
            "scenes",
            "skins",
            "textures",
        },
        "GLB document",
    )
    asset = _object(document, "asset")
    _expect_keys(asset, {"generator", "version"}, "GLB asset")
    if _string(asset, "version") != "2.0":
        raise ValueError("GLB asset version must be exactly 2.0.")
    _ascii_text(_string(asset, "generator"), 128, "GLB generator")

    buffers = _object_list(document, "buffers")
    if len(buffers) != 1:
        raise ValueError("GLB must contain exactly one embedded buffer.")
    _expect_keys(buffers[0], {"byteLength"}, "GLB buffer")
    declared_buffer_bytes = _bounded_nonnegative(
        _integer(buffers[0], "byteLength"), MAX_BUFFER_BYTES, "GLB buffer bytes"
    )
    if declared_buffer_bytes > len(binary) or len(binary) - declared_buffer_bytes > 3:
        raise ValueError("GLB BIN chunk length does not match its buffer declaration.")
    if any(binary[declared_buffer_bytes:]):
        raise ValueError("GLB BIN padding must contain only zero bytes.")
    binary = binary[:declared_buffer_bytes]

    buffer_views = _object_list(document, "bufferViews")
    if len(buffer_views) > MAX_BUFFER_VIEWS:
        raise ValueError("GLB exceeds the buffer-view ceiling.")
    view_ranges: list[tuple[int, int, int | None]] = []
    for index, view in enumerate(buffer_views):
        _expect_allowed_keys(
            view,
            {"buffer", "byteLength"},
            {"byteOffset", "byteStride", "target"},
            f"bufferViews[{index}]",
        )
        if _integer(view, "buffer") != 0:
            raise ValueError("Every buffer view must use the embedded GLB buffer.")
        offset = _bounded_nonnegative(
            _optional_integer(view, "byteOffset", 0), len(binary), "buffer-view offset"
        )
        length = _bounded_positive(_integer(view, "byteLength"), len(binary), "buffer-view length")
        if offset % 4 != 0 or offset + length > len(binary):
            raise ValueError("GLB buffer view is misaligned or outside the BIN chunk.")
        stride = _optional_integer_or_none(view, "byteStride")
        if stride is not None and (stride < 4 or stride > 252 or stride % 4 != 0):
            raise ValueError("GLB buffer-view stride is unsupported.")
        target = _optional_integer_or_none(view, "target")
        if target is not None and target not in {34962, 34963}:
            raise ValueError("GLB buffer-view target is unsupported.")
        view_ranges.append((offset, length, stride))
    cursor = 0
    for offset, length, _stride in sorted(view_ranges):
        if offset < cursor or offset - cursor > 3 or any(binary[cursor:offset]):
            raise ValueError("GLB buffer views overlap or conceal non-padding bytes.")
        cursor = offset + length
    if len(binary) - cursor > 3 or any(binary[cursor:]):
        raise ValueError("GLB buffer contains undeclared non-padding bytes.")

    accessors_data = _object_list(document, "accessors")
    if len(accessors_data) > MAX_ACCESSORS:
        raise ValueError("GLB exceeds the accessor ceiling.")
    accessors = tuple(
        _decode_accessor(index, accessor, buffer_views, view_ranges, binary)
        for index, accessor in enumerate(accessors_data)
    )

    nodes = _object_list(document, "nodes")
    meshes = _object_list(document, "meshes")
    materials = _object_list(document, "materials")
    textures = _object_list(document, "textures")
    images = _object_list(document, "images")
    samplers = _object_list(document, "samplers")
    skins = _object_list(document, "skins")
    if len(nodes) > MAX_NODES:
        raise ValueError("GLB exceeds the node ceiling.")
    if not 1 <= len(meshes) <= MAX_MESHES:
        raise ValueError("GLB mesh count is outside policy.")
    if not 1 <= len(materials) <= MAX_MATERIALS:
        raise ValueError("GLB material count is outside policy.")
    if len(textures) != len(declared_texture_paths) or len(images) != len(textures):
        raise ValueError("GLB texture/image counts do not match the manifest inventory.")
    if len(samplers) != len(textures):
        raise ValueError("GLB requires one explicit sampler per texture.")
    if len(skins) > MAX_SKINS:
        raise ValueError("GLB exceeds the skin ceiling.")

    root_index, parent_by_node, world_by_node = _validate_scene_graph(document, nodes, manifest)
    _validate_images(images, declared_texture_paths)
    _validate_samplers(samplers)
    _validate_textures(textures, len(images), len(samplers))
    used_texture_indices = _validate_materials(materials, len(textures))
    if used_texture_indices != set(range(len(textures))):
        raise ValueError(
            "Every declared texture must be used by a material exactly within the actor."
        )

    skin_joint_counts = _validate_skins(
        skins,
        nodes,
        accessors,
        parent_by_node,
        world_by_node,
    )
    geometry = _validate_meshes(
        meshes,
        nodes,
        materials_count=len(materials),
        accessors=accessors,
        skins=skins,
        skin_joint_counts=skin_joint_counts,
    )
    _validate_references_are_closed(
        nodes=nodes,
        meshes=meshes,
        accessors=accessors,
        buffer_view_count=len(buffer_views),
        skins=skins,
        geometry=geometry,
    )

    bounds = geometry["actor_bounds_m"]
    actor = _object(manifest, "actor")
    ground_z = float(_number(actor, "ground_z_m"))
    minimum = bounds["min"]
    if not isinstance(minimum, list) or abs(float(minimum[2]) - ground_z) > 1e-6:
        raise ValueError("Actor geometry does not touch the declared neutral ground plane.")
    if any(
        abs(float(value)) > MAX_ABSOLUTE_COORDINATE_M for value in (*bounds["min"], *bounds["max"])
    ):
        raise ValueError("Actor geometry exceeds the absolute coordinate ceiling.")

    return {
        "accessors": len(accessors),
        "actor_bounds_m": bounds,
        "buffer_bytes": len(binary),
        "buffer_views": len(buffer_views),
        "images": len(images),
        "indices": geometry["indices"],
        "joints": sum(skin_joint_counts),
        "materials": len(materials),
        "max_influences_per_vertex": geometry["max_influences_per_vertex"],
        "meshes": len(meshes),
        "nodes": len(nodes),
        "primitives": geometry["primitives"],
        "root_node_index": root_index,
        "samplers": len(samplers),
        "skins": len(skins),
        "textures": len(textures),
        "triangles": geometry["triangles"],
        "vertices": geometry["vertices"],
    }


def _decode_glb(payload: bytes) -> tuple[dict[str, object], bytes]:
    if len(payload) < 28 or len(payload) > MAX_GLB_BYTES:
        raise ValueError("GLB byte length is outside policy.")
    magic, version, declared_length = struct.unpack_from("<4sII", payload, 0)
    if magic != _GLB_MAGIC or version != _GLB_VERSION or declared_length != len(payload):
        raise ValueError("GLB header is invalid.")
    offset = 12
    chunks: list[tuple[int, bytes]] = []
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise ValueError("GLB has a truncated chunk header.")
        length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        if length % 4 != 0 or offset + length > len(payload):
            raise ValueError("GLB chunk is unaligned or truncated.")
        chunks.append((chunk_type, payload[offset : offset + length]))
        offset += length
    if len(chunks) != 2 or chunks[0][0] != _JSON_CHUNK or chunks[1][0] != _BIN_CHUNK:
        raise ValueError("GLB must contain exactly one JSON chunk followed by one BIN chunk.")
    json_chunk = chunks[0][1]
    if len(json_chunk) > MAX_GLB_JSON_BYTES:
        raise ValueError("GLB JSON chunk exceeds policy.")
    if not json_chunk or json_chunk[-1] not in {0x20, 0x7D}:
        raise ValueError("GLB JSON padding is not canonical.")
    json_payload = json_chunk.rstrip(b" ")
    document = _decode_json_object("actor.glb JSON", json_payload)
    _validate_json_shape(document)
    return document, chunks[1][1]


def _decode_accessor(
    index: int,
    accessor: Mapping[str, object],
    buffer_views: Sequence[Mapping[str, object]],
    view_ranges: Sequence[tuple[int, int, int | None]],
    binary: bytes,
) -> _Accessor:
    _expect_allowed_keys(
        accessor,
        {"bufferView", "componentType", "count", "type"},
        {"byteOffset", "max", "min", "normalized"},
        f"accessors[{index}]",
    )
    view_index = _index(_integer(accessor, "bufferView"), len(buffer_views), "accessor bufferView")
    component_type = _integer(accessor, "componentType")
    if component_type not in _COMPONENT_FORMATS:
        raise ValueError("GLB accessor component type is unsupported.")
    value_type = _string(accessor, "type")
    if value_type not in _COMPONENTS:
        raise ValueError("GLB accessor value type is unsupported.")
    count = _bounded_positive(_integer(accessor, "count"), MAX_INDICES, "accessor count")
    normalized = accessor.get("normalized", False)
    if not isinstance(normalized, bool) or normalized:
        raise ValueError("Normalized integer accessors are unsupported in actor-package v1.")
    byte_offset = _bounded_nonnegative(
        _optional_integer(accessor, "byteOffset", 0), MAX_BUFFER_BYTES, "accessor offset"
    )
    format_char, component_size = _COMPONENT_FORMATS[component_type]
    component_count = _COMPONENTS[value_type]
    element_size = component_size * component_count
    view_offset, view_length, view_stride = view_ranges[view_index]
    if view_stride is not None or byte_offset != 0:
        raise ValueError("Actor-package v1 requires tightly packed, unstrided accessors.")
    stride = element_size
    if byte_offset % component_size != 0:
        raise ValueError("GLB accessor alignment is invalid.")
    last_end = byte_offset + (count - 1) * stride + element_size
    if last_end != view_length:
        raise ValueError("GLB accessor must exactly consume its buffer view.")
    unpacker = struct.Struct("<" + format_char * component_count)
    values: list[tuple[int | float, ...]] = []
    for item_index in range(count):
        value = unpacker.unpack_from(binary, view_offset + byte_offset + item_index * stride)
        if component_type == 5126 and any(not math.isfinite(float(item)) for item in value):
            raise ValueError("GLB accessor contains NaN or infinity.")
        values.append(value)
    for bound_name in ("min", "max"):
        if bound_name in accessor:
            bound = _number_list(accessor, bound_name, component_count)
            if component_type != 5126:
                raise ValueError("Only floating-point accessors may declare bounds.")
            observed = [
                min(float(value[axis]) for value in values)
                if bound_name == "min"
                else max(float(value[axis]) for value in values)
                for axis in range(component_count)
            ]
            if any(
                abs(expected - actual) > 1e-6
                for expected, actual in zip(bound, observed, strict=True)
            ):
                raise ValueError("GLB accessor declared bounds disagree with decoded values.")
    return _Accessor(index, view_index, component_type, count, value_type, tuple(values))


def _validate_scene_graph(
    document: Mapping[str, object],
    nodes: Sequence[Mapping[str, object]],
    manifest: Mapping[str, object],
) -> tuple[int, dict[int, int], dict[int, tuple[float, ...]]]:
    if not nodes:
        raise ValueError("GLB must contain actor nodes.")
    scene_index = _integer(document, "scene")
    scenes = _object_list(document, "scenes")
    if scene_index != 0 or len(scenes) != 1:
        raise ValueError("GLB must expose exactly one default scene.")
    _expect_keys(scenes[0], {"nodes"}, "GLB scene")
    roots = _integer_list(scenes[0], "nodes")
    if len(roots) != 1:
        raise ValueError("GLB scene must expose exactly one actor root.")
    root_index = _index(roots[0], len(nodes), "actor root")
    actor = _object(manifest, "actor")
    parent_by_node: dict[int, int] = {}
    world_by_node: dict[int, tuple[float, ...]] = {}
    visited: set[int] = set()
    visiting: set[int] = set()

    def visit(node_index: int, parent_world: tuple[float, ...]) -> None:
        if node_index in visiting:
            raise ValueError("GLB node graph contains a cycle.")
        if node_index in visited:
            raise ValueError("GLB node graph contains a multiply parented node.")
        visiting.add(node_index)
        node = nodes[node_index]
        _expect_allowed_keys(
            node,
            {"name"},
            {"children", "mesh", "rotation", "scale", "skin", "translation"},
            f"nodes[{node_index}]",
        )
        _name(_string(node, "name"), f"nodes[{node_index}].name")
        local_transform = _validate_node_transform(node, is_root=node_index == root_index)
        world_transform = _multiply_matrix4(parent_world, local_transform)
        if any(
            not math.isfinite(value) or abs(value) > MAX_ABSOLUTE_COORDINATE_M
            for value in world_transform
        ):
            raise ValueError("GLB composed/world transform exceeds the actor coordinate ceiling.")
        if "mesh" in node and not _matrix4_close(world_transform, _IDENTITY_MATRIX4):
            raise ValueError("GLB mesh composed/world transform must use actor coordinates.")
        world_by_node[node_index] = world_transform
        children = _optional_integer_list(node, "children")
        if len(set(children)) != len(children):
            raise ValueError("GLB node repeats a child reference.")
        for child in children:
            child_index = _index(child, len(nodes), "node child")
            if child_index in parent_by_node:
                raise ValueError("GLB node graph contains a multiply parented node.")
            parent_by_node[child_index] = node_index
            visit(child_index, world_transform)
        visiting.remove(node_index)
        visited.add(node_index)

    visit(root_index, _IDENTITY_MATRIX4)
    if len(visited) != len(nodes):
        raise ValueError("GLB contains nodes outside the actor-root tree.")
    if _string(nodes[root_index], "name") != _string(actor, "root_node"):
        raise ValueError("GLB actor-root identity disagrees with the manifest.")
    names = [_string(node, "name") for node in nodes]
    if len(set(names)) != len(names):
        raise ValueError("GLB node names must be unique.")
    return root_index, parent_by_node, world_by_node


def _validate_node_transform(node: Mapping[str, object], *, is_root: bool) -> tuple[float, ...]:
    translation = _optional_number_list(node, "translation", 3, [0.0, 0.0, 0.0])
    rotation = _optional_number_list(node, "rotation", 4, [0.0, 0.0, 0.0, 1.0])
    scale = _optional_number_list(node, "scale", 3, [1.0, 1.0, 1.0])
    if any(not math.isfinite(value) for value in (*translation, *rotation, *scale)):
        raise ValueError("GLB node transform contains NaN or infinity.")
    if any(abs(value) > MAX_ABSOLUTE_COORDINATE_M for value in (*translation, *scale)):
        raise ValueError("GLB node rest transform exceeds the actor coordinate ceiling.")
    if any(value == 0.0 for value in scale):
        raise ValueError("GLB node scale must be nonzero.")
    norm = math.sqrt(sum(value * value for value in rotation))
    if abs(norm - 1.0) > 1e-5:
        raise ValueError("GLB node quaternion must be normalized.")
    if is_root and (
        translation != [0.0, 0.0, 0.0]
        or rotation != [0.0, 0.0, 0.0, 1.0]
        or scale != [1.0, 1.0, 1.0]
    ):
        raise ValueError("GLB actor root must have the identity transform.")
    if "mesh" in node and (
        translation != [0.0, 0.0, 0.0]
        or rotation != [0.0, 0.0, 0.0, 1.0]
        or scale != [1.0, 1.0, 1.0]
    ):
        raise ValueError("Actor-package v1 requires mesh nodes in actor coordinates.")
    return _trs_matrix4(translation, rotation, scale)


def _validate_images(
    images: Sequence[Mapping[str, object]], expected_paths: tuple[str, ...]
) -> None:
    actual_paths: list[str] = []
    for index, image in enumerate(images):
        _expect_keys(image, {"name", "uri"}, f"images[{index}]")
        _name(_string(image, "name"), f"images[{index}].name")
        uri = _string(image, "uri")
        if any(character in uri for character in ("%", "?", "#", "\0")):
            raise ValueError("GLB image URI contains unsupported URI syntax.")
        actual_paths.append(_safe_relative_path(uri).as_posix())
    if tuple(actual_paths) != expected_paths:
        raise ValueError("GLB image URIs do not exactly match declared package textures.")


def _validate_samplers(samplers: Sequence[Mapping[str, object]]) -> None:
    for index, sampler in enumerate(samplers):
        _expect_keys(
            sampler,
            {"magFilter", "minFilter", "name", "wrapS", "wrapT"},
            f"samplers[{index}]",
        )
        _name(_string(sampler, "name"), f"samplers[{index}].name")
        if (
            _integer(sampler, "magFilter") != 9729
            or _integer(sampler, "minFilter") != 9987
            or _integer(sampler, "wrapS") != 10497
            or _integer(sampler, "wrapT") != 10497
        ):
            raise ValueError("GLB sampler must use the fixed linear mipmapped repeat policy.")


def _validate_textures(
    textures: Sequence[Mapping[str, object]], image_count: int, sampler_count: int
) -> None:
    for index, texture in enumerate(textures):
        _expect_keys(texture, {"name", "sampler", "source"}, f"textures[{index}]")
        _name(_string(texture, "name"), f"textures[{index}].name")
        if _index(_integer(texture, "source"), image_count, "texture source") != index:
            raise ValueError("GLB textures must preserve manifest image order.")
        if _index(_integer(texture, "sampler"), sampler_count, "texture sampler") != index:
            raise ValueError("GLB textures must preserve explicit sampler order.")


def _validate_materials(materials: Sequence[Mapping[str, object]], texture_count: int) -> set[int]:
    used: set[int] = set()
    names: set[str] = set()
    for index, material in enumerate(materials):
        _expect_keys(
            material,
            {"alphaMode", "doubleSided", "name", "pbrMetallicRoughness"},
            f"materials[{index}]",
        )
        name = _name(_string(material, "name"), f"materials[{index}].name")
        if name in names:
            raise ValueError("GLB material names must be unique.")
        names.add(name)
        if _string(material, "alphaMode") not in {"OPAQUE", "MASK"}:
            raise ValueError("Only OPAQUE and MASK materials are supported.")
        if not isinstance(material.get("doubleSided"), bool):
            raise ValueError("GLB material doubleSided must be boolean.")
        pbr = _object(material, "pbrMetallicRoughness")
        _expect_keys(
            pbr,
            {"baseColorFactor", "baseColorTexture", "metallicFactor", "roughnessFactor"},
            f"materials[{index}].pbrMetallicRoughness",
        )
        factor = _number_list(pbr, "baseColorFactor", 4)
        if any(value < 0.0 or value > 1.0 for value in factor):
            raise ValueError("GLB base-color factor is outside [0, 1].")
        metallic = float(_number(pbr, "metallicFactor"))
        roughness = float(_number(pbr, "roughnessFactor"))
        if not 0.0 <= metallic <= 1.0 or not 0.0 <= roughness <= 1.0:
            raise ValueError("GLB material factors are outside [0, 1].")
        base_texture = _object(pbr, "baseColorTexture")
        _expect_keys(base_texture, {"index", "texCoord"}, "baseColorTexture")
        texture_index = _index(
            _integer(base_texture, "index"), texture_count, "material base-color texture"
        )
        if _integer(base_texture, "texCoord") != 0:
            raise ValueError("Only TEXCOORD_0 is supported.")
        used.add(texture_index)
    return used


def _validate_skins(
    skins: Sequence[Mapping[str, object]],
    nodes: Sequence[Mapping[str, object]],
    accessors: Sequence[_Accessor],
    parent_by_node: Mapping[int, int],
    world_by_node: Mapping[int, tuple[float, ...]],
) -> tuple[int, ...]:
    counts: list[int] = []
    for index, skin in enumerate(skins):
        _expect_keys(
            skin,
            {"inverseBindMatrices", "joints", "name", "skeleton"},
            f"skins[{index}]",
        )
        _name(_string(skin, "name"), f"skins[{index}].name")
        joints = _integer_list(skin, "joints")
        if not 1 <= len(joints) <= MAX_JOINTS or len(set(joints)) != len(joints):
            raise ValueError("GLB skin joint inventory is invalid.")
        joints = [_index(joint, len(nodes), "skin joint") for joint in joints]
        skeleton = _index(_integer(skin, "skeleton"), len(nodes), "skin skeleton")
        if skeleton not in joints:
            raise ValueError("GLB skin skeleton must be one of its joints.")
        joint_set = set(joints)
        for joint in joints:
            cursor = joint
            while cursor != skeleton and cursor in parent_by_node:
                cursor = parent_by_node[cursor]
            if cursor != skeleton:
                raise ValueError("Every GLB joint must descend from the skin skeleton.")
        accessor_index = _index(
            _integer(skin, "inverseBindMatrices"), len(accessors), "inverse bind accessor"
        )
        accessor = accessors[accessor_index]
        if (
            accessor.component_type != 5126
            or accessor.value_type != "MAT4"
            or accessor.count != len(joints)
        ):
            raise ValueError("Inverse-bind accessor must be FLOAT MAT4 with one matrix per joint.")
        for joint, matrix_values in zip(joints, accessor.values, strict=True):
            matrix = tuple(float(value) for value in matrix_values)
            if any(abs(value) > MAX_ABSOLUTE_COORDINATE_M for value in matrix):
                raise ValueError("Inverse-bind matrix exceeds the actor coordinate ceiling.")
            determinant = _determinant4(matrix)
            if not math.isfinite(determinant) or abs(determinant) < 1e-8:
                raise ValueError("Inverse-bind matrix must be finite and invertible.")
            inverse_bind = _gltf_matrix4_to_row_major(matrix)
            rest_transform = _multiply_matrix4(world_by_node[joint], inverse_bind)
            if not _matrix4_close(rest_transform, _IDENTITY_MATRIX4):
                raise ValueError(
                    "Inverse-bind matrix disagrees with the joint composed/world rest transform."
                )
        counts.append(len(joint_set))
    return tuple(counts)


def _validate_meshes(
    meshes: Sequence[Mapping[str, object]],
    nodes: Sequence[Mapping[str, object]],
    *,
    materials_count: int,
    accessors: Sequence[_Accessor],
    skins: Sequence[Mapping[str, object]],
    skin_joint_counts: Sequence[int],
) -> _GeometryObservation:
    mesh_skin: dict[int, int | None] = {}
    for node in nodes:
        if "mesh" not in node:
            if "skin" in node:
                raise ValueError("GLB node cannot declare a skin without a mesh.")
            continue
        mesh_index = _index(_integer(node, "mesh"), len(meshes), "node mesh")
        skin_index = (
            _index(_integer(node, "skin"), len(skins), "node skin") if "skin" in node else None
        )
        if mesh_index in mesh_skin and mesh_skin[mesh_index] != skin_index:
            raise ValueError("A mesh cannot be instanced with different skin contracts.")
        mesh_skin[mesh_index] = skin_index
    if set(mesh_skin) != set(range(len(meshes))):
        raise ValueError("Every GLB mesh must be referenced by an actor node.")
    if {skin for skin in mesh_skin.values() if skin is not None} != set(range(len(skins))):
        raise ValueError("Every GLB skin must be referenced by an actor mesh node.")

    primitive_count = 0
    vertex_count = 0
    index_count = 0
    triangle_count = 0
    max_influences = 0
    actor_positions: list[tuple[float, float, float]] = []
    used_materials: set[int] = set()
    used_accessors: set[int] = set()
    for mesh_index, mesh in enumerate(meshes):
        _expect_keys(mesh, {"name", "primitives"}, f"meshes[{mesh_index}]")
        _name(_string(mesh, "name"), f"meshes[{mesh_index}].name")
        primitives = _object_list(mesh, "primitives")
        if not primitives:
            raise ValueError("GLB mesh must contain at least one primitive.")
        for primitive_index, primitive in enumerate(primitives):
            primitive_count += 1
            if primitive_count > MAX_PRIMITIVES:
                raise ValueError("GLB exceeds the primitive ceiling.")
            _expect_keys(
                primitive,
                {"attributes", "indices", "material", "mode"},
                f"meshes[{mesh_index}].primitives[{primitive_index}]",
            )
            if _integer(primitive, "mode") != 4:
                raise ValueError("Only indexed triangle primitives are supported.")
            attributes = _object(primitive, "attributes")
            allowed = {"JOINTS_0", "NORMAL", "POSITION", "TEXCOORD_0", "WEIGHTS_0"}
            if (
                not {"POSITION", "NORMAL", "TEXCOORD_0"}.issubset(attributes)
                or not set(attributes) <= allowed
            ):
                raise ValueError("GLB primitive attributes are outside the actor-package subset.")
            has_skin_attributes = "JOINTS_0" in attributes or "WEIGHTS_0" in attributes
            if has_skin_attributes != ({"JOINTS_0", "WEIGHTS_0"} <= set(attributes)):
                raise ValueError("JOINTS_0 and WEIGHTS_0 must be declared together.")
            skin_index = mesh_skin[mesh_index]
            if has_skin_attributes != (skin_index is not None):
                raise ValueError("Primitive skin attributes disagree with the mesh-node skin.")
            position = _accessor_for_semantic(attributes, "POSITION", accessors, 5126, "VEC3")
            normal = _accessor_for_semantic(attributes, "NORMAL", accessors, 5126, "VEC3")
            uv = _accessor_for_semantic(attributes, "TEXCOORD_0", accessors, 5126, "VEC2")
            used_accessors.update({position.index, normal.index, uv.index})
            if normal.count != position.count or uv.count != position.count:
                raise ValueError("Primitive vertex attributes must have identical counts.")
            for value in normal.values:
                length = math.sqrt(sum(float(component) ** 2 for component in value))
                if abs(length - 1.0) > 1e-4:
                    raise ValueError("GLB normals must be finite unit vectors.")
            for value in uv.values:
                if any(float(component) < 0.0 or float(component) > 1.0 for component in value):
                    raise ValueError("GLB texture coordinates must stay within [0, 1].")
            indices_index = _index(
                _integer(primitive, "indices"), len(accessors), "primitive indices"
            )
            indices = accessors[indices_index]
            used_accessors.add(indices.index)
            if indices.component_type not in {5123, 5125} or indices.value_type != "SCALAR":
                raise ValueError("Primitive indices must be unsigned SCALAR values.")
            if indices.count % 3 != 0 or any(
                int(value[0]) >= position.count for value in indices.values
            ):
                raise ValueError("Primitive triangle indices are invalid or out of range.")
            material_index = _index(
                _integer(primitive, "material"), materials_count, "primitive material"
            )
            used_materials.add(material_index)
            if skin_index is not None:
                joints = _accessor_for_semantic(attributes, "JOINTS_0", accessors, None, "VEC4")
                weights = _accessor_for_semantic(attributes, "WEIGHTS_0", accessors, 5126, "VEC4")
                if joints.component_type not in {5121, 5123}:
                    raise ValueError("Joint indices must use unsigned byte or unsigned short.")
                if joints.count != position.count or weights.count != position.count:
                    raise ValueError("Skin attributes must match the primitive vertex count.")
                used_accessors.update({joints.index, weights.index})
                joint_count = skin_joint_counts[skin_index]
                for joint_values, weight_values in zip(joints.values, weights.values, strict=True):
                    floats = tuple(float(value) for value in weight_values)
                    if any(value < 0.0 or value > 1.0 for value in floats):
                        raise ValueError("Skin weights must stay within [0, 1].")
                    if abs(sum(floats) - 1.0) > 1e-5:
                        raise ValueError("Skin weights must be normalized per vertex.")
                    influences = sum(value > 0.0 for value in floats)
                    if not 1 <= influences <= MAX_INFLUENCES:
                        raise ValueError("Skin influence count is outside policy.")
                    for joint_value, weight_value in zip(joint_values, floats, strict=True):
                        if weight_value > 0.0 and int(joint_value) >= joint_count:
                            raise ValueError("Weighted joint index is outside the skin inventory.")
                    max_influences = max(max_influences, influences)
            actor_positions.extend(_storage_positions_to_actor(position.values))
            vertex_count += position.count
            index_count += indices.count
            triangle_count += indices.count // 3
    if used_materials != set(range(materials_count)):
        raise ValueError("Every GLB material must be used by actor geometry.")
    if vertex_count > MAX_VERTICES or index_count > MAX_INDICES or triangle_count > MAX_TRIANGLES:
        raise ValueError("GLB geometry exceeds vertex, index, or triangle policy.")
    minimum = [round(min(position[axis] for position in actor_positions), 6) for axis in range(3)]
    maximum = [round(max(position[axis] for position in actor_positions), 6) for axis in range(3)]
    return {
        "actor_bounds_m": {"max": maximum, "min": minimum},
        "indices": index_count,
        "max_influences_per_vertex": max_influences,
        "primitives": primitive_count,
        "triangles": triangle_count,
        "used_accessors": used_accessors,
        "vertices": vertex_count,
    }


def _validate_references_are_closed(
    *,
    nodes: Sequence[Mapping[str, object]],
    meshes: Sequence[Mapping[str, object]],
    accessors: Sequence[_Accessor],
    buffer_view_count: int,
    skins: Sequence[Mapping[str, object]],
    geometry: _GeometryObservation,
) -> None:
    used_accessors = set(geometry["used_accessors"])
    for skin in skins:
        used_accessors.add(_integer(skin, "inverseBindMatrices"))
    if used_accessors != set(range(len(accessors))):
        raise ValueError("GLB contains unused accessors or hidden buffer data.")
    used_views = {accessor.buffer_view for accessor in accessors}
    # Actor-package v1 requires one tightly scoped buffer view per accessor.
    # The accessor parser already proves every accessor references a valid view;
    # recover those references from the source structures through mesh/skin closure.
    if used_views != set(range(buffer_view_count)) or len(accessors) != buffer_view_count:
        raise ValueError("GLB requires exactly one buffer view per accessor.")
    mesh_names = [_string(mesh, "name") for mesh in meshes]
    if len(mesh_names) != len(set(mesh_names)):
        raise ValueError("GLB mesh names must be unique.")
    node_meshes = [_integer(node, "mesh") for node in nodes if "mesh" in node]
    if set(node_meshes) != set(range(len(meshes))):
        raise ValueError("GLB mesh references are not closed.")


def _accessor_for_semantic(
    attributes: Mapping[str, object],
    semantic: str,
    accessors: Sequence[_Accessor],
    component_type: int | None,
    value_type: str,
) -> _Accessor:
    raw = attributes.get(semantic)
    if not isinstance(raw, int) or isinstance(raw, bool):
        raise ValueError(f"Primitive {semantic} accessor index is invalid.")
    accessor = accessors[_index(raw, len(accessors), f"{semantic} accessor")]
    if (
        component_type is not None and accessor.component_type != component_type
    ) or accessor.value_type != value_type:
        raise ValueError(f"Primitive {semantic} accessor has an unsupported type.")
    return accessor


def _storage_positions_to_actor(
    values: Sequence[tuple[int | float, ...]],
) -> list[tuple[float, float, float]]:
    # glTF storage: +X right, +Y up, +Z back. Actor: +X right, +Y forward, +Z up.
    return [(float(value[0]), -float(value[2]), float(value[1])) for value in values]


def _validate_png(payload: bytes) -> _PngObservation:
    if len(payload) > MAX_TEXTURE_BYTES or not payload.startswith(_PNG_SIGNATURE):
        raise ValueError("Texture is not a bounded PNG.")
    offset = len(_PNG_SIGNATURE)
    chunks: list[tuple[bytes, bytes]] = []
    while offset < len(payload):
        if offset + 12 > len(payload):
            raise ValueError("PNG contains a truncated chunk.")
        length = struct.unpack_from(">I", payload, offset)[0]
        chunk_type = payload[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(payload):
            raise ValueError("PNG chunk exceeds the file boundary.")
        data = payload[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack_from(">I", payload, offset + 8 + length)[0]
        actual_crc = zlib.crc32(chunk_type)
        actual_crc = zlib.crc32(data, actual_crc) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise ValueError("PNG chunk CRC is invalid.")
        chunks.append((chunk_type, data))
        offset = end
        if chunk_type == b"IEND":
            break
    if offset != len(payload):
        raise ValueError("PNG contains data after IEND.")
    types = [chunk_type for chunk_type, _data in chunks]
    if not types or types[0] != b"IHDR" or types[-1] != b"IEND":
        raise ValueError("PNG chunk order is invalid.")
    if chunks[-1][1]:
        raise ValueError("PNG IEND chunk must be empty.")
    if any(chunk_type not in {b"IHDR", b"IDAT", b"IEND"} for chunk_type in types):
        raise ValueError("Actor-package PNG contains unsupported ancillary or animation chunks.")
    if types.count(b"IHDR") != 1 or types.count(b"IEND") != 1 or b"IDAT" not in types:
        raise ValueError("PNG must contain one IHDR, IDAT data, and one IEND.")
    first_idat = types.index(b"IDAT")
    last_idat = len(types) - 1 - types[::-1].index(b"IDAT")
    if any(chunk_type != b"IDAT" for chunk_type in types[first_idat : last_idat + 1]):
        raise ValueError("PNG IDAT chunks must be contiguous.")
    ihdr = chunks[0][1]
    if len(ihdr) != 13:
        raise ValueError("PNG IHDR length is invalid.")
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", ihdr
    )
    if (
        not 1 <= width <= MAX_TEXTURE_DIMENSION
        or not 1 <= height <= MAX_TEXTURE_DIMENSION
        or width * height > MAX_TEXTURE_PIXELS
        or depth != 8
        or color_type != 6
        or compression != 0
        or filtering != 0
        or interlace != 0
    ):
        raise ValueError("PNG must be bounded, non-interlaced RGBA8.")
    compressed = b"".join(data for chunk_type, data in chunks if chunk_type == b"IDAT")
    expected_size = height * (1 + width * 4)
    inflater = zlib.decompressobj()
    decoded = inflater.decompress(compressed, expected_size + 1)
    if (
        len(decoded) != expected_size
        or inflater.unused_data
        or inflater.unconsumed_tail
        or not inflater.eof
        or inflater.flush()
    ):
        raise ValueError("PNG image data does not match its declared RGBA8 dimensions.")
    row_size = 1 + width * 4
    if any(decoded[row * row_size] > 4 for row in range(height)):
        raise ValueError("PNG contains an invalid scanline filter.")
    return {
        "height_px": height,
        "mode": "RGBA8",
        "pixels": width * height,
        "width_px": width,
    }


def _inventory_regular_files(root: Path) -> dict[str, Path]:
    _reject_link_like_ancestors(root)
    try:
        root_status = root.stat(follow_symlinks=False)
    except OSError as error:
        raise ValueError("Unable to inspect actor-package root.") from error
    if not stat.S_ISDIR(root_status.st_mode) or _is_reparse(root_status):
        raise ValueError("Actor-package root must be a real directory.")
    files: dict[str, Path] = {}
    directories: set[str] = set()
    stack: list[tuple[Path, PurePosixPath | None]] = [(root, None)]
    total_bytes = 0
    total_entries = 0
    while stack:
        directory, relative_parent = stack.pop()
        try:
            entries: list[os.DirEntry[str]] = []
            with os.scandir(directory) as iterator:
                for entry in iterator:
                    total_entries += 1
                    if total_entries > MAX_PACKAGE_FILES + 1:
                        raise ValueError("Actor package exceeds its filesystem-entry ceiling.")
                    entries.append(entry)
        except OSError as error:
            raise ValueError("Unable to enumerate actor-package directory.") from error
        for entry in sorted(entries, key=lambda item: item.name):
            if entry.name in {".", ".."} or "\0" in entry.name:
                raise ValueError("Actor-package entry name is unsafe.")
            relative = (
                PurePosixPath(entry.name)
                if relative_parent is None
                else relative_parent / entry.name
            )
            normalized = _safe_relative_path(relative.as_posix()).as_posix()
            try:
                status_result = entry.stat(follow_symlinks=False)
            except OSError as error:
                raise ValueError("Unable to inspect actor-package entry.") from error
            if entry.is_symlink() or _is_reparse(status_result):
                raise ValueError("Actor package must not contain links or reparse points.")
            path = Path(entry.path)
            if stat.S_ISDIR(status_result.st_mode):
                if normalized != "textures":
                    raise ValueError("Actor package directory shape is outside policy.")
                directories.add(normalized)
                stack.append((path, relative))
                continue
            _validate_regular_status(status_result, path)
            if normalized in files:
                raise ValueError("Actor package contains duplicate file paths.")
            files[normalized] = path
            total_bytes += status_result.st_size
            if len(files) > MAX_PACKAGE_FILES or total_bytes > MAX_PACKAGE_BYTES:
                raise ValueError("Actor package exceeds file-count or byte policy.")
    folded = [path.casefold() for path in files]
    if len(folded) != len(set(folded)):
        raise ValueError("Actor package contains case-colliding paths.")
    allowed_directories = {
        parent.as_posix() for path in files for parent in _parents_without_dot(PurePosixPath(path))
    }
    if directories != allowed_directories:
        raise ValueError("Actor package contains empty or undeclared directories.")
    return files


def _read_regular_file(path: Path, limit: int) -> bytes:
    _reject_link_like_ancestors(path)
    try:
        before = path.stat(follow_symlinks=False)
    except OSError as error:
        raise ValueError(f"Unable to inspect actor-package file: {path.name}") from error
    _validate_regular_status(before, path)
    if before.st_size > limit:
        raise ValueError(f"Actor-package file exceeds its byte ceiling: {path.name}")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(
            f"Unable to open actor-package file without following links: {path.name}"
        ) from error
    try:
        opened = os.fstat(descriptor)
        _validate_regular_status(opened, path)
        if not os.path.samestat(before, opened):
            raise ValueError("Actor-package file changed before it was opened.")
        blocks: list[bytes] = []
        total = 0
        while True:
            block = os.read(descriptor, min(1024 * 1024, limit + 1 - total))
            if not block:
                break
            total += len(block)
            if total > limit:
                raise ValueError(f"Actor-package file exceeds its byte ceiling: {path.name}")
            blocks.append(block)
        after = os.fstat(descriptor)
        if (
            not os.path.samestat(opened, after)
            or after.st_size != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
            or total != after.st_size
        ):
            raise ValueError("Actor-package file changed while it was read.")
    finally:
        os.close(descriptor)
    current = path.stat(follow_symlinks=False)
    if _is_link_like(path) or not os.path.samestat(opened, current):
        raise ValueError("Actor-package file path changed while it was read.")
    return b"".join(blocks)


def _recheck_source_tree(source_root: Path, expected: Mapping[str, tuple[int, int, str]]) -> None:
    current = _inventory_regular_files(source_root)
    if set(current) != set(expected):
        raise ValueError("Actor-package source tree changed during snapshot.")
    for relative, path in current.items():
        payload = _read_regular_file(path, _limit_for_relative_path(relative))
        status_result = path.stat(follow_symlinks=False)
        identity = (len(payload), status_result.st_mtime_ns, sha256_bytes(payload))
        if identity != expected[relative]:
            raise ValueError("Actor-package source content changed during snapshot.")


def _seal_snapshot_tree(root: Path) -> None:
    entries = list(root.rglob("*"))
    directories: list[Path] = []
    for path in entries:
        status_result = path.stat(follow_symlinks=False)
        if _is_reparse(status_result) or stat.S_ISLNK(status_result.st_mode):
            raise ValueError("Verified actor-package snapshot contains a link.")
        if stat.S_ISDIR(status_result.st_mode):
            directories.append(path)
        elif stat.S_ISREG(status_result.st_mode):
            os.chmod(path, 0o400, follow_symlinks=False)
        else:
            raise ValueError("Verified actor-package snapshot contains an unsafe entry.")
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        os.chmod(directory, 0o500, follow_symlinks=False)
    os.chmod(root, 0o500, follow_symlinks=False)


def _recheck_verified_snapshot(verified: VerifiedActorPackage) -> None:
    files = _inventory_regular_files(verified.root)
    expected = dict(verified.file_sha256)
    if set(files) != set(expected):
        raise ValueError("Verified actor-package snapshot changed while in use.")
    for relative, path in files.items():
        payload = _read_regular_file(path, _limit_for_relative_path(relative))
        if sha256_bytes(payload) != expected[relative]:
            raise ValueError("Verified actor-package snapshot changed while in use.")


def _restore_snapshot_tree_modes(root: Path) -> None:
    try:
        root_status = root.stat(follow_symlinks=False)
    except OSError:
        return
    if (
        not stat.S_ISDIR(root_status.st_mode)
        or stat.S_ISLNK(root_status.st_mode)
        or _is_reparse(root_status)
    ):
        return
    try:
        os.chmod(root, 0o700, follow_symlinks=False)
    except OSError:
        return
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        current = Path(directory)
        for name in directory_names:
            path = current / name
            try:
                status_result = path.stat(follow_symlinks=False)
                if stat.S_ISDIR(status_result.st_mode) and not _is_reparse(status_result):
                    os.chmod(path, 0o700, follow_symlinks=False)
            except OSError:
                continue
        for name in file_names:
            path = current / name
            try:
                status_result = path.stat(follow_symlinks=False)
                if stat.S_ISREG(status_result.st_mode) and not _is_reparse(status_result):
                    os.chmod(path, 0o600, follow_symlinks=False)
            except OSError:
                continue


def _remove_snapshot_tree(root: Path) -> None:
    try:
        status_result = root.stat(follow_symlinks=False)
    except OSError:
        return
    if stat.S_ISLNK(status_result.st_mode) or _is_reparse(status_result):
        try:
            root.rmdir() if stat.S_ISDIR(status_result.st_mode) else root.unlink()
        except OSError:
            return
        return
    if stat.S_ISDIR(status_result.st_mode):
        _restore_snapshot_tree_modes(root)
        shutil.rmtree(root, ignore_errors=True)
        return
    try:
        os.chmod(root, 0o600, follow_symlinks=False)
        root.unlink()
    except OSError:
        return


def _limit_for_relative_path(relative: str) -> int:
    if relative == MANIFEST_FILENAME:
        return MAX_MANIFEST_BYTES
    if relative == GLB_FILENAME:
        return MAX_GLB_BYTES
    if relative.startswith("textures/") and relative.endswith(".png"):
        return MAX_TEXTURE_BYTES
    return MAX_TEXTURE_BYTES


def _safe_relative_path(value: str) -> PurePosixPath:
    if not value or "\\" in value or "\0" in value or ":" in value:
        raise ValueError(f"Actor-package path is unsafe: {value!r}")
    try:
        value.encode("ascii")
    except UnicodeEncodeError as error:
        raise ValueError("Actor-package paths must be ASCII.") from error
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or not path.parts
        or path.as_posix() != value
        or any(part in {"", ".", ".."} for part in path.parts)
        or any(not _NAME.fullmatch(part) for part in path.parts)
        or any(part.endswith(".") for part in path.parts)
        or any(part.split(".", 1)[0].casefold() in _WINDOWS_DEVICE_NAMES for part in path.parts)
    ):
        raise ValueError(f"Actor-package path is unsafe: {value!r}")
    return path


def _parents_without_dot(path: PurePosixPath) -> tuple[PurePosixPath, ...]:
    result: list[PurePosixPath] = []
    parent = path.parent
    while parent != PurePosixPath("."):
        result.append(parent)
        parent = parent.parent
    return tuple(result)


def _validate_regular_status(status_result: os.stat_result, path: Path) -> None:
    if not stat.S_ISREG(status_result.st_mode):
        raise ValueError(f"Actor-package entry must be a regular file: {path.name}")
    if status_result.st_nlink != 1:
        raise ValueError(f"Actor-package file must not be hard-linked: {path.name}")
    if _is_reparse(status_result):
        raise ValueError(f"Actor-package file must not be a reparse point: {path.name}")
    if status_result.st_size > MAX_PACKAGE_BYTES:
        raise ValueError(f"Actor-package file exceeds policy: {path.name}")


def _is_reparse(status_result: os.stat_result) -> bool:
    attributes = getattr(status_result, "st_file_attributes", 0)
    return bool(attributes & _REPARSE_ATTRIBUTE)


def _is_link_like(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", lambda: False)
    return path.is_symlink() or bool(is_junction())


def _reject_link_like_ancestors(path: Path) -> None:
    cursor = path.absolute()
    while True:
        if _is_link_like(cursor):
            raise ValueError(f"Actor-package path contains a link or junction: {cursor}")
        try:
            status_result = cursor.stat(follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            if _is_reparse(status_result):
                raise ValueError(f"Actor-package path contains a reparse point: {cursor}")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _canonical_json_object(label: str, payload: bytes) -> dict[str, object]:
    document = _decode_json_object(label, payload)
    if payload != canonical_json_bytes(document):
        raise ValueError(f"{label} must use canonical JSON encoding.")
    return document


def _decode_json_object(label: str, payload: bytes) -> dict[str, object]:
    if payload.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"{label} must not contain a UTF-8 BOM.")
    try:
        document = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=lambda value: _raise_json_constant(value),
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to decode {label} as strict JSON.") from error
    if not isinstance(document, dict) or not all(isinstance(key, str) for key in document):
        raise ValueError(f"{label} must contain one JSON object.")
    return document


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _raise_json_constant(value: str) -> None:
    raise ValueError(f"Unsupported JSON numeric constant: {value}")


def _json_exact_equal(actual: object, expected: object) -> bool:
    """Compare JSON values recursively without Python's bool/int/float aliases."""
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and set(actual) == set(expected)
            and all(
                _json_exact_equal(actual[key], expected_value)
                for key, expected_value in expected.items()
            )
        )
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(expected)
            and all(
                _json_exact_equal(actual_value, expected_value)
                for actual_value, expected_value in zip(actual, expected, strict=True)
            )
        )
    if expected is None:
        return actual is None
    if isinstance(expected, bool):
        return isinstance(actual, bool) and actual is expected
    if isinstance(expected, int):
        return type(actual) is int and actual == expected
    if isinstance(expected, float):
        return type(actual) is float and actual == expected
    if isinstance(expected, str):
        return isinstance(actual, str) and actual == expected
    return type(actual) is type(expected) and actual == expected


def _validate_json_shape(document: object) -> None:
    def visit(value: object, depth: int) -> None:
        if depth > 24:
            raise ValueError("GLB JSON nesting exceeds policy.")
        if isinstance(value, dict):
            if len(value) > 512:
                raise ValueError("GLB JSON object exceeds policy.")
            for key, item in value.items():
                if not isinstance(key, str) or len(key) > 128:
                    raise ValueError("GLB JSON key exceeds policy.")
                if key in {"extensions", "extras"}:
                    raise ValueError("GLB extensions and extras are unsupported.")
                visit(item, depth + 1)
        elif isinstance(value, list):
            if len(value) > MAX_VERTICES * 3:
                raise ValueError("GLB JSON array exceeds policy.")
            for item in value:
                visit(item, depth + 1)
        elif isinstance(value, str):
            if len(value) > 512:
                raise ValueError("GLB JSON string exceeds policy.")
        elif isinstance(value, float) and not math.isfinite(value):
            raise ValueError("GLB JSON contains NaN or infinity.")

    visit(document, 0)


def _expect_keys(mapping: Mapping[str, object], expected: set[str], location: str) -> None:
    actual = set(mapping)
    if actual != expected:
        raise ValueError(
            f"Unexpected keys at {location}; missing={sorted(expected - actual)}, "
            f"extra={sorted(actual - expected)}."
        )


def _expect_allowed_keys(
    mapping: Mapping[str, object],
    required: set[str],
    optional: set[str],
    location: str,
) -> None:
    actual = set(mapping)
    if not required <= actual or not actual <= required | optional:
        raise ValueError(
            f"Unexpected keys at {location}; missing={sorted(required - actual)}, "
            f"extra={sorted(actual - required - optional)}."
        )


def _object(mapping: Mapping[str, object], key: str) -> dict[str, object]:
    value = mapping.get(key)
    if not isinstance(value, dict) or not all(isinstance(name, str) for name in value):
        raise ValueError(f"Expected object at {key}.")
    return value


def _object_list(mapping: Mapping[str, object], key: str) -> list[dict[str, object]]:
    value = mapping.get(key)
    if not isinstance(value, list):
        raise ValueError(f"Expected object array at {key}.")
    result: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict) or not all(isinstance(name, str) for name in item):
            raise ValueError(f"Expected object entries at {key}.")
        result.append(item)
    return result


def _string(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Expected string at {key}.")
    return value


def _string_list(mapping: Mapping[str, object], key: str) -> list[str]:
    value = mapping.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Expected string array at {key}.")
    return list(value)


def _integer(mapping: Mapping[str, object], key: str) -> int:
    value = mapping.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"Expected integer at {key}.")
    return value


def _number(mapping: Mapping[str, object], key: str) -> int | float:
    value = mapping.get(key)
    if (
        not isinstance(value, int | float)
        or isinstance(value, bool)
        or not math.isfinite(float(value))
    ):
        raise ValueError(f"Expected finite number at {key}.")
    return value


def _integer_list(mapping: Mapping[str, object], key: str) -> list[int]:
    value = mapping.get(key)
    if not isinstance(value, list) or not all(
        isinstance(item, int) and not isinstance(item, bool) for item in value
    ):
        raise ValueError(f"Expected integer array at {key}.")
    return list(value)


def _optional_integer_list(mapping: Mapping[str, object], key: str) -> list[int]:
    if key not in mapping:
        return []
    return _integer_list(mapping, key)


def _number_list(mapping: Mapping[str, object], key: str, length: int) -> list[float]:
    value = mapping.get(key)
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"Expected {length} numbers at {key}.")
    result: list[float] = []
    for item in value:
        if (
            not isinstance(item, int | float)
            or isinstance(item, bool)
            or not math.isfinite(float(item))
        ):
            raise ValueError(f"Expected finite numbers at {key}.")
        result.append(float(item))
    return result


def _optional_number_list(
    mapping: Mapping[str, object], key: str, length: int, default: list[float]
) -> list[float]:
    if key not in mapping:
        return default
    return _number_list(mapping, key, length)


def _optional_integer(mapping: Mapping[str, object], key: str, default: int) -> int:
    if key not in mapping:
        return default
    return _integer(mapping, key)


def _optional_integer_or_none(mapping: Mapping[str, object], key: str) -> int | None:
    if key not in mapping:
        return None
    return _integer(mapping, key)


def _sha256_value(mapping: Mapping[str, object], key: str) -> str:
    return _require_sha256(_string(mapping, key), key)


def _require_sha256(value: str, location: str) -> str:
    if not _SHA256.fullmatch(value):
        raise ValueError(f"Expected lowercase SHA-256 at {location}.")
    return value


def _identifier(value: str, location: str) -> str:
    if len(value) > MAX_NAME_LENGTH or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Expected stable lowercase identifier at {location}.")
    return value


def _name(value: str, location: str) -> str:
    if len(value) > MAX_NAME_LENGTH or not _NAME.fullmatch(value):
        raise ValueError(f"Expected bounded ASCII name at {location}.")
    return value


def _ascii_text(value: str, maximum: int, location: str) -> str:
    try:
        value.encode("ascii")
    except UnicodeEncodeError as error:
        raise ValueError(f"Expected ASCII text at {location}.") from error
    if not value or len(value) > maximum:
        raise ValueError(f"Expected bounded text at {location}.")
    return value


def _bounded_positive(value: int, maximum: int, location: str) -> int:
    if not 1 <= value <= maximum:
        raise ValueError(f"{location} is outside policy.")
    return value


def _bounded_nonnegative(value: int, maximum: int, location: str) -> int:
    if not 0 <= value <= maximum:
        raise ValueError(f"{location} is outside policy.")
    return value


def _index(value: int, length: int, location: str) -> int:
    if not 0 <= value < length:
        raise ValueError(f"{location} is out of range.")
    return value


def _trs_matrix4(
    translation: Sequence[float], rotation: Sequence[float], scale: Sequence[float]
) -> tuple[float, ...]:
    x, y, z, w = rotation
    sx, sy, sz = scale
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    xw, yw, zw = x * w, y * w, z * w
    return (
        (1.0 - 2.0 * (yy + zz)) * sx,
        2.0 * (xy - zw) * sy,
        2.0 * (xz + yw) * sz,
        translation[0],
        2.0 * (xy + zw) * sx,
        (1.0 - 2.0 * (xx + zz)) * sy,
        2.0 * (yz - xw) * sz,
        translation[1],
        2.0 * (xz - yw) * sx,
        2.0 * (yz + xw) * sy,
        (1.0 - 2.0 * (xx + yy)) * sz,
        translation[2],
        0.0,
        0.0,
        0.0,
        1.0,
    )


def _multiply_matrix4(left: Sequence[float], right: Sequence[float]) -> tuple[float, ...]:
    if len(left) != 16 or len(right) != 16:
        raise ValueError("Expected two 4x4 matrices.")
    return tuple(
        sum(left[row * 4 + item] * right[item * 4 + column] for item in range(4))
        for row in range(4)
        for column in range(4)
    )


def _gltf_matrix4_to_row_major(values: Sequence[float]) -> tuple[float, ...]:
    if len(values) != 16:
        raise ValueError("Expected a glTF 4x4 matrix.")
    return tuple(values[column * 4 + row] for row in range(4) for column in range(4))


def _matrix4_close(
    left: Sequence[float], right: Sequence[float], *, tolerance: float = 1e-5
) -> bool:
    return len(left) == len(right) == 16 and all(
        abs(actual - expected) <= tolerance for actual, expected in zip(left, right, strict=True)
    )


def _determinant4(values: tuple[float, ...]) -> float:
    if len(values) != 16:
        raise ValueError("Expected a 4x4 matrix.")
    # glTF stores matrices column-major; determinant is unchanged by transposition.
    a = [list(values[row * 4 : row * 4 + 4]) for row in range(4)]
    determinant = 1.0
    for column in range(4):
        pivot = max(range(column, 4), key=lambda row: abs(a[row][column]))
        if abs(a[pivot][column]) < 1e-12:
            return 0.0
        if pivot != column:
            a[pivot], a[column] = a[column], a[pivot]
            determinant *= -1.0
        pivot_value = a[column][column]
        determinant *= pivot_value
        for row in range(column + 1, 4):
            factor = a[row][column] / pivot_value
            for item in range(column + 1, 4):
                a[row][item] -= factor * a[column][item]
    return determinant


def _unescape_mount_field(value: str) -> str:
    return (
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )
