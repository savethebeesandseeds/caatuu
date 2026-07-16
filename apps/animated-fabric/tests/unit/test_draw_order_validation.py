"""Tests for draw-slot diagnostics and stable ordering."""

from __future__ import annotations

import json

from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation.draw_order import resolve_draw_order, validate_draw_order
from animated_fabric.domain.validation.models import ValidationCode, ValidationInput


def make_manifest() -> ProjectManifest:
    payload = {
        "format": "animated-fabric.project.v1",
        "schema_version": "0.1.0",
        "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
        "slug": "eva_mage",
        "display_name": "Eva",
        "template_id": "humanoid_v1",
        "canvas": {
            "width": 192,
            "height": 192,
            "ground_anchor": [96.0, 160.0],
            "pixel_snap": "none",
        },
        "directions": {
            "SE": {"mode": "authored"},
            "SW": {"mode": "mirror", "source": "SE"},
            "NE": {"mode": "authored"},
            "NW": {"mode": "mirror", "source": "NE"},
        },
        "rig_path": "rig/main.animated-rig.json",
        "animation_paths": [],
        "export_profiles": [],
        "selection_ellipse": {
            "center_offset": [0.0, -2.0],
            "radius_x": 20.0,
            "radius_y": 9.0,
        },
    }
    return ProjectManifest.model_validate_json(json.dumps(payload))


def make_rig(
    *,
    parts: list[dict[str, object]] | None = None,
    sockets: list[dict[str, object]] | None = None,
    direction_profiles: dict[str, object] | None = None,
    draw_slot_profiles: dict[str, object] | None = None,
) -> RigDefinition:
    payload = {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "main",
        "template_id": "humanoid_v1",
        "bones": [{"bone_id": "root"}],
        "parts": parts or [],
        "sockets": sockets or [],
        "direction_profiles": direction_profiles or {},
        "draw_slot_profiles": draw_slot_profiles or {"SE": [], "NE": []},
    }
    return RigDefinition.model_validate_json(json.dumps(payload))


def part(part_id: str, draw_slot: str, slot_order: int = 0) -> dict[str, object]:
    return {
        "part_id": part_id,
        "semantic_part": part_id,
        "bone_id": "root",
        "draw_slot": draw_slot,
        "slot_order": slot_order,
    }


def test_draw_order_uses_slot_then_direction_override_then_part_id() -> None:
    rig = make_rig(
        parts=[part("front", "front"), part("back_b", "back"), part("back_a", "back")],
        direction_profiles={"SE": {"slot_order": {"back_b": -1}}},
        draw_slot_profiles={"SE": ["back", "front"], "NE": ["back", "front"]},
    )

    assert resolve_draw_order(rig, Direction.SE) == (
        "back_b",
        "back_a",
        "front",
    )


def test_missing_profile_and_unknown_slot_have_distinct_codes() -> None:
    rig = make_rig(
        parts=[part("body", "body")],
        draw_slot_profiles={"SE": ["other"]},
    )

    diagnostics = validate_draw_order(ValidationInput(manifest=make_manifest(), rig=rig))

    assert [item.code for item in diagnostics] == [
        ValidationCode.UNKNOWN_DRAW_SLOT,
        ValidationCode.VISIBLE_PART_WITHOUT_ORDER,
    ]
    assert diagnostics[0].message.startswith("Part 'body'")
    assert "NE" in diagnostics[1].message


def test_direction_visibility_override_skips_hidden_part() -> None:
    rig = make_rig(
        parts=[part("body", "body")],
        direction_profiles={"NE": {"part_visibility": {"body": False}}},
        draw_slot_profiles={"SE": ["body"]},
    )

    assert validate_draw_order(ValidationInput(manifest=make_manifest(), rig=rig)) == ()


def test_duplicate_slot_unknown_socket_and_unused_socket_are_reported() -> None:
    rig = make_rig(
        sockets=[
            {
                "socket_id": "hand_weapon",
                "bone_id": "root",
                "default_draw_slot": "weapon_front",
            }
        ],
        draw_slot_profiles={"SE": ["body", "body"], "NE": ["body"]},
    )

    diagnostics = validate_draw_order(
        ValidationInput(
            manifest=make_manifest(),
            rig=rig,
            used_socket_ids=frozenset(),
        )
    )

    assert [item.code for item in diagnostics] == [
        ValidationCode.UNKNOWN_DRAW_SLOT,
        ValidationCode.UNUSED_SOCKET,
        ValidationCode.DUPLICATE_DRAW_SLOT,
    ]


def test_socket_usage_warning_is_skipped_when_equipment_context_is_unavailable() -> None:
    rig = make_rig(
        sockets=[
            {
                "socket_id": "hand_weapon",
                "bone_id": "root",
                "default_draw_slot": "weapon_front",
            }
        ],
        draw_slot_profiles={"SE": ["weapon_front"], "NE": ["weapon_front"]},
    )

    assert validate_draw_order(ValidationInput(manifest=make_manifest(), rig=rig)) == ()
