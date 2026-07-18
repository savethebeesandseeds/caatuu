"""Unit tests for the fixed AF-043 animation-generator registry."""

from __future__ import annotations

from collections.abc import Iterator, Mapping

import pytest
from pydantic import ValidationError

from animated_fabric.application.ports import AnimationGeneratorRegistry
from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.generators import GeneratorParameterValueType
from animated_fabric.domain.rig import BoneDefinition, RigDefinition
from animated_fabric.generators import BuiltinAnimationGeneratorRegistry


class _HostileMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        del key
        raise RuntimeError("sensitive_mapping_value")

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("sensitive_mapping_value")

    def __len__(self) -> int:
        raise RuntimeError("sensitive_mapping_value")


def _rig(*, template_id: str = "humanoid_v1") -> RigDefinition:
    parents = (
        ("root", None),
        ("pelvis", "root"),
        ("torso", "pelvis"),
        ("neck", "torso"),
        ("head", "neck"),
        ("upper_arm_l", "torso"),
        ("upper_arm_r", "torso"),
        ("thigh_l", "pelvis"),
        ("shin_l", "thigh_l"),
        ("foot_l", "shin_l"),
        ("thigh_r", "pelvis"),
        ("shin_r", "thigh_r"),
        ("foot_r", "shin_r"),
    )
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id=template_id,
        bones=tuple(
            BoneDefinition(bone_id=bone_id, parent_id=parent_id) for bone_id, parent_id in parents
        ),
    )


def test_concrete_registry_satisfies_the_appendix_c_application_port() -> None:
    registry: AnimationGeneratorRegistry = BuiltinAnimationGeneratorRegistry()

    summaries = registry.list_generators("humanoid_v1")
    clip = registry.generate("humanoid_idle_v1", _rig(), {})

    assert tuple(summary.generator_id for summary in summaries) == (
        "humanoid_idle_v1",
        "humanoid_walk_v1",
    )
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.generator_id == "humanoid_idle_v1"


def test_listing_is_stable_frozen_and_filtered_by_exact_template_id() -> None:
    registry = BuiltinAnimationGeneratorRegistry()

    first = registry.list_generators("humanoid_v1")
    second = BuiltinAnimationGeneratorRegistry().list_generators("humanoid_v1")

    assert first == second
    assert registry.list_generators("quadruped_v1") == ()
    assert registry.list_generators("Humanoid_V1") == ()
    assert registry.list_generators(None) == ()  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        first[0].template_id = "changed"  # type: ignore[misc]


def test_idle_parameter_schema_is_normalized_in_declaration_order() -> None:
    idle = BuiltinAnimationGeneratorRegistry().list_generators("humanoid_v1")[0]

    assert [parameter.parameter_id for parameter in idle.parameters] == [
        "duration_ms",
        "breath_y_px",
        "torso_rotation_deg",
        "head_counter_deg",
        "arm_drift_deg",
        "pelvis_shift_px",
    ]
    assert [parameter.value_type for parameter in idle.parameters] == [
        GeneratorParameterValueType.INTEGER,
        GeneratorParameterValueType.NUMBER,
        GeneratorParameterValueType.NUMBER,
        GeneratorParameterValueType.NUMBER,
        GeneratorParameterValueType.NUMBER,
        GeneratorParameterValueType.NUMBER,
    ]
    assert [parameter.default for parameter in idle.parameters] == [
        2000,
        1.5,
        0.8,
        0.5,
        0.7,
        0.5,
    ]
    assert [parameter.minimum for parameter in idle.parameters] == [4, 0, 0, 0, 0, 0]
    assert [parameter.maximum for parameter in idle.parameters] == [None] * 6
    assert [parameter.recommended_minimum for parameter in idle.parameters] == [
        1200,
        0,
        0,
        0,
        0,
        0,
    ]
    assert [parameter.recommended_maximum for parameter in idle.parameters] == [
        4000,
        4,
        3,
        2,
        3,
        2,
    ]


