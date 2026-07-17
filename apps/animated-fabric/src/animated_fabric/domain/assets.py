"""Persisted image-layer contracts."""

from __future__ import annotations

from typing import Literal, Self

from pydantic import model_validator

from animated_fabric.domain._base import (
    DomainModel,
    ProjectPath,
    SchemaVersion,
    SemanticId,
    Sha256Digest,
)
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


class LayerManifest(DomainModel):
    """The canonical project-local catalog of immutable PNG layers."""

    format: Literal["animated-fabric.layer-manifest.v1"]
    schema_version: SchemaVersion
    layers: tuple[AssetLayer, ...]

    @model_validator(mode="after")
    def _validate_catalog_identity_and_order(self) -> Self:
        asset_ids: set[str] = set()
        paths: set[str] = set()
        direction_parts: set[tuple[Direction, str]] = set()

        for asset in self.layers:
            if asset.asset_id in asset_ids:
                raise ValueError(f"duplicate asset_id: {asset.asset_id}")
            asset_ids.add(asset.asset_id)

            if asset.path in paths:
                raise ValueError(f"duplicate asset path: {asset.path}")
            paths.add(asset.path)

            direction_part = (asset.direction, asset.semantic_part)
            if direction_part in direction_parts:
                raise ValueError(
                    "duplicate semantic_part "
                    f"'{asset.semantic_part}' for direction '{asset.direction.value}'"
                )
            direction_parts.add(direction_part)

        asset_order = tuple(asset.asset_id for asset in self.layers)
        if asset_order != tuple(sorted(asset_order)):
            raise ValueError("layers must be ordered by asset_id")
        return self


__all__ = ["AssetLayer", "LayerManifest"]
