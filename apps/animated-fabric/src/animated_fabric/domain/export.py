"""Persisted export-profile, frame-sequence, and grid metadata contracts."""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import Field, model_validator

from animated_fabric.domain._base import (
    DomainModel,
    ProjectPath,
    SemanticId,
    Sha256Digest,
)
from animated_fabric.domain.animation import EventId
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.domain.project import Direction, ProjectSlug

FRAME_SEQUENCE_FORMAT: Final = "animated-fabric.frame-sequence.v1"
FRAME_SEQUENCE_SCHEMA_VERSION: Final = "0.1.0"
GRID_SPRITESHEET_FORMAT: Final = "animated-fabric.grid-spritesheet.v1"
GRID_SPRITESHEET_SCHEMA_VERSION: Final = "0.1.0"
DIRECTIONAL_PRERENDER_FORMAT: Final = "animated-fabric.directional-prerender.v1"
DIRECTIONAL_PRERENDER_SCHEMA_VERSION: Final = "0.1.0"
DIRECTIONAL_PRERENDER_VIEWS: Final = (
    (Direction.SE, -90),
    (Direction.SW, 180),
    (Direction.NE, 0),
    (Direction.NW, 90),
)


class DirectionalPrerenderView(DomainModel):
    """One logical direction and its direct actor-root yaw."""

    direction: Direction
    actor_yaw_degrees: int = Field(ge=-180, le=180)


class DirectionalPrerenderMetadata(DomainModel):
    """Strict provenance boundary for one shared-motion 3D prerender batch."""

    format: Literal["animated-fabric.directional-prerender.v1"]
    schema_version: Literal["0.1.0"]
    project: ProjectSlug
    animation: SemanticId
    frame_sequence: ProjectPath
    view_strategy: Literal["actor_root_yaw"]
    motion_sha256: Sha256Digest
    views: tuple[DirectionalPrerenderView, ...]

    @model_validator(mode="after")
    def _validate_directional_contract(self) -> Self:
        expected_sequence = f"{self.animation}/animation.json"
        if self.frame_sequence != expected_sequence:
            raise ValueError(f"frame_sequence must be the canonical path '{expected_sequence}'")
        actual_views = tuple((view.direction, view.actor_yaw_degrees) for view in self.views)
        if actual_views != DIRECTIONAL_PRERENDER_VIEWS:
            raise ValueError(
                "views must contain the canonical SE, SW, NE, NW actor-root yaw mapping"
            )
        return self


class ExportProfile(DomainModel):
    """Configuration for a deterministic grid-spritesheet export."""

    profile_id: SemanticId
    format: Literal["animated-fabric.grid-spritesheet.v1"]
    animations: tuple[SemanticId, ...]
    directions: tuple[Direction, ...]
    fps: int = Field(gt=0)
    trim_frames: bool = False
    include_json: bool = True
    allow_clipping: bool = False
    include_generated_at: bool = False


class FrameSequenceFrame(DomainModel):
    """Metadata for one deterministic PNG in a frame-sequence export."""

    direction: Direction
    index: int = Field(ge=0)
    image: ProjectPath
    duration_ms: int = Field(gt=0)
    events: tuple[EventId, ...] = ()


class FrameSequenceMetadata(DomainModel):
    """The strict ``animated-fabric.frame-sequence.v1`` metadata artifact."""

    format: Literal["animated-fabric.frame-sequence.v1"]
    schema_version: Literal["0.1.0"]
    project: ProjectSlug
    animation: SemanticId
    frame_size: IntSize
    origin: Vec2
    fps: int = Field(gt=0)
    duration_ms: int = Field(gt=0)
    directions: tuple[Direction, ...] = Field(min_length=1)
    frames_per_direction: int = Field(gt=0)
    frames: tuple[FrameSequenceFrame, ...]

    @model_validator(mode="after")
    def _validate_frame_layout(self) -> Self:
        if len(set(self.directions)) != len(self.directions):
            raise ValueError("directions must not contain duplicates")

        expected_count = len(self.directions) * self.frames_per_direction
        if len(self.frames) != expected_count:
            raise ValueError(
                f"frames must contain exactly {expected_count} direction-major entries"
            )

        for direction_offset, direction in enumerate(self.directions):
            start = direction_offset * self.frames_per_direction
            end = start + self.frames_per_direction
            direction_frames = self.frames[start:end]
            for expected_index, frame in enumerate(direction_frames):
                if frame.direction is not direction or frame.index != expected_index:
                    raise ValueError("frames must be ordered direction-major and index-minor")
                expected_image = f"{direction.value}/{expected_index:03d}.png"
                if frame.image != expected_image:
                    raise ValueError(f"frame image must be the canonical path '{expected_image}'")
            if sum(frame.duration_ms for frame in direction_frames) != self.duration_ms:
                raise ValueError(
                    f"frame durations for direction '{direction.value}' must sum exactly "
                    "to duration_ms"
                )

        return self


