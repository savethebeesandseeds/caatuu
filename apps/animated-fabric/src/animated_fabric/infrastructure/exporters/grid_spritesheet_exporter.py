"""Deterministic fixed-cell grid spritesheet export infrastructure."""

from __future__ import annotations

import json
import os
from dataclasses import replace
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from animated_fabric.application.exporting import (
    MAX_EXPORT_RAW_BYTES,
    MAX_EXPORT_SHEET_DIMENSION,
    AnimationExportResult,
    ExportRequest,
    ExportResult,
    FrameSample,
    GridAnimationExportResult,
    build_frame_schedule,
)
from animated_fabric.application.rendering import Renderer
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind
from animated_fabric.domain.export import (
    FRAME_SEQUENCE_FORMAT,
    FRAME_SEQUENCE_SCHEMA_VERSION,
    GRID_SPRITESHEET_FORMAT,
    GRID_SPRITESHEET_SCHEMA_VERSION,
    FrameSequenceFrame,
    FrameSequenceMetadata,
    GridSpritesheetFrame,
    GridSpritesheetMetadata,
)
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.infrastructure.exporters._transaction import (
    create_export_staging,
    discard_export_staging,
    promote_export_staging,
    relative_export_files,
    validate_export_destination,
)
from animated_fabric.infrastructure.exporters.frame_exporter import FrameSequenceExporter


