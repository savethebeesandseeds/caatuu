"""Unit tests for AF-040 safe animation-clip construction."""

from __future__ import annotations

import sys

from animated_fabric.application.animation_clip_builder import (
    ANIMATION_BUILD_FAILURE_CODE,
    AnimationClipBuilder,
    AnimationClipBuildRequest,
)
from animated_fabric.domain._base import JsonValue
from animated_fabric.domain.animation import (
    AnimationEvent,
    AnimationTrack,
    AnimationValue,
    GeneratorProvenance,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.interpolation import evaluate_track
from animated_fabric.domain.rig import BoneDefinition, PartBinding, RigDefinition
from animated_fabric.domain.validation import ValidationCode


def _rig() -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id="humanoid_v1",
        bones=(BoneDefinition(bone_id="root"),),
        parts=(
            PartBinding(
                part_id="body",
                semantic_part="torso",
                bone_id="root",
                draw_slot="torso",
            ),
        ),
    )


def _key(
    time_ms: int,
    value: AnimationValue,
    interpolation: Interpolation = Interpolation.LINEAR,
) -> Keyframe:
    return Keyframe(time_ms=time_ms, value=value, interpolation=interpolation)


def _track(
    *keys: Keyframe,
    target_type: TargetType = TargetType.BONE,
    target_id: str = "root",
    property: TrackProperty = TrackProperty.POSITION_X,
    value_mode: ValueMode = ValueMode.DELTA,
) -> AnimationTrack:
    return AnimationTrack(
        target_type=target_type,
        target_id=target_id,
        property=property,
        value_mode=value_mode,
        keys=keys,
    )


def _request(**updates: object) -> AnimationClipBuildRequest:
    arguments: dict[str, object] = {
        "rig": _rig(),
        "diagnostic_path": "animations/probe.animated-clip.json",
        "clip_id": "probe",
        "display_name": "Probe",
        "duration_ms": 1000,
        "loop": True,
        "fps_hint": 12,
        "tracks": (_track(_key(0, 0.0), _key(500, 10.0)),),
    }
    arguments.update(updates)
    return AnimationClipBuildRequest(**arguments)  # type: ignore[arg-type]


def _build(request: AnimationClipBuildRequest):
    return AnimationClipBuilder().build(request)


def test_invalid_metadata_maps_to_one_actionable_afb001() -> None:
    result = _build(_request(duration_ms=0))

    assert result.value is None
    assert len(result.diagnostics) == 1
    diagnostic = result.diagnostics[0]
    assert diagnostic.code == ANIMATION_BUILD_FAILURE_CODE
    assert diagnostic.path == "animations/probe.animated-clip.json"
    assert diagnostic.location == "clip"
    assert "duration_ms" in diagnostic.message
    assert "input_value" not in diagnostic.message
    assert "pydantic.dev" not in diagnostic.message
    assert len(diagnostic.message) <= 160
    assert diagnostic.suggestion is not None


def test_builder_stably_sorts_keys_preserves_tracks_and_detaches_every_child() -> None:
    first = _track(
        _key(500, 5.0, Interpolation.SMOOTH),
        _key(0, 0.0, Interpolation.LINEAR),
        _key(250, 2.5, Interpolation.STEP),
    )
    second = _track(
        _key(300, 0.4),
        _key(0, 0.8),
        target_type=TargetType.PART,
        target_id="body",
        property=TrackProperty.OPACITY,
        value_mode=ValueMode.ABSOLUTE,
    )
    before = (first.model_dump(mode="json"), second.model_dump(mode="json"))

    result = _build(_request(loop=False, tracks=(first, second)))

    assert result.value is not None, result.diagnostics
    assert result.value.tracks == (
        _track(
            _key(0, 0.0, Interpolation.LINEAR),
            _key(250, 2.5, Interpolation.STEP),
            _key(500, 5.0, Interpolation.SMOOTH),
        ),
        _track(
            _key(0, 0.8),
            _key(300, 0.4),
            target_type=TargetType.PART,
            target_id="body",
            property=TrackProperty.OPACITY,
            value_mode=ValueMode.ABSOLUTE,
        ),
    )
    assert (first.model_dump(mode="json"), second.model_dump(mode="json")) == before
    assert result.value.tracks[0] is not first
    assert result.value.tracks[0].keys[0] is not first.keys[1]


