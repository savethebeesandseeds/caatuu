"""Pure time normalization and keyframe interpolation for animation tracks."""

from __future__ import annotations

import math

from animated_fabric.domain.animation import (
    AnimationTrack,
    AnimationValue,
    Interpolation,
    Keyframe,
)
from animated_fabric.domain.exceptions import AnimationError


def normalize_clip_time(time_ms: float, duration_ms: int, loop: bool) -> float:
    """Normalize a requested time into one valid clip-relative time."""
    if isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms <= 0:
        raise AnimationError("Animation duration must be a positive integer.")
    try:
        normalized_time = float(time_ms)
    except (TypeError, ValueError, OverflowError) as exc:
        raise AnimationError("Animation time must be a finite number.") from exc
    if not math.isfinite(normalized_time):
        raise AnimationError("Animation time must be finite.")

    if loop:
        return normalized_time % duration_ms
    return min(max(normalized_time, 0.0), float(duration_ms))


def _validate_keys(keys: tuple[Keyframe, ...], duration_ms: int) -> None:
    for index, key in enumerate(keys):
        if key.time_ms > duration_ms:
            raise AnimationError(
                f"Animation keyframe at {key.time_ms} ms exceeds duration {duration_ms} ms."
            )
        if isinstance(key.value, bool) and key.interpolation is not Interpolation.STEP:
            raise AnimationError("Boolean keyframes require step interpolation.")
        if index == 0:
            continue
        previous_time = keys[index - 1].time_ms
        if key.time_ms == previous_time:
            raise AnimationError("Animation keyframe times must not contain duplicates.")
        if key.time_ms < previous_time:
            raise AnimationError("Animation keyframe times must be strictly increasing.")


def _interpolate_segment(
    earlier: Keyframe,
    later: Keyframe,
    time_ms: float,
) -> AnimationValue:
    if earlier.interpolation is Interpolation.STEP:
        return earlier.value
    if isinstance(earlier.value, bool) or isinstance(later.value, bool):
        raise AnimationError("Boolean values cannot use linear or smooth interpolation.")

    ratio = (time_ms - earlier.time_ms) / (later.time_ms - earlier.time_ms)
    if earlier.interpolation is Interpolation.SMOOTH:
        ratio = ratio * ratio * (3.0 - 2.0 * ratio)
    try:
        earlier_value = float(earlier.value)
        later_value = float(later.value)
        result = math.fsum((earlier_value * (1.0 - ratio), later_value * ratio))
    except (OverflowError, ValueError) as exc:
        raise AnimationError("Interpolated keyframe values must be finite numbers.") from exc
    if not math.isfinite(result):
        raise AnimationError("Interpolated keyframe values must be finite numbers.")
    return result


def evaluate_track(
    track: AnimationTrack,
    time_ms: float,
    duration_ms: int,
    loop: bool,
) -> AnimationValue | None:
    """Evaluate one ordered track using its earlier key's interpolation mode."""
    normalized_time = normalize_clip_time(time_ms, duration_ms, loop)
    keys = track.keys
    _validate_keys(keys, duration_ms)
    if not keys:
        return None

    first = keys[0]
    if normalized_time <= first.time_ms:
        return first.value

    for index in range(1, len(keys)):
        later = keys[index]
        if normalized_time == later.time_ms:
            return later.value
        if normalized_time < later.time_ms:
            return _interpolate_segment(keys[index - 1], later, normalized_time)

    return keys[-1].value


__all__ = ["evaluate_track", "normalize_clip_time"]