class GridSpritesheetFrame(DomainModel):
    """Metadata locating one animation frame within a fixed-cell grid."""

    direction: Direction
    index: int = Field(ge=0)
    rect: tuple[int, int, int, int]
    duration_ms: int = Field(gt=0)
    events: tuple[EventId, ...] = ()

    @model_validator(mode="after")
    def _validate_rect(self) -> Self:
        x, y, width, height = self.rect
        if x < 0 or y < 0:
            raise ValueError("rect origin coordinates must be non-negative")
        if width <= 0 or height <= 0:
            raise ValueError("rect dimensions must be positive")
        return self


class GridSpritesheetMetadata(DomainModel):
    """The strict ``animated-fabric.grid-spritesheet.v1`` metadata artifact."""

    format: Literal["animated-fabric.grid-spritesheet.v1"]
    schema_version: Literal["0.1.0"]
    project: ProjectSlug
    animation: SemanticId
    image: ProjectPath
    frame_size: IntSize
    origin: Vec2
    fps: int = Field(gt=0)
    duration_ms: int = Field(gt=0)
    directions: tuple[Direction, ...] = Field(min_length=1)
    frames_per_direction: int = Field(gt=0)
    frames: tuple[GridSpritesheetFrame, ...]

    @model_validator(mode="after")
    def _validate_frame_layout(self) -> Self:
        expected_image = f"{self.animation}.png"
        if self.image != expected_image:
            raise ValueError(f"image must be the canonical path '{expected_image}'")
        if len(set(self.directions)) != len(self.directions):
            raise ValueError("directions must not contain duplicates")

        expected_count = len(self.directions) * self.frames_per_direction
        if len(self.frames) != expected_count:
            raise ValueError(
                f"frames must contain exactly {expected_count} direction-major entries"
            )

        width = self.frame_size.width
        height = self.frame_size.height
        for direction_offset, direction in enumerate(self.directions):
            start = direction_offset * self.frames_per_direction
            end = start + self.frames_per_direction
            direction_frames = self.frames[start:end]
            for expected_index, frame in enumerate(direction_frames):
                if frame.direction is not direction or frame.index != expected_index:
                    raise ValueError("frames must be ordered direction-major and index-minor")
                expected_rect = (
                    expected_index * width,
                    direction_offset * height,
                    width,
                    height,
                )
                if frame.rect != expected_rect:
                    raise ValueError(f"frame rect must be the canonical cell {expected_rect}")
            if sum(frame.duration_ms for frame in direction_frames) != self.duration_ms:
                raise ValueError(
                    f"frame durations for direction '{direction.value}' must sum exactly "
                    "to duration_ms"
                )

        return self


__all__ = [
    "DIRECTIONAL_PRERENDER_FORMAT",
    "DIRECTIONAL_PRERENDER_SCHEMA_VERSION",
    "DIRECTIONAL_PRERENDER_VIEWS",
    "DirectionalPrerenderMetadata",
    "DirectionalPrerenderView",
    "FRAME_SEQUENCE_FORMAT",
    "FRAME_SEQUENCE_SCHEMA_VERSION",
    "GRID_SPRITESHEET_FORMAT",
    "GRID_SPRITESHEET_SCHEMA_VERSION",
    "ExportProfile",
    "FrameSequenceFrame",
    "FrameSequenceMetadata",
    "GridSpritesheetFrame",
    "GridSpritesheetMetadata",
]
