"""Deterministic ``humanoid_idle_v1`` animation generator."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from animated_fabric.application.animation_clip_builder import (
    AnimationClipBuilder,
    AnimationClipBuildRequest,
)
from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationTrack,
    GeneratorProvenance,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.rig import RigDefinition

_SQRT_THREE_OVER_TWO = 0.8660254037844386
_RIG_FAILURE_MESSAGE = "humanoid_idle_v1 requires a rig using the humanoid_v1 template."
_PARAMETER_FIELDS = frozenset(
    {
        "arm_drift_deg",
        "breath_y_px",
        "duration_ms",
        "head_counter_deg",
        "pelvis_shift_px",
        "torso_rotation_deg",
    }
)


class HumanoidIdleV1Parameters(BaseModel):
    """Validated effective parameters for ``humanoid_idle_v1``."""

    model_config = ConfigDict(
        allow_inf_nan=False,
        extra="forbid",
        frozen=True,
        strict=True,
        validate_default=True,
    )

    duration_ms: int = Field(
        default=2000,
        ge=4,
        json_schema_extra={
            "x-recommended-maximum": 4000,
            "x-recommended-minimum": 1200,
        },
    )
    breath_y_px: float = Field(
        default=1.5,
        ge=0.0,
        json_schema_extra={"x-recommended-maximum": 4.0, "x-recommended-minimum": 0.0},
    )
    torso_rotation_deg: float = Field(
        default=0.8,
        ge=0.0,
        json_schema_extra={"x-recommended-maximum": 3.0, "x-recommended-minimum": 0.0},
    )
    head_counter_deg: float = Field(
        default=0.5,
        ge=0.0,
        json_schema_extra={"x-recommended-maximum": 2.0, "x-recommended-minimum": 0.0},
    )
    arm_drift_deg: float = Field(
        default=0.7,
        ge=0.0,
        json_schema_extra={"x-recommended-maximum": 3.0, "x-recommended-minimum": 0.0},
    )
    pelvis_shift_px: float = Field(
        default=0.5,
        ge=0.0,
        json_schema_extra={"x-recommended-maximum": 2.0, "x-recommended-minimum": 0.0},
    )

    @field_validator(
        "breath_y_px",
        "torso_rotation_deg",
        "head_counter_deg",
        "arm_drift_deg",
        "pelvis_shift_px",
        mode="before",
    )
    @classmethod
    def normalize_amplitude(cls, value: object) -> float:
        """Accept only finite non-negative Python numbers and canonicalize zero."""
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("must be a finite non-negative number")
        try:
            normalized = float(value)
        except (OverflowError, ValueError) as error:
            raise ValueError("must be a finite non-negative number") from error
        if not math.isfinite(normalized) or normalized < 0.0:
            raise ValueError("must be a finite non-negative number")
        return 0.0 if normalized == 0.0 else normalized


class HumanoidIdleV1Generator:
    """Generate one fixed-shape, editable humanoid idle clip."""

    generator_id: ClassVar[str] = "humanoid_idle_v1"
    template_id: ClassVar[str] = "humanoid_v1"

    def validate_parameters(
        self,
        raw: Mapping[str, object],
    ) -> HumanoidIdleV1Parameters:
        """Validate raw typed parameters without coercion or exposing rejected values."""
        try:
            return HumanoidIdleV1Parameters.model_validate(raw)
        except ValidationError as error:
            raise AnimationError(_parameter_failure_message(error)) from None

    def generate(
        self,
        rig: RigDefinition,
        params: HumanoidIdleV1Parameters,
    ) -> AnimationClip:
        """Return a deterministic looping idle clip for one compatible rig."""
        if not isinstance(rig, RigDefinition):
            raise AnimationError(_RIG_FAILURE_MESSAGE)
        try:
            effective_rig = RigDefinition.model_validate(
                rig.model_dump(mode="python", round_trip=True, warnings=False)
            )
        except (ValidationError, TypeError, ValueError, OverflowError, RecursionError):
            raise AnimationError(_RIG_FAILURE_MESSAGE) from None
        if effective_rig.template_id != self.template_id:
            raise AnimationError(_RIG_FAILURE_MESSAGE)
        if not isinstance(params, HumanoidIdleV1Parameters):
            raise AnimationError("humanoid_idle_v1 requires validated HumanoidIdleV1Parameters.")
        try:
            effective = HumanoidIdleV1Parameters(
                duration_ms=params.duration_ms,
                breath_y_px=params.breath_y_px,
                torso_rotation_deg=params.torso_rotation_deg,
                head_counter_deg=params.head_counter_deg,
                arm_drift_deg=params.arm_drift_deg,
                pelvis_shift_px=params.pelvis_shift_px,
            )
        except ValidationError as error:
            raise AnimationError(_parameter_failure_message(error)) from None

        phase_times = (
            0,
            effective.duration_ms // 4,
            (2 * effective.duration_ms) // 4,
            (3 * effective.duration_ms) // 4,
        )
        tracks = (
            _track(
                "torso",
                TrackProperty.POSITION_Y,
                effective.breath_y_px,
                (-1.0, 0.0, 1.0, 0.0),
                phase_times,
            ),
            _track(
                "torso",
                TrackProperty.ROTATION_DEG,
                effective.torso_rotation_deg,
                (0.0, 1.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "head",
                TrackProperty.ROTATION_DEG,
                effective.head_counter_deg,
                (0.0, -1.0, 0.0, 1.0),
                phase_times,
            ),
            _track(
                "pelvis",
                TrackProperty.POSITION_X,
                effective.pelvis_shift_px,
                (0.0, 1.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "upper_arm_l",
                TrackProperty.ROTATION_DEG,
                effective.arm_drift_deg,
                (
                    _SQRT_THREE_OVER_TWO,
                    0.5,
                    -_SQRT_THREE_OVER_TWO,
                    -0.5,
                ),
                phase_times,
            ),
            _track(
                "upper_arm_r",
                TrackProperty.ROTATION_DEG,
                effective.arm_drift_deg,
                (
                    -_SQRT_THREE_OVER_TWO,
                    0.5,
                    _SQRT_THREE_OVER_TWO,
                    -0.5,
                ),
                phase_times,
            ),
        )
        result = AnimationClipBuilder().build(
            AnimationClipBuildRequest(
                rig=effective_rig,
                diagnostic_path="animations/idle.animated-clip.json",
                clip_id="idle",
                display_name="Idle",
                duration_ms=effective.duration_ms,
                loop=True,
                fps_hint=12,
                tracks=tracks,
                events=(),
                generator_provenance=GeneratorProvenance(
                    generator_id=self.generator_id,
                    parameters={
                        "duration_ms": effective.duration_ms,
                        "breath_y_px": effective.breath_y_px,
                        "torso_rotation_deg": effective.torso_rotation_deg,
                        "head_counter_deg": effective.head_counter_deg,
                        "arm_drift_deg": effective.arm_drift_deg,
                        "pelvis_shift_px": effective.pelvis_shift_px,
                    },
                ),
            )
        )
        if result.value is None or result.has_errors:
            raise AnimationError(
                "humanoid_idle_v1 could not build a valid clip for the supplied rig."
            )
        return result.value


def _track(
    target_id: str,
    property_name: TrackProperty,
    amplitude: float,
    coefficients: tuple[float, float, float, float],
    phase_times: tuple[int, int, int, int],
) -> AnimationTrack:
    return AnimationTrack(
        target_type=TargetType.BONE,
        target_id=target_id,
        property=property_name,
        value_mode=ValueMode.DELTA,
        keys=tuple(
            Keyframe(
                time_ms=time_ms,
                value=_scaled(coefficient, amplitude),
                interpolation=Interpolation.SMOOTH,
            )
            for time_ms, coefficient in zip(phase_times, coefficients, strict=True)
        ),
    )


def _scaled(coefficient: float, amplitude: float) -> float:
    if coefficient == 0.0 or amplitude == 0.0:
        return 0.0
    return coefficient * amplitude


def _parameter_failure_message(error: ValidationError) -> str:
    field: str | None = None
    errors = error.errors(include_url=False, include_input=False)
    if errors:
        location = errors[0]["loc"]
        top_level = location[0] if location else None
        if isinstance(top_level, str) and top_level in _PARAMETER_FIELDS:
            field = top_level
    if field is None:
        return "Invalid humanoid_idle_v1 parameters."
    return f"Invalid humanoid_idle_v1 parameter '{field}'."


__all__ = ["HumanoidIdleV1Generator", "HumanoidIdleV1Parameters"]