def test_walk_parameter_schema_has_defaults_and_no_invented_recommendations() -> None:
    walk = BuiltinAnimationGeneratorRegistry().list_generators("humanoid_v1")[1]

    assert [parameter.parameter_id for parameter in walk.parameters] == [
        "duration_ms",
        "step_angle_deg",
        "knee_bend_deg",
        "arm_swing_deg",
        "torso_bob_y_px",
        "torso_sway_x_px",
        "pelvis_tilt_deg",
        "head_counter_deg",
        "foot_lift_px",
    ]
    assert [parameter.default for parameter in walk.parameters] == [
        800,
        18.0,
        12.0,
        12.0,
        2.0,
        1.0,
        2.0,
        1.5,
        2.0,
    ]
    assert [parameter.minimum for parameter in walk.parameters] == [4, 0, 0, 0, 0, 0, 0, 0, 0]
    assert all(parameter.maximum is None for parameter in walk.parameters)
    assert all(parameter.recommended_minimum is None for parameter in walk.parameters)
    assert all(parameter.recommended_maximum is None for parameter in walk.parameters)


def test_summary_serialization_exposes_only_the_stable_normalized_shape() -> None:
    idle = BuiltinAnimationGeneratorRegistry().list_generators("humanoid_v1")[0]

    payload = idle.model_dump(mode="json")

    assert set(payload) == {"generator_id", "template_id", "parameters"}
    assert set(payload["parameters"][0]) == {
        "parameter_id",
        "value_type",
        "default",
        "minimum",
        "maximum",
        "recommended_minimum",
        "recommended_maximum",
    }
    assert "$defs" not in idle.model_dump_json()
    assert "x-recommended" not in idle.model_dump_json()


@pytest.mark.parametrize(
    ("generator_id", "parameters", "clip_id", "expected_parameter"),
    [
        ("humanoid_idle_v1", {"duration_ms": 2400}, "idle", 2400),
        ("humanoid_walk_v1", {"step_angle_deg": 21}, "walk", 21.0),
    ],
)
def test_generate_dispatches_to_fixed_generators_with_effective_provenance(
    generator_id: str,
    parameters: dict[str, object],
    clip_id: str,
    expected_parameter: int | float,
) -> None:
    registry = BuiltinAnimationGeneratorRegistry()
    parameters_before = dict(parameters)

    first = registry.generate(generator_id, _rig(), parameters)
    second = registry.generate(generator_id, _rig(), parameters)

    assert first == second
    assert first.clip_id == clip_id
    assert first.generator_provenance is not None
    parameter_id = next(iter(parameters))
    assert first.generator_provenance.parameters[parameter_id] == expected_parameter
    assert parameters == parameters_before


@pytest.mark.parametrize("generator_id", ["missing", "../private", "sensitive_generator_value"])
def test_unknown_generator_ids_raise_one_sanitized_typed_error(generator_id: str) -> None:
    with pytest.raises(AnimationError) as captured:
        BuiltinAnimationGeneratorRegistry().generate(generator_id, _rig(), _HostileMapping())

    assert str(captured.value) == "Unknown animation generator ID."
    assert generator_id not in str(captured.value)
    assert "sensitive_mapping_value" not in str(captured.value)
    assert captured.value.__cause__ is None


def test_non_string_generator_id_is_rejected_without_mapping_callbacks() -> None:
    with pytest.raises(AnimationError, match="^Unknown animation generator ID\\.$"):
        BuiltinAnimationGeneratorRegistry().generate(  # type: ignore[arg-type]
            object(),
            _rig(),
            _HostileMapping(),
        )


def test_registered_generators_preserve_sanitized_validation_failures() -> None:
    registry = BuiltinAnimationGeneratorRegistry()

    with pytest.raises(AnimationError) as invalid_parameters:
        registry.generate(
            "humanoid_walk_v1",
            _rig(),
            {"step_angle_deg": b"sensitive_parameter_value"},
        )
    with pytest.raises(AnimationError) as incompatible_rig:
        registry.generate("humanoid_idle_v1", _rig(template_id="quadruped_v1"), {})

    assert str(invalid_parameters.value) == ("Invalid humanoid_walk_v1 parameter 'step_angle_deg'.")
    assert "sensitive_parameter_value" not in str(invalid_parameters.value)
    assert "quadruped_v1" not in str(incompatible_rig.value)
