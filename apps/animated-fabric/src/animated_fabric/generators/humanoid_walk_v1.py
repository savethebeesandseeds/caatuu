"""Deterministic ``humanoid_walk_v1`` animation generator."""

from __future__ import annotations

from collections.abc import Mapping
from typing import ClassVar

from pydantic import Field, ValidationError, field_validator

from animated_fabric.application.animation_clip_builder import (
    AnimationClipBuilder,
    AnimationClipBuildRequest,
)
from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationEvent,
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
from animated_fabric.generators._support import (
    GeneratorParameters,
    canonical_nonnegative_float,
    detached_compatible_rig,
    parameter_failure_message,
)

_PARAMETER_FIELDS = frozenset(
    {
        "arm_swing_deg",
        "duration_ms",
        "foot_lift_px",
        "head_counter_deg",
        "knee_bend_deg",
        "pelvis_tilt_deg",
        "step_angle_deg",
        "torso_bob_y_px",
        "torso_sway_x_px",
    }
)


class HumanoidWalkV1Parameters(GeneratorParameters):
    """Validated effective parameters for ``humanoid_walk_v1``."""

    duration_ms: int = Field(default=800, ge=4)
    step_angle_deg: float = Field(default=18.0, ge=0.0)
    knee_bend_deg: float = Field(default=12.0, ge=0.0)
    arm_swing_deg: float = Field(default=12.0, ge=0.0)
    torso_bob_y_px: float = Field(default=2.0, ge=0.0)
    torso_sway_x_px: float = Field(default=1.0, ge=0.0)
    pelvis_tilt_deg: float = Field(default=2.0, ge=0.0)
    head_counter_deg: float = Field(default=1.5, ge=0.0)
    foot_lift_px: float = Field(default=2.0, ge=0.0)

    @field_validator(
        "step_angle_deg",
        "knee_bend_deg",
        "arm_swing_deg",
        "torso_bob_y_px",
        "torso_sway_x_px",
        "pelvis_tilt_deg",
        "head_counter_deg",
        "foot_lift_px",
        mode="before",
    )
    @classmethod
    def normalize_amplitude(cls, value: object) -> float:
        """Accept only finite non-negative Python numbers and canonicalize zero."""
        return canonical_nonnegative_float(value)


