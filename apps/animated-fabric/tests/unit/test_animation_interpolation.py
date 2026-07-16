"""Tests for AF-021 clip-time normalization and track interpolation."""

from __future__ import annotations

import math

import pytest

from animated_fabric.domain.animation import (
    AnimationTrack,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
)
from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.interpolation import evaluate_track, normalize_clip_time


def make_track(*keys: Keyframe) -> AnimationTrack:
    return AnimationTrack(
        target_type=TargetType.BONE,
        target_id="root",
        property=TrackProperty.POSITION_X,
        keys=keys,
    )


def key(time_ms: int, value: bool | int | float, mode: Interpolation) -> Keyframe:
    return Keyframe(time_ms=time_ms, value=value, interpolation=mode)


@pytest.mark.parametrize(
    ("time_ms", "expected"),
    [(-50.0, 0.0), (0.0, 0.0), (250.5, 250.5), (1000.0, 1000.0), (1250.0, 1000.0)],
)
def test_non_looping_time_is_clamped(time_ms: float, expected: float) -> None:
    result = normalize_clip_time(time_ms, 1000, loop=False)

    assert result == expected
    assert type(result) is float


@pytest.mark.parametrize(
    ("time_ms", "expected"),
    [(-1.0, 999.0), (0.0, 0.0), (999.5, 999.5), (1000.0, 0.0), (2250.0, 250.0)],
)
def test_looping_time_uses_python_modulo(time_ms: float, expected: float) -> None:
    assert normalize_clip_time(time_ms, 1000, loop=True) == expected


@pytest.mark.parametrize("time_ms", [math.nan, math.inf, -math.inf])
def test_nonfinite_time_is_rejected(time_ms: float) -> None:
    with pytest.raises(AnimationError, match="time must be finite"):
        normalize_clip_time(time_ms, 1000, loop=False)


@pytest.mark.parametrize("duration_ms", [0, -1])
def test_nonpositive_duration_is_rejected(duration_ms: int) -> None:
    with pytest.raises(AnimationError, match="positive integer"):
        normalize_clip_time(0.0, duration_ms, loop=False)


def test_non_integer_duration_and_unrepresentable_time_are_rejected() -> None:
    with pytest.raises(AnimationError, match="positive integer"):
        normalize_clip_time(0.0, 1.5, loop=False)  # type: ignore[arg-type]
    with pytest.raises(AnimationError, match="finite number"):
        normalize_clip_time(10**1000, 1000, loop=False)


def test_empty_track_returns_none_after_time_validation() -> None:
    track = make_track()

    assert evaluate_track(track, 100.0, 1000, loop=False) is None
    with pytest.raises(AnimationError, match="time must be finite"):
        evaluate_track(track, math.nan, 1000, loop=False)


def test_single_key_holds_for_the_entire_clip_without_changing_type() -> None:
    track = make_track(key(400, 7, Interpolation.STEP))

    before = evaluate_track(track, 0.0, 1000, loop=False)
    after = evaluate_track(track, 1000.0, 1000, loop=False)

    assert before == 7 and type(before) is int
    assert after == 7 and type(after) is int


def test_first_and_last_values_hold_outside_the_authored_key_range() -> None:
    track = make_track(
        key(200, 3, Interpolation.LINEAR),
        key(800, 9.0, Interpolation.STEP),
    )

    assert evaluate_track(track, 0.0, 1000, loop=False) == 3
    assert evaluate_track(track, 1000.0, 1000, loop=False) == 9.0


def test_exact_key_returns_its_exact_typed_value() -> None:
    track = make_track(
        key(0, 1, Interpolation.LINEAR),
        key(500, 4, Interpolation.SMOOTH),
        key(1000, 9.0, Interpolation.STEP),
    )

    middle = evaluate_track(track, 500.0, 1000, loop=False)
    last = evaluate_track(track, 1000.0, 1000, loop=False)

    assert middle == 4 and type(middle) is int
    assert last == 9.0 and type(last) is float


def test_loop_boundary_evaluates_at_zero() -> None:
    track = make_track(
        key(0, 2, Interpolation.LINEAR),
        key(1000, 12, Interpolation.STEP),
    )

    result = evaluate_track(track, 1000.0, 1000, loop=True)

    assert result == 2 and type(result) is int


