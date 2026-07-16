"""Rig-aware AF-021 animation-evaluator tests."""

from __future__ import annotations

import math
from collections.abc import Sequence

import pytest

from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationTrack,
    AnimationValue,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.animation_evaluator import AnimationEvaluator, EvaluatedPartState
from animated_fabric.domain.exceptions import AnimationError, RigDefinitionError
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.pose import PoseResolver
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
)
from animated_fabric.domain.transforms import transform_point


def make_track(
    target_type: TargetType,
    target_id: str,
    property_name: TrackProperty,
    values: Sequence[tuple[int, AnimationValue, Interpolation]],
    *,
    value_mode: ValueMode = ValueMode.DELTA,
) -> AnimationTrack:
    return AnimationTrack(
        target_type=target_type,
        target_id=target_id,
        property=property_name,
        value_mode=value_mode,
        keys=tuple(
            Keyframe(time_ms=time_ms, value=value, interpolation=interpolation)
            for time_ms, value, interpolation in values
        ),
    )


def make_clip(
    *tracks: AnimationTrack,
    duration_ms: int = 1000,
    loop: bool = False,
    template_id: str = "humanoid_v1",
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id="test_clip",
        display_name="Test clip",
        template_id=template_id,
        duration_ms=duration_ms,
        loop=loop,
        fps_hint=12,
        tracks=tracks,
    )


def make_rig(
    *,
    root_scale: Vec2 | None = None,
    parts: tuple[PartBinding, ...] | None = None,
    profile: DirectionProfile | None = None,
) -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id="humanoid_v1",
        bones=(
            BoneDefinition(
                bone_id="root",
                rest_transform=Transform2D(
                    position=Vec2(x=10.0, y=20.0),
                    rotation_deg=10.0,
                    scale=root_scale or Vec2(x=2.0, y=4.0),
                ),
            ),
        ),
        parts=parts
        or (
            PartBinding(
                part_id="body",
                semantic_part="torso",
                bone_id="root",
                draw_slot="torso",
                visible=True,
                opacity=0.8,
            ),
        ),
        direction_profiles={Direction.NE: profile} if profile is not None else {},
    )


def constant_track(
    target_type: TargetType,
    property_name: TrackProperty,
    value: AnimationValue,
    *,
    target_id: str | None = None,
    value_mode: ValueMode = ValueMode.DELTA,
    interpolation: Interpolation = Interpolation.STEP,
) -> AnimationTrack:
    return make_track(
        target_type,
        target_id or ("root" if target_type is TargetType.BONE else "body"),
        property_name,
        [(0, value, interpolation)],
        value_mode=value_mode,
    )


def test_bone_channels_convert_absolute_values_against_direction_rest_pose() -> None:
    profile = DirectionProfile(
        bone_rest_transforms={
            "root": Transform2D(
                position=Vec2(x=100.0, y=200.0),
                rotation_deg=20.0,
                scale=Vec2(x=4.0, y=8.0),
            )
        },
        track_multipliers={"root.rotation_deg": 0.5},
    )
    clip = make_clip(
        constant_track(
            TargetType.BONE,
            TrackProperty.POSITION_X,
            110.0,
            value_mode=ValueMode.ABSOLUTE,
        ),
        constant_track(TargetType.BONE, TrackProperty.POSITION_Y, 3.0),
        constant_track(TargetType.BONE, TrackProperty.ROTATION_DEG, 10.0),
        constant_track(
            TargetType.BONE,
            TrackProperty.SCALE_X,
            8.0,
            value_mode=ValueMode.ABSOLUTE,
        ),
        constant_track(TargetType.BONE, TrackProperty.SCALE_Y, 0.5),
    )

    evaluated = AnimationEvaluator().evaluate(clip, make_rig(profile=profile), Direction.NE, 0.0)

    assert evaluated.bone_deltas["root"] == Transform2D(
        position=Vec2(x=10.0, y=3.0),
        rotation_deg=5.0,
        scale=Vec2(x=2.0, y=0.5),
    )


def test_absolute_channels_are_not_changed_by_direction_multiplier() -> None:
    profile = DirectionProfile(track_multipliers={"root.rotation_deg": 0.1})
    clip = make_clip(
        constant_track(
            TargetType.BONE,
            TrackProperty.ROTATION_DEG,
            40.0,
            value_mode=ValueMode.ABSOLUTE,
        )
    )

    evaluated = AnimationEvaluator().evaluate(clip, make_rig(profile=profile), Direction.NE, 0.0)

    assert evaluated.bone_deltas["root"].rotation_deg == 30.0


