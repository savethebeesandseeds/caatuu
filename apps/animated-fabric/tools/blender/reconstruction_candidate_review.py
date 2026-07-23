"""Pure-Python contract checks and camera math for AF-045 candidate review."""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CANDIDATE_FORMAT = "animated-fabric.reconstruction-candidate.v1"
CANDIDATE_SCHEMA_VERSION = "1.0.0"
REVIEW_FORMAT = "animated-fabric.reconstruction-review.v1"
REVIEW_SCHEMA_VERSION = "0.1.0"

CANDIDATE_FILES = frozenset({"candidate.json", "input.png", "mesh.glb"})
MAX_MANIFEST_BYTES = 256 * 1024
MAX_INPUT_BYTES = 4 * 1024 * 1024
MAX_MESH_BYTES = 256 * 1024 * 1024
MAX_GLB_JSON_BYTES = 4 * 1024 * 1024
MAX_GLTF_ACCESSORS = 128
MAX_GLTF_BUFFER_VIEWS = 128
MAX_GLTF_MATERIALS = 32
MAX_GLTF_MESHES = 32
MAX_GLTF_NODES = 64
MAX_GLTF_PRIMITIVES = 64
MAX_VERTICES = 5_000_000
MAX_TRIANGLES = 10_000_000
NORMALIZED_SIZE = (512, 512)

EXPECTED_PROVIDER = {
    "dino_model_id": "facebook/dino-vitb16",
    "dino_model_revision": "f205d5d8e640a89a2b8ef0369670dfc37cc07fc2",
    "id": "triposr",
    "model_id": "stabilityai/TripoSR",
    "model_revision": "5b521936b01fbe1890f6f9baed0254ab6351c04a",
    "pymcubes_version": "0.1.6",
    "pymcubes_wheel_sha256": ("ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5"),
    "source_revision": "d26e33181947bbbc4c6fc0f5734e1ec6c080956e",
}
PARAMETER_KEYS = {
    "chunk_size",
    "device",
    "foreground_ratio",
    "mc_resolution",
    "vertex_colors",
}
ALLOWED_CHUNK_SIZES = frozenset({1024, 2048, 4096, 8192})
ALLOWED_MC_RESOLUTIONS = frozenset({128, 192, 256})

_CANDIDATE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_TOP_LEVEL_KEYS = {
    "candidate_id",
    "format",
    "mesh",
    "parameters",
    "preprocessing",
    "provider",
    "review",
    "runtime",
    "schema_version",
    "source",
    "status",
}


@dataclass(frozen=True, slots=True)
class CandidateProposal:
    """Verified immutable facts consumed by the Blender review worker."""

    candidate_id: str
    chunk_size: int
    foreground_ratio: float
    input_bytes: int
    input_path: Path
    input_sha256: str
    manifest_path: Path
    manifest_sha256: str
    mc_resolution: int
    mesh_bytes: int
    mesh_path: Path
    mesh_sha256: str
    provider: tuple[tuple[str, str], ...]
    root: Path
    triangles: int
    vertices: int


@dataclass(frozen=True, slots=True)
class ViewSpec:
    """One named camera direction in TripoSR's x-back, y-right, z-up frame."""

    view_id: str
    direction: tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class Framing:
    """One shared orthographic framing for every fixed review view."""

    camera_distance: float
    clip_end: float
    clip_start: float
    ortho_scale: float
    radius: float
    target: tuple[float, float, float]


_SQRT_HALF = math.sqrt(0.5)
VIEW_SPECS = (
    ViewSpec("front", (-1.0, 0.0, 0.0)),
    ViewSpec("left", (0.0, -1.0, 0.0)),
    ViewSpec("back", (1.0, 0.0, 0.0)),
    ViewSpec("front-right-3q", (-_SQRT_HALF, _SQRT_HALF, 0.0)),
)


