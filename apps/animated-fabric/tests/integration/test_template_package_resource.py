"""Integration coverage for the packaged humanoid rig template."""

from __future__ import annotations

import json
from importlib.resources import files
from pathlib import Path

import pytest

from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.templates import JsonRigTemplateRegistry

EXPECTED_BONES = (
    ("root", None),
    ("pelvis", "root"),
    ("torso", "pelvis"),
    ("neck", "torso"),
    ("head", "neck"),
    ("upper_arm_l", "torso"),
    ("lower_arm_l", "upper_arm_l"),
    ("hand_l", "lower_arm_l"),
    ("upper_arm_r", "torso"),
    ("lower_arm_r", "upper_arm_r"),
    ("hand_r", "lower_arm_r"),
    ("thigh_l", "pelvis"),
    ("shin_l", "thigh_l"),
    ("foot_l", "shin_l"),
    ("thigh_r", "pelvis"),
    ("shin_r", "thigh_r"),
    ("foot_r", "shin_r"),
)
EXPECTED_REQUIRED_PARTS = (
    "torso",
    "head",
    "upper_arm_l",
    "lower_arm_l",
    "hand_l",
    "upper_arm_r",
    "lower_arm_r",
    "hand_r",
    "thigh_l",
    "shin_l",
    "foot_l",
    "thigh_r",
    "shin_r",
    "foot_r",
)
EXPECTED_OPTIONAL_PARTS = (
    "pelvis_visual",
    "neck_visual",
    "hair_back",
    "hair_front",
    "cape",
    "ground_shadow",
)
EXPECTED_SOCKETS = (
    "head_hat",
    "head_face",
    "back_cape",
    "hand_l_item",
    "hand_r_weapon",
    "hand_l_shield",
    "waist_item",
    "root_shadow",
)
EXPECTED_PART_BONES = (
    ("torso", "torso"),
    ("head", "head"),
    ("upper_arm_l", "upper_arm_l"),
    ("lower_arm_l", "lower_arm_l"),
    ("hand_l", "hand_l"),
    ("upper_arm_r", "upper_arm_r"),
    ("lower_arm_r", "lower_arm_r"),
    ("hand_r", "hand_r"),
    ("thigh_l", "thigh_l"),
    ("shin_l", "shin_l"),
    ("foot_l", "foot_l"),
    ("thigh_r", "thigh_r"),
    ("shin_r", "shin_r"),
    ("foot_r", "foot_r"),
    ("pelvis_visual", "pelvis"),
    ("neck_visual", "neck"),
    ("hair_back", "head"),
    ("hair_front", "head"),
    ("cape", "torso"),
    ("ground_shadow", "root"),
)
EXPECTED_SOCKET_DEFAULTS = {
    "head_hat": ("head", "hair_front"),
    "head_face": ("head", "fx_front"),
    "back_cape": ("torso", "cape_back"),
    "hand_l_item": ("hand_l", "weapon_front"),
    "hand_r_weapon": ("hand_r", "weapon_front"),
    "hand_l_shield": ("hand_l", "shield_front"),
    "waist_item": ("pelvis", "torso"),
    "root_shadow": ("root", "ground_shadow"),
}
EXPECTED_DRAW_SLOTS = (
    "ground_shadow",
    "cape_back",
    "weapon_back",
    "leg_far",
    "leg_near",
    "body_back",
    "torso",
    "arm_far",
    "head_back",
    "head",
    "hair_front",
    "arm_near",
    "shield_front",
    "weapon_front",
    "fx_front",
)


def test_packaged_humanoid_template_matches_the_normative_anatomy() -> None:
    registry = JsonRigTemplateRegistry()

    assert tuple(summary.template_id for summary in registry.list_templates()) == ("humanoid_v1",)
    template = registry.get("humanoid_v1")
    assert tuple((bone.bone_id, bone.parent_id) for bone in template.bones) == EXPECTED_BONES
    assert tuple(part.part_id for part in template.required_parts) == EXPECTED_REQUIRED_PARTS
    assert tuple(part.part_id for part in template.optional_parts) == EXPECTED_OPTIONAL_PARTS
    assert (
        tuple(
            (part.part_id, part.bone_id)
            for part in (*template.required_parts, *template.optional_parts)
        )
        == EXPECTED_PART_BONES
    )
    assert tuple(socket.socket_id for socket in template.default_sockets) == EXPECTED_SOCKETS
    assert {
        socket.socket_id: (socket.bone_id, socket.default_draw_slot)
        for socket in template.default_sockets
    } == EXPECTED_SOCKET_DEFAULTS
    assert template.draw_slots == EXPECTED_DRAW_SLOTS
    assert template.compatible_generators == (
        "humanoid_idle_v1",
        "humanoid_walk_v1",
    )


def test_packaged_humanoid_template_contains_the_normative_alias_groups() -> None:
    template = JsonRigTemplateRegistry().get("humanoid_v1")
    aliases = {group.canonical_part: group.aliases for group in template.import_aliases}

    assert aliases == {
        "upper_arm_l": ("left_upper_arm", "arm_l_upper", "l_upper_arm"),
        "lower_arm_l": ("left_forearm", "forearm_l", "l_lower_arm"),
        "thigh_r": ("right_thigh", "upper_leg_r", "r_upper_leg"),
        "foot_r": ("right_foot", "r_foot"),
    }


def test_packaged_humanoid_template_declares_reference_limits_and_defaults() -> None:
    template = JsonRigTemplateRegistry().get("humanoid_v1")
    limits = {limit.value_id: (limit.minimum, limit.maximum) for limit in template.limits}
    initial_values = {initial.value_id: initial.value for initial in template.initial_values}

    assert limits == {
        "canvas_width_px": (1.0, 2048.0),
        "canvas_height_px": (1.0, 2048.0),
        "ground_anchor_x_px": (0.0, 2048.0),
        "ground_anchor_y_px": (0.0, 2048.0),
        "joint_overlap_px": (6.0, 12.0),
    }
    assert initial_values == {
        "canvas_width_px": 192.0,
        "canvas_height_px": 192.0,
        "ground_anchor_x_px": 96.0,
        "ground_anchor_y_px": 160.0,
        "joint_overlap_px": 8.0,
    }


def test_packaged_resource_is_canonical_utf8_json() -> None:
    resource = files("animated_fabric.templates.resources").joinpath("humanoid_v1.json")
    raw = resource.read_bytes()
    document = json.loads(raw)
    expected = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode()

    assert raw == expected
    assert raw.endswith(b"\n") and not raw.endswith(b"\n\n")
    assert b"\r" not in raw
    assert not raw.startswith(b"\xef\xbb\xbf")


def test_registry_loads_independently_of_the_current_working_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)

    registry = JsonRigTemplateRegistry()

    assert registry.get("humanoid_v1").template_id == "humanoid_v1"


def test_quadruped_is_not_published_before_af_080() -> None:
    registry = JsonRigTemplateRegistry()

    with pytest.raises(RigDefinitionError, match="Unknown rig template ID"):
        registry.get("quadruped_v1")
