"""Structural validation for persisted animation clips."""

from __future__ import annotations

import math

from animated_fabric.domain.animation import (
    AnimationTrack,
    AnimationValue,
    Interpolation,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.validation.models import (
    AnimationDocument,
    ValidationCode,
    diagnostic_sort_key,
)

_BONE_PROPERTIES = frozenset(
    {
        TrackProperty.POSITION_X,
        TrackProperty.POSITION_Y,
        TrackProperty.ROTATION_DEG,
        TrackProperty.SCALE_X,
        TrackProperty.SCALE_Y,
    }
)
_PART_PROPERTIES = frozenset(
    {
        TrackProperty.OPACITY,
        TrackProperty.VISIBLE,
        TrackProperty.Z_BIAS,
    }
)
_STEP_INTERPOLATION_LABELS = {
    TrackProperty.VISIBLE: "Visible",
    TrackProperty.Z_BIAS: "Z-bias",
}


def _is_number(value: AnimationValue) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _channel_problem(track: AnimationTrack) -> str | None:
    supported = _BONE_PROPERTIES if track.target_type is TargetType.BONE else _PART_PROPERTIES
    if track.property not in supported:
        return (
            f"Property '{track.property.value}' is not valid for {track.target_type.value} tracks."
        )
    return None


def _value_problem(track: AnimationTrack, value: AnimationValue) -> str | None:
    if track.property is TrackProperty.VISIBLE:
        if not isinstance(value, bool):
            return "Visible-track values must be booleans."
        return None
    if track.property is TrackProperty.Z_BIAS:
        if not isinstance(value, int) or isinstance(value, bool):
            return "Z-bias track values must be integers."
        return None
    if not _is_number(value):
        return f"Property '{track.property.value}' requires a numeric value."
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return f"Property '{track.property.value}' requires a finite numeric value."
    if not math.isfinite(number):
        return f"Property '{track.property.value}' requires a finite numeric value."
    if (
        track.property is TrackProperty.OPACITY
        and track.value_mode is ValueMode.ABSOLUTE
        and not 0.0 <= number <= 1.0
    ):
        return "Opacity track values must be between 0 and 1."
    return None


def validate_animation(
    document: AnimationDocument,
    *,
    bone_ids: frozenset[str],
    part_ids: frozenset[str],
) -> tuple[Diagnostic, ...]:
    """Validate one clip against the available rig identifiers."""
    clip = document.clip
    diagnostics: list[Diagnostic] = []
    seen_channels: set[tuple[TargetType, str, TrackProperty]] = set()

    if not clip.tracks:
        diagnostics.append(
            Diagnostic(
                code=ValidationCode.CLIP_WITHOUT_TRACKS,
                severity=Severity.WARNING,
                message=f"Animation clip '{clip.clip_id}' has no tracks.",
                path=document.path,
                location="tracks",
                suggestion="Add at least one track or remove the unused clip.",
            )
        )

    for track_index, track in enumerate(clip.tracks):
        channel = (track.target_type, track.target_id, track.property)
        if channel in seen_channels:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.TRACK_CHANNEL_INVALID,
                    severity=Severity.ERROR,
                    message=(
                        f"Track repeats channel '{track.target_type.value}:"
                        f"{track.target_id}:{track.property.value}'."
                    ),
                    path=document.path,
                    location=f"tracks[{track_index}].property",
                    suggestion="Keep exactly one track for each target and property channel.",
                )
            )
        seen_channels.add(channel)

        target_ids = bone_ids if track.target_type is TargetType.BONE else part_ids
        if track.target_id not in target_ids:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.TRACK_TARGET_MISSING,
                    severity=Severity.ERROR,
                    message=(
                        f"Track targets missing {track.target_type.value} '{track.target_id}'."
                    ),
                    path=document.path,
                    location=f"tracks[{track_index}].target_id",
                    suggestion=(
                        f"Use an existing {track.target_type.value} ID or add it to the rig."
                    ),
                )
            )

        channel_problem = _channel_problem(track)
        if channel_problem is not None:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.TRACK_CHANNEL_INVALID,
                    severity=Severity.ERROR,
                    message=channel_problem,
                    path=document.path,
                    location=f"tracks[{track_index}].property",
                    suggestion="Choose a property supported by the track target type.",
                )
            )

        key_times = [key.time_ms for key in track.keys]
        if key_times != sorted(key_times):
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.KEYS_UNORDERED,
                    severity=Severity.ERROR,
                    message="Track keyframes are not ordered by time.",
                    path=document.path,
                    location=f"tracks[{track_index}].keys",
                    suggestion="Sort keyframes by increasing time_ms.",
                )
            )

        seen_times: set[int] = set()
        for key_index, key in enumerate(track.keys):
            location = f"tracks[{track_index}].keys[{key_index}]"
            if key.time_ms > clip.duration_ms:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.KEY_OUTSIDE_DURATION,
                        severity=Severity.ERROR,
                        message=(
                            f"Keyframe at {key.time_ms} ms exceeds clip duration "
                            f"{clip.duration_ms} ms."
                        ),
                        path=document.path,
                        location=f"{location}.time_ms",
                        suggestion="Move the keyframe to the clip duration or earlier.",
                    )
                )
            if key.time_ms in seen_times:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.DUPLICATE_KEY,
                        severity=Severity.ERROR,
                        message=f"Track contains more than one keyframe at {key.time_ms} ms.",
                        path=document.path,
                        location=f"{location}.time_ms",
                        suggestion="Keep exactly one keyframe at each time within a track.",
                    )
                )
            seen_times.add(key.time_ms)

            value_problem = _value_problem(track, key.value)
            if channel_problem is None and value_problem is not None:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.TRACK_CHANNEL_INVALID,
                        severity=Severity.ERROR,
                        message=value_problem,
                        path=document.path,
                        location=f"{location}.value",
                        suggestion="Use a value compatible with the animated property.",
                    )
                )
            step_label = _STEP_INTERPOLATION_LABELS.get(track.property)
            if step_label is not None and key.interpolation is not Interpolation.STEP:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.TRACK_CHANNEL_INVALID,
                        severity=Severity.ERROR,
                        message=f"{step_label} tracks require step interpolation.",
                        path=document.path,
                        location=f"{location}.interpolation",
                        suggestion="Set interpolation to 'step'.",
                    )
                )

    for event_index, event in enumerate(clip.events):
        if event.time_ms > clip.duration_ms:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.EVENT_OUTSIDE_RANGE,
                    severity=Severity.WARNING,
                    message=(
                        f"Event '{event.event}' at {event.time_ms} ms exceeds clip duration "
                        f"{clip.duration_ms} ms."
                    ),
                    path=document.path,
                    location=f"events[{event_index}].time_ms",
                    suggestion="Move the event to the clip duration or earlier.",
                )
            )

    return tuple(sorted(diagnostics, key=diagnostic_sort_key))


__all__ = ["validate_animation"]
