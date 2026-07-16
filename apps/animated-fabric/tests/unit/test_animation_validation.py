"""Tests for animation structural diagnostics."""

from __future__ import annotations

import copy
import json

from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.validation.animation import validate_animation
from animated_fabric.domain.validation.models import AnimationDocument, ValidationCode


def clip_payload() -> dict[str, object]:
    return {
        "format": "animated-fabric.animation-clip.v1",
        "schema_version": "0.1.0",
        "clip_id": "idle",
        "display_name": "Idle",
        "template_id": "humanoid_v1",
        "duration_ms": 1000,
        "loop": True,
        "fps_hint": 12,
        "tracks": [
            {
                "target_type": "bone",
                "target_id": "root",
                "property": "position_y",
                "value_mode": "delta",
                "keys": [
                    {"time_ms": 0, "value": 0.0, "interpolation": "smooth"},
                    {"time_ms": 1000, "value": 1.0, "interpolation": "smooth"},
                ],
            }
        ],
        "events": [{"time_ms": 1000, "event": "blink"}],
        "generator_provenance": None,
    }


def make_document(payload: dict[str, object] | None = None) -> AnimationDocument:
    clip = AnimationClip.model_validate_json(json.dumps(payload or clip_payload()))
    return AnimationDocument(path="animations/idle.animated-clip.json", clip=clip)


def codes(document: AnimationDocument) -> list[str]:
    return [
        item.code
        for item in validate_animation(
            document,
            bone_ids=frozenset({"root"}),
            part_ids=frozenset({"body"}),
        )
    ]


def test_valid_animation_has_no_structural_diagnostics() -> None:
    assert codes(make_document()) == []


def test_track_target_time_order_and_duplicate_rules_are_reported_together() -> None:
    payload = clip_payload()
    tracks = payload["tracks"]
    assert isinstance(tracks, list)
    track = tracks[0]
    assert isinstance(track, dict)
    track["target_id"] = "missing"
    track["keys"] = [
        {"time_ms": 500, "value": 0.0, "interpolation": "linear"},
        {"time_ms": 1200, "value": 1.0, "interpolation": "linear"},
        {"time_ms": 500, "value": 2.0, "interpolation": "linear"},
    ]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [
        ValidationCode.TRACK_TARGET_MISSING,
        ValidationCode.KEY_OUTSIDE_DURATION,
        ValidationCode.DUPLICATE_KEY,
        ValidationCode.KEYS_UNORDERED,
    ]
    assert diagnostics[0].location == "tracks[0].target_id"
    assert diagnostics[1].location == "tracks[0].keys[1].time_ms"


def test_empty_clip_and_late_event_are_warnings() -> None:
    payload = clip_payload()
    payload["tracks"] = []
    payload["events"] = [{"time_ms": 1001, "event": "blink"}]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [
        ValidationCode.CLIP_WITHOUT_TRACKS,
        ValidationCode.EVENT_OUTSIDE_RANGE,
    ]
    assert all(item.severity.value == "warning" for item in diagnostics)


def test_incompatible_target_property_is_reported_once_for_the_track() -> None:
    payload = clip_payload()
    tracks = payload["tracks"]
    assert isinstance(tracks, list)
    track = tracks[0]
    assert isinstance(track, dict)
    track["property"] = "visible"
    track["keys"] = [{"time_ms": 0, "value": True, "interpolation": "step"}]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID]
    assert diagnostics[0].location == "tracks[0].property"


