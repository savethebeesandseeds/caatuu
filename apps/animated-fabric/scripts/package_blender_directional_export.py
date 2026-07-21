"""Validate the owned four-yaw Blender batch and publish one product grid."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from animated_fabric.application.exporting import (
    CancellationToken,
    ExportResult,
    GridAnimationExportResult,
)
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind
from animated_fabric.domain.export import (
    GRID_SPRITESHEET_FORMAT,
    GRID_SPRITESHEET_SCHEMA_VERSION,
    DirectionalPrerenderMetadata,
    FrameSequenceMetadata,
    GridSpritesheetFrame,
    GridSpritesheetMetadata,
)
from animated_fabric.infrastructure.exporters._transaction import (
    create_export_staging,
    discard_export_staging,
    promote_export_staging,
    relative_export_files,
    validate_export_destination,
)
from animated_fabric.infrastructure.exporters.grid_spritesheet_packer import (
    GridSpritesheetPacker,
)

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from tools.blender import evidence, motion  # noqa: E402

BLENDER_TOOL_ROOT = APP_ROOT / "tools" / "blender"
BLENDER_CONTAINER_RECIPE = APP_ROOT / "containers" / "blender" / "Dockerfile"
BLENDER_ORCHESTRATOR_RECIPE = APP_ROOT / "compose.yaml"


def _verify_evidence(source_root: Path) -> evidence.EvidenceSummary:
    try:
        return evidence.verify_evidence_root(
            source_root,
            expected_sources=evidence.source_hashes(
                BLENDER_TOOL_ROOT,
                BLENDER_CONTAINER_RECIPE,
                BLENDER_ORCHESTRATOR_RECIPE,
            ),
        )
    except (OSError, RuntimeError, ValueError) as error:
        raise ExportError(
            str(error),
            kind=ExportFailureKind.VERIFICATION,
            path=str(source_root),
        ) from error


def _expected_grid_metadata(sequence: FrameSequenceMetadata) -> GridSpritesheetMetadata:
    width = sequence.frame_size.width
    height = sequence.frame_size.height
    frames = tuple(
        GridSpritesheetFrame(
            direction=frame.direction,
            index=frame.index,
            rect=(
                frame.index * width,
                row * height,
                width,
                height,
            ),
            duration_ms=frame.duration_ms,
            events=frame.events,
        )
        for row in range(len(sequence.directions))
        for frame in sequence.frames[
            row * sequence.frames_per_direction : (row + 1) * sequence.frames_per_direction
        ]
    )
    return GridSpritesheetMetadata(
        format=GRID_SPRITESHEET_FORMAT,
        schema_version=GRID_SPRITESHEET_SCHEMA_VERSION,
        project=sequence.project,
        animation=sequence.animation,
        image="walk.png",
        frame_size=sequence.frame_size,
        origin=sequence.origin,
        fps=sequence.fps,
        duration_ms=sequence.duration_ms,
        directions=sequence.directions,
        frames_per_direction=sequence.frames_per_direction,
        frames=frames,
    )


def _verify_staged_product(
    staging: Path,
    source_root: Path,
    sequence: FrameSequenceMetadata,
    expected_metadata: GridSpritesheetMetadata,
) -> None:
    expected_names = {"walk.png", "walk.spritesheet.json"}
    try:
        entries = tuple(staging.iterdir())
        if {entry.name for entry in entries} != expected_names or any(
            entry.is_symlink() or not entry.is_file() for entry in entries
        ):
            raise ExportError(
                "The staged directional product must contain exactly two regular files.",
                kind=ExportFailureKind.VERIFICATION,
            )
        parsed_metadata = GridSpritesheetMetadata.model_validate_json(
            (staging / "walk.spritesheet.json").read_bytes()
        )
        if parsed_metadata != expected_metadata:
            raise ExportError(
                "The staged directional grid metadata differs from the verified plan.",
                kind=ExportFailureKind.VERIFICATION,
                path="walk.spritesheet.json",
            )
        expected_size = (
            sequence.frame_size.width * sequence.frames_per_direction,
            sequence.frame_size.height * len(sequence.directions),
        )
        with Image.open(staging / "walk.png") as sheet:
            if sheet.format != "PNG" or sheet.mode != "RGBA" or sheet.size != expected_size:
                raise ExportError(
                    "The staged directional grid image has the wrong contract.",
                    kind=ExportFailureKind.VERIFICATION,
                    path="walk.png",
                )
            sheet.load()
            for grid_frame, source_frame in zip(
                expected_metadata.frames,
                sequence.frames,
                strict=True,
            ):
                source = source_root / sequence.animation
                source = source.joinpath(*source_frame.image.split("/"))
                with Image.open(source) as frame:
                    width = sequence.frame_size.width
                    height = sequence.frame_size.height
                    if (
                        frame.format != "PNG"
                        or frame.mode != "RGBA"
                        or frame.size
                        != (
                            width,
                            height,
                        )
                    ):
                        raise ExportError(
                            "A verified directional source frame changed its image contract.",
                            kind=ExportFailureKind.VERIFICATION,
                            path=f"{sequence.animation}/{source_frame.image}",
                        )
                    frame.load()
                    x, y, _, _ = grid_frame.rect
                    if sheet.crop((x, y, x + width, y + height)).tobytes() != frame.tobytes():
                        raise ExportError(
                            "A staged directional grid cell differs from its source frame.",
                            kind=ExportFailureKind.VERIFICATION,
                            path="walk.png",
                            location=(
                                f"frames[{source_frame.direction.value}:{source_frame.index}]"
                            ),
                        )
    except ExportError:
        raise
    except MemoryError:
        raise
    except (
        Image.DecompressionBombError,
        OSError,
        RuntimeError,
        SyntaxError,
        UnidentifiedImageError,
        ValidationError,
        ValueError,
    ) as error:
        raise ExportError(
            "The staged directional product could not be decoded and verified.",
            kind=ExportFailureKind.VERIFICATION,
        ) from error


def _load_contracts(
    source_root: Path,
) -> tuple[DirectionalPrerenderMetadata, FrameSequenceMetadata]:
    try:
        directional = DirectionalPrerenderMetadata.model_validate_json(
            (source_root / motion.DIRECTIONAL_PRERENDER_FILENAME).read_bytes()
        )
        sequence = FrameSequenceMetadata.model_validate_json(
            (source_root / "walk" / "animation.json").read_bytes()
        )
    except (OSError, ValidationError) as error:
        raise ExportError(
            "The directional prerender metadata could not be loaded.",
            kind=ExportFailureKind.VERIFICATION,
            path=str(source_root),
        ) from error

    expected_motion = motion.motion_sha256(motion.walk_frames())
    if (
        directional.project != sequence.project
        or directional.animation != sequence.animation
        or directional.frame_sequence != "walk/animation.json"
        or directional.motion_sha256 != expected_motion
        or tuple(view.direction for view in directional.views) != sequence.directions
        or sequence.frame_size.width != motion.FRAME_SIZE[0]
        or sequence.frame_size.height != motion.FRAME_SIZE[1]
        or (sequence.origin.x, sequence.origin.y) != motion.GROUND_ORIGIN
        or sequence.fps != motion.FPS
        or sequence.duration_ms != motion.DURATION_MS
        or sequence.frames_per_direction != motion.FRAME_COUNT
    ):
        raise ExportError(
            "The directional and frame-sequence contracts do not describe the same render.",
            kind=ExportFailureKind.VERIFICATION,
            path=str(source_root),
        )
    return directional, sequence


def _resolve_roots(source_root: Path, destination: Path) -> tuple[Path, Path]:
    if source_root.is_symlink():
        raise ExportError(
            "The directional prerender source must not be a symbolic link.",
            kind=ExportFailureKind.VERIFICATION,
            path=str(source_root),
        )
    try:
        resolved_source = source_root.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ExportError(
            "The directional prerender source does not exist.",
            kind=ExportFailureKind.VERIFICATION,
            path=str(source_root),
        ) from error
    if not resolved_source.is_dir():
        raise ExportError(
            "The directional prerender source must be a directory.",
            kind=ExportFailureKind.VERIFICATION,
            path=str(source_root),
        )

    resolved_destination = validate_export_destination(destination, resolved_source)
    if resolved_destination.is_relative_to(resolved_source):
        raise ExportError(
            "The product export must remain outside the immutable prerender source.",
            kind=ExportFailureKind.DESTINATION,
            path=str(resolved_destination),
        )
    return resolved_source, resolved_destination


def _check_cancelled(cancellation: CancellationToken | None, location: str) -> None:
    if cancellation is not None and cancellation.is_cancelled():
        raise ExportError(
            "The directional grid packaging operation was cancelled.",
            kind=ExportFailureKind.CANCELLED,
            location=location,
        )


def package_blender_directional_export(
    source_root: Path,
    destination: Path,
    *,
    packer: GridSpritesheetPacker | None = None,
    cancellation: CancellationToken | None = None,
) -> ExportResult[GridAnimationExportResult]:
    """Verify AF-052 source evidence and atomically publish its four-row walk grid."""
    if cancellation is not None and not isinstance(cancellation, CancellationToken):
        raise TypeError("Directional grid cancellation must implement CancellationToken.")
    _check_cancelled(cancellation, "before source verification")
    resolved_source, resolved_destination = _resolve_roots(source_root, destination)
    verified_evidence = _verify_evidence(resolved_source)
    _directional, sequence = _load_contracts(resolved_source)
    expected_metadata = _expected_grid_metadata(sequence)

    staging = create_export_staging(resolved_destination)
    retained_backup: Path | None = None
    try:
        result, grid_metadata = (packer or GridSpritesheetPacker()).pack_animation(
            animation_root=resolved_source / sequence.animation,
            destination_root=staging,
            metadata=sequence,
            cancellation=cancellation,
        )
        expected_files = {
            "walk.png",
            "walk.spritesheet.json",
        }
        if (
            result.animation != "walk"
            or result.frame_count != motion.FRAME_COUNT
            or result.image_path != Path("walk.png")
            or result.metadata_path != Path("walk.spritesheet.json")
            or grid_metadata != expected_metadata
            or relative_export_files(staging) != expected_files
        ):
            raise ExportError(
                "The staged directional grid does not match the verified source plan.",
                kind=ExportFailureKind.VERIFICATION,
            )
        _verify_staged_product(staging, resolved_source, sequence, expected_metadata)
        if _verify_evidence(resolved_source) != verified_evidence:
            raise ExportError(
                "The directional prerender source changed while it was being packaged.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(resolved_source),
            )
        _check_cancelled(cancellation, "before product publication")
        retained_backup = promote_export_staging(staging, resolved_destination)
    except ExportError:
        raise
    except MemoryError as error:
        raise ExportError(
            "The directional grid could not be allocated within the export memory limit.",
            kind=ExportFailureKind.INVALID_PROFILE,
        ) from error
    except OSError as error:
        raise ExportError(
            "The directional grid could not be published safely.",
            kind=ExportFailureKind.PUBLICATION,
            path=str(resolved_destination),
        ) from error
    finally:
        discard_export_staging(staging)

    return ExportResult(
        destination=resolved_destination,
        animations=(result,),
        retained_backup=retained_backup,
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the bounded AF-052 product-packaging parser."""
    parser = argparse.ArgumentParser(
        description="Validate the owned four-yaw Blender walk and publish its product grid."
    )
    parser.add_argument("--source", required=True, type=Path, help="Verified Blender output root.")
    parser.add_argument("--out", required=True, type=Path, help="Product export directory.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Package the fixed directional walk and report its product artifacts."""
    arguments = build_parser().parse_args(argv)
    try:
        result = package_blender_directional_export(arguments.source, arguments.out)
    except (ExportError, OSError, ValueError) as error:
        print(f"AF-052 directional export packaging failed: {error}")
        return 5
    animation = result.animations[0]
    print(f"Wrote AF-052 spritesheet to {result.destination / animation.image_path}")
    print(f"Wrote AF-052 metadata to {result.destination / animation.metadata_path}")
    if result.retained_backup is not None:
        print(f"Warning: retained previous export backup at {result.retained_backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
