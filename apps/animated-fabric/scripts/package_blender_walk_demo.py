"""Validate Blender walk frames and build AF-052 human-review media."""

from __future__ import annotations

import argparse
import math
import os
import shutil
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw
from pydantic import ValidationError

from animated_fabric.domain.export import FrameSequenceMetadata

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from tools.blender.evidence import source_hashes, verify_evidence_root  # noqa: E402

BLENDER_TOOL_ROOT = APP_ROOT / "tools" / "blender"
BLENDER_CONTAINER_RECIPE = APP_ROOT / "containers" / "blender" / "Dockerfile"
BLENDER_ORCHESTRATOR_RECIPE = APP_ROOT / "compose.yaml"

CHECKER_LIGHT = (47, 54, 68, 255)
CHECKER_DARK = (30, 35, 46, 255)
LABEL_BACKGROUND = (18, 22, 30, 255)
LABEL_FOREGROUND = (236, 239, 244, 255)
LABEL_HEIGHT = 20


@dataclass(frozen=True, slots=True)
class ReviewArtifacts:
    """Paths written for visual review without claiming a product export format."""

    contact_sheet: Path
    animated_preview: Path


def _load_metadata(source_root: Path) -> tuple[FrameSequenceMetadata, Path]:
    metadata_path = source_root / "walk" / "animation.json"
    try:
        payload = metadata_path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"Unable to read Blender frame metadata: {metadata_path}") from error
    try:
        metadata = FrameSequenceMetadata.model_validate_json(payload)
    except ValidationError as error:
        raise ValueError("Blender output is not valid frame-sequence metadata.") from error
    if metadata.animation != "walk":
        raise ValueError("The AF-052 review packager accepts only the 'walk' animation.")
    return metadata, metadata_path.parent


def _load_frames(
    metadata: FrameSequenceMetadata,
    animation_root: Path,
) -> dict[str, tuple[Image.Image, ...]]:
    resolved_root = animation_root.resolve(strict=True)
    frames: dict[str, list[Image.Image]] = {
        direction.value: [] for direction in metadata.directions
    }
    for record in metadata.frames:
        candidate = animation_root.joinpath(*str(record.image).split("/"))
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(resolved_root)
        except (OSError, ValueError) as error:
            raise ValueError(f"Frame escaped or is missing: {record.image}") from error
        try:
            with Image.open(resolved) as decoded:
                if decoded.format != "PNG" or decoded.mode != "RGBA":
                    raise ValueError(f"Frame must be an RGBA PNG: {record.image}")
                if decoded.size != (metadata.frame_size.width, metadata.frame_size.height):
                    raise ValueError(f"Frame dimensions disagree with metadata: {record.image}")
                rgba = decoded.copy()
        except OSError as error:
            raise ValueError(f"Unable to decode frame: {record.image}") from error
        alpha = rgba.getchannel("A")
        alpha_bounds = alpha.getbbox()
        if alpha_bounds is None:
            raise ValueError(f"Frame is completely transparent: {record.image}")
        if (
            alpha_bounds[0] == 0
            or alpha_bounds[1] == 0
            or alpha_bounds[2] == rgba.width
            or alpha_bounds[3] == rgba.height
        ):
            raise ValueError(f"Frame alpha touches the canvas edge: {record.image}")
        frames[record.direction.value].append(rgba)
    return {direction: tuple(values) for direction, values in frames.items()}


def _checkerboard(size: tuple[int, int], *, tile: int = 12) -> Image.Image:
    background = Image.new("RGBA", size, CHECKER_LIGHT)
    draw = ImageDraw.Draw(background)
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle(
                    (x, y, min(x + tile - 1, size[0]), min(y + tile - 1, size[1])),
                    fill=CHECKER_DARK,
                )
    return background


def _labeled_panel(frame: Image.Image, label: str) -> Image.Image:
    panel = _checkerboard((frame.width, frame.height + LABEL_HEIGHT))
    panel.alpha_composite(frame, (0, LABEL_HEIGHT))
    draw = ImageDraw.Draw(panel)
    draw.rectangle((0, 0, frame.width, LABEL_HEIGHT - 1), fill=LABEL_BACKGROUND)
    draw.text((7, 5), label, fill=LABEL_FOREGROUND)
    return panel