def test_loop_endpoint_is_synthesized_from_first_key_and_evaluates_periodically() -> None:
    track = _track(
        _key(0, 0.0, Interpolation.LINEAR),
        _key(500, 10.0, Interpolation.SMOOTH),
    )

    result = _build(_request(tracks=(track,)))

    assert result.value is not None, result.diagnostics
    built_track = result.value.tracks[0]
    assert built_track.keys[-1] == _key(1000, 0.0, Interpolation.LINEAR)
    assert evaluate_track(built_track, 625.0, 1000, loop=True) == 8.4375
    assert evaluate_track(built_track, 1000.0, 1000, loop=True) == 0.0


def test_explicit_loop_endpoint_is_preserved_without_replacement() -> None:
    explicit = _key(1000, 99.0, Interpolation.STEP)
    track = _track(_key(0, 1.0), explicit)

    result = _build(_request(tracks=(track,)))

    assert result.value is not None, result.diagnostics
    assert result.value.tracks[0].keys == (_key(0, 1.0), explicit)
    assert result.value.tracks[0].keys[-1] is not explicit


def test_non_looping_track_does_not_receive_an_endpoint() -> None:
    track = _track(_key(0, 1.0), _key(400, 2.0))

    result = _build(_request(loop=False, tracks=(track,)))

    assert result.value is not None, result.diagnostics
    assert [key.time_ms for key in result.value.tracks[0].keys] == [0, 400]


def test_key_beyond_duration_is_not_hidden_by_endpoint_synthesis() -> None:
    track = _track(_key(0, 1.0), _key(1001, 2.0))

    result = _build(_request(tracks=(track,)))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ValidationCode.KEY_OUTSIDE_DURATION]


def test_duplicate_keys_are_reported_after_stable_normalization() -> None:
    track = _track(_key(500, 1.0), _key(0, 0.0), _key(500, 2.0))

    result = _build(_request(tracks=(track,)))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ValidationCode.DUPLICATE_KEY]
    assert result.diagnostics[0].location == "tracks[0].keys[2].time_ms"


def test_missing_track_target_uses_existing_afv301() -> None:
    result = _build(
        _request(
            tracks=(
                _track(
                    _key(0, 0.0),
                    target_id="missing",
                ),
            )
        )
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ValidationCode.TRACK_TARGET_MISSING]


def test_repeated_channel_uses_existing_afv307() -> None:
    first = _track(_key(0, 0.0))
    repeated = _track(_key(0, 1.0))

    result = _build(_request(tracks=(first, repeated)))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID]
    assert result.diagnostics[0].location == "tracks[1].property"


def test_incompatible_channel_and_value_use_existing_afv307() -> None:
    incompatible = _track(
        _key(0, True, Interpolation.STEP),
        property=TrackProperty.VISIBLE,
    )
    invalid_value = _track(
        _key(0, False, Interpolation.STEP),
        property=TrackProperty.POSITION_Y,
    )

    result = _build(_request(tracks=(incompatible, invalid_value)))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [
        ValidationCode.TRACK_CHANNEL_INVALID,
        ValidationCode.TRACK_CHANNEL_INVALID,
    ]
    assert [item.location for item in result.diagnostics] == [
        "tracks[0].property",
        "tracks[1].keys[0].value",
    ]


def test_empty_clip_and_late_event_return_a_value_with_existing_warnings() -> None:
    result = _build(
        _request(
            tracks=(),
            events=(AnimationEvent(time_ms=1001, event="blink"),),
        )
    )

    assert result.value is not None
    assert [item.code for item in result.diagnostics] == [
        ValidationCode.CLIP_WITHOUT_TRACKS,
        ValidationCode.EVENT_OUTSIDE_RANGE,
    ]
    assert all(item.severity.value == "warning" for item in result.diagnostics)


def test_events_are_stably_sorted_while_ties_and_duplicates_are_preserved() -> None:
    first_tied = AnimationEvent(time_ms=500, event="foot_contact_l")
    second_tied = AnimationEvent(time_ms=500, event="attack_hit")
    duplicate = AnimationEvent(time_ms=500, event="foot_contact_l")
    events = (
        first_tied,
        AnimationEvent(time_ms=0, event="blink"),
        second_tied,
        duplicate,
    )

    result = _build(_request(events=events))

    assert result.value is not None, result.diagnostics
    assert [(event.time_ms, event.event) for event in result.value.events] == [
        (0, "blink"),
        (500, "foot_contact_l"),
        (500, "attack_hit"),
        (500, "foot_contact_l"),
    ]
    assert result.value.events[1] is not first_tied
    assert result.value.events[3] is not duplicate