def test_evaluated_bone_deltas_feed_pose_resolver_without_an_adapter() -> None:
    clip = make_clip(
        constant_track(TargetType.BONE, TrackProperty.POSITION_X, 5.0),
        constant_track(TargetType.BONE, TrackProperty.POSITION_Y, -2.0),
    )
    rig = make_rig()

    evaluated = AnimationEvaluator().evaluate(clip, rig, Direction.SE, 0.0)
    pose = PoseResolver().resolve(rig, Direction.SE, evaluated.bone_deltas)
    root_origin = transform_point(pose.bone_world_matrices["root"], Vec2(x=0.0, y=0.0))

    assert root_origin == Vec2(x=15.0, y=18.0)


def test_scale_direction_multiplier_adjusts_delta_around_identity_in_pose() -> None:
    profile = DirectionProfile(track_multipliers={"root.scale_x": 0.0})
    clip = make_clip(constant_track(TargetType.BONE, TrackProperty.SCALE_X, 2.0))
    rig = make_rig(profile=profile)

    evaluated = AnimationEvaluator().evaluate(clip, rig, Direction.NE, 0.0)
    pose = PoseResolver().resolve(rig, Direction.NE, evaluated.bone_deltas)
    origin = transform_point(pose.bone_world_matrices["root"], Vec2(x=0.0, y=0.0))
    unit_x = transform_point(pose.bone_world_matrices["root"], Vec2(x=1.0, y=0.0))

    assert evaluated.bone_deltas["root"].scale.x == 1.0
    assert math.hypot(unit_x.x - origin.x, unit_x.y - origin.y) == pytest.approx(2.0)


def test_part_channels_resolve_final_visible_opacity_and_integer_z_bias() -> None:
    clip = make_clip(
        constant_track(TargetType.PART, TrackProperty.VISIBLE, False),
        constant_track(TargetType.PART, TrackProperty.OPACITY, -0.3),
        constant_track(TargetType.PART, TrackProperty.Z_BIAS, -2),
    )

    evaluated = AnimationEvaluator().evaluate(clip, make_rig(), Direction.SE, 0.0)

    assert evaluated.part_states["body"] == EvaluatedPartState(
        visible=False,
        opacity=0.5,
        z_bias=-2,
    )


@pytest.mark.parametrize(("delta", "expected"), [(1.0, 1.0), (-2.0, 0.0)])
def test_opacity_delta_clamps_to_normative_range(delta: float, expected: float) -> None:
    clip = make_clip(constant_track(TargetType.PART, TrackProperty.OPACITY, delta))

    evaluated = AnimationEvaluator().evaluate(clip, make_rig(), Direction.SE, 0.0)

    assert evaluated.part_states["body"].opacity == expected


def test_empty_clip_uses_identity_bones_and_direction_part_defaults() -> None:
    profile = DirectionProfile(part_visibility={"body": False})

    evaluated = AnimationEvaluator().evaluate(
        make_clip(loop=True),
        make_rig(profile=profile),
        Direction.NE,
        1000.0,
    )

    assert evaluated.time_ms == 0.0
    assert dict(evaluated.bone_deltas) == {}
    assert evaluated.part_states["body"] == EvaluatedPartState(
        visible=False,
        opacity=0.8,
        z_bias=0,
    )


def test_absolute_zero_scale_on_zero_rest_scale_uses_identity_factor() -> None:
    clip = make_clip(
        constant_track(
            TargetType.BONE,
            TrackProperty.SCALE_X,
            0.0,
            value_mode=ValueMode.ABSOLUTE,
        )
    )

    evaluated = AnimationEvaluator().evaluate(
        clip,
        make_rig(root_scale=Vec2(x=0.0, y=1.0)),
        Direction.SE,
        0.0,
    )

    assert evaluated.bone_deltas["root"].scale.x == 1.0


def test_nonzero_absolute_scale_cannot_be_resolved_from_zero_rest_scale() -> None:
    clip = make_clip(
        constant_track(
            TargetType.BONE,
            TrackProperty.SCALE_X,
            1.0,
            value_mode=ValueMode.ABSOLUTE,
        )
    )

    with pytest.raises(AnimationError, match="zero rest scale"):
        AnimationEvaluator().evaluate(
            clip,
            make_rig(root_scale=Vec2(x=0.0, y=1.0)),
            Direction.SE,
            0.0,
        )


@pytest.mark.parametrize(
    ("clip", "message"),
    [
        (
            make_clip(
                constant_track(TargetType.BONE, TrackProperty.POSITION_X, 1.0),
                constant_track(TargetType.BONE, TrackProperty.POSITION_X, 2.0),
            ),
            "declared more than once",
        ),
        (
            make_clip(
                constant_track(
                    TargetType.BONE,
                    TrackProperty.POSITION_X,
                    1.0,
                    target_id="missing",
                )
            ),
            "targets missing bone",
        ),
        (
            make_clip(constant_track(TargetType.BONE, TrackProperty.VISIBLE, True)),
            "not valid for bone tracks",
        ),
        (make_clip(template_id="quadruped_v1"), "does not match rig template"),
    ],
)
def test_ambiguous_or_incompatible_animation_inputs_raise_typed_errors(
    clip: AnimationClip,
    message: str,
) -> None:
    with pytest.raises(AnimationError, match=message):
        AnimationEvaluator().evaluate(clip, make_rig(), Direction.SE, 0.0)


