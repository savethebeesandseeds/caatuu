"""Strict persisted models for an Animated Fabric rig definition."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from animated_fabric.domain._base import DomainModel, SchemaVersion, SemanticId
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.project import Direction


class BoneDefinition(DomainModel):
    """A hierarchical transform node in its parent bone's coordinate space."""

    bone_id: SemanticId
    parent_id: SemanticId | None = None
    rest_transform: Transform2D = Field(default_factory=Transform2D)
    length_hint: float | None = Field(default=None, ge=0.0)
    locked: bool = False


class PartBinding(DomainModel):
    """Bind a visual part and its authored-direction assets to one bone."""

    part_id: SemanticId
    semantic_part: SemanticId
    bone_id: SemanticId
    assets_by_direction: dict[Direction, SemanticId] = Field(default_factory=dict)
    pivot_by_direction: dict[Direction, Vec2] = Field(default_factory=dict)
    bind_transform: Transform2D = Field(default_factory=Transform2D)
    draw_slot: SemanticId
    slot_order: int = 0
    visible: bool = True
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)


class SocketDefinition(DomainModel):
    """A named local transform used to attach equipment to a bone."""

    socket_id: SemanticId
    bone_id: SemanticId
    local_transform: Transform2D = Field(default_factory=Transform2D)
    default_draw_slot: SemanticId


class DirectionProfile(DomainModel):
    """Authored-direction overrides for structure, appearance, and motion."""

    bone_rest_transforms: dict[SemanticId, Transform2D] = Field(default_factory=dict)
    part_visibility: dict[SemanticId, bool] = Field(default_factory=dict)
    asset_selection: dict[SemanticId, SemanticId] = Field(default_factory=dict)
    pivots: dict[SemanticId, Vec2] = Field(default_factory=dict)
    slot_order: dict[SemanticId, int] = Field(default_factory=dict)
    track_multipliers: dict[str, float] = Field(default_factory=dict)


class RigDefinition(DomainModel):
    """The versioned persisted structure and direction profiles for an actor."""

    format: Literal["animated-fabric.rig.v1"]
    schema_version: SchemaVersion
    rig_id: SemanticId
    template_id: SemanticId
    bones: tuple[BoneDefinition, ...] = Field(default_factory=tuple)
    parts: tuple[PartBinding, ...] = Field(default_factory=tuple)
    sockets: tuple[SocketDefinition, ...] = Field(default_factory=tuple)
    direction_profiles: dict[Direction, DirectionProfile] = Field(default_factory=dict)
    draw_slot_profiles: dict[Direction, tuple[SemanticId, ...]] = Field(default_factory=dict)
