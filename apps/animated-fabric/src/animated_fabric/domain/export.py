"""Persisted export-profile contracts for Animated Fabric."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from animated_fabric.domain._base import DomainModel, SemanticId
from animated_fabric.domain.project import Direction


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
