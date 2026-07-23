"""Verify AF-056 macaw deformation evidence and optionally build a contact sheet."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import stat
import struct
import sys
import tempfile
import zlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

APP_ROOT = Path(__file__).resolve().parents[1]
BLENDER_TOOLS_ROOT = APP_ROOT / "tools/blender"
sys.path.insert(0, str(BLENDER_TOOLS_ROOT))

import actor_package  # noqa: E402
import avian_contract  # noqa: E402
import evidence  # noqa: E402

VALIDATION_FORMAT = "animated-fabric.macaw-deformation-validation.v1"
VALIDATION_SCHEMA_VERSION = "0.1.0"
EXPECTED_MANIFEST_SHA256 = "a26e95456963af80d2d468af19680855dd3c9fbe176d7c3bb0ceb4943ea759c7"
EXPECTED_MAPPING_SHA256 = "245b90ee0c71a9a001121939bdfbabaf34ed3c7c59e1060f0deb6669cf13296f"
EXPECTED_RIG_CONTRACT_SHA256 = "b8b4fe43bdb20c41870785df7aee2e315001cd9dcfd09df3e59ee308437169ec"
EXPECTED_POSE_CONTRACT_SHA256 = "8c192d6814505dd9699cc067611fa7137944605dc36f1133a4d10d43b57a8138"
MAPPING_PATH = APP_ROOT / "assets/actor-reviews/macaw-traveler-avian-v1/rig-mapping.json"
FRAME_SIZE = (256, 256)
VIEW_ORDER = ("front", "left", "back", "right")
VIEW_LOCATIONS: Mapping[str, tuple[float, float, float]] = {
    "front": (0.0, 5.0, 1.02),
    "left": (-5.0, 0.0, 1.02),
    "back": (0.0, -5.0, 1.02),
    "right": (5.0, 0.0, 1.02),
}
MAX_FRAME_BYTES = 2 * 1024 * 1024
MAX_VALIDATION_BYTES = 512 * 1024
MAX_EVIDENCE_BYTES = 32 * 1024 * 1024
GROUND_TOLERANCE_M = 0.0002
REST_TOLERANCE_M = 0.0001
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
FRAME_ORDER = tuple(
    (pose_id, view_id) for pose_id in avian_contract.POSE_ORDER for view_id in VIEW_ORDER
)
FRAME_PATHS = tuple(f"{pose_id}--{view_id}.png" for pose_id, view_id in FRAME_ORDER)


@dataclass(frozen=True, slots=True)
class _FileIdentity:
    device: int
    inode: int
    mode: int
    links: int
    size: int
    modified_ns: int


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_junction(path: Path) -> bool:
    return bool(getattr(path, "is_junction", lambda: False)())


def _identity(path: Path) -> _FileIdentity:
    status = path.stat(follow_symlinks=False)
    return _FileIdentity(
        status.st_dev,
        status.st_ino,
        status.st_mode,
        status.st_nlink,
        status.st_size,
        status.st_mtime_ns,
    )


def _closed_tree(root: Path) -> tuple[dict[str, Path], dict[str, _FileIdentity]]:
    if root.is_symlink() or _is_junction(root):
        raise ValueError("AF-056 evidence root must not be a link or junction.")
    if not root.is_dir():
        raise ValueError("AF-056 evidence root must be a directory.")
    expected = {*FRAME_PATHS, "validation.json"}
    files: dict[str, Path] = {}
    identities: dict[str, _FileIdentity] = {}
    try:
        for index, path in enumerate(root.iterdir()):
            if index >= len(expected):
                raise ValueError("AF-056 evidence tree has extra entries.")
            if path.is_symlink() or _is_junction(path):
                raise ValueError("AF-056 evidence must not contain links or junctions.")
            identity = _identity(path)
            if path.name not in expected or not stat.S_ISREG(identity.mode):
                raise ValueError("AF-056 evidence tree has an unexpected file or directory.")
            if identity.links != 1:
                raise ValueError("AF-056 evidence files must be singly linked regular files.")
            limit = MAX_VALIDATION_BYTES if path.name == "validation.json" else MAX_FRAME_BYTES
            if identity.size > limit:
                raise ValueError(f"AF-056 evidence file exceeds its byte ceiling: {path.name}.")
            files[path.name] = path
            identities[path.name] = identity
    except OSError as error:
        raise ValueError("AF-056 evidence tree cannot be safely inspected.") from error
    if set(files) != expected:
        raise ValueError("AF-056 evidence tree is not the exact 16-frame review tree.")
    if sum(item.size for item in identities.values()) > MAX_EVIDENCE_BYTES:
        raise ValueError("AF-056 evidence tree exceeds its total byte ceiling.")
    return files, identities


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> object:
    raise ValueError(f"Non-finite JSON constant: {value}")


def _canonical_json(path: Path) -> tuple[dict[str, object], bytes]:
    payload = path.read_bytes()
    try:
        document = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("AF-056 validation report is not strict UTF-8 JSON.") from error
    if not isinstance(document, dict):
        raise ValueError("AF-056 validation report must be a JSON object.")
    canonical = (
        json.dumps(document, allow_nan=False, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    if payload != canonical:
        raise ValueError("AF-056 validation report is not canonically encoded.")
    return document, payload


def _strict_equal(actual: object, expected: object) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and set(actual) == set(expected)
            and all(_strict_equal(actual[key], value) for key, value in expected.items())
        )
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(expected)
            and all(
                _strict_equal(left, right) for left, right in zip(actual, expected, strict=True)
            )
        )
    return actual == expected


def _expect_keys(value: Mapping[str, object], expected: set[str], location: str) -> None:
    if set(value) != expected:
        raise ValueError(f"AF-056 validation report has unexpected keys at {location}.")


def _object(value: object, location: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"AF-056 validation report expected an object at {location}.")
    return value


def _objects(value: object, location: str) -> list[dict[str, object]]:
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"AF-056 validation report expected an object list at {location}.")
    return value


def _finite(value: object, location: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"AF-056 validation report expected finite numeric data at {location}.")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"AF-056 validation report has non-finite data at {location}.")
    return result


def _number_map(value: object, expected: set[str], location: str) -> dict[str, float]:
    record = _object(value, location)
    if set(record) != expected:
        raise ValueError(f"AF-056 validation report has invalid bone keys at {location}.")
    return {key: _finite(raw, f"{location}.{key}") for key, raw in record.items()}


def _validate_png(payload: bytes, name: str) -> None:
    if not payload.startswith(_PNG_SIGNATURE):
        raise ValueError(f"AF-056 review frame is not a PNG: {name}.")
    offset = len(_PNG_SIGNATURE)
    chunks: list[bytes] = []
    while offset < len(payload):
        if offset + 12 > len(payload):
            raise ValueError(f"AF-056 review PNG contains a truncated chunk: {name}.")
        length = struct.unpack_from(">I", payload, offset)[0]
        end = offset + 12 + length
        if end > len(payload):
            raise ValueError(f"AF-056 review PNG chunk exceeds its file: {name}.")
        chunk_type = payload[offset + 4 : offset + 8]
        chunk_data = payload[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack_from(">I", payload, offset + 8 + length)[0]
        if zlib.crc32(chunk_data, zlib.crc32(chunk_type)) & 0xFFFFFFFF != expected_crc:
            raise ValueError(f"AF-056 review PNG has an invalid CRC: {name}.")
        chunks.append(chunk_type)
        offset = end
        if chunk_type == b"IEND":
            if chunk_data:
                raise ValueError(f"AF-056 review PNG has a nonempty IEND: {name}.")
            break
    if offset != len(payload):
        raise ValueError(f"AF-056 review PNG has trailing data: {name}.")
    if (
        len(chunks) < 3
        or chunks[0] != b"IHDR"
        or chunks[-1] != b"IEND"
        or chunks.count(b"IHDR") != 1
        or chunks.count(b"IEND") != 1
        or any(chunk != b"IDAT" for chunk in chunks[1:-1])
    ):
        raise ValueError(f"AF-056 review PNG is not canonical: {name}.")
    ihdr_length = struct.unpack_from(">I", payload, 8)[0]
    if ihdr_length != 13:
        raise ValueError(f"AF-056 review PNG has an invalid IHDR: {name}.")
    width, height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", payload[16:29]
    )
    if (
        (width, height) != FRAME_SIZE
        or (depth, color) != (8, 6)
        or (compression, filtering, interlace) != (0, 0, 0)
    ):
        raise ValueError(f"AF-056 review PNG is not canonical 256x256 RGBA8: {name}.")


def _inspect_frame(path: Path) -> tuple[dict[str, object], Image.Image]:
    payload = path.read_bytes()
    _validate_png(payload, path.name)
    try:
        with Image.open(io.BytesIO(payload)) as source:
            source.load()
            if source.format != "PNG" or source.mode != "RGBA" or source.size != FRAME_SIZE:
                raise ValueError(f"AF-056 review frame is not decoded RGBA8: {path.name}.")
            image = source.copy()
    except OSError as error:
        raise ValueError(f"AF-056 review frame cannot be decoded: {path.name}.") from error
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError(f"AF-056 review frame is fully transparent: {path.name}.")
    inclusive = [bounds[0], bounds[1], bounds[2] - 1, bounds[3] - 1]
    if inclusive[0] <= 0 or inclusive[1] <= 0 or inclusive[2] >= 255 or inclusive[3] >= 255:
        raise ValueError(f"AF-056 review frame touches a canvas edge: {path.name}.")
    return (
        {
            "alpha_bounds_xyxy": inclusive,
            "bytes": len(payload),
            "height_px": FRAME_SIZE[1],
            "mode": "RGBA8",
            "nontransparent_pixels": sum(value > 0 for value in alpha.tobytes()),
            "sha256": _sha256_bytes(payload),
            "width_px": FRAME_SIZE[0],
        },
        image,
    )


def _trusted_sources() -> dict[str, str]:
    paths = {
        "actor_package.py": BLENDER_TOOLS_ROOT / "actor_package.py",
        "avian_contract.py": BLENDER_TOOLS_ROOT / "avian_contract.py",
        "compose.yaml": APP_ROOT / "compose.yaml",
        "container.Dockerfile": APP_ROOT / "containers/blender/Dockerfile",
        "contracts/af056_review_poses.json": BLENDER_TOOLS_ROOT
        / "contracts/af056_review_poses.json",
        "contracts/avian_v1.json": BLENDER_TOOLS_ROOT / "contracts/avian_v1.json",
        "evidence.py": BLENDER_TOOLS_ROOT / "evidence.py",
        "output_paths.py": BLENDER_TOOLS_ROOT / "output_paths.py",
        "png_canonical.py": BLENDER_TOOLS_ROOT / "png_canonical.py",
        "render_actor_package.py": BLENDER_TOOLS_ROOT / "render_actor_package.py",
        "render_macaw_actor_review.py": BLENDER_TOOLS_ROOT / "render_macaw_actor_review.py",
    }
    return {name: _sha256(path) for name, path in paths.items()}


def _verify_deformation(
    value: object,
    poses: avian_contract.ReviewPoseContract,
    verified: actor_package.VerifiedActorPackage,
) -> None:
    deformation = _object(value, "deformation")
    if set(deformation) != set(avian_contract.POSE_ORDER):
        raise ValueError("AF-056 deformation evidence has an invalid pose set.")
    bones = set(avian_contract.BONE_ORDER[1:])
    topology = {key: verified.observations[key] for key in ("indices", "triangles", "vertices")}
    geometry_hashes: set[str] = set()
    for pose in poses.poses:
        record = _object(deformation[pose.pose_id], f"deformation.{pose.pose_id}")
        _expect_keys(
            record,
            {
                "bounds_m",
                "geometry_sha256",
                "max_vertex_displacement_m",
                "maximum_displacement_by_bone_m",
                "minimum_z_by_bone_m",
                "minimum_z_m",
                "rotations",
                "topology",
            },
            f"deformation.{pose.pose_id}",
        )
        digest = record.get("geometry_sha256")
        if not isinstance(digest, str) or _SHA256.fullmatch(digest) is None:
            raise ValueError("AF-056 deformation geometry digest is invalid.")
        geometry_hashes.add(digest)
        if not _strict_equal(record.get("topology"), topology):
            raise ValueError("AF-056 deformation topology is not bound to the actor package.")
        expected_rotations = [
            {
                "bone_id": rotation.bone_id,
                "local_euler_xyz_deg": list(rotation.local_euler_xyz_deg),
            }
            for rotation in pose.rotations
        ]
        if not _strict_equal(record.get("rotations"), expected_rotations):
            raise ValueError("AF-056 deformation rotations are not bound to the pose contract.")
        bounds = _object(record.get("bounds_m"), f"deformation.{pose.pose_id}.bounds_m")
        _expect_keys(bounds, {"max", "min"}, f"deformation.{pose.pose_id}.bounds_m")
        vectors: dict[str, list[float]] = {}
        for key in ("min", "max"):
            raw = bounds.get(key)
            if not isinstance(raw, list) or len(raw) != 3:
                raise ValueError("AF-056 deformation bounds are malformed.")
            vectors[key] = [
                _finite(item, f"deformation.{pose.pose_id}.bounds_m.{key}") for item in raw
            ]
        if any(
            vectors["min"][axis] > vectors["max"][axis]
            or abs(vectors["min"][axis]) > actor_package.MAX_ABSOLUTE_COORDINATE_M
            or abs(vectors["max"][axis]) > actor_package.MAX_ABSOLUTE_COORDINATE_M
            for axis in range(3)
        ):
            raise ValueError("AF-056 deformation bounds exceed the actor contract.")
        maximum = _number_map(
            record.get("maximum_displacement_by_bone_m"),
            bones,
            f"deformation.{pose.pose_id}.maximum_displacement_by_bone_m",
        )
        minimum = _number_map(
            record.get("minimum_z_by_bone_m"),
            bones,
            f"deformation.{pose.pose_id}.minimum_z_by_bone_m",
        )
        maximum_all = _finite(
            record.get("max_vertex_displacement_m"),
            f"deformation.{pose.pose_id}.max_vertex_displacement_m",
        )
        minimum_all = _finite(record.get("minimum_z_m"), f"deformation.{pose.pose_id}.minimum_z_m")
        if (
            maximum_all < 0.0
            or any(item < 0.0 for item in maximum.values())
            or not math.isclose(maximum_all, max(maximum.values()), abs_tol=1e-9)
            or not math.isclose(minimum_all, min(minimum.values()), abs_tol=1e-9)
            or minimum_all < -GROUND_TOLERANCE_M
            or not math.isclose(vectors["min"][2], round(minimum_all, 5), abs_tol=1e-5)
        ):
            raise ValueError("AF-056 deformation measurements are internally inconsistent.")
        planted = ("foot_r",) if pose.pose_id == "limb-extreme" else ("foot_l", "foot_r")
        if any(abs(minimum[bone_id]) > GROUND_TOLERANCE_M for bone_id in planted):
            raise ValueError("AF-056 deformation evidence loses planted ground contact.")
        if pose.pose_id == "neutral":
            if maximum_all > REST_TOLERANCE_M or not _strict_equal(
                bounds, verified.observations["actor_bounds_m"]
            ):
                raise ValueError("AF-056 neutral deformation evidence is not the bind pose.")
        else:
            if maximum_all < 0.02 or any(
                maximum[rotation.bone_id] < 0.002 for rotation in pose.rotations
            ):
                raise ValueError("AF-056 diagnostic pose does not exercise its declared joints.")
            fixed_feet = ("foot_r",) if pose.pose_id == "limb-extreme" else ("foot_l", "foot_r")
            if any(maximum[bone_id] > REST_TOLERANCE_M for bone_id in fixed_feet):
                raise ValueError("AF-056 diagnostic pose unexpectedly moves a fixed foot.")
    if len(geometry_hashes) != len(avian_contract.POSE_ORDER):
        raise ValueError("AF-056 diagnostic poses do not have distinct geometry identities.")


def _write_contact_sheet(
    destination: Path,
    images: Sequence[Image.Image],
    source_root: Path,
    package_root: Path,
) -> Path:
    destination = Path(os.path.abspath(destination))
    if destination.suffix.lower() != ".png":
        raise ValueError("AF-056 contact-sheet destination must be a PNG path.")
    protected_roots = (source_root.resolve(strict=True), package_root.resolve(strict=True))
    for protected in protected_roots:
        if destination == protected or protected in destination.parents:
            raise ValueError("AF-056 contact sheet must be outside evidence and package roots.")
    if destination.parent.is_symlink() or _is_junction(destination.parent):
        raise ValueError("AF-056 contact-sheet parent must not be a link or junction.")
    if not destination.parent.is_dir():
        raise ValueError("AF-056 contact-sheet parent must be an existing real directory.")
    parent = destination.parent.resolve(strict=True)
    if parent != destination.parent:
        raise ValueError("AF-056 contact-sheet parent must not traverse a linked ancestor.")
    resolved = parent / destination.name
    for protected in protected_roots:
        if resolved == protected or protected in resolved.parents:
            raise ValueError("AF-056 contact sheet must be outside evidence and package roots.")
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or _is_junction(destination):
            raise ValueError("AF-056 contact-sheet destination must not be a link.")
        identity = _identity(destination)
        if not stat.S_ISREG(identity.mode) or identity.links != 1:
            raise ValueError("AF-056 contact-sheet destination must be a singly linked file.")
    sheet = Image.new(
        "RGBA",
        (FRAME_SIZE[0] * len(VIEW_ORDER), FRAME_SIZE[1] * len(avian_contract.POSE_ORDER)),
        (0, 0, 0, 0),
    )
    for index, image in enumerate(images):
        column = index % len(VIEW_ORDER)
        row = index // len(VIEW_ORDER)
        sheet.alpha_composite(image, (column * FRAME_SIZE[0], row * FRAME_SIZE[1]))
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        sheet.save(temporary, format="PNG", optimize=False, compress_level=9)
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def verify_macaw_actor_review(
    source_root: Path,
    package_root: Path,
    contact_sheet: Path | None = None,
) -> dict[str, object]:
    """Verify the fixed AF-056 evidence tree and optionally publish a 4x4 sheet."""
    files, identities = _closed_tree(source_root)
    verified = actor_package.verify_actor_package(
        package_root, expected_manifest_sha256=EXPECTED_MANIFEST_SHA256
    )
    rig = avian_contract.load_rig_contract()
    poses = avian_contract.load_review_poses()
    if rig.sha256 != EXPECTED_RIG_CONTRACT_SHA256 or poses.sha256 != EXPECTED_POSE_CONTRACT_SHA256:
        raise ValueError("AF-056 rig or pose contract is not the pinned reviewed contract.")
    mapping, mapping_sha256 = avian_contract.verify_mapping_document(MAPPING_PATH, verified, rig)
    if mapping_sha256 != EXPECTED_MAPPING_SHA256:
        raise ValueError("AF-056 rig mapping is not the pinned reviewed mapping.")

    report, report_payload = _canonical_json(files["validation.json"])
    _expect_keys(
        report,
        {
            "blender",
            "container",
            "deformation",
            "format",
            "imported",
            "outputs",
            "package",
            "reference",
            "review",
            "rig",
            "schema_version",
            "ticket",
            "trusted_sources",
        },
        "root",
    )
    if (
        report.get("format") != VALIDATION_FORMAT
        or report.get("schema_version") != VALIDATION_SCHEMA_VERSION
        or report.get("ticket") != "AF-056"
    ):
        raise ValueError("AF-056 validation report identity is invalid.")
    expected_package = {
        "content_set_sha256": verified.content_set_sha256,
        "expected_manifest_sha256": EXPECTED_MANIFEST_SHA256,
        "files": dict(verified.file_sha256),
        "id": verified.actor_id,
        "manifest_sha256": verified.manifest_sha256,
        "observed": dict(verified.observations),
    }
    if not _strict_equal(report.get("package"), expected_package):
        raise ValueError("AF-056 validation report is not bound to the exact actor package.")
    expected_reference = {
        "approval_sha256": avian_contract.REFERENCE_APPROVAL_SHA256,
        "manifest_sha256": avian_contract.REFERENCE_MANIFEST_SHA256,
        "ordered_view_set_sha256": avian_contract.REFERENCE_VIEW_SET_SHA256,
        "package_id": avian_contract.REFERENCE_PACKAGE_ID,
        "source_approval_sha256": avian_contract.REFERENCE_SOURCE_APPROVAL_SHA256,
    }
    if not _strict_equal(report.get("reference"), expected_reference):
        raise ValueError("AF-056 validation report is not bound to approved reference evidence.")
    expected_rig = {
        "contract_sha256": rig.sha256,
        "id": avian_contract.RIG_ID,
        "mapping_sha256": mapping_sha256,
        "vertex_skin_sha256": mapping["vertex_skin_sha256"],
    }
    if not _strict_equal(report.get("rig"), expected_rig):
        raise ValueError("AF-056 validation report is not bound to the exact avian rig mapping.")
    expected_imported = {
        "armatures": verified.observations["skins"],
        "images": verified.observations["images"],
        "materials": verified.observations["materials"],
        "meshes": verified.observations["meshes"],
        "objects": 2,
        "world_bounds_m": verified.observations["actor_bounds_m"],
    }
    if not _strict_equal(report.get("imported"), expected_imported):
        raise ValueError("AF-056 imported Blender observations are invalid.")
    expected_blender = {
        "archive_sha256": evidence.BLENDER_ARCHIVE_SHA256,
        "color_transform": "AgX Medium High Contrast",
        "render_engine": "BLENDER_EEVEE_NEXT",
        "samples": 8,
        "threads": 1,
        "version": evidence.BLENDER_VERSION,
    }
    expected_container = {
        "image": "caatuu-animated-fabric-blender-macaw-actor-validator:4.5.12",
        "input_mount": "read-only",
        "platform": evidence.CONTAINER_PLATFORM,
        "private_snapshot": True,
        "runtime_network": "none",
    }
    if not _strict_equal(report.get("blender"), expected_blender):
        raise ValueError("AF-056 Blender render settings are invalid.")
    if not _strict_equal(report.get("container"), expected_container):
        raise ValueError("AF-056 container isolation declaration is invalid.")
    if not _strict_equal(report.get("trusted_sources"), _trusted_sources()):
        raise ValueError("AF-056 evidence was not produced by current trusted worker sources.")
    _verify_deformation(report.get("deformation"), poses, verified)

    review = _object(report.get("review"), "review")
    _expect_keys(
        review,
        {
            "camera_orthographic_scale",
            "camera_target",
            "frame_size",
            "frames",
            "pose_contract_sha256",
            "pose_order",
            "transparent",
            "view_order",
        },
        "review",
    )
    fixed_review = {
        "camera_orthographic_scale": 2.75,
        "camera_target": [0.0, 0.0, 1.02],
        "frame_size": list(FRAME_SIZE),
        "pose_contract_sha256": poses.sha256,
        "pose_order": list(avian_contract.POSE_ORDER),
        "transparent": True,
        "view_order": list(VIEW_ORDER),
    }
    if any(not _strict_equal(review.get(key), value) for key, value in fixed_review.items()):
        raise ValueError("AF-056 review camera, pose, or frame contract is invalid.")
    frame_records = _objects(review.get("frames"), "review.frames")
    if len(frame_records) != len(FRAME_PATHS):
        raise ValueError("AF-056 review report must contain exactly 16 frame records.")
    frame_hashes: dict[str, str] = {}
    frame_total = 0
    images: list[Image.Image] = []
    for index, (pose_id, view_id) in enumerate(FRAME_ORDER):
        name = f"{pose_id}--{view_id}.png"
        observations, image = _inspect_frame(files[name])
        expected_frame = {
            "camera_location": list(VIEW_LOCATIONS[view_id]),
            "path": name,
            "pose_id": pose_id,
            "view_id": view_id,
            **observations,
        }
        if not _strict_equal(frame_records[index], expected_frame):
            raise ValueError(f"AF-056 review frame record is invalid: {name}.")
        frame_hashes[name] = str(observations["sha256"])
        frame_bytes = observations["bytes"]
        if isinstance(frame_bytes, bool) or not isinstance(frame_bytes, int):
            raise ValueError(f"AF-056 review frame byte count is invalid: {name}.")
        frame_total += frame_bytes
        images.append(image)
    expected_outputs = {
        "frame_count": len(FRAME_PATHS),
        "frame_sha256": frame_hashes,
        "frame_total_bytes": frame_total,
        "max_evidence_bytes": MAX_EVIDENCE_BYTES,
        "max_frame_bytes": MAX_FRAME_BYTES,
    }
    if not _strict_equal(report.get("outputs"), expected_outputs):
        raise ValueError("AF-056 output hashes, bytes, or limits are invalid.")

    current_files, current_identities = _closed_tree(source_root)
    if current_identities != identities or set(current_files) != set(files):
        raise ValueError("AF-056 evidence tree changed during verification.")
    if _sha256_bytes(report_payload) != _sha256(files["validation.json"]):
        raise ValueError("AF-056 validation report changed during verification.")
    written_sheet: Path | None = None
    if contact_sheet is not None:
        written_sheet = _write_contact_sheet(contact_sheet, images, source_root, package_root)
    result: dict[str, object] = {
        "frame_count": len(FRAME_PATHS),
        "frame_total_bytes": frame_total,
        "manifest_sha256": verified.manifest_sha256,
        "mapping_sha256": mapping_sha256,
        "validation_sha256": _sha256_bytes(report_payload),
    }
    if written_sheet is not None:
        result["contact_sheet"] = {
            "height_px": FRAME_SIZE[1] * len(avian_contract.POSE_ORDER),
            "path": str(written_sheet),
            "sha256": _sha256(written_sheet),
            "width_px": FRAME_SIZE[0] * len(VIEW_ORDER),
        }
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify fixed AF-056 macaw deformation evidence.")
    parser.add_argument("--source", required=True, type=Path, help="AF-056 evidence directory.")
    parser.add_argument("--package", required=True, type=Path, help="Pinned actor-package root.")
    parser.add_argument(
        "--contact-sheet",
        type=Path,
        help="Optional atomic 4x4 PNG review sheet destination.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    summary = verify_macaw_actor_review(
        arguments.source,
        arguments.package,
        arguments.contact_sheet,
    )
    print(json.dumps(summary, allow_nan=False, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
