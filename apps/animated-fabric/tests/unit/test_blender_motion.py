"""Pure-Python acceptance coverage for the AF-044 procedural walk plan."""

from __future__ import annotations

import ast
import json
import math
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import cast

import pytest

from animated_fabric.domain.export import (
    DirectionalPrerenderMetadata,
    FrameSequenceMetadata,
)
from tools.blender import motion


def _assert_vec_close(actual: motion.Vec3, expected: motion.Vec3) -> None:
    assert actual.x == pytest.approx(expected.x, abs=1e-10)
    assert actual.y == pytest.approx(expected.y, abs=1e-10)
    assert actual.z == pytest.approx(expected.z, abs=1e-10)


def _distance(first: motion.Vec3, second: motion.Vec3) -> float:
    return (second - first).length


def test_walk_samples_one_period_without_root_translation_or_duplicate_endpoint() -> None:
    frames = motion.walk_frames()

    assert len(frames) == motion.FRAME_COUNT == 12
    assert tuple(frame.index for frame in frames) == tuple(range(12))
    assert tuple(frame.time_ms for frame in frames) == tuple(
        index * 1000 / 12 for index in range(12)
    )
    assert all(frame.pose.root == motion.ZERO for frame in frames)
    assert motion.pose_at_phase(0.0) == motion.pose_at_phase(1.0)
    assert motion.pose_at_phase(-1.0) == motion.pose_at_phase(0.0)
    assert frames[-1].pose != frames[0].pose


def test_pose_values_are_finite_immutable_and_keep_exact_limb_lengths() -> None:
    frames = motion.walk_frames()

    for frame in frames:
        assert all(math.isfinite(value) for point in frame.pose.points for value in point)
        for leg in (frame.pose.left_leg, frame.pose.right_leg):
            assert _distance(leg.hip, leg.knee) == pytest.approx(motion.UPPER_LEG_LENGTH, abs=1e-10)
            assert _distance(leg.knee, leg.ankle) == pytest.approx(
                motion.LOWER_LEG_LENGTH, abs=1e-10
            )
        for arm in (frame.pose.left_arm, frame.pose.right_arm):
            assert _distance(arm.shoulder, arm.elbow) == pytest.approx(
                motion.UPPER_ARM_LENGTH, abs=1e-10
            )
            assert _distance(arm.elbow, arm.wrist) == pytest.approx(
                motion.LOWER_ARM_LENGTH, abs=1e-10
            )

    with pytest.raises(FrozenInstanceError):
        frames[0].pose.root.x = 1.0


def test_stance_feet_travel_backward_at_constant_speed() -> None:
    phases = tuple(motion.STANCE_RATIO * fraction for fraction in (0.0, 0.25, 0.5, 0.75))
    positions = tuple(motion.pose_at_phase(phase).left_leg.foot.sole_center.y for phase in phases)

    increments = tuple(positions[index + 1] - positions[index] for index in range(3))
    assert increments == pytest.approx((-motion.STRIDE_LENGTH / 4.0,) * 3, abs=1e-12)
    assert all(motion.pose_at_phase(phase).left_leg.foot.contact for phase in phases)


def test_feet_never_penetrate_ground_and_swing_has_visible_clearance() -> None:
    clearances: list[float] = []
    contact_count = 0

    for frame in motion.walk_frames():
        for leg in (frame.pose.left_leg, frame.pose.right_leg):
            foot = leg.foot
            assert foot.sole_clearance >= -1e-12
            assert foot.sole_center.z >= -1e-12
            if foot.contact:
                contact_count += 1
                assert foot.sole_center.z == pytest.approx(0.0, abs=1e-12)
                assert foot.heel.z == pytest.approx(0.0, abs=1e-12)
                assert foot.toe.z == pytest.approx(0.0, abs=1e-12)
            else:
                clearances.append(foot.sole_clearance)

    assert contact_count > motion.FRAME_COUNT
    assert max(clearances) >= motion.FOOT_LIFT * 0.9


