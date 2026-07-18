"""Unit tests for the deterministic AF-042 humanoid walk generator."""

from __future__ import annotations

import math
from collections.abc import Iterator, Mapping

import pytest
from pydantic import ValidationError

from animated_fabric.domain.animation import (
    Interpolation,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.animation_evaluator import AnimationEvaluator
from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import BoneDefinition, RigDefinition
from animated_fabric.generators import HumanoidWalkV1Generator, HumanoidWalkV1Parameters


class _HostileInt(int):
    def __float__(self) -> float:
        raise RuntimeError("sensitive_numeric_value")


class _HostileFloat(float):
    def __float__(self) -> float:
        raise RuntimeError("sensitive_numeric_value")


class _HostileMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise RuntimeError("sensitive_mapping_value")

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("sensitive_mapping_value")

    def __len__(self) -> int:
        raise RuntimeError("sensitive_mapping_value")


class _HostileRig(RigDefinition):
    def model_dump(self, *args: object, **kwargs: object) -> dict[str, object]:
        raise RuntimeError("sensitive_rig_value")


class _HostileWalkParameters(HumanoidWalkV1Parameters):
    def __getattribute__(self, name: str) -> object:
        if name == "duration_ms":
            raise RuntimeError("sensitive_parameter_value")
        return super().__getattribute__(name)


def _rig(*, template_id: str = "humanoid_v1", include_foot_r: bool = True) -> RigDefinition:
    bones = [
        BoneDefinition(bone_id="root"),
        BoneDefinition(bone_id="pelvis", parent_id="root"),
        BoneDefinition(bone_id="torso", parent_id="pelvis"),
        BoneDefinition(bone_id="neck", parent_id="torso"),
        BoneDefinition(bone_id="head", parent_id="neck"),
        BoneDefinition(bone_id="upper_arm_l", parent_id="torso"),
        BoneDefinition(bone_id="upper_arm_r", parent_id="torso"),
        BoneDefinition(bone_id="thigh_l", parent_id="pelvis"),
        BoneDefinition(bone_id="shin_l", parent_id="thigh_l"),
        BoneDefinition(bone_id="foot_l", parent_id="shin_l"),
        BoneDefinition(bone_id="thigh_r", parent_id="pelvis"),
        BoneDefinition(bone_id="shin_r", parent_id="thigh_r"),
    ]
    if include_foot_r:
        bones.append(BoneDefinition(bone_id="foot_r", parent_id="shin_r"))
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id=template_id,
        bones=tuple(bones),
    )


def test_parameter_defaults_are_strict_frozen_and_have_no_recommended_caps() -> None:
    params = HumanoidWalkV1Generator().validate_parameters({})

    assert params == HumanoidWalkV1Parameters(
        duration_ms=800,
        step_angle_deg=18.0,
        knee_bend_deg=12.0,
        arm_swing_deg=12.0,
        torso_bob_y_px=2.0,
        torso_sway_x_px=1.0,
        pelvis_tilt_deg=2.0,
        head_counter_deg=1.5,
        foot_lift_px=2.0,
    )
    with pytest.raises(ValidationError):
        params.duration_ms = 900  # type: ignore[misc]
    schema = HumanoidWalkV1Parameters.model_json_schema()["properties"]
    assert schema["duration_ms"]["minimum"] == 4
    assert "maximum" not in schema["duration_ms"]
    for field in schema.values():
        assert not any(key.startswith("x-recommended-") for key in field)


@pytest.mark.parametrize(
    "raw",
    [
        {"duration_ms": 3},
        {"duration_ms": True},
        {"duration_ms": "800"},
        {"step_angle_deg": True},
        {"knee_bend_deg": "12"},
        {"arm_swing_deg": -0.1},
        {"torso_bob_y_px": math.nan},
        {"torso_sway_x_px": math.inf},
        {"foot_lift_px": 10**1000},
        {"unknown": 1},
    ],
)
def test_invalid_parameters_raise_typed_sanitized_errors(raw: dict[str, object]) -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().validate_parameters(raw)

    message = str(captured.value)
    assert len(message) <= 90
    assert "input_value" not in message
    assert "pydantic.dev" not in message


