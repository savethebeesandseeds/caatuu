"""AF-023 validation tests for topology orders supplied by the renderer cache."""

from __future__ import annotations

import pytest

from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationTrack,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
)
from animated_fabric.domain.animation_evaluator import AnimationEvaluator
from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.hierarchy import validate_topological_bone_order
from animated_fabric.domain.pose import PoseResolver
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import BoneDefinition, RigDefinition


def _rig() -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="cached_order",
        template_id="humanoid_v1",
        bones=(
            BoneDefinition(bone_id="child", parent_id="root"),
            BoneDefinition(bone_id="root"),
        ),
    )


def _clip() -> AnimationClip:
    tracks = tuple(
        AnimationTrack(
            target_type=TargetType.BONE,
            target_id=bone_id,
            property=TrackProperty.POSITION_X,
            keys=(Keyframe(time_ms=0, value=value, interpolation=Interpolation.STEP),),
        )
        for bone_id, value in (("child", 2.0), ("root", 1.0))
    )
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id="cached_order",
        display_name="Cached order",
        template_id="humanoid_v1",
        duration_ms=100,
        loop=False,
        fps_hint=12,
        tracks=tracks,
    )


def test_valid_cached_order_is_reused_by_pose_and_animation_evaluation() -> None:
    rig = _rig()
    cached_order = ("root", "child")

    pose = PoseResolver().resolve(rig, Direction.SE, bone_order=cached_order)
    evaluated = AnimationEvaluator().evaluate(
        _clip(),
        rig,
        Direction.SE,
        0,
        bone_order=cached_order,
    )

    assert pose.bone_order is cached_order
    assert tuple(evaluated.bone_deltas) == cached_order


@pytest.mark.parametrize(
    ("bone_order", "message"),
    [
        (["root", "child"], "immutable tuple"),
        (("root",), "every rig bone exactly once"),
        (("root", "root"), "every rig bone exactly once"),
        (("child", "root"), "before parent"),
    ],
)
def test_cached_order_validation_rejects_mutable_incomplete_or_child_first_orders(
    bone_order: object,
    message: str,
) -> None:
    with pytest.raises(RigDefinitionError, match=message):
        validate_topological_bone_order(_rig(), bone_order)  # type: ignore[arg-type]


def test_pose_and_evaluator_do_not_trust_invalid_supplied_orders() -> None:
    rig = _rig()

    with pytest.raises(RigDefinitionError, match="before parent"):
        PoseResolver().resolve(rig, Direction.SE, bone_order=("child", "root"))
    with pytest.raises(RigDefinitionError, match="every rig bone exactly once"):
        AnimationEvaluator().evaluate(
            _clip(),
            rig,
            Direction.SE,
            0,
            bone_order=("root",),
        )
