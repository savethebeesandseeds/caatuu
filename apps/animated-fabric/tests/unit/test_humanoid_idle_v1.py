"""Unit tests for the deterministic AF-041 humanoid idle generator."""

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
from animated_fabric.generators import HumanoidIdleV1Generator, HumanoidIdleV1Parameters

_SQRT_THREE_OVER_TWO = 0.8660254037844386


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


class _HostileIdleParameters(HumanoidIdleV1Parameters):
    def __getattribute__(self, name: str) -> object:
        if name == "duration_ms":
            raise RuntimeError("sensitive_parameter_value")
        return super().__getattribute__(name)


def _rig(*, template_id: str = "humanoid_v1", include_head: bool = True) -> RigDefinition:
    bones = [
        BoneDefinition(bone_id="root"),
        BoneDefinition(bone_id="pelvis", parent_id="root"),
        BoneDefinition(bone_id="torso", parent_id="pelvis"),
        BoneDefinition(bone_id="neck", parent_id="torso"),
    ]
    if include_head:
        bones.append(BoneDefinition(bone_id="head", parent_id="neck"))
    bones.extend(
        (
            BoneDefinition(bone_id="upper_arm_l", parent_id="torso"),
            BoneDefinition(bone_id="upper_arm_r", parent_id="torso"),
        )
    )
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id=template_id,
        bones=tuple(bones),
    )


def test_parameter_defaults_are_strict_frozen_and_expose_recommendations() -> None:
    params = HumanoidIdleV1Generator().validate_parameters({})

    assert params == HumanoidIdleV1Parameters(
        duration_ms=2000,
        breath_y_px=1.5,
        torso_rotation_deg=0.8,
        head_counter_deg=0.5,
        arm_drift_deg=0.7,
        pelvis_shift_px=0.5,
    )
    with pytest.raises(ValidationError):
        params.duration_ms = 3000  # type: ignore[misc]
    schema = HumanoidIdleV1Parameters.model_json_schema()["properties"]
    assert schema["duration_ms"]["x-recommended-minimum"] == 1200
    assert schema["duration_ms"]["x-recommended-maximum"] == 4000
    assert schema["breath_y_px"]["x-recommended-maximum"] == 4.0


@pytest.mark.parametrize(
    "raw",
    [
        {"duration_ms": 3},
        {"duration_ms": True},
        {"duration_ms": "2000"},
        {"breath_y_px": True},
        {"breath_y_px": "1.5"},
        {"breath_y_px": -0.1},
        {"breath_y_px": math.nan},
        {"breath_y_px": math.inf},
        {"breath_y_px": 10**1000},
        {"unknown": 1},
    ],
)
def test_invalid_parameters_raise_typed_sanitized_errors(raw: dict[str, object]) -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().validate_parameters(raw)

    message = str(captured.value)
    assert len(message) <= 90
    assert "input_value" not in message
    assert "pydantic.dev" not in message


def test_parameter_error_never_echoes_sensitive_submitted_value() -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().validate_parameters({"breath_y_px": b"sensitive_value"})

    assert "sensitive_value" not in str(captured.value)
    assert "breath_y_px" in str(captured.value)
    assert captured.value.__cause__ is None


def test_raw_mapping_callbacks_raise_a_fixed_sanitized_error() -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().validate_parameters(_HostileMapping())

    assert str(captured.value) == "Invalid humanoid_idle_v1 parameters."
    assert "sensitive_mapping_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_numeric_amplitudes_are_canonical_floats_without_hard_recommended_caps() -> None:
    params = HumanoidIdleV1Generator().validate_parameters(
        {
            "duration_ms": 4,
            "breath_y_px": 5,
            "torso_rotation_deg": 4,
            "head_counter_deg": 3,
            "arm_drift_deg": 4,
            "pelvis_shift_px": -0.0,
        }
    )

    assert params.breath_y_px == 5.0 and type(params.breath_y_px) is float
    assert params.torso_rotation_deg == 4.0
    assert params.head_counter_deg == 3.0
    assert params.arm_drift_deg == 4.0
    assert math.copysign(1.0, params.pelvis_shift_px) == 1.0


def test_numeric_subclasses_are_canonicalized_without_conversion_callbacks() -> None:
    params = HumanoidIdleV1Generator().validate_parameters(
        {
            "breath_y_px": _HostileInt(3),
            "torso_rotation_deg": _HostileFloat(2.5),
        }
    )

    assert params.breath_y_px == 3.0 and type(params.breath_y_px) is float
    assert params.torso_rotation_deg == 2.5