def test_half_cycle_swaps_limbs_under_exact_bilateral_mirror() -> None:
    for phase in (0.0, 0.07, 0.23, 0.41, 0.62, 0.79):
        pose = motion.pose_at_phase(phase)
        opposite = motion.pose_at_phase(phase + 0.5)

        _assert_vec_close(pose.pelvis, opposite.pelvis.reflected_x())
        _assert_vec_close(pose.chest, opposite.chest.reflected_x())
        _assert_vec_close(pose.head, opposite.head.reflected_x())
        for actual, mirrored in (
            (pose.left_leg.hip, opposite.right_leg.hip),
            (pose.left_leg.knee, opposite.right_leg.knee),
            (pose.left_leg.foot.ankle, opposite.right_leg.foot.ankle),
            (pose.left_leg.foot.heel, opposite.right_leg.foot.heel),
            (pose.left_leg.foot.toe, opposite.right_leg.foot.toe),
            (pose.left_arm.shoulder, opposite.right_arm.shoulder),
            (pose.left_arm.elbow, opposite.right_arm.elbow),
            (pose.left_arm.wrist, opposite.right_arm.wrist),
        ):
            _assert_vec_close(actual, mirrored.reflected_x())
        assert pose.left_leg.foot.contact is opposite.right_leg.foot.contact
        assert pose.pelvis_yaw_deg == pytest.approx(-opposite.pelvis_yaw_deg, abs=1e-10)
        assert pose.chest_yaw_deg == pytest.approx(-opposite.chest_yaw_deg, abs=1e-10)


def test_arms_counter_swing_the_same_side_legs() -> None:
    for phase in (0.0, 0.5):
        pose = motion.pose_at_phase(phase)
        for leg, arm in (
            (pose.left_leg, pose.left_arm),
            (pose.right_leg, pose.right_arm),
        ):
            foot_offset = leg.foot.sole_center.y - pose.pelvis.y
            wrist_offset = arm.wrist.y - pose.chest.y
            assert foot_offset * wrist_offset < 0.0

    first = motion.pose_at_phase(0.0)
    assert first.left_leg.foot.sole_center.y > first.pelvis.y
    assert first.left_arm.wrist.y < first.chest.y
    assert first.right_leg.foot.sole_center.y < first.pelvis.y
    assert first.right_arm.wrist.y > first.chest.y


def test_pelvis_motion_is_subtle_periodic_and_root_remains_fixed() -> None:
    poses = tuple(motion.pose_at_phase(index / motion.FRAME_COUNT) for index in range(12))
    pelvis_x = tuple(pose.pelvis.x for pose in poses)
    pelvis_z = tuple(pose.pelvis.z for pose in poses)

    assert max(abs(value) for value in pelvis_x) <= motion.PELVIS_SWAY
    assert max(pelvis_x) - min(pelvis_x) == pytest.approx(2.0 * motion.PELVIS_SWAY)
    assert max(pelvis_z) - min(pelvis_z) == pytest.approx(2.0 * motion.PELVIS_BOB)
    assert all(pose.root == motion.ZERO for pose in poses)


def test_direction_yaws_are_fixed_complete_and_immutable() -> None:
    assert motion.DIRECTIONS == ("SE", "SW", "NE", "NW")
    assert dict(motion.DIRECTION_YAW_DEGREES) == {"SE": -90, "SW": 180, "NE": 0, "NW": 90}
    assert tuple(motion.direction_yaw_degrees(item) for item in motion.DIRECTIONS) == (
        -90,
        180,
        0,
        90,
    )

    mutable_view = cast(dict[str, int], motion.DIRECTION_YAW_DEGREES)
    with pytest.raises(TypeError):
        mutable_view["SE"] = 0
    with pytest.raises(ValueError, match="Direction must be one of"):
        motion.direction_yaw_degrees("se")


