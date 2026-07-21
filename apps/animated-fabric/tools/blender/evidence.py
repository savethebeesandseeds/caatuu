"""Pure-Python verification for one bounded AF-044 Blender evidence directory."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from tools.blender import motion
except ModuleNotFoundError:  # Blender loads the baked modules as top-level files.
    import motion  # type: ignore[import-not-found,no-redef]

EVIDENCE_FORMAT = "animated-fabric.blender-prerender-evidence.v1"
EVIDENCE_SCHEMA_VERSION = "0.1.0"
BLENDER_VERSION = "4.5.12 LTS"
BLENDER_ARCHIVE_SHA256 = "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25"
CONTAINER_IMAGE = "caatuu-animated-fabric-blender:4.5.12-cycles-cpu"
CONTAINER_PLATFORM = "linux/amd64"
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_SCENE_OBJECTS = 64
EXPECTED_FILE_COUNT = len(motion.DIRECTIONS) * motion.FRAME_COUNT + 2
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class EvidenceSummary:
    """Verified stable facts needed by review packaging and status reporting."""

    file_count: int
    total_bytes: int
    hashes: Mapping[str, str]
    direct_sw_difference: float
    direct_nw_difference: float


def sha256_file(path: Path) -> str:
    """Return the SHA-256 of one regular file."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_hashes(
    tool_root: Path,
    container_recipe: Path,
    orchestrator_recipe: Path,
) -> dict[str, str]:
    """Hash every source/configuration file that can affect deterministic evidence."""
    paths = {
        "motion_sha256": tool_root / "motion.py",
        "renderer_sha256": tool_root / "render_walk.py",
        "png_canonicalizer_sha256": tool_root / "png_canonical.py",
        "output_boundary_sha256": tool_root / "output_paths.py",
        "evidence_verifier_sha256": tool_root / "evidence.py",
        "container_recipe_sha256": container_recipe,
        "orchestrator_recipe_sha256": orchestrator_recipe,
    }
    return {name: sha256_file(path) for name, path in paths.items()}


def _object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"AF-044 provenance {context} must be a JSON object.")
    return value


def _exact_keys(value: Mapping[str, object], expected: set[str], context: str) -> None:
    if set(value) != expected:
        raise ValueError(f"AF-044 provenance {context} has unexpected fields.")


def _expect(value: Mapping[str, object], key: str, expected: object, context: str) -> None:
    if value.get(key) != expected:
        raise ValueError(f"AF-044 provenance {context}.{key} disagrees with the fixed contract.")


def _load_provenance(path: Path) -> dict[str, object]:
    if path.is_symlink():
        raise ValueError("AF-044 provenance must not be a symbolic link.")
    try:
        payload: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Unable to read valid AF-044 provenance.") from error
    return _object(payload, "root")


