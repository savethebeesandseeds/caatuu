"""Verify the complete AF-055 neutral-render evidence and reviewed golden."""

from __future__ import annotations

import argparse
import hashlib
import json
import stat
import struct
import sys
import zlib
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import cast

from PIL import Image, ImageChops

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from tools.blender import actor_package  # noqa: E402

VALIDATION_FORMAT = "animated-fabric.actor-validation.v1"
VALIDATION_SCHEMA_VERSION = "0.1.0"
FRAME_SIZE = (192, 192)
DEFAULT_GOLDEN = APP_ROOT / "tests/golden/af055_actor_fixture_neutral.png"
DEFAULT_GOLDEN_PROVENANCE = APP_ROOT / "tests/golden/af055_actor_fixture_neutral.provenance.json"
MAX_CHANNEL_DELTA = 2
MAX_CHANGED_PIXEL_FRACTION = 0.001
MAX_NEUTRAL_BYTES = 1024 * 1024
MAX_VALIDATION_BYTES = 256 * 1024
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_json(path: Path) -> dict[str, object]:
    payload = path.read_bytes()
    try:
        document = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("AF-055 validation report is not strict UTF-8 JSON.") from error
    if not isinstance(document, dict):
        raise ValueError("AF-055 validation report must be a JSON object.")
    canonical = (
        json.dumps(document, allow_nan=False, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    if payload != canonical:
        raise ValueError("AF-055 validation report is not canonically encoded.")
    return document


def _validate_worker_png_structure(path: Path) -> None:
    payload = path.read_bytes()
    if not payload.startswith(_PNG_SIGNATURE):
        raise ValueError("AF-055 neutral output is not a PNG.")
    offset = len(_PNG_SIGNATURE)
    chunk_types: list[bytes] = []
    while offset < len(payload):
        if offset + 12 > len(payload):
            raise ValueError("AF-055 neutral PNG contains a truncated chunk.")
        length = struct.unpack_from(">I", payload, offset)[0]
        chunk_type = payload[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(payload):
            raise ValueError("AF-055 neutral PNG chunk exceeds the file boundary.")
        chunk_data = payload[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack_from(">I", payload, offset + 8 + length)[0]
        actual_crc = zlib.crc32(chunk_data, zlib.crc32(chunk_type)) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            raise ValueError("AF-055 neutral PNG chunk CRC is invalid.")
        chunk_types.append(chunk_type)
        offset = end
        if chunk_type == b"IEND":
            if chunk_data:
                raise ValueError("AF-055 neutral PNG IEND must be empty.")
            break
    if offset != len(payload):
        raise ValueError("AF-055 neutral PNG contains trailing data.")
    if (
        len(chunk_types) < 3
        or chunk_types[0] != b"IHDR"
        or chunk_types[-1] != b"IEND"
        or chunk_types.count(b"IHDR") != 1
        or chunk_types.count(b"IEND") != 1
        or any(chunk_type != b"IDAT" for chunk_type in chunk_types[1:-1])
    ):
        raise ValueError(
            "AF-055 neutral PNG must contain only IHDR, contiguous IDAT, and IEND chunks."
        )
    ihdr_length = struct.unpack_from(">I", payload, len(_PNG_SIGNATURE))[0]
    ihdr = payload[16 : 16 + ihdr_length]
    if ihdr_length != 13:
        raise ValueError("AF-055 neutral PNG IHDR length is invalid.")
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", ihdr
    )
    if (
        (width, height) != FRAME_SIZE
        or (depth, color_type) != (8, 6)
        or (compression, filtering, interlace) != (0, 0, 0)
    ):
        raise ValueError("AF-055 neutral PNG is not canonical 192x192 RGBA8.")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _strict_equal(actual: object, expected: object) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            return False
        return all(_strict_equal(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            return False
        return all(_strict_equal(left, right) for left, right in zip(actual, expected, strict=True))
    return actual == expected


def _expect_keys(mapping: Mapping[str, object], expected: set[str], location: str) -> None:
    if set(mapping) != expected:
        raise ValueError(f"AF-055 validation report has unexpected keys at {location}.")


def _object(mapping: Mapping[str, object], key: str) -> dict[str, object]:
    value = mapping.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"AF-055 validation report expected object at {key}.")
    return value


def _assert_closed_regular_tree(root: Path) -> dict[str, Path]:
    if root.is_symlink() or getattr(root, "is_junction", lambda: False)():
        raise ValueError("AF-055 evidence root must not be a link or junction.")
    if not root.is_dir():
        raise ValueError("AF-055 evidence root must be a directory.")
    expected_paths = {"neutral.png", "validation.json"}
    files: dict[str, Path] = {}
    try:
        entries = root.iterdir()
        for index, path in enumerate(entries):
            if index >= len(expected_paths):
                raise ValueError(
                    "AF-055 evidence tree must contain exactly neutral.png and validation.json."
                )
            relative = path.name
            status_result = path.stat(follow_symlinks=False)
            if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
                raise ValueError("AF-055 evidence must not contain links or junctions.")
            if stat.S_ISDIR(status_result.st_mode):
                raise ValueError("AF-055 evidence must not contain subdirectories.")
            if relative not in expected_paths:
                raise ValueError(
                    "AF-055 evidence tree must contain exactly neutral.png and validation.json."
                )
            if not stat.S_ISREG(status_result.st_mode) or status_result.st_nlink != 1:
                raise ValueError("AF-055 evidence must contain only singly linked regular files.")
            limit = {
                "neutral.png": MAX_NEUTRAL_BYTES,
                "validation.json": MAX_VALIDATION_BYTES,
            }[relative]
            if status_result.st_size > limit:
                raise ValueError(f"AF-055 evidence file exceeds its byte ceiling: {relative}.")
            files[relative] = path
    except OSError as error:
        raise ValueError("AF-055 evidence root cannot be safely inspected.") from error
    if set(files) != expected_paths:
        raise ValueError(
            "AF-055 evidence tree must contain exactly neutral.png and validation.json."
        )
    return files


def _verify_golden(actual_path: Path, golden_path: Path) -> dict[str, int | float]:
    with Image.open(actual_path) as actual_source, Image.open(golden_path) as golden_source:
        actual = actual_source.convert("RGBA")
        golden = golden_source.convert("RGBA")
        if actual.size != FRAME_SIZE or golden.size != FRAME_SIZE:
            raise ValueError("AF-055 actual and golden frames must both be 192x192.")
        difference = ImageChops.difference(actual, golden)
        extrema = cast(tuple[tuple[int, int], ...], difference.getextrema())
        maximum = max(channel[1] for channel in extrema)
        difference_bytes = difference.tobytes()
        changed = sum(
            any(difference_bytes[offset : offset + 4])
            for offset in range(0, len(difference_bytes), 4)
        )
        fraction = changed / (FRAME_SIZE[0] * FRAME_SIZE[1])
    if maximum > MAX_CHANNEL_DELTA or fraction > MAX_CHANGED_PIXEL_FRACTION:
        raise ValueError(
            "AF-055 neutral render differs from the reviewed golden: "
            f"maximum_delta={maximum}, changed_fraction={fraction:.8f}."
        )
    return {"changed_pixel_fraction": round(fraction, 8), "maximum_channel_delta": maximum}


def _verify_golden_provenance(
    provenance_path: Path,
    golden_path: Path,
    verified: actor_package.VerifiedActorPackage,
) -> None:
    document = _canonical_json(provenance_path)
    file_hashes = dict(verified.file_sha256)
    expected: dict[str, object] = {
        "format": "animated-fabric.actor-neutral-golden-provenance.v1",
        "golden": {
            "bytes": golden_path.stat().st_size,
            "height_px": 192,
            "mode": "RGBA8",
            "path": "tests/golden/af055_actor_fixture_neutral.png",
            "sha256": _sha256(golden_path),
            "width_px": 192,
        },
        "license": {
            "notice": "tests/golden/LICENSE-AF055-CC0.md",
            "terms": "CC0-1.0",
        },
        "limitations": [
            (
                "This is a geometric validator fixture, not traveler-macaw geometry or "
                "approved character art."
            ),
            (
                "It proves the bounded package, skin, texture, Blender-import, and "
                "neutral-render contracts only."
            ),
            "It does not authorize a general or untrusted 3D importer.",
        ],
        "package": {
            "content_set_sha256": verified.content_set_sha256,
            "generator": {
                "path": "scripts/generate_actor_package_fixture.py",
                "sha256": _sha256(APP_ROOT / "scripts/generate_actor_package_fixture.py"),
            },
            "glb_sha256": file_hashes["actor.glb"],
            "id": verified.actor_id,
            "manifest_sha256": verified.manifest_sha256,
            "texture_sha256": file_hashes["textures/albedo.png"],
        },
        "render": {
            "blender_archive_sha256": (
                "95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25"
            ),
            "blender_version": "4.5.12 LTS",
            "engine": "BLENDER_EEVEE_NEXT",
            "platform": "linux/amd64",
            "samples": 16,
            "worker": {
                "path": "tools/blender/render_actor_package.py",
                "sha256": _sha256(APP_ROOT / "tools/blender/render_actor_package.py"),
            },
        },
        "review": {
            "date": "2026-07-22",
            "purpose": "AF-055 decoded-pixel regression baseline",
            "status": "reviewed-geometric-fixture",
        },
        "schema_version": "0.1.0",
        "ticket": "AF-055",
    }
    if not _strict_equal(document, expected):
        raise ValueError("AF-055 reviewed golden provenance is stale or invalid.")
    notice = APP_ROOT / "tests/golden/LICENSE-AF055-CC0.md"
    if not notice.is_file():
        raise ValueError("AF-055 reviewed golden license notice is missing.")
    notice_text = notice.read_text(encoding="utf-8")
    if (
        "SPDX-License-Identifier: CC0-1.0" not in notice_text
        or _sha256(golden_path) not in notice_text
    ):
        raise ValueError("AF-055 reviewed golden license notice is not hash-scoped.")


def verify_actor_neutral(
    source_root: Path,
    package_root: Path,
    golden_path: Path = DEFAULT_GOLDEN,
) -> dict[str, object]:
    """Validate one neutral evidence tree and its exact actor-package input."""
    files = _assert_closed_regular_tree(source_root)
    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=actor_package.AF055_FIXTURE_MANIFEST_SHA256,
    )
    report = _canonical_json(files["validation.json"])
    _expect_keys(
        report,
        {
            "blender",
            "container",
            "format",
            "imported",
            "output",
            "package",
            "render",
            "schema_version",
            "ticket",
            "trusted_sources",
        },
        "root",
    )
    if (
        report.get("format") != VALIDATION_FORMAT
        or report.get("schema_version") != VALIDATION_SCHEMA_VERSION
        or report.get("ticket") != "AF-055"
    ):
        raise ValueError("AF-055 validation report identity is invalid.")

    package = _object(report, "package")
    _expect_keys(
        package,
        {
            "content_set_sha256",
            "expected_manifest_sha256",
            "files",
            "id",
            "manifest_sha256",
            "observed",
        },
        "package",
    )
    expected_files = {path: digest for path, digest in verified.file_sha256}
    if not _strict_equal(
        package,
        {
            "content_set_sha256": verified.content_set_sha256,
            "expected_manifest_sha256": actor_package.AF055_FIXTURE_MANIFEST_SHA256,
            "files": expected_files,
            "id": verified.actor_id,
            "manifest_sha256": verified.manifest_sha256,
            "observed": dict(verified.observations),
        },
    ):
        raise ValueError("AF-055 validation report is not bound to the verified package.")

    container = _object(report, "container")
    if not _strict_equal(
        container,
        {
            "image": "caatuu-animated-fabric-blender-actor-validator:4.5.12",
            "input_mount": "read-only",
            "platform": "linux/amd64",
            "private_snapshot": True,
            "runtime_network": "none",
        },
    ):
        raise ValueError("AF-055 validation report isolation contract is invalid.")
    blender = _object(report, "blender")
    if not _strict_equal(
        blender,
        {
            "archive_sha256": ("95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25"),
            "color_transform": "AgX Medium High Contrast",
            "render_engine": "BLENDER_EEVEE_NEXT",
            "samples": 16,
            "threads": 1,
            "version": "4.5.12 LTS",
        },
    ):
        raise ValueError("AF-055 Blender settings are not the fixed neutral contract.")
    imported = _object(report, "imported")
    if not _strict_equal(
        imported,
        {
            "armatures": verified.observations["skins"],
            "images": verified.observations["images"],
            "materials": verified.observations["materials"],
            "meshes": verified.observations["meshes"],
            "objects": 2,
            "world_bounds_m": verified.observations["actor_bounds_m"],
        },
    ):
        raise ValueError("AF-055 imported Blender observations are invalid.")
    render = _object(report, "render")
    if not _strict_equal(
        render,
        {
            "camera_location": [3.2, 5.2, 2.7],
            "camera_orthographic_scale": 2.45,
            "camera_target": [0.0, 0.0, 0.9],
            "frame_size": [192, 192],
            "pose": "rest",
            "transparent": True,
        },
    ):
        raise ValueError("AF-055 render declaration is invalid.")

    output = _object(report, "output")
    _expect_keys(
        output,
        {
            "alpha_bounds_xyxy",
            "bytes",
            "height_px",
            "mode",
            "nontransparent_pixels",
            "path",
            "sha256",
            "width_px",
        },
        "output",
    )
    neutral_path = files["neutral.png"]
    if (
        not _strict_equal(output.get("path"), "neutral.png")
        or not _strict_equal(output.get("sha256"), _sha256(neutral_path))
        or not _strict_equal(output.get("bytes"), neutral_path.stat().st_size)
        or not _strict_equal(output.get("width_px"), FRAME_SIZE[0])
        or not _strict_equal(output.get("height_px"), FRAME_SIZE[1])
        or not _strict_equal(output.get("mode"), "RGBA8")
    ):
        raise ValueError("AF-055 neutral output identity is invalid.")
    _validate_worker_png_structure(neutral_path)
    with Image.open(neutral_path) as image:
        if image.format != "PNG" or image.mode != "RGBA" or image.size != FRAME_SIZE:
            raise ValueError("AF-055 neutral output is not canonical RGBA PNG structure.")
        alpha = image.getchannel("A")
        bounds = alpha.getbbox()
        if bounds is None:
            raise ValueError("AF-055 neutral output is fully transparent.")
        inclusive_bounds = [bounds[0], bounds[1], bounds[2] - 1, bounds[3] - 1]
        nontransparent = sum(value > 0 for value in alpha.tobytes())
    if (
        not _strict_equal(output.get("alpha_bounds_xyxy"), inclusive_bounds)
        or not _strict_equal(output.get("nontransparent_pixels"), nontransparent)
        or inclusive_bounds[0] <= 0
        or inclusive_bounds[1] <= 0
        or inclusive_bounds[2] >= FRAME_SIZE[0] - 1
        or inclusive_bounds[3] >= FRAME_SIZE[1] - 1
    ):
        raise ValueError("AF-055 neutral alpha bounds or occupancy are invalid.")

    expected_trusted = {
        "actor_package.py": _sha256(APP_ROOT / "tools/blender/actor_package.py"),
        "compose.yaml": _sha256(APP_ROOT / "compose.yaml"),
        "container.Dockerfile": _sha256(APP_ROOT / "containers/blender/Dockerfile"),
        "evidence.py": _sha256(APP_ROOT / "tools/blender/evidence.py"),
        "motion.py": _sha256(APP_ROOT / "tools/blender/motion.py"),
        "output_paths.py": _sha256(APP_ROOT / "tools/blender/output_paths.py"),
        "png_canonical.py": _sha256(APP_ROOT / "tools/blender/png_canonical.py"),
        "render_actor_package.py": _sha256(APP_ROOT / "tools/blender/render_actor_package.py"),
    }
    if report.get("trusted_sources") != expected_trusted:
        raise ValueError("AF-055 evidence was not produced by the current trusted worker sources.")
    comparison = _verify_golden(neutral_path, golden_path)
    if golden_path.resolve() == DEFAULT_GOLDEN.resolve():
        _verify_golden_provenance(DEFAULT_GOLDEN_PROVENANCE, golden_path, verified)
    return {
        "content_set_sha256": verified.content_set_sha256,
        "manifest_sha256": verified.manifest_sha256,
        "neutral_sha256": _sha256(neutral_path),
        "validation_sha256": _sha256(files["validation.json"]),
        **comparison,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify AF-055 actor neutral-render evidence.")
    parser.add_argument("--source", required=True, type=Path, help="Neutral evidence directory.")
    parser.add_argument("--package", required=True, type=Path, help="Generated actor package.")
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN, help="Reviewed PNG golden.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    summary = verify_actor_neutral(arguments.source, arguments.package, arguments.golden)
    print(json.dumps(summary, allow_nan=False, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
