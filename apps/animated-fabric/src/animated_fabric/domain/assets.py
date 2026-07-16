"""Persisted image-layer contracts."""

from __future__ import annotations

from typing import Self

from pydantic import model_validator

from animated_fabric.domain._base import DomainModel, ProjectPath, SemanticId, Sha256Digest
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction


class AssetLayer(DomainModel):
    """One immutable PNG layer located within a project."""

    asset_id: SemanticId
    direction: Direction
    semantic_part: SemanticId
    path: ProjectPath
    source_canvas_size: IntSize
    trim_origin: IntPoint
    trim_size: IntSize
    sha256: Sha256Digest
    optional: bool = False

    @model_validator(mode="after")
    def _validate_trim_bounds(self) -> Self:
        if self.trim_origin.x < 0 or self.trim_origin.y < 0:
            raise ValueError("trim_origin must be within the source canvas")
        if self.trim_origin.x + self.trim_size.width > self.source_canvas_size.width:
            raise ValueError("horizontal trim bounds exceed the source canvas")
        if self.trim_origin.y + self.trim_size.height > self.source_canvas_size.height:
            raise ValueError("vertical trim bounds exceed the source canvas")
        return self
