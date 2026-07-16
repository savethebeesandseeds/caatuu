"""AF-020 pose-resolution and normative composition tests."""

from __future__ import annotations

import json

import pytest

from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.pose import (
    PoseResolver,
    bone_local_matrix,
    combine_bone_transform,
)
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.transforms import transform_matrix, transform_point


def make_rig(
    *,
    parts: list[dict[str, object]] | None = None,
    sockets: list[dict[str, object]] | None = None,
    direction_profiles: dict[str, object] | None = None,
) -> RigDefinition:
    payload = {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "main",
        "template_id": "humanoid_v1",
        "bones": [
            {
                "bone_id": "hand",
                "parent_id": "root",
                "rest_transform": {
                    "position": [5.0, 0.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
            },
            {
                "bone_id": "root",
                "parent_id": None,
                "rest_transform": {
                    "position": [10.0, 20.0],
                    "rotation_deg": 90.0,
                    "scale": [1.0, 1.0],
                },
            },
        ],
        "parts": parts or [],
        "sockets": sockets or [],
        "direction_profiles": direction_profiles or {},
        "draw_slot_profiles": {},
    }
    return RigDefinition.model_validate_json(json.dumps(payload))


def test_bone_transform_combines_additive_and_multiplicative_channels() -> None:
    rest = Transform2D(
        position=Vec2(x=10.0, y=20.0),
        rotation_deg=10.0,
        scale=Vec2(x=2.0, y=3.0),
    )
    delta = Transform2D(
        position=Vec2(x=1.0, y=-2.0),
        rotation_deg=5.0,
        scale=Vec2(x=0.5, y=2.0),
    )

    combined = combine_bone_transform(rest, delta)

    assert combined == Transform2D(
        position=Vec2(x=11.0, y=18.0),
        rotation_deg=15.0,
        scale=Vec2(x=1.0, y=6.0),
    )
    assert bone_local_matrix(rest, delta) == transform_matrix(combined)


def test_pose_resolves_parent_before_child_and_inherits_world_rotation() -> None:
    pose = PoseResolver().resolve(make_rig(), Direction.SE)

    assert pose.bone_order == ("root", "hand")
    hand_origin = transform_point(pose.bone_world_matrices["hand"], Vec2(x=0.0, y=0.0))
    assert hand_origin.x == pytest.approx(10.0, abs=1e-5)
    assert hand_origin.y == pytest.approx(25.0, abs=1e-5)


def test_direction_rest_override_precedes_animation_delta() -> None:
    rig = make_rig(
        direction_profiles={
            "NE": {
                "bone_rest_transforms": {
                    "hand": {
                        "position": [8.0, 0.0],
                        "rotation_deg": 0.0,
                        "scale": [1.0, 1.0],
                    }
                }
            }
        }
    )
    delta = Transform2D(position=Vec2(x=2.0, y=0.0))

    pose = PoseResolver().resolve(rig, Direction.NE, {"hand": delta})

    hand_origin = transform_point(pose.bone_world_matrices["hand"], Vec2(x=0.0, y=0.0))
    assert hand_origin.x == pytest.approx(10.0, abs=1e-5)
    assert hand_origin.y == pytest.approx(30.0, abs=1e-5)


def test_part_and_socket_matrices_follow_normative_composition() -> None:
    part = {
        "part_id": "glove",
        "semantic_part": "hand",
        "bone_id": "hand",
        "assets_by_direction": {"SE": "se_glove"},
        "pivot_by_direction": {"SE": [1.0, 1.0]},
        "bind_transform": {
            "position": [2.0, 3.0],
            "rotation_deg": 90.0,
            "scale": [2.0, 0.5],
        },
        "draw_slot": "hand",
    }
    socket = {
        "socket_id": "hand_weapon",
        "bone_id": "hand",
        "local_transform": {
            "position": [4.0, 2.0],
            "rotation_deg": 90.0,
            "scale": [2.0, 0.5],
        },
        "default_draw_slot": "weapon_front",
    }
    rig = make_rig(
        parts=[part],
        sockets=[socket],
        direction_profiles={"SE": {"pivots": {"glove": [2.0, 1.0]}}},
    )

    pose = PoseResolver().resolve(rig, Direction.SE)

    resolved_bind_origin = transform_point(
        pose.part_matrices["glove"],
        Vec2(x=2.0, y=1.0),
    )
    expected_bind_origin = transform_point(
        pose.bone_world_matrices["hand"],
        Vec2(x=2.0, y=3.0),
    )
    assert resolved_bind_origin.x == pytest.approx(expected_bind_origin.x, abs=1e-5)
    assert resolved_bind_origin.y == pytest.approx(expected_bind_origin.y, abs=1e-5)

    resolved_part_point = transform_point(
        pose.part_matrices["glove"],
        Vec2(x=3.0, y=3.0),
    )
    expected_part_point = transform_point(
        pose.bone_world_matrices["hand"],
        Vec2(x=1.0, y=5.0),
    )
    assert resolved_part_point.x == pytest.approx(expected_part_point.x, abs=1e-5)
    assert resolved_part_point.y == pytest.approx(expected_part_point.y, abs=1e-5)

    socket_origin = transform_point(
        pose.socket_matrices["hand_weapon"],
        Vec2(x=0.0, y=0.0),
    )
    expected_socket_origin = transform_point(
        pose.bone_world_matrices["hand"],
        Vec2(x=4.0, y=2.0),
    )
    assert socket_origin.x == pytest.approx(expected_socket_origin.x, abs=1e-5)
    assert socket_origin.y == pytest.approx(expected_socket_origin.y, abs=1e-5)

    resolved_socket_point = transform_point(
        pose.socket_matrices["hand_weapon"],
        Vec2(x=1.0, y=2.0),
    )
    expected_socket_point = transform_point(
        pose.bone_world_matrices["hand"],
        Vec2(x=3.0, y=4.0),
    )
    assert resolved_socket_point.x == pytest.approx(expected_socket_point.x, abs=1e-5)
    assert resolved_socket_point.y == pytest.approx(expected_socket_point.y, abs=1e-5)


def test_resolved_pose_mappings_and_matrices_are_read_only() -> None:
    pose = PoseResolver().resolve(make_rig(), Direction.SE)

    with pytest.raises(TypeError):
        pose.bone_world_matrices["other"] = pose.bone_world_matrices["root"]  # type: ignore[index]
    with pytest.raises(TypeError):
        pose.bone_world_matrices["root"].values[0] = 2.0  # type: ignore[index]


def test_part_pivot_uses_direction_value_then_zero_origin_fallback() -> None:
    with_pivot = {
        "part_id": "with_pivot",
        "semantic_part": "hand",
        "bone_id": "hand",
        "pivot_by_direction": {"SE": [1.0, 2.0]},
        "draw_slot": "hand",
    }
    without_pivot = {
        "part_id": "without_pivot",
        "semantic_part": "hand",
        "bone_id": "hand",
        "draw_slot": "hand",
    }

    pose = PoseResolver().resolve(make_rig(parts=[with_pivot, without_pivot]), Direction.SE)
    bone_origin = transform_point(
        pose.bone_world_matrices["hand"],
        Vec2(x=0.0, y=0.0),
    )

    assert (
        transform_point(
            pose.part_matrices["with_pivot"],
            Vec2(x=1.0, y=2.0),
        )
        == bone_origin
    )
    assert (
        transform_point(
            pose.part_matrices["without_pivot"],
            Vec2(x=0.0, y=0.0),
        )
        == bone_origin
    )


@pytest.mark.parametrize(
    ("animation_deltas", "profiles", "expected"),
    [
        (
            {"missing": Transform2D()},
            None,
            "Unknown bone IDs in animation delta: 'missing'.",
        ),
        (
            None,
            {"SE": {"bone_rest_transforms": {"missing": {}}}},
            "Unknown bone IDs in direction-profile rest transform: 'missing'.",
        ),
    ],
)
def test_pose_rejects_unknown_bone_inputs(
    animation_deltas: dict[str, Transform2D] | None,
    profiles: dict[str, object] | None,
    expected: str,
) -> None:
    rig = make_rig(direction_profiles=profiles)

    with pytest.raises(RigDefinitionError, match="^" + expected.replace(".", r"\.") + "$"):
        PoseResolver().resolve(rig, Direction.SE, animation_deltas)


def test_pose_rejects_missing_part_and_socket_bones() -> None:
    part = {
        "part_id": "glove",
        "semantic_part": "hand",
        "bone_id": "missing",
        "draw_slot": "hand",
    }
    socket = {
        "socket_id": "hand_weapon",
        "bone_id": "missing",
        "default_draw_slot": "weapon_front",
    }

    with pytest.raises(RigDefinitionError, match="Part 'glove' references missing bone"):
        PoseResolver().resolve(make_rig(parts=[part]), Direction.SE)
    with pytest.raises(RigDefinitionError, match="Socket 'hand_weapon' references missing bone"):
        PoseResolver().resolve(make_rig(sockets=[socket]), Direction.SE)


@pytest.mark.parametrize("element_kind", ["part", "socket"])
def test_pose_rejects_duplicate_part_and_socket_ids(element_kind: str) -> None:
    part = {
        "part_id": "glove",
        "semantic_part": "hand",
        "bone_id": "hand",
        "draw_slot": "hand",
    }
    socket = {
        "socket_id": "hand_weapon",
        "bone_id": "hand",
        "default_draw_slot": "weapon_front",
    }

    if element_kind == "part":
        rig = make_rig(parts=[part, part])
        message = "Duplicate part ID 'glove'"
    else:
        rig = make_rig(sockets=[socket, socket])
        message = "Duplicate socket ID 'hand_weapon'"

    with pytest.raises(RigDefinitionError, match=message):
        PoseResolver().resolve(rig, Direction.SE)