def test_discrete_part_channels_reject_non_step_or_non_integer_results() -> None:
    non_step = make_clip(
        constant_track(
            TargetType.PART,
            TrackProperty.Z_BIAS,
            2,
            interpolation=Interpolation.LINEAR,
        )
    )
    profile = DirectionProfile(track_multipliers={"body.z_bias": 0.5})
    non_integer = make_clip(constant_track(TargetType.PART, TrackProperty.Z_BIAS, 1))

    with pytest.raises(AnimationError, match="requires step interpolation"):
        AnimationEvaluator().evaluate(non_step, make_rig(), Direction.SE, 0.0)
    with pytest.raises(AnimationError, match="must be an integer"):
        AnimationEvaluator().evaluate(non_integer, make_rig(profile=profile), Direction.NE, 0.0)


@pytest.mark.parametrize(
    ("track", "message"),
    [
        (
            make_track(
                TargetType.PART,
                "body",
                TrackProperty.VISIBLE,
                [
                    (0, True, Interpolation.STEP),
                    (500, 1, Interpolation.STEP),
                ],
            ),
            "must be booleans",
        ),
        (
            constant_track(TargetType.PART, TrackProperty.Z_BIAS, 1.0),
            "must be integers",
        ),
        (
            make_track(
                TargetType.PART,
                "body",
                TrackProperty.OPACITY,
                [
                    (0, 0.5, Interpolation.LINEAR),
                    (500, 1.5, Interpolation.STEP),
                ],
                value_mode=ValueMode.ABSOLUTE,
            ),
            "between 0 and 1",
        ),
    ],
)
def test_every_key_is_validated_even_when_the_invalid_key_is_not_sampled(
    track: AnimationTrack,
    message: str,
) -> None:
    with pytest.raises(AnimationError, match=message):
        AnimationEvaluator().evaluate(make_clip(track), make_rig(), Direction.SE, 0.0)


def test_key_after_duration_is_rejected_by_high_level_evaluation() -> None:
    track = make_track(
        TargetType.BONE,
        "root",
        TrackProperty.POSITION_X,
        [
            (0, 0.0, Interpolation.LINEAR),
            (1001, 1.0, Interpolation.STEP),
        ],
    )

    with pytest.raises(AnimationError, match="exceeds duration"):
        AnimationEvaluator().evaluate(make_clip(track), make_rig(), Direction.SE, 0.0)


@pytest.mark.parametrize(
    ("clip", "rig"),
    [
        (
            make_clip(constant_track(TargetType.BONE, TrackProperty.ROTATION_DEG, 1e308)),
            make_rig(profile=DirectionProfile(track_multipliers={"root.rotation_deg": 1e308})),
        ),
        (
            make_clip(
                constant_track(
                    TargetType.BONE,
                    TrackProperty.SCALE_X,
                    1e308,
                    value_mode=ValueMode.ABSOLUTE,
                )
            ),
            make_rig(root_scale=Vec2(x=1e-308, y=1.0)),
        ),
    ],
)
def test_overflowing_evaluation_raises_typed_animation_error(
    clip: AnimationClip,
    rig: RigDefinition,
) -> None:
    with pytest.raises(AnimationError, match="must remain finite"):
        AnimationEvaluator().evaluate(clip, rig, Direction.NE, 0.0)


def test_unrepresentable_integer_key_raises_typed_animation_error() -> None:
    clip = make_clip(constant_track(TargetType.BONE, TrackProperty.POSITION_X, 10**1000))

    with pytest.raises(AnimationError, match="finite numeric value"):
        AnimationEvaluator().evaluate(clip, make_rig(), Direction.SE, 0.0)


def test_evaluated_mappings_are_read_only_and_input_models_are_unchanged() -> None:
    clip = make_clip(constant_track(TargetType.BONE, TrackProperty.POSITION_X, 1.0))
    before = clip.model_dump(mode="json")

    evaluated = AnimationEvaluator().evaluate(clip, make_rig(), Direction.SE, 0.0)

    with pytest.raises(TypeError):
        evaluated.bone_deltas["other"] = Transform2D()  # type: ignore[index]
    with pytest.raises(TypeError):
        evaluated.part_states["other"] = EvaluatedPartState(True, 1.0, 0)  # type: ignore[index]
    assert clip.model_dump(mode="json") == before


def test_duplicate_part_ids_raise_the_typed_rig_error() -> None:
    duplicate = PartBinding(
        part_id="body",
        semantic_part="torso",
        bone_id="root",
        draw_slot="torso",
    )

    with pytest.raises(RigDefinitionError, match="Duplicate part ID"):
        AnimationEvaluator().evaluate(
            make_clip(),
            make_rig(parts=(duplicate, duplicate)),
            Direction.SE,
            0.0,
        )