def test_default_generation_has_exact_fixed_tracks_metadata_and_provenance() -> None:
    clip = HumanoidIdleV1Generator().generate(_rig(), HumanoidIdleV1Parameters())

    assert (clip.format, clip.schema_version) == (
        "animated-fabric.animation-clip.v1",
        "0.1.0",
    )
    assert (clip.clip_id, clip.display_name, clip.template_id) == (
        "idle",
        "Idle",
        "humanoid_v1",
    )
    assert (clip.duration_ms, clip.loop, clip.fps_hint, clip.events) == (2000, True, 12, ())
    assert [(track.target_id, track.property) for track in clip.tracks] == [
        ("torso", TrackProperty.POSITION_Y),
        ("torso", TrackProperty.ROTATION_DEG),
        ("head", TrackProperty.ROTATION_DEG),
        ("pelvis", TrackProperty.POSITION_X),
        ("upper_arm_l", TrackProperty.ROTATION_DEG),
        ("upper_arm_r", TrackProperty.ROTATION_DEG),
    ]
    assert all(track.target_type is TargetType.BONE for track in clip.tracks)
    assert all(track.value_mode is ValueMode.DELTA for track in clip.tracks)
    assert all(
        key.interpolation is Interpolation.SMOOTH for track in clip.tracks for key in track.keys
    )
    assert [[key.time_ms for key in track.keys] for track in clip.tracks] == [
        [0, 500, 1000, 1500, 2000]
    ] * 6
    assert [[key.value for key in track.keys] for track in clip.tracks] == [
        [-1.5, 0.0, 1.5, 0.0, -1.5],
        [0.0, 0.8, 0.0, -0.8, 0.0],
        [0.0, -0.5, 0.0, 0.5, 0.0],
        [0.0, 0.5, 0.0, -0.5, 0.0],
        [
            _SQRT_THREE_OVER_TWO * 0.7,
            0.35,
            -_SQRT_THREE_OVER_TWO * 0.7,
            -0.35,
            _SQRT_THREE_OVER_TWO * 0.7,
        ],
        [
            -_SQRT_THREE_OVER_TWO * 0.7,
            0.35,
            _SQRT_THREE_OVER_TWO * 0.7,
            -0.35,
            -_SQRT_THREE_OVER_TWO * 0.7,
        ],
    ]
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.generator_id == "humanoid_idle_v1"
    assert clip.generator_provenance.parameters == {
        "arm_drift_deg": 0.7,
        "breath_y_px": 1.5,
        "duration_ms": 2000,
        "head_counter_deg": 0.5,
        "pelvis_shift_px": 0.5,
        "torso_rotation_deg": 0.8,
    }


def test_positive_nondefault_amplitudes_drive_all_tracks_and_full_provenance() -> None:
    params = HumanoidIdleV1Generator().validate_parameters(
        {
            "duration_ms": 2400,
            "breath_y_px": 2.25,
            "torso_rotation_deg": 1.25,
            "head_counter_deg": 0.75,
            "arm_drift_deg": 1.4,
            "pelvis_shift_px": 0.6,
        }
    )

    clip = HumanoidIdleV1Generator().generate(_rig(), params)

    assert [
        clip.tracks[0].keys[0].value,
        clip.tracks[1].keys[1].value,
        clip.tracks[2].keys[1].value,
        clip.tracks[3].keys[1].value,
        clip.tracks[4].keys[0].value,
        clip.tracks[5].keys[0].value,
    ] == pytest.approx(
        [
            -2.25,
            1.25,
            -0.75,
            0.6,
            _SQRT_THREE_OVER_TWO * 1.4,
            -_SQRT_THREE_OVER_TWO * 1.4,
        ]
    )
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.parameters == {
        "arm_drift_deg": 1.4,
        "breath_y_px": 2.25,
        "duration_ms": 2400,
        "head_counter_deg": 0.75,
        "pelvis_shift_px": 0.6,
        "torso_rotation_deg": 1.25,
    }


def test_non_divisible_duration_uses_cumulative_integer_floor_quarters() -> None:
    params = HumanoidIdleV1Generator().validate_parameters({"duration_ms": 1201})

    clip = HumanoidIdleV1Generator().generate(_rig(), params)

    assert [[key.time_ms for key in track.keys] for track in clip.tracks] == [
        [0, 300, 600, 900, 1201]
    ] * 6


