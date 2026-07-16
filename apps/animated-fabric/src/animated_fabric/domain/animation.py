"""Persisted animation-clip contracts for Animated Fabric."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from animated_fabric.domain._base import DomainModel, JsonValue, SchemaVersion, SemanticId


class TargetType(StrEnum):
    """Kinds of rig elements that an animation track can target."""

    BONE = "bone"
    PART = "part"


class TrackProperty(StrEnum):
    """Channels supported by the MVP animation format."""

    POSITION_X = "position_x"
    POSITION_Y = "position_y"
    ROTATION_DEG = "rotation_deg"
    SCALE_X = "scale_x"
    SCALE_Y = "scale_y"
    OPACITY = "opacity"
    VISIBLE = "visible"
    Z_BIAS = "z_bias"


class ValueMode(StrEnum):
    """How a track value combines with the rig's rest state."""

    DELTA = "delta"
    ABSOLUTE = "absolute"


class Interpolation(StrEnum):
    """Interpolation modes supported between adjacent keyframes."""

    STEP = "step"
    LINEAR = "linear"
    SMOOTH = "smooth"


EventId = Annotated[
    str,
    StringConstraints(
        strict=True,
        pattern=r"^(?:[a-z][a-z0-9_]*|sound:[a-z][a-z0-9_]*)$",
    ),
]

type AnimationValue = bool | int | float


class Keyframe(DomainModel):
    """One typed value at a non-negative clip-relative time."""

    time_ms: int = Field(ge=0)
    value: AnimationValue
    interpolation: Interpolation


class AnimationTrack(DomainModel):
    """An ordered sequence of keyframes targeting one rig channel."""

    target_type: TargetType
    target_id: SemanticId
    property: TrackProperty
    value_mode: ValueMode = ValueMode.DELTA
    keys: tuple[Keyframe, ...] = ()


class AnimationEvent(DomainModel):
    """Semantic metadata emitted at a clip-relative time."""

    time_ms: int = Field(ge=0)
    event: EventId


class GeneratorProvenance(DomainModel):
    """Informational record of the generator that created editable tracks."""

    generator_id: SemanticId
    parameters: dict[str, JsonValue] = Field(default_factory=dict)


class AnimationClip(DomainModel):
    """The normative ``animated-fabric.animation-clip.v1`` artifact."""

    format: Literal["animated-fabric.animation-clip.v1"]
    schema_version: SchemaVersion
    clip_id: SemanticId
    display_name: str = Field(min_length=1)
    template_id: SemanticId
    duration_ms: int = Field(gt=0)
    loop: bool
    fps_hint: int = Field(gt=0)
    tracks: tuple[AnimationTrack, ...] = ()
    events: tuple[AnimationEvent, ...] = ()
    generator_provenance: GeneratorProvenance | None = None