def test_earlier_key_controls_step_and_linear_segments() -> None:
    track = make_track(
        key(0, 2, Interpolation.STEP),
        key(100, 10, Interpolation.LINEAR),
        key(200, 30, Interpolation.STEP),
    )

    stepped = evaluate_track(track, 50.0, 200, loop=False)
    linear = evaluate_track(track, 150.0, 200, loop=False)

    assert stepped == 2 and type(stepped) is int
    assert linear == pytest.approx(20.0)
    assert type(linear) is float


def test_linear_interpolation_supports_mixed_integer_and_float_endpoints() -> None:
    track = make_track(
        key(0, -10, Interpolation.LINEAR),
        key(400, 10.0, Interpolation.STEP),
    )

    assert evaluate_track(track, 100.0, 400, loop=False) == pytest.approx(-5.0)


def test_smooth_interpolation_uses_smoothstep_easing() -> None:
    track = make_track(
        key(0, 0.0, Interpolation.SMOOTH),
        key(100, 10.0, Interpolation.STEP),
    )

    assert evaluate_track(track, 25.0, 100, loop=False) == pytest.approx(1.5625)
    assert evaluate_track(track, 75.0, 100, loop=False) == pytest.approx(8.4375)


def test_step_boolean_values_hold_and_preserve_boolean_type() -> None:
    track = make_track(
        key(0, False, Interpolation.STEP),
        key(100, True, Interpolation.STEP),
    )

    held = evaluate_track(track, 50.0, 100, loop=False)
    exact = evaluate_track(track, 100.0, 100, loop=False)

    assert held is False
    assert exact is True


@pytest.mark.parametrize("mode", [Interpolation.LINEAR, Interpolation.SMOOTH])
def test_boolean_key_with_non_step_mode_is_rejected(mode: Interpolation) -> None:
    track = make_track(key(0, False, mode), key(100, True, Interpolation.STEP))

    with pytest.raises(AnimationError, match="Boolean keyframes require step"):
        evaluate_track(track, 0.0, 100, loop=False)


def test_boolean_endpoint_cannot_participate_in_numeric_interpolation() -> None:
    track = make_track(
        key(0, 0.0, Interpolation.LINEAR),
        key(100, True, Interpolation.STEP),
    )

    with pytest.raises(AnimationError, match="Boolean values cannot use"):
        evaluate_track(track, 50.0, 100, loop=False)


@pytest.mark.parametrize(
    ("keys", "message"),
    [
        (
            (key(100, 1.0, Interpolation.STEP), key(100, 2.0, Interpolation.STEP)),
            "must not contain duplicates",
        ),
        (
            (key(200, 1.0, Interpolation.STEP), key(100, 2.0, Interpolation.STEP)),
            "must be strictly increasing",
        ),
    ],
)
def test_duplicate_and_unordered_keys_are_rejected_before_evaluation(
    keys: tuple[Keyframe, ...],
    message: str,
) -> None:
    with pytest.raises(AnimationError, match=message):
        evaluate_track(make_track(*keys), 0.0, 1000, loop=False)


def test_key_after_duration_is_rejected_before_it_can_affect_evaluation() -> None:
    track = make_track(
        key(0, 1.0, Interpolation.LINEAR),
        key(1001, 2.0, Interpolation.STEP),
    )

    with pytest.raises(AnimationError, match="exceeds duration"):
        evaluate_track(track, 0.0, 1000, loop=False)


def test_unrepresentable_numeric_key_raises_the_typed_animation_error() -> None:
    track = make_track(
        key(0, 10**1000, Interpolation.LINEAR),
        key(100, 1.0, Interpolation.STEP),
    )

    with pytest.raises(AnimationError, match="finite numbers"):
        evaluate_track(track, 50.0, 100, loop=False)


def test_evaluation_does_not_mutate_the_track() -> None:
    track = make_track(
        key(0, 1.0, Interpolation.LINEAR),
        key(100, 3.0, Interpolation.STEP),
    )
    original = track.model_dump(mode="json")

    assert evaluate_track(track, 50.0, 100, loop=False) == pytest.approx(2.0)
    assert track.model_dump(mode="json") == original