def test_one_motion_fingerprint_drives_the_strict_four_yaw_manifest() -> None:
    frames = motion.walk_frames()

    first_digest = motion.motion_sha256(frames)
    second_digest = motion.motion_sha256(frames)
    document = motion.build_directional_prerender_manifest(frames)
    metadata = DirectionalPrerenderMetadata.model_validate_json(
        json.dumps(document, allow_nan=False)
    )

    assert first_digest == second_digest == metadata.motion_sha256
    assert len(first_digest) == 64
    assert metadata.frame_sequence == "walk/animation.json"
    assert tuple(
        (view.direction.value, view.actor_yaw_degrees) for view in metadata.views
    ) == tuple(motion.DIRECTION_YAW_DEGREES.items())
    assert motion.canonical_directional_prerender_json(frames).endswith("\n")


def test_motion_fingerprint_rejects_a_noncanonical_schedule() -> None:
    frames = motion.walk_frames()
    invalid = (
        motion.WalkFrame(
            index=0,
            time_ms=frames[0].time_ms,
            duration_ms=frames[0].duration_ms + 1,
            events=frames[0].events,
            pose=frames[0].pose,
        ),
        *frames[1:],
    )

    with pytest.raises(ValueError, match="canonical walk schedule"):
        motion.motion_sha256(invalid)


def test_blender_worker_constructs_the_walk_tuple_once() -> None:
    source = (Path(motion.__file__).parent / "render_walk.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "motion"
        and node.func.attr == "walk_frames"
    ]

    assert len(calls) == 1


def test_frame_durations_events_and_paths_are_exact() -> None:
    durations = motion.frame_durations_ms()

    assert durations == (83, 83, 84) * 4
    assert sum(durations) == motion.DURATION_MS
    assert motion.frame_events(0) == ("foot_contact_l",)
    assert motion.frame_events(6) == ("foot_contact_r",)
    assert all(motion.frame_events(index) == () for index in (*range(1, 6), *range(7, 12)))

    document = motion.build_frame_sequence_manifest()
    frames = cast(list[dict[str, object]], document["frames"])
    assert len(frames) == 48
    assert [frame["image"] for frame in frames[:12]] == [
        f"SE/{index:03d}.png" for index in range(12)
    ]
    assert [frame["direction"] for frame in frames[::12]] == list(motion.DIRECTIONS)
    for offset in range(0, 48, 12):
        assert frames[offset]["events"] == ["foot_contact_l"]
        assert frames[offset + 6]["events"] == ["foot_contact_r"]


def test_manifest_is_strictly_compatible_json_ready_and_deterministic() -> None:
    first = motion.canonical_manifest_json()
    second = motion.canonical_manifest_json()

    assert first == second
    assert first.endswith("\n")
    assert "generated_at" not in first
    assert "\\\\" not in first
    assert json.dumps(motion.build_frame_sequence_manifest(), allow_nan=False)

    metadata = FrameSequenceMetadata.model_validate_json(first)
    assert metadata.project == "blender_humanoid"
    assert metadata.animation == "walk"
    assert metadata.frames_per_direction == 12
    assert metadata.duration_ms == 1000
    assert tuple(item.value for item in metadata.directions) == motion.DIRECTIONS


def test_motion_module_has_no_blender_runtime_dependency() -> None:
    source = Path(motion.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported_roots = {
        alias.name.split(".", maxsplit=1)[0]
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }

    assert "bpy" not in imported_roots
    assert "mathutils" not in imported_roots


@pytest.mark.parametrize("value", [True, math.inf, math.nan, "0.5"])
def test_invalid_phases_are_rejected(value: object) -> None:
    with pytest.raises((TypeError, ValueError)):
        motion.pose_at_phase(cast(float, value))


@pytest.mark.parametrize("index", [-1, 12, True])
def test_invalid_frame_indexes_are_rejected(index: int) -> None:
    with pytest.raises(ValueError, match="Frame index"):
        motion.walk_frame(index)