class GridSpritesheetExporter:
    """Pack shared-renderer frame sequences into one fixed grid per animation."""

    exporter_id = "grid_spritesheet_v1"

    def __init__(
        self,
        renderer: Renderer,
        frame_exporter: FrameSequenceExporter | None = None,
    ) -> None:
        self._frame_exporter = frame_exporter or FrameSequenceExporter(renderer)

    def export(self, request: ExportRequest) -> ExportResult[GridAnimationExportResult]:
        """Render through AF-050, pack, verify, and publish one grid transaction."""
        if not isinstance(request, ExportRequest):
            raise TypeError("Grid spritesheet export requires an ExportRequest.")

        schedules = self._preflight(request)
        self._check_cancelled(request, "before export IO")
        destination = validate_export_destination(request.destination, request.project.root)
        staging = create_export_staging(destination)
        sequence_root = staging / ".frame-sequences"
        retained_backup: Path | None = None

        try:
            sequence_result = self._frame_exporter.export(
                replace(request, destination=sequence_root)
            )
            results, metadata = self._pack_sheets(
                request,
                schedules,
                sequence_root,
                sequence_result,
                staging,
            )
            self._write_and_verify_metadata(request, staging, metadata)
            discard_export_staging(sequence_root)
            if sequence_root.exists():
                raise ExportError(
                    "The intermediate frame export could not be removed before publication.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=sequence_root.name,
                )
            expected_files = {
                path.as_posix()
                for result in results
                for path in (result.image_path, result.metadata_path)
            }
            if relative_export_files(staging) != expected_files:
                raise ExportError(
                    "The staged grid file set does not match the export plan.",
                    kind=ExportFailureKind.VERIFICATION,
                )
            self._check_cancelled(request, "before export publication")
            retained_backup = promote_export_staging(staging, destination)
        except ExportError:
            raise
        except MemoryError as error:
            raise ExportError(
                "The grid spritesheet could not be allocated within the export memory limit.",
                kind=ExportFailureKind.INVALID_PROFILE,
            ) from error
        except OSError as error:
            raise ExportError(
                "The grid spritesheet export could not be published safely.",
                kind=ExportFailureKind.PUBLICATION,
                path=str(destination),
            ) from error
        finally:
            discard_export_staging(staging)

        return ExportResult(
            destination=destination,
            animations=results,
            retained_backup=retained_backup,
        )

    @staticmethod
    def _preflight(request: ExportRequest) -> tuple[tuple[FrameSample, ...], ...]:
        try:
            schedules = tuple(
                build_frame_schedule(animation, request.fps) for animation in request.animations
            )
        except (TypeError, ValueError) as error:
            raise ExportError(
                str(error) or "The grid frame schedule is invalid.",
                kind=ExportFailureKind.INVALID_PROFILE,
            ) from error

        canvas = request.project.manifest.canvas
        for schedule in schedules:
            sheet_width = canvas.width * len(schedule)
            sheet_height = canvas.height * len(request.directions)
            if (
                sheet_width > MAX_EXPORT_SHEET_DIMENSION
                or sheet_height > MAX_EXPORT_SHEET_DIMENSION
            ):
                raise ExportError(
                    "A grid spritesheet dimension would exceed "
                    f"{MAX_EXPORT_SHEET_DIMENSION} pixels.",
                    kind=ExportFailureKind.INVALID_PROFILE,
                )
            if sheet_width * sheet_height * 4 > MAX_EXPORT_RAW_BYTES:
                raise ExportError(
                    f"A grid spritesheet may not exceed {MAX_EXPORT_RAW_BYTES} raw RGBA bytes.",
                    kind=ExportFailureKind.INVALID_PROFILE,
                )
        return schedules

    def _pack_sheets(
        self,
        request: ExportRequest,
        schedules: tuple[tuple[FrameSample, ...], ...],
        sequence_root: Path,
        sequence_result: ExportResult[AnimationExportResult],
        staging: Path,
    ) -> tuple[tuple[GridAnimationExportResult, ...], tuple[GridSpritesheetMetadata, ...]]:
        results: list[GridAnimationExportResult] = []
        metadata_documents: list[GridSpritesheetMetadata] = []
        canvas = request.project.manifest.canvas

        if (
            sequence_result.destination != sequence_root
            or sequence_result.retained_backup is not None
            or len(sequence_result.animations) != len(request.animations)
        ):
            raise ExportError(
                "The intermediate frame export returned the wrong transaction contract.",
                kind=ExportFailureKind.VERIFICATION,
            )

        for animation, schedule, sequence_animation in zip(
            request.animations,
            schedules,
            sequence_result.animations,
            strict=True,
        ):
            self._check_cancelled(request, animation.clip_id)
            metadata_path = sequence_root / animation.clip_id / "animation.json"
            sequence_metadata = self._load_sequence_metadata(metadata_path, animation.clip_id)
            expected_frame_paths = tuple(
                Path(animation.clip_id) / direction.value / f"{sample.index:03d}.png"
                for direction in request.directions
                for sample in schedule
            )
            expected_metadata = FrameSequenceMetadata(
                format=FRAME_SEQUENCE_FORMAT,
                schema_version=FRAME_SEQUENCE_SCHEMA_VERSION,
                project=request.project.manifest.slug,
                animation=animation.clip_id,
                frame_size=IntSize(width=canvas.width, height=canvas.height),
                origin=Vec2(
                    x=canvas.ground_anchor.x,
                    y=canvas.ground_anchor.y,
                ),
                fps=request.fps,
                duration_ms=animation.duration_ms,
                directions=request.directions,
                frames_per_direction=len(schedule),
                frames=tuple(
                    FrameSequenceFrame(
                        direction=direction,
                        index=sample.index,
                        image=f"{direction.value}/{sample.index:03d}.png",
                        duration_ms=sample.duration_ms,
                        events=sample.events,
                    )
                    for direction in request.directions
                    for sample in schedule
                ),
            )
            if (
                not isinstance(sequence_animation, AnimationExportResult)
                or sequence_animation.animation != animation.clip_id
                or sequence_animation.frame_count != len(schedule)
                or sequence_animation.metadata_path != Path(animation.clip_id) / "animation.json"
                or sequence_animation.frame_paths != expected_frame_paths
                or sequence_metadata != expected_metadata
            ):
                raise ExportError(
                    "The intermediate frame export does not match the grid plan.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=animation.clip_id,
                )

            image_path = Path(f"{animation.clip_id}.png")
            grid_metadata_path = Path(f"{animation.clip_id}.spritesheet.json")
            grid_frames = self._write_and_verify_sheet(
                request,
                sequence_root / animation.clip_id,
                staging / image_path,
                sequence_metadata,
            )
            try:
                grid_metadata = GridSpritesheetMetadata(
                    format=GRID_SPRITESHEET_FORMAT,
                    schema_version=GRID_SPRITESHEET_SCHEMA_VERSION,
                    project=request.project.manifest.slug,
                    animation=animation.clip_id,
                    image=image_path.as_posix(),
                    frame_size=IntSize(width=canvas.width, height=canvas.height),
                    origin=Vec2(
                        x=canvas.ground_anchor.x,
                        y=canvas.ground_anchor.y,
                    ),
                    fps=request.fps,
                    duration_ms=animation.duration_ms,
                    directions=request.directions,
                    frames_per_direction=len(schedule),
                    frames=grid_frames,
                )
            except ValidationError as error:
                raise ExportError(
                    "The generated grid spritesheet metadata is invalid.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=grid_metadata_path.as_posix(),
                ) from error
            results.append(
                GridAnimationExportResult(
                    animation=animation.clip_id,
                    frame_count=len(schedule),
                    image_path=image_path,
                    metadata_path=grid_metadata_path,
                )
            )
            metadata_documents.append(grid_metadata)

        return tuple(results), tuple(metadata_documents)

    @staticmethod
    def _load_sequence_metadata(path: Path, animation_id: str) -> FrameSequenceMetadata:
        try:
            metadata = FrameSequenceMetadata.model_validate_json(path.read_bytes())
        except (OSError, ValidationError) as error:
            raise ExportError(
                "The intermediate frame metadata could not be verified.",
                kind=ExportFailureKind.VERIFICATION,
                path=f"{animation_id}/animation.json",
            ) from error
        if metadata.animation != animation_id:
            raise ExportError(
                "The intermediate frame metadata names the wrong animation.",
                kind=ExportFailureKind.VERIFICATION,
                path=f"{animation_id}/animation.json",
            )
        return metadata

    def _write_and_verify_sheet(
        self,
        request: ExportRequest,
        animation_root: Path,
        destination: Path,
        metadata: FrameSequenceMetadata,
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
            with Image.new("RGBA", sheet_size, (0, 0, 0, 0)) as sheet:
                for row, direction in enumerate(metadata.directions):
                    start = row * metadata.frames_per_direction
                    end = start + metadata.frames_per_direction
                    for frame in metadata.frames[start:end]:
                        relative_source = Path(*frame.image.split("/"))
                        source = animation_root / relative_source
                        self._check_cancelled(
                            request,
                            f"{metadata.animation}/{frame.image}",
                        )
                        with Image.open(source) as image:
                            image.load()
                            if (
                                image.format != "PNG"
                                or image.mode != "RGBA"
                                or image.size != (frame_width, frame_height)
                            ):
                                raise ExportError(
                                    "An intermediate frame does not match the RGBA "
                                    "canvas contract.",
                                    kind=ExportFailureKind.VERIFICATION,
                                    path=f"{metadata.animation}/{frame.image}",
                                )
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

                self._check_cancelled(request, destination.name)
                with destination.open("w+b") as stream:
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
            request,
            destination,
            sheet_size,
            tuple(source_paths),
            tuple(grid_frames),
        )
        return tuple(grid_frames)

    def _verify_sheet(
        self,
        request: ExportRequest,
        destination: Path,
        expected_size: tuple[int, int],
        source_paths: tuple[Path, ...],
        frames: tuple[GridSpritesheetFrame, ...],
    ) -> None:
        try:
            with Image.open(destination) as sheet:
                sheet.load()
                if sheet.format != "PNG" or sheet.mode != "RGBA" or sheet.size != expected_size:
                    raise ExportError(
                        "The staged grid spritesheet has the wrong image contract.",
                        kind=ExportFailureKind.VERIFICATION,
                        path=destination.name,
                    )
                for source_path, frame in zip(source_paths, frames, strict=True):
                    self._check_cancelled(
                        request,
                        f"verify:{frame.direction.value}/{frame.index}",
                    )
                    x, y, width, height = frame.rect
                    with Image.open(source_path) as source:
                        source.load()
                        if (
                            source.format != "PNG"
                            or source.mode != "RGBA"
                            or source.size != (width, height)
                            or sheet.crop((x, y, x + width, y + height)).tobytes()
                            != source.tobytes()
                        ):
                            raise ExportError(
                                "A grid cell differs from its shared-renderer source frame.",
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
        request: ExportRequest,
        staging: Path,
        metadata_documents: tuple[GridSpritesheetMetadata, ...],
    ) -> None:
        for metadata in metadata_documents:
            relative_path = f"{metadata.animation}.spritesheet.json"
            GridSpritesheetExporter._check_cancelled(request, relative_path)
            destination = staging / relative_path
            try:
                payload = json.dumps(
                    metadata.model_dump(mode="json"),
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                with destination.open("w", encoding="utf-8", newline="\n") as stream:
                    stream.write(payload + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                parsed = GridSpritesheetMetadata.model_validate_json(destination.read_bytes())
            except (OSError, ValidationError) as error:
                raise ExportError(
                    "The grid spritesheet metadata could not be written and verified.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=relative_path,
                ) from error
            if parsed != metadata:
                raise ExportError(
                    "The verified grid metadata does not match the export plan.",
                    kind=ExportFailureKind.VERIFICATION,
                    path=relative_path,
                )

    @staticmethod
    def _check_cancelled(request: ExportRequest, location: str) -> None:
        if request.cancellation is not None and request.cancellation.is_cancelled():
            raise ExportError(
                "The grid spritesheet export was cancelled.",
                kind=ExportFailureKind.CANCELLED,
                location=location,
            )


__all__ = ["GridSpritesheetExporter"]