def test_event_at_loop_duration_is_preserved_and_not_rewritten_to_zero() -> None:
    events = (
        AnimationEvent(time_ms=1000, event="attack_hit"),
        AnimationEvent(time_ms=0, event="blink"),
    )

    result = _build(_request(events=events))

    assert result.value is not None, result.diagnostics
    assert [(event.time_ms, event.event) for event in result.value.events] == [
        (0, "blink"),
        (1000, "attack_hit"),
    ]


def test_generator_provenance_is_deeply_detached_and_maps_are_canonicalized() -> None:
    provenance = GeneratorProvenance(
        generator_id="probe_generator_v1",
        parameters={
            "zeta": {"samples": [1, 2], "enabled": True},
            "alpha": 0.5,
        },
    )

    result = _build(_request(generator_provenance=provenance))

    assert result.value is not None, result.diagnostics
    built = result.value.generator_provenance
    assert built is not None
    assert tuple(built.parameters) == ("alpha", "zeta")
    source_nested = provenance.parameters["zeta"]
    built_nested = built.parameters["zeta"]
    assert isinstance(source_nested, dict)
    assert isinstance(built_nested, dict)
    assert built_nested is not source_nested
    source_samples = source_nested["samples"]
    built_samples = built_nested["samples"]
    assert isinstance(source_samples, list)
    assert isinstance(built_samples, list)
    assert built_samples is not source_samples
    source_samples.append(3)
    assert built_samples == [1, 2]


def test_invalid_mutated_provenance_maps_to_afb001_construction_failure() -> None:
    provenance = GeneratorProvenance(generator_id="probe_generator_v1")
    provenance.parameters["invalid"] = float("inf")

    result = _build(_request(generator_provenance=provenance))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_BUILD_FAILURE_CODE]


def test_mutated_provenance_validation_failure_does_not_echo_submitted_value() -> None:
    provenance = GeneratorProvenance(generator_id="probe_generator_v1")
    provenance.parameters["invalid"] = b"sensitive_value"  # type: ignore[assignment]

    result = _build(_request(generator_provenance=provenance))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_BUILD_FAILURE_CODE]
    message = result.diagnostics[0].message
    assert "parameters" in message
    assert "sensitive_value" not in message
    assert "input_value" not in message
    assert "pydantic.dev" not in message
    assert len(message) <= 160


def test_cyclic_mutated_provenance_maps_to_afb001_instead_of_recursing() -> None:
    provenance = GeneratorProvenance(generator_id="probe_generator_v1")
    provenance.parameters["cycle"] = provenance.parameters  # type: ignore[assignment]

    result = _build(_request(generator_provenance=provenance))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_BUILD_FAILURE_CODE]
    assert "must not contain cycles" in result.diagnostics[0].message


def test_deep_acyclic_mutated_provenance_maps_recursion_to_afb001() -> None:
    provenance = GeneratorProvenance(generator_id="probe_generator_v1")
    cursor = provenance.parameters
    for _ in range(sys.getrecursionlimit() + 100):
        child: dict[str, JsonValue] = {}
        cursor["next"] = child
        cursor = child

    result = _build(_request(generator_provenance=provenance))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_BUILD_FAILURE_CODE]
    assert "Generator provenance parameter nesting is too deep" in result.diagnostics[0].message
    assert "maximum recursion depth" not in result.diagnostics[0].message


def test_semantically_equal_inputs_produce_identical_normalized_json() -> None:
    first_provenance = GeneratorProvenance(
        generator_id="probe_generator_v1",
        parameters={"zeta": {"b": 2, "a": 1}, "alpha": [3, 4]},
    )
    second_provenance = GeneratorProvenance(
        generator_id="probe_generator_v1",
        parameters={"alpha": [3, 4], "zeta": {"a": 1, "b": 2}},
    )
    forward_track = _track(_key(0, 0.0), _key(500, 10.0))
    reverse_track = _track(_key(500, 10.0), _key(0, 0.0))
    forward_events = (
        AnimationEvent(time_ms=0, event="blink"),
        AnimationEvent(time_ms=500, event="foot_contact_l"),
    )
    reverse_events = tuple(reversed(forward_events))

    first = _build(
        _request(
            tracks=(forward_track,),
            events=forward_events,
            generator_provenance=first_provenance,
        )
    )
    second = _build(
        _request(
            tracks=(reverse_track,),
            events=reverse_events,
            generator_provenance=second_provenance,
        )
    )

    assert first.value is not None, first.diagnostics
    assert second.value is not None, second.diagnostics
    assert first.value.model_dump_json() == second.value.model_dump_json()
    assert first.value.format == "animated-fabric.animation-clip.v1"
    assert first.value.schema_version == "0.1.0"
    assert first.value.template_id == "humanoid_v1"