def test_parameter_error_never_echoes_sensitive_submitted_value() -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().validate_parameters({"step_angle_deg": b"sensitive_value"})

    assert str(captured.value) == "Invalid humanoid_walk_v1 parameter 'step_angle_deg'."
    assert "sensitive_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_raw_mapping_callbacks_raise_a_fixed_sanitized_error() -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().validate_parameters(_HostileMapping())

    assert str(captured.value) == "Invalid humanoid_walk_v1 parameters."
    assert "sensitive_mapping_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_numeric_amplitudes_are_canonical_floats_without_hard_caps() -> None:
    params = HumanoidWalkV1Generator().validate_parameters(
        {
            "duration_ms": 4,
            "step_angle_deg": 40,
            "knee_bend_deg": 30,
            "arm_swing_deg": 25,
            "torso_bob_y_px": 8,
            "torso_sway_x_px": 6,
            "pelvis_tilt_deg": 10,
            "head_counter_deg": 9,
            "foot_lift_px": -0.0,
        }
    )

    assert params.step_angle_deg == 40.0 and type(params.step_angle_deg) is float
    assert params.knee_bend_deg == 30.0
    assert params.arm_swing_deg == 25.0
    assert params.torso_bob_y_px == 8.0
    assert params.torso_sway_x_px == 6.0
    assert params.pelvis_tilt_deg == 10.0
    assert params.head_counter_deg == 9.0
    assert math.copysign(1.0, params.foot_lift_px) == 1.0


def test_numeric_subclasses_are_canonicalized_without_conversion_callbacks() -> None:
    params = HumanoidWalkV1Generator().validate_parameters(
        {
            "step_angle_deg": _HostileInt(20),
            "knee_bend_deg": _HostileFloat(14.5),
        }
    )

    assert params.step_angle_deg == 20.0 and type(params.step_angle_deg) is float
    assert params.knee_bend_deg == 14.5


def test_default_generation_has_exact_tracks_events_metadata_and_provenance() -> None:
    clip = HumanoidWalkV1Generator().generate(_rig(), HumanoidWalkV1Parameters())

    assert (clip.format, clip.schema_version) == (
        "animated-fabric.animation-clip.v1",
        "0.1.0",
    )
    assert (clip.clip_id, clip.display_name, clip.template_id) == (
        "walk",
        "Walk",
        "humanoid_v1",
    )
    assert (clip.duration_ms, clip.loop, clip.fps_hint) == (800, True, 12)
    assert [(event.time_ms, event.event) for event in clip.events] == [
        (0, "foot_contact_l"),
        (400, "foot_contact_r"),
    ]
    assert [(track.target_id, track.property) for track in clip.tracks] == [
        ("thigh_l", TrackProperty.ROTATION_DEG),
        ("thigh_r", TrackProperty.ROTATION_DEG),
        ("upper_arm_l", TrackProperty.ROTATION_DEG),
        ("upper_arm_r", TrackProperty.ROTATION_DEG),
        ("pelvis", TrackProperty.ROTATION_DEG),
        ("torso", TrackProperty.POSITION_Y),
        ("pelvis", TrackProperty.POSITION_X),
        ("head", TrackProperty.ROTATION_DEG),
        ("shin_l", TrackProperty.ROTATION_DEG),
        ("shin_r", TrackProperty.ROTATION_DEG),
        ("foot_l", TrackProperty.POSITION_Y),
        ("foot_r", TrackProperty.POSITION_Y),
    ]
    assert all(track.target_type is TargetType.BONE for track in clip.tracks)
    assert all(track.value_mode is ValueMode.DELTA for track in clip.tracks)
    assert all(
        key.interpolation is Interpolation.SMOOTH for track in clip.tracks for key in track.keys
    )
    assert [[key.time_ms for key in track.keys] for track in clip.tracks] == [
        [0, 200, 400, 600, 800]
    ] * 12
    assert [[key.value for key in track.keys] for track in clip.tracks] == [
        [0.0, 18.0, 0.0, -18.0, 0.0],
        [0.0, -18.0, 0.0, 18.0, 0.0],
        [0.0, -12.0, 0.0, 12.0, 0.0],
        [0.0, 12.0, 0.0, -12.0, 0.0],
        [0.0, 2.0, 0.0, -2.0, 0.0],
        [0.0, -2.0, 0.0, -2.0, 0.0],
        [0.0, 1.0, 0.0, -1.0, 0.0],
        [0.0, -1.5, 0.0, 1.5, 0.0],
        [0.0, -12.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, -12.0, 0.0],
        [0.0, -2.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, -2.0, 0.0],
    ]
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.generator_id == "humanoid_walk_v1"
    assert clip.generator_provenance.parameters == {
        "arm_swing_deg": 12.0,
        "duration_ms": 800,
        "foot_lift_px": 2.0,
        "head_counter_deg": 1.5,
        "knee_bend_deg": 12.0,
        "pelvis_tilt_deg": 2.0,
        "step_angle_deg": 18.0,
        "torso_bob_y_px": 2.0,
        "torso_sway_x_px": 1.0,
    }