def _sample_indices(frame_count: int) -> tuple[int, ...]:
    if frame_count <= 4:
        return tuple(range(frame_count))
    candidates = (0, frame_count // 4, frame_count // 2, (3 * frame_count) // 4)
    return tuple(dict.fromkeys(candidates))


def _build_contact_sheet(
    metadata: FrameSequenceMetadata,
    frames: dict[str, tuple[Image.Image, ...]],
) -> Image.Image:
    indices = _sample_indices(metadata.frames_per_direction)
    width = metadata.frame_size.width * len(indices)
    panel_height = metadata.frame_size.height + LABEL_HEIGHT
    sheet = Image.new("RGBA", (width, panel_height * len(metadata.directions)), LABEL_BACKGROUND)
    for row, direction in enumerate(metadata.directions):
        for column, index in enumerate(indices):
            panel = _labeled_panel(
                frames[direction.value][index], f"{direction.value}  {index:03d}"
            )
            sheet.alpha_composite(
                panel,
                (column * metadata.frame_size.width, row * panel_height),
            )
    return sheet


def _build_preview_frames(
    metadata: FrameSequenceMetadata,
    frames: dict[str, tuple[Image.Image, ...]],
) -> tuple[Image.Image, ...]:
    columns = 2 if len(metadata.directions) > 1 else 1
    rows = math.ceil(len(metadata.directions) / columns)
    panel_width = metadata.frame_size.width
    panel_height = metadata.frame_size.height + LABEL_HEIGHT
    previews: list[Image.Image] = []
    for index in range(metadata.frames_per_direction):
        preview = Image.new(
            "RGBA",
            (panel_width * columns, panel_height * rows),
            LABEL_BACKGROUND,
        )
        for offset, direction in enumerate(metadata.directions):
            panel = _labeled_panel(frames[direction.value][index], direction.value)
            preview.alpha_composite(
                panel,
                ((offset % columns) * panel_width, (offset // columns) * panel_height),
            )
        previews.append(preview.convert("RGB"))
    return tuple(previews)


def _publish_review(
    destination: Path,
    contact_sheet: Image.Image,
    previews: tuple[Image.Image, ...],
    durations: tuple[int, ...],
) -> ReviewArtifacts:
    destination_parent = destination.parent
    destination_parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{destination.name}-stage-", dir=destination_parent))
    backup: Path | None = None
    try:
        contact_path = stage / "walk_contact_sheet.png"
        preview_path = stage / "walk_review.gif"
        contact_sheet.save(contact_path, format="PNG", compress_level=9)
        quantized = tuple(
            frame.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            for frame in previews
        )
        quantized[0].save(
            preview_path,
            format="GIF",
            save_all=True,
            append_images=quantized[1:],
            duration=durations,
            loop=0,
            disposal=2,
            optimize=False,
        )
        if destination.exists():
            backup = Path(
                tempfile.mkdtemp(prefix=f".{destination.name}-backup-", dir=destination_parent)
            )
            backup.rmdir()
            destination.replace(backup)
        stage.replace(destination)
        if backup is not None:
            shutil.rmtree(backup)
        return ReviewArtifacts(
            contact_sheet=destination / contact_path.name,
            animated_preview=destination / preview_path.name,
        )
    except Exception:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        if backup is not None and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise


def _resolve_review_destination(source_root: Path, destination: Path) -> tuple[Path, Path]:
    if source_root.is_symlink():
        raise ValueError("The Blender source root must not be a symbolic link.")
    try:
        resolved_source = source_root.resolve(strict=True)
    except OSError as error:
        raise ValueError("The Blender source root does not exist.") from error
    if not resolved_source.is_dir():
        raise ValueError("The Blender source root must be a directory.")
    if destination.name != "review":
        raise ValueError("The AF-052 review destination must be named 'review'.")
    if destination.is_symlink():
        raise ValueError("The AF-052 review destination must not be a symbolic link.")
    try:
        resolved_parent = destination.parent.resolve(strict=True)
    except OSError as error:
        raise ValueError("The AF-052 review destination parent does not exist.") from error
    if resolved_parent != resolved_source:
        raise ValueError("The AF-052 review must be a direct child of its source root.")
    resolved_destination = resolved_parent / destination.name
    if resolved_destination.exists() and not resolved_destination.is_dir():
        raise ValueError("The AF-052 review destination must be a directory.")
    return resolved_source, resolved_destination


def package_blender_walk_demo(source_root: Path, destination: Path) -> ReviewArtifacts:
    """Validate direct-yaw output and atomically publish a contact sheet and review GIF."""
    resolved_source, resolved_destination = _resolve_review_destination(source_root, destination)
    verify_evidence_root(
        resolved_source,
        expected_sources=source_hashes(
            BLENDER_TOOL_ROOT,
            BLENDER_CONTAINER_RECIPE,
            BLENDER_ORCHESTRATOR_RECIPE,
        ),
    )
    metadata, animation_root = _load_metadata(resolved_source)
    frames = _load_frames(metadata, animation_root)
    contact_sheet = _build_contact_sheet(metadata, frames)
    previews = _build_preview_frames(metadata, frames)
    durations = tuple(
        record.duration_ms for record in metadata.frames[: metadata.frames_per_direction]
    )
    return _publish_review(resolved_destination, contact_sheet, previews, durations)


def build_parser() -> argparse.ArgumentParser:
    """Build the narrow AF-052 review command parser."""
    parser = argparse.ArgumentParser(
        description="Validate Blender walk frames and build human-review media."
    )
    parser.add_argument("--source", required=True, type=Path, help="Blender output root.")
    parser.add_argument("--out", required=True, type=Path, help="Review output directory.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Package the Blender walk demo and report the two review artifacts."""
    arguments = build_parser().parse_args(argv)
    try:
        artifacts = package_blender_walk_demo(arguments.source, arguments.out)
    except (OSError, ValueError) as error:
        print(f"AF-052 review packaging failed: {error}")
        return 5
    print(f"Wrote AF-052 contact sheet to {artifacts.contact_sheet}")
    print(f"Wrote AF-052 animated preview to {artifacts.animated_preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
