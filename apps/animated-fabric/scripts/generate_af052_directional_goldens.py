"""Generate review candidates from one verified AF-052 direct-yaw render."""

from __future__ import annotations

import argparse
import shutil
import sys
from collections.abc import Sequence
from pathlib import Path

from animated_fabric.domain.exceptions import ExportError
from animated_fabric.infrastructure.exporters._transaction import validate_export_destination

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from scripts.verify_blender_directional_goldens import (  # noqa: E402
    GOLDEN_FILENAMES,
    validate_directional_source,
)
from tools.blender import motion  # noqa: E402


def generate_directional_goldens(source_root: Path, destination_root: Path) -> tuple[Path, ...]:
    """Copy four verified phase-zero PNGs without replacing reviewed files."""
    resolved_source, _summary, _direct_sw, _direct_nw = validate_directional_source(source_root)
    resolved_destination = validate_export_destination(destination_root, resolved_source)
    if resolved_destination.is_relative_to(resolved_source):
        raise ValueError("AF-052 golden candidates must remain outside the render evidence root.")
    resolved_destination.mkdir(parents=True, exist_ok=True)
    destinations = tuple(
        resolved_destination / GOLDEN_FILENAMES[item] for item in motion.DIRECTIONS
    )
    occupied = tuple(path for path in destinations if path.exists() or path.is_symlink())
    if occupied:
        raise ValueError(
            "Refusing to replace reviewed AF-052 goldens: "
            + ", ".join(path.name for path in occupied)
        )
    written: list[Path] = []
    try:
        for direction, destination in zip(motion.DIRECTIONS, destinations, strict=True):
            source = resolved_source / "walk" / direction / "000.png"
            with destination.open("xb") as output:
                with source.open("rb") as input_stream:
                    shutil.copyfileobj(input_stream, output)
            written.append(destination)
    except (OSError, ValueError):
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return destinations


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Verified Blender output root.")
    parser.add_argument("--out", required=True, type=Path, help="New golden candidate directory.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        destinations = generate_directional_goldens(arguments.source, arguments.out)
    except (ExportError, OSError, RuntimeError, ValueError) as error:
        print(f"AF-052 golden candidate generation failed: {error}")
        return 5
    for destination in destinations:
        print(f"Wrote AF-052 golden candidate to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