def test_positive_nondefault_amplitudes_drive_every_track_and_provenance() -> None:
    generator = HumanoidWalkV1Generator()
    params = generator.validate_parameters(
        {
            "duration_ms": 1200,
            "step_angle_deg": 20,
            "knee_bend_deg": 14,
            "arm_swing_deg": 13,
            "torso_bob_y_px": 3,
            "torso_sway_x_px": 1.25,
            "pelvis_tilt_deg": 2.5,
            "head_counter_deg": 1.75,
            "foot_lift_px": 4,
        }
    )

    clip = generator.generate(_rig(), params)

    assert [track.keys[1].value for track in clip.tracks] == [
        20.0,
        -20.0,
        -13.0,
        13.0,
        2.5,
        -3.0,
        1.25,
        -1.75,
        -14.0,
        0.0,
        -4.0,
        0.0,
    ]
    assert [track.keys[3].value for track in clip.tracks] == [
        -20.0,
        20.0,
        13.0,
        -13.0,
        -2.5,
        -3.0,
        -1.25,
        1.75,
        0.0,
        -14.0,
        0.0,
        -4.0,
    ]
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.parameters == {
        "arm_swing_deg": 13.0,
        "duration_ms": 1200,
        "foot_lift_px": 4.0,
        "head_counter_deg": 1.75,
        "knee_bend_deg": 14.0,
        "pelvis_tilt_deg": 2.5,
        "step_angle_deg": 20.0,
        "torso_bob_y_px": 3.0,
        "torso_sway_x_px": 1.25,
    }


def test_non_divisible_duration_uses_floor_quarters_for_tracks_and_events() -> None:
    params = HumanoidWalkV1Generator().validate_parameters({"duration_ms": 805})

    clip = HumanoidWalkV1Generator().generate(_rig(), params)

    assert [[key.time_ms for key in track.keys] for track in clip.tracks] == [
        [0, 201, 402, 603, 805]
    ] * 12
    assert [(event.time_ms, event.event) for event in clip.events] == [
        (0, "foot_contact_l"),
        (402, "foot_contact_r"),
    ]


def test_zero_amplitudes_never_serialize_negative_zero() -> None:
    params = HumanoidWalkV1Generator().validate_parameters(
        {
            "step_angle_deg": -0.0,
            "knee_bend_deg": -0.0,
            "arm_swing_deg": -0.0,
            "torso_bob_y_px": -0.0,
            "torso_sway_x_px": -0.0,
            "pelvis_tilt_deg": -0.0,
            "head_counter_deg": -0.0,
            "foot_lift_px": -0.0,
        }
    )

    clip = HumanoidWalkV1Generator().generate(_rig(), params)

    assert all(
        key.value == 0.0 and math.copysign(1.0, float(key.value)) == 1.0
        for track in clip.tracks
        for key in track.keys
    )
    assert "-0.0" not in clip.model_dump_json()