def sha256_file(path: Path) -> str:
    """Return the SHA-256 digest of one bounded regular file."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_bytes(document: Mapping[str, Any]) -> bytes:
    """Encode the canonical JSON form used by AF-045 evidence."""
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


def _reject_constant(value: str) -> None:
    raise ValueError(f"Candidate JSON contains unsupported constant {value}.")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Candidate JSON repeats key {key}.")
        result[key] = value
    return result


def _object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"Candidate {context} must be a JSON object.")
    return value


def _string(record: Mapping[str, object], key: str, context: str) -> str:
    value = record.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Candidate {context}.{key} must be a string.")
    return value


def _positive_integer(
    record: Mapping[str, object],
    key: str,
    context: str,
    maximum: int,
) -> int:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= maximum:
        raise ValueError(f"Candidate {context}.{key} is outside policy.")
    return value


def _sha256(record: Mapping[str, object], key: str, context: str) -> str:
    value = _string(record, key, context)
    if _SHA256.fullmatch(value) is None:
        raise ValueError(f"Candidate {context}.{key} is not a SHA-256 digest.")
    return value


def _finite_number(record: Mapping[str, object], key: str, context: str) -> float:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Candidate {context}.{key} must be a finite number.")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Candidate {context}.{key} must be a finite number.")
    return result


def _array(value: object, context: str, maximum: int) -> list[object]:
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"Candidate GLB {context} is outside policy.")
    return value


def validate_candidate_id(candidate_id: str) -> str:
    """Require the portable identifier shared by generation and review."""
    if _CANDIDATE_ID.fullmatch(candidate_id) is None:
        raise ValueError("Candidate ID is outside the portable AF-045 policy.")
    return candidate_id


def _regular_file(root: Path, name: str, maximum: int) -> Path:
    path = root / name
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Candidate {name} must be one regular file.")
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Candidate {name} escapes its proposal root.") from error
    size = resolved.stat().st_size
    if not 0 < size <= maximum:
        raise ValueError(f"Candidate {name} is outside its byte ceiling.")
    return resolved


def _validate_normalized_png(path: Path) -> None:
    with path.open("rb") as stream:
        header = stream.read(33)
    if len(header) != 33 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Candidate input.png is not a PNG.")
    chunk_length, chunk_type = struct.unpack(">I4s", header[8:16])
    if chunk_length != 13 or chunk_type != b"IHDR":
        raise ValueError("Candidate input.png has an invalid PNG header.")
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", header[16:29]
    )
    if (width, height) != NORMALIZED_SIZE or (depth, color_type) != (8, 2):
        raise ValueError("Candidate input.png is not the canonical 512 px RGB input.")
    if (compression, filtering, interlace) != (0, 0, 0):
        raise ValueError("Candidate input.png uses unsupported PNG encoding.")


def _validate_glb(path: Path) -> None:
    with path.open("rb") as stream:
        header = stream.read(20)
        if len(header) != 20:
            raise ValueError("Candidate mesh.glb has a truncated header.")
        magic, version, declared_length, json_length, json_type = struct.unpack("<4sIII4s", header)
        if magic != b"glTF" or version != 2 or declared_length != path.stat().st_size:
            raise ValueError("Candidate mesh.glb has an invalid GLB 2 header.")
        if (
            json_type != b"JSON"
            or not 0 < json_length <= MAX_GLB_JSON_BYTES
            or 20 + json_length > declared_length
        ):
            raise ValueError("Candidate mesh.glb has an invalid first JSON chunk.")
        json_payload = stream.read(json_length)
    if len(json_payload) != json_length:
        raise ValueError("Candidate mesh.glb has a truncated JSON chunk.")
    try:
        document_value = json.loads(
            json_payload.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Candidate mesh.glb has invalid embedded glTF JSON.") from error
    document = _object(document_value, "GLB JSON")

    asset = _object(document.get("asset"), "GLB asset")
    if _string(asset, "version", "GLB asset") != "2.0":
        raise ValueError("Candidate GLB asset version must be 2.0.")
    for forbidden in (
        "animations",
        "cameras",
        "extensionsRequired",
        "extensionsUsed",
        "images",
        "samplers",
        "skins",
        "textures",
    ):
        if forbidden in document:
            raise ValueError(f"Candidate GLB must not declare {forbidden}.")

    buffers = _array(document.get("buffers"), "buffers", 1)
    if len(buffers) != 1:
        raise ValueError("Candidate GLB must contain exactly one embedded buffer.")
    buffer = _object(buffers[0], "GLB buffer")
    if "uri" in buffer:
        raise ValueError("Candidate GLB buffer must be embedded.")
    buffer_bytes = _positive_integer(buffer, "byteLength", "GLB buffer", MAX_MESH_BYTES)
    binary_header_offset = 20 + json_length
    with path.open("rb") as stream:
        stream.seek(binary_header_offset)
        binary_header = stream.read(8)
    if len(binary_header) != 8:
        raise ValueError("Candidate GLB has no embedded binary chunk.")
    binary_length, binary_type = struct.unpack("<I4s", binary_header)
    if (
        binary_type != b"BIN\x00"
        or binary_length < buffer_bytes
        or binary_length - buffer_bytes > 3
        or binary_header_offset + 8 + binary_length != declared_length
    ):
        raise ValueError("Candidate GLB embedded buffer length is invalid.")

    accessors = _array(document.get("accessors"), "accessors", MAX_GLTF_ACCESSORS)
    buffer_views = _array(
        document.get("bufferViews"),
        "bufferViews",
        MAX_GLTF_BUFFER_VIEWS,
    )
    nodes = _array(document.get("nodes"), "nodes", MAX_GLTF_NODES)
    meshes = _array(document.get("meshes"), "meshes", MAX_GLTF_MESHES)
    scenes = _array(document.get("scenes"), "scenes", 1)
    if not accessors or not buffer_views or not nodes or not meshes or len(scenes) != 1:
        raise ValueError("Candidate GLB has an incomplete bounded scene.")
    scene_index = document.get("scene")
    if isinstance(scene_index, bool) or scene_index != 0:
        raise ValueError("Candidate GLB must select its only scene.")
    materials_value = document.get("materials", [])
    _array(materials_value, "materials", MAX_GLTF_MATERIALS)

    primitive_count = 0
    for mesh_index, mesh_value in enumerate(meshes):
        mesh = _object(mesh_value, f"GLB mesh {mesh_index}")
        primitives = _array(
            mesh.get("primitives"),
            f"mesh {mesh_index} primitives",
            MAX_GLTF_PRIMITIVES,
        )
        if not primitives:
            raise ValueError("Candidate GLB mesh has no primitives.")
        primitive_count += len(primitives)
        if primitive_count > MAX_GLTF_PRIMITIVES:
            raise ValueError("Candidate GLB exceeds the primitive ceiling.")
        for primitive_index, primitive_value in enumerate(primitives):
            context = f"GLB mesh {mesh_index} primitive {primitive_index}"
            primitive = _object(primitive_value, context)
            attributes = _object(primitive.get("attributes"), f"{context} attributes")
            if "POSITION" not in attributes or "COLOR_0" not in attributes:
                raise ValueError("Candidate GLB primitive must contain POSITION and COLOR_0.")
            for accessor in attributes.values():
                if (
                    isinstance(accessor, bool)
                    or not isinstance(accessor, int)
                    or not 0 <= accessor < len(accessors)
                ):
                    raise ValueError("Candidate GLB attribute accessor is malformed.")
            indices = primitive.get("indices")
            if (
                isinstance(indices, bool)
                or not isinstance(indices, int)
                or not 0 <= indices < len(accessors)
            ):
                raise ValueError("Candidate GLB primitive must use indexed triangles.")
            mode = primitive.get("mode", 4)
            if isinstance(mode, bool) or mode != 4:
                raise ValueError("Candidate GLB primitive mode must be TRIANGLES.")
            if "targets" in primitive or "extensions" in primitive:
                raise ValueError("Candidate GLB primitive contains unsupported behavior.")


def verify_candidate(
    root: Path,
    *,
    expected_candidate_id: str | None = None,
) -> CandidateProposal:
    """Verify one exact, immutable AF-045 proposal directory."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Candidate root must be one real directory.")
    resolved_root = root.resolve(strict=True)
    entries = tuple(resolved_root.iterdir())
    if {entry.name for entry in entries} != CANDIDATE_FILES:
        raise ValueError("Candidate directory does not contain the exact AF-045 file set.")

    manifest_path = _regular_file(resolved_root, "candidate.json", MAX_MANIFEST_BYTES)
    input_path = _regular_file(resolved_root, "input.png", MAX_INPUT_BYTES)
    mesh_path = _regular_file(resolved_root, "mesh.glb", MAX_MESH_BYTES)
    manifest_bytes = manifest_path.read_bytes()
    try:
        document_value = json.loads(
            manifest_bytes.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Candidate manifest is not canonical UTF-8 JSON.") from error
    document = _object(document_value, "manifest")
    if set(document) != _TOP_LEVEL_KEYS:
        raise ValueError("Candidate manifest has unexpected top-level fields.")
    if canonical_json_bytes(document) != manifest_bytes:
        raise ValueError("Candidate manifest is not in canonical JSON form.")
    if _string(document, "format", "manifest") != CANDIDATE_FORMAT:
        raise ValueError("Candidate format is unsupported.")
    if _string(document, "schema_version", "manifest") != CANDIDATE_SCHEMA_VERSION:
        raise ValueError("Candidate schema version is unsupported.")
    candidate_id = validate_candidate_id(_string(document, "candidate_id", "manifest"))
    if expected_candidate_id is not None:
        expected_candidate_id = validate_candidate_id(expected_candidate_id)
        if candidate_id != expected_candidate_id:
            raise ValueError("Candidate ID disagrees with the selected proposal directory.")
    if _string(document, "status", "manifest") != "proposal":
        raise ValueError("Candidate status must remain proposal.")

    preprocessing = _object(document.get("preprocessing"), "preprocessing")
    if _string(preprocessing, "output", "preprocessing") != "input.png":
        raise ValueError("Candidate preprocessing output must be input.png.")
    input_bytes = _positive_integer(
        preprocessing,
        "output_bytes",
        "preprocessing",
        MAX_INPUT_BYTES,
    )
    input_sha256 = _sha256(preprocessing, "output_sha256", "preprocessing")

    provider = _object(document.get("provider"), "provider")
    if provider != EXPECTED_PROVIDER:
        raise ValueError("Candidate provider identity is not the pinned AF-045 baseline.")

    parameters = _object(document.get("parameters"), "parameters")
    if set(parameters) != PARAMETER_KEYS:
        raise ValueError("Candidate reconstruction parameters have unexpected fields.")
    chunk_size = _positive_integer(
        parameters,
        "chunk_size",
        "parameters",
        max(ALLOWED_CHUNK_SIZES),
    )
    if chunk_size not in ALLOWED_CHUNK_SIZES:
        raise ValueError("Candidate parameters.chunk_size is outside policy.")
    if _string(parameters, "device", "parameters") != "cuda:0":
        raise ValueError("Candidate reconstruction device must be cuda:0.")
    foreground_ratio = _finite_number(parameters, "foreground_ratio", "parameters")
    if not 0.5 <= foreground_ratio <= 0.95:
        raise ValueError("Candidate parameters.foreground_ratio is outside policy.")
    mc_resolution = _positive_integer(
        parameters,
        "mc_resolution",
        "parameters",
        max(ALLOWED_MC_RESOLUTIONS),
    )
    if mc_resolution not in ALLOWED_MC_RESOLUTIONS:
        raise ValueError("Candidate parameters.mc_resolution is outside policy.")
    if parameters.get("vertex_colors") is not True:
        raise ValueError("Candidate must explicitly require vertex colors.")

    mesh = _object(document.get("mesh"), "mesh")
    if _string(mesh, "path", "mesh") != "mesh.glb":
        raise ValueError("Candidate mesh path must be mesh.glb.")
    if _string(mesh, "media_type", "mesh") != "model/gltf-binary":
        raise ValueError("Candidate mesh media type is unsupported.")
    mesh_bytes = _positive_integer(mesh, "bytes", "mesh", MAX_MESH_BYTES)
    mesh_sha256 = _sha256(mesh, "sha256", "mesh")
    vertices = _positive_integer(mesh, "vertices", "mesh", MAX_VERTICES)
    triangles = _positive_integer(mesh, "triangles", "mesh", MAX_TRIANGLES)

    review = _object(document.get("review"), "review")
    if _string(review, "decision", "review") != "pending":
        raise ValueError("Candidate must remain pending before Blender review.")

    if input_path.stat().st_size != input_bytes or sha256_file(input_path) != input_sha256:
        raise ValueError("Candidate normalized input disagrees with its manifest.")
    if mesh_path.stat().st_size != mesh_bytes or sha256_file(mesh_path) != mesh_sha256:
        raise ValueError("Candidate GLB disagrees with its manifest.")
    _validate_normalized_png(input_path)
    _validate_glb(mesh_path)

    return CandidateProposal(
        candidate_id=candidate_id,
        chunk_size=chunk_size,
        foreground_ratio=foreground_ratio,
        input_bytes=input_bytes,
        input_path=input_path,
        input_sha256=input_sha256,
        manifest_path=manifest_path,
        manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
        mc_resolution=mc_resolution,
        mesh_bytes=mesh_bytes,
        mesh_path=mesh_path,
        mesh_sha256=mesh_sha256,
        provider=tuple(sorted(EXPECTED_PROVIDER.items())),
        root=resolved_root,
        triangles=triangles,
        vertices=vertices,
    )


def framing_from_bounds(
    minimum: Sequence[float],
    maximum: Sequence[float],
) -> Framing:
    """Derive one bounded, shared orthographic frame from world-space bounds."""
    if len(minimum) != 3 or len(maximum) != 3:
        raise ValueError("Review bounds must contain exactly three axes.")
    low = tuple(float(value) for value in minimum)
    high = tuple(float(value) for value in maximum)
    if not all(math.isfinite(value) for value in (*low, *high)):
        raise ValueError("Review bounds must be finite.")
    if any(low[index] > high[index] for index in range(3)):
        raise ValueError("Review bounds are inverted.")
    diagonal = math.sqrt(sum((high[index] - low[index]) ** 2 for index in range(3)))
    if diagonal <= 1e-8:
        raise ValueError("Review geometry has degenerate world bounds.")
    target = tuple((low[index] + high[index]) * 0.5 for index in range(3))
    camera_distance = diagonal * 2.0
    return Framing(
        camera_distance=camera_distance,
        clip_end=camera_distance + diagonal * 2.0,
        clip_start=max(diagonal * 0.0001, 0.000001),
        ortho_scale=diagonal * 1.12,
        radius=diagonal * 0.5,
        target=target,
    )


def camera_location(framing: Framing, view: ViewSpec) -> tuple[float, float, float]:
    """Place one fixed camera around the shared target."""
    length = math.sqrt(sum(value * value for value in view.direction))
    if not math.isclose(length, 1.0, abs_tol=1e-12):
        raise ValueError(f"Review direction {view.view_id} is not normalized.")
    return tuple(
        framing.target[index] + view.direction[index] * framing.camera_distance
        for index in range(3)
    )