def _verify_fixed_contract(
    provenance: Mapping[str, object], expected_sources: Mapping[str, str]
) -> None:
    _exact_keys(
        provenance,
        {
            "format",
            "schema_version",
            "ticket",
            "source",
            "container",
            "blender",
            "motion",
            "render",
            "mirror_comparison",
            "outputs",
        },
        "root",
    )
    _expect(provenance, "format", EVIDENCE_FORMAT, "root")
    _expect(provenance, "schema_version", EVIDENCE_SCHEMA_VERSION, "root")
    _expect(provenance, "ticket", "AF-044", "root")

    source = _object(provenance.get("source"), "source")
    _exact_keys(source, {"kind", "animation", *expected_sources}, "source")
    _expect(source, "kind", "owned_procedural_humanoid", "source")
    _expect(source, "animation", "one_in_place_walk", "source")
    for key, expected in expected_sources.items():
        _expect(source, key, expected, "source")

    container = _object(provenance.get("container"), "container")
    _exact_keys(container, {"image", "platform", "runtime_network"}, "container")
    _expect(container, "image", CONTAINER_IMAGE, "container")
    _expect(container, "platform", CONTAINER_PLATFORM, "container")
    _expect(container, "runtime_network", "none", "container")

    blender = _object(provenance.get("blender"), "blender")
    _exact_keys(
        blender,
        {"version", "archive_sha256", "render_engine", "device", "samples", "threads", "seed"},
        "blender",
    )
    for key, expected_blender_value in {
        "version": BLENDER_VERSION,
        "archive_sha256": BLENDER_ARCHIVE_SHA256,
        "render_engine": "CYCLES",
        "device": "CPU",
        "samples": 32,
        "threads": 2,
        "seed": 0,
    }.items():
        _expect(blender, key, expected_blender_value, "blender")

    motion_data = _object(provenance.get("motion"), "motion")
    expected_motion = {
        "stance_ratio": motion.STANCE_RATIO,
        "stride_length": motion.STRIDE_LENGTH,
        "foot_lift": motion.FOOT_LIFT,
        "stance_width": motion.STANCE_WIDTH,
        "pelvis_base_height": motion.PELVIS_BASE_HEIGHT,
        "pelvis_bob": motion.PELVIS_BOB,
        "pelvis_sway": motion.PELVIS_SWAY,
        "arm_swing": motion.ARM_SWING,
        "sha256": motion.motion_sha256(motion.walk_frames()),
    }
    _exact_keys(motion_data, set(expected_motion), "motion")
    for key, expected_motion_value in expected_motion.items():
        _expect(motion_data, key, expected_motion_value, "motion")

    render = _object(provenance.get("render"), "render")
    expected_render = {
        "frame_size": list(motion.FRAME_SIZE),
        "ground_origin": list(motion.GROUND_ORIGIN),
        "fps": motion.FPS,
        "duration_ms": motion.DURATION_MS,
        "frames_per_direction": motion.FRAME_COUNT,
        "directions": list(motion.DIRECTIONS),
        "direction_yaw_degrees": dict(motion.DIRECTION_YAW_DEGREES),
        "camera_location": [6.0, -6.0, 7.301],
        "camera_target": [0.0, 0.0, 1.301],
        "camera_orthographic_scale": 3.0,
        "transparent": True,
        "color_transform": "Standard",
        "scene_objects_max": MAX_SCENE_OBJECTS,
    }
    _exact_keys(render, {*expected_render, "scene_objects"}, "render")
    for key, expected_render_value in expected_render.items():
        _expect(render, key, expected_render_value, "render")
    object_count = render.get("scene_objects")
    if not isinstance(object_count, int) or isinstance(object_count, bool):
        raise ValueError("AF-044 provenance render.scene_objects must be an integer.")
    if not 1 <= object_count <= MAX_SCENE_OBJECTS:
        raise ValueError("AF-044 scene exceeds its fixed object bound.")


def _comparison_fraction(provenance: Mapping[str, object], key: str) -> float:
    comparisons = _object(provenance.get("mirror_comparison"), "mirror_comparison")
    _exact_keys(
        comparisons,
        {"direct_SW_vs_mirrored_SE", "direct_NW_vs_mirrored_NE"},
        "mirror_comparison",
    )
    comparison = _object(comparisons.get(key), f"mirror_comparison.{key}")
    _exact_keys(
        comparison,
        {"mean_absolute_rgba", "maximum_absolute_rgba", "different_pixel_fraction"},
        f"mirror_comparison.{key}",
    )
    for metric, raw_value in comparison.items():
        if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
            raise ValueError(f"AF-044 comparison metric {metric} must be finite numeric data.")
        value = float(raw_value)
        if not math.isfinite(value) or not 0.0 <= value <= 1.0:
            raise ValueError(f"AF-044 comparison metric {metric} is outside [0, 1].")
    difference = comparison["different_pixel_fraction"]
    if isinstance(difference, bool) or not isinstance(difference, (int, float)):
        raise ValueError("AF-044 comparison difference must be finite numeric data.")
    return float(difference)


