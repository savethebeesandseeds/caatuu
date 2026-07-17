"""Tests for strict, relational rig-template data contracts."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable

import pytest
from pydantic import ValidationError

from animated_fabric.domain.templates import RigTemplate


def template_payload() -> dict[str, object]:
    """Return a small valid template document for focused mutations."""
    return {
        "format": "animated-fabric.rig-template.v1",
        "schema_version": "0.1.0",
        "template_id": "test_template",
        "display_name": "Test Template",
        "bones": [
            {"bone_id": "root", "parent_id": None},
            {"bone_id": "torso", "parent_id": "root"},
        ],
        "required_parts": [{"part_id": "torso", "bone_id": "torso"}],
        "optional_parts": [{"part_id": "cape", "bone_id": "torso"}],
        "import_aliases": [
            {"canonical_part": "torso", "aliases": ["body_torso"]},
        ],
        "default_sockets": [
            {
                "socket_id": "back_cape",
                "bone_id": "torso",
                "default_draw_slot": "cape_back",
            }
        ],
        "draw_slots": ["cape_back", "torso"],
        "compatible_generators": ["test_idle_v1"],
        "limits": [{"value_id": "canvas_width_px", "minimum": 1.0, "maximum": 2048.0}],
        "initial_values": [{"value_id": "canvas_width_px", "value": 192.0}],
    }


def parse_template(payload: dict[str, object]) -> RigTemplate:
    return RigTemplate.model_validate_json(json.dumps(payload))


def test_template_round_trips_the_declared_json_shape() -> None:
    payload = template_payload()

    template = parse_template(payload)

    assert template.model_dump(mode="json") == payload
    assert RigTemplate.model_validate_json(template.model_dump_json()) == template


def test_template_and_nested_records_are_immutable() -> None:
    template = parse_template(template_payload())

    with pytest.raises(ValidationError, match="frozen"):
        template.display_name = "Changed"
    with pytest.raises(ValidationError, match="frozen"):
        template.bones[0].bone_id = "changed"
    assert isinstance(template.bones, tuple)
    assert isinstance(template.import_aliases[0].aliases, tuple)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("format", "animated-fabric.rig.v1"),
        ("schema_version", "0.2.0"),
        ("schema_version", "0.1.1-alpha.1"),
        ("template_id", "Humanoid"),
        ("display_name", " Humanoid"),
        ("display_name", "Humanoid\nTemplate"),
    ],
)
def test_template_rejects_invalid_identity_and_labels(field: str, value: object) -> None:
    payload = template_payload()
    payload[field] = value

    with pytest.raises(ValidationError):
        parse_template(payload)


def test_template_rejects_unknown_fields_and_type_coercion() -> None:
    payload = template_payload()
    payload["module"] = "untrusted.template"

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        parse_template(payload)

    payload = template_payload()
    limits = payload["limits"]
    assert isinstance(limits, list)
    limits[0]["maximum"] = "2048"
    with pytest.raises(ValidationError):
        parse_template(payload)


def duplicate_bone(payload: dict[str, object]) -> None:
    bones = payload["bones"]
    assert isinstance(bones, list)
    bones.append(copy.deepcopy(bones[1]))


def missing_parent(payload: dict[str, object]) -> None:
    bones = payload["bones"]
    assert isinstance(bones, list)
    bones[1]["parent_id"] = "missing"


def multiple_roots(payload: dict[str, object]) -> None:
    bones = payload["bones"]
    assert isinstance(bones, list)
    bones[1]["parent_id"] = None


def wrong_root_name(payload: dict[str, object]) -> None:
    bones = payload["bones"]
    required = payload["required_parts"]
    sockets = payload["default_sockets"]
    assert isinstance(bones, list)
    assert isinstance(required, list)
    assert isinstance(sockets, list)
    bones[0]["bone_id"] = "origin"
    bones[1]["parent_id"] = "origin"


def cyclic_bones(payload: dict[str, object]) -> None:
    bones = payload["bones"]
    assert isinstance(bones, list)
    bones.extend(
        [
            {"bone_id": "arm", "parent_id": "hand"},
            {"bone_id": "hand", "parent_id": "arm"},
        ]
    )


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (duplicate_bone, "duplicate bone ID 'torso'"),
        (missing_parent, "missing parent 'missing'"),
        (multiple_roots, "exactly one parentless bone"),
        (wrong_root_name, "named 'root'"),
        (cyclic_bones, "bone cycle"),
    ],
)
def test_template_rejects_invalid_bone_hierarchies(
    mutation: Callable[[dict[str, object]], None],
    message: str,
) -> None:
    payload = template_payload()
    mutation(payload)

    with pytest.raises(ValidationError, match=message):
        parse_template(payload)


def duplicate_required_part(payload: dict[str, object]) -> None:
    parts = payload["required_parts"]
    assert isinstance(parts, list)
    parts.append(copy.deepcopy(parts[0]))


def overlapping_part(payload: dict[str, object]) -> None:
    optional = payload["optional_parts"]
    assert isinstance(optional, list)
    optional[0]["part_id"] = "torso"


def part_with_missing_bone(payload: dict[str, object]) -> None:
    required = payload["required_parts"]
    assert isinstance(required, list)
    required[0]["bone_id"] = "missing"


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (duplicate_required_part, "duplicate required part ID"),
        (overlapping_part, "both required and optional"),
        (part_with_missing_bone, "references missing bone"),
    ],
)
def test_template_rejects_invalid_part_declarations(
    mutation: Callable[[dict[str, object]], None],
    message: str,
) -> None:
    payload = template_payload()
    mutation(payload)

    with pytest.raises(ValidationError, match=message):
        parse_template(payload)


def duplicate_alias_target(payload: dict[str, object]) -> None:
    aliases = payload["import_aliases"]
    assert isinstance(aliases, list)
    aliases.append({"canonical_part": "torso", "aliases": ["second_body"]})


def unknown_alias_target(payload: dict[str, object]) -> None:
    aliases = payload["import_aliases"]
    assert isinstance(aliases, list)
    aliases[0]["canonical_part"] = "unknown"


def canonical_alias_collision(payload: dict[str, object]) -> None:
    aliases = payload["import_aliases"]
    assert isinstance(aliases, list)
    aliases[0]["aliases"] = ["cape"]


def duplicate_alias(payload: dict[str, object]) -> None:
    aliases = payload["import_aliases"]
    assert isinstance(aliases, list)
    aliases[0]["aliases"] = ["body_torso", "body_torso"]


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (duplicate_alias_target, "duplicate alias target"),
        (unknown_alias_target, "not a declared part"),
        (canonical_alias_collision, "collides with a canonical part"),
        (duplicate_alias, "duplicate import alias"),
    ],
)
def test_template_rejects_ambiguous_aliases(
    mutation: Callable[[dict[str, object]], None],
    message: str,
) -> None:
    payload = template_payload()
    mutation(payload)

    with pytest.raises(ValidationError, match=message):
        parse_template(payload)


def socket_with_missing_bone(payload: dict[str, object]) -> None:
    sockets = payload["default_sockets"]
    assert isinstance(sockets, list)
    sockets[0]["bone_id"] = "missing"


def socket_with_unknown_slot(payload: dict[str, object]) -> None:
    sockets = payload["default_sockets"]
    assert isinstance(sockets, list)
    sockets[0]["default_draw_slot"] = "unknown"


def duplicate_socket(payload: dict[str, object]) -> None:
    sockets = payload["default_sockets"]
    assert isinstance(sockets, list)
    sockets.append(copy.deepcopy(sockets[0]))


def duplicate_draw_slot(payload: dict[str, object]) -> None:
    slots = payload["draw_slots"]
    assert isinstance(slots, list)
    slots.append("torso")


def duplicate_generator(payload: dict[str, object]) -> None:
    generators = payload["compatible_generators"]
    assert isinstance(generators, list)
    generators.append("test_idle_v1")


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (socket_with_missing_bone, "references missing bone"),
        (socket_with_unknown_slot, "unknown draw slot"),
        (duplicate_socket, "duplicate socket ID"),
        (duplicate_draw_slot, "duplicate draw slot"),
        (duplicate_generator, "duplicate compatible generator ID"),
    ],
)
def test_template_rejects_invalid_sockets_slots_and_generators(
    mutation: Callable[[dict[str, object]], None],
    message: str,
) -> None:
    payload = template_payload()
    mutation(payload)

    with pytest.raises(ValidationError, match=message):
        parse_template(payload)


def test_template_requires_matching_limits_and_initial_values() -> None:
    payload = template_payload()
    initial_values = payload["initial_values"]
    assert isinstance(initial_values, list)
    initial_values[0]["value_id"] = "canvas_height_px"

    with pytest.raises(ValidationError, match="same value IDs"):
        parse_template(payload)


@pytest.mark.parametrize("initial", [0.0, 2049.0])
def test_template_rejects_initial_values_outside_limits(initial: float) -> None:
    payload = template_payload()
    initial_values = payload["initial_values"]
    assert isinstance(initial_values, list)
    initial_values[0]["value"] = initial

    with pytest.raises(ValidationError, match="within its inclusive limit"):
        parse_template(payload)


def test_template_accepts_inclusive_limit_boundaries() -> None:
    for initial in (1.0, 2048.0):
        payload = template_payload()
        initial_values = payload["initial_values"]
        assert isinstance(initial_values, list)
        initial_values[0]["value"] = initial
        assert parse_template(payload).initial_values[0].value == initial


def test_template_rejects_inverted_or_nonfinite_numeric_values() -> None:
    payload = template_payload()
    limits = payload["limits"]
    assert isinstance(limits, list)
    limits[0]["minimum"] = 2049.0
    with pytest.raises(ValidationError, match="less than or equal"):
        parse_template(payload)

    raw = json.dumps(template_payload()).replace("192.0", "NaN")
    with pytest.raises(ValidationError):
        RigTemplate.model_validate_json(raw)