def test_zero_amplitudes_never_serialize_negative_zero() -> None:
    params = HumanoidIdleV1Generator().validate_parameters(
        {
            "breath_y_px": -0.0,
            "torso_rotation_deg": -0.0,
            "head_counter_deg": -0.0,
            "arm_drift_deg": -0.0,
            "pelvis_shift_px": -0.0,
        }
    )

    clip = HumanoidIdleV1Generator().generate(_rig(), params)

    assert all(
        key.value == 0.0 and math.copysign(1.0, float(key.value)) == 1.0
        for track in clip.tracks
        for key in track.keys
    )
    assert "-0.0" not in clip.model_dump_json()


def test_generation_is_periodic_and_closes_the_final_quarter() -> None:
    rig = _rig()
    clip = HumanoidIdleV1Generator().generate(rig, HumanoidIdleV1Parameters())
    evaluator = AnimationEvaluator()

    start = evaluator.evaluate(clip, rig, Direction.SE, 0.0)
    repeated = evaluator.evaluate(clip, rig, Direction.SE, 2000.0)
    closing = evaluator.evaluate(clip, rig, Direction.SE, 1750.0)

    assert dict(start.bone_deltas) == dict(repeated.bone_deltas)
    assert start.time_ms == repeated.time_ms == 0.0
    assert closing.bone_deltas["torso"].position.y == -0.75
    assert closing.bone_deltas["torso"].rotation_deg == -0.4


def test_incompatible_or_incomplete_rigs_raise_fixed_typed_errors() -> None:
    generator = HumanoidIdleV1Generator()
    params = HumanoidIdleV1Parameters()

    with pytest.raises(AnimationError, match="requires a rig using") as incompatible:
        generator.generate(_rig(template_id="quadruped_v1"), params)
    with pytest.raises(AnimationError, match="requires a rig using"):
        generator.generate(object(), params)  # type: ignore[arg-type]
    with pytest.raises(AnimationError, match="could not build a valid clip") as incomplete:
        generator.generate(_rig(include_head=False), params)

    assert "quadruped_v1" not in str(incompatible.value)
    assert "head" not in str(incomplete.value)
    assert "AFV" not in str(incomplete.value)


def test_generate_revalidates_mutated_rigs_without_nested_value_leaks() -> None:
    mutated = _rig().model_copy(update={"bones": (b"sensitive_value",)})

    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().generate(mutated, HumanoidIdleV1Parameters())

    assert "requires a rig using" in str(captured.value)
    assert "sensitive_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_generate_rejects_rig_subclasses_before_override_callbacks() -> None:
    hostile = _HostileRig.model_validate(_rig().model_dump(mode="python"))

    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().generate(hostile, HumanoidIdleV1Parameters())

    assert str(captured.value) == (
        "humanoid_idle_v1 requires a rig using the humanoid_v1 template."
    )
    assert "sensitive_rig_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_generation_is_repeatable_and_does_not_mutate_inputs() -> None:
    generator = HumanoidIdleV1Generator()
    rig = _rig()
    params = generator.validate_parameters({"duration_ms": 2001, "arm_drift_deg": 1})
    rig_before = rig.model_dump(mode="json")
    params_before = params.model_dump(mode="json")

    first = generator.generate(rig, params)
    second = generator.generate(rig, params)

    assert first.model_dump_json() == second.model_dump_json()
    assert rig.model_dump(mode="json") == rig_before
    assert params.model_dump(mode="json") == params_before


def test_generate_rejects_unvalidated_parameter_objects() -> None:
    with pytest.raises(AnimationError, match="requires validated"):
        HumanoidIdleV1Generator().generate(_rig(), {})  # type: ignore[arg-type]


def test_generate_rejects_parameter_subclasses_before_field_callbacks() -> None:
    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().generate(_rig(), _HostileIdleParameters())

    assert str(captured.value) == ("humanoid_idle_v1 requires validated HumanoidIdleV1Parameters.")
    assert "sensitive_parameter_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_generate_revalidates_mutated_parameter_copies_without_value_leaks() -> None:
    mutated = HumanoidIdleV1Parameters().model_copy(update={"breath_y_px": b"sensitive_value"})

    with pytest.raises(AnimationError) as captured:
        HumanoidIdleV1Generator().generate(_rig(), mutated)

    assert "breath_y_px" in str(captured.value)
    assert "sensitive_value" not in str(captured.value)
    assert captured.value.__cause__ is None
