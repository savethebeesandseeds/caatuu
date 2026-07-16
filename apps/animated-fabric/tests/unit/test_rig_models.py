"""Tests for the strict, persisted rig model contracts."""

import json
from collections.abc import Callable

import pytest
from pydantic import ValidationError

from animated_fabric.domain._base import DomainModel
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
    SocketDefinition,
)


def normative_rig_payload() -> dict[str, object]:
    """Return Appendix A's reduced rig with every direction override represented."""
    return {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "main",
        "template_id": "humanoid_v1",
        "bones": [
            {
                "bone_id": "root",
                "parent_id": None,
                "rest_transform": {
                    "position": [96.0, 160.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
            },
            {
                "bone_id": "pelvis",
                "parent_id": "root",
                "rest_transform": {
                    "position": [0.0, -24.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
            },
            {
                "bone_id": "torso",
                "parent_id": "pelvis",
                "rest_transform": {
                    "position": [0.0, -24.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
            },
            {
                "bone_id": "head",
                "parent_id": "torso",
                "rest_transform": {
                    "position": [0.0, -30.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
            },
        ],
        "parts": [
            {
                "part_id": "body_torso",
                "semantic_part": "torso",
                "bone_id": "torso",
                "assets_by_direction": {"SE": "se_torso", "NE": "ne_torso"},
                "pivot_by_direction": {"SE": [24.0, 40.0], "NE": [24.0, 40.0]},
                "bind_transform": {
                    "position": [0.0, 0.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
                "draw_slot": "torso",
                "slot_order": 0,
                "visible": True,
                "opacity": 1.0,
            }
        ],
        "sockets": [
            {
                "socket_id": "head_hat",
                "bone_id": "head",
                "local_transform": {
                    "position": [0.0, -22.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
                "default_draw_slot": "hair_front",
            }
        ],
        "direction_profiles": {
            "SE": {
                "bone_rest_transforms": {
                    "head": {
                        "position": [1.0, -30.0],
                        "rotation_deg": 1.0,
                        "scale": [1.0, 1.0],
                    }
                },
                "part_visibility": {"body_torso": True},
                "asset_selection": {"body_torso": "se_torso_variant"},
                "pivots": {"body_torso": [24.5, 40.0]},
                "slot_order": {"body_torso": 2},
                "track_multipliers": {"upper_arm_l.rotation_deg": 0.8},
            }
        },
        "draw_slot_profiles": {
            "SE": [
                "ground_shadow",
                "cape_back",
                "leg_far",
                "leg_near",
                "torso",
                "arm_far",
                "head",
                "hair_front",
                "arm_near",
                "weapon_front",
            ],
            "NE": [
                "ground_shadow",
                "weapon_back",
                "arm_far",
                "head_back",
                "head",
                "torso",
                "cape_back",
                "arm_near",
                "leg_far",
                "leg_near",
            ],
        },
    }


def minimal_rig(**changes: object) -> RigDefinition:
    values: dict[str, object] = {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "main",
        "template_id": "humanoid_v1",
    }
    values.update(changes)
    return RigDefinition.model_validate(values)


def test_rig_definition_round_trips_the_normative_json_shape() -> None:
    payload = normative_rig_payload()

    rig = RigDefinition.model_validate_json(json.dumps(payload))

    assert rig.parts[0].assets_by_direction[Direction.SE] == "se_torso"
    assert rig.direction_profiles[Direction.SE].track_multipliers == {
        "upper_arm_l.rotation_deg": 0.8
    }
    assert rig.model_dump(mode="json", exclude_unset=True) == payload
    assert RigDefinition.model_validate_json(rig.model_dump_json()) == rig


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("format", "animated-fabric.project.v1"),
        ("schema_version", "0.1"),
    ],
)
def test_rig_definition_rejects_invalid_artifact_identity(field: str, value: object) -> None:
    payload = normative_rig_payload()
    payload[field] = value

    with pytest.raises(ValidationError):
        RigDefinition.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize("missing_field", ["format", "schema_version"])
def test_rig_definition_requires_artifact_identity(missing_field: str) -> None:
    payload = normative_rig_payload()
    del payload[missing_field]

    with pytest.raises(ValidationError):
        RigDefinition.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize(
    "factory",
    [
        lambda: BoneDefinition(bone_id="root"),
        lambda: PartBinding(
            part_id="body_torso",
            semantic_part="torso",
            bone_id="torso",
            draw_slot="torso",
        ),
        lambda: SocketDefinition(
            socket_id="head_hat",
            bone_id="head",
            default_draw_slot="hair_front",
        ),
        DirectionProfile,
        minimal_rig,
    ],
)
def test_every_rig_model_rejects_unknown_fields(factory: Callable[[], DomainModel]) -> None:
    values = factory().model_dump()
    values["unknown"] = "not allowed"

    with pytest.raises(ValidationError):
        factory().model_validate(values)


def test_rig_models_reject_type_coercion() -> None:
    with pytest.raises(ValidationError):
        BoneDefinition.model_validate({"bone_id": "root", "locked": 1})

    with pytest.raises(ValidationError):
        PartBinding.model_validate(
            {
                "part_id": "body_torso",
                "semantic_part": "torso",
                "bone_id": "torso",
                "draw_slot": "torso",
                "slot_order": "0",
            }
        )

    with pytest.raises(ValidationError):
        DirectionProfile.model_validate({"track_multipliers": {"upper_arm_l.rotation_deg": "0.8"}})

    with pytest.raises(ValidationError):
        minimal_rig(bones=[])


def test_direction_maps_reject_unknown_direction_keys() -> None:
    payload = {
        "part_id": "body_torso",
        "semantic_part": "torso",
        "bone_id": "torso",
        "assets_by_direction": {"S": "south_torso"},
        "draw_slot": "torso",
    }

    with pytest.raises(ValidationError):
        PartBinding.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize("length_hint", [-0.001, -10.0])
def test_bone_length_hint_must_be_nonnegative(length_hint: float) -> None:
    with pytest.raises(ValidationError):
        BoneDefinition(bone_id="root", length_hint=length_hint)

    assert BoneDefinition(bone_id="root", length_hint=0.0).length_hint == 0.0


@pytest.mark.parametrize("opacity", [-0.001, 1.001])
def test_part_opacity_must_be_normalized(opacity: float) -> None:
    with pytest.raises(ValidationError):
        PartBinding(
            part_id="body_torso",
            semantic_part="torso",
            bone_id="torso",
            draw_slot="torso",
            opacity=opacity,
        )

    for boundary in (0.0, 1.0):
        part = PartBinding(
            part_id="body_torso",
            semantic_part="torso",
            bone_id="torso",
            draw_slot="torso",
            opacity=boundary,
        )
        assert part.opacity == boundary


def test_mutable_defaults_are_isolated_between_model_instances() -> None:
    first_part = PartBinding(
        part_id="body_torso",
        semantic_part="torso",
        bone_id="torso",
        draw_slot="torso",
    )
    second_part = PartBinding(
        part_id="body_torso",
        semantic_part="torso",
        bone_id="torso",
        draw_slot="torso",
    )
    first_part.assets_by_direction[Direction.SE] = "se_torso"
    assert second_part.assets_by_direction == {}
    assert first_part.bind_transform is not second_part.bind_transform

    first_profile = DirectionProfile()
    second_profile = DirectionProfile()
    first_profile.part_visibility["body_torso"] = False
    assert second_profile.part_visibility == {}

    first_rig = minimal_rig()
    second_rig = minimal_rig()
    first_rig.direction_profiles[Direction.SE] = first_profile
    assert second_rig.direction_profiles == {}


def test_relational_rig_validation_is_deferred_to_af_012() -> None:
    unresolved = minimal_rig(
        bones=(
            BoneDefinition(bone_id="arm", parent_id="missing"),
            BoneDefinition(bone_id="arm", parent_id="arm"),
        ),
        parts=(
            PartBinding(
                part_id="body_torso",
                semantic_part="torso",
                bone_id="missing",
                draw_slot="future_slot",
            ),
        ),
    )

    assert len(unresolved.bones) == 2
    assert unresolved.parts[0].draw_slot == "future_slot"
