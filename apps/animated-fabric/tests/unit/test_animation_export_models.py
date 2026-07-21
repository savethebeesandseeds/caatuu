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
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind
from animated_fabric.domain.export import (
    FRAME_SEQUENCE_FORMAT,
    FRAME_SEQUENCE_SCHEMA_VERSION,
    ExportProfile,
    FrameSequenceFrame,
    FrameSequenceMetadata,
)
from animated_fabric.domain.geometry import IntSize, Vec2
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


def _frame_metadata(
    *,
    directions: tuple[Direction, ...] = (Direction.SE, Direction.NE),
    frames: tuple[FrameSequenceFrame, ...] | None = None,
) -> FrameSequenceMetadata:
    if frames is None:
        frames = tuple(
            FrameSequenceFrame(
                direction=direction,
                index=index,
                image=f"{direction.value}/{index:03d}.png",
                duration_ms=(2, 3)[index],
                events=("foot_contact_l",) if index == 0 else (),
            )
            for direction in directions
            for index in range(2)
        )
    return FrameSequenceMetadata(
        format=FRAME_SEQUENCE_FORMAT,
        schema_version=FRAME_SEQUENCE_SCHEMA_VERSION,
        project="eva_mage",
        animation="walk",
        frame_size=IntSize(width=192, height=192),
        origin=Vec2(x=96.0, y=160.0),
        fps=12,
        duration_ms=5,
        directions=directions,
        frames_per_direction=2,
        frames=frames,
    )


def test_frame_sequence_metadata_round_trips_versioned_json() -> None:
    metadata = _frame_metadata()

    restored = FrameSequenceMetadata.model_validate_json(metadata.model_dump_json())

    assert restored == metadata
    assert json.loads(restored.model_dump_json()) == {
        "format": "animated-fabric.frame-sequence.v1",
        "schema_version": "0.1.0",
        "project": "eva_mage",
        "animation": "walk",
        "frame_size": [192, 192],
        "origin": [96.0, 160.0],
        "fps": 12,
        "duration_ms": 5,
        "directions": ["SE", "NE"],
        "frames_per_direction": 2,
        "frames": [
            {
                "direction": direction,
                "index": index,
                "image": f"{direction}/{index:03d}.png",
                "duration_ms": (2, 3)[index],
                "events": ["foot_contact_l"] if index == 0 else [],
            }
            for direction in ("SE", "NE")
            for index in range(2)
        ],
    }


def test_frame_sequence_metadata_rejects_duplicate_directions() -> None:
    with pytest.raises(ValidationError, match="duplicates"):
        _frame_metadata(directions=(Direction.SE, Direction.SE))


def test_frame_sequence_metadata_requires_exact_frame_count() -> None:
    valid = _frame_metadata()

    with pytest.raises(ValidationError, match="exactly 4"):
        FrameSequenceMetadata.model_validate(valid.model_dump() | {"frames": valid.frames[:-1]})


@pytest.mark.parametrize(
    ("replacement", "message"),
    [
        (
            FrameSequenceFrame(
                direction=Direction.NE,
                index=0,
                image="NE/000.png",
                duration_ms=2,
            ),
            "direction-major",
        ),
        (
            FrameSequenceFrame(
                direction=Direction.SE,
                index=0,
                image="SE/wrong.png",
                duration_ms=2,
            ),
            "canonical path",
        ),
        (
            FrameSequenceFrame(
                direction=Direction.SE,
                index=0,
                image="SE/000.png",
                duration_ms=1,
            ),
            "sum exactly",
        ),
    ],
)
def test_frame_sequence_metadata_rejects_inconsistent_frame_records(
    replacement: FrameSequenceFrame,
    message: str,
) -> None:
    valid = _frame_metadata()
    frames = (replacement, *valid.frames[1:])

    with pytest.raises(ValidationError, match=message):
        FrameSequenceMetadata.model_validate(valid.model_dump() | {"frames": frames})


def test_frame_sequence_metadata_rejects_wrong_format_schema_and_invalid_event() -> None:
    valid = _frame_metadata()

    with pytest.raises(ValidationError):
        FrameSequenceMetadata.model_validate(valid.model_dump() | {"format": "other"})
    with pytest.raises(ValidationError):
        FrameSequenceMetadata.model_validate(valid.model_dump() | {"schema_version": "0.2.0"})
    with pytest.raises(ValidationError):
        FrameSequenceFrame(
            direction=Direction.SE,
            index=0,
            image="SE/000.png",
            duration_ms=1,
            events=("Foot Contact",),
        )


def test_export_error_preserves_message_and_typed_context() -> None:
    error = ExportError(
        "The frame touched the canvas edge.",
        kind=ExportFailureKind.CLIPPING,
        path="walk/SE/000.png",
        location="right",
    )

    assert str(error) == "The frame touched the canvas edge."
    assert error.args == ("The frame touched the canvas edge.",)
    assert error.kind is ExportFailureKind.CLIPPING
    assert error.path == "walk/SE/000.png"
    assert error.location == "right"