def test_generation_is_periodic_and_closes_the_final_quarter() -> None:
    rig = _rig()
    clip = HumanoidWalkV1Generator().generate(rig, HumanoidWalkV1Parameters())
    evaluator = AnimationEvaluator()

    start = evaluator.evaluate(clip, rig, Direction.SE, 0.0)
    repeated = evaluator.evaluate(clip, rig, Direction.SE, 800.0)
    closing = evaluator.evaluate(clip, rig, Direction.SE, 700.0)

    assert dict(start.bone_deltas) == dict(repeated.bone_deltas)
    assert start.time_ms == repeated.time_ms == 0.0
    assert closing.bone_deltas["thigh_l"].rotation_deg == -9.0
    assert closing.bone_deltas["torso"].position.y == -1.0
    assert closing.bone_deltas["shin_r"].rotation_deg == -6.0
    assert closing.bone_deltas["foot_r"].position.y == -1.0


def test_incompatible_or_incomplete_rigs_raise_fixed_typed_errors() -> None:
    generator = HumanoidWalkV1Generator()
    params = HumanoidWalkV1Parameters()

    with pytest.raises(AnimationError, match="requires a rig using") as incompatible:
        generator.generate(_rig(template_id="quadruped_v1"), params)
    with pytest.raises(AnimationError, match="requires a rig using"):
        generator.generate(object(), params)  # type: ignore[arg-type]
    with pytest.raises(AnimationError, match="could not build a valid clip") as incomplete:
        generator.generate(_rig(include_foot_r=False), params)

    assert "quadruped_v1" not in str(incompatible.value)
    assert "foot_r" not in str(incomplete.value)
    assert "AFV" not in str(incomplete.value)


def test_generate_revalidates_mutated_rigs_without_nested_value_leaks() -> None:
    mutated = _rig().model_copy(update={"bones": (b"sensitive_value",)})

    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().generate(mutated, HumanoidWalkV1Parameters())

    assert "requires a rig using" in str(captured.value)
    assert "sensitive_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_generate_rejects_rig_subclasses_before_override_callbacks() -> None:
    hostile = _HostileRig.model_validate(_rig().model_dump(mode="python"))

    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().generate(hostile, HumanoidWalkV1Parameters())

    assert str(captured.value) == (
        "humanoid_walk_v1 requires a rig using the humanoid_v1 template."
    )
    assert "sensitive_rig_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_generation_is_repeatable_and_does_not_mutate_inputs() -> None:
    generator = HumanoidWalkV1Generator()
    rig = _rig()
    params = generator.validate_parameters({"duration_ms": 801, "step_angle_deg": 20})
    rig_before = rig.model_dump(mode="json")
    params_before = params.model_dump(mode="json")

    first = generator.generate(rig, params)
    second = generator.generate(rig, params)

    assert first.model_dump_json() == second.model_dump_json()
    assert rig.model_dump(mode="json") == rig_before
    assert params.model_dump(mode="json") == params_before


def test_generate_rejects_unvalidated_parameter_objects() -> None:
    with pytest.raises(AnimationError, match="requires validated"):
        HumanoidWalkV1Generator().generate(_rig(), {})  # type: ignore[arg-type]


def test_generate_rejects_parameter_subclasses_before_field_callbacks() -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().generate(_rig(), _HostileWalkParameters())

    assert str(captured.value) == ("humanoid_walk_v1 requires validated HumanoidWalkV1Parameters.")
    assert "sensitive_parameter_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_generate_revalidates_mutated_parameter_copies_without_value_leaks() -> None:
    mutated = HumanoidWalkV1Parameters().model_copy(update={"step_angle_deg": b"sensitive_value"})

    with pytest.raises(AnimationError) as captured:
        HumanoidWalkV1Generator().generate(_rig(), mutated)

    assert "step_angle_deg" in str(captured.value)
    assert "sensitive_value" not in str(captured.value)
    assert captured.value.__cause__ is None
