"""Tests for deterministic and hardened rig-template resource loading."""

from __future__ import annotations

import copy
import json

import pytest

import animated_fabric.templates.registry as registry_module
from animated_fabric.application.ports import RigTemplateRegistry
from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.templates.registry import JsonRigTemplateRegistry


def resource_payload(template_id: str = "test_template") -> dict[str, object]:
    return {
        "format": "animated-fabric.rig-template.v1",
        "schema_version": "0.1.0",
        "template_id": template_id,
        "display_name": template_id.replace("_", " ").title(),
        "bones": [{"bone_id": "root", "parent_id": None}],
        "required_parts": [{"part_id": "body", "bone_id": "root"}],
        "optional_parts": [],
        "import_aliases": [],
        "default_sockets": [],
        "draw_slots": ["body"],
        "compatible_generators": [],
        "limits": [{"value_id": "canvas_px", "minimum": 1.0, "maximum": 2048.0}],
        "initial_values": [{"value_id": "canvas_px", "value": 192.0}],
    }


def resource_bytes(template_id: str = "test_template") -> bytes:
    return json.dumps(resource_payload(template_id)).encode()


def test_concrete_registry_satisfies_the_application_port() -> None:
    registry: RigTemplateRegistry = JsonRigTemplateRegistry(
        (("test_template.json", resource_bytes()),)
    )

    assert registry.list_templates()[0].template_id == "test_template"
    assert registry.get("test_template").template_id == "test_template"


def test_resource_order_cannot_change_listing_order() -> None:
    documents = (
        ("zeta.json", resource_bytes("zeta")),
        ("alpha.json", resource_bytes("alpha")),
    )

    forward = JsonRigTemplateRegistry(documents)
    reverse = JsonRigTemplateRegistry(tuple(reversed(documents)))

    assert tuple(summary.template_id for summary in forward.list_templates()) == (
        "alpha",
        "zeta",
    )
    assert reverse.list_templates() == forward.list_templates()
    assert reverse.get("alpha") == forward.get("alpha")


@pytest.mark.parametrize(
    "template_id", ["missing", "../test_template", "test/template", "Ｔｅｓｔ"]
)
def test_unknown_or_path_like_template_ids_never_trigger_resource_loading(
    template_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = JsonRigTemplateRegistry((("test_template.json", resource_bytes()),))

    def unexpected_read() -> tuple[tuple[str, bytes], ...]:
        raise AssertionError("get() must not read package resources")

    monkeypatch.setattr(registry_module, "_read_builtin_resource_documents", unexpected_read)

    with pytest.raises(RigDefinitionError, match="Unknown rig template ID"):
        registry.get(template_id)


def test_registry_requires_at_least_one_resource() -> None:
    with pytest.raises(RigDefinitionError, match="at least one resource"):
        JsonRigTemplateRegistry(())


@pytest.mark.parametrize(
    "resource_name",
    ["../test_template.json", "TestTemplate.json", "test-template.json", "template.py"],
)
def test_registry_rejects_noncanonical_resource_names(resource_name: str) -> None:
    with pytest.raises(RigDefinitionError, match="canonical JSON filenames"):
        JsonRigTemplateRegistry(((resource_name, resource_bytes()),))


def test_registry_rejects_duplicate_resource_names() -> None:
    document = ("test_template.json", resource_bytes())

    with pytest.raises(RigDefinitionError, match="Duplicate rig template resource"):
        JsonRigTemplateRegistry((document, document))


def test_registry_rejects_filename_and_template_id_disagreement() -> None:
    with pytest.raises(RigDefinitionError, match="must be named 'test_template.json'"):
        JsonRigTemplateRegistry((("other.json", resource_bytes()),))


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (b"{", "Malformed JSON"),
        (b"\xff", "not valid UTF-8"),
        (b"[]", "must contain a JSON object"),
        (
            b'{"format":"animated-fabric.rig-template.v1",'
            b'"schema_version":"0.1.0","nested":{"value":1,"value":2}}',
            "duplicate JSON key",
        ),
        (b'{"value":NaN}', "nonstandard JSON value"),
    ],
)
def test_registry_rejects_malformed_ambiguous_or_nonstandard_json(
    raw: bytes,
    message: str,
) -> None:
    with pytest.raises(RigDefinitionError, match=message):
        JsonRigTemplateRegistry((("test_template.json", raw),))


def test_registry_translates_oversized_integer_failures_to_typed_errors() -> None:
    raw = b'{"value":' + b"9" * 5000 + b"}"

    with pytest.raises(RigDefinitionError, match="cannot be decoded safely"):
        JsonRigTemplateRegistry((("test_template.json", raw),))


def test_registry_translates_decoder_recursion_to_typed_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_decode(_raw: bytes) -> dict[str, object]:
        raise RecursionError("injected decoder depth failure")

    monkeypatch.setattr(registry_module, "decode_json_object", fail_decode)

    with pytest.raises(RigDefinitionError, match="cannot be decoded safely"):
        JsonRigTemplateRegistry((("test_template.json", resource_bytes()),))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("format", "animated-fabric.rig.v1"),
        ("schema_version", "1.0.0"),
        ("schema_version", "0.1.0-alpha.1"),
    ],
)
def test_registry_rejects_unsupported_resource_identity(field: str, value: object) -> None:
    payload = resource_payload()
    payload[field] = value

    with pytest.raises(RigDefinitionError, match="Invalid rig template resource"):
        JsonRigTemplateRegistry((("test_template.json", json.dumps(payload).encode()),))


def test_registry_rejects_executable_or_unknown_configuration_fields() -> None:
    payload = resource_payload()
    payload["callable"] = "package.module:function"

    with pytest.raises(RigDefinitionError, match="Extra inputs are not permitted"):
        JsonRigTemplateRegistry((("test_template.json", json.dumps(payload).encode()),))


def test_registry_rejects_oversized_resources_before_json_decoding() -> None:
    raw = b"{" + b" " * (1024 * 1024)

    with pytest.raises(RigDefinitionError, match="exceeds the 1 MiB limit"):
        JsonRigTemplateRegistry((("test_template.json", raw),))


def test_registry_rejects_more_than_the_fixed_resource_limit() -> None:
    documents = tuple(
        (f"template_{index}.json", resource_bytes(f"template_{index}")) for index in range(33)
    )

    with pytest.raises(RigDefinitionError, match="32-resource limit"):
        JsonRigTemplateRegistry(documents)


def test_loaded_templates_are_repeatable_and_detached_from_input_mutation() -> None:
    payload = resource_payload()
    raw = json.dumps(payload).encode()
    documents = [("test_template.json", raw)]
    registry = JsonRigTemplateRegistry(documents)

    documents.clear()
    mutated = copy.deepcopy(payload)
    mutated["display_name"] = "Changed"

    assert registry.get("test_template") is registry.get("test_template")
    assert registry.get("test_template").display_name == "Test Template"
