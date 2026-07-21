"""Verify AF-052 direct-yaw frames against reviewed decoded-pixel goldens."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image, UnidentifiedImageError

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from tools.blender import evidence, motion  # noqa: E402

BLENDER_TOOL_ROOT = APP_ROOT / "tools" / "blender"
BLENDER_CONTAINER_RECIPE = APP_ROOT / "containers" / "blender" / "Dockerfile"
BLENDER_ORCHESTRATOR_RECIPE = APP_ROOT / "compose.yaml"
DEFAULT_GOLDEN_ROOT = APP_ROOT / "tests" / "golden"
GOLDEN_FILENAMES = {
    direction: f"af052_blender_walk_{direction.lower()}_t0000.png"
    for direction in motion.DIRECTIONS
}
MAX_OUTLIER_FRACTION = 0.001
MAX_CHANNEL_DIFFERENCE = 2
MIN_DIRECT_MIRROR_DIFFERENCE = 0.10

type RgbaPixels = npt.NDArray[np.uint8]


@dataclass(frozen=True, slots=True)
class DirectionalVisualSummary:
    """Decoded-pixel evidence reported by one AF-052 visual verification."""

    direct_sw_difference: float
    direct_nw_difference: float
    reported_sw_difference: float
    reported_nw_difference: float
    maximum_golden_difference: int
    maximum_golden_outlier_fraction: float


def _expected_sources() -> dict[str, str]:
    return evidence.source_hashes(
        BLENDER_TOOL_ROOT,
        BLENDER_CONTAINER_RECIPE,
        BLENDER_ORCHESTRATOR_RECIPE,
    )


def _load_rgba(path: Path, context: str) -> RgbaPixels:
    if path.is_symlink():
        raise ValueError(f"{context} must not be a symbolic link: {path}")
    try:
        with Image.open(path) as image:
            if image.format != "PNG" or image.mode != "RGBA" or image.size != motion.FRAME_SIZE:
                raise ValueError(
                    f"{context} must be a {motion.FRAME_SIZE[0]}x{motion.FRAME_SIZE[1]} RGBA PNG: "
                    f"{path}"
                )
            image.load()
            return np.asarray(image, dtype=np.uint8).copy()
    except ValueError:
        raise
    except (
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
    ) as error:
        raise ValueError(f"Unable to decode {context}: {path}") from error


def _assert_alpha_bounds(pixels: RgbaPixels, path: Path) -> None:
    alpha = pixels[:, :, 3]
    if not np.any(alpha):
        raise ValueError(f"AF-052 source frame is completely transparent: {path}")
    if np.any(alpha[0, :]) or np.any(alpha[-1, :]) or np.any(alpha[:, 0]) or np.any(alpha[:, -1]):
        raise ValueError(f"AF-052 source alpha touches the canvas edge: {path}")
    if int(alpha.max(initial=0)) != 255:
        raise ValueError(f"AF-052 source alpha never reaches full opacity: {path}")


def _direct_mirror_difference(
    source_root: Path,
    direct: str,
    source: str,
    indexes: Sequence[int],
) -> float:
    different_pixels = 0
    pixel_count = motion.FRAME_SIZE[0] * motion.FRAME_SIZE[1] * len(indexes)
    for index in indexes:
        direct_path = source_root / "walk" / direct / f"{index:03d}.png"
        source_path = source_root / "walk" / source / f"{index:03d}.png"
        direct_pixels = _load_rgba(direct_path, "AF-052 source frame")
        source_pixels = _load_rgba(source_path, "AF-052 source frame")
        _assert_alpha_bounds(direct_pixels, direct_path)
        _assert_alpha_bounds(source_pixels, source_path)
        delta = np.abs(
            direct_pixels.astype(np.int16) - np.flip(source_pixels, axis=1).astype(np.int16)
        )
        different_pixels += int(np.count_nonzero(np.any(delta > 1, axis=2)))
    return round(different_pixels / pixel_count, 8)


def validate_directional_source(
    source_root: Path,
) -> tuple[Path, evidence.EvidenceSummary, float, float]:
    """Verify provenance, every decoded frame, and direct-view mirror distinction."""
    try:
        resolved_source = source_root.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ValueError(f"AF-052 source does not exist: {source_root}") from error
    summary = evidence.verify_evidence_root(
        resolved_source,
        expected_sources=_expected_sources(),
    )
    all_indexes = tuple(range(motion.FRAME_COUNT))
    direct_sw = _direct_mirror_difference(resolved_source, "SW", "SE", all_indexes)
    direct_nw = _direct_mirror_difference(resolved_source, "NW", "NE", all_indexes)
    phase_zero_sw = _direct_mirror_difference(resolved_source, "SW", "SE", (0,))
    phase_zero_nw = _direct_mirror_difference(resolved_source, "NW", "NE", (0,))
    if any(
        difference < MIN_DIRECT_MIRROR_DIFFERENCE
        for difference in (
            direct_sw,
            direct_nw,
            phase_zero_sw,
            phase_zero_nw,
            summary.direct_sw_difference,
            summary.direct_nw_difference,
        )
    ):
        raise ValueError(
            "AF-052 direct west-facing views are not materially distinct from 2D mirrors."
        )
    return resolved_source, summary, direct_sw, direct_nw


def verify_directional_goldens(
    source_root: Path,
    golden_root: Path = DEFAULT_GOLDEN_ROOT,
) -> DirectionalVisualSummary:
    """Compare the common phase-zero direct views with reviewed RGBA goldens."""
    resolved_source, evidence_summary, direct_sw, direct_nw = validate_directional_source(
        source_root
    )
    maximum_difference = 0
    maximum_outlier_fraction = 0.0
    for direction in motion.DIRECTIONS:
        actual_path = resolved_source / "walk" / direction / "000.png"
        golden_path = golden_root / GOLDEN_FILENAMES[direction]
        actual = _load_rgba(actual_path, "AF-052 source frame")
        golden = _load_rgba(golden_path, "AF-052 reviewed golden")
        delta = np.abs(actual.astype(np.int16) - golden.astype(np.int16))
        per_pixel_outlier = np.any(delta > 0, axis=2)
        outlier_fraction = float(np.count_nonzero(per_pixel_outlier)) / per_pixel_outlier.size
        direction_maximum = int(delta.max(initial=0))
        maximum_difference = max(maximum_difference, direction_maximum)
        maximum_outlier_fraction = max(maximum_outlier_fraction, outlier_fraction)
        if direction_maximum > MAX_CHANNEL_DIFFERENCE or outlier_fraction > MAX_OUTLIER_FRACTION:
            raise ValueError(
                f"AF-052 {direction} differs from its reviewed golden: "
                f"max_channel={direction_maximum}, outlier_fraction={outlier_fraction:.8f}."
            )
    return DirectionalVisualSummary(
        direct_sw_difference=direct_sw,
        direct_nw_difference=direct_nw,
        reported_sw_difference=evidence_summary.direct_sw_difference,
        reported_nw_difference=evidence_summary.direct_nw_difference,
        maximum_golden_difference=maximum_difference,
        maximum_golden_outlier_fraction=maximum_outlier_fraction,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Verified Blender output root.")
    parser.add_argument(
        "--golden-root",
        type=Path,
        default=DEFAULT_GOLDEN_ROOT,
        help="Directory containing the four reviewed phase-zero PNGs.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        summary = verify_directional_goldens(arguments.source, arguments.golden_root)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"AF-052 directional golden verification failed: {error}")
        return 5
    print(
        "Verified AF-052 direct-yaw goldens: "
        f"SW mirror difference={summary.direct_sw_difference:.8f}, "
        f"NW mirror difference={summary.direct_nw_difference:.8f}, "
        f"Blender-reported SW/NW={summary.reported_sw_difference:.8f}/"
        f"{summary.reported_nw_difference:.8f}, "
        f"max golden channel difference={summary.maximum_golden_difference}, "
        "max golden outlier fraction="
        f"{summary.maximum_golden_outlier_fraction:.8f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
