"""Unit tests for strict animation and export-profile domain contracts."""

from __future__ import annotations

import json
import math

import pytest
from pydantic import ValidationError

from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationEvent,
    AnimationTrack,
    GeneratorProvenance,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.export import ExportProfile
from animated_fabric.domain.project import Direction


def test_animation_clip_round_trips_normative_json() -> None:
    payload = {
        "format": "animated-fabric.animation-clip.v1",
        "schema_version": "0.1.0",
        "clip_id": "idle",
        "display_name": "Idle",
        "template_id": "humanoid_v1",
        "duration_ms": 2000,
        "loop": True,
        "fps_hint": 12,
        "tracks": [
            {
                "target_type": "bone",
                "target_id": "torso",
                "property": "position_y",
                "value_mode": "delta",
                "keys": [
                    {"time_ms": 0, "value": -1.5, "interpolation": "smooth"},
                    {"time_ms": 1000, "value": 1.5, "interpolation": "smooth"},
                ],
            }
        ],
        "events": [{"time_ms": 0, "event": "foot_contact_l"}],
        "generator_provenance": {
            "generator_id": "humanoid_idle_v1",
            "parameters": {"duration_ms": 2000, "breath_y_px": 1.5},
        },
    }

    clip = AnimationClip.model_validate_json(json.dumps(payload))

    assert clip.tracks[0].target_type is TargetType.BONE
    assert clip.tracks[0].property is TrackProperty.POSITION_Y
    assert clip.tracks[0].value_mode is ValueMode.DELTA
    assert clip.tracks[0].keys[0].interpolation is Interpolation.SMOOTH
    assert json.loads(clip.model_dump_json()) == payload


@pytest.mark.parametrize("value", [False, 7, 2.5])
def test_keyframe_accepts_each_supported_value_type(value: bool | int | float) -> None:
    key = Keyframe(time_ms=0, value=value, interpolation=Interpolation.STEP)

    assert key.value == value
    assert type(key.value) is type(value)


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan])
def test_keyframe_rejects_non_finite_values(value: float) -> None:
    with pytest.raises(ValidationError):
        Keyframe(time_ms=0, value=value, interpolation=Interpolation.LINEAR)


@pytest.mark.parametrize(
    ("model", "kwargs"),
    [
        (Keyframe, {"time_ms": -1, "value": 0.0, "interpolation": Interpolation.STEP}),
        (
            AnimationEvent,
            {"time_ms": -1, "event": "blink"},
        ),
    ],
)
def test_clip_children_reject_negative_times(
    model: type[object], kwargs: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        model(**kwargs)  # type: ignore[operator]


def test_animation_models_reject_coercion_unknown_fields_and_invalid_ids() -> None:
    with pytest.raises(ValidationError):
        Keyframe.model_validate({"time_ms": "0", "value": 1.0, "interpolation": "linear"})
    with pytest.raises(ValidationError):
        AnimationEvent(time_ms=0, event="Foot Contact")
    with pytest.raises(ValidationError):
        AnimationTrack(
            target_type=TargetType.PART,
            target_id="head",
            property=TrackProperty.VISIBLE,
            keys=(),
            unexpected=True,
        )


def test_clip_requires_positive_duration_and_fps() -> None:
    common = {
        "format": "animated-fabric.animation-clip.v1",
        "schema_version": "0.1.0",
        "clip_id": "idle",
        "display_name": "Idle",
        "template_id": "humanoid_v1",
        "loop": True,
    }

    with pytest.raises(ValidationError):
        AnimationClip(**common, duration_ms=0, fps_hint=12)
    with pytest.raises(ValidationError):
        AnimationClip(**common, duration_ms=1000, fps_hint=0)


def test_animation_default_containers_are_independent() -> None:
    first = GeneratorProvenance(generator_id="generator_v1")
    second = GeneratorProvenance(generator_id="generator_v1")

    first.parameters["seed"] = 7

    assert second.parameters == {}
    assert first.parameters is not second.parameters


def test_export_profile_round_trips_normative_json_and_defaults() -> None:
    payload = {
        "profile_id": "default_grid",
        "format": "animated-fabric.grid-spritesheet.v1",
        "animations": ["idle", "walk"],
        "directions": ["SE", "SW", "NE", "NW"],
        "fps": 12,
        "trim_frames": False,
        "include_json": True,
        "allow_clipping": False,
        "include_generated_at": False,
    }

    profile = ExportProfile.model_validate_json(json.dumps(payload))

    assert profile.directions == (Direction.SE, Direction.SW, Direction.NE, Direction.NW)
    assert json.loads(profile.model_dump_json()) == payload


def test_export_profile_is_strict_and_requires_positive_fps() -> None:
    common = {
        "profile_id": "default_grid",
        "format": "animated-fabric.grid-spritesheet.v1",
        "animations": ("idle",),
        "directions": (Direction.SE,),
    }

    with pytest.raises(ValidationError):
        ExportProfile(**common, fps=0)
    with pytest.raises(ValidationError):
        ExportProfile.model_validate({**common, "fps": "12"})
    with pytest.raises(ValidationError):
        ExportProfile(**common, fps=12, extra_field=False)
    with pytest.raises(ValidationError):
        ExportProfile(**{**common, "format": "other"}, fps=12)