def verify_evidence_root(
    source_root: Path,
    *,
    expected_sources: Mapping[str, str],
) -> EvidenceSummary:
    """Validate exact files, bounds, stable provenance, and every recorded digest."""
    if source_root.is_symlink():
        raise ValueError("The AF-044 source root must not be a symbolic link.")
    try:
        root = source_root.resolve(strict=True)
    except OSError as error:
        raise ValueError("The AF-044 source root does not exist.") from error
    if not root.is_dir():
        raise ValueError("The AF-044 source root must be a directory.")

    walk = root / "walk"
    if walk.is_symlink():
        raise ValueError("The AF-044 walk directory must not be a symbolic link.")
    try:
        resolved_walk = walk.resolve(strict=True)
        resolved_walk.relative_to(root)
    except (OSError, ValueError) as error:
        raise ValueError("The AF-044 walk directory escaped its source root.") from error
    metadata_path = resolved_walk / "animation.json"
    if metadata_path.is_symlink():
        raise ValueError("AF-044 frame metadata must not be a symbolic link.")
    try:
        metadata_payload = metadata_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError("Unable to read AF-044 frame metadata.") from error
    if metadata_payload != motion.canonical_manifest_json():
        raise ValueError("AF-044 frame metadata disagrees with the fixed motion manifest.")

    directional_path = root / motion.DIRECTIONAL_PRERENDER_FILENAME
    if directional_path.is_symlink():
        raise ValueError("AF-052 directional metadata must not be a symbolic link.")
    try:
        directional_payload = directional_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError("Unable to read AF-052 directional metadata.") from error
    if directional_payload != motion.canonical_directional_prerender_json(motion.walk_frames()):
        raise ValueError(
            "AF-052 directional metadata disagrees with the fixed motion and yaw plan."
        )

    expected_paths = {
        motion.DIRECTIONAL_PRERENDER_FILENAME,
        "walk/animation.json",
    }
    for direction in motion.DIRECTIONS:
        direction_root = resolved_walk / direction
        if direction_root.is_symlink():
            raise ValueError("AF-044 direction directories must not be symbolic links.")
        expected_paths.update(
            f"walk/{direction}/{index:03d}.png" for index in range(motion.FRAME_COUNT)
        )
    entries = tuple(resolved_walk.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise ValueError("AF-044 walk evidence must not contain symbolic links.")
    actual_directories = {
        path.relative_to(resolved_walk).as_posix() for path in entries if path.is_dir()
    }
    if actual_directories != set(motion.DIRECTIONS):
        raise ValueError("AF-044 walk directories disagree with the exact bounded layout.")
    actual_paths = {
        motion.DIRECTIONAL_PRERENDER_FILENAME,
        *(path.relative_to(root).as_posix() for path in entries if path.is_file()),
    }
    if actual_paths != expected_paths:
        raise ValueError("AF-044 walk files disagree with the exact bounded file set.")

    provenance = _load_provenance(root / "provenance.json")
    _verify_fixed_contract(provenance, expected_sources)
    outputs = _object(provenance.get("outputs"), "outputs")
    _exact_keys(outputs, {"file_count", "total_bytes", "max_bytes", "sha256"}, "outputs")
    _expect(outputs, "file_count", EXPECTED_FILE_COUNT, "outputs")
    _expect(outputs, "max_bytes", MAX_OUTPUT_BYTES, "outputs")
    hashes = _object(outputs.get("sha256"), "outputs.sha256")
    if set(hashes) != expected_paths:
        raise ValueError("AF-044 provenance hashes disagree with the exact file set.")

    verified_hashes: dict[str, str] = {}
    for relative in sorted(expected_paths):
        expected_hash = hashes.get(relative)
        if not isinstance(expected_hash, str) or _SHA256.fullmatch(expected_hash) is None:
            raise ValueError(f"AF-044 provenance has an invalid SHA-256 for {relative}.")
        candidate = root.joinpath(*relative.split("/"))
        if candidate.is_symlink() or sha256_file(candidate) != expected_hash:
            raise ValueError(f"AF-044 evidence hash mismatch: {relative}.")
        verified_hashes[relative] = expected_hash

    total_bytes = sum(
        root.joinpath(*relative.split("/")).stat().st_size for relative in expected_paths
    )
    _expect(outputs, "total_bytes", total_bytes, "outputs")
    if total_bytes > MAX_OUTPUT_BYTES:
        raise ValueError("AF-044 evidence exceeds its fixed output-byte bound.")
    return EvidenceSummary(
        file_count=EXPECTED_FILE_COUNT,
        total_bytes=total_bytes,
        hashes=verified_hashes,
        direct_sw_difference=_comparison_fraction(provenance, "direct_SW_vs_mirrored_SE"),
        direct_nw_difference=_comparison_fraction(provenance, "direct_NW_vs_mirrored_NE"),
    )
