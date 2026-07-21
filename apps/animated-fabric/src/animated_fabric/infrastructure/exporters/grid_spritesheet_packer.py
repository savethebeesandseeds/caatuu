"""Verified frame-sequence to fixed-grid packing shared by product sources."""

from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from animated_fabric.application.exporting import (
    MAX_EXPORT_RAW_BYTES,
    MAX_EXPORT_SHEET_DIMENSION,
    CancellationToken,
    GridAnimationExportResult,
)
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind
from animated_fabric.domain.export import (
    GRID_SPRITESHEET_FORMAT,
    GRID_SPRITESHEET_SCHEMA_VERSION,
    FrameSequenceMetadata,
    GridSpritesheetFrame,
    GridSpritesheetMetadata,
)


class GridSpritesheetPacker:
    """Copy one verified RGBA frame sequence into canonical fixed grid cells."""

    def pack_animation(
        self,
        *,
        animation_root: Path,
        destination_root: Path,
        metadata: FrameSequenceMetadata,
        cancellation: CancellationToken | None = None,
    ) -> tuple[GridAnimationExportResult, GridSpritesheetMetadata]:
        """Pack one animation into an existing caller-owned transaction stage."""
        if not isinstance(animation_root, Path) or not isinstance(destination_root, Path):
            raise TypeError("Grid packing roots must be pathlib.Path values.")
        if not isinstance(metadata, FrameSequenceMetadata):
            raise TypeError("Grid packing requires strict frame-sequence metadata.")
        if cancellation is not None and not isinstance(cancellation, CancellationToken):
            raise TypeError("Grid packing cancellation must implement CancellationToken.")

        self._check_cancelled(cancellation, "before grid packing")
        self._verify_source(animation_root, metadata)
        self._verify_destination_stage(destination_root)
        self._preflight(metadata)

        image_path = Path(f"{metadata.animation}.png")
        metadata_path = Path(f"{metadata.animation}.spritesheet.json")
        grid_frames = self._write_and_verify_sheet(
            animation_root,
            destination_root / image_path,
            metadata,
            cancellation,
        )
        try:
            grid_metadata = GridSpritesheetMetadata(
                format=GRID_SPRITESHEET_FORMAT,
                schema_version=GRID_SPRITESHEET_SCHEMA_VERSION,
                project=metadata.project,
                animation=metadata.animation,
                image=image_path.as_posix(),
                frame_size=metadata.frame_size,
                origin=metadata.origin,
                fps=metadata.fps,
                duration_ms=metadata.duration_ms,
                directions=metadata.directions,
                frames_per_direction=metadata.frames_per_direction,
                frames=grid_frames,
            )
        except ValidationError as error:
            raise ExportError(
                "The generated grid spritesheet metadata is invalid.",
                kind=ExportFailureKind.VERIFICATION,
                path=metadata_path.as_posix(),
            ) from error

        self._write_and_verify_metadata(
            destination_root / metadata_path,
            grid_metadata,
            cancellation,
        )
        return (
            GridAnimationExportResult(
                animation=metadata.animation,
                frame_count=metadata.frames_per_direction,
                image_path=image_path,
                metadata_path=metadata_path,
            ),
            grid_metadata,
        )

    @staticmethod
    def _verify_source(animation_root: Path, metadata: FrameSequenceMetadata) -> None:
        if animation_root.is_symlink():
            raise ExportError(
                "The frame-sequence source must not be a symbolic link.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(animation_root),
            )
        try:
            resolved_root = animation_root.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise ExportError(
                "The frame-sequence source does not exist.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(animation_root),
            ) from error
        if not resolved_root.is_dir() or resolved_root.name != metadata.animation:
            raise ExportError(
                "The frame-sequence source does not match its animation ID.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(animation_root),
            )

        expected_files = {"animation.json", *(frame.image for frame in metadata.frames)}
        expected_directories = {direction.value for direction in metadata.directions}
        actual_files: set[str] = set()
        actual_directories: set[str] = set()
        try:
            candidates = tuple(resolved_root.rglob("*"))
            for candidate in candidates:
                relative = candidate.relative_to(resolved_root).as_posix()
                if candidate.is_symlink():
                    raise ExportError(
                        "The frame-sequence source must not contain symbolic links.",
                        kind=ExportFailureKind.VERIFICATION,
                        path=f"{metadata.animation}/{relative}",
                    )
                if candidate.is_dir():
                    actual_directories.add(relative)
                elif candidate.is_file():
                    actual_files.add(relative)
                else:
                    raise ExportError(
                        "The frame-sequence source must contain only regular files "
                        "and directories.",
                        kind=ExportFailureKind.VERIFICATION,
                        path=f"{metadata.animation}/{relative}",
                    )
        except ExportError:
            raise
        except (OSError, RuntimeError) as error:
            raise ExportError(
                "The frame-sequence source cannot be inspected safely.",
                kind=ExportFailureKind.VERIFICATION,
                path=metadata.animation,
            ) from error
        if actual_files != expected_files or actual_directories != expected_directories:
            raise ExportError(
                "The frame-sequence source has an unexpected file tree.",
                kind=ExportFailureKind.VERIFICATION,
                path=metadata.animation,
            )

        metadata_path = resolved_root / "animation.json"
        try:
            parsed = FrameSequenceMetadata.model_validate_json(metadata_path.read_bytes())
        except (OSError, ValidationError) as error:
            raise ExportError(
                "The frame-sequence metadata could not be verified.",
                kind=ExportFailureKind.VERIFICATION,
                path=f"{metadata.animation}/animation.json",
            ) from error
        if parsed != metadata:
            raise ExportError(
                "The frame-sequence metadata differs from the packing request.",
                kind=ExportFailureKind.VERIFICATION,
                path=f"{metadata.animation}/animation.json",
            )

    @staticmethod
    def _verify_destination_stage(destination_root: Path) -> None:
        if destination_root.is_symlink():
            raise ExportError(
                "The grid transaction stage must not be a symbolic link.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(destination_root),
            )
        try:
            resolved = destination_root.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise ExportError(
                "The grid transaction stage does not exist.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(destination_root),
            ) from error
        if not resolved.is_dir():
            raise ExportError(
                "The grid transaction stage must be a directory.",
                kind=ExportFailureKind.VERIFICATION,
                path=str(destination_root),
            )

    @staticmethod
    def _preflight(metadata: FrameSequenceMetadata) -> None:
        sheet_width = metadata.frame_size.width * metadata.frames_per_direction
        sheet_height = metadata.frame_size.height * len(metadata.directions)
        if sheet_width > MAX_EXPORT_SHEET_DIMENSION or sheet_height > MAX_EXPORT_SHEET_DIMENSION:
            raise ExportError(
                f"A grid spritesheet dimension would exceed {MAX_EXPORT_SHEET_DIMENSION} pixels.",
                kind=ExportFailureKind.INVALID_PROFILE,
            )
        if sheet_width * sheet_height * 4 > MAX_EXPORT_RAW_BYTES:
            raise ExportError(
                f"A grid spritesheet may not exceed {MAX_EXPORT_RAW_BYTES} raw RGBA bytes.",
                kind=ExportFailureKind.INVALID_PROFILE,
            )

    def _write_and_verify_sheet(
        self,
        animation_root: Path,
        destination: Path,
        metadata: FrameSequenceMetadata,
        cancellation: CancellationToken | None,
    ) -> tuple[GridSpritesheetFrame, ...]:
        frame_width = metadata.frame_size.width
        frame_height = metadata.frame_size.height
        sheet_size = (
            frame_width * metadata.frames_per_direction,
            frame_height * len(metadata.directions),
        )
        grid_frames: list[GridSpritesheetFrame] = []
        source_paths: list[Path] = []

        try:
            self._reject_existing_output(destination)
            with Image.new("RGBA", sheet_size, (0, 0, 0, 0)) as sheet:
                for row, direction in enumerate(metadata.directions):
                    start = row * metadata.frames_per_direction
                    end = start + metadata.frames_per_direction
                    for frame in metadata.frames[start:end]:
                        source = animation_root.joinpath(*frame.image.split("/"))
                        self._check_cancelled(
                            cancellation,
                            f"{metadata.animation}/{frame.image}",
                        )
                        with Image.open(source) as image:
                            if (
                                image.format != "PNG"
                                or image.mode != "RGBA"
                                or image.size != (frame_width, frame_height)
                            ):
                                raise ExportError(
                                    "A source frame does not match the RGBA canvas contract.",
                                    kind=ExportFailureKind.VERIFICATION,
                                    path=f"{metadata.animation}/{frame.image}",
                                )
                            image.load()
                            cell = (frame.index * frame_width, row * frame_height)
                            sheet.paste(image, cell)
                        rect = (
                            frame.index * frame_width,
                            row * frame_height,
                            frame_width,
                            frame_height,
                        )
                        grid_frames.append(
                            GridSpritesheetFrame(
                                direction=direction,
                                index=frame.index,
                                rect=rect,
                                duration_ms=frame.duration_ms,
                                events=frame.events,
                            )
                        )
                        source_paths.append(source)

                self._check_cancelled(cancellation, destination.name)
                with destination.open("x+b") as stream:
                    sheet.save(
                        stream,
                        format="PNG",
                        optimize=False,
                        compress_level=9,
                        pnginfo=None,
                    )
                    stream.flush()
                    os.fsync(stream.fileno())
        except ExportError:
            raise
        except MemoryError:
            raise
        except (
            Image.DecompressionBombError,
            OSError,
            SyntaxError,
            UnidentifiedImageError,
            ValueError,
        ) as error:
            raise ExportError(
                "The grid spritesheet image could not be assembled safely.",
                kind=ExportFailureKind.VERIFICATION,
                path=destination.name,
            ) from error

        self._verify_sheet(
            destination,
            sheet_size,
            tuple(source_paths),
            tuple(grid_frames),
            cancellation,
        )
        return tuple(grid_frames)

    def _verify_sheet(
        self,
        destination: Path,
        expected_size: tuple[int, int],
        source_paths: tuple[Path, ...],
        frames: tuple[GridSpritesheetFrame, ...],
        cancellation: CancellationToken | None,
    ) -> None:
        try:
            with Image.open(destination) as sheet:
                if sheet.format != "PNG" or sheet.mode != "RGBA" or sheet.size != expected_size:
                    raise ExportError(
                        "The staged grid spritesheet has the wrong image contract.",
                        kind=ExportFailureKind.VERIFICATION,
                        path=destination.name,
                    )
                sheet.load()
                for source_path, frame in zip(source_paths, frames, strict=True):
                    self._check_cancelled(
                        cancellation,
                        f"verify:{frame.direction.value}/{frame.index}",
                    )
                    x, y, width, height = frame.rect
                    with Image.open(source_path) as source:
                        if (
                            source.format != "PNG"
                            or source.mode != "RGBA"
                            or source.size != (width, height)
                        ):
                            raise ExportError(
                                "A grid cell differs from its source frame.",
                                kind=ExportFailureKind.VERIFICATION,
                                path=destination.name,
                                location=f"frames[{frame.direction.value}:{frame.index}]",
                            )
                        source.load()
                        if sheet.crop((x, y, x + width, y + height)).tobytes() != source.tobytes():
                            raise ExportError(
                                "A grid cell differs from its source frame.",
                                kind=ExportFailureKind.VERIFICATION,
                                path=destination.name,
                                location=f"frames[{frame.direction.value}:{frame.index}]",
                            )
        except ExportError:
            raise
        except (
            Image.DecompressionBombError,
            OSError,
            SyntaxError,
            UnidentifiedImageError,
            ValueError,
        ) as error:
            raise ExportError(
                "The staged grid spritesheet could not be decoded and verified.",
                kind=ExportFailureKind.VERIFICATION,
                path=destination.name,
            ) from error

    @staticmethod
    def _write_and_verify_metadata(
        destination: Path,
        metadata: GridSpritesheetMetadata,
        cancellation: CancellationToken | None,
    ) -> None:
        GridSpritesheetPacker._check_cancelled(cancellation, destination.name)
        try:
            GridSpritesheetPacker._reject_existing_output(destination)
            payload = json.dumps(
                metadata.model_dump(mode="json"),
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            with destination.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(payload + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            parsed = GridSpritesheetMetadata.model_validate_json(destination.read_bytes())
        except (OSError, ValidationError) as error:
            raise ExportError(
                "The grid spritesheet metadata could not be written and verified.",
                kind=ExportFailureKind.VERIFICATION,
                path=destination.name,
            ) from error
        if parsed != metadata:
            raise ExportError(
                "The verified grid metadata does not match the packing plan.",
                kind=ExportFailureKind.VERIFICATION,
                path=destination.name,
            )

    @staticmethod
    def _reject_existing_output(destination: Path) -> None:
        try:
            occupied = destination.exists() or destination.is_symlink()
        except OSError as error:
            raise ExportError(
                "The staged grid output slot cannot be inspected safely.",
                kind=ExportFailureKind.VERIFICATION,
                path=destination.name,
            ) from error
        if occupied:
            raise ExportError(
                "The staged grid output slot must be new.",
                kind=ExportFailureKind.VERIFICATION,
                path=destination.name,
            )

    @staticmethod
    def _check_cancelled(
        cancellation: CancellationToken | None,
        location: str,
    ) -> None:
        if cancellation is not None and cancellation.is_cancelled():
            raise ExportError(
                "The grid spritesheet packing operation was cancelled.",
                kind=ExportFailureKind.CANCELLED,
                location=location,
            )


__all__ = ["GridSpritesheetPacker"]