class HumanoidWalkV1Generator:
    """Generate one fixed-shape, editable humanoid walk cycle."""

    generator_id: ClassVar[str] = "humanoid_walk_v1"
    template_id: ClassVar[str] = "humanoid_v1"

    def validate_parameters(
        self,
        raw: Mapping[str, object],
    ) -> HumanoidWalkV1Parameters:
        """Validate raw typed parameters without coercion or exposing rejected values."""
        try:
            return HumanoidWalkV1Parameters.model_validate(raw)
        except ValidationError as error:
            raise AnimationError(
                parameter_failure_message(
                    error,
                    generator_id=self.generator_id,
                    allowed_fields=_PARAMETER_FIELDS,
                )
            ) from None
        except Exception:
            raise AnimationError("Invalid humanoid_walk_v1 parameters.") from None

    def generate(
        self,
        rig: RigDefinition,
        params: HumanoidWalkV1Parameters,
    ) -> AnimationClip:
        """Return a deterministic looping walk clip for one compatible rig."""
        effective_rig = detached_compatible_rig(
            rig,
            generator_id=self.generator_id,
            template_id=self.template_id,
        )
        if type(params) is not HumanoidWalkV1Parameters:
            raise AnimationError("humanoid_walk_v1 requires validated HumanoidWalkV1Parameters.")
        try:
            effective = HumanoidWalkV1Parameters(
                duration_ms=params.duration_ms,
                step_angle_deg=params.step_angle_deg,
                knee_bend_deg=params.knee_bend_deg,
                arm_swing_deg=params.arm_swing_deg,
                torso_bob_y_px=params.torso_bob_y_px,
                torso_sway_x_px=params.torso_sway_x_px,
                pelvis_tilt_deg=params.pelvis_tilt_deg,
                head_counter_deg=params.head_counter_deg,
                foot_lift_px=params.foot_lift_px,
            )
        except ValidationError as error:
            raise AnimationError(
                parameter_failure_message(
                    error,
                    generator_id=self.generator_id,
                    allowed_fields=_PARAMETER_FIELDS,
                )
            ) from None
        except Exception:
            raise AnimationError("Invalid humanoid_walk_v1 parameters.") from None

        phase_times = (
            0,
            effective.duration_ms // 4,
            (2 * effective.duration_ms) // 4,
            (3 * effective.duration_ms) // 4,
        )
        tracks = (
            _track(
                "thigh_l",
                TrackProperty.ROTATION_DEG,
                effective.step_angle_deg,
                (0.0, 1.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "thigh_r",
                TrackProperty.ROTATION_DEG,
                effective.step_angle_deg,
                (0.0, -1.0, 0.0, 1.0),
                phase_times,
            ),
            _track(
                "upper_arm_l",
                TrackProperty.ROTATION_DEG,
                effective.arm_swing_deg,
                (0.0, -1.0, 0.0, 1.0),
                phase_times,
            ),
            _track(
                "upper_arm_r",
                TrackProperty.ROTATION_DEG,
                effective.arm_swing_deg,
                (0.0, 1.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "pelvis",
                TrackProperty.ROTATION_DEG,
                effective.pelvis_tilt_deg,
                (0.0, 1.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "torso",
                TrackProperty.POSITION_Y,
                effective.torso_bob_y_px,
                (0.0, -1.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "pelvis",
                TrackProperty.POSITION_X,
                effective.torso_sway_x_px,
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
                "shin_l",
                TrackProperty.ROTATION_DEG,
                effective.knee_bend_deg,
                (0.0, -1.0, 0.0, 0.0),
                phase_times,
            ),
            _track(
                "shin_r",
                TrackProperty.ROTATION_DEG,
                effective.knee_bend_deg,
                (0.0, 0.0, 0.0, -1.0),
                phase_times,
            ),
            _track(
                "foot_l",
                TrackProperty.POSITION_Y,
                effective.foot_lift_px,
                (0.0, -1.0, 0.0, 0.0),
                phase_times,
            ),
            _track(
                "foot_r",
                TrackProperty.POSITION_Y,
                effective.foot_lift_px,
                (0.0, 0.0, 0.0, -1.0),
                phase_times,
            ),
        )
        result = AnimationClipBuilder().build(
            AnimationClipBuildRequest(
                rig=effective_rig,
                diagnostic_path="animations/walk.animated-clip.json",
                clip_id="walk",
                display_name="Walk",
                duration_ms=effective.duration_ms,
                loop=True,
                fps_hint=12,
                tracks=tracks,
                events=(
                    AnimationEvent(time_ms=phase_times[0], event="foot_contact_l"),
                    AnimationEvent(time_ms=phase_times[2], event="foot_contact_r"),
                ),
                generator_provenance=GeneratorProvenance(
                    generator_id=self.generator_id,
                    parameters={
                        "duration_ms": effective.duration_ms,
                        "step_angle_deg": effective.step_angle_deg,
                        "knee_bend_deg": effective.knee_bend_deg,
                        "arm_swing_deg": effective.arm_swing_deg,
                        "torso_bob_y_px": effective.torso_bob_y_px,
                        "torso_sway_x_px": effective.torso_sway_x_px,
                        "pelvis_tilt_deg": effective.pelvis_tilt_deg,
                        "head_counter_deg": effective.head_counter_deg,
                        "foot_lift_px": effective.foot_lift_px,
                    },
                ),
            )
        )
        if result.value is None or result.has_errors:
            raise AnimationError(
                "humanoid_walk_v1 could not build a valid clip for the supplied rig."
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


__all__ = ["HumanoidWalkV1Generator", "HumanoidWalkV1Parameters"]
