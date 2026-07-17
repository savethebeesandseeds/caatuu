"""Deterministic rig-aware evaluation of persisted animation tracks."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationTrack,
    AnimationValue,
    Interpolation,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.exceptions import AnimationError, RigDefinitionError
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.hierarchy import (
    topological_bone_order,
    validate_topological_bone_order,
)
from animated_fabric.domain.interpolation import evaluate_track, normalize_clip_time
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import PartBinding, RigDefinition

_BONE_PROPERTIES = frozenset(
    {
        TrackProperty.POSITION_X,
        TrackProperty.POSITION_Y,
        TrackProperty.ROTATION_DEG,
        TrackProperty.SCALE_X,
        TrackProperty.SCALE_Y,
    }
)
_PART_PROPERTIES = frozenset(
    {
        TrackProperty.OPACITY,
        TrackProperty.VISIBLE,
        TrackProperty.Z_BIAS,
    }
)


@dataclass(frozen=True, slots=True)
class EvaluatedPartState:
    """Final non-geometric animation state for one visual part."""

    visible: bool
    opacity: float
    z_bias: int


@dataclass(frozen=True, slots=True)
class EvaluatedAnimation:
    """Immutable evaluated state ready for pose and draw-order resolution."""

    clip_id: str
    time_ms: float
    bone_deltas: Mapping[str, Transform2D]
    part_states: Mapping[str, EvaluatedPartState]


@dataclass(slots=True)
class _BoneDeltaBuilder:
    position_x: float = 0.0
    position_y: float = 0.0
    rotation_deg: float = 0.0
    scale_x: float = 1.0
    scale_y: float = 1.0
    changed: bool = False

    def build(self) -> Transform2D:
        return Transform2D(
            position=Vec2(x=self.position_x, y=self.position_y),
            rotation_deg=self.rotation_deg,
            scale=Vec2(x=self.scale_x, y=self.scale_y),
        )


@dataclass(slots=True)
class _PartStateBuilder:
    visible: bool
    opacity: float
    z_bias: int = 0

    def build(self) -> EvaluatedPartState:
        return EvaluatedPartState(
            visible=self.visible,
            opacity=self.opacity,
            z_bias=self.z_bias,
        )


class AnimationEvaluator:
    """Evaluate one validated clip against a rig and authored direction."""

    def evaluate(
        self,
        clip: AnimationClip,
        rig: RigDefinition,
        direction: Direction,
        time_ms: float,
        *,
        bone_order: tuple[str, ...] | None = None,
    ) -> EvaluatedAnimation:
        """Resolve tracks into pose-compatible bone deltas and final part states."""
        if clip.template_id != rig.template_id:
            raise AnimationError(
                f"Clip template '{clip.template_id}' does not match rig template "
                f"'{rig.template_id}'."
            )

        resolved_bone_order = (
            topological_bone_order(rig)
            if bone_order is None
            else validate_topological_bone_order(rig, bone_order)
        )
        bones_by_id = {bone.bone_id: bone for bone in rig.bones}
        parts_by_id = self._parts_by_id(rig)
        profile = rig.direction_profiles.get(direction)
        evaluated_time = normalize_clip_time(time_ms, clip.duration_ms, clip.loop)

        bone_builders: dict[str, _BoneDeltaBuilder] = {}
        part_builders = {
            part.part_id: _PartStateBuilder(
                visible=(
                    profile.part_visibility.get(part.part_id, part.visible)
                    if profile is not None
                    else part.visible
                ),
                opacity=part.opacity,
            )
            for part in rig.parts
        }
        seen_channels: set[tuple[TargetType, str, TrackProperty]] = set()

        for track in clip.tracks:
            channel = (track.target_type, track.target_id, track.property)
            if channel in seen_channels:
                raise AnimationError(
                    f"Animation channel '{track.target_type.value}:{track.target_id}."
                    f"{track.property.value}' is declared more than once."
                )
            seen_channels.add(channel)

            self._validate_track_target(track, bones_by_id, parts_by_id)
            self._validate_discrete_interpolation(track)
            self._validate_track_values(track, clip.duration_ms)
            value = evaluate_track(
                track,
                evaluated_time,
                clip.duration_ms,
                loop=False,
            )
            if value is None:
                continue
            value = self._apply_direction_multiplier(track, value, rig, direction)

            if track.target_type is TargetType.BONE:
                builder = bone_builders.setdefault(track.target_id, _BoneDeltaBuilder())
                rest_transform = bones_by_id[track.target_id].rest_transform
                if profile is not None:
                    rest_transform = profile.bone_rest_transforms.get(
                        track.target_id,
                        rest_transform,
                    )
                self._apply_bone_channel(builder, track, value, rest_transform)
            else:
                self._apply_part_channel(part_builders[track.target_id], track, value)

        bone_deltas = {
            bone_id: bone_builders[bone_id].build()
            for bone_id in resolved_bone_order
            if bone_id in bone_builders and bone_builders[bone_id].changed
        }
        part_states = {part.part_id: part_builders[part.part_id].build() for part in rig.parts}
        return EvaluatedAnimation(
            clip_id=clip.clip_id,
            time_ms=evaluated_time,
            bone_deltas=MappingProxyType(bone_deltas),
            part_states=MappingProxyType(part_states),
        )

    @staticmethod
    def _parts_by_id(rig: RigDefinition) -> dict[str, PartBinding]:
        parts: dict[str, PartBinding] = {}
        for part in rig.parts:
            if part.part_id in parts:
                raise RigDefinitionError(f"Duplicate part ID '{part.part_id}' cannot be animated.")
            parts[part.part_id] = part
        return parts

    @staticmethod
    def _validate_track_target(
        track: AnimationTrack,
        bones_by_id: Mapping[str, object],
        parts_by_id: Mapping[str, object],
    ) -> None:
        if track.target_type is TargetType.BONE:
            if track.target_id not in bones_by_id:
                raise AnimationError(f"Track targets missing bone '{track.target_id}'.")
            if track.property not in _BONE_PROPERTIES:
                raise AnimationError(
                    f"Property '{track.property.value}' is not valid for bone tracks."
                )
        else:
            if track.target_id not in parts_by_id:
                raise AnimationError(f"Track targets missing part '{track.target_id}'.")
            if track.property not in _PART_PROPERTIES:
                raise AnimationError(
                    f"Property '{track.property.value}' is not valid for part tracks."
                )

    @staticmethod
    def _validate_discrete_interpolation(track: AnimationTrack) -> None:
        if track.property not in {TrackProperty.VISIBLE, TrackProperty.Z_BIAS}:
            return
        if any(key.interpolation is not Interpolation.STEP for key in track.keys):
            raise AnimationError(f"Property '{track.property.value}' requires step interpolation.")

    @classmethod
    def _validate_track_values(cls, track: AnimationTrack, duration_ms: int) -> None:
        for key in track.keys:
            if key.time_ms > duration_ms:
                raise AnimationError(
                    f"Animation keyframe at {key.time_ms} ms exceeds duration {duration_ms} ms."
                )
            if track.property is TrackProperty.VISIBLE:
                if not isinstance(key.value, bool):
                    raise AnimationError("Visible-track values must be booleans.")
                continue
            if track.property is TrackProperty.Z_BIAS:
                if not isinstance(key.value, int) or isinstance(key.value, bool):
                    raise AnimationError("Z-bias track values must be integers.")
                continue

            number = cls._number(key.value, track.property)
            if (
                track.property is TrackProperty.OPACITY
                and track.value_mode is ValueMode.ABSOLUTE
                and not 0.0 <= number <= 1.0
            ):
                raise AnimationError("Absolute opacity must be between 0 and 1.")

    @classmethod
    def _apply_direction_multiplier(
        cls,
        track: AnimationTrack,
        value: AnimationValue,
        rig: RigDefinition,
        direction: Direction,
    ) -> AnimationValue:
        if track.value_mode is not ValueMode.DELTA or isinstance(value, bool):
            return value
        if not isinstance(value, (int, float)):
            return value
        profile = rig.direction_profiles.get(direction)
        if profile is None:
            return value
        channel_id = f"{track.target_id}.{track.property.value}"
        multiplier = profile.track_multipliers.get(channel_id)
        if multiplier is None:
            return value
        number = cls._number(value, track.property)
        if track.property in {TrackProperty.SCALE_X, TrackProperty.SCALE_Y}:
            result = math.fsum((1.0, (number - 1.0) * multiplier))
        else:
            result = number * multiplier
        return cls._finite_result(result, track.property)

    @classmethod
    def _apply_bone_channel(
        cls,
        builder: _BoneDeltaBuilder,
        track: AnimationTrack,
        value: AnimationValue,
        rest_transform: Transform2D,
    ) -> None:
        number = cls._number(value, track.property)
        is_absolute = track.value_mode is ValueMode.ABSOLUTE
        if track.property is TrackProperty.POSITION_X:
            builder.position_x = (
                cls._difference(number, rest_transform.position.x, track.property)
                if is_absolute
                else number
            )
        elif track.property is TrackProperty.POSITION_Y:
            builder.position_y = (
                cls._difference(number, rest_transform.position.y, track.property)
                if is_absolute
                else number
            )
        elif track.property is TrackProperty.ROTATION_DEG:
            builder.rotation_deg = (
                cls._difference(number, rest_transform.rotation_deg, track.property)
                if is_absolute
                else number
            )
        elif track.property is TrackProperty.SCALE_X:
            builder.scale_x = (
                cls._absolute_scale_factor(
                    number,
                    rest_transform.scale.x,
                    track.property,
                )
                if is_absolute
                else number
            )
        elif track.property is TrackProperty.SCALE_Y:
            builder.scale_y = (
                cls._absolute_scale_factor(
                    number,
                    rest_transform.scale.y,
                    track.property,
                )
                if is_absolute
                else number
            )
        else:  # pragma: no cover - guarded by _validate_track_target
            raise AnimationError(f"Unsupported bone property '{track.property.value}'.")
        builder.changed = True

    @classmethod
    def _apply_part_channel(
        cls,
        builder: _PartStateBuilder,
        track: AnimationTrack,
        value: AnimationValue,
    ) -> None:
        if track.property is TrackProperty.VISIBLE:
            if not isinstance(value, bool):
                raise AnimationError("Visible-track values must be booleans.")
            builder.visible = value
            return

        if track.property is TrackProperty.OPACITY:
            number = cls._number(value, track.property)
            if track.value_mode is ValueMode.ABSOLUTE:
                if not 0.0 <= number <= 1.0:
                    raise AnimationError("Absolute opacity must be between 0 and 1.")
                builder.opacity = number
            else:
                builder.opacity = min(1.0, max(0.0, builder.opacity + number))
            return

        if track.property is TrackProperty.Z_BIAS:
            if isinstance(value, int) and not isinstance(value, bool):
                builder.z_bias = value
                return
            number = cls._number(value, track.property)
            if not number.is_integer():
                raise AnimationError("Evaluated z-bias must be an integer.")
            builder.z_bias = int(number)
            return

        raise AnimationError(f"Unsupported part property '{track.property.value}'.")

    @staticmethod
    def _number(value: AnimationValue, property_name: TrackProperty) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise AnimationError(
                f"Property '{property_name.value}' requires a numeric animation value."
            )
        try:
            number = float(value)
        except (OverflowError, ValueError) as exc:
            raise AnimationError(
                f"Property '{property_name.value}' requires a finite numeric value."
            ) from exc
        return AnimationEvaluator._finite_result(number, property_name)

    @staticmethod
    def _finite_result(value: float, property_name: TrackProperty) -> float:
        if not math.isfinite(value):
            raise AnimationError(f"Evaluated property '{property_name.value}' must remain finite.")
        return value

    @classmethod
    def _difference(
        cls,
        value: float,
        rest_value: float,
        property_name: TrackProperty,
    ) -> float:
        return cls._finite_result(value - rest_value, property_name)

    @classmethod
    def _absolute_scale_factor(
        cls,
        value: float,
        rest_value: float,
        property_name: TrackProperty,
    ) -> float:
        if rest_value == 0.0:
            if value == 0.0:
                return 1.0
            raise AnimationError(
                "An absolute non-zero scale cannot be resolved from a zero rest scale."
            )
        return cls._finite_result(value / rest_value, property_name)


__all__ = ["AnimationEvaluator", "EvaluatedAnimation", "EvaluatedPartState"]