def test_part_value_types_ranges_and_visible_interpolation_are_validated() -> None:
    payload = clip_payload()
    payload["tracks"] = [
        {
            "target_type": "part",
            "target_id": "body",
            "property": "opacity",
            "value_mode": "absolute",
            "keys": [{"time_ms": 0, "value": 1.5, "interpolation": "linear"}],
        },
        {
            "target_type": "part",
            "target_id": "body",
            "property": "visible",
            "value_mode": "absolute",
            "keys": [{"time_ms": 0, "value": 1, "interpolation": "smooth"}],
        },
        {
            "target_type": "part",
            "target_id": "body",
            "property": "z_bias",
            "value_mode": "delta",
            "keys": [{"time_ms": 0, "value": 0.5, "interpolation": "step"}],
        },
    ]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID] * 4
    assert [item.location for item in diagnostics] == [
        "tracks[0].keys[0].value",
        "tracks[1].keys[0].interpolation",
        "tracks[1].keys[0].value",
        "tracks[2].keys[0].value",
    ]


def test_visible_and_z_bias_keys_require_step_interpolation() -> None:
    payload = clip_payload()
    payload["tracks"] = [
        {
            "target_type": "part",
            "target_id": "body",
            "property": "visible",
            "value_mode": "absolute",
            "keys": [{"time_ms": 0, "value": True, "interpolation": "smooth"}],
        },
        {
            "target_type": "part",
            "target_id": "body",
            "property": "z_bias",
            "value_mode": "delta",
            "keys": [{"time_ms": 0, "value": 1, "interpolation": "linear"}],
        },
    ]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID] * 2
    assert [item.location for item in diagnostics] == [
        "tracks[0].keys[0].interpolation",
        "tracks[1].keys[0].interpolation",
    ]
    assert [item.message for item in diagnostics] == [
        "Visible tracks require step interpolation.",
        "Z-bias tracks require step interpolation.",
    ]


def test_repeated_track_channels_after_the_first_are_invalid() -> None:
    payload = clip_payload()
    tracks = payload["tracks"]
    assert isinstance(tracks, list)
    original = tracks[0]
    assert isinstance(original, dict)
    position_x = copy.deepcopy(original)
    position_x["property"] = "position_x"
    payload["tracks"] = [
        original,
        copy.deepcopy(original),
        position_x,
        copy.deepcopy(original),
    ]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID] * 2
    assert [item.location for item in diagnostics] == [
        "tracks[1].property",
        "tracks[3].property",
    ]
    assert all(
        item.message == "Track repeats channel 'bone:root:position_y'." for item in diagnostics
    )


def test_negative_opacity_delta_is_valid_but_out_of_range_absolute_value_is_not() -> None:
    payload = clip_payload()
    payload["tracks"] = [
        {
            "target_type": "part",
            "target_id": "body",
            "property": "opacity",
            "value_mode": "delta",
            "keys": [{"time_ms": 0, "value": -0.25, "interpolation": "linear"}],
        },
        {
            "target_type": "part",
            "target_id": "cape",
            "property": "opacity",
            "value_mode": "absolute",
            "keys": [{"time_ms": 0, "value": -0.25, "interpolation": "linear"}],
        },
    ]

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body", "cape"}),
    )

    assert [item.code for item in diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID]
    assert diagnostics[0].location == "tracks[1].keys[0].value"


def test_unrepresentable_integer_value_is_an_invalid_animation_channel() -> None:
    payload = clip_payload()
    tracks = payload["tracks"]
    assert isinstance(tracks, list)
    track = tracks[0]
    assert isinstance(track, dict)
    keys = track["keys"]
    assert isinstance(keys, list)
    key = keys[0]
    assert isinstance(key, dict)
    key["value"] = 10**1000

    diagnostics = validate_animation(
        make_document(payload),
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert [item.code for item in diagnostics] == [ValidationCode.TRACK_CHANNEL_INVALID]
    assert diagnostics[0].location == "tracks[0].keys[0].value"


def test_validation_does_not_mutate_key_or_event_order() -> None:
    payload = clip_payload()
    before = copy.deepcopy(payload)
    document = make_document(payload)

    validate_animation(
        document,
        bone_ids=frozenset({"root"}),
        part_ids=frozenset({"body"}),
    )

    assert document.clip.model_dump(mode="json") == before
