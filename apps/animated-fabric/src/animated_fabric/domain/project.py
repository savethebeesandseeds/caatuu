"""Strict project-manifest contracts."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, model_validator
from pydantic.types import UUID4

from animated_fabric.domain._base import DomainModel, ProjectPath, SchemaVersion, SemanticId
from animated_fabric.domain.geometry import SelectionEllipse, Vec2


class Direction(StrEnum):
    """Supported logical isometric directions."""

    SE = "SE"
    SW = "SW"
    NE = "NE"
    NW = "NW"


class DirectionMode(StrEnum):
    """Whether a direction owns art or mirrors another direction."""

    AUTHORED = "authored"
    MIRROR = "mirror"


class PixelSnap(StrEnum):
    """World-translation pixel snapping applied before rasterization."""

    NONE = "none"
    INTEGER = "integer"


class CanvasDefinition(DomainModel):
    """Fixed logical canvas and ground-contact configuration."""

    width: int = Field(gt=0)
    height: int = Field(gt=0)
    ground_anchor: Vec2
    pixel_snap: PixelSnap = PixelSnap.NONE


class DirectionDefinition(DomainModel):
    """Authorship or complete-frame mirroring for one logical direction."""

    mode: DirectionMode
    source: Direction | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def _validate_source(self) -> Self:
        if self.mode is DirectionMode.MIRROR and self.source is None:
            raise ValueError("a mirrored direction requires a source")
        if self.mode is DirectionMode.AUTHORED and self.source is not None:
            raise ValueError("an authored direction must not declare a source")
        return self


ProjectSlug = Annotated[
    str,
    StringConstraints(
        strict=True,
        min_length=3,
        max_length=64,
        pattern=r"^[a-z][a-z0-9_]{2,63}$",
    ),
]


class ProjectManifest(DomainModel):
    """The normative ``animated-fabric.project.v1`` project manifest."""

    format: Literal["animated-fabric.project.v1"]
    schema_version: SchemaVersion
    project_id: UUID4
    slug: ProjectSlug
    display_name: str = Field(min_length=1)
    template_id: SemanticId
    canvas: CanvasDefinition
    directions: dict[Direction, DirectionDefinition]
    rig_path: ProjectPath
    animation_paths: tuple[ProjectPath, ...]
    export_profiles: tuple[SemanticId, ...]
    selection_ellipse: SelectionEllipse
